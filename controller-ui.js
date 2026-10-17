(function(){
  'use strict';
  if(window.FootballLegacyControllerUI)return;

  const FOCUSABLE='button:not([disabled]),a[href],input:not([type="hidden"]):not([disabled]),select:not([disabled]),textarea:not([disabled]),[role="button"],[tabindex]:not([tabindex="-1"])';
  const padStates=new Map();
  let current=null,controllerMode=false,lastScope=null,hintTimer=0;

  const visible=el=>{
    if(!el||!el.isConnected)return false;
    const style=getComputedStyle(el),rect=el.getBoundingClientRect();
    return style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)!==0&&rect.width>1&&rect.height>1;
  };
  const openOverlay=()=>{
    const selectors=['.fullPage.open','[role="dialog"][open]','[role="dialog"].open','[role="dialog"].show','.modal.open','.modal.show','#ftime'];
    const found=[];selectors.forEach(selector=>document.querySelectorAll(selector).forEach(el=>{if(visible(el))found.push(el);}));
    return found.length?found[found.length-1]:null;
  };
  const activeScope=()=>{
    if(document.body?.dataset.controllerUiSuspended==='true')return null;
    const overlay=openOverlay();if(overlay)return overlay;
    if(document.querySelector('#c'))return null;
    return document.body;
  };
  const focusables=scope=>scope?[...scope.querySelectorAll(FOCUSABLE)].filter(el=>visible(el)&&!el.closest('[aria-hidden="true"]')&&!el.hasAttribute('data-controller-ignore')):[];
  const clearFocus=()=>{if(current)current.removeAttribute('data-controller-focus');current=null;};
  const setFocus=(el,announce=true)=>{
    if(!el||!visible(el))return false;if(current&&current!==el)current.removeAttribute('data-controller-focus');current=el;controllerMode=true;document.body.classList.add('controller-navigation');el.setAttribute('data-controller-focus','true');
    try{el.focus({preventScroll:true});}catch(e){el.focus();}el.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'});if(announce)showHint();return true;
  };
  const defaultFocus=scope=>{
    const list=focusables(scope);if(!list.length){clearFocus();return null;}
    const preferred=list.find(el=>el.matches('[data-controller-default],.primary,[autofocus]'))||list.find(el=>el.matches('input:checked,.selected,[aria-selected="true"]'))||list[0];setFocus(preferred,false);return preferred;
  };
  const ensureFocus=()=>{
    const scope=activeScope();if(scope!==lastScope){lastScope=scope;clearFocus();}
    if(!scope)return null;const list=focusables(scope);if(!current||!list.includes(current))return defaultFocus(scope);return current;
  };
  const fireChange=el=>{el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};
  const stepSelect=(el,delta)=>{
    if(!el||el.tagName!=='SELECT'||!el.options.length)return false;
    const next=Math.max(0,Math.min(el.options.length-1,el.selectedIndex+delta));
    if(next!==el.selectedIndex){el.selectedIndex=next;fireChange(el);}syncSelectStepper(el);return true;
  };
  const syncSelectStepper=el=>{
    const stepper=el&&el.closest&&el.closest('.controller-select-stepper');if(!stepper)return;
    const left=stepper.querySelector('[data-select-step="-1"]'),right=stepper.querySelector('[data-select-step="1"]');
    if(left)left.disabled=el.disabled||el.selectedIndex<=0;
    if(right)right.disabled=el.disabled||el.selectedIndex>=el.options.length-1;
    stepper.dataset.value=el.options[el.selectedIndex]&&el.options[el.selectedIndex].text||'';
  };
  const enhanceSelect=el=>{
    if(!el||el.tagName!=='SELECT'||el.dataset.controllerStepper==='true')return;
    el.dataset.controllerStepper='true';
    const stepper=document.createElement('span');stepper.className='controller-select-stepper';
    const makeArrow=(delta,label)=>{const button=document.createElement('button');button.type='button';button.className='controller-select-arrow';button.dataset.selectStep=String(delta);button.dataset.controllerIgnore='true';button.tabIndex=-1;button.setAttribute('aria-label',label);button.textContent=delta<0?'\u2039':'\u203a';button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();stepSelect(el,delta);setFocus(el,false);showHint('Left / Right changes the highlighted setting');});return button;};
    const parent=el.parentNode;parent.insertBefore(stepper,el);stepper.append(makeArrow(-1,'Previous option'),el,makeArrow(1,'Next option'));
    el.addEventListener('change',()=>syncSelectStepper(el));
    new MutationObserver(()=>syncSelectStepper(el)).observe(el,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','selected']});
    syncSelectStepper(el);
  };
  const enhanceSelects=root=>{
    if(root&&root.nodeType===1&&root.matches&&root.matches('select'))enhanceSelect(root);
    if(root&&root.querySelectorAll)root.querySelectorAll('select').forEach(enhanceSelect);
  };
  const adjustControl=(el,direction)=>{
    if(!el)return false;
    if(el.tagName==='SELECT'&&(direction==='left'||direction==='right'))return stepSelect(el,direction==='right'?1:-1);
    if(el.matches('input[type="range"],input[type="number"]')&&(direction==='left'||direction==='right')){direction==='right'?el.stepUp():el.stepDown();fireChange(el);return true;}
    return false;
  };
  const navigate=direction=>{
    const scope=activeScope();if(!scope)return;const list=focusables(scope);if(!list.length)return;const from=ensureFocus();if(!from){defaultFocus(scope);return;}if(adjustControl(from,direction)){showHint();return;}
    const a=from.getBoundingClientRect(),ax=a.left+a.width/2,ay=a.top+a.height/2,horizontal=direction==='left'||direction==='right',sign=direction==='right'||direction==='down'?1:-1;
    let best=null,bestScore=Infinity;
    for(const el of list){if(el===from)continue;const r=el.getBoundingClientRect(),bx=r.left+r.width/2,by=r.top+r.height/2,primary=(horizontal?bx-ax:by-ay)*sign;if(primary<=4)continue;const cross=Math.abs(horizontal?by-ay:bx-ax),overlap=horizontal?Math.max(0,Math.min(a.bottom,r.bottom)-Math.max(a.top,r.top)):Math.max(0,Math.min(a.right,r.right)-Math.max(a.left,r.left)),score=primary+cross*(overlap>0?.32:1.75);if(score<bestScore){bestScore=score;best=el;}}
    if(!best){const index=list.indexOf(from),delta=sign>0?1:-1;best=list[(index+delta+list.length)%list.length];}
    setFocus(best);
  };
  const activate=()=>{
    const el=ensureFocus();if(!el)return;
    if(el.tagName==='SELECT'){if(el.options.length){el.selectedIndex=(el.selectedIndex+1)%el.options.length;fireChange(el);syncSelectStepper(el);}showHint('Left / Right changes this setting · Cross cycles it');return;}
    if(el.matches('input[type="checkbox"],input[type="radio"]'))el.click();
    else if(el.matches('input,textarea')){el.focus();showHint('Use the keyboard to enter text · Circle returns');}
    else el.click();
  };
  const back=()=>{
    const scope=activeScope();if(!scope)return;const list=focusables(scope),patterns=[/back/i,/cancel/i,/close/i,/resume/i,/return/i,/exit/i];let target=null;
    for(const pattern of patterns){target=list.find(el=>pattern.test((el.textContent||el.getAttribute('aria-label')||el.id||'').trim()));if(target)break;}
    if(target){setFocus(target,false);target.click();return;}
    if(scope!==document.body){scope.dispatchEvent(new CustomEvent('controllerback',{bubbles:true}));return;}
    if(history.length>1)history.back();
  };
  const showHint=message=>{
    let hint=document.getElementById('controllerUiHint');if(!hint){hint=document.createElement('div');hint.id='controllerUiHint';hint.setAttribute('aria-live','polite');document.body.appendChild(hint);}
    hint.textContent=message||'D-pad / Left stick · Navigate    × · Select    ○ · Back';hint.classList.add('show');clearTimeout(hintTimer);hintTimer=setTimeout(()=>hint.classList.remove('show'),4200);
  };
  const isDualSenseDevice=gp=>!!gp&&/(dual\s?sense|ps5|(?:0?54c)[-:]0?ce6|wireless controller.*extended gamepad)/i.test(gp.id||'');
  const isXboxDevice=gp=>!!gp&&/(xbox|xinput|microsoft.*(?:controller|gamepad)|(?:0?45e)[-:](?:0?2d1|0?2dd|0?2ea|0?2fd|0?b12|0?b13))/i.test(gp.id||'');
  const isNintendoDevice=gp=>!!gp&&/(nintendo|switch(?:\s?pro)?|joy-?con|(?:0?57e)[-:](?:0?2006|0?2007|0?2009|0?200e))/i.test(gp.id||'');
  const controllerHint=(gp,state='active')=>isNintendoDevice(gp)?`Nintendo Switch controller ${state} · B select · A back`:isXboxDevice(gp)?`Xbox controller ${state} · A select · B back`:`DualSense ${state} · × select · ○ back`;
  const isRawDualSense=gp=>isDualSenseDevice(gp)&&gp.mapping!=='standard';
  const rawDualSenseButton={0:1,1:2,2:0,3:3,4:4,5:5,6:6,7:7,8:8,9:9,10:10,11:11};
  const RAW_DUALSENSE_HAT_VALUES=[-1,-.714286,-.428571,-.142857,.142857,.428571,.714286,1];
  const rawDualSenseDpad=(gp,index)=>{
    const value=gp.axes&&gp.axes.length>9?gp.axes[9]:null;
    if(!Number.isFinite(value)||value>1.14)return false;
    let sector=-1,nearest=Infinity;
    RAW_DUALSENSE_HAT_VALUES.forEach((candidate,candidateSector)=>{const distance=Math.abs(value-candidate);if(distance<nearest){nearest=distance;sector=candidateSector;}});
    // A freshly reconnected Bluetooth DualSense can briefly expose a zeroed
    // axis-9 packet. Zero is not a valid Firefox hat position, but rounding it
    // used to turn that packet into a permanently repeating D-pad Down input.
    if(nearest>.08)return false;
    if(index===12)return sector===0||sector===1||sector===7;
    if(index===13)return sector===3||sector===4||sector===5;
    if(index===14)return sector===5||sector===6||sector===7;
    if(index===15)return sector===1||sector===2||sector===3;
    return false;
  };
  const buttonPressed=(gp,index,threshold=.5)=>{const button=gp&&gp.buttons&&gp.buttons[index];return !!(button&&(button.pressed||button.value>threshold));};
  const pressed=(gp,index,threshold=.5)=>{
    // Firefox has exposed the same wired DualSense D-pad in two different
    // shapes: ordinary buttons 12-15 on some Macs, and a hat value on axis 9
    // on others. Accept either representation instead of forcing one.
    if(isDualSenseDevice(gp)&&index>=12&&index<=15)return buttonPressed(gp,index,threshold)||(isRawDualSense(gp)&&rawDualSenseDpad(gp,index));
    const rawIndex=isRawDualSense(gp)&&(index in rawDualSenseButton)?rawDualSenseButton[index]:index;
    return buttonPressed(gp,rawIndex,threshold);
  };
  const meaningfulInput=gp=>{
    if(!gp)return false;
    const stickActive=[...(gp.axes||[])].slice(0,4).some(value=>Number.isFinite(value)&&Math.abs(value)>.18);
    const buttonActive=[...(gp.buttons||[])].some(button=>button&&(button.pressed||Number(button.value)>.15));
    const rawDpadActive=isRawDualSense(gp)&&[12,13,14,15].some(index=>rawDualSenseDpad(gp,index));
    return stickActive||buttonActive||rawDpadActive;
  };
  const directionFor=gp=>{if(pressed(gp,12))return'up';if(pressed(gp,13))return'down';if(pressed(gp,14))return'left';if(pressed(gp,15))return'right';const x=gp.axes&&gp.axes.length>1?gp.axes[0]:0,y=gp.axes&&gp.axes.length>1?gp.axes[1]:0;if(Math.abs(x)>.66||Math.abs(y)>.66)return Math.abs(x)>Math.abs(y)?(x>0?'right':'left'):(y>0?'down':'up');return null;};
  const processGamepad=(gp,now=performance.now())=>{
    if(!gp)return null;
    let state=padStates.get(gp.index);if(!state){state={buttons:[],direction:null,nextMove:0,inputObserved:false,lastInputAt:0};padStates.set(gp.index,state);}
      const inputActive=meaningfulInput(gp),firstInput=inputActive&&!state.inputObserved;if(inputActive){state.inputObserved=true;state.lastInputAt=now;}if(firstInput)showHint(controllerHint(gp));
      const scope=activeScope(),uiActive=!!scope;if(uiActive){const cross=pressed(gp,0),circle=pressed(gp,1);if(cross&&!state.buttons[0]){controllerMode=true;ensureFocus();activate();}if(circle&&!state.buttons[1]){controllerMode=true;back();}
        const direction=directionFor(gp);if(direction!==state.direction){state.direction=direction;if(direction){controllerMode=true;ensureFocus();navigate(direction);state.nextMove=now+310;}}else if(direction&&now>=state.nextMove){navigate(direction);state.nextMove=now+135;}
      }else state.direction=null;
      for(const i of [0,1,4,5,12,13,14,15])state.buttons[i]=pressed(gp,i);
    return{detected:true,inputObserved:state.inputObserved,inputActive,lastInputAt:state.lastInputAt,select:pressed(gp,0),back:pressed(gp,1),previousSection:pressed(gp,4),nextSection:pressed(gp,5),direction:directionFor(gp)};
  };
  const poll=now=>{
    let pads=[];if(document.body?.dataset.controllerExternalGamepad!=='true'){try{pads=typeof navigator.getGamepads==='function'?[...(navigator.getGamepads()||[])].filter(Boolean):[];}catch(e){}}
    for(const gp of pads){processGamepad(gp,now);
    }
    requestAnimationFrame(poll);
  };
  const style=document.createElement('style');style.textContent=`
    body.controller-navigation [data-controller-focus="true"]{outline:4px solid #ff9a3d!important;outline-offset:3px!important;box-shadow:0 0 0 7px rgba(232,120,36,.24),0 12px 32px rgba(0,0,0,.34)!important;position:relative;z-index:2}
    .controller-select-stepper{width:100%;min-width:0;display:grid;grid-template-columns:34px minmax(0,1fr) 34px;align-items:stretch;border:1px solid rgba(255,255,255,.15);background:#071a2d}.controller-select-stepper select{width:100%;min-width:0;border:0!important;text-align:center;text-align-last:center;appearance:none;-webkit-appearance:none;background:#071a2d;padding:0 7px!important}.controller-select-stepper select:focus{box-shadow:inset 0 0 0 2px #e87824}.controller-select-arrow{width:34px;min-width:34px;border:0;border-right:1px solid rgba(255,255,255,.11);background:rgba(232,120,36,.10);color:#f28b38;font:900 25px/1 Arial,sans-serif;cursor:pointer}.controller-select-arrow:last-child{border-right:0;border-left:1px solid rgba(255,255,255,.11)}.controller-select-arrow:hover:not(:disabled){background:#e87824;color:#03101f}.controller-select-arrow:disabled{opacity:.22;cursor:default}body.controller-navigation .controller-select-stepper:has(select[data-controller-focus="true"]){border-color:#ff9a3d;background:rgba(232,120,36,.12)}
    #controllerUiHint{position:fixed;right:16px;bottom:16px;z-index:99999;max-width:calc(100% - 32px);padding:9px 13px;border:1px solid rgba(232,120,36,.65);border-left:4px solid #e87824;background:rgba(3,16,31,.95);color:#f7f1e7;font:800 11px/1.35 Arial,sans-serif;letter-spacing:.07em;text-transform:uppercase;opacity:0;transform:translateY(8px);pointer-events:none;transition:.16s}#controllerUiHint.show{opacity:1;transform:none}`;document.head.appendChild(style);
  enhanceSelects(document);
  new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(enhanceSelects))).observe(document.documentElement,{childList:true,subtree:true});
  addEventListener('gamepadconnected',event=>{padStates.delete(event.gamepad.index);showHint(controllerHint(event.gamepad,'detected')+' · press a button to activate');});
  addEventListener('gamepaddisconnected',event=>{padStates.delete(event.gamepad.index);});
  addEventListener('pointerdown',()=>{controllerMode=false;document.body.classList.remove('controller-navigation');clearFocus();},{passive:true});
  addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Escape'].includes(e.key)){controllerMode=false;document.body.classList.remove('controller-navigation');}});
  window.FootballLegacyControllerUI={focus:target=>target?setFocus(target,false):ensureFocus(),navigate,activate,back,receiveGamepad:(gp,now)=>processGamepad(gp,now),forgetGamepad:index=>padStates.delete(index),getGamepadReadiness:gp=>{const state=gp&&padStates.get(gp.index);return{detected:!!gp,inputObserved:!!(state&&state.inputObserved),lastInputAt:Number(state&&state.lastInputAt)||0};},debugGamepadDirection:gp=>directionFor(gp),debugGamepadContract:gp=>({xbox:isXboxDevice(gp),dualSense:isDualSenseDevice(gp),nintendo:isNintendoDevice(gp),standard:gp&&gp.mapping==='standard',layout:isNintendoDevice(gp)?'nintendo-switch-positional':isXboxDevice(gp)?'xbox-standard':isRawDualSense(gp)?'firefox-raw-dualsense':'standard',faceLabels:isNintendoDevice(gp)?{select:'B',back:'A',lob:'Y',through:'X'}:isXboxDevice(gp)?{select:'A',back:'B',lob:'X',through:'Y'}:{select:'×',back:'○',lob:'□',through:'△'},meaningfulInput:meaningfulInput(gp),select:pressed(gp,0),back:pressed(gp,1),previousSection:pressed(gp,4),nextSection:pressed(gp,5),dpadDown:pressed(gp,13),direction:directionFor(gp)}),debugSelectSteppers:()=>({selects:document.querySelectorAll('select').length,enhanced:document.querySelectorAll('.controller-select-stepper>select').length,visibleArrows:[...document.querySelectorAll('.controller-select-arrow')].filter(visible).length})};requestAnimationFrame(poll);
})();
