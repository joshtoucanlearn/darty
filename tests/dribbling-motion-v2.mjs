import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const Ball=require('../match-engine/ball-engine-v2.js');
const Movement=require('../match-engine/movement-engine-v2.js');
const Dribble=require('../match-engine/dribbling-state-v2.js');
function carry(speed,control=80,requestPass=false){
 const cap=Dribble.createCapability({acknowledgement:Dribble.ACKNOWLEDGEMENT,workflow:'cpu-v-cpu',online:false});
 let state=Dribble.createState({phase:'secured-control',carrierId:'carrier',carrierTeamId:'you',logicalOwnerId:'carrier',nextTouchTick:1});
 let ball=Ball.createBallState({id:'b',position:{x:40.45,y:0,z:.11},velocity:{x:speed,y:0,z:0},regime:Ball.REGIMES.CONTROLLED,grounded:true});
 let context=Ball.createSimulationContext({seed:1}),max=0,releasedTick=null;
 for(let tick=1;tick<60;tick++){
  if(state.physicalSeparated){const step=Ball.step(ball,context,1/60);ball=step.state;context=step.context;}
  const x=40+speed*tick/60;
  const world=Movement.createWorldState({tick,bounds:{xMin:0,xMax:105,yMin:-34,yMax:34},ballOwnerId:'carrier',players:[
   {id:'carrier',teamId:'you',position:{x,y:0},velocity:{x:speed,y:0},facing:{x:1,y:0},radius:.34,locomotionState:speed>6?'sprint':'run'},
   {id:'marker',teamId:'opp',position:{x:90,y:20},velocity:{x:0,y:0},facing:{x:-1,y:0},radius:.34}
  ]});
  const actionIntent=requestPass&&releasedTick!==null&&tick===releasedTick+1?{id:'pass',type:'pass',actorId:'carrier',source:'human',commandTick:tick,power:.5}:null;
  const result=Dribble.resolve({schema:Dribble.REQUEST_SCHEMA,workflow:'cpu-v-cpu',online:false,tick,epoch:0,seed:1,fixedTickSeconds:1/60,
   state,movementWorld:world,ballState:ball,logicalOwnerId:'carrier',roster:[
    {id:'carrier',teamId:'you',attributes:{control,technique:control,agility:control}},
    {id:'marker',teamId:'opp',attributes:{control:70,technique:70,agility:70}}
   ],carrierInput:{source:'cpu',direction:{x:1,y:0},intensity:speed/8,sprint:speed>6,shield:false},surface:'dry',actionIntent,gate:{livePlay:true}},cap);
  state=result.state;ball=result.ballState;
  if(state.physicalSeparated){releasedTick??=tick;max=Math.max(max,Math.hypot(ball.position.x-x,ball.position.y));}
  if(['resecure','heavy-touch','turnover'].includes(state.phase))return{max,phase:state.phase,elapsed:tick-releasedTick,released:result.releasedAction};
 }
 throw new Error('touch failed to resolve');
}
test('actual moving Ball V2 separation grows from jogging close control to a pushed sprint touch',t=>{
 const jog=carry(3),sprint=carry(8);t.diagnostic(JSON.stringify({jog,sprint}));
 assert.equal(jog.phase,'resecure');assert.equal(sprint.phase,'resecure');
 assert.ok(sprint.max>jog.max*1.15,JSON.stringify({jog,sprint}));
 assert.ok(jog.max<.9&&sprint.max<1.2,JSON.stringify({jog,sprint}));
});
test('poor sprint control exposes a heavy physical ball while an input pass retains the earliest meeting',t=>{
 const poor=carry(8,20),good=carry(8,90),pass=carry(8,90,true);t.diagnostic(JSON.stringify({poor,good,pass}));
 assert.equal(poor.phase,'heavy-touch');assert.ok(poor.max>good.max);
 assert.equal(pass.phase,'resecure');assert.equal(pass.released?.type,'pass');assert.ok(pass.elapsed<=6,JSON.stringify(pass));
});
