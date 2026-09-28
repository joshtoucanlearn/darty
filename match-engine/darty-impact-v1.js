'use strict';

/*
 * DARTY impact tracker.
 *
 * This module is deliberately detached from rendering and football outcomes.
 * It consumes resolved Movement V2 contact telemetry, counts only distinct
 * hard wins against the same player, and asks the host to detach one toy-like
 * body part on the first accepted hit.
 */
(function exposeDartyImpact(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DartyImpactV1 = api;
})(typeof window === 'object' ? window : null, function createDartyImpactApi() {
  const VERSION = '1.1.0-one-hit';
  const DEFAULTS = Object.freeze({
    hitsToDetach: 1,
    minimumEpisodeGapTicks: 18,
    hardClosingSpeedMps: Object.freeze({
      'tackle-contact': 4.6,
      'shoulder-contact': 4.9
    })
  });
  const CONTACT_TYPES = Object.freeze(new Set(Object.keys(DEFAULTS.hardClosingSpeedMps)));

  function finite(value, fallback = 0) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function stableText(value) {
    return value == null ? '' : String(value);
  }

  function episodeId(contact) {
    const commandId = stableText(contact && contact.commandId);
    const actorId = stableText(contact && contact.actorId);
    const targetId = stableText(contact && contact.targetId);
    const type = stableText(contact && contact.type);
    if (commandId) return [type, commandId, actorId, targetId].join(':');
    return [type, stableText(contact && contact.tick), actorId, targetId].join(':');
  }

  function partFor(contact, acceptedHits) {
    if (contact.type === 'shoulder-contact') return 'head';
    const text = stableText(contact.targetId) + ':' + stableText(contact.actorId) + ':' + acceptedHits;
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash = Math.imul(hash ^ text.charCodeAt(index), 16777619) >>> 0;
    }
    return hash % 2 ? 'legL' : 'legR';
  }

  function normalizeOptions(options) {
    const source = options && typeof options === 'object' ? options : {};
    const thresholds = source.hardClosingSpeedMps && typeof source.hardClosingSpeedMps === 'object'
      ? source.hardClosingSpeedMps : {};
    return {
      hitsToDetach: Math.max(1, Math.round(finite(source.hitsToDetach, DEFAULTS.hitsToDetach))),
      minimumEpisodeGapTicks: Math.max(0, Math.round(finite(source.minimumEpisodeGapTicks, DEFAULTS.minimumEpisodeGapTicks))),
      hardClosingSpeedMps: {
        'tackle-contact': Math.max(0, finite(thresholds['tackle-contact'], DEFAULTS.hardClosingSpeedMps['tackle-contact'])),
        'shoulder-contact': Math.max(0, finite(thresholds['shoulder-contact'], DEFAULTS.hardClosingSpeedMps['shoulder-contact']))
      }
    };
  }

  function createTracker(options) {
    const config = normalizeOptions(options);
    const players = new Map();
    const seenEpisodes = new Set();

    function snapshot(targetId) {
      const state = players.get(stableText(targetId));
      return state ? { ...state } : { targetId: stableText(targetId), hardHits: 0, detachedPart: null, lastAcceptedTick: null };
    }

    function reject(reason, contact, state) {
      return {
        accepted: false,
        hard: false,
        reason,
        episodeId: episodeId(contact),
        target: state ? { ...state } : snapshot(contact && contact.targetId),
        detachPart: null
      };
    }

    function register(contact) {
      if (!contact || typeof contact !== 'object') return reject('invalid-contact', contact);
      if (!CONTACT_TYPES.has(contact.type)) return reject('unsupported-contact', contact);
      if (!stableText(contact.actorId) || !stableText(contact.targetId) || contact.actorId === contact.targetId) {
        return reject('invalid-participants', contact);
      }
      if (contact.outcome !== 'win') return reject('non-winning-contact', contact);
      const speed = finite(contact.relativeClosingSpeed, 0);
      const threshold = config.hardClosingSpeedMps[contact.type];
      if (speed < threshold) return reject('below-hard-threshold', contact);

      const id = episodeId(contact);
      if (seenEpisodes.has(id)) return reject('duplicate-episode', contact);
      const targetId = stableText(contact.targetId);
      const current = snapshot(targetId);
      const tick = Math.max(0, Math.round(finite(contact.tick, 0)));
      if (current.lastAcceptedTick != null && tick - current.lastAcceptedTick < config.minimumEpisodeGapTicks) {
        return reject('same-contact-window', contact, current);
      }
      seenEpisodes.add(id);
      if (current.detachedPart) return reject('already-detached', contact, current);

      const hardHits = current.hardHits + 1;
      const detachPart = hardHits >= config.hitsToDetach ? partFor(contact, hardHits) : null;
      const next = { targetId, hardHits, detachedPart: detachPart, lastAcceptedTick: tick };
      players.set(targetId, next);
      return {
        accepted: true,
        hard: true,
        reason: detachPart ? 'detach' : 'hard-hit',
        episodeId: id,
        speedMps: speed,
        thresholdMps: threshold,
        target: { ...next },
        detachPart
      };
    }

    function reset() {
      players.clear();
      seenEpisodes.clear();
    }

    return Object.freeze({ config, register, snapshot, reset });
  }

  return Object.freeze({ VERSION, DEFAULTS, createTracker, episodeId, partFor });
});
