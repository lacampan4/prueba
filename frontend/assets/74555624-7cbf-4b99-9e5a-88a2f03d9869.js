/* Hoja de Sede · importador de exportes SAP (pegado desde Excel) · La Campana */
(function(){
'use strict';
const IMP={v:null,s:null,p:null,txt:{v:'',s:'',p:''}};
let tab='v';

const norm=s=>s.toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[.\s_-]+/g,' ').trim();
const ALIAS={
  sede:['sede','almacen','centro','sucursal','bodega','nombre almacen','nombre de sede'],
  cod:['codigo','material','articulo','cod','sku','numero de articulo','nro material','codigo articulo','codigo material'],
  desc:['descripcion','texto breve','texto breve de material','texto','nombre','denominacion'],
  fecha:['fecha','fe contabilizacion','fecha contabilizacion','fecha de contabilizacion','mes','periodo','fecha documento'],
  kg:['kilos','kg','peso','peso neto','kgs','cantidad kg','peso total'],
  un:['unidades','un','cantidad','ctd','uds','libre utilizacion','cantidad um base','ctd en um entrada','stock']
};
function mapHeader(cells){
  const m={};
  cells.forEach((h,i)=>{const n=norm(h);
    for(const key in ALIAS){if(m[key]===undefined&&ALIAS[key].some(a=>n===a||n.startsWith(a)))
      {if(key==='un'&&m.un!==undefined)return;m[key]=i;return;}}});
  return m;
}
function parseNum(raw){
  if(raw==null)return 0;let s=raw.toString().trim();if(!s)return 0;
  let neg=false;
  if(s.startsWith('-')){neg=true;s=s.slice(1);}
  if(s.endsWith('-')){neg=true;s=s.slice(0,-1);} // SAP usa signo al final
  s=s.replace(/\s/g,'');
  // formato SAP/es: 1.234,56 — si hay coma decimal, quita puntos de miles
  if(/,\d{1,3}$/.test(s))s=s.replace(/\./g,'').replace(',','.');
  else if(/^\d{1,3}(\.\d{3})+$/.test(s))s=s.replace(/\./g,'');
  else s=s.replace(/,/g,'');
  const v=parseFloat(s);if(isNaN(v))return 0;
  return neg?-v:v;
}
function parseMes(s){
  s=s.toString().trim();
  let m=s.match(/^(\d{4})[-/.](\d{1,2})/);if(m)return m[1]+'-'+m[2].padStart(2,'0');
  m=s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);if(m)return m[3]+'-'+m[2].padStart(2,'0');
  m=s.match(/^(\d{1,2})[-/.](\d{4})$/);if(m)return m[2]+'-'+m[1].padStart(2,'0');
  return null;
}
function splitRows(text){
  const lines=text.split(/\r?\n/).filter(l=>l.trim());
  if(!lines.length)return null;
  const delim=lines[0].includes('\t')?'\t':(lines[0].includes(';')?';':',');
  return lines.map(l=>l.split(delim).map(c=>c.replace(/^"|"$/g,'').trim()));
}

function parseVentas(text){
  const rows=splitRows(text);if(!rows||rows.length<2)throw'Pega los datos con la fila de encabezados.';
  const h=mapHeader(rows[0]);
  if(h.cod===undefined)throw'No encuentro la columna de código/material.';
  if(h.sede===undefined)throw'No encuentro la columna de sede/almacén.';
  if(h.fecha===undefined)throw'No encuentro la columna de fecha o mes.';
  if(h.kg===undefined&&h.un===undefined)throw'No encuentro columnas de kilos ni de cantidad.';
  const out={arts:{},v:{},months:new Set(),sedes:new Set(),n:0};
  for(let i=1;i<rows.length;i++){const r=rows[i];if(!r[h.cod])continue;
    const mes=parseMes(r[h.fecha]||'');if(!mes)continue;
    const sede=(r[h.sede]||'').toUpperCase().trim();if(!sede)continue;
    const cod=r[h.cod].trim();
    const k=h.kg!==undefined?parseNum(r[h.kg]):0;
    const u=h.un!==undefined?parseNum(r[h.un]):0;
    out.arts[cod]=out.arts[cod]||{d:(h.desc!==undefined&&r[h.desc])||cod,c:''};
    if(h.desc!==undefined&&r[h.desc])out.arts[cod].d=r[h.desc];
    const vs=out.v[sede]=out.v[sede]||{};
    const vc=vs[cod]=vs[cod]||{};
    const cell=vc[mes]=vc[mes]||{k:0,u:0};
    cell.k+=k;cell.u+=u; // 601 negativos + 602 positivos → neto; signo se corrige al final
    out.months.add(mes);out.sedes.add(sede);out.n++;
  }
  if(!out.n)throw'No se pudo leer ninguna fila válida.';
  return out;
}
function parseStock(text,esPlanta){
  const rows=splitRows(text);if(!rows||rows.length<2)throw'Pega los datos con la fila de encabezados.';
  const h=mapHeader(rows[0]);
  if(h.cod===undefined)throw'No encuentro la columna de código/material.';
  if(!esPlanta&&h.sede===undefined)throw'No encuentro la columna de sede/almacén.';
  if(h.kg===undefined&&h.un===undefined)throw'No encuentro columnas de kilos ni de cantidad.';
  const out={bySede:{},p25:{},n:0,sedes:new Set()};
  for(let i=1;i<rows.length;i++){const r=rows[i];if(!r[h.cod])continue;
    const cod=r[h.cod].trim();
    const k=Math.max(0,h.kg!==undefined?parseNum(r[h.kg]):0);
    const u=Math.max(0,h.un!==undefined?parseNum(r[h.un]):0);
    let sede=esPlanta?'25':((r[h.sede]||'').toUpperCase().trim());
    const es25=sede==='25'||/PLANTA|PRINCIPAL/.test(sede);
    if(es25){const c=out.p25[cod]=out.p25[cod]||{k:0,u:0};c.k+=k;c.u+=u;}
    else{const s=out.bySede[sede]=out.bySede[sede]||{};const c=s[cod]=s[cod]||{k:0,u:0};c.k+=k;c.u+=u;out.sedes.add(sede);}
    out.n++;
  }
  if(!out.n)throw'No se pudo leer ninguna fila válida.';
  return out;
}

const PANES={
  v:{t:'Ventas por artículo y sede (últimos meses)',c:'Columnas esperadas: <code>Sede</code> · <code>Material/Código</code> · <code>Texto breve</code> (opcional) · <code>Fecha o Mes</code> · <code>Kilos</code> y/o <code>Cantidad</code>. Una fila por movimiento o por mes. Exporte de <code>MB51</code> o query SQVI — ver Guía SAP.'},
  s:{t:'Stock actual por sede',c:'Columnas esperadas: <code>Sede/Almacén</code> · <code>Material/Código</code> · <code>Kilos</code> y/o <code>Cantidad</code>. Exporte de <code>MB52</code>. Si incluye el almacén 25 (o «PLANTA»), se separa solo y puedes omitir la pestaña 3.'},
  p:{t:'Stock del almacén 25 (planta)',c:'Columnas esperadas: <code>Material/Código</code> · <code>Kilos</code> y/o <code>Cantidad</code>. Exporte de <code>MB52</code> filtrado al almacén 25. Omite esta pestaña si ya vino en el exporte anterior.'}
};
function renderPane(){
  ['v','s','p'].forEach(k=>{const b=document.getElementById('itab-'+k);
    b.classList.toggle('on',k===tab);b.classList.toggle('done',!!IMP[k]);});
  const p=PANES[tab];
  document.getElementById('ipane').innerHTML=`
    <div class="cols"><b>${p.t}</b><br>${p.c}</div>
    <textarea id="ita" placeholder="Copia el rango en Excel (con encabezados) y pégalo aquí…">${IMP.txt[tab]||''}</textarea>
    <div style="display:flex;gap:10px;align-items:center;margin-top:9px">
      <button class="btn ghost" style="padding:8px 13px" onclick="impParse()">Validar datos</button>
      <div class="istatus" id="ist"></div>
    </div>`;
  document.getElementById('ita').addEventListener('input',e=>{IMP.txt[tab]=e.target.value;});
  showStatus();
}
function showStatus(){
  const el=document.getElementById('ist');if(!el)return;
  const d=IMP[tab];
  if(!d){el.className='istatus';el.textContent='';return;}
  el.className='istatus ok';
  if(tab==='v')el.textContent=`✓ ${d.n} filas · ${Object.keys(d.arts).length} artículos · ${d.sedes.size} sedes · meses ${[...d.months].sort().join(', ')}`;
  else el.textContent=`✓ ${d.n} filas · ${Object.keys(d.bySede).length?[...d.sedes].length+' sedes':''}${Object.keys(d.p25).length?` · alm.25: ${Object.keys(d.p25).length} artículos`:''}`;
}
window.impTab=function(k){tab=k;renderPane();};
window.impParse=function(){
  const el=document.getElementById('ist');
  try{
    const txt=document.getElementById('ita').value;
    if(tab==='v')IMP.v=parseVentas(txt);
    else if(tab==='s')IMP.s=parseStock(txt,false);
    else IMP.p=parseStock(txt,true);
    showStatus();
  }catch(e){el.className='istatus err';el.textContent='✗ '+(e.message||e);}
};
window.openImport=function(){document.getElementById('impOverlay').classList.add('open');renderPane();};
window.closeImport=function(){document.getElementById('impOverlay').classList.remove('open');};
window.resetDemo=function(){
  if(!confirm('¿Volver a los datos demo? Se borra el dataset importado.'))return;
  (window.lcDel?lcDel('sede_dataset'):Promise.resolve()).then(()=>{sdSetData(window.SEDE_DEMO);closeImport();});
};
window.saveImport=function(){
  if(!IMP.v){alert('Falta validar la pestaña 1 (ventas por sede) — es la base del cálculo.');impTab('v');return;}
  const prev=window.SD&&!window.SD.demo?window.SD:null;
  const months=[...IMP.v.months].sort();
  const sedes=[...new Set([...IMP.v.sedes,...(IMP.s?[...IMP.s.sedes]:[])])];
  const arts=IMP.v.arts;
  const v={};
  sedes.forEach(s=>{v[s]={};const src=IMP.v.v[s]||{};
    Object.keys(src).forEach(cod=>{v[s][cod]=months.map(m=>{const c=src[cod][m];
      return c?{k:Math.abs(Math.round(c.k)),u:Math.abs(Math.round(c.u))}:{k:0,u:0};});});});
  const stockSede=IMP.s?IMP.s.bySede:(prev?prev.stockSede:{});
  let stock25={};
  if(IMP.p&&Object.keys(IMP.p.p25).length)stock25=IMP.p.p25;
  else if(IMP.s&&Object.keys(IMP.s.p25).length)stock25=IMP.s.p25;
  else if(prev)stock25=prev.stock25;
  if(!Object.keys(stock25).length&&!confirm('No has cargado el stock del almacén 25: todo saldrá como SIN STOCK. ¿Guardar de todos modos?'))return;
  const ds={demo:false,updated:new Date().toISOString(),months,sedes,arts,v,stockSede,stock25};
  (window.lcSet?lcSet('sede_dataset',ds):Promise.resolve()).then(()=>{sdSetData(ds);closeImport();})
    .catch(()=>{sdSetData(ds);closeImport();alert('Se calculó, pero no se pudo guardar en el navegador (se perderá al recargar).');});
};
})();
