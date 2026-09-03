/* ===== Hoja de Despacho · La Campana ===== */
(function(){
'use strict';
const nf=new Intl.NumberFormat('es-CO',{maximumFractionDigits:0});
const MES=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const MESL=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const esc=s=>(s==null?'':s.toString()).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function fmtFecha(f){const p=f.split('-');return p[2]+' '+MES[+p[1]-1]+' '+p[0];}
function fmtFechaL(f){const p=f.split('-');return p[2]+' de '+MESL[+p[1]-1].toLowerCase()+' de '+p[0];}

let DATA=null, FLOTA=[], ASIG={}, DEMO=false;
let day=null, fEstado='all', q='', mesSel=null, expanded={};

function fx(f){const a=ASIG[f.id];return a?a:{estado:f.estado||'pendiente',placa:f.placa||null};}
function totU(f){return f.lineas.reduce((s,l)=>s+l.u,0);}
function totK(f){return f.lineas.reduce((s,l)=>s+l.k,0);}
function saveAsig(){lcSet('despacho_asig',ASIG).catch(()=>{});}
function saveFlota(){lcSet('despacho_flota',FLOTA).catch(()=>{});}

/* ---------- carga ---------- */
function boot(){
  Promise.all([lcGet('despacho_data'),lcGet('despacho_flota'),lcGet('despacho_asig')])
  .catch(()=>[null,null,null])
  .then(function(res){
    res=res||[null,null,null];
    DATA=res[0]&&res[0].facturas&&res[0].facturas.length?res[0]:window.DESPACHO_DEMO;
    DEMO=!!DATA.demo;
    FLOTA=(res[1]&&res[1].length)?res[1]:(window.DESPACHO_DEMO.flota||[]).slice();
    ASIG=res[2]||{};
    document.getElementById('demobar').style.display=DEMO?'flex':'none';
    const fechas=[...new Set(DATA.facturas.map(f=>f.fecha))].sort();
    day=fechas[fechas.length-1];
    mesSel=day.slice(0,7);
    renderAll();
  });
}
window.despachoReload=function(){expanded={};boot();};

/* ---------- render ---------- */
function renderAll(){renderParams();renderKpis();renderTable();renderMetrics();
  document.getElementById('printSub').textContent='Facturas del '+fmtFechaL(day)+' · generado '+new Date().toLocaleString('es-CO');
}

function renderParams(){
  const el=document.getElementById('params');
  const ests=[['all','Todas'],['pendiente','Pendientes'],['asignada','Asignadas'],['entregada','Entregadas']];
  el.innerHTML=`
    <div class="pgroup"><label>Día de despacho</label>
      <input type="date" id="dayInp" value="${day}"></div>
    <div class="pgroup"><label>Estado</label>
      <div class="seg">${ests.map(e=>`<button class="${fEstado===e[0]?'on':''}" data-est="${e[0]}">${e[1]}</button>`).join('')}</div></div>
    <div class="pgroup" style="flex:1;min-width:200px"><label>Buscar</label>
      <input class="search" id="q" type="text" placeholder="Factura, cliente, asesor o placa…" value="${esc(q)}" style="width:100%"></div>`;
  document.getElementById('dayInp').addEventListener('change',e=>{if(e.target.value){day=e.target.value;expanded={};renderAll();}});
  el.querySelectorAll('[data-est]').forEach(b=>b.onclick=()=>{fEstado=b.dataset.est;renderTable();renderParams();});
  const qi=document.getElementById('q');
  qi.addEventListener('input',e=>{q=e.target.value;renderTable();});
}

function facsDia(){return DATA.facturas.filter(f=>f.fecha===day);}

function renderKpis(){
  const fs=facsDia();
  let kg=0,un=0,pend=0,asg=0,ent=0;const vehs=new Set();
  fs.forEach(f=>{kg+=totK(f);un+=totU(f);const s=fx(f);
    if(s.estado==='pendiente')pend++;else if(s.estado==='asignada')asg++;else ent++;
    if(s.placa)vehs.add(s.placa);});
  const k=(l,v,d,acc)=>`<div class="kpi">${acc?'<div class="accent"></div>':''}<div class="l">${l}</div><div class="v">${v}</div><div class="d">${d}</div></div>`;
  document.getElementById('kpis').innerHTML=
    k('Facturas del día',fs.length,fmtFecha(day),true)+
    k('Kilos del día',nf.format(kg)+'<small> kg</small>',nf.format(un)+' unidades')+
    k('Pendientes de vehículo',pend,pend?'por asignar placa':'todo asignado')+
    k('Asignadas a reparto',asg,vehs.size+' vehículo'+(vehs.size===1?'':'s')+' en ruta')+
    k('Entregadas',ent,fs.length?Math.round(ent/fs.length*100)+'% del día':'—');
}

function estPill(e){
  if(e==='entregada')return'<span class="pill ok">ENTREGADA</span>';
  if(e==='asignada')return'<span class="pill warn">ASIGNADA</span>';
  return'<span class="pill bad">PENDIENTE</span>';
}
function placaSel(id,cur){
  return `<select class="vsel" data-sel="${id}">
    <option value="">— placa —</option>
    ${FLOTA.map(v=>`<option value="${esc(v.placa)}" ${v.placa===cur?'selected':''}>${esc(v.placa)}</option>`).join('')}
  </select>`;
}

function renderTable(){
  const ql=q.toLowerCase();
  const fs=facsDia().filter(f=>{
    const s=fx(f);
    if(fEstado!=='all'&&s.estado!==fEstado)return false;
    if(!ql)return true;
    return (f.id+' '+f.cliente+' '+f.asesor+' '+(s.placa||'')).toLowerCase().includes(ql);
  });
  const ord={pendiente:0,asignada:1,entregada:2};
  fs.sort((a,b)=>ord[fx(a).estado]-ord[fx(b).estado]||a.id.localeCompare(b.id));
  document.getElementById('tblTitle').textContent='Facturas del '+fmtFecha(day);
  document.getElementById('tblHint').textContent=fs.length+' facturas';
  let html=`<thead><tr>
    <th class="tl">Factura</th><th class="tl">Cliente · dirección de entrega</th><th class="tl">Asesor</th>
    <th>Arts.</th><th>Unid.</th><th>Kilos</th><th class="tl">Estado</th><th class="tl noprint">Vehículo / acción</th></tr></thead><tbody>`;
  fs.forEach(f=>{
    const s=fx(f);
    let act='';
    if(s.estado==='pendiente')act=placaSel(f.id,'')+` <button class="mini" data-asg="${f.id}">Asignar</button>`;
    else if(s.estado==='asignada')act=`<b class="plc">${esc(s.placa)}</b> <button class="mini ok" data-ent="${f.id}">Entregada</button><button class="mini gh" data-mail="${f.id}" title="Reenviar correo al asesor">✉</button><button class="mini gh" data-undo="${f.id}" title="Quitar asignación">↩</button>`;
    else act=`<b class="plc">${esc(s.placa||'—')}</b> <button class="mini gh" data-undo="${f.id}" title="Reabrir">↩</button>`;
    html+=`<tr class="frow" data-exp="${f.id}">
      <td class="tl mono" style="font-weight:600">${expanded[f.id]?'▾':'▸'} ${esc(f.id)}</td>
      <td class="tl"><div class="art"><div class="ds">${esc(f.cliente)}</div><div class="cd">${esc(f.dir)}</div></div></td>
      <td class="tl"><div class="art"><div class="ds">${esc(f.asesor)}</div><div class="cd">${esc(f.correo||'')}</div></div></td>
      <td>${f.lineas.length}</td><td>${nf.format(totU(f))}</td><td><b>${nf.format(totK(f))}</b></td>
      <td class="tl">${estPill(s.estado)}<span class="printonly plcp">${s.placa?' · '+esc(s.placa):''}</span></td>
      <td class="tl noprint actcell">${act}</td></tr>`;
    if(expanded[f.id]){
      html+=`<tr class="detrow"><td colspan="8"><table class="dettbl">
        <thead><tr><th class="tl">Código</th><th class="tl">Artículo</th><th class="tl">Grupo</th><th>Unidades</th><th>Kilos</th></tr></thead><tbody>
        ${f.lineas.map(l=>`<tr><td class="tl mono">${esc(l.cod)}</td><td class="tl">${esc(l.d)}</td><td class="tl"><span class="pill mut">${esc(l.g)}</span></td><td>${nf.format(l.u)}</td><td>${nf.format(l.k)}</td></tr>`).join('')}
        </tbody></table></td></tr>`;
    }
  });
  html+='</tbody>';
  const t=document.getElementById('tbl');t.innerHTML=html;
  document.getElementById('tblFoot').textContent='Clic en una fila para ver los artículos de la factura. Al asignar la placa se abre un correo listo para enviar al asesor.';
  t.querySelectorAll('[data-exp]').forEach(tr=>tr.addEventListener('click',e=>{
    if(e.target.closest('.actcell')||e.target.tagName==='SELECT'||e.target.tagName==='BUTTON')return;
    const id=tr.dataset.exp;expanded[id]=!expanded[id];renderTable();
  }));
  t.querySelectorAll('[data-asg]').forEach(b=>b.onclick=()=>assign(b.dataset.asg));
  t.querySelectorAll('[data-ent]').forEach(b=>b.onclick=()=>deliver(b.dataset.ent));
  t.querySelectorAll('[data-undo]').forEach(b=>b.onclick=()=>undo(b.dataset.undo));
  t.querySelectorAll('[data-mail]').forEach(b=>b.onclick=()=>{const f=DATA.facturas.find(x=>x.id===b.dataset.mail);if(f)openMail(f,fx(f).placa);});
}

/* ---------- acciones ---------- */
function find(id){return DATA.facturas.find(f=>f.id===id);}
function assign(id){
  const sel=document.querySelector('[data-sel="'+CSS.escape(id)+'"]');
  const placa=sel?sel.value:'';
  if(!placa){if(sel){sel.style.borderColor='var(--red)';sel.focus();}return;}
  ASIG[id]={estado:'asignada',placa:placa,ts:Date.now()};
  saveAsig();renderAll();
  const f=find(id);if(f)openMail(f,placa);
}
function deliver(id){const s=fx(find(id));ASIG[id]={estado:'entregada',placa:s.placa,ts:Date.now()};saveAsig();renderAll();}
function undo(id){const s=fx(find(id));
  if(s.estado==='entregada')ASIG[id]={estado:'asignada',placa:s.placa,ts:Date.now()};
  else ASIG[id]={estado:'pendiente',placa:null,ts:Date.now()};
  saveAsig();renderAll();}

function openMail(f,placa){
  const lin=f.lineas.map(l=>' · '+l.d+' — '+nf.format(l.u)+' un / '+nf.format(l.k)+' kg').join('\n');
  const nombre=(f.asesor||'').split(' ')[0];
  const su='Factura '+f.id+' asignada a reparto · vehículo '+placa;
  const bo='Hola '+nombre+',\n\n'
    +'La factura '+f.id+' del '+fmtFechaL(f.fecha)+' fue asignada al vehículo de placa '+placa+' para su reparto.\n\n'
    +'Cliente: '+f.cliente+'\nDirección de entrega: '+f.dir+'\n\nDetalle:\n'+lin+'\n\n'
    +'Total: '+nf.format(totU(f))+' unidades · '+nf.format(totK(f))+' kg\n\n'
    +'Hoja de Despacho · La Campana';
  window.location.href='mailto:'+encodeURIComponent(f.correo||'')+'?subject='+encodeURIComponent(su)+'&body='+encodeURIComponent(bo);
}

/* ---------- métricas mensuales ---------- */
function renderMetrics(){
  const months=[...new Set(DATA.facturas.map(f=>f.fecha.slice(0,7)))].sort();
  if(!months.includes(mesSel))mesSel=months[months.length-1];
  const seg=document.getElementById('mesSeg');
  seg.innerHTML=months.map(m=>{const p=m.split('-');
    return `<button class="${m===mesSel?'on':''}" data-mes="${m}">${MES[+p[1]-1]} ${p[0].slice(2)}</button>`;}).join('');
  seg.querySelectorAll('[data-mes]').forEach(b=>b.onclick=()=>{mesSel=b.dataset.mes;renderMetrics();});

  const veh={},grp={};let tot=0,nfac=0;
  DATA.facturas.forEach(f=>{
    if(f.fecha.slice(0,7)!==mesSel)return;
    const s=fx(f);if(s.estado!=='entregada')return;
    nfac++;
    const p=s.placa||'SIN PLACA';
    veh[p]=veh[p]||{k:0,n:0};veh[p].n++;
    f.lineas.forEach(l=>{veh[p].k+=l.k;const g=grp[l.g]=grp[l.g]||{k:0,u:0};g.k+=l.k;g.u+=l.u;tot+=l.k;});
  });
  const p=mesSel.split('-');
  document.getElementById('mesHint').textContent=nfac+' facturas entregadas · '+nf.format(tot)+' kg en '+MESL[+p[1]-1].toLowerCase()+' '+p[0];

  const bar=(v,max,col)=>`<span class="bar"><i style="width:${max?Math.round(v/max*100):0}%;${col?'background:'+col:''}"></i></span>`;
  const vRows=Object.keys(veh).map(k=>({p:k,...veh[k]})).sort((a,b)=>b.k-a.k);
  const vMax=vRows.length?vRows[0].k:0;
  document.getElementById('vehTbl').innerHTML=
    `<thead><tr><th class="tl">Vehículo</th><th>Facturas</th><th>Kilos</th><th class="tl" style="width:200px">Participación</th><th>%</th></tr></thead><tbody>`+
    vRows.map(r=>`<tr><td class="tl"><b class="plc">${esc(r.p)}</b> <span style="color:var(--txt3);font-size:11px">${esc((FLOTA.find(v=>v.placa===r.p)||{}).desc||'')}</span></td>
      <td>${r.n}</td><td><b>${nf.format(r.k)}</b></td><td class="tl">${bar(r.k,vMax)}</td><td>${tot?Math.round(r.k/tot*100):0}%</td></tr>`).join('')+
    `</tbody>`;
  const gRows=Object.keys(grp).map(k=>({g:k,...grp[k]})).sort((a,b)=>b.k-a.k);
  const gMax=gRows.length?gRows[0].k:0;
  document.getElementById('grpTbl').innerHTML=
    `<thead><tr><th class="tl">Grupo de artículos</th><th>Unidades</th><th>Kilos</th><th class="tl" style="width:200px">Participación</th><th>%</th></tr></thead><tbody>`+
    gRows.map(r=>`<tr><td class="tl">${esc(r.g)}</td><td>${nf.format(r.u)}</td><td><b>${nf.format(r.k)}</b></td><td class="tl">${bar(r.k,gMax,'#5a6066')}</td><td>${tot?Math.round(r.k/tot*100):0}%</td></tr>`).join('')+
    `</tbody>`;
}

/* ---------- flota ---------- */
window.openFlota=function(){document.getElementById('flOverlay').classList.add('open');renderFlota();};
window.closeFlota=function(){document.getElementById('flOverlay').classList.remove('open');};
function renderFlota(){
  document.getElementById('flList').innerHTML=FLOTA.map((v,i)=>
    `<div class="flrow"><b class="plc">${esc(v.placa)}</b><span>${esc(v.desc||'')}</span>
     <button class="mini gh" data-del="${i}" title="Quitar de la flota">✕</button></div>`).join('')||
    '<div style="color:var(--txt3);font-size:12.5px;padding:8px 0">Sin vehículos. Agrega la primera placa abajo.</div>';
  document.querySelectorAll('#flList [data-del]').forEach(b=>b.onclick=()=>{
    FLOTA.splice(+b.dataset.del,1);saveFlota();renderFlota();renderAll();});
}
window.addPlaca=function(){
  const pi=document.getElementById('flPlaca'),di=document.getElementById('flDesc');
  const placa=pi.value.toUpperCase().trim();if(!placa)return;
  if(FLOTA.some(v=>v.placa===placa)){pi.style.borderColor='var(--red)';return;}
  FLOTA.push({placa:placa,desc:di.value.trim()});
  pi.value='';di.value='';pi.style.borderColor='';
  saveFlota();renderFlota();renderAll();
};

/* ---------- guía / print ---------- */
window.openGuia=function(){document.getElementById('guiaOverlay').classList.add('open');};
window.closeGuia=function(){document.getElementById('guiaOverlay').classList.remove('open');};
window.printDespacho=function(){
  const prev=document.title;document.title='Hoja de Despacho - '+day;
  window.print();setTimeout(()=>document.title=prev,500);
};

boot();
})();
