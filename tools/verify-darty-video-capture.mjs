// No server, downloads or installs: serve this checkout through Playwright routes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=process.env.DARTY_PROOF_DIR||'/tmp/darty-video-proof';
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1280,height:720}});
const errors=[];
context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
await context.route('http://darty.local/**',async route=>{
  const filename=path.resolve(root,'.'+decodeURIComponent(new URL(route.request().url()).pathname));
  if(!filename.startsWith(root+path.sep))return route.abort();
  try{
    const file=filename.endsWith(path.sep)?filename+'index.html':filename;
    const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg'};
    await route.fulfill({body:await fs.readFile(file),contentType:types[path.extname(file)]||'application/octet-stream'});
  }catch{await route.fulfill({status:404,body:'Missing checkout asset'});}
});
try{
  const page=await context.newPage();
  await page.goto('http://darty.local/quick-play/index.html?mode=spectator&engine=fl-v2&candidate=5');
  for(const id of ['confirmTeams','confirmManagement','confirmSetup','confirmControls','startMatch'])await page.locator('#'+id).click();
  await page.waitForURL('**/match.html?*');
  await page.waitForFunction(()=>window.FLMatch&&document.getElementById('matchLoading').hidden);
  assert.equal(await page.evaluate(()=>typeof window.dartyCapture),'undefined');
  assert.equal(await page.evaluate(()=>typeof window.DartyVideo),'undefined');
  const url=new URL(page.url());
  for(const [key,value]of Object.entries({capture:'1',clean:'1',director:'showcase'}))url.searchParams.set(key,value);
  // Keep each readiness wait in page.evaluate: its clock is deliberately frozen.
  async function ready(){await page.goto(url.href);await page.evaluate(()=>window.dartyCapture.ready);}
  await ready();
  const initial=await page.screenshot();
  await page.waitForTimeout(200);
  assert.deepEqual(await page.screenshot(),initial,'wall time cannot animate a frozen frame');
  for(const [width,height]of [[1280,720],[1440,900],[1920,1080],[1080,1920]]){
    await page.setViewportSize({width,height});
    const rect=await page.evaluate(()=>{
      const c=document.getElementById('c'),r=c.getBoundingClientRect();
      return {x:r.x,y:r.y,w:r.width,h:r.height,bw:c.width,bh:c.height,scrollW:document.documentElement.scrollWidth,scrollH:document.documentElement.scrollHeight};
    });
    assert.deepEqual(rect,{x:0,y:0,w:width,h:height,bw:width,bh:height,scrollW:width,scrollH:height});
    await page.evaluate(()=>dartyCapture.step(0));
    await page.screenshot({path:path.join(output,`${width}x${height}.png`)});
  }
  await page.setViewportSize({width:1280,height:720});await ready();
  const a=await page.evaluate(()=>{dartyCapture.step(300);return dartyCapture.events();});
  const frameA=await page.screenshot();
  await ready();
  const b=await page.evaluate(()=>{for(let n=0;n<300;n++)dartyCapture.step();return dartyCapture.events();});
  assert.deepEqual(a,b);assert.deepEqual(await page.screenshot(),frameA,'same seed produces identical pixels');
  // Also compare ten seconds of live football, after the normal walkout/whistle.
  await page.evaluate(()=>dartyCapture.step(185));
  const liveStart=await page.evaluate(()=>FLLiveV2.status().gameplay.committedTicks);assert.ok(liveStart>0);
  const liveA=await page.evaluate(()=>{dartyCapture.step(300);return dartyCapture.events();});
  const liveFrame=await page.screenshot();
  await ready();await page.evaluate(()=>dartyCapture.step(485));
  const liveB=await page.evaluate(()=>{for(let n=0;n<300;n++)dartyCapture.step();return dartyCapture.events();});
  assert.deepEqual(liveA,liveB);assert.deepEqual(await page.screenshot(),liveFrame);
  assert.equal(await page.evaluate(()=>dartyCapture.forceGoalAttempt()),true);
  const goal=await page.evaluate(()=>dartyCapture.findNext('goal',2));assert.ok(Number.isInteger(goal));
  await page.evaluate(()=>dartyCapture.step(60));await page.screenshot({path:path.join(output,'goal.png')});
  const visible=await page.evaluate(()=>[...document.body.children].filter(el=>{
    const style=getComputedStyle(el),rect=el.getBoundingClientRect();
    return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0;
  }).map(el=>el.id||el.className));
  assert.deepEqual(visible.sort(),['dartyBadge','hud','wrap']);
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(output,'events.json'),JSON.stringify(await page.evaluate(()=>dartyCapture.events()),null,2));
  console.log('Capture clocks, same-seed pixels/events, all four viewports and existing goal aid passed');
}finally{await browser.close();}
