/*
 * DARTY commentary (Joe's lines).
 *
 * Joe writes every line in "DARTY commentary – Joe's lines" (Josh's Google Drive);
 * they are copied into commentary/lines.json. This file never invents a line: with
 * no lines for a moment it stays silent.
 *
 * Each match event becomes at most one "moment" (goal, great save, the POP...). A
 * moment picks one of Joe's lines it has not used recently, fills the magic words
 * ({player}, {team}, {opponent}, {keeper}, {minute}, {score}), shows it in a
 * subtitle bar and, when the line has a recorded clip, plays it. Goals always cut
 * in; everything else waits its turn and respects a short cooldown so the
 * commentator never talks over himself.
 *
 * Presentation only: it reads events, never changes the match. Bad or missing
 * lines are skipped with a console warning so a typo can't stop a match.
 */
(function exposeDartyCommentary(root) {
  'use strict';
  if (!root) return;

  const SCHEMA = 'darty-commentary-lines-v1';
  const MOMENTS = Object.freeze([
    'kick-off', 'half-time', 'full-time',
    'goal', 'long-range-goal', 'free-kick-goal', 'header-goal', 'own-goal', 'equaliser', 'late-winner',
    'shot-saved', 'shot-wide', 'woodwork', 'big-chance-missed', 'great-save', 'keeper-mistake',
    'pop',
    'slide-tackle', 'foul', 'yellow-card', 'red-card',
    'corner', 'free-kick', 'penalty',
    'substitution', 'comeback', 'late-drama'
  ]);
  // Higher tiers interrupt lower ones; tier 3 (goals) interrupts anything.
  const TIER = Object.freeze({
    'goal': 3, 'long-range-goal': 3, 'free-kick-goal': 3, 'header-goal': 3, 'own-goal': 3, 'equaliser': 3, 'late-winner': 3, 'comeback': 3,
    'pop': 2, 'red-card': 2, 'penalty': 2, 'full-time': 2, 'half-time': 2, 'kick-off': 2,
    'great-save': 1, 'big-chance-missed': 1, 'keeper-mistake': 1, 'woodwork': 1, 'yellow-card': 1, 'late-drama': 1,
    'shot-saved': 1, 'shot-wide': 1, 'slide-tackle': 1, 'foul': 1, 'substitution': 1,
    'corner': 0, 'free-kick': 0
  });
  const COOLDOWN_MS = 3800;
  const NO_REPEAT = 4;
  const LATE_MINUTE = 85;

  const state = {
    enabled: true,
    lines: Object.fromEntries(MOMENTS.map(key => [key, []])),
    recent: Object.fromEntries(MOMENTS.map(key => [key, []])),
    lastShot: { you: null, opp: null },
    kickOffSaid: false,
    busyUntil: 0,
    currentTier: -1,
    bar: null,
    hideTimer: null,
    audio: null,
    base: '',
    muted: () => false,
    volume: () => 1,
    now: () => (root.performance && root.performance.now ? root.performance.now() : Date.now()),
    random: Math.random,
    log: []
  };

  function validLine(row) {
    if (typeof row === 'string') return row.trim() ? { text: row.trim(), audio: null } : null;
    if (!row || typeof row !== 'object' || typeof row.text !== 'string' || !row.text.trim()) return null;
    const audio = typeof row.audio === 'string' && /^[\w\-./]+\.(mp3|ogg|m4a|wav)$/i.test(row.audio) && !row.audio.includes('..') ? row.audio : null;
    return { text: row.text.trim().slice(0, 240), audio };
  }

  function load(data) {
    const next = Object.fromEntries(MOMENTS.map(key => [key, []]));
    if (!data || data.schema !== SCHEMA || !data.moments || typeof data.moments !== 'object') {
      if (data) console.warn('DARTY commentary: lines file ignored (wrong schema)');
      state.lines = next;
      return 0;
    }
    let count = 0;
    for (const [key, rows] of Object.entries(data.moments)) {
      if (!MOMENTS.includes(key)) { console.warn('DARTY commentary: unknown moment ' + key); continue; }
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const line = validLine(row);
        if (line) { next[key].push(line); count++; } else if (row) console.warn('DARTY commentary: skipped a line in ' + key);
      }
    }
    state.lines = next;
    return count;
  }

  function teamName(ctx, team) { return ctx && ctx.teams && ctx.teams[team] || (team === 'you' ? 'the home side' : 'the away side'); }
  function other(team) { return team === 'you' ? 'opp' : 'you'; }

  function fill(text, event, ctx) {
    const team = event.team === 'you' || event.team === 'opp' ? event.team : null;
    const keeperTeam = event.keeperTeam || (team ? other(team) : null);
    const values = {
      player: event.player || (team ? teamName(ctx, team) : 'he'),
      team: team ? teamName(ctx, team) : '',
      opponent: team ? teamName(ctx, other(team)) : '',
      keeper: keeperTeam && ctx && ctx.keepers ? (ctx.keepers[keeperTeam] || 'the keeper') : 'the keeper',
      minute: String(event.minute || ''),
      score: ctx && ctx.score ? ctx.score.you + '-' + ctx.score.opp : (event.score || '')
    };
    return text.replace(/\{(player|team|opponent|keeper|minute|score)\}/g, (_, key) => values[key]);
  }

  function pick(key) {
    const lines = state.lines[key];
    if (!lines || !lines.length) return null;
    const recent = state.recent[key];
    const fresh = lines.map((line, index) => index).filter(index => !recent.includes(index));
    const pool = fresh.length ? fresh : lines.map((line, index) => index);
    const index = pool[Math.floor(state.random() * pool.length) % pool.length];
    recent.push(index);
    while (recent.length > Math.min(NO_REPEAT, Math.max(0, lines.length - 1))) recent.shift();
    return lines[index];
  }

  function ensureBar() {
    if (state.bar || !root.document || !root.document.body) return state.bar;
    const bar = root.document.createElement('div');
    bar.className = 'darty-commentary';
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-live', 'polite');
    const host = root.document.getElementById('wrap') || root.document.body;
    host.appendChild(bar);
    state.bar = bar;
    return bar;
  }

  function say(key, event, ctx) {
    const tier = TIER[key] == null ? 0 : TIER[key];
    const now = state.now();
    if (now < state.busyUntil && tier <= state.currentTier && tier < 3) return false;
    const line = pick(key);
    if (!line) return false;
    const text = fill(line.text, event, ctx);
    const showMs = Math.max(2400, Math.min(6000, 900 + text.length * 55));
    state.busyUntil = now + Math.max(showMs, COOLDOWN_MS);
    state.currentTier = tier;
    state.log.push({ key, text, minute: event.minute || null });
    if (state.log.length > 50) state.log.shift();
    const bar = ensureBar();
    if (bar) {
      bar.textContent = text;
      bar.classList.add('is-visible');
      if (state.hideTimer) root.clearTimeout(state.hideTimer);
      state.hideTimer = root.setTimeout(() => { bar.classList.remove('is-visible'); state.currentTier = -1; }, showMs);
    }
    if (line.audio && !state.muted() && typeof root.Audio === 'function') {
      try {
        if (state.audio) state.audio.pause();
        state.audio = new root.Audio(state.base + line.audio);
        state.audio.volume = Math.max(0, Math.min(1, Number(state.volume()) || 0));
        const played = state.audio.play();
        if (played && typeof played.catch === 'function') played.catch(() => {});
      } catch (error) { /* audio is optional */ }
    }
    return true;
  }

  function metresFrom(shotEvent) {
    if (!shotEvent) return null;
    if (Number.isFinite(shotEvent.distanceMetres)) return shotEvent.distanceMetres;
    const units = Number.isFinite(shotEvent.distance) ? shotEvent.distance
      : shotEvent.shotProfile && Number.isFinite(shotEvent.shotProfile.distance) ? shotEvent.shotProfile.distance : null;
    return units == null ? null : units / 30.25;
  }

  function momentFor(event, ctx) {
    const type = event.type;
    const minute = Number(event.minute) || 0;
    const late = minute >= LATE_MINUTE;
    if (type === 'shot') {
      if (event.team === 'you' || event.team === 'opp') state.lastShot[event.team] = event;
      return null;
    }
    if (type === 'restart') {
      if (event.kind === 'KICK OFF' && !state.kickOffSaid) {
        // Quick Play can reach the opening restart before the separate Joe-lines
        // JSON request finishes. Do not consume the one-shot cue while silent.
        if (!state.lines['kick-off'].length) return null;
        state.kickOffSaid = true;
        return 'kick-off';
      }
      if (event.kind === 'CORNER') return 'corner';
      if (event.kind === 'FREE KICK') return 'free-kick';
      if (event.kind === 'PENALTY') return 'penalty';
      return null;
    }
    if (type === 'goal') {
      const team = event.team;
      const scorerTeam = ctx && typeof ctx.teamOf === 'function' ? ctx.teamOf(event.playerId) : team;
      const score = ctx && ctx.score ? ctx.score : null;
      const shot = state.lastShot[team];
      if (team === 'you' || team === 'opp') state.lastShot[team] = null;
      if (scorerTeam && team && scorerTeam !== team) return 'own-goal';
      if (event.freeKickGoal) return 'free-kick-goal';
      if (score) {
        const mine = score[team], theirs = score[other(team)];
        if (late && mine === theirs + 1) return 'late-winner';
        if (mine === theirs) return 'equaliser';
        if (theirs - mine >= 1 && theirs - (mine - 1) >= 2) return 'comeback';
      }
      // The match flags a possible keeper error on many goals, so Joe's keeper-mistake lines
      // only sometimes replace the goal call.
      if (event.keeperErrorCandidate && state.lines['keeper-mistake'].length && state.random() < 0.3) return 'keeper-mistake';
      if (shot && /header/i.test(String(shot.shotType || ''))) return 'header-goal';
      const metres = metresFrom(shot);
      if (metres != null && metres >= 25) return 'long-range-goal';
      return 'goal';
    }
    if (type === 'keeper-save') {
      const hard = Number.isFinite(event.saveChance) && event.saveChance < 0.55;
      const dive = /dive|tip|fingertip|stretch/i.test(String(event.animation || ''));
      if (late && state.lines['late-drama'].length && state.random() < 0.5) return 'late-drama';
      return hard || dive ? 'great-save' : 'shot-saved';
    }
    if (type === 'shot-off-target') {
      const shot = state.lastShot[event.team];
      const metres = metresFrom(shot);
      const xg = shot && Number.isFinite(shot.xg) ? shot.xg : null;
      if (late && state.lines['late-drama'].length && state.random() < 0.5) return 'late-drama';
      if ((xg != null && xg >= 0.25) || (metres != null && metres <= 11)) return 'big-chance-missed';
      return 'shot-wide';
    }
    if (type === 'woodwork') return 'woodwork';
    if (type === 'darty-toy-pop') return 'pop';
    if (type === 'tackle' && event.slide) return 'slide-tackle';
    if (type === 'foul') return 'foul';
    if (type === 'yellow-card') return 'yellow-card';
    if (type === 'red-card') return 'red-card';
    if (type === 'substitution') return 'substitution';
    if (type === 'half-time') return 'half-time';
    if (type === 'full-time') return 'full-time';
    return null;
  }

  function onEvent(event, ctx) {
    if (!state.enabled || !event || typeof event.type !== 'string') return null;
    let key = null;
    try { key = momentFor(event, ctx || null); } catch (error) { return null; }
    if (!key) return null;
    const subject = key === 'pop' && event.actorName ? { ...event, player: event.actorName } : event;
    const genericGoalFallbacks = new Set(['header-goal', 'equaliser', 'late-winner', 'comeback']);
    const spokenKey = state.lines[key] && state.lines[key].length
      ? key
      : genericGoalFallbacks.has(key) && state.lines.goal.length ? 'goal' : key;
    return say(spokenKey, subject, ctx || null) ? spokenKey : null;
  }

  function init(options = {}) {
    state.enabled = options.enabled !== false;
    state.base = typeof options.base === 'string' ? options.base : '';
    if (typeof options.muted === 'function') state.muted = options.muted;
    if (typeof options.volume === 'function') state.volume = options.volume;
    if (typeof options.now === 'function') state.now = options.now;
    if (typeof options.random === 'function') state.random = options.random;
    if (options.lines) return Promise.resolve(load(options.lines));
    if (!state.enabled || typeof root.fetch !== 'function' || !options.url) return Promise.resolve(0);
    return root.fetch(options.url, { cache: 'no-cache' })
      .then(response => response.ok ? response.json() : null)
      .then(load)
      .catch(() => { console.warn('DARTY commentary: lines file could not be read'); return 0; });
  }

  root.DartyCommentary = Object.freeze({
    SCHEMA, MOMENTS, init, load, onEvent,
    momentFor: (event, ctx) => momentFor(event, ctx),
    status: () => ({ enabled: state.enabled, lines: Object.fromEntries(MOMENTS.map(key => [key, state.lines[key].length])), log: state.log.slice() })
  });
})(typeof window === 'object' ? window : null);
