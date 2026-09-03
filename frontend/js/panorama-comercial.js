
/* Carga el dataset importado desde IndexedDB (si existe) y arranca */
(async function(){
  try{
    const ds=await lcGet('dataset');
    if(ds&&ds.data){window.LC_DATA=ds.data;window.LC_INV=ds.inv||{};window.LC_DATA_IMPORTED=true;}
    const iv=await lcGet('inv');if(iv)window.LC_INV=Object.assign({},window.LC_INV||{},iv);
  }catch(e){console.warn('LC load',e);}
  (window.LCBootComercial||function(){})();
  (window.LCBoot||function(){})();

  /* pestañas */
  (function(){
    const bts=document.querySelectorAll('.tabs .tabbtn');
    const secs={com:document.getElementById('tab-com'),pf:document.getElementById('tab-pf')};
    function setTab(t){
      for(const k in secs)secs[k].style.display=(k===t)?'':'none';
      bts.forEach(b=>b.classList.toggle('on',b.dataset.tab===t));
      try{localStorage.setItem('LC_COM_TAB',t);}catch(e){}
    }
    bts.forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
    let t='com';try{t=localStorage.getItem('LC_COM_TAB')||'com';}catch(e){}
    if(location.hash==='#portafolio')t='pf';
    if(!secs[t])t='com';
    setTab(t);
  })();
})();



(function(){
  var b=document.getElementById('backMenuBtn');
  if(b) b.addEventListener('click', function(){ window.location.href='menu.html'; });
})();
