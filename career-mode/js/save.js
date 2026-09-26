window.FLSave = (() => {
  const KEY = 'dartyCareerSaveV1';
  const DB_NAME = 'DartyCareerDB';
  const STORE_NAME = 'saves';
  const SLOT = 'main';
  let dbPromise = null;
  let writeQueue = Promise.resolve();
  let deferredTimer = null;
  let deferredGame = null;

  function openDatabase(){
    if(!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB unavailable'));
    if(dbPromise) return dbPromise;
    dbPromise = new Promise((resolve,reject)=>{
      const request = indexedDB.open(DB_NAME,1);
      request.onupgradeneeded = () => {
        const db=request.result;
        if(!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error||new Error('Could not open save database'));
      request.onblocked = () => reject(new Error('Save database is blocked by another tab'));
    });
    return dbPromise;
  }

  async function readIndexed(){
    const db=await openDatabase();
    return new Promise((resolve,reject)=>{
      const transaction=db.transaction(STORE_NAME,'readonly');
      const request=transaction.objectStore(STORE_NAME).get(SLOT);
      request.onsuccess=()=>resolve(request.result||null);
      request.onerror=()=>reject(request.error||new Error('Could not read save'));
    });
  }

  async function writeIndexed(game){
    const db=await openDatabase();
    return new Promise((resolve,reject)=>{
      const transaction=db.transaction(STORE_NAME,'readwrite');
      transaction.objectStore(STORE_NAME).put(game,SLOT);
      transaction.oncomplete=()=>resolve(true);
      transaction.onerror=()=>reject(transaction.error||new Error('Could not save game'));
      transaction.onabort=()=>reject(transaction.error||new Error('Save transaction was aborted'));
    });
  }

  function legacyLoad(){
    try{return JSON.parse(localStorage.getItem(KEY)||'null')}catch{return null}
  }

  async function load(){
    try{
      const saved=await readIndexed();
      if(saved)return window.FLOriginalNames?.restoreGame?.(saved)||saved;
    }catch(error){console.warn('Football Legacy: IndexedDB load unavailable; checking legacy storage.',error)}
    const legacy=legacyLoad();
    if(legacy){
      try{await save(legacy);localStorage.removeItem(KEY)}catch(error){console.warn('Football Legacy: legacy save migration deferred.',error)}
    }
    return window.FLOriginalNames?.restoreGame?.(legacy)||legacy;
  }

  function save(game){
    if(!game||typeof game!=='object')return Promise.reject(new Error('No game supplied'));
    game.meta=game.meta||{};
    game.meta.lastSaved=new Date().toISOString();
    writeQueue=writeQueue.catch(()=>{}).then(async()=>{
      try{
        await writeIndexed(game);
        try{localStorage.removeItem(KEY)}catch{}
        return true;
      }catch(error){
        // Small/early saves can still use the original storage as a browser fallback.
        try{localStorage.setItem(KEY,JSON.stringify(game));return true}catch(fallbackError){
          console.error('Football Legacy save failed.',error,fallbackError);
          throw error;
        }
      }
    });
    return writeQueue;
  }

  function saveSoon(game,delay=650){
    try{const pref=JSON.parse(localStorage.getItem('footballLegacySettingsV1')||'{}');if(Number(pref.autosaveDelay)>0&&Number(delay)===650)delay=Number(pref.autosaveDelay)}catch{}
    deferredGame=game;
    if(deferredTimer)clearTimeout(deferredTimer);
    deferredTimer=setTimeout(()=>{const target=deferredGame;deferredTimer=null;deferredGame=null;if(target)save(target).catch(()=>{});},Math.max(80,Number(delay)||650));
    return true;
  }

  function flush(game=deferredGame){
    const target=game||deferredGame;
    if(deferredTimer){clearTimeout(deferredTimer);deferredTimer=null;}
    deferredGame=null;
    return target?save(target):writeQueue;
  }

  async function clear(){
    await writeQueue.catch(()=>{});
    try{localStorage.removeItem(KEY)}catch{}
    try{
      const db=await openDatabase();
      await new Promise((resolve,reject)=>{
        const transaction=db.transaction(STORE_NAME,'readwrite');
        transaction.objectStore(STORE_NAME).delete(SLOT);
        transaction.oncomplete=()=>resolve();
        transaction.onerror=()=>reject(transaction.error||new Error('Could not delete save'));
      });
    }catch(error){console.warn('Football Legacy: database clear failed.',error)}
  }

  async function exists(){return Boolean(await load())}

  return {load,save,saveSoon,flush,clear,exists,key:KEY,storage:'IndexedDB'};
})();
