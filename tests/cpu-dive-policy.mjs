import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),CPU=require('../match-engine/cpu-intelligence-v2.js'),Control=require('../match-engine/live-v2-match-control-composition.js');
const base={seed:1,tick:3000,playerId:'rated-diver',minute:40,lastAttemptMinute:0,
 physicallyEligible:true,ownsBall:true,defenderDistanceMetres:4,progress:.75,inPenaltyArea:false,
 attributes:{flair:75,diving:70,composure:70,awareness:70},roll:0};
test('rated CPU dive cadence and quality remain continuous and do not decide the referee outcome',()=>{
 let previous=-1;
 for(let rating=1;rating<=99;rating++){
  const p=CPU.planCpuDive({...base,attributes:{flair:rating,diving:rating,composure:70}});
  assert.ok(p.chance>=previous);previous=p.chance;assert.ok(p.chance>0);
  assert.equal('decision' in p,false);assert.equal('refereeOutcome' in p,false);
 }
 assert.equal(CPU.planCpuDive({...base,physicallyEligible:false}).selected,false);
 assert.equal(CPU.planCpuDive({...base,ownsBall:false}).selected,false);
 const old=CPU.planCpuDive({...base,lastAttemptMinute:39}),ready=CPU.planCpuDive(base);
 assert.ok(ready.chance>old.chance*1000);
});
test('all three existing CPU performances remain real candidates and theatrical profiles favour rolling',()=>{
 const seen=new Set();let rolling=0;
 for(let i=0;i<1000;i++){
  const p=CPU.planCpuDive({...base,attributes:{flair:95,diving:90,composure:55},performanceRoll:i/1000});
  seen.add(p.performance);rolling+=p.performance==='rolling';
 }
 assert.deepEqual([...seen].sort(),['flop','rolling','subtle']);assert.ok(rolling>750);
 const box=CPU.planCpuDive({...base,inPenaltyArea:true});assert.ok(box.chance>=CPU.planCpuDive(base).chance);
});
test('period protection follows pending scenes, real goal threats and projected physical contacts',()=>{
 for(const key of['sceneActive','decisionPending','activeDive','penaltyPending','physicalActionPending'])assert.equal(Control.periodEndProtection({[key]:true}),true);
 const ball={owned:false,shotOrRebound:true,x:95,y:2,vx:15,vy:0,direction:1};
 assert.equal(Control.periodEndProtection({ball}),true);
 assert.equal(Control.periodEndProtection({ball:{...ball,vx:0}}),false);
 assert.equal(Control.periodEndProtection({ball:{...ball,x:106}}),false);
 assert.equal(Control.periodEndProtection({ball:{...ball,y:20}}),false);
 assert.equal(Control.periodEndProtection({ball:{...ball,owned:true}}),false);
 assert.equal(Control.periodEndProtection({ball:{...ball,x:10,vx:-15,direction:-1}}),true);
});
test('a genuine box moment remains rated after a recent team attempt, including low-profile players',()=>{
 const recent={...base,inPenaltyArea:true,defenderDistanceMetres:2,minute:40,lastAttemptMinute:39};
 const low=CPU.planCpuDive({...recent,attributes:{diving:1,flair:1,composure:70}}),
  high=CPU.planCpuDive({...recent,attributes:{diving:99,flair:99,composure:70}});
 assert.ok(low.chance>0);assert.ok(high.chance>low.chance);assert.ok(high.chance>.01);
 assert.equal(CPU.planCpuDive({...recent,inPenaltyArea:false}).chance,0,'no nearby challenge or box moment means no artificial dive opportunity');
});
