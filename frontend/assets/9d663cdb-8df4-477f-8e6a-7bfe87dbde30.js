/* ===== Hoja de Asesor · La Campana ===== */
window.LCBootAsesor=function(){
'use strict';
const DATA=window.LC_DATA, CLI=DATA.clients, MONTHS=DATA.months, CATALOG=DATA.catalog||{}, CATS=DATA.cats||[];
const MES0=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const MES=MONTHS.map(mk=>MES0[((+String(mk).split('-')[1])||1)-1]);
const YR=(String(MONTHS[MONTHS.length-1]||'2026').split('-')[0]);
const nfK=new Intl.NumberFormat('es-CO',{maximumFractionDigits:0});
const nf1=new Intl.NumberFormat('es-CO',{minimumFractionDigits:1,maximumFractionDigits:1});
const cop=new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0});
function copM(v){if(Math.abs(v)>=1e9)return '$'+nf1.format(v/1e9)+' mil M';if(Math.abs(v)>=1e6)return '$'+nf1.format(v/1e6)+' M';return cop.format(v);}
function kgC(v){if(Math.abs(v)>=1e6)return nf1.format(v/1e6)+' M';if(Math.abs(v)>=1e3)return nf1.format(v/1e3)+' k';return nfK.format(v);}
function sucOf(ase){if(!ase)return '(Sin asignar)';const m=ase.match(/^\s*([^-]+?)\s*-\s*\S/);let s=null;if(m)s=m[1].trim();else if(ase.trim().startsWith('-'))return '(Sin asignar)';else s='(Otros)';if(/^MOSTRADOR\s*P\b/i.test(s))return 'PALOQUEMAO';return s;}
function cityNorm(c){if(!c)return '(Sin ciudad)';return c.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s*\(.*?\)\s*/g,'').trim()||'(Sin ciudad)';}

// ===== mes de referencia (último completo) =====
let REF=MONTHS.length-1, PARTIAL=false;
(function(){const gKg=MONTHS.map(_=>0);
  for(const n in CLI){(CLI[n].a||[]).forEach(([cod,s])=>s.forEach((v,i)=>gKg[i]+=v));}
  const now=new Date(),curYM=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  if(MONTHS.length>=1&&String(MONTHS[MONTHS.length-1])===curYM){PARTIAL=true;REF=Math.max(0,MONTHS.length-2);return;}
  if(MONTHS.length>=3){const prev=gKg.slice(0,-1).filter(v=>v>0).sort((a,b)=>a-b);
    const med=prev.length?prev[Math.floor(prev.length/2)]:0;
    if(med>0&&gKg[gKg.length-1]<med*0.5){PARTIAL=true;REF=MONTHS.length-2;}}})();

const STATES={
  nuevo:{l:'Nuevos',c:'#E10600'},recurrente:{l:'Recurrentes',c:'#14161a'},
  reactivado:{l:'Reactivados',c:'#1f8a5b'},riesgo:{l:'En riesgo',c:'#d9920a'},inactivo:{l:'Inactivos',c:'#aeb4ba'}};
const ORDER=['nuevo','recurrente','reactivado','riesgo','inactivo'];
function classify(monthly){const idx=[];for(let i=0;i<=REF;i++){if(monthly[i]>0)idx.push(i);}
  if(!idx.length)return 'inactivo';const first=idx[0],last=idx[idx.length-1],nAct=idx.length;
  if(monthly[REF]>0){if(first>=REF-1)return 'nuevo';if(nAct<(last-first+1))return 'reactivado';return 'recurrente';}
  if(REF>=1&&monthly[REF-1]>0)return 'riesgo';return 'inactivo';}

// ===== precompute clientes =====
const ALL=[];
for(const name in CLI){const c=CLI[name];const monthly=MONTHS.map(_=>0);
  (c.a||[]).forEach(([cod,s])=>s.forEach((v,i)=>monthly[i]+=v));
  const idx=[];for(let i=0;i<=REF;i++){if(monthly[i]>0)idx.push(i);}
  const last=idx.length?idx[idx.length-1]:-1;
  let kg=0;for(let i=0;i<=REF;i++)kg+=monthly[i];
  ALL.push({name,c,kg,monthly,state:classify(monthly),ase:c.ase||'(Sin asignar)',suc:sucOf(c.ase),
    ciu:cityNorm(c.ciu),plazo:c.plazo||'(Sin definir)',cred:c.cc>0,cc:c.cc,cu:c.cu,
    moraVal:(c.mora||[]).reduce((a,m)=>a+m[2],0),maxMora:(c.mora||[]).reduce((a,m)=>Math.max(a,m[1]),0),
    nMora:(c.mora||[]).length,recency:last>=0?REF-last:99,last,activo:monthly[REF]>0});}

// ===== agregado por asesor (ranking global) =====
function aseAgg(rows){let kg=0,activos=0,cred=0,moraVal=0,nMora=0,cc=0,cu=0;const byState={};ORDER.forEach(s=>byState[s]=0);
  rows.forEach(x=>{kg+=x.kg;if(x.activo)activos++;if(x.cred){cred++;cc+=x.cc;cu+=x.cu;}byState[x.state]++;moraVal+=x.moraVal;if(x.nMora>0)nMora++;});
  return {n:rows.length,kg,activos,cred,moraVal,nMora,cc,cu,byState};}
const ASE_LIST={};ALL.forEach(x=>{(ASE_LIST[x.ase]=ASE_LIST[x.ase]||[]).push(x);});
// Volumen real por asesor: se prioriza la venta atribuida a QUIEN FACTURÓ (DATA.aseKgMons,
// calculado por factura al importar el Excel) sobre la suma por cliente asignado — un asesor
// de mostrador puede vender a clientes cuyo asesor de cartera es otro.
const aseKgMonsReal=DATA.aseKgMons||{};
function realKgMes(a){const s=aseKgMonsReal[a];if(!s)return null;return MONTHS.map((_,i)=>Math.round(s[i]||0));}
const aseKg={};for(const a in ASE_LIST){const rk=realKgMes(a);aseKg[a]=rk?rk.slice(0,REF+1).reduce((s,v)=>s+v,0):ASE_LIST[a].reduce((s,x)=>s+x.kg,0);}
const aseOrder=Object.keys(ASE_LIST).sort((a,b)=>aseKg[b]-aseKg[a]);
const rankMap={};aseOrder.forEach((a,i)=>rankMap[a]=i+1);

document.getElementById('emptySub').textContent=`${nfK.format(aseOrder.length)} asesores · mes de referencia ${MES[REF]} ${YR}. Empieza a escribir para autocompletar.`;
const dl=document.getElementById('aseList');
dl.innerHTML=[...aseOrder].sort((a,b)=>a.localeCompare(b,'es')).map(a=>`<option value="${a.replace(/"/g,'&quot;')}">`).join('');
const subt=document.getElementById('subt');
if(subt)subt.textContent=`La Campana · ${MES[0]}–${MES[MONTHS.length-1]} ${YR}${PARTIAL?' · '+MES[REF]+' ref.':''} · ${nfK.format(aseOrder.length)} asesores`;

let current=null;
function openCli(name){location.href='Hoja de Ruta - Cliente.html?cliente='+encodeURIComponent(name);}

function spark(m){const max=Math.max(...m,1),W=104,H=28,n=m.length,step=W/((n-1)||1);
  const pts=m.map((v,i)=>`${(i*step).toFixed(1)},${(H-3-(v/max)*(H-6)).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="var(--acc)" stroke-width="1.6"/></svg>`;}
function trend(activeMes,kgMes){
  const max=Math.max(...kgMes,1),W=820,H=190,pad=42,n=MONTHS.length,step=(W-pad*2)/n,bw=step*0.5;
  const aMax=Math.max(...activeMes,1);
  let bars='';
  kgMes.forEach((v,i)=>{const h=(v/max)*(H-pad-30),x=pad+i*step+step*0.25,y=H-pad-h;
    const part=PARTIAL&&i===MONTHS.length-1,op=part?0.4:1;
    bars+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0,h).toFixed(1)}" rx="2.5" fill="var(--steel)" opacity="${op}"/>`;
    bars+=`<text x="${(x+bw/2).toFixed(1)}" y="${H-pad+14}" fill="var(--txt3)" font-size="10.5" text-anchor="middle" font-family="IBM Plex Mono">${MES[i]}${part?'*':''}</text>`;
    bars+=`<text x="${(x+bw/2).toFixed(1)}" y="${(y-6).toFixed(1)}" fill="var(--txt2)" font-size="9.5" text-anchor="middle" font-family="IBM Plex Mono" opacity="${op}">${kgC(v)}</text>`;});
  // línea de clientes activos
  let pts=activeMes.map((v,i)=>{const x=pad+i*step+step*0.25+bw/2,y=(H-pad-30)-(v/aMax)*(H-pad-46)+ (H-pad-30) *0; return `${x.toFixed(1)},${(H-pad-(v/aMax)*(H-pad-50)).toFixed(1)}`;}).join(' ');
  let dots=activeMes.map((v,i)=>{const x=pad+i*step+step*0.25+bw/2,y=H-pad-(v/aMax)*(H-pad-50);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="var(--acc)"/><text x="${x.toFixed(1)}" y="${(y-8).toFixed(1)}" fill="var(--acc2)" font-size="9.5" text-anchor="middle" font-family="IBM Plex Mono">${nfK.format(v)}</text>`;}).join('');
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto"><line x1="${pad}" y1="${H-pad}" x2="${W-pad}" y2="${H-pad}" stroke="var(--line2)"/>${bars}<polyline points="${pts}" fill="none" stroke="var(--acc)" stroke-width="2"/>${dots}</svg>
    <div class="legendm" style="justify-content:center;margin-top:6px"><span><span class="dot" style="background:var(--steel)"></span>Volumen kg/mes</span><span><span class="dot" style="background:var(--acc)"></span>Clientes que compraron</span>${PARTIAL?'<span style="color:var(--txt3)">* mes parcial</span>':''}</div>`;
}

function render(ase){
  const rows=ASE_LIST[ase];if(!rows)return;
  current=ase;document.getElementById('aseInput').value=ase;
  document.getElementById('empty').style.display='none';
  const rep=document.getElementById('report');rep.style.display='block';
  const A=aseAgg(rows),n=A.n||1;
  const realMes=realKgMes(ase);
  const kgReal=realMes?realMes.slice(0,REF+1).reduce((s,v)=>s+v,0):A.kg;
  const ret=A.activos/n*100;
  const ticket=A.activos?kgReal/A.activos:0;
  const util=A.cc>0?A.cu/A.cc*100:0;
  const sedes=[...new Set(rows.map(x=>x.suc))];
  const captados=A.byState.nuevo+A.byState.reactivado, perdidos=A.byState.riesgo+A.byState.inactivo;
  // series mensuales
  const kgMes=realMes||MONTHS.map((_,i)=>Math.round(rows.reduce((s,x)=>s+x.monthly[i],0)));
  const actMes=MONTHS.map((_,i)=>rows.filter(x=>x.monthly[i]>0).length);
  // ventas por grupo de producto
  const byG={};
  rows.forEach(x=>{(x.c.a||[]).forEach(([cod,s])=>{const gi=CATALOG[cod]?CATALOG[cod][1]:-1;
    const g=byG[gi]=byG[gi]||{kg:0,m:MONTHS.map(_=>0)};
    for(let i=0;i<=REF;i++){const v=s[i]||0;g.m[i]+=v;g.kg+=v;}});});
  const gArr=Object.entries(byG).map(([gi,v])=>({nm:(+gi>=0&&CATS[+gi])?CATS[+gi]:'(Sin grupo)',kg:v.kg,m:v.m}))
    .filter(g=>g.kg>0).sort((a,b)=>b.kg-a.kg);
  const gTot=gArr.reduce((s,g)=>s+g.kg,0)||1,gMax=gArr[0]?gArr[0].kg:1;
  const lcMax=Math.max(...ORDER.map(s=>A.byState[s]),1);

  // ranking / percentil vs equipo
  const rank=rankMap[ase],totA=aseOrder.length;
  const pctl=totA>1?Math.round((1-(rank-1)/(totA-1))*100):100;
  // meta: real (importada) o sugerida = mediana mensual del equipo
  const metaAnual=(DATA.metaAse&&DATA.metaAse[ase])||0;
  const nMesRef=REF+1;
  const kgProm=kgMes.slice(0,nMesRef).reduce((a,b)=>a+b,0)/(nMesRef||1);
  const teamMons=aseOrder.map(a=>aseKg[a]/(nMesRef||1)).sort((a,b)=>a-b);
  const medTeam=teamMons.length?teamMons[Math.floor(teamMons.length/2)]:0;
  const metaMon=metaAnual>0?metaAnual/12:medTeam;
  const metaLbl=metaAnual>0?'meta anual importada':'sugerida (mediana del equipo)';
  const avancePct=metaMon>0?kgProm/metaMon*100:0;
  const avCol=avancePct>=98?'#1f8a5b':(avancePct>=85?'#d9920a':'#E10600');
  // alertas del asesor
  const momA=(REF>=1&&kgMes[REF-1]>0)?((kgMes[REF]/kgMes[REF-1]-1)*100):null;
  const alerts=[];
  if(momA!=null&&momA<=-10)alerts.push({c:'red',t:`📉 Su volumen cayó <b>${nf1.format(Math.abs(momA))}%</b> en ${MES[REF]}`});
  else if(momA!=null&&momA>=10)alerts.push({c:'grn',t:`📈 Su volumen creció <b>+${nf1.format(momA)}%</b> en ${MES[REF]}`});
  if(perdidos>0)alerts.push({c:perdidos>A.activos?'red':'amb',t:`⚠ <b>${nfK.format(perdidos)}</b> clientes por reactivar (${nfK.format(A.byState.riesgo)} en riesgo · ${nfK.format(A.byState.inactivo)} inactivos)`});
  if(A.moraVal>0)alerts.push({c:'amb',t:`💰 Cartera vencida: <b>${copM(A.moraVal)}</b> en ${nfK.format(A.nMora)} clientes`});
  if(metaMon>0&&avancePct<85)alerts.push({c:'red',t:`🎯 Va al <b>${nf1.format(avancePct)}%</b> de su meta mensual (${kgC(kgProm)} de ${kgC(metaMon)} kg)`});
  if(!alerts.length)alerts.push({c:'grn',t:'✅ Cartera sana: sin alertas críticas'});

  rep.innerHTML=`
   <div class="cli-head">
     <div><div class="nm">${ase}</div>
       <div class="det"><span>Sede: <b>${sedes.join(' · ')}</b></span>
         <span>Cartera: <b>${nfK.format(n)}</b> clientes</span>
         <span>Volumen: <b>${kgC(kgReal)} kg</b></span></div></div>
     <div class="rank"><div class="v">#${rank}</div><div class="l">Ranking por volumen · de ${nfK.format(totA)}</div>
       <div style="margin-top:5px;font-family:'IBM Plex Mono';font-size:12px;color:${pctl>=75?'#1f8a5b':(pctl>=40?'#d9920a':'#E10600')}">percentil ${pctl} · supera al ${pctl}% del equipo</div>
       <div style="margin-top:6px;font-family:'IBM Plex Mono';font-size:13px;color:var(--txt)">${nf1.format(ret)}% retención · ${nfK.format(A.activos)} activos</div></div>
   </div>
   <div class="alerts">${alerts.map(a=>`<div class="alert ${a.c}">${a.t}</div>`).join('')}</div>
   <div class="card" style="margin-bottom:16px"><h3>Meta vs avance · ${metaLbl}</h3>
     <div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap">
       <div style="font-family:'Oswald';font-size:30px;font-weight:600;color:${avCol}">${metaMon>0?nf1.format(avancePct)+'%':'—'}</div>
       <div style="font-family:'IBM Plex Mono';font-size:12.5px;color:var(--txt2)">${kgC(kgProm)} kg/mes promedio · meta ${kgC(metaMon)} kg/mes${metaAnual>0?' ('+kgC(metaAnual)+' kg/año)':''}</div>
     </div>
     <div class="util" style="margin-top:9px"><i style="width:${Math.min(100,avancePct).toFixed(1)}%;background:${avCol}"></i></div>
     <div class="foot-note" style="margin-top:6px">${metaAnual>0?'Meta anual de la columna "Meta Anual Asesor" del Excel.':'Sin meta importada: se usa la mediana de kg/mes del equipo como referencia. Carga tu Excel con la columna "Meta Anual Asesor" para la meta real.'} Comparador ${REF>=1?MES[REF-1]+' → '+MES[REF]+': <b>'+kgC(kgMes[REF-1])+' → '+kgC(kgMes[REF])+' kg</b> ('+(momA==null?'·':(momA>=0?'+':'')+nf1.format(momA)+'%')+')':''}</div></div>
   <div class="cards3">
     <div class="card"><h3>Cartera de clientes</h3>
       <div class="metric"><span class="k">Total clientes</span><span class="v">${nfK.format(n)}</span></div>
       <div class="metric"><span class="k">Activos (${MES[REF]})</span><span class="v" style="color:var(--green)">${nfK.format(A.activos)} · ${nf1.format(ret)}%</span></div>
       <div class="metric"><span class="k">Nuevos captados</span><span class="v" style="color:var(--acc2)">+${nfK.format(A.byState.nuevo)}</span></div>
       <div class="metric"><span class="k">Por reactivar</span><span class="v" style="color:${perdidos>A.activos?'var(--red)':'var(--amber)'}">${nfK.format(perdidos)}</span></div>
       <div class="metric"><span class="k">Ticket promedio</span><span class="v">${kgC(ticket)} kg</span></div>
       <div class="util"><i style="width:${Math.min(100,ret)}%"></i></div>
       <div class="foot-note" style="margin-top:2px">Retención = clientes activos ÷ cartera.</div></div>

     <div class="card"><h3>Ciclo de vida de su cartera</h3>
       <div class="lcmini">${ORDER.map(s=>{const v=A.byState[s];
         return `<div class="lcrow"><span class="lbl"><span class="dot" style="background:${STATES[s].c}"></span>${STATES[s].l}</span>
           <span class="tk"><i style="width:${(v/lcMax*100).toFixed(1)}%;background:${STATES[s].c}"></i></span>
           <span class="nn">${nfK.format(v)}</span></div>`;}).join('')}</div>
       <div class="foot-note" style="margin-top:11px">Captación (nuevos + reactivados): <b style="color:var(--green)">+${nfK.format(captados)}</b> · en riesgo de fuga: <b style="color:var(--amber)">${nfK.format(perdidos)}</b>.</div></div>

     <div class="card"><h3>Pago & cartera</h3>
       <div class="metric"><span class="k">Clientes a crédito</span><span class="v">${nfK.format(A.cred)} · ${nf1.format(A.cred/n*100)}%</span></div>
       <div class="metric"><span class="k">Clientes de contado</span><span class="v">${nfK.format(n-A.cred)}</span></div>
       <div class="metric"><span class="k">Cupo asignado</span><span class="v">${copM(A.cc)}</span></div>
       <div class="metric"><span class="k">Cupo usado</span><span class="v">${copM(A.cu)}</span></div>
       <div class="util"><i style="width:${Math.min(100,util)}%"></i></div>
       <div class="metric" style="margin-top:6px"><span class="k">Cartera vencida</span><span class="v" style="color:${A.moraVal>0?'var(--red)':'var(--green)'}">${A.moraVal>0?copM(A.moraVal):'Al día'}</span></div>
       <div class="metric"><span class="k">Clientes con mora</span><span class="v">${nfK.format(A.nMora)} de ${nfK.format(n)}</span></div></div>
   </div>

   <div class="panel"><div class="phead"><h2>Evolución mensual de la cartera</h2>
     <span class="hint">volumen y clientes activos por mes</span></div>
     <div class="pbody">${trend(actMes,kgMes)}</div></div>

   <div class="panel"><div class="phead"><h2>Tendencia de ventas por grupo</h2>
     <span class="hint">${nfK.format(gArr.length)} grupos · kg ${MES[0]}–${MES[REF]}</span></div>
     <div class="pbody"><div class="glist">${gArr.map(g=>`
       <div class="grow"><span class="nm" title="${g.nm}">${g.nm}</span>
         <span class="tk"><i style="width:${(g.kg/gMax*100).toFixed(1)}%"></i></span>
         ${spark(g.m)}
         <span class="val">${kgC(g.kg)} kg · ${(g.kg/gTot*100).toFixed(1)}%</span></div>`).join('')}</div>
       <div class="foot-note" style="margin-top:8px">Barra = participación del grupo en la cartera del asesor · línea = tendencia mensual de kg · total = kg acumulados ${MES[0]}–${MES[REF]}.</div></div></div>

   <div class="panel"><div class="phead"><h2>Clientes por gestionar · en riesgo e inactivos</h2>
     <span class="hint" id="gestHint"></span></div>
     <div class="tscroll" id="gestBox"></div></div>

   <div class="panel"><div class="phead"><h2>Clientes del asesor</h2><span class="hint">${nfK.format(n)} clientes · clic para abrir su hoja</span></div>
     <div class="tscroll" id="cliBox"></div></div>`;

  // clientes por gestionar
  const gest=rows.filter(x=>x.state==='riesgo'||x.state==='inactivo').sort((a,b)=>b.kg-a.kg);
  const gestKg=gest.reduce((s,x)=>s+x.kg,0);
  document.getElementById('gestHint').textContent=`${nfK.format(gest.length)} clientes · ${kgC(gestKg)} kg históricos por recuperar`;
  document.getElementById('gestBox').innerHTML=gest.length?`<div class="pbody" style="padding-top:6px">${gest.slice(0,40).map(x=>{
    const recTxt=x.last>=0?`compró ${MES[x.last]} · hace ${x.recency} ${x.recency===1?'mes':'meses'}`:'sin compras';
    return `<div class="actrow" data-cli="${x.name.replace(/"/g,'&quot;')}">
      <span class="stbadge" style="background:${x.state==='riesgo'?'rgba(217,146,10,.16)':'rgba(174,180,186,.22)'};color:${x.state==='riesgo'?'#d9920a':'#7e858c'}">${STATES[x.state].l.slice(0,-1)}</span>
      <span class="nm" title="${x.name}">${x.name}</span>
      <span class="meta">${recTxt}</span>
      <span class="num" style="width:90px">${kgC(x.kg)} kg</span>
      ${x.moraVal>0?`<span class="pill bad">${copM(x.moraVal)}</span>`:''}</div>`;}).join('')}
      ${gest.length>40?`<div class="foot-note">Mostrando 40 de ${nfK.format(gest.length)}.</div>`:''}</div>`
    :`<div class="pbody"><div class="foot-note" style="font-size:13px">Sin clientes en riesgo o inactivos — toda la cartera está activa. 👏</div></div>`;
  document.querySelectorAll('#gestBox .actrow').forEach(el=>el.onclick=()=>openCli(el.dataset.cli));

  // tabla de clientes
  const sorted=[...rows].sort((a,b)=>b.kg-a.kg);
  const body=sorted.slice(0,120).map((x,i)=>{
    const st=x.state,col=STATES[st].c;
    const moraCell=x.moraVal>0?`<span class="pill ${x.maxMora>90?'bad':'warn'}">${copM(x.moraVal)}</span>`:'<span style="color:var(--txt3)">—</span>';
    return `<tr class="click" data-cli="${x.name.replace(/"/g,'&quot;')}">
      <td><div class="cname">${x.name}</div><div class="csmall">NIT ${x.c.nit||'—'}</div></td>
      <td>${x.ciu}</td>
      <td><span class="stbadge" style="background:${st==='inactivo'?'rgba(174,180,186,.22)':'rgba(0,0,0,.05)'};color:${col==='#aeb4ba'?'#7e858c':col}">${STATES[st].l.slice(0,-1)}</span></td>
      <td class="num">${nfK.format(x.kg)}</td>
      <td>${x.cred?`<span class="pill cred">Crédito</span>`:`<span class="pill cash">Contado</span>`}</td>
      <td class="num">${moraCell}</td></tr>`;}).join('');
  document.getElementById('cliBox').innerHTML=`<table><thead><tr><th>Cliente</th><th>Ciudad</th><th>Estado</th><th class="num">Kg</th><th>Pago</th><th class="num">Mora</th></tr></thead><tbody>${body}</tbody></table>
    ${sorted.length>120?`<div class="pbody"><div class="foot-note">Mostrando 120 de ${nfK.format(sorted.length)} clientes.</div></div>`:''}`;
  document.querySelectorAll('#cliBox tr.click').forEach(tr=>tr.onclick=()=>openCli(tr.dataset.cli));

  document.getElementById('pdfBtn').disabled=false;
  window.scrollTo(0,0);
}

const inp=document.getElementById('aseInput');
inp.addEventListener('change',e=>{const v=e.target.value.trim();if(ASE_LIST[v])render(v);});
inp.addEventListener('input',e=>{const v=e.target.value.trim();if(ASE_LIST[v])render(v);});
document.getElementById('pdfBtn').onclick=()=>{if(!current)return;const prev=document.title;
  document.title='Hoja de Asesor - '+current.replace(/[\\/:*?"<>|]+/g,' ').trim();window.print();setTimeout(()=>document.title=prev,500);};

const qp=new URLSearchParams(location.search).get('asesor');
if(qp&&ASE_LIST[qp])render(qp);
(function(){const gm=document.getElementById('guideModal');if(gm){
  document.getElementById('guideBtn').onclick=()=>gm.classList.add('show');
  document.getElementById('guideClose').onclick=()=>gm.classList.remove('show');
  gm.onclick=e=>{if(e.target===gm)gm.classList.remove('show');};
}})();
document.getElementById('loading').classList.add('hide');
};
