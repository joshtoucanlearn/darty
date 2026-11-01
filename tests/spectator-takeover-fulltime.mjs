import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,writeFileSync} from 'node:fs';
import {attackingHost} from './fixtures/attack-host-fixture.mjs';
import {countsAsFullTime} from '../tools/headless-cpu-match.mjs';

const html=readFileSync(new URL('../match-engine/match.html',import.meta.url),'utf8');
const selector=readFileSync(new URL('../match-engine/spectator-takeover.js',import.meta.url),'utf8');
const init=html.slice(html.indexOf('  if(AUTO&&!FAST&&!ONLINE_HOST'),html.indexOf('  setCameraMode(cameraMode,false);',html.indexOf('  if(AUTO&&!FAST&&!ONLINE_HOST')));
// Three ordinary match-clock request points, each independently replayed on
// both sides. Two-minute matches use the shipping duration option, not FAST.
// Default 3 seeds (18 cases) so the ordinary suite stays quick; the 1 Nov qualification ran all 20:
// DARTY_TAKEOVER_SEEDS=1,2,...,20 (120 cases, 120/120 full time, median wait 0.70 s, p95 5.87 s).
const seeds=(process.env.DARTY_TAKEOVER_SEEDS||'1,2,3').split(',').map(Number);
const rows=[];
for(const seed of seeds)for(const minute of [8,42,78])for(const side of ['you','opp'])test(`full-time takeover seed=${seed} minute=${minute} side=${side}`,()=>{
  const host=attackingHost(seed,{minutes:2});
  host.scenario(`(()=>{
    window.__trainVisibilityEnabled=false; // Skip the runner's observational camera-frustum sampler.
    const make=document.createElement;document.createElement=(...args)=>{const el=make(...args);el.append=(...items)=>items.forEach(item=>el.appendChild(item));return el;};
    window.__pad={index:0,id:'DualSense Wireless Controller (STANDARD GAMEPAD)',mapping:'standard',connected:true,axes:[0,0,0,0],buttons:Array.from({length:18},()=>({pressed:false,value:0}))};
    navigator.getGamepads=()=>[window.__pad];
  })();`+selector+'\n'+init);
  host.scenario(`(()=>{
    const requestedMinute=${minute},side='${side}',gp=window.__pad,realUpdate=update,realTakeOver=takeOverSpectatorSide;
    let ticks=0,requestStage=0,confirmed=null;
    window.__takeoverResult=null;
    takeOverSpectatorSide=function(team,pad){
      const control=liveV2ControlRuntime,controlTick=liveV2ControlTick,score=[youScore,oppScore],clock=clockFrames,
        ballState=JSON.stringify([ball.x,ball.y,ball.z,ball.vx,ball.vy,ball.zv,ball.owner?.id,ball.target?.id]),
        players=JSON.stringify([...you,...opp,ykeep,okeep].map(p=>[p.id,p.x,p.y,p.vx,p.vy,p.stamina,p.stats])),
        expected=kickoffHeld&&restartTaker.team===team?restartTaker:ball.owner?.team===team?ball.owner:bestSwitchCandidateForTeam(team),
        at=kickoffHeld?'held-restart':'settled-possession',ownerTeam=ball.owner?.team;
      const accepted=realTakeOver(team,pad);
      window.__takeoverResult={accepted,at,ownerTeam,waitSeconds:(performance.now()-confirmed)/1000,
        preserved:control===liveV2ControlRuntime&&controlTick===liveV2ControlTick&&clock===clockFrames&&score[0]===youScore&&score[1]===oppScore&&
          ballState===JSON.stringify([ball.x,ball.y,ball.z,ball.vx,ball.vy,ball.zv,ball.owner?.id,ball.target?.id])&&
          players===JSON.stringify([...you,...opp,ykeep,okeep].map(p=>[p.id,p.x,p.y,p.vx,p.vy,p.stamina,p.stats])),
        selected:controlled===expected,human:teamHasHumanController(team),cpu:!teamHasHumanController(other(team)),workflow:liveV2GameplayWorkflow};
      return accepted;
    };
    // Rebind the shipping selector so its callback includes the observation.
    spectatorTakeover=null;
    ${init}
    update=function(){
      ticks++;
      for(const b of gp.buttons){b.pressed=false;b.value=0;}
      if(!spectatorTakeoverActive&&clockFrames>=MATCH_FRAMES*requestedMinute/90){
        if(requestStage===0){if(side==='opp')gp.buttons[15].pressed=true;requestStage++;}
        else if(requestStage===1)requestStage++;
        else if(requestStage===2){gp.buttons[0].pressed=true;confirmed=performance.now();requestStage++;}
      }else if(spectatorTakeoverActive){
        // An idle human who passes/restarts with the real controller path.
        // Never change AUTO, the clock, ball, scene, or CPU decisions.
        gp.buttons[0].pressed=ticks%90>=30&&ticks%90<54;
      }
      pollGamepad();realUpdate();
    };
  })()`);
  let ticks=0,state;
  const cap=60*900;
  for(;ticks<cap;ticks++){
    host.step();
    if(ticks%120===0){state=host.state();if(state.phase==='ended'||state.authority.failureCode)break;}
  }
  state=host.state();
  const result=host.scenario(`({...window.__takeoverResult,finalHuman:teamHasHumanController('${side}'),finalCpu:!teamHasHumanController(other('${side}')),stopped:liveV2StrictStopped})`);
  const row={seed,minute,side,...result,fullTime:countsAsFullTime(state,{capped:ticks>=cap}),ticks,score:[...state.score],failure:state.authority.failure,
    maxCommitWait:state.progress.maximumLiveTicksWithoutCommit,abandoned:state.matchAbandoned,capped:ticks>=cap};
  rows.push(row);console.log(JSON.stringify(row));
  if(row.failure)console.log('TAKEOVER_FAULT_STATE '+JSON.stringify(host.scenario(`(()=>{const snapshot=liveV2Snapshot(liveV2Tick+1);return{snapshot,controlled:controlled&&{id:controlled.id,action:controlled.action,receiveT:controlled.receiveT,stun:controlled.stun,aerialCommand:controlled.aerialCommand,aerialCommandUntil:controlled.aerialCommandUntil},clockFrames};})()`)));
  assert.equal(row.fullTime,true,JSON.stringify(row));
  for(const key of ['accepted','preserved','selected','human','cpu','finalHuman','finalCpu'])assert.equal(row[key],true,key+' '+JSON.stringify(row));
  assert.equal(row.workflow,'single-player');assert.equal(row.stopped,false);
});
test('wait distribution from confirmation to the actual host swap (60 Hz real elapsed seconds)',()=>{
  assert.equal(rows.length,seeds.length*6);
  const waits=rows.map(r=>r.waitSeconds).sort((a,b)=>a-b);
  const summary={matches:rows.length,seeds:seeds.length,medianSeconds:(waits[(waits.length-1)>>1]+waits[waits.length>>1])/2,
    p95Seconds:waits[Math.ceil(waits.length*.95)-1],maxSeconds:waits.at(-1),openPlay:rows.filter(r=>r.at==='settled-possession').length,
    cpuPossession:rows.filter(r=>r.at==='settled-possession'&&r.ownerTeam!==r.side).length,
    measurement:'Fixed 60 Hz host elapsed time including presentations; not accelerated test-process execution time.'};
  console.log('TAKEOVER_WAIT_SUMMARY '+JSON.stringify(summary));
  if(process.env.DARTY_TAKEOVER_REPORT)writeFileSync(process.env.DARTY_TAKEOVER_REPORT,JSON.stringify({summary,rows},null,2)+'\n');
  assert.ok(summary.openPlay>0,'must exercise real open-play swaps');
  assert.ok(summary.cpuPossession>0,'must exercise joining the defending team');
});
