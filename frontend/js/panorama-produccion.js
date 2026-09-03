
/* Carga el dataset de producción importado desde IndexedDB (si existe) y arranca */
(async function(){
  try{
    const ds=await lcGet('prod_dataset');
    // sólo usar dataset importado si tiene la estructura nueva (recs[].k y recs[].mq + machines)
    if(ds&&ds.data&&ds.data.recs&&ds.data.recs[0]&&Array.isArray(ds.data.recs[0].k)&&typeof ds.data.recs[0].mq==='number'&&ds.data.machines){
      window.PROD_DATA=ds.data;window.PROD_DATA_IMPORTED=true;
    } else if(ds){ try{await lcDel('prod_dataset'); }catch(e){} }
    const cfg=await lcGet('prod_config');
    // sólo aplicar config si encaja con las máquinas reales del IPN (evita config vieja con otros nombres)
    if(cfg&&cfg.machines&&cfg.machines.length){
      const dnames=new Set((window.PROD_DATA.machines||[]).map(m=>m.name));
      if(cfg.machines.some(m=>dnames.has(m.name)))window.PROD_CONFIG=cfg;
      else try{await lcDel('prod_config');}catch(e){}
    }
  }catch(e){console.warn('LC prod load',e);}
  (window.LCBootProd||function(){})();
})();



(function(){
  var b=document.getElementById('backMenuBtn');
  if(b) b.addEventListener('click', function(){ window.location.href='menu.html'; });
})();
