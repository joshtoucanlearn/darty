// Headless DOM/touch verification only. Does not access physical controllers.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
const engines=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const engine=process.env.DARTY_BROWSER||'chrome',api=engine==='chrome'?engines.chromium:engines[engine];
const output=process.env.DARTY_PROOF_DIR||'/tmp/darty-takeover-browser-proof';mkdirSync(output,{recursive:true});
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const html=read('match-engine/match.html'),mapping=html.slice(html.indexOf('  const isDualSenseDevice='),html.indexOf('  function updateGamepadHint()'));
const browser=await api.launch({headless:true,...(engine==='chrome'?{channel:'chrome'}:{})});
try{
  for(const [width,height] of [[320,568],[390,844],[768,1024]]){
    const page=await browser.newPage({viewport:{width,height},hasTouch:true});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setContent('<!doctype html><html class="darty-clean"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="wrap"></div></body></html>');
    await page.addStyleTag({content:read('match-engine/darty-video-capture.css')});
    await page.addScriptTag({content:read('match-engine/spectator-takeover.js')});
    await page.addScriptTag({content:mapping+`
      window.__now=0;window.__human=null;window.__ready=false;
      window.__pad={index:0,id:'DualSense Wireless Controller Extended Gamepad',mapping:'standard',connected:true,axes:[0,0,0,0],buttons:Array.from({length:18},()=>({pressed:false,value:0}))};
      window.__selector=DartySpectatorTakeover.create({document,navigator:{getGamepads:()=>[__pad]},now:()=>__now,pressed:gamepadButtonPressed,
        canTakeOver:()=>__ready,takeOver:side=>{__human=side;return true;},finished:()=>false,disconnect(){},reconnect(){},
        teams:{you:{colour:'#a22',secondary:'#fff'},opp:{colour:'#249',secondary:'#fc6'}}});
      __selector.poll();__selector.poll();
    `});
    await page.evaluate(()=>{__now=8000;__selector.poll();});
    const box=await page.locator('#spectatorTakeover').boundingBox();
    assert.ok(box&&box.x>=0&&box.x+box.width<=width&&box.y>=0&&box.y+box.height<=height,JSON.stringify(box));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await page.locator('.takeoverHint').isVisible(),true);
    for(const button of await page.locator('#spectatorTakeover button:visible').all())assert.ok((await button.boundingBox()).height>=44);
    await page.getByRole('button',{name:'Away',exact:true}).tap();
    await page.getByRole('button',{name:'Play Away',exact:true}).tap();
    assert.equal(await page.locator('#spectatorTakeover strong').textContent(),'Taking over…');
    await page.evaluate(()=>{__now+=3000;__selector.poll();});
    assert.equal(await page.locator('#spectatorTakeover strong').textContent(),'Taking over at the next stoppage');
    await page.screenshot({path:output+'/'+engine+'-'+width+'.png'});
    await page.getByRole('button',{name:'Cancel',exact:true}).tap();
    await page.getByRole('button',{name:'Pick a side',exact:true}).tap();
    await page.getByRole('button',{name:'Home',exact:true}).tap();
    await page.getByRole('button',{name:'Play Home',exact:true}).tap();
    await page.evaluate(()=>{__ready=true;__selector.poll();});
    assert.equal(await page.evaluate(()=>__human),'you');assert.deepEqual(errors,[]);
    console.log('PASS '+engine+' '+width+'x'+height+' clean card, phone fit, touch select/confirm/cancel/reopen, hint and handoff');
    await page.close();
  }
}finally{await browser.close();}
