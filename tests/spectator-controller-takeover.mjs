import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {attackingHost,liveScene} from './fixtures/attack-host-fixture.mjs';
const require=createRequire(import.meta.url);
const {create}=require('../match-engine/spectator-takeover.js');
const html=readFileSync(new URL('../match-engine/match.html',import.meta.url),'utf8');
const moduleSource=readFileSync(new URL('../match-engine/spectator-takeover.js',import.meta.url),'utf8');
const between=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)+a.length));
const pad=(index=0,id='DualSense Wireless Controller',mapping='standard')=>({index,id,mapping,connected:true,axes:[0,0,0,0],buttons:Array.from({length:18},()=>({pressed:false,value:0}))});
const press=(gp,i,on=true)=>{gp.buttons[i]={pressed:on,value:on?1:0};};
class Element{
  constructor(){this.children=[];this.style={};this.attributes={};this.hidden=false;this.textContent='';}
  append(...children){this.children.push(...children);}
  appendChild(child){this.append(child);return child;}
  setAttribute(key,value){this.attributes[key]=value;}
}
function uiFixture(){
  const document={head:new Element(),body:new Element(),createElement:()=>new Element()};
  let pads=[],blocked=false,ready=false,over=false,calls=0;
  const state={human:null,cpu:['you','opp'],handoffs:0,disconnects:0,reconnects:0,forwarded:0,paused:false};
  const mapping=vm.createContext({});
  vm.runInContext(between('  const isDualSenseDevice=', '  function updateGamepadHint()')+';this.pressed=gamepadButtonPressed;',mapping);
  const selector=create({document,navigator:{getGamepads(){calls++;if(blocked)throw new Error('Permissions Policy');return pads;}},pressed:mapping.pressed,
    canTakeOver:()=>ready,finished:()=>over,teams:{you:{name:'Ribble End',colour:'#7d1c2b',secondary:'#8ec6e8'},opp:{name:'Sherwood',colour:'#142d58',secondary:'#e5b64d'}},
    takeOver(side){state.handoffs++;state.human=side;state.cpu=side==='you'?['opp']:['you'];return true;},
    disconnect(){state.disconnects++;state.paused=true;},reconnect(){state.reconnects++;}});
  const listeners={};
  // Exercise the shipping connect/disconnect event -> host poll -> selector seam.
  const context={spectatorTakeover:selector,paused:false,gamepadInput:{previousButtons:[]},bindPadState(){},window:{},pollBoundPad(){state.forwarded++;},
    addEventListener:(name,fn)=>{listeners[name]=fn;},updateGamepadHint(){},gamepadButtonPressed:mapping.pressed};
  vm.runInNewContext(between('  function pollGamepad(){', "  addEventListener('focus'")+ ';this.poll=pollGamepad;',context);
  return{selector,document,state,listeners,poll:()=>context.poll(),setPads(value){pads=value;},block(){blocked=true;},ready(){ready=true;},over(){over=true;},calls:()=>calls,
    panel:()=>document.body.children.find(el=>el.id==='spectatorTakeover')};
}
function connect(f,gp){f.setPads([gp]);f.listeners.gamepadconnected({gamepad:gp});f.poll();}
function edge(f,gp,i){press(gp,i);f.poll();press(gp,i,false);f.poll();}

test('no controller has no prompt or host mutation; blocked/missing Gamepad API stays off',()=>{
  const f=uiFixture(),before=JSON.stringify(f.state);for(let i=0;i<120;i++)f.poll();
  assert.equal(f.calls(),120);assert.equal(f.panel(),undefined);assert.equal(f.document.head.children.length,0);assert.equal(JSON.stringify(f.state),before);
  f.block();assert.doesNotThrow(()=>f.poll());const blockedCalls=f.calls();for(let i=0;i<30;i++)f.poll();assert.equal(f.calls(),blockedCalls);assert.equal(f.panel(),undefined);
  const missing=create({navigator:{},document:f.document,finished:()=>false});assert.doesNotThrow(()=>missing.poll());
  assert.doesNotMatch(moduleSource.slice(moduleSource.indexOf('function poll()')),/Array\.from|\.filter\(|\.sort\(|\.map\(/,'empty polling must not create arrays');
});

test('connect shows real names and colours; dismiss, Options reopen and left/right selection',()=>{
  const f=uiFixture(),gp=pad();connect(f,gp);assert.equal(f.selector.status().mode,'choose');assert.equal(f.panel().hidden,false);
  const choices=f.panel().children[1];assert.equal(choices.children[0].children[1].textContent,'Home');assert.doesNotMatch(f.panel().textContent,/Ribble End/);
  assert.equal(choices.children[1].children[0].style.background,'#142d58');
  edge(f,gp,1);assert.equal(f.selector.status().mode,'dismissed');assert.match(f.panel().children[2].textContent,/Options/);
  edge(f,gp,9);assert.equal(f.selector.status().mode,'choose');edge(f,gp,15);assert.equal(f.selector.status().side,'opp');
  gp.axes[0]=-1;f.poll();assert.equal(f.selector.status().side,'you');gp.axes[0]=0;f.poll();
  assert.equal(f.state.handoffs,0);assert.equal(f.state.forwarded,0);
});

for(const side of ['you','opp'])test(`${side} confirmation waits for a stoppage and never forwards the confirm edge`,()=>{
  const f=uiFixture(),gp=pad();connect(f,gp);if(side==='opp')edge(f,gp,15);
  press(gp,0);f.poll();assert.equal(f.selector.status().mode,'waiting');assert.match(f.panel().children[0].textContent,/next stoppage/);
  assert.equal(f.state.human,null);f.ready();f.poll();assert.equal(f.state.human,side);assert.deepEqual(f.state.cpu,[side==='you'?'opp':'you']);
  for(let i=0;i<3;i++)f.poll();assert.equal(f.state.forwarded,0);assert.equal(f.state.handoffs,1);
  press(gp,0,false);f.poll();f.poll();assert.equal(f.state.forwarded,1);assert.equal(f.panel().hidden,true);
});

test('disconnect cancels a pending choice; an active side pauses and reconnects at a new slot without stealing a second pad',()=>{
  const f=uiFixture(),gp=pad();connect(f,gp);edge(f,gp,0);f.setPads([]);f.listeners.gamepaddisconnected({gamepad:gp});
  assert.equal(f.panel().hidden,true);f.ready();f.poll();assert.equal(f.state.handoffs,0);
  connect(f,gp);edge(f,gp,0);f.poll();f.poll();assert.equal(f.state.handoffs,1);
  const second=pad(1);f.setPads([second]);f.listeners.gamepaddisconnected({gamepad:gp});
  assert.equal(f.state.disconnects,1);assert.equal(f.state.paused,true);f.poll();assert.equal(f.state.reconnects,0);
  const again=pad(3);press(again,0);f.setPads([second,null,null,again]);f.listeners.gamepadconnected({gamepad:again});
  assert.equal(f.state.reconnects,1);const before=f.state.forwarded;f.poll();assert.equal(f.state.forwarded,before);
  press(again,0,false);f.poll();f.poll();assert.equal(f.state.forwarded,before+1);assert.equal(f.state.handoffs,1);
});

test('raw PS5 mapping uses Cross/Circle and the hat without a zeroed reconnect packet selecting a side',()=>{
  const f=uiFixture(),gp=pad(0,'54c-0ce6-Wireless Controller','');gp.axes=[0,0,0,0,0,0,0,0,0,0];connect(f,gp);
  assert.equal(f.selector.status().side,'you');gp.axes[9]=-.428571;f.poll();assert.equal(f.selector.status().side,'opp');gp.axes[9]=1.285714;f.poll();
  edge(f,gp,2);assert.equal(f.selector.status().mode,'dismissed');edge(f,gp,9);edge(f,gp,1);assert.equal(f.selector.status().mode,'waiting');
});

test('reconnect at the original browser slot restores the same human side',()=>{
  const f=uiFixture(),gp=pad();connect(f,gp);f.ready();edge(f,gp,0);f.poll();f.poll();
  f.setPads([]);f.listeners.gamepaddisconnected({gamepad:gp});assert.equal(f.state.disconnects,1);
  f.setPads([gp]);f.listeners.gamepadconnected({gamepad:gp});f.poll();f.poll();
  assert.equal(f.state.reconnects,1);assert.equal(f.selector.status().mode,'active');assert.equal(f.state.human,'you');assert.equal(f.state.handoffs,1);
});

function hostAtRestart(side){
  const host=attackingHost(91);
  host.scenario(liveScene+`restart('KICK OFF','${side}',W/2,H/2);resetUntil=0;`);
  return host;
}
for(const side of ['you','opp'])test(`real ${side} handover preserves score, clock, ball, roster and control runtime; V2 commits human input`,()=>{
  const host=hostAtRestart(side);
  const result=host.scenario(`(()=>{
    youScore=2;oppScore=1;clockFrames=1234;
    const runtime=liveV2ControlRuntime,clock=liveV2ControlTick,ballBefore=JSON.stringify(ball),roster=[...you,...opp].map(p=>[p.id,p.x,p.y,p.stamina]),oldAuthority=liveV2Authority;
    const gp=${JSON.stringify(pad())};const accepted=takeOverSpectatorSide('${side}',gp);
    return {accepted,human:teamHasHumanController('${side}'),cpu:!teamHasHumanController(other('${side}')),selected:controlled.team,
      auto:AUTO,two:twoPlayerEnabled,workflow:liveV2GameplayWorkflow,authorityChanged:oldAuthority!==liveV2Authority,
      clockPreserved:runtime===liveV2ControlRuntime&&clock===liveV2ControlTick&&clockFrames===1234,
      score:[youScore,oppScore],ballPreserved:ballBefore===JSON.stringify(ball),rosterPreserved:JSON.stringify(roster)===JSON.stringify([...you,...opp].map(p=>[p.id,p.x,p.y,p.stamina])),camera:cameraMode};
  })()`);
  assert.equal(result.accepted,true);assert.equal(result.human,true);assert.equal(result.cpu,true);assert.equal(result.selected,side);
  assert.equal(result.auto,false);assert.equal(result.two,false);assert.equal(result.workflow,'single-player');assert.equal(result.authorityChanged,true);
  assert.equal(result.clockPreserved,true);assert.equal(JSON.stringify(result.score),'[2,1]');assert.equal(result.ballPreserved,true);assert.equal(result.rosterPreserved,true);assert.equal(result.camera,'broadcast');
  const open=host.scenario(`(()=>{kickoffHeld=false;clearRestartState();clockRunning=true;ball.owner=controlled;ball.x=controlled.x;ball.y=controlled.y;
    const before=liveV2AuthorityTotals.lastCommittedTick;gamepadInput.moveX=.8;gamepadInput.moveMagnitude=.8;
    const snap=liveV2Snapshot(1),committed=liveV2RunTick();return{human:snap.humanPlayerIds,expected:controlled.id,committed,count:liveV2AuthorityTotals.lastCommittedTick-before,stopped:liveV2StrictStopped,failure:liveV2AttachFailure};})()`);
  assert.equal(JSON.stringify(open.human),JSON.stringify([open.expected]));assert.equal(open.committed,true,open.failure);assert.equal(open.count,1);assert.equal(open.stopped,false);
});

test('real Away switching, keeper input, restart aim and restart camera use the primary Quick Play path',()=>{
  const host=hostAtRestart('opp');
  const out=host.scenario(`(()=>{
    takeOverSpectatorSide('opp',${JSON.stringify(pad())});
    const kickTaker=controlled;completeRestart(opp[5]);const handover=controlled===opp[5];
    ball.owner=you[0];const previous=controlled;switchPlayer(true);const switched=controlled!==previous&&controlled.team==='opp';
    ball.owner=opp[8];updateAutoSwitch();const possession=controlled===opp[8];
    const keeper=penaltyKeeperHumanState(okeep)===gamepadInput&&penaltyKeeperHumanState(ykeep)===null;
    restart('FREE KICK','opp',W*.35,H/2);resetUntil=0;const before=setPieceAim.y;gamepadInput.aimX=.8;gamepadInput.aimMagnitude=.8;updateSetPieceAimControls();
    return{handover,switched,possession,keeper,aim:setPieceAim.y!==before,actor:controlled===restartTaker,
      camera:liveRestartCameraPreset('FREE KICK','opp'),otherCamera:liveRestartCameraPreset('FREE KICK','you')};
  })()`);
  for(const k of ['handover','switched','possession','keeper','aim','actor'])assert.equal(out[k],true,k);
  assert.equal(out.camera,'set-piece-special');assert.equal(out.otherCamera,'broadcast');
});

test('the real handover refuses live play and presentations, and controller polling is dormant without a pad',()=>{
  const host=attackingHost(91);
  const result=host.scenario(liveScene+`(()=>{const gp=${JSON.stringify(pad())},before=liveV2Authority;
    const live=takeOverSpectatorSide('you',gp);restart('KICK OFF','you',W/2,H/2);resetUntil=0;goalReplay.active=true;
    const replay=takeOverSpectatorSide('you',gp);goalReplay.active=false;
    return{live,replay,auto:AUTO,same:liveV2Authority===before};})()`);
  assert.equal(result.live,false);assert.equal(result.replay,false);assert.equal(result.auto,true);assert.equal(result.same,true);
  assert.match(html,/title\.textContent='Watch CPU v CPU or connect a controller\.'/);
  assert.match(html,/spectator:\(\)=>!spectatorTakeoverActive/);
  const video=readFileSync(new URL('../match-engine/darty-video-capture.js',import.meta.url),'utf8');
  assert.match(video,/hooks\.spectator.*!hooks\.spectator\(\)/);
});

test('every inline match script parses',()=>{
  for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(m[1].trim())new vm.Script(m[1]);
});

test('shipping selector wiring keeps the real CPU host untouched until confirm, then polls the single-player controls',()=>{
  const host=hostAtRestart('opp');
  const init=between("  if(AUTO&&!FAST&&!ONLINE_HOST",'  setCameraMode(cameraMode,false);');
  const events=between("  addEventListener('gamepadconnected',", "  addEventListener('focus'");
  host.scenario(`(()=>{const make=document.createElement;document.createElement=(...args)=>{const el=make(...args);el.append=(...items)=>items.forEach(item=>el.appendChild(item));return el;};window.__pads=[];window.__listeners={};addEventListener=(name,fn)=>window.__listeners[name]=fn;navigator.getGamepads=()=>window.__pads;})();`);
  host.scenario(moduleSource+'\n'+init+'\n'+events);
  const untouched=host.scenario(`(()=>{const before=JSON.stringify({ball,clockFrames,youScore,oppScore,controlled:controlled.id,events:report.events.length}),authority=liveV2Authority,children=document.body.children.length;
    for(let i=0;i<60;i++)pollGamepad();return{same:before===JSON.stringify({ball,clockFrames,youScore,oppScore,controlled:controlled.id,events:report.events.length}),authority:authority===liveV2Authority,dom:children===document.body.children.length,mode:spectatorTakeover.status().mode};})()`);
  assert.equal(untouched.same,true);assert.equal(untouched.authority,true);assert.equal(untouched.dom,true);assert.equal(untouched.mode,'hidden');
  const joined=host.scenario(`(()=>{const gp=${JSON.stringify(pad())};window.__pads=[gp];window.__listeners.gamepadconnected({gamepad:gp});pollGamepad();
    gp.buttons[15].pressed=true;pollGamepad();gp.buttons[15].pressed=false;pollGamepad();gp.buttons[0].pressed=true;pollGamepad();
    const afterConfirm=report.events.filter(e=>e.type==='controller-input').length;gp.buttons[0].pressed=false;pollGamepad();pollGamepad();
    return{team:primaryHumanTeam,mode:spectatorTakeover.status().mode,afterConfirm,passCharging:gamepadInput.passCharging,shotCharging:gamepadInput.shootCharging,index:gamepadInput.index};})()`);
  assert.equal(joined.team,'opp');assert.equal(joined.mode,'active');assert.equal(joined.afterConfirm,0);assert.equal(joined.passCharging,false);assert.equal(joined.shotCharging,false);assert.equal(joined.index,0);
  const disconnected=host.scenario(`(()=>{gamepadInput.passCharging=true;chargeAction='pass';chargeAmt=.7;window.__pads=[];window.__listeners.gamepaddisconnected();return{paused,charging:gamepadInput.passCharging,charge:chargeAction,mode:spectatorTakeover.status().mode};})()`);
  assert.equal(disconnected.paused,true);assert.equal(disconnected.charging,false);assert.equal(disconnected.charge,null);assert.equal(disconnected.mode,'disconnected');
  const resumed=host.scenario(`(()=>{const gp=${JSON.stringify(pad(3))};window.__pads=[null,null,null,gp];window.__listeners.gamepadconnected();pollGamepad();pollGamepad();gp.buttons[9].pressed=true;pollGamepad();return{paused,team:primaryHumanTeam,index:gamepadInput.index,mode:spectatorTakeover.status().mode};})()`);
  assert.equal(resumed.paused,false);assert.equal(resumed.team,'opp');assert.equal(resumed.index,3);assert.equal(resumed.mode,'active');
});

for(const side of ['you','opp'])test(`primary ${side} buttons retain passing, shooting, tackling and set-piece input`,()=>{
  const host=hostAtRestart(side);
  const out=host.scenario(`(()=>{
    takeOverSpectatorSide('${side}',${JSON.stringify(pad())});kickoffHeld=false;clearRestartState();
    const actor=primaryTeamList()[5];controlled=actor;ball.owner=actor;ball.x=actor.x;ball.y=actor.y;
    const pass=controllerPassDown();chargeAmt=.5;passChargeStartedAt=performance.now()-400;controllerPassUp();
    const passed=ball.lastKicker===actor&&ball.humanController===1&&(!ball.target||ball.target.team==='${side}');
    controlled=actor;actor.receiveT=0;ball.owner=actor;ball.x=actor.x;ball.y=actor.y;gamepadButtonDown(1);
    const shooting=gamepadInput.buttonActions[1]==='shoot'&&gamepadInput.shootCharging;
    shotChargeStartedAt=performance.now()-400;chargeAmt=.6;gamepadButtonUp(1);const shot=ball.shooter===actor&&ball.isShot;
    ball.owner=teamList(other(primaryHumanTeam))[0];gamepadButtonDown(1);const tackle=gamepadInput.buttonActions[1]==='tackle';cancelChargedActionsForPause();
    restart('CORNER','${side}',attackDirection('${side}')>0?W-M:M,10);resetUntil=0;
    const corner=controlled===restartTaker&&controllerPassDown()==='pass';cancelChargedActionsForPause();
    restart('GOAL KICK','${side}',attackDirection('${side}')>0?M+18:W-M-18,H/2);resetUntil=0;
    const goalKick=controlled===primaryKeeper()&&controlled===restartTaker&&controllerPassDown()==='pass';
    return{pass,passed,shooting,shot,tackle,corner,goalKick};
  })()`);
  assert.equal(out.pass,'pass');for(const key of ['passed','shooting','shot','tackle','corner','goalKick'])assert.equal(out[key],true,key);
});
