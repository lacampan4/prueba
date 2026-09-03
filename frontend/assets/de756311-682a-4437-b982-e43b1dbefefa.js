/* Hoja de Despacho · importador de facturas SAP (pegado desde Excel) · La Campana */
(function(){
'use strict';
let PARSED=null;

const norm=s=>s.toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[.\s_-]+/g,' ').trim();
const ALIAS={
  fac:['factura','nro factura','no factura','documento','doc factura','documento comercial','doc facturacion','vbeln'],
  fecha:['fecha','fecha factura','fecha de factura','fe contabilizacion','fecha contabilizacion','fkdat'],
  cli:['cliente','nombre cliente','razon social','destinatario','solicitante'],
  dir:['direccion','direccion de entrega','direccion entrega','destino'],
  ase:['asesor','vendedor','comercial','empleado responsable','nombre asesor'],
  mail:['correo','email','e mail','correo asesor','mail'],
  cod:['codigo','material','articulo','cod','sku','numero de articulo','codigo articulo','codigo material'],
  desc:['descripcion','texto breve','texto breve de material','texto','denominacion'],
  grp:['grupo','grupo de articulos','categoria','familia','linea'],
  kg:['kilos','kg','peso','peso neto','kgs','peso total'],
  un:['unidades','un','cantidad','ctd','uds','cantidad facturada','ctd facturada']
};
function mapHeader(cells){
  const m={};
  cells.forEach((h,i)=>{const n=norm(h);
    for(const key in ALIAS){if(m[key]===undefined&&ALIAS[key].some(a=>n===a||n.startsWith(a))){m[key]=i;return;}}});
  return m;
}
function parseNum(raw){
  if(raw==null)return 0;let s=raw.toString().trim();if(!s)return 0;
  let neg=false;
  if(s.startsWith('-')){neg=true;s=s.slice(1);}
  if(s.endsWith('-')){neg=true;s=s.slice(0,-1);}
  s=s.replace(/\s/g,'');
  if(/,\d{1,3}$/.test(s))s=s.replace(/\./g,'').replace(',','.');
  else if(/^\d{1,3}(\.\d{3})+$/.test(s))s=s.replace(/\./g,'');
  else s=s.replace(/,/g,'');
  const v=parseFloat(s);if(isNaN(v))return 0;
  return neg?-v:v;
}
function parseFecha(s){
  s=s.toString().trim();
  let m=s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);if(m)return m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');
  m=s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);if(m)return m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');
  return null;
}
function splitRows(text){
  const lines=text.split(/\r?\n/).filter(l=>l.trim());
  if(!lines.length)return null;
  const delim=lines[0].includes('\t')?'\t':(lines[0].includes(';')?';':',');
  return lines.map(l=>l.split(delim).map(c=>c.replace(/^"|"$/g,'').trim()));
}

function parseFacturas(text){
  const rows=splitRows(text);if(!rows||rows.length<2)throw'Pega los datos con la fila de encabezados.';
  const h=mapHeader(rows[0]);
  if(h.fac===undefined)throw'No encuentro la columna de número de factura.';
  if(h.fecha===undefined)throw'No encuentro la columna de fecha.';
  if(h.cod===undefined)throw'No encuentro la columna de código/material.';
  if(h.kg===undefined&&h.un===undefined)throw'No encuentro columnas de kilos ni de cantidad.';
  const map={},order=[];let n=0;
  for(let i=1;i<rows.length;i++){const r=rows[i];if(!r[h.fac]||!r[h.cod])continue;
    const fecha=parseFecha(r[h.fecha]||'');if(!fecha)continue;
    const id=r[h.fac].trim();
    let f=map[id];
    if(!f){f=map[id]={id:id,fecha:fecha,
      cliente:h.cli!==undefined?(r[h.cli]||'').toUpperCase().trim():'',
      dir:h.dir!==undefined?(r[h.dir]||'').trim():'',
      asesor:h.ase!==undefined?(r[h.ase]||'').toUpperCase().trim():'',
      correo:h.mail!==undefined?(r[h.mail]||'').trim():'',
      estado:'pendiente',placa:null,lineas:[]};order.push(id);}
    f.lineas.push({cod:r[h.cod].trim(),
      d:h.desc!==undefined&&r[h.desc]?r[h.desc]:r[h.cod].trim(),
      g:h.grp!==undefined&&r[h.grp]?r[h.grp].toUpperCase().trim():'SIN GRUPO',
      u:h.un!==undefined?Math.abs(parseNum(r[h.un])):0,
      k:h.kg!==undefined?Math.abs(parseNum(r[h.kg])):0});
    n++;
  }
  if(!n)throw'No se pudo leer ninguna fila válida.';
  return {facturas:order.map(id=>map[id]),n:n};
}

window.openImport=function(){
  document.getElementById('impOverlay').classList.add('open');
  const ta=document.getElementById('ita');ta.focus();
};
window.closeImport=function(){document.getElementById('impOverlay').classList.remove('open');};
window.impParse=function(){
  const el=document.getElementById('ist');
  try{
    const p=parseFacturas(document.getElementById('ita').value);
    PARSED=p;
    el.className='istatus ok';
    el.textContent='✓ '+p.n+' líneas · '+p.facturas.length+' facturas · '+
      [...new Set(p.facturas.map(f=>f.fecha))].sort().slice(-1)[0]+' última fecha';
  }catch(e){PARSED=null;el.className='istatus err';el.textContent='✗ '+e;}
};
window.saveImport=function(){
  window.impParse();
  if(!PARSED){return;}
  const data={demo:false,facturas:PARSED.facturas};
  lcSet('despacho_data',data).then(function(){
    window.closeImport();
    if(window.despachoReload)window.despachoReload();
  });
};
window.resetDemoDespacho=function(){
  Promise.all([lcDel('despacho_data'),lcDel('despacho_asig')]).then(function(){
    window.closeImport();
    if(window.despachoReload)window.despachoReload();
  });
};
})();
