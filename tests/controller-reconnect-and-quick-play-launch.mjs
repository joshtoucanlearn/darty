import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const controllerSource=read('controller-ui.js');
const quickPlaySource=read('quick-play/app.js');
const quickPlayHtml=read('quick-play/index.html');
const onlineSource=read('online/app.js');
let passed=0;
const check=(condition,message)=>{assert.ok(condition,message);passed+=1};

class FakeElement{
  constructor(tagName='DIV'){
    this.tagName=tagName;
    this.isConnected=true;
    this.dataset={};
    this.className='';
    this.textContent='';
    this.children=[];
    this.attributes=new Map();
    this.classList={add:()=>{},remove:()=>{},contains:()=>false};
    this.clicks=0;
  }
  querySelectorAll(){return this.tagName==='BODY'?[focusButton]:[]}
  querySelector(){return null}
  matches(selector){return this===focusButton&&selector.includes('[data-controller-default]')}
  closest(){return null}
  getBoundingClientRect(){return{left:0,right:120,top:0,bottom:40,width:120,height:40}}
  setAttribute(name,value){this.attributes.set(name,String(value))}
  removeAttribute(name){this.attributes.delete(name)}
  hasAttribute(name){return this.attributes.has(name)}
  focus(){}
  scrollIntoView(){}
  click(){this.clicks+=1}
  appendChild(child){this.children.push(child);return child}
}

const focusButton=new FakeElement('BUTTON');
focusButton.dataset.controllerDefault='true';
const body=new FakeElement('BODY');
const head=new FakeElement('HEAD');
const byId=new Map();
body.appendChild=child=>{body.children.push(child);if(child.id)byId.set(child.id,child);return child};
const document={
  body,head,documentElement:new FakeElement('HTML'),
  querySelector:()=>null,
  querySelectorAll:()=>[],
  getElementById:id=>byId.get(id)||null,
  createElement:tag=>new FakeElement(String(tag).toUpperCase())
};
const listeners=new Map();
const context={
  window:null,document,navigator:{getGamepads:()=>[]},performance:{now:()=>100},console,
  MutationObserver:class{observe(){}},
  getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),
  addEventListener:(type,listener)=>{const rows=listeners.get(type)||[];rows.push(listener);listeners.set(type,rows)},
  requestAnimationFrame:()=>1,setTimeout:()=>1,clearTimeout:()=>{}
};
context.window=context;
vm.runInNewContext(controllerSource,context,{filename:'controller-ui.js'});

const buttons=pressedIndex=>Array.from({length:20},(_,index)=>({pressed:index===pressedIndex,value:index===pressedIndex?1:0}));
const pad=({axis9=1.285714,mapping='',pressedIndex=-1,index=0,id='54c-0ce6-Wireless Controller'}={})=>({id,mapping,index,connected:true,axes:[0,0,0,0,0,0,0,0,0,axis9],buttons:buttons(pressedIndex)});
const ui=context.FootballLegacyControllerUI;

check(ui.debugGamepadDirection(pad({axis9:.142857}))==='down','The real Firefox raw-DualSense Down hat value remains supported');
check(ui.debugGamepadDirection(pad({axis9:-1}))==='up','The real Firefox raw-DualSense Up hat value remains supported');
check(ui.debugGamepadDirection(pad({axis9:1.285714}))===null,'The Firefox neutral hat value remains neutral');
check(ui.debugGamepadDirection(pad({axis9:0}))===null,'A zeroed Bluetooth reconnect packet must not become held D-pad Down');
check(ui.debugGamepadDirection(pad({axis9:.142857,mapping:'standard'}))===null,'A standard-mapped DualSense must not read raw axis-9 as a second D-pad');
check(ui.debugGamepadDirection(pad({axis9:.142857,mapping:'standard',pressedIndex:13}))==='down','A standard-mapped DualSense keeps ordinary D-pad buttons');
check(ui.debugGamepadContract(pad({axis9:0,mapping:'standard'})).meaningfulInput===false,'A ghost-connected standard DualSense with zero axes and buttons is not reported as active input');
check(ui.getGamepadReadiness(pad({axis9:0,mapping:'standard'})).inputObserved===false,'Detection alone does not mark a controller ready');
check(onlineSource.includes('const RAW_DUALSENSE_HAT_VALUES=[-1,-.714286,-.428571,-.142857,.142857,.428571,.714286,1]'),'Online input serialization uses the reconnect-safe Firefox hat positions');
check(onlineSource.includes('if(nearest>.08)return false'),'Online input serialization rejects zeroed reconnect packets instead of sending held Down');

const standardCross=pad({mapping:'standard',pressedIndex:0,id:'Xbox Wireless Controller',axis9:1.285714});
ui.receiveGamepad(standardCross,100);
ui.receiveGamepad(standardCross,101);
check(focusButton.clicks===1,'A held select button produces one edge before disconnect');
check(ui.getGamepadReadiness(standardCross).inputObserved===true,'A real button signal promotes the detected controller to input-ready');
for(const listener of listeners.get('gamepaddisconnected')||[])listener({gamepad:standardCross});
ui.receiveGamepad(standardCross,102);
check(focusButton.clicks===2,'A reconnected pad index starts with clean edge state');

const switchB=pad({mapping:'standard',pressedIndex:0,index:2,id:'Nintendo Switch Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)',axis9:1.285714});
const switchContract=ui.debugGamepadContract(switchB);
check(switchContract.nintendo===true&&switchContract.layout==='nintendo-switch-positional','A Nintendo Switch Pro Controller is identified without changing its browser standard layout');
check(switchContract.select===true&&switchContract.faceLabels.select==='B'&&switchContract.faceLabels.back==='A'&&switchContract.faceLabels.lob==='Y'&&switchContract.faceLabels.through==='X','Switch B/A/Y/X labels follow the same physical south/east/west/north positions');
ui.receiveGamepad(switchB,103);
ui.receiveGamepad(switchB,104);
check(focusButton.clicks===3,'A held Nintendo B select button produces one menu edge');

check(quickPlaySource.includes('if(ONLINE||offlineLaunchInProgress)return false'),'Offline launch is single-flight without altering Online');
check(quickPlaySource.includes("setAttribute('aria-busy','true')"),'The first Start activation immediately exposes a busy state');
check(quickPlaySource.includes('requestAnimationFrame(()=>setTimeout(()=>'),'The loading acknowledgement gets a paint opportunity before payload encoding');
check(!quickPlaySource.includes("elements.startMatch.addEventListener('click',()=>{syncSetupState();saveAndLaunch(buildMatchData())})"),'Quick Play no longer performs an unacknowledged synchronous launch directly in the click handler');
check(quickPlaySource.includes('for(const index of padState.keys())if(!present.has(index))padState.delete(index)'),'The Quick Play shoulder carousel drops stale disconnected-pad state');
check(quickPlaySource.includes('detected, but no input received'),'Quick Play distinguishes a detected Bluetooth slot from a working controller');
check(quickPlayHtml.includes('app.js?v=174-fl-v2-final-candidate-5-joe-cpu-races-1'),'Quick Play cache-busts Joe’s controller and gameplay changes');
check(quickPlayHtml.includes('historic-playtest-squads.js?v=174-fl-v2-final-candidate-2'),'Quick Play cache-busts the final historic ratings alongside the final gameplay candidate');
check(quickPlayHtml.includes('../controller-ui.js?v=174-controller-input-ready-1-nintendo-1'),'Quick Play cache-busts the Nintendo-aware controller UI');

console.log(`controller reconnect and Quick Play launch: ${passed}/${passed} checks passed`);
