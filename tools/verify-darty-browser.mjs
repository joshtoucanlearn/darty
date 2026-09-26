const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base=process.env.DARTY_BASE_URL || 'http://127.0.0.1:4331';
const output=process.env.DARTY_PROOF_DIR || '/tmp/darty-browser-proof';
fs.mkdirSync(output,{recursive:true});
let html=fs.readFileSync(root+'/match-engine/match.html','utf8');
for(const [,attrs,code] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) if(!attrs.includes('src=')&&code.trim()) new vm.Script(code);
console.log('Inline syntax passed');
const hook=`window.__DARTY_TEST = {
 ready:()=>started,
 snapshot:()=>dartyFlights.map(s=>({part:s.partName,position:s.part.position.toArray(),rotation:s.part.quaternion.toArray(),sourceVisible:s.sourcePart.visible,landed:s.landed,age:s.age,bottom:new THREE.Box3().setFromObject(s.part).min.y,childPose:s.part.children.map(c=>c.quaternion.toArray()),attached:s.part.parent===scene})),
 step:(dt=1/60,isPaused=false)=>{paused=isPaused;for(const s of dartyFlights)s.lastAt=performance.now()-dt*1000;dartyDrawFlights();paused=true;},
 render:()=>{paused=true;draw();},
 reset:()=>{const originals=dartyFlights.map(s=>s.sourcePart);dartyResetMatch();return originals.every(p=>p.visible);}
};\n`;
// Instrument only this test page. Production gameplay keeps its normal loop.
html=html.replace('  window.FLMatch={',hook+'  window.FLMatch={').replaceAll('requestAnimationFrame(loop);','/* manual fixture rendering */');
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1080,height:720}});
page.setDefaultTimeout(20000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{navigator.getGamepads=()=>[];});
await page.route('**/match-engine/match.html?*',r=>r.fulfill({contentType:'text/html',body:html}));
try{
 console.log('Browser started');
 await page.goto(base+'/quick-play/index.html?mode=single-player&engine=fl-v2&candidate=5');
 for(const id of ['confirmTeams','confirmManagement','confirmSetup','confirmControls','startMatch'])await page.locator('#'+id).click();
 await page.waitForFunction(()=>window.__DARTY_TEST&&window.FLMatch);
 const url=new URL(page.url());url.searchParams.set('debugScene','darty-head');url.searchParams.set('debugDelay','999999');
 await page.goto(url.toString());await page.waitForFunction(()=>window.__DARTY_TEST&&window.FLMatch);
 await page.waitForFunction(()=>__DARTY_TEST.ready()); console.log('Test scene loaded');
 const results=[];
 for(const part of ['head','leg']){
  const fixture=await page.evaluate(part=>{const f=FLMatch.debugDartyVisual(part);__DARTY_TEST.render();return f;},part);
  const before=await page.evaluate(()=>__DARTY_TEST.snapshot()[0]);
  assert.equal(before.sourceVisible,false); assert.equal(before.attached,true); assert.equal(fixture.first.hardHits,1);assert.equal(fixture.second.hardHits,2);
  await page.evaluate(()=>{for(let n=0;n<15;n++)__DARTY_TEST.step();__DARTY_TEST.render();});
  const mid=await page.evaluate(()=>__DARTY_TEST.snapshot()[0]);
  assert.notDeepEqual(mid.rotation,before.rotation);assert.notDeepEqual(mid.position,before.position);
  assert.deepEqual(mid.childPose,before.childPose,'Detached child pose must not keep walking');
  await page.screenshot({path:path.join(output,'darty-'+part+'.png')});
  await page.evaluate(()=>{for(let n=0;n<20;n++)__DARTY_TEST.step(1/60,true);__DARTY_TEST.render();});
  assert.deepEqual(await page.evaluate(()=>__DARTY_TEST.snapshot()[0]),mid,'Pause must freeze flight and sparkle age');
  await page.evaluate(()=>{for(let n=0;n<400;n++)__DARTY_TEST.step();__DARTY_TEST.render();});
  const end=await page.evaluate(()=>__DARTY_TEST.snapshot()[0]);assert.equal(end.landed,true);assert.ok(Math.abs(end.bottom-.14)<.00001,'Landed geometry rests on the pitch');
  await page.screenshot({path:path.join(output,'darty-'+part+'-landed.png')});
  await page.evaluate(()=>{__DARTY_TEST.render();__DARTY_TEST.render();});
  assert.deepEqual((await page.evaluate(()=>__DARTY_TEST.snapshot()[0])).rotation,end.rotation,'Landed part must not animate with its player');
  assert.equal(await page.evaluate(()=>__DARTY_TEST.reset()),true);
  const reset=await page.evaluate(()=>FLMatch.getDartyState());assert.equal(reset.flights.length,0);assert.equal(reset.queued,0);assert.ok(reset.activePlayers.every(p=>p.hardHits===0));
  results.push({part,fixture,mid,end,reset:true});console.log(part+' passed');
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'visual-verification.json'),JSON.stringify({fixture:'instrumented render-only; contact integration checked separately',results,errors},null,2));
 console.log('All visual checks passed');
} finally{await browser.close();}
