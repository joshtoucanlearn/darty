import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import vm from 'node:vm';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const onlineApp = read('online/app.js');
const matchHtml = read('match-engine/match.html');
let passed = 0;
const check = (condition, message) => { assert.ok(condition, message); passed += 1; };

check(onlineApp.includes("const BUILD='172'"), 'Online quality work must use a new incompatible room build');
check(matchHtml.includes('getOnlineStream:(fps=60)'), 'The match stream must request 60 fps by default');
check(onlineApp.includes('getOnlineStream(60)'), 'The host must start at 60 fps');
check((onlineApp.match(/id:'[^']+',label:'[^']+',fps:/g) || []).length === 4, 'Adaptive transport must expose four bounded quality profiles');
check(onlineApp.includes('maxBitrate:profile.bitrate,maxFramerate:profile.fps,scaleResolutionDownBy:profile.scale'), 'Each quality tier must constrain bitrate, frame rate and resolution together');
check(onlineApp.includes("report.type==='remote-inbound-rtp'"), 'Adaptation must read remote loss and round-trip evidence');
check(onlineApp.includes("report.type==='candidate-pair'"), 'Adaptation must read the active network route');
check(onlineApp.includes('transportBadSamples>=2'), 'One bad measurement must not immediately degrade the stream');
check(onlineApp.includes('transportGoodSamples>=6'), 'Quality recovery must use stronger hysteresis than degradation');
check(onlineApp.includes('buffered<65536'), 'Controller packets must not create an unbounded reliable-channel backlog');
check(onlineApp.includes("instance.reconnect()"), 'Peer signalling must attempt a safe reconnect');
check(onlineApp.includes("scheduleHostMediaRecovery('media-error')"), 'Host media failure must redial instead of immediately ending the match');
check(onlineApp.includes("requestGuestMediaRecovery('media-close')"), 'Away media closure must request a replacement stream');
check(onlineApp.includes("setConnection('connecting','Away reconnecting · match paused')"), 'A host-side data interruption must pause safely for Away');
check(!onlineApp.includes("fail('Match connection lost'"), 'A transient match data interruption must not instantly become fatal');

class Emitter {
  constructor(){this.listeners=new Map()}
  on(type,listener){const list=this.listeners.get(type)||[];list.push(listener);this.listeners.set(type,list);return this}
  emit(type,...args){for(const listener of this.listeners.get(type)||[])listener(...args)}
}
class FakeConnection extends Emitter {
  constructor(peer,metadata={}){super();this.peer=peer;this.metadata=metadata;this.open=false;this.sent=[]}
  emit(type,...args){if(type==='open')this.open=true;if(type==='close')this.open=false;super.emit(type,...args)}
  send(message){this.sent.push(message)}
  close(){this.open=false}
}
class FakeElement {
  constructor(id,replacements){
    this.id=id;this.hidden=false;this.dataset={};this.style={};this.classList={toggle(){}};this.textContent='';this.value='';this.selectionStart=0;this.listeners=new Map();this.span={textContent:''};
    this.contentWindow={postMessage(){},location:{href:'about:blank',replace:value=>{replacements.push(String(value));this.contentWindow.location.href=String(value)}}};
  }
  addEventListener(type,listener){const list=this.listeners.get(type)||[];list.push(listener);this.listeners.set(type,list)}
  dispatch(type,event={}){event.preventDefault ||= ()=>{};for(const listener of this.listeners.get(type)||[])listener(event)}
  querySelector(selector){return selector==='span'?this.span:null}
  focus(){}
  setCustomValidity(){}
  reportValidity(){}
  setSelectionRange(){}
}

const replacements=[];
const elements=new Map();
const node=id=>{if(!elements.has(id))elements.set(id,new FakeElement(id,replacements));return elements.get(id)};
for(const id of ['entryScreen','waitingScreen','gameStage','gameFrame','guestStage','matchVideo','videoGate','guestMessage','connectionPill','networkStatus','networkRole','networkLatency','roomCodeBlock','roomCode','waitingEyebrow','waitingTitle','waitingCopy','joinForm','roomInput','fatalCard','fatalTitle','fatalCopy','remoteEvent','remoteOfficial','remoteVar','remoteSetPiece','remotePlayerCard','remotePowerFill','remotePowerIdeal','remoteStateOverlay','hostButton','showJoinButton','copyCode','cancelButton','retryButton'])node(id);
node('waitingScreen').hidden=node('gameStage').hidden=node('guestStage').hidden=node('joinForm').hidden=node('fatalCard').hidden=true;
const intervals=new Map(),timeouts=new Map(),globalListeners=new Map();
let timerId=0;
const peers=[];
class FakePeer extends Emitter {
  constructor(id){super();this.id=id;this.destroyed=false;this.reconnects=0;peers.push(this)}
  reconnect(){this.reconnects+=1}
  destroy(){this.destroyed=true}
  call(){return null}
}
const location={href:'https://example.test/football-legacy/online/index.html',origin:'https://example.test',search:''};
const context={
  window:null,document:{body:node('body'),getElementById:node},location,navigator:{getGamepads:()=>[],clipboard:{writeText:async()=>{}}},crypto:webcrypto,performance,URL,URLSearchParams,Peer:FakePeer,console,
  requestAnimationFrame:()=>1,
  setInterval:(fn)=>{const id=++timerId;intervals.set(id,fn);return id},clearInterval:id=>intervals.delete(id),
  setTimeout:(fn)=>{const id=++timerId;timeouts.set(id,fn);return id},clearTimeout:id=>timeouts.delete(id),
  addEventListener:(type,listener)=>{const list=globalListeners.get(type)||[];list.push(listener);globalListeners.set(type,list)}
};
context.window=context;
vm.runInNewContext(onlineApp,context,{filename:'online/app.js'});
const rawButtons=Array.from({length:18},()=>({pressed:false,value:0}));
rawButtons[0]={pressed:true,value:1};
const normalisedPad=context.FLOnlineDebug.serialisePad({id:'54c-0ce6-Wireless Controller',mapping:'',connected:true,index:0,axes:[0,0,0,0,0,0,0,0,0,.142857],buttons:rawButtons});
check(normalisedPad.mapping==='standard', 'A remote Firefox DualSense must be normalised before crossing the peer link');
check(normalisedPad.buttons[2].pressed&&!normalisedPad.buttons[0].pressed, 'Remote Firefox Square/Cross must retain the corrected logical layout');
check(normalisedPad.buttons[13].pressed, 'Remote Firefox hat-axis D-pad Down must become the standard dive button');
const switchButtons=Array.from({length:18},()=>({pressed:false,value:0}));
switchButtons[0]={pressed:true,value:1};
switchButtons[13]={pressed:true,value:1};
const normalisedSwitch=context.FLOnlineDebug.serialisePad({id:'Nintendo Switch Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)',mapping:'standard',connected:true,index:1,axes:[.5,0,0,0],buttons:switchButtons});
check(normalisedSwitch.mapping==='standard'&&/Nintendo Switch/.test(normalisedSwitch.id), 'A Nintendo controller keeps its browser standard mapping and device identity online');
check(normalisedSwitch.buttons[0].pressed&&normalisedSwitch.buttons[13].pressed, 'Nintendo B and D-pad Down retain their physical standard indices across the peer link');
node('hostButton').dispatch('click');
const peer=peers.at(-1);
peer.emit('open');
const connection=new FakeConnection('away',{protocol:'football-legacy-online-v1',build:'172',role:'guest'});
peer.emit('connection',connection);
connection.emit('open');
for(const callback of [...intervals.values()])callback();
check(replacements.length===1, 'Firefox about:blank detection must retry the setup frame automatically');
check(replacements[0].includes('build=172-online-quality-1'), 'Firefox recovery must reload the exact current lobby build');
check(location.href==='https://example.test/football-legacy/online/index.html', 'Frame recovery must preserve the live room page');
const frame=node('gameFrame');
for(const listener of globalListeners.get('message')||[])listener({source:frame.contentWindow,origin:location.origin,data:{source:'football-legacy-online-child',type:'child-ready'}});
for(const callback of [...intervals.values()])callback();
check(replacements.length===1, 'A ready child must cancel further Firefox recovery attempts');
peer.emit('disconnected');
check(peer.reconnects===1, 'Peer signalling disconnect must invoke PeerJS reconnect exactly once');

console.log(`online quality and stability: ${passed}/${passed} checks passed`);
