import test from 'node:test';
import assert from 'node:assert/strict';
import {createChallengeMetrics} from '../tools/challenge-metrics.mjs';
const projection=(epoch,kind='slide-tackle',actions=[],contacts=[])=>({dribbling:{serializedState:{state:{epoch}}},movementTelemetry:{
 actions:[{type:'action-window-entered',action:kind,commandId:'same-command',playerId:'defender'},...actions],contacts}});
test('challenge attempts use accepted windows, preserve epochs and link a physical foul/card',()=>{
 const m=createChallengeMetrics(),win={type:'slide-win',commandId:'same-command'},
  contact={type:'slide-contact',commandId:'same-command',targetId:'carrier',ballFirst:true,bodyContact:false,ballContact:true,contactPart:'boot-to-ball',point:{x:1,y:0,z:.1},normal:{x:1,y:0,z:0},visibleGapMetres:0};
 m.projection(projection(1,'slide-tackle',[win],[contact]),100);m.projection(projection(1),120);
 m.projection(projection(2,'slide-tackle',[win],[{...contact,ballFirst:false,bodyContact:true}]),200);
 m.event({type:'foul',actorId:'defender',time:200,authority:'movement-v2',commandId:'same-command'});
 m.event({type:'yellow-card',actorId:'defender',time:200,reason:'late-slide'});
 const s=m.snapshot();assert.equal(s.counts.slide.attempts,2);assert.equal(s.counts.slide.wonClean,1);
 assert.equal(s.counts.slide.fouls,1);assert.equal(s.counts.slide.cards,1);assert.equal(s.slideSharePct,100);
});
test('busy rejections, simulation cards and a foul without a physical contact cannot inflate challenge outcomes',()=>{
 const m=createChallengeMetrics();m.projection({movementTelemetry:{actions:[{type:'slide-tackle-rejected',commandId:'rejected',playerId:'defender'}],contacts:[]}},0);
 assert.equal(m.snapshot().counts.slide.attempts,0);
 m.projection(projection(1,'stand-tackle'),100);m.event({type:'foul',actorId:'defender',time:110,authority:'movement-v2'});
 m.event({type:'yellow-card',actorId:'defender',time:110,reason:'simulation'});
 assert.equal(m.snapshot().counts.standing.fouls,0);assert.equal(m.snapshot().counts.standing.cards,0);
 m.event({type:'restart',time:200});assert.equal(m.snapshot().counts.standing.stopped,1);assert.equal(m.snapshot().counts.standing.pending,0);
});

test('geometric proof percentages require both an actual contact and the matching foul event proof',()=>{
 const m=createChallengeMetrics(),contact={type:'slide-contact',commandId:'same-command',targetId:'carrier',ballFirst:true,ballContact:true,bodyContact:false,
  contactPart:'boot-to-ball',point:{x:1,y:0,z:.1},normal:{x:1,y:0,z:0},visibleGapMetres:0};
 m.projection(projection(1,'slide-tackle',[{type:'slide-win',commandId:'same-command'}],[contact]),100);
 m.projection(projection(1,'slide-tackle',[],[{...contact,ballFirst:false,bodyContact:true,contactPart:'boot-to-leg'}]),200);
 m.event({type:'foul',actorId:'defender',time:200,authority:'movement-v2',commandId:'same-command',contactProof:{bodyContact:true}});
 m.event({type:'red-card',actorId:'defender',time:4500,reason:'dangerous slide'});
 const s=m.snapshot();assert.equal(s.foulBodyContactConfirmedPct,100);assert.equal(s.cardBodyContactConfirmedPct,100);
 assert.equal(s.slideWinBootContactConfirmedPct,100);assert.equal(s.worstBootBallGapMetres,0);assert.equal(s.worstBootLegGapMetres,0);
});

test('ball-first follow-through and incidental-foul counters remain distinct from man-first fouls',()=>{
 const m=createChallengeMetrics(),contact={type:'slide-contact',commandId:'same-command',targetId:'carrier',ballFirst:true,ballContact:true,bodyContact:false,
  contactPart:'boot-to-ball',point:{x:1,y:0,z:.1},normal:{x:1,y:0,z:0},visibleGapMetres:0};
 m.projection(projection(1,'slide-tackle',[{type:'slide-win',commandId:'same-command'}],[contact]),100);
 m.projection(projection(1,'slide-tackle',[],[{...contact,bodyContact:true,contactPart:'boot-to-leg'}]),300);
 const s=m.snapshot();assert.equal(s.ballFirstWinsFollowedByBodyContact,1);assert.equal(s.ballFirstFollowThroughFouls,0);assert.equal(s.ballFirstFollowThroughCards,0);
 assert.deepEqual(s.foulsByType,{manFirstSlide:0,manFirstStanding:0,charge:0,incidental:0});
});
