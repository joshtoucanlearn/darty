(function(root){
  'use strict';
  // Input/UI only. The host owns the existing single-player handover.
  function create({navigator,document,pressed,canTakeOver,takeOver,disconnect,reconnect,finished,teams,now=()=>root.performance.now()}){
    let mode='hidden',side='you',index=null,deviceId='',selectBefore=false,backBefore=false,menuBefore=false,directionBefore=0,neutralRequired=true,neutralWait=0;
    let apiBlocked=false;
    let requestedAt=0,slowWait=false;
    const occupiedReconnectSlots=new Set();
    let panel=null,title=null,choices=null,help=null,home=null,away=null,actions=null,confirm=null,dismiss=null;
    // Copy values: browsers may mutate the same Gamepad/axes/buttons objects.
    // A timestamp tick is not input. Include unused axes and every button's
    // value, pressed and touched signals, without interpreting trigger rests.
    function request(){if(mode!=='choose')return;requestedAt=now();slowWait=false;mode='waiting';render();}
    function ensurePanel(){
      if(panel)return;
      const style=document.createElement('style');
      style.textContent='#spectatorTakeover{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:10000;width:min(360px,calc(100% - 24px));box-sizing:border-box;padding:12px;border:1px solid #e87824;border-left:4px solid #e87824;background:rgba(3,16,31,.96);color:#f7f1e7;font:700 12px/1.4 Arial,sans-serif}#spectatorTakeover[hidden]{display:none}#spectatorTakeover strong{display:block;margin-bottom:8px}#spectatorTakeover .takeoverChoices{display:flex;gap:8px;margin:8px 0}#spectatorTakeover .takeoverChoices[hidden]{display:none}#spectatorTakeover button{flex:1;min-width:0;background:#071a2d;color:inherit;border:1px solid #6d7886;padding:8px;font:inherit}#spectatorTakeover button[aria-pressed="true"]{outline:3px solid #ff9a3d;outline-offset:1px}#spectatorTakeover i{display:inline-block;width:16px;height:20px;border:1px solid #ddd;vertical-align:middle;margin-right:7px}#spectatorTakeover small{display:block}';
      document.head.appendChild(style);
      style.textContent+='#spectatorTakeover{bottom:max(12px,env(safe-area-inset-bottom));max-height:calc(100% - 24px);overflow:auto;overflow-wrap:anywhere}#spectatorTakeover button{min-height:44px;touch-action:manipulation}#spectatorTakeover .takeoverActions{display:flex;gap:8px;margin:8px 0}#spectatorTakeover .takeoverActions[hidden],#spectatorTakeover small[hidden],#spectatorTakeover button[hidden]{display:none}';
      panel=document.createElement('section');panel.id='spectatorTakeover';panel.setAttribute('aria-label','Join this match');
      title=document.createElement('strong');title.setAttribute('aria-live','polite');
      choices=document.createElement('div');choices.className='takeoverChoices';
      function choice(team,label){
        const button=document.createElement('button'),swatch=document.createElement('i'),name=document.createElement('span');
        button.type='button';button.setAttribute('data-controller-ignore','true');
        swatch.style.background=team.colour;swatch.style.borderRight='8px solid '+team.secondary;swatch.setAttribute('aria-hidden','true');
        name.textContent=label;/* Joshua, 1 Nov: no team names; the kit colours show which is which */button.append(swatch,name);choices.appendChild(button);return button;
      }
      home=choice(teams.you,'Home');away=choice(teams.opp,'Away');help=document.createElement('small');
      actions=document.createElement('div');actions.className='takeoverActions';
      confirm=document.createElement('button');dismiss=document.createElement('button');
      for(const button of [confirm,dismiss]){button.type='button';button.setAttribute('data-controller-ignore','true');actions.appendChild(button);}
      home.onclick=()=>{if(mode==='choose'){side='you';render();}};
      away.onclick=()=>{if(mode==='choose'){side='opp';render();}};
      confirm.onclick=()=>{if(mode==='dismissed'){mode='choose';render();}else request();};
      dismiss.onclick=()=>{if(mode==='choose'||mode==='waiting'){mode='dismissed';render();}};
      panel.append(title,choices,help,actions);document.body.appendChild(panel);
    }
    function render(){
      if(mode==='hidden'||mode==='active'){if(panel)panel.hidden=true;return;}
      ensurePanel();panel.hidden=false;choices.hidden=mode!=='choose';
      home.setAttribute('aria-pressed',String(side==='you'));away.setAttribute('aria-pressed',String(side==='opp'));
      title.textContent=mode==='choose'?'Pick a side and jump in':mode==='waiting'?(slowWait?'Taking over at the next stoppage':'Taking over…'):mode==='disconnected'?'Controller disconnected · match paused':mode==='reconnected'?'Controller reconnected':'Keep watching';
      const labels=/(xbox|xinput|045e)/i.test(deviceId)?['A','B','Menu']:/(nintendo|switch|joy-con|057e)/i.test(deviceId)?['B','A','+']:/(dual\s?sense|ps5|0?54c|wireless controller)/i.test(deviceId)?['×','○','Options']:['South button','East button','Menu'];
      help.textContent=mode==='choose'?`D-pad / left stick ← → · ${labels[0]} confirm · ${labels[1]} dismiss · ${labels[2]} reopens`:mode==='waiting'?`${side==='you'?'Home':'Away'} · ${labels[1]} cancel`:mode==='disconnected'?'Reconnect your controller to continue':mode==='reconnected'?`${labels[2]} resumes the match`:`${labels[2]} · Pick a side`;
      actions.hidden=!['choose','waiting','dismissed'].includes(mode);confirm.hidden=mode==='waiting';dismiss.hidden=mode==='dismissed';
      confirm.textContent=mode==='dismissed'?'Pick a side':'Play '+(side==='you'?'Home':'Away');dismiss.textContent=mode==='waiting'?'Cancel':'Keep watching';
    }
    function resetEdges(gp){selectBefore=pressed(gp,0);backBefore=pressed(gp,1);menuBefore=pressed(gp,9);directionBefore=0;neutralRequired=true;neutralWait=0;}
    // Only the inputs this prompt reads, through the game's mapping-aware pressed(). A whole-pad check
    // never settled on a real PS5 pad (Joshua, 1 Nov: "i cant select anything"): a raw DualSense rests
    // its triggers at -1 on axes 3 and 4, and other pads carry unused inputs that never read zero.
    function neutral(gp){
      for(const i of [0,1,9,12,13,14,15])if(pressed(gp,i))return false;
      return Math.abs(gp.axes[0]||0)<=.3&&Math.abs(gp.axes[1]||0)<=.3;
    }
    function poll(){
      let pads=null;
      if(!apiBlocked)try{if(typeof navigator.getGamepads==='function')pads=navigator.getGamepads();}catch(_){apiBlocked=true;/* iframe Permissions Policy: stay off until reload */}
      let gp=null,first=null;
      if(pads)for(let i=0;i<pads.length;i++){
        const p=pads[i];if(!p||p.connected===false)continue;
        if(!first||p.index<first.index)first=p;
        if(p.index===index&&p.id===deviceId)gp=p;
      }
      if(finished()){if(panel)panel.hidden=true;return mode==='active'?gp:null;}
      if(!gp&&(mode==='active'||mode==='reconnected')){
        occupiedReconnectSlots.clear();
        if(pads)for(let i=0;i<pads.length;i++)if(pads[i]&&pads[i].connected!==false)occupiedReconnectSlots.add(pads[i].index);
        disconnect();mode='disconnected';render();return null;
      }
      if(mode==='disconnected'){
        // A Bluetooth reconnect may receive a different browser slot. Do not
        // silently transfer ownership to an already-connected second device.
        if(!gp&&pads)for(let i=0;i<pads.length;i++)if(pads[i]&&pads[i].connected!==false&&pads[i].id===deviceId&&!occupiedReconnectSlots.has(pads[i].index)){gp=pads[i];break;}
        if(!gp)return null;
        index=gp.index;resetEdges(gp);reconnect(gp);mode='reconnected';render();
      }else if(!gp){
        if(!first){if(mode!=='hidden'){mode='hidden';index=null;render();}return null;}
        gp=first;index=gp.index;deviceId=gp.id;mode='choose';resetEdges(gp);render();
      }
      if(mode==='active')return gp;
      // Joshua, 1 Nov: no "no input" message; a connected controller is simply connected.
      const slow=mode==='waiting'&&now()-requestedAt>=3000;
      if(slow!==slowWait){slowWait=slow;render();}
      if(neutralRequired){if(neutral(gp)||++neutralWait>=75){resetEdges(gp);neutralRequired=false;}return null;} // about 1.25 s: a pad that never looks at rest still gets the prompt
      if(mode==='reconnected'){mode='active';render();return gp;}
      const select=pressed(gp,0),back=pressed(gp,1),menu=pressed(gp,9),x=gp.axes[0]||0;
      const direction=pressed(gp,14)||x<-.66?-1:pressed(gp,15)||x>.66?1:0;
      if(back&&!backBefore){mode='dismissed';render();}
      else if(mode==='dismissed'&&menu&&!menuBefore){mode='choose';render();}
      else if(mode==='choose'){
        if(direction&&direction!==directionBefore){side=direction<0?'you':'opp';render();}
        if(select&&!selectBefore)request();
      }
      selectBefore=select;backBefore=back;menuBefore=menu;directionBefore=direction;
      if(mode==='waiting'&&canTakeOver()){
        if(takeOver(side,gp)){mode='reconnected';resetEdges(gp);render();if(panel)panel.hidden=true;}
        else{mode='dismissed';render();}
      }
      return null;
    }
    return{poll,status:()=>({mode,side,index})};
  }
  root.DartySpectatorTakeover={create};
  if(typeof module==='object'&&module.exports)module.exports={create};
})(typeof window==='object'?window:globalThis);
