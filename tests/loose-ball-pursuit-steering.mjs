import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),Movement=require('../match-engine/movement-engine-v2.js');

// Positions/momentum reconstructed from100ms samples of a slow skillsV3
// second-ball race, with the bodies already looking towards the interception.
// Both old commands were already sprint/intensity1; urgency alone was not it.
function race(directionalSteering){
 const ball={x:38.6840392515,y:17.6815268669};
 const attrs={pace:80,acceleration:80,agility:80,balance:80,strength:80,control:80,stamina:80};
 let world=Movement.createWorldState({tick:0,bounds:{xMin:0,xMax:105,yMin:-34,yMax:34},players:[
  {id:'near-racer',teamId:'away',position:{x:38.068634,y:17.040753},velocity:{x:.9067,y:-3.2766},facing:{x:.615405,y:.640774},attributes:attrs},
  {id:'far-racer',teamId:'home',position:{x:38.952897,y:15.811838},velocity:{x:3.4555,y:-2.6077},facing:{x:-.268858,y:1.869689},attributes:attrs}
 ]});
 let slow=0,peak=0;
 for(let tick=1;tick<=180;tick++){
  const commands=world.players.map(p=>{const dx=ball.x-p.position.x,dy=ball.y-p.position.y,d=Math.hypot(dx,dy)||1;
   return {id:p.id+':'+tick,playerId:p.id,tick,type:'move',move:{x:dx/d,y:dy/d},
    facing:{x:dx/d,y:dy/d},mode:'sprint',intensity:1,...(directionalSteering?{directionalSteering:true}:{})};});
  world=Movement.step(world,commands).state;
  const [a,b]=world.players,speed=p=>Math.hypot(p.velocity.x,p.velocity.y);
  peak=Math.max(peak,speed(a),speed(b));
  if(speed(a)<4.5&&speed(b)<4.5&&Math.hypot(a.position.x-b.position.x,a.position.y-b.position.y)<1.6)slow+=1/60;
  if(world.players.some(p=>Math.hypot(p.position.x-ball.x,p.position.y-ball.y)<=.6))return {seconds:tick/60,slow,peak};
 }
 return {seconds:3,slow,peak};
}
test('shared pursuit replaces obsolete momentum instead of both sprint commands circling a stopped ball',()=>{
 const old=race(false),fixed=race(true);
 assert.ok(fixed.seconds<old.seconds-.1,JSON.stringify({old,fixed}));
 assert.ok(fixed.slow<old.slow,JSON.stringify({old,fixed}));
 assert.ok(fixed.seconds<1.5);assert.ok(fixed.peak<=9.5,'normal rated speed ceiling remains');
 console.log('SCRIPTED_RACE_PROOF',JSON.stringify({old,fixed,paceMultiplier:1,responsivenessMultiplier:1}));
});
