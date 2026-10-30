import {createHeadlessMatch} from '../../tools/headless-cpu-match.mjs';
export function attackingHost(seed=91){
 const payload={mode:'quickPlay',matchType:'spectator',practiceMode:null,online:null,
  engine:{requested:'fl-v2',effective:'fl-v2',version:'1.0.0-offline-live-authority-playtest',fallbackReason:null},
  simulationSeed:seed,homeTeam:{id:'fixture-home',name:'Home'},awayTeam:{id:'fixture-away',name:'Away'},
  controllers:{player1Team:null,player2Team:null,aiTeam:'both'}};
 const url='http://darty.local/match.html?quickPlay=1&engine=fl-v2&candidate=5#flMatch='+Buffer.from(JSON.stringify(payload)).toString('base64url');
 return createHeadlessMatch(url,{seed,minutes:6,scripted:true});
}
export const liveScene=`
 if(!started)focusGame(CONFIG.difficulty);matchPhase='play';paused=false;matchOver=false;resetUntil=0;resetPause=0;kickoffHeld=false;clearRestartState();
 goalReplay.active=false;disciplineReplay.active=false;foulSequence=null;offsidePresentation=null;offsideCandidate=null;clockRunning=true;celebrate=0;halfTimeUntil=0;instantGoalShot=null;
 for(const p of [...you,...opp]){p.vx=p.vy=0;p.stun=0;p.slide=0;p.skill=0;p.receiveT=0;p.aerialLockUntil=0;}
 liveV2Authority.reset('scripted-scene');liveV2Tick=0;liveV2WasEligible=false;liveV2PendingLaunch=null;liveV2DribbleLeaseOwnerId=null;liveV2PendingDribbleAction=null;
`;
