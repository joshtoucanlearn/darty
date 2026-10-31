import test from 'node:test';
import assert from 'node:assert/strict';
import {attackingHost,liveScene} from './fixtures/attack-host-fixture.mjs';
test('a defending high-ball challenger turns toward the incoming ball while closing its MR intercept',()=>{
 const h=attackingHost(702);
 h.scenario(`(()=>{${liveScene}
  lastAICpuDiveScanFrame=Infinity;const sx=(W-2*M)/105,sy=H/68,sz=PITCH_UNITS_PER_METRE,
   put=(p,x,y)=>Object.assign(p,{x:M+x*sx,y:H/2+y*sy,vx:0,vy:0,fx:p.team==='you'?1:-1,fy:0,receiveT:0,stun:0});
  you.forEach((p,i)=>put(p,30,-30+i*2));opp.forEach((p,i)=>put(p,93,-30+i*2));
  put(ykeep,2,-20);put(okeep,103,20);const source=you[8],attacker=you[9],defender=opp[0];
  put(source,70,0);put(attacker,87,1);put(defender,88,0);defender.fx=1;defender.fy=0;
  Object.assign(defender.attrs,{awareness:99,agility:99,balance:99,defend:99});
  Object.assign(ball,{owner:null,target:attacker,x:M+78*sx,y:H/2,z:4*sz,vx:14*sx/60,vy:0,zv:1*sz/60,
   isShot:false,shooter:null,flightType:'cross',lastKicker:source,aerialSource:source,flightAge:25,cool:0,kickerLock:0});
  window.__airDefender=defender;window.__airReads=[];const authority=liveV2Authority;
  liveV2Authority={...authority,planTick(s){const f=authority.planTick(s);
   if(f?.hostProjection.recoveryAssignments?.some(r=>r.playerId===defender.id&&r.authority==='v2-high-ball-contest'))
    window.__airReads.push({row:f.hostProjection.movement.find(p=>p.id===defender.id),ball:{x:ball.x,y:ball.y}});
   return f;}};
 })()`);
 for(let i=0;i<48;i++)h.step();
 const result=h.scenario(`({reads:window.__airReads.map(r=>{const dx=r.ball.x-r.row.x,dy=r.ball.y-r.row.y,d=Math.hypot(dx,dy)||1;
  return {access:(dx*r.row.fx+dy*r.row.fy)/d,speed:Math.hypot(r.row.vx,r.row.vy)};}),events:report.events.filter(e=>e.type==='v2-aerial-duel')})`);
 assert.equal(h.state().authority.failureCode,null);assert.ok(result.reads.length>0,JSON.stringify(result));
 assert.ok(result.reads.some(r=>r.access>.3),'the defender reads the real ball instead of planting facing away '+JSON.stringify(result));
 console.log('SCRIPTED_DEFENDING_AERIAL_READ',JSON.stringify({readFrames:result.reads.length,bestBallAccess:Math.max(...result.reads.map(r=>r.access)),contacts:result.events.length,contested:result.events.filter(e=>e.contested).length}));
});

test('the shared momentum path can look back at an incoming ball while continuing toward its intercept',async()=>{
 const {createRequire}=await import('node:module'),require=createRequire(import.meta.url),M=require('../match-engine/movement-engine-v2.js');
 let world=M.createWorldState({players:[{id:'challenger',teamId:'home',position:{x:0,y:0},velocity:{x:5,y:0},facing:{x:1,y:0},attributes:{agility:90,balance:90}}]});
 for(let tick=1;tick<=90;tick++)world=M.advance(world,[{id:'look-back-'+tick,tick,playerId:'challenger',type:'move',move:{x:1,y:0},facing:{x:-1,y:0},directionalSteering:true,mode:'run',intensity:.8}],1).state;
 const player=world.players[0];assert.ok(player.position.x>3,'the same momentum path still closes the intercept');
 assert.ok(player.facing.x<-.9,'a supplied independent receiving facing is honoured at the existing rated turn speed');
});
