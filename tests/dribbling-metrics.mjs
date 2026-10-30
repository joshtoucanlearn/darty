import test from 'node:test';
import assert from 'node:assert/strict';
import {createCombinationMetrics} from '../tools/combination-metrics.mjs';
test('a take-on win requires beating the named opponent, and counts only once',()=>{
 const m=createCombinationMetrics();m.event({type:'ai-take-on-attempt',actorId:'carrier',team:'you',defenderId:'marker',time:0,progress:.5});
 m.possession({id:'carrier',team:'you',time:1000,progress:.53,y:34,defenderBehind:true,defenders:{marker:1}},true);
 assert.equal(m.snapshot().counts.takeOnsWon,0);
 m.possession({id:'carrier',team:'you',time:1100,progress:.54,y:34,defenders:{marker:-1}},true);
 m.possession({id:'carrier',team:'you',time:1200,progress:.55,y:34,defenders:{marker:-2}},true);
 assert.equal(m.snapshot().counts.takeOnsWon,1);
});
test('directional receiving reports keeping, the next action and its one-second window',()=>{
 const m=createCombinationMetrics();m.event({type:'reception',intent:'directional-touch',actorId:'receiver',team:'you',time:0,progress:.5,cpu:true});
 m.possession({id:'receiver',team:'you',time:200,progress:.5,y:34},true);
 m.event({type:'shot',actorId:'receiver',team:'you',time:900});
 const c=m.snapshot().counts;assert.equal(c.directionalFirstTouches,1);assert.equal(c.directionalKept,1);assert.equal(c.directionalToShot,1);assert.equal(c.nextActionWithinOneSecond,1);
});
test('an exposed directional touch can be lost, and a knock-on must be physically recovered with progress',()=>{
 const m=createCombinationMetrics();m.event({type:'reception',intent:'directional-touch',actorId:'receiver',team:'you',time:0,progress:.5,cpu:true});
 m.possession({id:'opponent',team:'opp',time:300,progress:.6,y:34},true);
 assert.equal(m.snapshot().counts.directionalLost,1);
 m.event({type:'directional-knock-on',actorId:'runner',team:'you',time:500,progress:.5,cpu:true});
 m.possession({id:'runner',team:'you',time:1500,progress:.54,y:34},true);
 assert.equal(m.snapshot().counts.knockOns,1);assert.equal(m.snapshot().counts.knockOnsWon,1);assert.equal(m.snapshot().counts.knockOnNextActionWithinOneSecond,1);
});

test('legacy selection plus attempt is one take-on, and a legacy result cannot double-count a physical win',()=>{
 const m=createCombinationMetrics(),e={actorId:'runner',team:'you',defenderId:'marker',time:0,progress:.5};
 m.event({...e,type:'ai-skill-selection'});m.event({...e,type:'ai-take-on-attempt'});
 m.possession({id:'runner',team:'you',time:1000,progress:.54,y:34,defenders:{marker:-1}},true);
 m.event({...e,type:'ai-take-on-result',outcome:'defender-eliminated'});
 assert.equal(m.snapshot().counts.takeOns,1);assert.equal(m.snapshot().counts.takeOnsWon,1);
});
