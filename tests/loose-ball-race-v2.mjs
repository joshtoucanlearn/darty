import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),A=require('../match-engine/live-v2-authority-adapter.js'),M=require('../match-engine/movement-engine-v2.js');
const dependencies=Object.fromEntries([['ball','ball-engine-v2'],['movement','movement-engine-v2'],['cpu','cpu-intelligence-v2'],['formation','formation-behaviour-v2'],['contact','live-v2-contact-authority-composer'],['dribbling','dribbling-state-v2']].map(([k,f])=>[k,require('../match-engine/'+f+'.js')]));
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/corner-loose-ball-seed-2415640915.json',import.meta.url))).snapshot;
export function raceSnapshot({direction=1,speed=3,startSpeed=4,ratings=[85,70]}={}){
 const s=structuredClone(fixture),u=s.units,world=(x,y)=>({x:s.pitch.xMin+x*u.xPerMetre,y:(s.pitch.yMin+s.pitch.yMax)/2+y*u.yPerMetre});
 s.tick=1;s.humanPlayerIds=[];s.dribbling={surface:'dry',actionIntent:null,specialActionPlayerIds:[]};
 for(const [i,p]of s.players.entries()){
  const home=p.teamId==='you',racer=p.id===(home?'you-player-8':'opp-player-8'),side=home?-1:1;
  Object.assign(p,world(racer?(direction===1?45:60):(home?15:90),racer?side*.47:side*(20+i%5)));
  Object.assign(p,{vx:racer?direction*startSpeed*u.xPerMetre/60:0,vy:0,fx:racer?direction:(home?1:-1),fy:0,stamina:100,sentOff:false,contactEligible:!p.isGK,bodyContactEligible:true,control:null,tackleActive:false,shoulderActive:false});
  if(racer)Object.assign(p.attrs,{pace:ratings[home?0:1],accel:85,agility:85,strength:ratings[home?0:1],balance:ratings[home?0:1],awareness:85,reactions:85,control:85,defend:75,aggression:1});
 }
 s.ball={id:'loose-race',...world(direction===1?49:56,0),z:0,vx:direction*speed*u.xPerMetre/60,vy:0,zv:0,spin:0,dip:0,ownerId:null,targetId:null,lastKickerId:null,lastKickerTeamId:null,flightType:'ground',launchIntent:null};
 s.contact={intendedReceiverId:null,firstTouchIntent:null,aerialIntent:null,gate:{livePlay:true,restartActive:false,replayActive:false,keeperAuthority:false,offsideInvolvementPending:false,specialActionAuthority:false}};
 return s;
}
function attachment(extra={}){return A.createAttachment({enabled:true,seed:17,capability:A.createCapability({acknowledgement:A.ACKNOWLEDGEMENT,workflow:'cpu-v-cpu',online:false,onlineMarkers:{},controlOwnership:{humanPlayerIds:[],cpuTeamIds:['you','opp']}}),dependencies:{...dependencies,...extra},host:{prepareTick:()=>({commit(){},rollback(){}})}});}
export function replayRace(options={}) {
 const snapshot=raceSnapshot(options),u=snapshot.units,commands=[],rows=[],contacts=[];
 const run=attachment({movement:{...M,advance(...args){commands.push(args[1]);return M.advance(...args);}}});
 for(let tick=1;tick<=180;tick++){
  snapshot.tick=tick;const frame=run.planTick(snapshot);assert.ok(frame,run.status().failure);
  const projection=frame.hostProjection;contacts.push(...projection.movementTelemetry.contacts.filter(c=>c.type==='shoulder-contact'));
  rows.push({tick,ball:projection.ball,assignments:projection.recoveryAssignments,commands:commands.at(-1),racers:projection.movement.filter(p=>['you-player-8','opp-player-8'].includes(p.id)).map(p=>({id:p.id,speed:Math.hypot(p.vx/u.xPerMetre*60,p.vy/u.yPerMetre*60),gait:p.locomotionState}))});
  assert.ok(run.commitTick(frame));
  for(const p of projection.movement)Object.assign(snapshot.players.find(q=>q.id===p.id),p);
  if(projection.ball)Object.assign(snapshot.ball,projection.ball);
  snapshot.ball.ownerId=projection.physicalBallSeparated?null:projection.logicalBallOwnerId;
  if(projection.logicalBallOwnerId)return {resolved:true,ticks:tick,winnerId:projection.logicalBallOwnerId,rows,contacts};
 }
 return {resolved:false,rows,contacts};
}
test('both opposing loose-ball collectors request full sprint to a physically forecast intercept at every pace rating',()=>{
 for(const rating of [1,50,99]){
  const s=raceSnapshot({ratings:[rating,rating]}),commands=[];
  const run=attachment({movement:{...M,advance(...args){commands.push(...args[1]);return M.advance(...args);}}});
  const f=run.planTick(s);assert.ok(f);
  const racers=f.hostProjection.recoveryAssignments.filter(r=>r.authority==='v2-loose-ball-recovery');assert.equal(racers.length,2);
  for(const row of racers){const command=commands.find(c=>c.playerId===row.playerId);assert.equal(command.mode,'sprint');assert.equal(command.intensity,1);assert.ok(row.target.x>49,'lead the rolling ball');}
 }
});
test('a real lateral shoulder contest preserves sprint momentum, uses continuous ratings and never grants a loose ball',()=>{
 for(const rating of [1,50,99]){
  const p=(id,teamId,y,strength)=>({id,teamId,position:{x:20,y},velocity:{x:7,y:0},facing:{x:1,y:0},radius:.42,attributes:{pace:85,acceleration:85,balance:strength,strength,aggression:1}});
  const state=M.createWorldState({tick:0,fixedTickSeconds:1/60,bounds:{xMin:0,xMax:105,yMin:-34,yMax:34},ballOwnerId:null,players:[p('a','you',-.45,rating),p('b','opp',.45,50)]});
  const commands=[{id:'sprint-a',tick:1,playerId:'a',type:'move',move:{x:1,y:0},mode:'sprint',intensity:1,durationTicks:20},
   {id:'sprint-b',tick:1,playerId:'b',type:'move',move:{x:1,y:0},mode:'sprint',intensity:1,durationTicks:20},
   {id:'z-race',tick:1,playerId:'a',type:'shoulder-challenge',targetId:'b',direction:{x:0,y:1},move:{x:1,y:0},mode:'sprint',intensity:1,durationTicks:20,racePursuit:true}];
  const f=M.advance(state,commands,6);assert.equal(f.state.ballOwnerId,null);assert.ok(f.telemetry.contacts.some(c=>c.type==='shoulder-contact'&&c.racePursuit));
  for(const racer of f.state.players){assert.ok(racer.velocity.x>6.5);assert.equal(racer.locomotionState,'sprint');}
 }
});
test('parallel opponents resolve a rolling loose-ball race through physical control on either attacking direction',()=>{
 for(const direction of [1,-1]){
  const r=replayRace({direction});assert.equal(r.resolved,true);assert.ok(r.ticks<=90,JSON.stringify({ticks:r.ticks,last:r.rows.at(-1)}));
  assert.ok(r.contacts.length>0,'arrival has an actual shoulder contact');
  assert.ok(r.rows.every(f=>f.racers.every(p=>p.gait==='sprint')),'no approach gait downgrade');
 }
});
