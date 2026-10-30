import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombinationMetrics } from '../tools/combination-metrics.mjs';
test('switch and cross counters require a real release and resolved completion; misses are excluded from headers', () => {
  const m=createCombinationMetrics();
  m.event({type:'pass',team:'you',actorId:'a',targetId:'b',time:0,progress:.8,inBox:false,distanceMetres:32,flightType:'cross'});
  m.event({type:'v2-pass-decision',reason:'switch-congested-side'});
  m.event({type:'pass-resolved',completed:true,receiverId:'b',progress:.9,inBox:true,time:1200});
  m.event({type:'v2-aerial-contact',technique:'header',outcome:'miss'});
  m.event({type:'v2-aerial-contact',technique:'header',outcome:'contact'});
  m.event({type:'shot',team:'you',actorId:'b',time:1400});
  assert.equal(m.snapshot().counts.switches,1);assert.equal(m.snapshot().counts.switchesCompleted,1);
  assert.equal(m.snapshot().counts.crosses,1);assert.equal(m.snapshot().counts.crossesCompleted,1);
  assert.equal(m.snapshot().counts.boxEntries,1);assert.equal(m.snapshot().counts.headers,1);
  assert.equal(m.snapshot().counts.shotsFromCrosses,1);
  m.event({type:'shot',team:'you',actorId:'c',time:1500});
  assert.equal(m.snapshot().counts.shotsFromCrosses,1,'an unrelated shot is not credited to the cross');
});
test('engaged take-ons require real progression past the challenged defender; carries need ten metres', () => {
  const m=createCombinationMetrics(),owner={id:'a',team:'you',progress:.5,y:34,time:0};
  m.event({type:'skill-utility',cpu:true,engaged:true,actorId:'a',team:'you',defenderId:'d',time:0,progress:.5});
  assert.equal(m.takeOnDefenderId(),'d');
  m.possession(owner,true);
  m.possession({...owner,time:1000,progress:.54,defenderBehind:false},true);
  assert.equal(m.snapshot().counts.takeOnsWon,0);
  m.possession({...owner,time:1200,progress:.55,defenderBehind:true},true);
  assert.equal(m.snapshot().counts.takeOnsWon,1);
  assert.equal(m.snapshot().counts.progressiveCarries,0);
  m.possession({...owner,time:2000,progress:.6},true);
  m.possession({...owner,time:2200,progress:.62},true);
  assert.equal(m.snapshot().counts.progressiveCarries,1);
  m.possession(null,false);m.possession({...owner,time:2400,progress:.9},true);
  assert.equal(m.snapshot().counts.progressiveCarries,1,'dead balls reset carry distance');
});
test('dispossessions exclude interceptions of a released pass and box slots count activations rather than every frame', () => {
  const m=createCombinationMetrics(),owner={id:'a',team:'you',progress:.5,y:34,time:0};
  m.possession(owner,true);m.possession({id:'d',team:'opp',progress:.5,y:34,time:100},true);
  assert.equal(m.snapshot().counts.dispossessions,1);
  m.event({type:'pass',team:'opp',actorId:'d',targetId:'e',time:200,progress:.5,distanceMetres:8});
  m.possession(null,true);m.event({type:'pass-resolved',completed:false});m.possession(owner,true);
  assert.equal(m.snapshot().counts.dispossessions,1);
  for(const type of ['shot','headed-pass','clearance']){
    m.possession(null,false);m.possession(owner,true);
    m.event({type,team:'you',actorId:'a',time:220});m.possession(null,true);
    m.possession({id:'d',team:'opp',progress:.5,y:34,time:300},true);
    assert.equal(m.snapshot().counts.dispossessions,1,`${type} is an intentional release, not a carry dispossession`);
  }
  m.frame({you:{supportIntents:[{playerId:'a',type:'box-near-post'},{playerId:'b',type:'box-far-post'}]}});
  m.frame({you:{supportIntents:[{playerId:'a',type:'box-penalty-spot'},{playerId:'b',type:'box-far-post'}]}});
  assert.equal(m.snapshot().counts.boxSlotRuns,2);
});

test('aerial duels count real contested winners and the following second-ball recovery once',()=>{
  const m=createCombinationMetrics();
  m.event({type:'v2-aerial-duel',contested:true,winnerTeamId:'opp',sourceTeam:'you',technique:'header',controlled:false,time:0});
  m.possession({id:'d',team:'opp',progress:.4,y:34,time:1000},true);
  m.possession({id:'d',team:'opp',progress:.42,y:34,time:1100},true);
  let c=m.snapshot().counts;
  assert.equal(c.aerialDuelsContested,1);assert.equal(c.defendingAerialWins,1);assert.equal(c.aerialWinsOpp,1);
  assert.equal(c.aerialSecondBallsOpp,1);
  m.event({type:'v2-aerial-duel',contested:false,winnerTeamId:'you',sourceTeam:'you',technique:'header',controlled:false,time:1200});
  m.possession(null,false);
  m.possession({id:'a',team:'you',progress:.5,y:34,time:1500},true);
  assert.equal(m.snapshot().counts.aerialSecondBallsYou,0,'dead ball clears a pending recovery');
  m.event({type:'v2-aerial-duel',contested:true,winnerTeamId:'you',sourceTeam:'opp',technique:'chest-control',controlled:true,time:1600});
  m.possession({id:'a',team:'you',progress:.5,y:34,time:1600},true);
  c=m.snapshot().counts;assert.equal(c.chestControls,1);assert.equal(c.aerialDuelsContested,2);
  assert.equal(c.aerialWinsYou,1);assert.equal(c.aerialContacts,3);assert.equal(c.aerialSecondBallsYou,0,'a controlled chest is the duel contact, not a second ball');
});
