/* Live camera direction. The host calls step once per fixed simulation tick. */
(function(root){
  'use strict';
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  function resolveScope(state){
    if(!state.started||state.paused||state.matchOver||state.matchPhase!=='play'||state.halfTime||state.fullTime)return {directed:false,phase:'presentation',reason:'period-or-pause'};
    if(state.authored)return {directed:false,phase:'authored',reason:'authored-sequence'};
    if(state.delivery)return {directed:false,phase:'delivery',reason:'dedicated-set-piece-delivery'};
    return {directed:!!(state.setup||state.clockRunning),phase:state.setup?'setup':'play',reason:null};
  }
  function spring(value,velocity,target,frequency,dt=1/60){
    const offset=value-target,impulse=velocity+frequency*offset,decay=Math.exp(-frequency*dt);
    return {value:target+(offset+impulse*dt)*decay,velocity:(velocity-frequency*impulse*dt)*decay};
  }
  function createMotion(){
    let shot=null,channels={},dead=null,pose=null,previous=null,age=0;
    function subject(input){
      return {x:input.x+(Number.isFinite(input.carrierX)?clamp(input.carrierX-input.x,-90,90)*.25:0),
        z:input.z+(Number.isFinite(input.carrierZ)?clamp(input.carrierZ-input.z,-90,90)*.25:0)};
    }
    function channel(key,target,frequency){
      const current=channels[key],next=spring(current.value,current.velocity,target,frequency);
      next.acceleration=frequency*frequency*(target-next.value)-2*frequency*next.velocity;channels[key]=next;return next.value;
    }
    function velocity(input){
      const scale=input.unitsPerMetre||32,limit=scale*15;
      return {x:clamp((input.vx||0)*60,-limit,limit),z:clamp((input.vz||0)*60,-limit,limit)};
    }
    function target(input,anchor,vx,vz,fov){
      const scale=input.unitsPerMetre||32,t=clamp(age/shot.duration,0,1),drift=t*t*t*(10+t*(-15+6*t));
      const pan=clamp((anchor.x-shot.origin.x)*shot.pan/shot.distance,-.18,.18)+shot.drift*drift;
      const ox=shot.ox*Math.cos(pan)-shot.oz*Math.sin(pan),oz=shot.ox*Math.sin(pan)+shot.oz*Math.cos(pan);
      const distance=shot.distance*(1-shot.dolly*drift),nx=ox/shot.distance,nz=oz/shot.distance,rx=nz,rz=-nx;
      // Velocity is filtered independently: foot-to-foot changes cannot flip the
      // composition or make anticipation react to one contact packet.
      const a=clamp(age/2,0,1),anticipationEase=a*a*a*(10+a*(-15+6*a));
      const anticipation={x:clamp(vx*.45,-scale*5,scale*5)*anticipationEase,z:clamp(vz*.45,-scale*4,scale*4)*anticipationEase};
      const ax=anchor.x+anticipation.x,az=anchor.z+anticipation.z;
      const depth=distance*Math.cos(shot.pitch)+(shot.height-12)*Math.sin(shot.pitch);
      const lead=shot.direction*depth*Math.tan(fov*Math.PI/360)*shot.aspect/3;
      const x=ax+nx*distance+rx*lead,z=az+nz*distance+rz*lead;
      return {x,y:shot.height,z,lx:x-nx*depth*Math.cos(shot.pitch),ly:shot.height-depth*Math.sin(shot.pitch),lz:z-nz*depth*Math.cos(shot.pitch),fov};
    }
    function begin(input,angle,end,duration){
      const h=input.height,w=input.width,profiles={
        broadcast:{height:410,distance:h*.68+250,fov:45,pan:.20,drift:.012,dolly:.008,zoom:.65},
        follow:{height:300,distance:h*.46+180,fov:40,pan:.07,drift:-.010,dolly:.004,zoom:.35},
        tactical:{height:850,distance:h*.78+350,fov:52,pan:.14,drift:.010,dolly:.006,zoom:.40},
        pitchside:{height:135,distance:h*.32+200,fov:48,pan:.05,drift:-.012,dolly:.003,zoom:.25},
        highEnd:{height:520,distance:Math.hypot(w*.35+220,h*.58),fov:49,pan:.07,drift:.008,dolly:.025,zoom:1.1}
      },p=profiles[angle],s=subject(input),v=velocity(input),ox=angle==='highEnd'?end*(w*.35+220):0,oz=angle==='highEnd'?h*.58:p.distance;
      shot={...p,angle,origin:{...s},ox,oz,direction:Math.sign(input.attackDirection||v.x||input.x)||1,
        aspect:clamp(input.aspect||16/9,.55,3),duration,initialSpeed:Math.hypot(v.x,v.z),
        pitch:Math.atan2(p.height-12,p.distance)-Math.atan(Math.tan(p.fov*Math.PI/360)/3)};
      age=0;dead={...s};channels={};
      for(const [key,value]of Object.entries({sx:s.x,sz:s.z,vx:v.x,vz:v.z,fov:p.fov}))channels[key]={value,velocity:0};
      pose=target(input,s,v.x,v.z,p.fov);
      for(const [key,value]of Object.entries(pose))if(key!=='y'&&key!=='fov')channels[key]={value,velocity:0};
      previous={pose:{...pose},channels:Object.fromEntries(Object.entries(channels).map(([key,value])=>[key,{...value}]))};
      return {...pose};
    }
    function step(input){
      if(!shot)return null;
      previous={pose:{...pose},channels:Object.fromEntries(Object.entries(channels).map(([key,value])=>[key,{...value}]))};
      age+=1/60;const s=subject(input),v=velocity(input),zone=(input.unitsPerMetre||32)*.16;
      for(const key of ['x','z']){const delta=s[key]-dead[key];if(Math.abs(delta)>zone)dead[key]+=delta-Math.sign(delta)*zone;}
      const sx=channel('sx',dead.x,4.5),sz=channel('sz',dead.z,4.5),vx=channel('vx',v.x,2.4),vz=channel('vz',v.z,2.4);
      const paceZoom=clamp((Math.hypot(vx,vz)-shot.initialSpeed)/180,-.7,.7),t=clamp(age/shot.duration,0,1),drift=t*t*t*(10+t*(-15+6*t));
      const fov=channel('fov',shot.fov+paceZoom-shot.zoom*drift,2),next=target(input,{x:sx,z:sz},vx,vz,fov);
      pose={y:shot.height,fov};
      for(const key of ['x','z','lx','ly','lz'])pose[key]=channel(key,next[key],2.5);
      return {...pose};
    }
    function sample(alpha=1){
      if(!pose)return null;if(alpha>=1||!previous)return {...pose};if(alpha<=0)return {...previous.pose};
      const result={y:shot.height},dt=1/60,t=clamp(alpha,0,1);
      // Quintic Hermite interpolation keeps position, velocity and acceleration
      // continuous when the display refreshes between fixed simulation ticks.
      for(const key of ['x','z','lx','ly','lz','fov']){
        const p0=previous.pose[key],p1=pose[key],a=previous.channels[key],b=channels[key],v0=a.velocity*dt,v1=b.velocity*dt,a0=(a.acceleration||0)*dt*dt,a1=(b.acceleration||0)*dt*dt,d=p1-p0;
        const c3=10*d-6*v0-4*v1-1.5*a0+.5*a1,c4=-15*d+8*v0+7*v1+1.5*a0-a1,c5=6*d-3*v0-3*v1-.5*a0+.5*a1;
        result[key]=p0+t*(v0+t*(a0*.5+t*(c3+t*(c4+t*c5))));
      }
      return result;
    }
    return {begin,step,sample,snapshot:()=>({pose:pose&&{...pose},shot:shot&&{angle:shot.angle,direction:shot.direction,height:shot.height,pitch:shot.pitch,aspect:shot.aspect,thirds:{x:shot.direction>0?1/3:2/3,y:2/3}},age})};
  }
  function create(seed=1,options={}){
    let randomState=Number(seed)>>>0,seconds=0,liveSeconds=0,shotStarted=0;
    let active=false,angle='broadcast',end=1,hold=8,beat=null,blockedUntil=0;
    let previousOwner=null,previousWide=false,pose=null,version=0,lastDanger=-Infinity;
    const motion=(options.motionFactory||createMotion)(),delayReasons=new Set();
    const durations={broadcast:0,follow:0,tactical:0,pitchside:0,highEnd:0};
    function random(){randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296;}
    function nextHold(resumed=false){
      // Interrupted inserts already contribute extra main-camera coverage. Give
      // the next safe open-play passage an earlier opportunity in that case.
      return angle==='broadcast'?(resumed||durations.broadcast/Math.max(1,liveSeconds)>.65?5+random()*.5:8+random()):5+random()*.5;
    }
    function step(input){
      const dt=1/60;seconds+=dt;
      for(const event of input.events||[]){
        if(['shot','keeper-save','darty-hard-hit','tackle','slide-start'].includes(event.type)){
          blockedUntil=Math.max(blockedUntil,seconds+(event.type==='keeper-save'?1.2:.7));beat=null;
        }else if(event.type==='pass')beat={at:seconds,kind:'pass-release'};
      }
      if(!input.enabled||!input.open){
        active=false;angle='broadcast';beat=null;previousOwner=null;previousWide=false;
        return null;
      }
      liveSeconds+=dt;durations[angle]+=dt;
      if(input.danger)lastDanger=seconds;
      if(!active&&(input.danger||seconds<blockedUntil))return null;
      const owner=input.ownerTeam||null,wide=Math.abs(input.z)>input.height*.32;
      if(owner&&previousOwner&&owner!==previousOwner)beat={at:seconds,kind:'possession-change'};
      if(wide&&!previousWide)beat={at:seconds,kind:'wide-channel'};
      if(owner)previousOwner=owner;previousWide=wide;
      const elapsed=liveSeconds-shotStarted;
      if(input.setup)beat={at:seconds,kind:'settled-setup'};
      else if(elapsed>=9.5&&input.settledCutAllowed&&seconds-lastDanger>=.5)beat={at:seconds,kind:'settled-play'};
      if(active&&elapsed>=hold){
        for(const key of ['shot','cross','tackle','save'])if(input[key])delayReasons.add(key);
        if(seconds<blockedUntil)delayReasons.add('contact-protection-tail');
        if(!input.danger&&seconds>=blockedUntil&&!(beat&&seconds-beat.at<=.2))delayReasons.add('waiting-for-safe-beat');
      }
      let change=null;
      if(!active){
        active=true;angle='broadcast';hold=nextHold(true);shotStarted=liveSeconds;version++;
        delayReasons.clear();change={type:'directorReturn',from:'authored',to:angle,reason:'directed-time-resumed'};
      }else if(!input.danger&&seconds>=blockedUntil&&beat&&seconds-beat.at<=.2&&liveSeconds-shotStarted+1e-8>=hold){
        const elapsed=liveSeconds-shotStarted,from=angle;
        if(angle!=='broadcast')angle='broadcast';
        else{
          const choices=['follow','tactical','pitchside'];
          if(Math.abs(input.x)>input.width/6)choices.push('highEnd');
          angle=choices[Math.floor(random()*choices.length)];end=Math.sign(input.x)||1;
        }
        version++;shotStarted=liveSeconds;hold=nextHold();
        change={type:'directorCut',from,to:angle,interval:elapsed,beat:beat.kind,deferred:elapsed>10+1e-8,delayReasons:elapsed>10+1e-8?[...delayReasons]:[]};
        delayReasons.clear();
      }
      if(change)beat=null;
      pose=change?motion.begin(input,angle,end,hold,change.type):motion.step(input);
      if(change)return {...change,seconds,liveSeconds,directedSeconds:liveSeconds,phase:input.setup?'setup':'play',setupKind:input.setupKind||null,danger:!!input.danger};
      return null;
    }
    return {step,
      snapshot:(alpha=1)=>({active,angle,version,seconds,liveSeconds,directedSeconds:liveSeconds,pose:motion.sample?motion.sample(alpha):pose&&{...pose},composition:motion.snapshot?.().shot||null,durations:{...durations}})
    };
  }
  const api={create,createMotion,spring,resolveScope};
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.DartyCameraDirector=api;
})(typeof window==='object'?window:null);
