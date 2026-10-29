/* Recording tools only. No flag means no browser globals, clocks or inputs change. */
(function(root){
  'use strict';
  function createClock(seed=1){
    let now=1000,nextId=1000000000,stream='simulation';
    const timers=new Map(),rafs=new Map(),states=new Map();
    function random(){
      let state=states.has(stream)?states.get(stream):(Number(seed)>>>0)^({simulation:0,visual:0x9e3779b9,gpu:0x85ebca6b}[stream]||0);
      state=(state+0x6D2B79F5)>>>0;states.set(stream,state);
      let t=Math.imul(state^(state>>>15),1|state);t^=t+Math.imul(t^(t>>>7),61|t);
      return ((t^(t>>>14))>>>0)/4294967296;
    }
    function schedule(fn,delay,args,interval=0){
      if(typeof fn!=='function')throw new TypeError('Capture timers require a function');
      const id=nextId++;timers.set(id,{id,fn,args,at:now+Math.max(0,Number(delay)||0),interval});return id;
    }
    return {
      now:()=>now,random,
      withRandom(name,fn){const previous=stream;stream=name;try{return fn();}finally{stream=previous;}},
      setTimeout:(fn,delay,...args)=>schedule(fn,delay,args),
      setInterval:(fn,delay,...args)=>schedule(fn,delay,args,Math.max(1,Number(delay)||1)),
      clearTimer:id=>timers.delete(id),
      requestAnimationFrame(fn){const id=nextId++;rafs.set(id,fn);return id;},
      cancelAnimationFrame:id=>rafs.delete(id),
      advance(ms){
        if(!Number.isFinite(ms)||ms<0)throw new RangeError('Invalid capture duration');
        const end=now+ms;let count=0;
        while(true){
          const due=[...timers.values()].filter(t=>t.at<=end).sort((a,b)=>a.at-b.at||a.id-b.id)[0];
          if(!due)break;if(++count>10000)throw new Error('Capture timer loop');
          now=due.at;if(due.interval)due.at+=due.interval;else timers.delete(due.id);due.fn(...due.args);
        }
        now=end;const callbacks=[...rafs.values()];rafs.clear();for(const fn of callbacks)fn(now);
      }
    };
  }
  function eventTypes(event){
    const aliases={'keeper-save':'save','darty-hard-hit':'hardHit','darty-toy-pop':'pop','slide-start':'slideTackle'};
    if(event.type==='restart')return ({'KICK OFF':['kickoff'],'FREE KICK':['freeKick'],PENALTY:['penalty']})[event.kind]||[];
    if(['pass','shot','goal','foul','tackle'].includes(event.type))return [event.type];
    return aliases[event.type]?[aliases[event.type]]:[];
  }
  if(typeof module==='object'&&module.exports)module.exports={createClock,eventTypes};
  if(!root||!root.document)return;
  const params=new URLSearchParams(root.location.search),capture=params.get('capture')==='1',clean=params.get('clean')==='1',showcase=params.get('director')==='showcase';
  if(!capture&&!clean&&!showcase)return;
  const nativeTimeout=root.setTimeout.bind(root),nativeClear=root.clearTimeout.bind(root);
  const clock=capture?createClock(params.has('simulationSeed')?Number(params.get('simulationSeed')):1):null;
  if(capture){
    // Installed before Three and the engine: timers, replay clocks, random visual
    // details and Date-based cooldowns must never read screenshot wall time.
    Object.defineProperty(root.performance,'now',{value:clock.now,configurable:true});
    const NativeDate=root.Date,epoch=1800000000000;
    function VirtualDate(...args){return new.target?new NativeDate(...(args.length?args:[epoch+clock.now()])):new NativeDate(epoch+clock.now()).toString();}
    VirtualDate.prototype=NativeDate.prototype;Object.setPrototypeOf(VirtualDate,NativeDate);VirtualDate.now=()=>epoch+clock.now();root.Date=VirtualDate;
    root.Math.random=clock.random;
    root.setTimeout=clock.setTimeout;root.setInterval=clock.setInterval;
    root.clearTimeout=root.clearInterval=id=>{if(!clock.clearTimer(id))nativeClear(id);};
    root.requestAnimationFrame=clock.requestAnimationFrame;root.cancelAnimationFrame=clock.cancelAnimationFrame;
    // Capture has no device input or audio, including the separate set-piece UI.
    Object.defineProperty(root.navigator,'getGamepads',{value:()=>[],configurable:true});
    root.AudioContext=root.webkitAudioContext=undefined;
  }
  document.documentElement.classList.toggle('darty-clean',clean);
  document.documentElement.classList.toggle('darty-capture',capture);
  const rows=[],contacts=new Set(),assets=[],cameraTrace=[],traceCamera=capture&&params.get('cameraMotion')==='1';let hooks=null,frame=0,loaded=false,resolveReady,rejectReady;
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  // A failed load remains visible; callers can await/reject ready without a hang.
  ready.catch(()=>{});
  let lastCamera=null,lastReplay=null,lastCelebration=false,pendingPop=null;
  function camera(){return hooks?hooks.camera():null;}
  function record(type,details={}){
    if(!hooks)return;
    rows.push({type,time:hooks?hooks.time():0,frame,camera:camera(),...details});
  }
  function observe(){
    const replay=hooks.replay(),celebration=hooks.celebration();
    if(replay!==lastReplay){if(lastReplay)record('replayEnd',{replay:lastReplay});if(replay)record('replayStart',{replay});lastReplay=replay;}
    if(celebration&&!lastCelebration)record('celebration');lastCelebration=celebration;
    const current=JSON.stringify(camera());if(current!==lastCamera){record('camera');lastCamera=current;}
  }
  function direct(){
    if(!showcase||!hooks)return;
    const now=root.performance.now();
    if(pendingPop&&now-pendingPop.at>3000)pendingPop=null;
    if(pendingPop&&(hooks.replay()||hooks.celebration()))pendingPop=null;
    if(pendingPop&&now>=pendingPop.at&&hooks.canReplayPop()){const pop=pendingPop;pendingPop=null;hooks.replayPop(pop);}
  }
  function advanceFrame(){
    frame++;
    for(let tick=0;tick<2;tick++){
      clock.advance(1000/60);hooks.tick();direct();hooks.sample();
      clock.withRandom('visual',()=>hooks.draw(false));observe();hooks.check();
    }
  }
  function step(n=1){
    if(!loaded)throw new Error('Await dartyCapture.ready before stepping');
    if(!Number.isSafeInteger(n)||n<0)throw new RangeError('step(n) needs a non-negative integer');
    for(let i=0;i<n;i++)advanceFrame();
    // draw(false) above advances the existing per-draw animations at 60 Hz;
    // the GPU is submitted exactly once, including step(0).
    clock.withRandom('gpu',hooks.render);return frame;
  }
  const runtime={capture,clean,showcase,clock,record,
    cameraSample(input){if(traceCamera){if(cameraTrace.length>=100000)throw new Error('Camera trace limit reached');cameraTrace.push({...input,events:input.events.map(e=>({type:e.type,team:e.team,phase:e.phase}))});}},
    waitFor:promise=>assets.push(promise),
    visual:fn=>clock?clock.withRandom('visual',fn):fn(),
    gpu:fn=>clock?clock.withRandom('gpu',fn):fn(),
    onEvent(event){
      for(const type of eventTypes(event))record(type,{sourceType:event.type,team:event.team||null,playerId:event.playerId||null,...(event.part?{part:event.part}:{}),...(event.shotType==='guaranteed'?{testingAid:true}:{})});
      if(showcase&&event.type==='darty-toy-pop')pendingPop={at:root.performance.now()+700,playerId:event.playerId,actorId:event.actorId};
    },
    onContact(contact,epoch){
      const key=[epoch,contact.type,contact.commandId||contact.tick,contact.actorId,contact.targetId].join(':');
      if(contacts.has(key))return;contacts.add(key);
      const details={sourceType:contact.type,playerId:contact.actorId,targetId:contact.targetId,outcome:contact.outcome};
      if(contact.type==='slide-contact')record('slideTackle',details);
      if(contact.outcome==='win'&&['tackle-contact','slide-contact'].includes(contact.type))record('tackle',details);
    },
    update(){direct();observe();},
    bind(value){
      hooks=value;
      if(!capture)return;
      const boot=async()=>{try{clock.advance(180);hooks.check();if(!hooks.started())throw new Error('Match did not load');runtime.visual(()=>hooks.draw(false));await Promise.all(assets);runtime.gpu(hooks.render);observe();loaded=true;resolveReady();}catch(error){rejectReady(error);}};
      if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else nativeTimeout(boot,0);
    }
  };
  root.DartyVideo=runtime;
  if(capture){
    root.dartyCapture=Object.freeze({ready,step,time:()=>hooks?hooks.time():0,events:()=>JSON.parse(JSON.stringify(rows)),
      cameraTrace:()=>JSON.parse(JSON.stringify(cameraTrace)),
      frame:()=>frame,
      findNext(type,maxSeconds=60){
        if(!loaded)throw new Error('Await dartyCapture.ready before searching');
        if(!Number.isFinite(maxSeconds)||maxSeconds<0)throw new RangeError('maxSeconds must be non-negative');
        let cursor=rows.length,found=null;const limit=Math.floor(maxSeconds*30);
        for(let i=0;i<limit;i++){advanceFrame();found=rows.slice(cursor).find(row=>row.type===type);if(found)break;cursor=rows.length;}
        clock.withRandom('gpu',hooks.render);return found?found.frame:null;
      },
      forceGoalAttempt(){if(!loaded)throw new Error('Await dartyCapture.ready');return hooks.forceGoal();}
    });
    root.addEventListener('error',event=>rejectReady(event.error||new Error(event.message||'Match dependency failed')),true);
  }
})(typeof window==='object'?window:null);
