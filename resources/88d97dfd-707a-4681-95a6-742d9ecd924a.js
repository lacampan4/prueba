/* Carga unificada del Excel de facturación · La Campana V2.0
   Un solo archivo alimenta a la vez el dataset comercial (clave 'dataset') y el
   agregado de margen y cartera (clave 'margen'). El botón aparece en todos los
   tableros de la familia comercial; el trabajo lo hace Panorama Comercial, que es
   la única página que tiene cargados los dos lectores — así no hay dos parsers.
   Producción, Costos e Inventario mantienen su propia carga, independiente. */
(function(){
'use strict';
const DUENO='Panorama Comercial.html';
window.LCIMPORT=true; // los tableros con carga propia delegan en esta vía
const puede=()=>typeof window.rebuildRaw==='function'&&typeof window.LCMargenAgregar==='function';
const nf=n=>new Intl.NumberFormat('es-CO').format(Math.round(n||0));

const css=document.createElement('style');
css.textContent='#excelBtn,#btnImp,#excelBtn2{display:none!important}'+
 '.lcimp-tools{display:flex;gap:10px;align-items:center;flex-wrap:wrap}'+
 '.lcimp-btn{background:linear-gradient(145deg,var(--acc,#E10600),var(--ferrari-dk,#B00500));border:none;color:#fff;font-family:Oswald,sans-serif;font-weight:600;font-size:13px;letter-spacing:.5px;text-transform:uppercase;padding:11px 16px;border-radius:10px;cursor:pointer;box-shadow:0 2px 8px rgba(225,6,0,.18);transition:.15s;line-height:1}'+
 '.lcimp-btn:hover{filter:brightness(1.08);transform:translateY(-1px)}'+
 '.lcimp-btn.gh{background:var(--panel,#fff);border:1px solid var(--line2,#d2d6db);color:var(--txt,#14161a);box-shadow:none;text-decoration:none;display:inline-block}'+
 '.lcimp-btn.gh:hover{border-color:var(--acc,#E10600);color:var(--acc,#E10600)}'+
 '.lcimp-modal{display:none;position:fixed;inset:0;background:rgba(20,22,26,.5);z-index:120;align-items:center;justify-content:center;padding:24px}'+
 '.lcimp-modal.show{display:flex}'+
 '.lcimp-card{background:var(--panel,#fff);border:1px solid var(--line2,#d2d6db);border-radius:16px;max-width:600px;width:100%;overflow:hidden}'+
 '.lcimp-h{display:flex;justify-content:space-between;align-items:center;padding:16px 19px;border-bottom:1px solid var(--line,#e3e5e9)}'+
 '.lcimp-h h3{font-family:Oswald,sans-serif;font-weight:500;font-size:15px;letter-spacing:.6px;text-transform:uppercase;margin:0}'+
 '.lcimp-h button{background:none;border:none;font-size:22px;line-height:1;color:var(--txt3,#949aa1);cursor:pointer}'+
 '.lcimp-b{padding:19px}'+
 '.lcimp-b p{font-size:12.5px;color:var(--txt2,#5a6066);line-height:1.6;margin:0 0 12px}'+
 '.lcimp-drop{border:2px dashed var(--line2,#d2d6db);border-radius:12px;padding:30px 20px;text-align:center;cursor:pointer;color:var(--txt2,#5a6066);font-size:13px}'+
 '.lcimp-drop:hover,.lcimp-drop.over{border-color:var(--acc,#E10600);color:var(--acc,#E10600)}'+
 '.lcimp-feeds{display:grid;gap:7px;margin-top:14px;font-family:"IBM Plex Mono",monospace;font-size:11.5px;color:var(--txt3,#949aa1)}'+
 '.lcimp-feeds b{color:var(--txt2,#5a6066);font-weight:600}'+
 '.lcimp-st{font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--txt2,#5a6066);margin-top:14px;line-height:1.6}'+
 '.lcimp-st.ok{color:var(--green,#1f8a5b)}.lcimp-st.bad{color:var(--red,#E10600)}';
document.head.appendChild(css);

function boton(){
 let tools=document.querySelector('.htools');
 if(!tools){const h=document.querySelector('header');if(!h)return null;
  tools=document.createElement('div');tools.className='htools lcimp-tools';h.appendChild(tools);}
 const b=document.createElement('button');
 b.className='lcimp-btn';b.type='button';b.textContent='Cargar Excel';
 b.title='Un archivo actualiza el panorama comercial, el margen y la cartera';
 tools.insertBefore(b,tools.firstChild);
 /* Tableros que consumen existencias pero no las cargan: enlace al único cargador */
 if(document.querySelector('script[src="lcimport.js"][data-inventario]')){
  const a=document.createElement('a');a.className='lcimp-btn gh';a.href='Surtidos Sedes.html?inventario=1';
  a.textContent='Cargar inventario';a.title='El inventario viene en otro archivo: el export de existencias por almacén';
  tools.insertBefore(a,b.nextSibling);
 }
 return b;
}

function modal(){
 const m=document.createElement('div');m.className='lcimp-modal';
 m.innerHTML='<div class="lcimp-card"><div class="lcimp-h"><h3>Cargar Excel de facturación</h3><button type="button" data-x>×</button></div>'+
  '<div class="lcimp-b"><p>Una fila por línea de factura. Un solo archivo actualiza todo el panorama comercial. Se procesa en este navegador: no se sube a ningún servidor.</p>'+
  '<div class="lcimp-drop" data-drop>Arrastra el archivo aquí o <b>haz clic para elegirlo</b></div>'+
  '<input type="file" accept=".xlsx,.xls,.csv" style="display:none" data-file>'+
  '<div class="lcimp-feeds"><div><b>Comercial · Portafolio · Asesor · Cliente</b> — clientes, kilos, cupos y metas</div>'+
  '<div><b>Margen y cartera</b> — valor facturado, costo por kilo, mora e IVA</div>'+
  '<div><b>Planeación Nogales</b> — demanda mensual por artículo</div></div>'+
  '<div class="lcimp-st" data-st></div></div></div>';
 document.body.appendChild(m);
 return m;
}

function arranca(){
 const btn=boton();if(!btn)return;
 let m=null,st,drop,inp;
 /* el modal se arma en el primer clic: los lectores se registran cuando el tablero
    termina de arrancar, después de que corre este script */
 function abre(){
  if(!puede()){location.href=DUENO+'?importar=1';return}
  if(!m)arma();
  m.classList.add('show');
 }
 btn.onclick=abre;
 function arma(){
  m=modal();st=m.querySelector('[data-st]');drop=m.querySelector('[data-drop]');inp=m.querySelector('[data-file]');
  m.querySelector('[data-x]').onclick=()=>m.classList.remove('show');
 drop.onclick=()=>inp.click();
 inp.onchange=e=>{if(e.target.files[0])procesa(e.target.files[0])};
 ['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('over')}));
 ['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('over')}));
 drop.addEventListener('drop',e=>{if(e.dataTransfer.files[0])procesa(e.dataTransfer.files[0])});
 }
 if(/[?&]importar=1/.test(location.search)){let n=0;const iv=setInterval(function(){if(puede()){clearInterval(iv);abre()}else if(++n>60)clearInterval(iv)},250);}

 async function procesa(file){
  const di=(t,c)=>{st.className='lcimp-st'+(c?' '+c:'');st.innerHTML=t};
  try{
   di('Leyendo '+file.name+'…');
   const wb=XLSX.read(new Uint8Array(await file.arrayBuffer()),{type:'array'});
   di('Reconstruyendo clientes, kilos y cupos…');
   const full=window.rebuildRaw(wb);
   if(!full||!full.DATA||!Object.keys(full.DATA.clients).length)
    return di('No reconocí el archivo como export de facturación. Debe traer Codigo de Articulo, Fecha de Factura y Kilos.','bad');
   await lcSet('dataset',{data:full.DATA,inv:full.INV});
   try{await lcDel('inv')}catch(e){}
   const r=full.report||{};
   di('Agregando margen y cartera…');
   const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,blankrows:false,raw:true});
   const M=window.LCMargenAgregar(rows);
   await lcSet('margen',M);
   di('<b>Listo.</b><br>'+nf(Object.keys(full.DATA.clients).length)+' clientes · '+full.DATA.months.length+' meses ('+full.DATA.months.join(', ')+')'+
     (r.filas?'<br>'+nf(r.filas)+' filas de venta':'')+
     '<br>'+nf(M.filas)+' líneas de factura agregadas para margen y cartera'+
     '<br>Recargando…','ok');
   setTimeout(()=>location.reload(),1600);
  }catch(e){di('No se pudo procesar: '+(e&&e.message||e),'bad')}
 }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',arranca);else arranca();
})();
