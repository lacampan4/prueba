/* Almacén IndexedDB compartido · La Campana REC
   Guarda el dataset importado (agregado) para que lo usen ambas páginas. */
(function(){
'use strict';
var DB='lacampana_rec', STORE='kv', VER=1;
function open(){return new Promise(function(res,rej){
  if(typeof indexedDB==='undefined'||!indexedDB){rej(new Error('idb no disponible'));return;}
  var done=false;
  var to=setTimeout(function(){if(!done){done=true;rej(new Error('idb timeout'));}},1500);
  function fail(e){if(done)return;done=true;clearTimeout(to);rej(e);}
  function ok(db){if(done)return;done=true;clearTimeout(to);res(db);}
  try{
    var rq=indexedDB.open(DB,VER);
    rq.onupgradeneeded=function(){var db=rq.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE);};
    rq.onsuccess=function(){ok(rq.result);};
    rq.onerror=function(){fail(rq.error);};
    rq.onblocked=function(){fail(new Error('idb bloqueado'));};
  }catch(e){fail(e);}
});}
window.lcGet=function(key){return open().then(function(db){return new Promise(function(res,rej){
  var tx=db.transaction(STORE,'readonly'),rq=tx.objectStore(STORE).get(key);
  rq.onsuccess=function(){res(rq.result||null);};rq.onerror=function(){rej(rq.error);};
});});};
window.lcSet=function(key,val){return open().then(function(db){return new Promise(function(res,rej){
  var tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(val,key);
  tx.oncomplete=function(){res(true);};tx.onerror=function(){rej(tx.error);};
});});};
window.lcDel=function(key){return open().then(function(db){return new Promise(function(res,rej){
  var tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(key);
  tx.oncomplete=function(){res(true);};tx.onerror=function(){rej(tx.error);};
});});};
})();
