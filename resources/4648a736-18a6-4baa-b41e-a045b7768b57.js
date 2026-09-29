/* Almacén IndexedDB compartido · La Campana REC
   Guarda el dataset importado (agregado) para que lo usen todas las páginas.
   V2.0 · multi-año: los datasets mensuales se guardan por año (clave@AAAA). El año
   se detecta de las fechas del propio archivo; el año activo se comparte entre tableros. */
(function(){
'use strict';
var DB='lacampana_rec', STORE='kv', VER=1;
var SCOPED={dataset:1,margen:1,prod_dataset:1,prod_daily_dataset:1};
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
function rGet(key){return open().then(function(db){return new Promise(function(res,rej){
  var tx=db.transaction(STORE,'readonly'),rq=tx.objectStore(STORE).get(key);
  rq.onsuccess=function(){res(rq.result||null);};rq.onerror=function(){rej(rq.error);};
});});}
function rSet(key,val){return open().then(function(db){return new Promise(function(res,rej){
  var tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(val,key);
  tx.oncomplete=function(){res(true);};tx.onerror=function(){rej(tx.error);};
});});}
function rDel(key){return open().then(function(db){return new Promise(function(res,rej){
  var tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(key);
  tx.oncomplete=function(){res(true);};tx.onerror=function(){rej(tx.error);};
});});}

/* ---- años ---- */
function yearOf(v){
  if(!v||typeof v!=='object')return null;var c={};
  function add(a){if(!a)return;
    if(Array.isArray(a))a.forEach(function(x){var s=typeof x==='string'?x:(x&&(x.key||x.k||x.m||x.d));var m=/^(20\d\d)/.exec(String(s||''));if(m)c[m[1]]=(c[m[1]]||0)+1;});
    else if(typeof a==='object')add(Object.keys(a));}
  var d=v.data||v;add(d.months);add(d.days);add(d.dates);add(d.meses);add(d.mesesArr);
  var best=null,n=0;for(var y in c)if(c[y]>n){n=c[y];best=+y;}return best;
}
function ls(k,v){try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v);}catch(e){return null;}}
function years(key){var a=[];try{a=JSON.parse(ls('LC_ANIOS_'+key)||'[]')||[];}catch(e){}return a;}
function addYear(key,y){if(!y)return;var a=years(key);if(a.indexOf(y)<0){a.push(y);a.sort();ls('LC_ANIOS_'+key,JSON.stringify(a));}
  var g=[];try{g=JSON.parse(ls('LC_ANIOS')||'[]')||[];}catch(e){}if(g.indexOf(y)<0){g.push(y);g.sort();ls('LC_ANIOS',JSON.stringify(g));}}
function allYears(){var g=[];try{g=JSON.parse(ls('LC_ANIOS')||'[]')||[];}catch(e){}return g;}
function active(){var y=+ls('LC_ANIO');if(y)return y;var g=allYears();return g.length?g[g.length-1]:null;}
function effective(key){var a=years(key),y=active();if(!a.length)return y;if(y&&a.indexOf(y)>=0)return y;
  var le=a.filter(function(x){return !y||x<=y;});return le.length?le[le.length-1]:a[a.length-1];}

/* datos de referencia embebidos (se capturan antes de que el tablero los reemplace) */
var SEED={};
if(window.LC_DATA)SEED.dataset={data:window.LC_DATA,inv:window.LC_INV};
if(window.PROD_DATA)SEED.prod_dataset={data:window.PROD_DATA};
Object.keys(SEED).forEach(function(k){addYear(k,yearOf(SEED[k]));});

function getYear(key,y){
  return rGet(key+'@'+y).then(function(v){if(v)return v;
    return rGet(key).then(function(l){
      if(l){var ly=yearOf(l);if(ly===y||ly===null)return l;}
      if(SEED[key]&&yearOf(SEED[key])===y)return SEED[key];
      return null;});});
}
window.lcGet=function(key){
  if(!SCOPED[key])return rGet(key);
  var y=effective(key);
  if(!y)return rGet(key);
  return rGet(key+'@'+y).then(function(v){if(v)return v;
    return rGet(key).then(function(l){if(!l)return null;var ly=yearOf(l);if(ly)addYear(key,ly);return (ly===y||ly===null)?l:null;});});
};
window.lcSet=function(key,val){
  if(!SCOPED[key])return rSet(key,val);
  var y=yearOf(val);if(!y)return rSet(key,val);
  /* migra el dato anterior sin año a su clave anual antes de escribir el nuevo */
  return rGet(key).then(function(l){
    if(!l)return;var ly=yearOf(l);if(!ly)return;
    return rGet(key+'@'+ly).then(function(e){return (e||ly===y?Promise.resolve():rSet(key+'@'+ly,l)).then(function(){addYear(key,ly);return rDel(key);});});
  }).catch(function(){}).then(function(){
    return rSet(key+'@'+y,val).then(function(r){addYear(key,y);ls('LC_ANIO',String(y));return r;});
  });
};
window.lcDel=function(key){
  if(!SCOPED[key])return rDel(key);
  var y=effective(key);
  return rDel(key+'@'+y).then(function(){return rGet(key);}).then(function(l){if(l&&(yearOf(l)===y||yearOf(l)===null))return rDel(key);return true;});
};
window.lcYearOf=yearOf;
window.lcGetYear=getYear;
window.lcAnios=function(key){return key?years(key):allYears();};
window.lcAnio=function(key){return key?effective(key):active();};
window.lcSetAnio=function(y){ls('LC_ANIO',String(y));};
})();
