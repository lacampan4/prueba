
(async function(){
  try{
    const ds=await lcGet('dataset');
    if(ds&&ds.data){window.LC_DATA=ds.data;window.LC_INV=ds.inv||{};window.LC_DATA_IMPORTED=true;}
  }catch(e){console.warn('LC load',e);}
  (window.LCBootAsesor||function(){})();
})();



(function(){
  var b=document.getElementById('backMenuBtn');
  if(b) b.addEventListener('click', function(){ window.location.href='menu.html'; });
})();


(function(){const modal=document.getElementById('lcExcelModal'),btn=document.getElementById('excelBtn'),drop=document.getElementById('lcExcelDrop'),inp=document.getElementById('lcExcelInput'),res=document.getElementById('lcExcelResult');if(!modal)return;document.getElementById('lcExcelTitle').textContent='Actualizar información del asesor desde Excel';document.getElementById('lcExcelDesc').textContent='Carga el Excel de información comercial utilizado por la Hoja de Asesor.';function open(){modal.style.display='flex';}function close(){modal.style.display='none';}if(btn)btn.addEventListener('click',open);document.getElementById('lcExcelClose').addEventListener('click',close);modal.addEventListener('click',e=>{if(e.target===modal)close();});drop.addEventListener('click',()=>inp.click());drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('over');});drop.addEventListener('dragleave',()=>drop.classList.remove('over'));drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('over');if(e.dataTransfer.files[0])handle(e.dataTransfer.files[0]);});inp.addEventListener('change',()=>{if(inp.files[0])handle(inp.files[0]);});function handle(file){res.innerHTML='✓ Archivo seleccionado: <b>'+file.name.replace(/[<>]/g,'')+'</b><br>Listo para procesar en este módulo.';}})();