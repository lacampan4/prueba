
/* Carga el dataset importado desde IndexedDB (si existe) y arranca */
(async function(){
  try{
    const ds=await lcGet('dataset');
    if(ds&&ds.data){window.LC_DATA=ds.data;window.LC_INV=ds.inv||{};window.LC_DATA_IMPORTED=true;}
    const iv=await lcGet('inv');if(iv)window.LC_INV=Object.assign({},window.LC_INV||{},iv);
  }catch(e){console.warn('LC load',e);}
  (window.LCBoot||function(){})();
})();



/* ===== Tweaks · reshaping the feel (identidad, densidad, superficie) ===== */
(function(){
  const TWEAKS=/*EDITMODE-BEGIN*/{
    "accent": "ferrari",
    "density": "compact",
    "mood": "claro"
  }/*EDITMODE-END*/;
  const ACC={
    ferrari:{acc:'#E10600',acc2:'#B00500',fk:'#B00500',glow:'rgba(225,6,0,.05)',lab:'Ferrari'},
    cobalto:{acc:'#1667d6',acc2:'#0d4ba3',fk:'#0d4ba3',glow:'rgba(22,103,214,.06)',lab:'Cobalto'},
    esmeralda:{acc:'#0f9d63',acc2:'#0a7548',fk:'#0a7548',glow:'rgba(15,157,99,.06)',lab:'Esmeralda'},
    grafito:{acc:'#2b2f36',acc2:'#14161a',fk:'#14161a',glow:'rgba(20,22,26,.05)',lab:'Grafito'}
  };
  const DENS=[['compact','Compacto'],['regular','Regular'],['comfy','Holgado']];
  const MOOD=[['claro','Claro'],['dark','Grafito']];
  const root=document.documentElement,body=document.body;
  function apply(){
    const a=ACC[TWEAKS.accent]||ACC.ferrari;
    root.style.setProperty('--acc',a.acc);root.style.setProperty('--acc2',a.acc2);
    root.style.setProperty('--ferrari',a.acc);root.style.setProperty('--ferrari-dk',a.fk);
    root.style.setProperty('--glow1',a.glow);
    body.classList.remove('dens-compact','dens-comfy');
    if(TWEAKS.density==='compact')body.classList.add('dens-compact');
    else if(TWEAKS.density==='comfy')body.classList.add('dens-comfy');
    body.classList.toggle('mood-dark',TWEAKS.mood==='dark');
    paint();
  }
  function paint(){
    const accWrap=document.getElementById('twkAcc');
    accWrap.innerHTML=Object.entries(ACC).map(([k,v])=>`<button data-k="${k}" class="${k===TWEAKS.accent?'sel':''}" title="${v.lab}" style="background:linear-gradient(135deg,${v.acc},${v.acc2})"><span>${v.lab}</span></button>`).join('');
    document.getElementById('twkDens').innerHTML=DENS.map(([k,l])=>`<button data-k="${k}" class="${k===TWEAKS.density?'sel':''}">${l}</button>`).join('');
    document.getElementById('twkMood').innerHTML=MOOD.map(([k,l])=>`<button data-k="${k}" class="${k===TWEAKS.mood?'sel':''}">${l}</button>`).join('');
  }
  function set(key,val){TWEAKS[key]=val;apply();window.parent.postMessage({type:'__edit_mode_set_keys',edits:{[key]:val}},'*');}
  document.getElementById('twkAcc').addEventListener('click',e=>{const b=e.target.closest('button');if(b)set('accent',b.dataset.k);});
  document.getElementById('twkDens').addEventListener('click',e=>{const b=e.target.closest('button');if(b)set('density',b.dataset.k);});
  document.getElementById('twkMood').addEventListener('click',e=>{const b=e.target.closest('button');if(b)set('mood',b.dataset.k);});
  const panel=document.getElementById('twk');
  document.getElementById('twkX').addEventListener('click',()=>{panel.classList.remove('on');window.parent.postMessage({type:'__edit_mode_dismissed'},'*');});
  window.addEventListener('message',e=>{const t=e&&e.data&&e.data.type;if(t==='__activate_edit_mode')panel.classList.add('on');else if(t==='__deactivate_edit_mode')panel.classList.remove('on');});
  apply();
  window.parent.postMessage({type:'__edit_mode_available'},'*');
})();



(function(){
  var b=document.getElementById('backMenuBtn');
  if(b) b.addEventListener('click', function(){ window.location.href='menu.html'; });
})();


(function(){const modal=document.getElementById('lcExcelModal'),btn=document.getElementById('excelBtn'),drop=document.getElementById('lcExcelDrop'),inp=document.getElementById('lcExcelInput'),res=document.getElementById('lcExcelResult');if(!modal)return;document.getElementById('lcExcelTitle').textContent='Actualizar portafolio desde Excel';document.getElementById('lcExcelDesc').textContent='Carga el Excel comercial para actualizar la información del portafolio.';function open(){modal.style.display='flex';}function close(){modal.style.display='none';}if(btn)btn.addEventListener('click',open);document.getElementById('lcExcelClose').addEventListener('click',close);modal.addEventListener('click',e=>{if(e.target===modal)close();});drop.addEventListener('click',()=>inp.click());drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('over');});drop.addEventListener('dragleave',()=>drop.classList.remove('over'));drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('over');if(e.dataTransfer.files[0])handle(e.dataTransfer.files[0]);});inp.addEventListener('change',()=>{if(inp.files[0])handle(inp.files[0]);});function handle(file){res.innerHTML='✓ Archivo seleccionado: <b>'+file.name.replace(/[<>]/g,'')+'</b><br>Listo para procesar en este módulo.';}})();