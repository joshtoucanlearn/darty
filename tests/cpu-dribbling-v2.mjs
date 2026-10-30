import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const CPU=require('../match-engine/cpu-intelligence-v2.js');
const Dribble=require('../match-engine/dribbling-state-v2.js');
function state(defenders=[]){
 const player=(id,x,y,teamId='you',position='ST')=>({id,x,y,teamId,position,formationAnchor:{x,y},
   control:75,agility:75,pace:75,acceleration:75,awareness:75,passing:75,shooting:50,defending:70});
 return {tick:1,fixedTickSeconds:1/60,teamId:'you',possessionTeamId:'you',carrierId:'carrier',
  attackingDirection:1,offsideLine:100,pitch:{xMin:0,xMax:105,yMin:0,yMax:68},ball:{x:50,y:34},
  players:[player('carrier',50,34),player('rest1',20,12,'you','CB'),player('rest2',20,56,'you','CB'),
   ...defenders.map(([x,y],i)=>player('def'+i,x,y,'opp','CM'))]};
}
test('carrier uses an open diagonal when the straight lane is occupied',()=>{
 const s=state([[57,34],[80,60]]),intent=CPU.decide(s).carrierIntent;
 assert.equal(intent.type,'carry');assert.ok(intent.target.x>50);assert.ok(Math.abs(intent.target.y-34)>2);
});
test('a lone defender with room behind invites a committed cut with every rating',()=>{
 for(const rating of [1,20,50,99]){
  const s=state([[52.6,34]]);s.players[0].control=rating;s.players[0].agility=rating;
  const a=CPU.decide(s);assert.equal(a.carrierIntent.type,'take-on');
  const b=CPU.decide({...s,tick:2},JSON.parse(JSON.stringify(a.memory)));
  assert.deepEqual(b.carrierIntent.target,a.carrierIntent.target);assert.equal(b.carrierIntent.startedTick,1);
 }
});
test('a committing defender invites a physical knock-on instead of a feint',()=>{
 const s=state([[52.5,34]]);s.players.at(-1).committed=true;
 const i=CPU.decide(s).carrierIntent;assert.equal(i.type,'take-on');assert.equal(i.knockOn,true);assert.equal(i.skill,null);
});
test('a trapped carrier turns away and shields, then releases when an outlet opens',()=>{
 const s=state([[51,34],[51,32],[51,36],[53,30],[53,38],[55,34]]);
 const a=CPU.decide(s);assert.equal(a.carrierIntent.type,'protect');assert.ok(a.carrierIntent.target.x<50);
 const open=state([[51.8,34]]);open.tick=2;open.players.push({id:'outlet',teamId:'you',position:'CM',x:44,y:29,passing:90,awareness:90,control:90});
 const b=CPU.decide(open,a.memory);assert.ok(['pass','take-on'].includes(b.carrierIntent.type));
});
test('dribble choices mirror with attack direction and ignore roster order',()=>{
 const s=state([[52.6,34]]),a=CPU.decide(s).carrierIntent;
 const mirrored=structuredClone(s);mirrored.attackingDirection=-1;mirrored.offsideLine=5;mirrored.ball.x=55;
 for(const p of mirrored.players){p.x=105-p.x;p.formationAnchor.x=105-p.formationAnchor.x;}
 const b=CPU.decide(mirrored).carrierIntent;
 assert.equal(a.type,b.type);assert.ok(Math.abs(a.target.x+b.target.x-105)<.01);assert.equal(a.target.y,b.target.y);
 assert.deepEqual(CPU.decide({...s,players:[...s.players].reverse()}).carrierIntent,a);
});
test('shared touch calibration is continuous, close at jog, exposed at sprint and rated at every speed',()=>{
 for(const speed of [0,2,4,6,8]){
  const low=Dribble.touchProfile({speed,control:1}),high=Dribble.touchProfile({speed,control:99});
  assert.ok(low.distance>high.distance);assert.ok(low.directional>high.directional);
  assert.ok(high.cadence<=low.cadence);
 }
 assert.ok(Dribble.touchProfile({speed:3,control:75}).distance<.9);
 assert.ok(Dribble.touchProfile({speed:8,control:75,sprint:true}).distance>1);
 assert.ok(Dribble.touchProfile({speed:8,control:75}).distance>Dribble.touchProfile({speed:3,control:75}).distance);
});
test('CPU receiving goes toward space and cushions tight',()=>{
 const p={position:{x:50,y:0},velocity:{x:3,y:0},attributes:{control:80,agility:80}};
 const open=Dribble.receivingIntent({player:p,opponents:[{position:{x:56,y:0}}],attackingDirection:1});
 assert.equal(open.type,'directional-touch');assert.ok(Math.abs(open.direction.y)>.1);
 assert.equal(Dribble.receivingIntent({player:p,opponents:[{position:{x:51,y:0}}]}).type,'cushion');

});

test('a close give-and-go receiver can physically lay off toward the returning player',()=>{
 const player={position:{x:50,y:0},velocity:{x:2,y:0},attributes:{control:75}};
 const intent=Dribble.receivingIntent({player,combinationTarget:{id:'returner',position:{x:47,y:0}}});
 assert.equal(intent.type,'layoff');assert.equal(intent.targetPlayerId,'returner');assert.ok(intent.direction.x<0);
});

test('a take-on commitment ends on turnover and aborts when cover closes its exit',()=>{
 const s=state([[52.6,34]]),a=CPU.decide(s);assert.equal(a.carrierIntent.type,'take-on');
 const lost=structuredClone(s);lost.tick=2;lost.possessionTeamId='opp';lost.carrierId='def0';
 const b=CPU.decide(lost,a.memory);assert.equal(b.memory.dribble.intent,null);
 const blocked=structuredClone(s);blocked.tick=2;blocked.players.push({id:'cover',teamId:'opp',position:'CM',x:a.carrierIntent.target.x,y:a.carrierIntent.target.y});
 const c=CPU.decide(blocked,a.memory);assert.notEqual(c.carrierIntent.startedTick,1);
});

test('a defender jockeys secured control, then challenges an exposed ball even with low ratings',()=>{
 for (const rating of [1,30,70,99]) {
  const s=state([[52,34]]);s.possessionTeamId='opp';s.carrierId='def0';s.ball={x:52,y:34};
  Object.assign(s.players[0],{fx:1,fy:0,defending:rating,aggression:rating,strength:rating});
  const config={minimumReactionTicks:0,maximumReactionTicks:0};
  const held=CPU.decide(s,null,config).defensiveIntents.find(p=>p.type==='press');
  assert.equal(held.movementIntent,'jockey');assert.equal(held.physicalAction,null);
  s.ball.x=50.7;
  const exposed=CPU.decide(s,null,config).defensiveIntents.find(p=>p.type==='press');
  assert.equal(exposed.physicalAction.type,'stand-tackle');
 }
});

test('a directional receiving choice requires winning the exit race, while a tight race stays cushioned',()=>{
 const player={position:{x:50,y:0},velocity:{x:0,y:0},facing:{x:1,y:0},attributes:{control:80,agility:80}};
 assert.equal(Dribble.receivingIntent({player,opponents:[{position:{x:53,y:0},velocity:{x:-4,y:0}}]}).type,'cushion');
 assert.equal(Dribble.receivingIntent({player,opponents:[{position:{x:60,y:0},velocity:{x:4,y:0}}]}).type,'directional-touch');
});

test('a pushed ball screened by the carrier invites delay rather than a lunge through his body',()=>{
 const s=state([[52,34]]);s.possessionTeamId='opp';s.carrierId='def0';s.ball={x:53.3,y:34};
 Object.assign(s.players[0],{fx:1,fy:0,defending:90});
 const press=CPU.decide(s,null,{minimumReactionTicks:0,maximumReactionTicks:0}).defensiveIntents.find(p=>p.type==='press');
 assert.equal(press.physicalAction,null);
});

test('a pass already released by the touch transaction takes precedence over a CPU knock-on',()=>{
 const source=fs.readFileSync(new URL('../match-engine/match.html',import.meta.url),'utf8');
 const start=source.indexOf('  function liveV2ApplyIntelligence(projection){');
 const end=source.indexOf('  function liveV2ApplyBall(',start);
 assert.ok(start>=0&&end>start);
 const actor={id:'carrier'},ball={owner:actor};let launches=0;
 const input={intelligence:[{playerId:actor.id,type:'take-on',maneuver:{knockOn:true,phase:'burst'}}],
  dribbling:{releasedAction:{actorId:actor.id,type:'pass'}}};
 vm.runInNewContext(source.slice(start,end)+';liveV2ApplyIntelligence(input);',{
  input,ball,liveV2PlayerById:()=>actor,liveV2DribbleLeaseOwns:()=>false,
  liveV2LaunchDribbleKnockOn:()=>{launches++;},logEvent:()=>{}
 });
 assert.equal(launches,0);assert.equal(ball.owner,actor);
});

test('a planned combination cushions for its release and a lateral opponent need not provoke a take-on',()=>{
 const player={position:{x:50,y:0},velocity:{x:0,y:0},attributes:{control:80,agility:80}};
 assert.equal(Dribble.receivingIntent({player,combination:true,opponents:[]}).type,'cushion');
 const s=state([[51,37]]);assert.notEqual(CPU.decide(s).carrierIntent.type,'take-on');
});
