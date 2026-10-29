import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require=createRequire(import.meta.url);
const THREE=require('../match-engine/vendor/three.min.js');
const magnitude=v=>Math.hypot(...v);
const difference=(a,b,dt)=>a.map((value,i)=>(value-b[i])/dt);
const percentile=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted.length?sorted[Math.ceil((sorted.length-1)*p)]:0;};
const summary=values=>({peak:values.length?Math.max(...values):0,p95:percentile(values,.95),samples:values.length});

function cameraForPose(pose,aspect=16/9){
  const camera=new THREE.PerspectiveCamera(pose.fov,aspect,.1,20000);
  camera.position.set(pose.x,pose.y,pose.z);camera.lookAt(pose.lx,pose.ly,pose.lz);return camera;
}
export const cameraQuaternion=pose=>cameraForPose(pose).quaternion;
export function measureShotMotion(frames,unitsPerMetre=32,fps=30,includeSamples=false){
  const dt=1/fps,positions=[],angles=[],fov=[];let previous=null,velocity=null,angularVelocity=null,fovVelocity=null;
  for(const pose of frames){
    const point=[pose.x,pose.y,pose.z].map(x=>x/unitsPerMetre),q=cameraQuaternion(pose);
    if(previous){
      const v=difference(point,previous.point,dt),delta=q.clone().multiply(previous.q.clone().invert()).normalize();
      if(delta.w<0){delta.x*=-1;delta.y*=-1;delta.z*=-1;delta.w*=-1;}
      const length=Math.hypot(delta.x,delta.y,delta.z),angle=2*Math.atan2(length,delta.w),factor=length>1e-12?angle/length/dt*180/Math.PI:0;
      const omega=[delta.x*factor,delta.y*factor,delta.z*factor],fv=(pose.fov-previous.fov)/dt;
      if(velocity){positions.push(magnitude(difference(v,velocity,dt)));angles.push(magnitude(difference(omega,angularVelocity,dt)));fov.push(Math.abs((fv-fovVelocity)/dt));}
      velocity=v;angularVelocity=omega;fovVelocity=fv;
    }
    previous={point,q,fov:pose.fov};
  }
  const heights=frames.map(p=>p.y/unitsPerMetre),pitches=frames.map(p=>Math.atan2(p.y-p.ly,Math.hypot(p.x-p.lx,p.z-p.lz))*180/Math.PI);
  const result={frames:frames.length,positionMetresPerSecondSquared:summary(positions),angularDegreesPerSecondSquared:summary(angles),fovDegreesPerSecondSquared:summary(fov),heightRangeMetres:Math.max(...heights)-Math.min(...heights),horizonPitchRangeDegrees:Math.max(...pitches)-Math.min(...pitches)};
  if(includeSamples)result.accelerationSamples={positionMetresPerSecondSquared:positions,angularDegreesPerSecondSquared:angles,fovDegreesPerSecondSquared:fov};
  return result;
}
function loadDirector(filename){
  const sandbox={module:{exports:{}},exports:{}};vm.runInNewContext(fs.readFileSync(filename,'utf8'),sandbox,{filename});return sandbox.module.exports;
}
export function compareTrace(report,beforeFile,afterFile,runDirectorFile=null){
  if(!Array.isArray(report.cameraTrace)||!report.cameraTrace.length)throw new Error('Run match-lab with cameraMotion=1 to record the production trace');
  const legacySource=fs.readFileSync(beforeFile,'utf8'),start=legacySource.indexOf('      if(!focus)focus='),end=legacySource.indexOf('      if(change)return',start);
  if(start<0||end<0)throw new Error('Saved former motion block not found');
  const block=legacySource.slice(start,end);
  const legacyMotion=vm.runInNewContext(`(function(){let focus=null,pose=null,angle='broadcast',end=1;const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));function update(input,change){${block};return {...pose};}return {begin(input,nextAngle,nextEnd,duration,kind){angle=nextAngle;end=nextEnd;if(kind==='directorReturn')focus=null;return update(input,true);},step(input){return update(input,false);}};})`);
  const api=loadDirector(afterFile),before=api.create(report.seed,{motionFactory:legacyMotion}),after=api.create(report.seed);
  const reference=runDirectorFile?loadDirector(runDirectorFile).create(report.seed):null;let captureTickPosesMatchRun=true;
  const shots={before:[],after:[]},cuts={before:[],after:[]},current={before:null,after:null};
  const replayFrames=new Set();let replayStart=null;
  for(const row of report.captureEvents||[]){
    if(row.type==='replayStart')replayStart=row.frame;
    if(row.type==='replayEnd'&&replayStart!==null){for(let frame=replayStart;frame<row.frame;frame++)replayFrames.add(frame);replayStart=null;}
  }
  if(replayStart!==null)for(let frame=replayStart;frame<=Math.ceil(report.cameraTrace.length/2);frame++)replayFrames.add(frame);
  let index=0;
  for(const input of report.cameraTrace){
    for(const [name,director]of [['before',before],['after',after]]){
      const cut=director.step(input),state=director.snapshot();
      if(cut)cuts[name].push(JSON.parse(JSON.stringify(cut)));
      if(!state.active||replayFrames.has(Math.floor(index/2)+1)){current[name]=null;continue;}
      if(!current[name]||current[name].version!==state.version){const shot={version:state.version,angle:state.angle,startSeconds:state.seconds,phase:input.setup?'setup':'play',direction:state.composition?.direction||(Math.sign(input.attackDirection)||1),frames:[],subjects:[]};shots[name].push(shot);current[name]=shot;}
      if(index%2===1){current[name].frames.push({...state.pose});current[name].subjects.push(input);}
    }
    if(reference){reference.step(input);if(JSON.stringify(reference.snapshot().pose)!==JSON.stringify(after.snapshot().pose))captureTickPosesMatchRun=false;}
    index++;
  }
  const output={seed:report.seed,evidence:report.evidence||'browser-capture-clock',fps:30,cutDiscontinuitiesExcluded:true,authoredReplayFramesExcluded:replayFrames.size,comparisonMode:'identical engine inputs, angles and cut boundaries; former versus cinematic motion',
    beforeFile,afterFile,runDirectorFile,captureTickPosesMatchRun:reference?captureTickPosesMatchRun:null,identicalCutSchedule:JSON.stringify(cuts.before)===JSON.stringify(cuts.after),cuts:cuts.after};
  const canonical=rows=>rows.map(row=>Object.fromEntries(['type','from','to','seconds','directedSeconds','phase','setupKind','interval','beat','deferred','delayReasons'].filter(key=>key in row).map(key=>[key,row[key]])));
  output.cutsMatchEngineRun=JSON.stringify(canonical(cuts.after))===JSON.stringify(canonical(report.captureEvents?.filter(row=>['directorCut','directorReturn'].includes(row.type))||[]));
  for(const name of ['before','after']){
    const rows=[],samples={positionMetresPerSecondSquared:[],angularDegreesPerSecondSquared:[],fovDegreesPerSecondSquared:[]};
    for(const shot of shots[name].filter(s=>s.frames.length>=3)){
      const measured=measureShotMotion(shot.frames,report.cameraTrace[0].unitsPerMetre,30,true),raw=measured.accelerationSamples;delete measured.accelerationSamples;
      let visible=0;const compositionErrors=[];
      for(let i=0;i<shot.frames.length;i++){
        const input=shot.subjects[i],camera=cameraForPose(shot.frames[i],input.aspect||16/9);camera.updateMatrixWorld();
        const point=new THREE.Vector3(input.x,12,input.z).project(camera);
        if(Math.abs(point.x)<=1&&Math.abs(point.y)<=1&&point.z>=-1&&point.z<=1)visible++;
        compositionErrors.push(Math.hypot((point.x+1)/2-(shot.direction>0?1/3:2/3),(1-point.y)/2-2/3));
      }
      rows.push({version:shot.version,angle:shot.angle,startSeconds:shot.startSeconds,phase:shot.phase,...measured,groundPointVisibleFraction:visible/shot.frames.length,thirdsDistanceInScreenUnits:summary(compositionErrors)});
      for(const key of Object.keys(samples))samples[key].push(...raw[key]);
    }
    output[name]={shots:rows,aggregate:Object.fromEntries(Object.entries(samples).map(([key,values])=>[key,summary(values)]))};
  }
  return output;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [reportFile,beforeFile,afterFile,outputFile,runDirectorFile]=process.argv.slice(2);
  const result=compareTrace(JSON.parse(fs.readFileSync(reportFile,'utf8')),beforeFile,afterFile,runDirectorFile);
  fs.writeFileSync(outputFile,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({identicalCutSchedule:result.identicalCutSchedule,cutsMatchEngineRun:result.cutsMatchEngineRun,captureTickPosesMatchRun:result.captureTickPosesMatchRun,before:result.before.aggregate,after:result.after.aggregate}));
}
