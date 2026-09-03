/* ===== Panorama Comercial · La Campana ===== */
window.LCBootComercial=function(){
'use strict';
const DATA=window.LC_DATA, CLI=DATA.clients, MONTHS=DATA.months;
const MES0=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const MES=MONTHS.map(mk=>MES0[((+String(mk).split('-')[1])||1)-1]);
const YR=(String(MONTHS[MONTHS.length-1]||'2026').split('-')[0]);
const nfK=new Intl.NumberFormat('es-CO',{maximumFractionDigits:0});
const nf1=new Intl.NumberFormat('es-CO',{minimumFractionDigits:1,maximumFractionDigits:1});
const cop=new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0});
function copM(v){if(Math.abs(v)>=1e9)return '$'+nf1.format(v/1e9)+' mil M';if(Math.abs(v)>=1e6)return '$'+nf1.format(v/1e6)+' M';return cop.format(v);}
function kgC(v){if(Math.abs(v)>=1e6)return nf1.format(v/1e6)+' M';if(Math.abs(v)>=1e3)return nf1.format(v/1e3)+' k';return nfK.format(v);}
function sucOf(ase){if(!ase)return '(Sin asignar)';const m=ase.match(/^\s*([^-]+?)\s*-\s*\S/);let s=null;if(m)s=m[1].trim();else if(ase.trim().startsWith('-'))return '(Sin asignar)';else s='(Otros)';if(/^MOSTRADOR\s*P\b/i.test(s))return 'PALOQUEMAO';return s;}
function aseShort(ase){const m=(ase||'').match(/-\s*(.+)$/);return m?m[1].trim():(ase||'(Sin asignar)');}
function cityNorm(c){if(!c)return '(Sin ciudad)';return c.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s*\(.*?\)\s*/g,'').trim()||'(Sin ciudad)';}

// ===== estados del ciclo de vida =====
// El mes de referencia ("mes actual") es el último mes COMPLETO. Si el último mes del
// archivo viene parcial (export a mitad de mes), su volumen cae muy por debajo de la
// tendencia; lo detectamos y usamos el mes anterior como referencia de actividad.
let REF=MONTHS.length-1, PARTIAL=false;
(function detectRef(){
  const gKg=MONTHS.map(_=>0);
  for(const n in CLI){(CLI[n].a||[]).forEach(([cod,s])=>s.forEach((v,i)=>gKg[i]+=v));}
  if(MONTHS.length>=3){
    const prev=gKg.slice(0,-1).filter(v=>v>0).sort((a,b)=>a-b);
    const med=prev.length?prev[Math.floor(prev.length/2)]:0;
    if(med>0 && gKg[gKg.length-1] < med*0.5){PARTIAL=true;REF=MONTHS.length-2;}
  }
})();
const STATES={
  nuevo:      {l:'Nuevos',      c:'#E10600', d:`Primera compra en los últimos 2 meses (${MES[Math.max(0,MONTHS.length>=2?MONTHS.length-2:0)]}–${MES[MONTHS.length-1]}).`},
  recurrente: {l:'Recurrentes', c:'#14161a', d:'Compran de forma sostenida, incluido el último mes.'},
  reactivado: {l:'Reactivados', c:'#1f8a5b', d:'Volvieron a comprar el último mes tras una pausa.'},
  riesgo:     {l:'En riesgo',   c:'#d9920a', d:'Compraron hace un mes pero no en el último — por reactivar.'},
  inactivo:   {l:'Inactivos',   c:'#aeb4ba', d:'Sin compras en los últimos 2 meses del período.'}
};
const STATE_ORDER=['nuevo','recurrente','reactivado','riesgo','inactivo'];

function classify(monthly){
  // sólo considera meses hasta el de referencia (ignora el mes parcial para clasificar)
  const idx=[];for(let i=0;i<=REF;i++){if(monthly[i]>0)idx.push(i);}
  if(!idx.length)return 'inactivo';
  const first=idx[0],last=idx[idx.length-1],nAct=idx.length;
  if(monthly[REF]>0){
    if(first>=REF-1)return 'nuevo';
    if(nAct<(last-first+1))return 'reactivado';
    return 'recurrente';
  }
  if(REF>=1 && monthly[REF-1]>0)return 'riesgo';
  return 'inactivo';
}

// ===== precompute per-client =====
const ALL=[];
for(const name in CLI){
  const c=CLI[name];
  const monthly=MONTHS.map(_=>0);
  (c.a||[]).forEach(([cod,s])=>s.forEach((v,i)=>monthly[i]+=v));
  const idx=[];for(let i=0;i<=REF;i++){if(monthly[i]>0)idx.push(i);}
  const first=idx.length?idx[0]:-1,last=idx.length?idx[idx.length-1]:-1;
  const state=classify(monthly);
  const cred=c.cc>0;
  const moraVal=(c.mora||[]).reduce((a,m)=>a+m[2],0);
  const maxMora=(c.mora||[]).reduce((a,m)=>Math.max(a,m[1]),0);
  const recency=last>=0?REF-last:99; // meses desde última compra
  // kg sólo de los meses computados (hasta el de referencia)
  let kgRef=0;for(let i=0;i<=REF;i++)kgRef+=monthly[i];
  ALL.push({name,c,kg:kgRef,monthly,state,suc:sucOf(c.ase),ase:c.ase||'(Sin asignar)',
    ciu:cityNorm(c.ciu),plazo:c.plazo||'(Sin definir)',cred,cc:c.cc,cu:c.cu,
    moraVal,maxMora,nMora:(c.mora||[]).length,nMeses:idx.length,first,last,recency,
    activo:monthly[REF]>0});
}

// ===== filtros =====
function uniqSorted(arr){return [...new Set(arr)].sort((a,b)=>a.localeCompare(b,'es'));}
const SUCS=uniqSorted(ALL.map(x=>x.suc));
const ASES=uniqSorted(ALL.map(x=>x.ase));
function fillSel(id,opts,allLabel){const el=document.getElementById(id);
  el.innerHTML=`<option value="">${allLabel}</option>`+opts.map(o=>`<option value="${o.replace(/"/g,'&quot;')}">${o}</option>`).join('');}
fillSel('fSuc',SUCS,'Todas');fillSel('fAse',ASES,'Todos');

const ST={suc:'',ase:'',estado:'',pago:'',q:''};
try{const s=JSON.parse(localStorage.getItem('LC_COM_FILTERS')||'null');if(s)Object.assign(ST,s);}catch(e){}
function saveState(){try{localStorage.setItem('LC_COM_FILTERS',JSON.stringify(ST));}catch(e){}}
let sortKey='kg',sortDir=-1,aseLimit=20;

function passes(x,skipEstado){
  if(ST.suc&&x.suc!==ST.suc)return false;
  if(ST.ase&&x.ase!==ST.ase)return false;
  if(ST.pago==='cred'&&!x.cred)return false;
  if(ST.pago==='cont'&&x.cred)return false;
  if(!skipEstado&&ST.estado){
    if(ST.estado==='activo'){if(!x.activo)return false;}
    else if(x.state!==ST.estado)return false;
  }
  if(ST.q){const q=ST.q.toLowerCase();if(!x.name.toLowerCase().includes(q)&&!(x.c.nit||'').toLowerCase().includes(q))return false;}
  return true;
}

// ===== render =====
function render(){
  const rows=ALL.filter(x=>passes(x));
  const base=ALL.filter(x=>passes(x,true)); // sin filtro de estado (para el ciclo de vida)
  renderKPIs(base);
  renderAlerts(base);
  renderLifecycle(base);
  renderEvolution(base);
  renderCompare(base);
  renderSedeTrend(base);
  renderPayment(rows);
  renderAseTable(base);
  renderPayTrend(rows);
  renderPlazo(rows);
  renderSede(base);
  renderFreq(base);
  renderGeo(base);

  const A=agg(rows);
  document.getElementById('fCount').innerHTML=`<b>${nfK.format(rows.length)}</b> clientes en vista · ${nfK.format(A.activos)} activos · ${nfK.format(A.cred)} crédito / ${nfK.format(A.cont)} contado · ${kgC(A.kg)} kg`;
}

function agg(rows){
  let kg=0,cred=0,cont=0,activos=0,nuevos=0,moraVal=0,nMora=0;
  const byState={};STATE_ORDER.forEach(s=>byState[s]=0);
  rows.forEach(x=>{kg+=x.kg;if(x.cred)cred++;else cont++;if(x.activo)activos++;if(x.state==='nuevo')nuevos++;
    moraVal+=x.moraVal;if(x.nMora>0)nMora++;byState[x.state]++;});
  return {n:rows.length,kg,cred,cont,activos,nuevos,moraVal,nMora,byState};
}

// ===== KPIs =====
function renderKPIs(base){
  const A=agg(base);
  const n=A.n||1;
  const tasaAct=A.activos/n*100;
  const pctCred=(A.cred)/n*100;
  // clientes activos por mes (para spark) — sólo meses completos (hasta REF)
  const actMes=MONTHS.slice(0,REF+1).map((_,i)=>base.filter(x=>x.monthly[i]>0).length);
  const nuevMes=MONTHS.slice(0,REF+1).map((_,i)=>base.filter(x=>x.first===i).length);
  const momAct=actMes.length>=2?((actMes[REF]/(actMes[REF-1]||1)-1)*100):0;
  const inactivos=A.byState.inactivo, riesgo=A.byState.riesgo;
  // sin compra en los últimos 60 días (ni en el mes de referencia ni en el anterior)
  const sin60=base.filter(x=>x.recency>=2);
  const r60=sin60.filter(x=>x.recency===2).length, i60=sin60.length-r60;
  const asesores=new Set(base.filter(x=>x.ase!=='(Sin asignar)').map(x=>x.ase)).size;
  const moraPct=A.n?A.nMora/A.n*100:0;
  const k=[
    kpi('Clientes activos','#E10600',`${nfK.format(A.activos)}`,`${nf1.format(tasaAct)}% de ${nfK.format(A.n)} · MoM <span class="${momAct>=0?'pos':'neg'}">${momAct>=0?'+':''}${nf1.format(momAct)}%</span>`,sparkBars(actMes,'#E10600')),
    kpi('Clientes nuevos','#1f8a5b',`${nfK.format(A.nuevos)}`,`captados ${MES[Math.max(0,REF-1)]}–${MES[REF]} · ${nf1.format(A.nuevos/n*100)}% de la base`,sparkBars(nuevMes,'#1f8a5b')),
    kpi('En riesgo + inactivos','#d9920a',`${nfK.format(sin60.length)}`,`sin compra en 60+ días · ${nfK.format(r60)} en riesgo (60–90 d) · ${nfK.format(i60)} inactivos (90+ d)`),
    kpiMix('Forma de pago',A.cont,A.cred,n),
    kpi('Tasa de actividad','#14161a',`${nf1.format(tasaAct)}<small>%</small>`,`${nfK.format(A.activos)} de ${nfK.format(A.n)} compraron en ${MES[REF]}`),
    kpiTop10(base,A.kg),
    kpiAntig(base)
  ];
  document.getElementById('kpis').innerHTML=k.join('');
}
function kpi(l,col,v,d,extra){return `<div class="kpi"><div class="accent" style="background:${col}"></div>
  <div class="l">${l}</div><div class="v">${v}</div><div class="d">${d||''}</div>${extra||''}</div>`;}
function kpiTop10(base,kgTot){
  const top=[...base].sort((a,b)=>b.kg-a.kg).slice(0,10);
  const kg10=top.reduce((s,x)=>s+x.kg,0),pc=kgTot>0?kg10/kgTot*100:0;
  const col=pc>=60?'#E10600':(pc>=40?'#d9920a':'#1f8a5b');
  return `<div class="kpi"><div class="accent" style="background:${col}"></div>
    <div class="l">Concentración · top 10</div>
    <div class="v" style="color:${col}">${nf1.format(pc)}<small>%</small></div>
    <div class="d">${kgC(kg10)} de ${kgC(kgTot)} kg en 10 clientes · ${pc>=60?'riesgo alto':(pc>=40?'riesgo medio':'sana')}</div></div>`;}
function kpiAntig(base){
  const w=base.filter(x=>x.first>=0);
  const avg=w.length?w.reduce((s,x)=>s+(REF-x.first+1),0)/w.length:0;
  const full=w.filter(x=>x.first===0).length,pcFull=w.length?full/w.length*100:0;
  return `<div class="kpi"><div class="accent" style="background:#14161a"></div>
    <div class="l">Antigüedad promedio</div>
    <div class="v">${nf1.format(avg)}<small> meses</small></div>
    <div class="d">${nf1.format(pcFull)}% compra desde ${MES[0]} · ventana ${MES[0]}–${MES[REF]}</div></div>`;}
function kpiMix(l,cont,cred,n){const pc=cont/n*100,pr=cred/n*100;
  return `<div class="kpi"><div class="accent" style="background:#14161a"></div>
    <div class="l">${l}</div>
    <div class="v">${nf1.format(pc)}<small>% contado</small></div>
    <div class="mbar"><i style="width:${pc}%;background:#5a6066"></i><i style="width:${pr}%;background:#E10600"></i></div>
    <div class="d">${nfK.format(cont)} contado · ${nfK.format(cred)} crédito (${nf1.format(pr)}%)</div></div>`;}
function sparkBars(arr,col){const max=Math.max(...arr,1),W=150,H=34,n=arr.length,step=W/n,bw=step*0.6;
  let b='';arr.forEach((v,i)=>{const h=(v/max)*(H-6),x=i*step+step*0.2,y=H-h;
    b+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${col}" opacity="${i===n-1?1:0.4}"/>`;});
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" style="width:100%;height:34px">${b}</svg>`;}

// ===== alertas semaforizadas =====
function renderAlerts(base){
  const box=document.getElementById('alerts');if(!box)return;
  const A=agg(base),n=A.n||1,al=[];
  const actPrev=REF>=1?base.filter(x=>x.monthly[REF-1]>0).length:0;
  const mom=actPrev?((A.activos/actPrev)-1)*100:0;
  if(mom<=-5)al.push({c:'red',t:`📉 Los clientes activos cayeron <b>${nf1.format(Math.abs(mom))}%</b> en ${MES[REF]} (${nfK.format(actPrev)} → ${nfK.format(A.activos)})`});
  else if(mom>=5)al.push({c:'grn',t:`📈 Los clientes activos crecieron <b>+${nf1.format(mom)}%</b> en ${MES[REF]}`});
  const riesgo=A.byState.riesgo;
  if(riesgo/n>=0.12)al.push({c:'amb',t:`⚠ <b>${nfK.format(riesgo)}</b> clientes en riesgo (${nf1.format(riesgo/n*100)}% de la base) — compraron hace un mes y no volvieron`});
  const moraPct=A.nMora/n*100;
  if(moraPct>=20)al.push({c:'red',t:`🔴 <b>${nf1.format(moraPct)}%</b> de la base con cartera vencida · ${copM(A.moraVal)}`});
  else if(A.moraVal>0)al.push({c:'amb',t:`💰 Cartera vencida: <b>${copM(A.moraVal)}</b> en ${nfK.format(A.nMora)} clientes`});
  const top=[...base].sort((a,b)=>b.kg-a.kg).slice(0,10),kg10=top.reduce((s,x)=>s+x.kg,0);
  if(A.kg>0&&kg10/A.kg>=0.6)al.push({c:'amb',t:`⚠ Alta concentración: el <b>${nf1.format(kg10/A.kg*100)}%</b> del volumen depende de 10 clientes`});
  if(!al.length)al.push({c:'grn',t:'✅ Sin alertas críticas en la vista actual'});
  box.innerHTML=al.map(a=>`<div class="alert ${a.c}">${a.t}</div>`).join('');
}

// ===== tendencia mensual por sede (líneas) =====
const STR_COLORS=['#E10600','#14161a','#1f8a5b','#d9920a','#2563a8','#8b4bb8','#c2185b','#5a6066'];
let STR_ARR=[];const STR_SEL=new Set();
window.strToggle=function(nm){if(STR_SEL.has(nm))STR_SEL.delete(nm);else STR_SEL.add(nm);drawSedeTrend();};
window.strAll=function(){STR_SEL.clear();drawSedeTrend();};
function strSvg(series){
  const act=series.filter(s=>!s.mut);
  const n=series.length?series[0].m.length:0;if(!n)return '';
  const showNm=act.length<=8;
  const W=560,H=250,padL=50,padR=showNm?100:14,padT=16,padB=28;
  const max=Math.max(1,...series.map(s=>Math.max(...s.m)));
  const X=i=>padL+(n>1?i*(W-padL-padR)/(n-1):(W-padL-padR)/2);
  const Y=v=>padT+(1-v/max)*(H-padT-padB);
  let grid='';
  [0,0.25,0.5,0.75,1].forEach(f=>{const yy=Y(max*f);
    grid+=`<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${W-padR}" y2="${yy.toFixed(1)}" stroke="var(--line)" ${f>0?'stroke-dasharray="3 3"':''}/>`+
      `<text x="${padL-6}" y="${(yy+3).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--txt3)" font-family="IBM Plex Mono">${kgC(max*f)}</text>`;});
  let xlab='';for(let i=0;i<n;i++)xlab+=`<text x="${X(i).toFixed(1)}" y="${H-padB+16}" text-anchor="middle" font-size="10" fill="var(--txt3)" font-family="IBM Plex Mono">${MES[i]||''}</text>`;
  let mut='',lines='',labs=[];
  if(showNm){labs=act.map(s=>({s,y:Y(s.m[n-1])})).sort((a,b)=>a.y-b.y);
    for(let i=1;i<labs.length;i++)if(labs[i].y-labs[i-1].y<11)labs[i].y=labs[i-1].y+11;}
  series.forEach(s=>{
    const pts=s.m.map((v,i)=>`${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
    if(s.mut){mut+=`<polyline points="${pts}" fill="none" stroke="var(--line2)" stroke-width="1.2" opacity="0.55" stroke-linejoin="round"><title>${s.nm}</title></polyline>`;return;}
    lines+=`<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;
    s.m.forEach((v,i)=>{lines+=`<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3.2" fill="${s.color}" stroke="var(--panel)" stroke-width="1.4"><title>${s.nm} · ${MES[i]||''}: ${kgC(v)} kg</title></circle>`;
      if(s.lab)lines+=`<text x="${X(i).toFixed(1)}" y="${(Y(v)-8).toFixed(1)}" text-anchor="middle" font-size="9" fill="${s.color}" font-family="IBM Plex Mono">${kgC(v)}</text>`;});
  });
  labs.forEach(l=>{lines+=`<text x="${(X(n-1)+8).toFixed(1)}" y="${(l.y+3).toFixed(1)}" font-size="8.5" fill="${l.s.color}" font-family="IBM Plex Mono" font-weight="600">${l.s.nm.slice(0,15)}</text>`;});
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;overflow:visible">${grid}${xlab}${mut}${lines}</svg>`;
}
function renderSedeTrend(base){
  const nM=REF+1,m={};
  base.forEach(x=>{const s=m[x.suc]=m[x.suc]||{nm:x.suc,kg:0,m:new Array(nM).fill(0)};
    for(let i=0;i<nM;i++){s.m[i]+=x.monthly[i];s.kg+=x.monthly[i];}});
  STR_ARR=Object.values(m).filter(s=>s.kg>0).sort((a,b)=>b.kg-a.kg);
  drawSedeTrend();
}
function drawSedeTrend(){
  const box=document.getElementById('sedeTrendBox');if(!box)return;
  const hint=document.getElementById('sedeTrendHint');
  if(!STR_ARR.length){box.innerHTML='<div class="foot-note">Sin datos de sedes en la vista actual.</div>';if(hint)hint.textContent='';return;}
  for(const nm of [...STR_SEL])if(!STR_ARR.some(s=>s.nm===nm))STR_SEL.delete(nm);
  const hi=STR_SEL.size?STR_ARR.filter(s=>STR_SEL.has(s.nm)):STR_ARR.slice(0,6);
  const series=STR_ARR.map(s=>{const on=hi.includes(s);
    return {nm:s.nm,m:s.m,mut:!on,color:on?STR_COLORS[hi.indexOf(s)%STR_COLORS.length]:'',lab:on&&hi.length<=3};});
  const colorOf=nm=>{const s=series.find(x=>x.nm===nm);return s&&!s.mut?s.color:null;};
  const esc=s=>String(s).replace(/'/g,"\\'").replace(/"/g,'&quot;');
  const chips=STR_ARR.map(s=>{const sel=STR_SEL.has(s.nm),col=colorOf(s.nm);
    return `<span onclick="strToggle('${esc(s.nm)}')" title="${esc(s.nm)} · ${kgC(s.kg)} kg" style="display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:20px;border:1px solid ${sel?col:'var(--line2)'};background:${sel?col:'var(--panel)'};color:${sel?'#fff':(col?'var(--txt)':'var(--txt3)')};font-size:11px;cursor:pointer;user-select:none;line-height:1.4;transition:.12s"><span style="width:8px;height:8px;border-radius:2px;background:${sel?'#fff':(col||'var(--line2)')};flex:none"></span>${s.nm} <span style="font-family:'IBM Plex Mono';font-size:10px;color:${sel?'rgba(255,255,255,.8)':'var(--txt3)'}">${kgC(s.kg)}</span></span>`;}).join('');
  const clear=STR_SEL.size?`<span onclick="strAll()" style="font-size:11px;color:var(--acc2);cursor:pointer;text-decoration:underline;font-family:'IBM Plex Mono';align-self:center;white-space:nowrap">quitar selección ✕</span>`:'';
  box.innerHTML=`<div style="display:flex;gap:5px 6px;flex-wrap:wrap;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--bg2)">${chips}${clear}</div>`+strSvg(series)+
    `<div class="foot-note" style="text-align:center;margin-top:4px">${STR_SEL.size?'Sedes seleccionadas en color; el resto en gris de contexto.':(STR_ARR.length>6?'Top 6 sedes en color; el resto en gris. Clic en una etiqueta para aislar sedes.':'Clic en una etiqueta para aislar sedes.')}</div>`;
  if(hint)hint.textContent=`${hi.length} de ${STR_ARR.length} sedes destacadas`;
}

// ===== comparador último mes vs anterior =====
function renderCompare(base){
  const box=document.getElementById('cmpBox'),hint=document.getElementById('cmpHint');if(!box)return;
  if(REF<1){box.innerHTML='<div class="foot-note">Se necesitan al menos 2 meses completos.</div>';return;}
  const li=REF,pi=REF-1,lm=MES[li],pm=MES[pi];
  let totP=0,totL=0;base.forEach(x=>{totP+=x.monthly[pi];totL+=x.monthly[li];});
  const totD=totL-totP,totPct=totP>0?totD/totP*100:null;
  const sm={};base.forEach(x=>{const s=sm[x.suc]||(sm[x.suc]={nm:x.suc,prev:0,last:0});s.prev+=x.monthly[pi];s.last+=x.monthly[li];});
  const sArr=Object.values(sm).map(o=>({...o,d:o.last-o.prev})).filter(o=>o.prev>0||o.last>0).sort((a,b)=>Math.abs(b.d)-Math.abs(a.d)).slice(0,8);
  const cArr=base.map(x=>({nm:x.name,prev:x.monthly[pi],last:x.monthly[li],d:x.monthly[li]-x.monthly[pi]})).filter(o=>o.prev>0||o.last>0).sort((a,b)=>Math.abs(b.d)-Math.abs(a.d)).slice(0,8);
  const row=o=>{const pct=o.prev>0?(o.d/o.prev*100):null;
    return `<div class="grow"><span class="gn" title="${(o.nm||'').replace(/"/g,'&quot;')}">${o.nm}</span>`+
    `<span class="mono" style="font-family:'IBM Plex Mono';font-size:11.5px;white-space:nowrap">${kgC(o.prev)} → ${kgC(o.last)} <span class="cmgr ${o.d>=0?'pos':'neg'}">${o.d>=0?'▲':'▼'} ${kgC(Math.abs(o.d))}${pct!=null?' ('+(o.d>=0?'+':'')+nf1.format(pct)+'%)':''}</span></span></div>`;};
  box.innerHTML=`
    <div class="cmp-sum">
      <div><span class="l">${pm} (anterior)</span><span class="v">${kgC(totP)}<small style="font-size:11px;color:var(--txt3)"> kg</small></span></div>
      <div><span class="l">${lm} (último completo)</span><span class="v">${kgC(totL)}<small style="font-size:11px;color:var(--txt3)"> kg</small></span></div>
      <div><span class="l">Variación</span><span class="v" style="color:${totD>=0?'#1f8a5b':'#E10600'}">${totD>=0?'+':''}${kgC(totD)}<small style="font-size:11px;color:var(--txt3)">${totPct!=null?' · '+(totD>=0?'+':'')+nf1.format(totPct)+'%':''}</small></span></div>
    </div>
    <div class="gcols">
      <div class="glist"><h4><span class="dot" style="background:#E10600"></span>Sedes · mayores cambios</h4>${sArr.map(row).join('')||'<div class="foot-note">Sin datos.</div>'}</div>
      <div class="glist"><h4><span class="dot" style="background:#14161a"></span>Clientes · mayores cambios</h4>${cArr.map(row).join('')||'<div class="foot-note">Sin datos.</div>'}</div>
    </div>
    <div class="foot-note" style="margin-top:10px">Compara el volumen (kg) de ${pm} contra ${lm} en la vista filtrada. Se muestran los 8 mayores cambios absolutos.${PARTIAL?' El mes parcial del archivo no se usa.':''}</div>`;
  if(hint)hint.textContent=`${pm} → ${lm} · ${totD>=0?'+':''}${kgC(totD)} kg`;
}

// ===== ciclo de vida =====
function renderLifecycle(base){
  const A=agg(base),n=A.n||1;
  const max=Math.max(...STATE_ORDER.map(s=>A.byState[s]),1);
  const html=STATE_ORDER.map(s=>{const v=A.byState[s],meta=STATES[s],on=ST.estado===s;
    return `<div class="lc-card${on?' on':''}" data-st="${s}" style="--c:${meta.c}" title="Clic para ${on?'quitar el filtro':'filtrar por '+meta.l}">
      <div class="top"></div>
      <div class="lc-l"><span class="dot"></span>${meta.l}</div>
      <div class="lc-v" style="color:${meta.c==='#aeb4ba'?'#7e858c':meta.c}">${nfK.format(v)}</div>
      <div class="lc-p">${nf1.format(v/n*100)}% de la base</div>
      <div class="lc-bar"><i style="width:${(v/max*100).toFixed(1)}%"></i></div>
      <div class="lc-d">${meta.d}</div>
    </div>`;}).join('');
  document.getElementById('lcGrid').innerHTML=html;
  const activos=A.byState.nuevo+A.byState.recurrente+A.byState.reactivado;
  document.getElementById('lcFoot').innerHTML=`<b style="color:var(--txt2)">${nfK.format(activos)}</b> clientes activos (compraron en ${MES[REF]}) · <b style="color:var(--txt2)">${nfK.format(A.byState.riesgo+A.byState.inactivo)}</b> sin actividad reciente. La suma de captación (nuevos + reactivados) frente a la pérdida (en riesgo + inactivos) marca el saldo neto de la base.`;
  document.querySelectorAll('#lcGrid .lc-card').forEach(el=>el.onclick=()=>{
    const s=el.dataset.st;ST.estado=(ST.estado===s)?'':s;document.getElementById('fEstado').value=ST.estado;aseLimit=20;saveState();render();});
}

// ===== evolución mensual: activos (barra) + nuevos (segmento) =====
function renderEvolution(base){
  const actMes=MONTHS.map((_,i)=>base.filter(x=>x.monthly[i]>0).length);
  const nuevMes=MONTHS.map((_,i)=>base.filter(x=>x.first===i).length);
  const max=Math.max(...actMes,1),W=560,H=210,pad=36,n=MONTHS.length,step=(W-pad*2)/n,bw=step*0.56;
  let bars='';
  actMes.forEach((v,i)=>{const h=(v/max)*(H-pad-30),x=pad+i*step+step*0.22,y=H-pad-h;
    const showN=i>=1; // el primer mes de la ventana no permite saber "nuevos" reales
    const nh=showN?(nuevMes[i]/max)*(H-pad-30):0;
    const part=PARTIAL&&i===MONTHS.length-1;const op=part?0.4:1;
    bars+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0,h).toFixed(1)}" rx="2.5" fill="#cfd4da" opacity="${op}"/>`;
    if(showN)bars+=`<rect x="${x.toFixed(1)}" y="${(H-pad-nh).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0,nh).toFixed(1)}" rx="2.5" fill="#E10600" opacity="${op}"/>`;
    bars+=`<text x="${(x+bw/2).toFixed(1)}" y="${H-pad+15}" fill="var(--txt3)" font-size="11" text-anchor="middle" font-family="IBM Plex Mono">${MES[i]}${part?'*':''}</text>`;
    bars+=`<text x="${(x+bw/2).toFixed(1)}" y="${(y-6).toFixed(1)}" fill="var(--txt)" font-size="10.5" text-anchor="middle" font-family="IBM Plex Mono" opacity="${op}">${nfK.format(v)}</text>`;
    if(showN)bars+=`<text x="${(x+bw/2).toFixed(1)}" y="${(H-pad-nh-5).toFixed(1)}" fill="#E10600" font-size="9.5" text-anchor="middle" font-family="IBM Plex Mono" opacity="${op}">+${nfK.format(nuevMes[i])}</text>`;});
  document.getElementById('evoBox').innerHTML=`<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto"><line x1="${pad}" y1="${H-pad}" x2="${W-pad}" y2="${H-pad}" stroke="var(--line2)"/>${bars}</svg>
    <div class="legend"><span><span class="sw" style="background:#cfd4da"></span>Clientes que compraron</span><span><span class="sw" style="background:#E10600"></span>De ellos, nuevos del mes</span>${PARTIAL?'<span style="color:var(--txt3)">* mes parcial — no se usa para clasificar</span>':''}</div>`;
  document.getElementById('evoHint').textContent=`pico ${nfK.format(max)} · ${MES[0]}–${MES[MONTHS.length-1]} ${YR}`;
}

// ===== forma de pago (donut contado/credito) =====
function donut(parts){ // parts: [{v,c}]
  const tot=parts.reduce((a,p)=>a+p.v,0)||1,R=52,C=2*Math.PI*R;let off=0,seg='';
  parts.forEach(p=>{const frac=p.v/tot,len=C*frac;
    seg+=`<circle cx="70" cy="70" r="${R}" fill="none" stroke="${p.c}" stroke-width="17" stroke-dasharray="${len.toFixed(1)} ${(C-len).toFixed(1)}" stroke-dashoffset="${(-off).toFixed(1)}" transform="rotate(-90 70 70)"/>`;
    off+=len;});
  return `<svg viewBox="0 0 140 140" width="140" height="140">${seg}
    <text x="70" y="66" text-anchor="middle" font-family="Oswald" font-weight="600" font-size="22" fill="var(--txt)">${nfK.format(tot)}</text>
    <text x="70" y="85" text-anchor="middle" font-family="IBM Plex Mono" font-size="9" fill="var(--txt3)">CLIENTES</text></svg>`;}
function renderPayment(rows){
  const A=agg(rows),n=A.n||1;
  const parts=[{v:A.cont,c:'#5a6066'},{v:A.cred,c:'#E10600'}];
  document.getElementById('payBox').innerHTML=`<div class="donut-wrap">
    ${donut(parts)}
    <div class="donut-leg">
      <div class="li"><span class="lbl"><span class="sw" style="background:#5a6066"></span>Contado</span><b>${nfK.format(A.cont)} · ${nf1.format(A.cont/n*100)}%</b></div>
      <div class="li"><span class="lbl"><span class="sw" style="background:#E10600"></span>Crédito</span><b>${nfK.format(A.cred)} · ${nf1.format(A.cred/n*100)}%</b></div>
      <div class="li" style="border-top:1px dashed var(--line);padding-top:9px;margin-top:2px"><span class="lbl" style="color:var(--txt2)">Cupo asignado</span><b>${copM(rows.reduce((s,x)=>s+(x.cred?x.cc:0),0))}</b></div>
      <div class="li"><span class="lbl" style="color:var(--txt2)">Cupo usado</span><b>${copM(rows.reduce((s,x)=>s+(x.cred?x.cu:0),0))}</b></div>
    </div></div>`;
}

// ===== ranking de asesores =====
function aseAgg(base){
  const m={};
  base.forEach(x=>{const a=m[x.ase]=m[x.ase]||{ase:x.ase,suc:x.suc,n:0,kg:0,activos:0,nuevos:0,riesgo:0,inact:0,cred:0,moraVal:0,nMora:0};
    a.n++;a.kg+=x.kg;if(x.activo)a.activos++;if(x.state==='nuevo')a.nuevos++;if(x.state==='riesgo')a.riesgo++;
    if(x.state==='inactivo')a.inact++;if(x.cred)a.cred++;a.moraVal+=x.moraVal;if(x.nMora>0)a.nMora++;});
  return Object.values(m).map(a=>{a.ret=a.n?a.activos/a.n*100:0;a.pCred=a.n?a.cred/a.n*100:0;return a;});
}
function renderAseTable(base){
  const arr=aseAgg(base);
  const cols=[['rk','#','no'],['ase','Asesor','l'],['n','Clientes','num'],['activos','Activos','num'],
    ['nuevos','Nuevos','num'],['dorm','Riesgo+Inact.','num'],['ret','Retención','num'],['kg','Volumen','num'],
    ['pCred','% Crédito','num'],['moraVal','Cartera venc.','num']];
  arr.sort((a,b)=>{let r;switch(sortKey){
    case 'ase':r=a.ase.localeCompare(b.ase,'es');break;
    case 'n':r=a.n-b.n;break;case 'activos':r=a.activos-b.activos;break;case 'nuevos':r=a.nuevos-b.nuevos;break;
    case 'dorm':r=(a.riesgo+a.inact)-(b.riesgo+b.inact);break;case 'ret':r=a.ret-b.ret;break;
    case 'pCred':r=a.pCred-b.pCred;break;case 'moraVal':r=a.moraVal-b.moraVal;break;default:r=a.kg-b.kg;}
    return r*sortDir;});
  const shown=arr.slice(0,aseLimit);
  const head=cols.map(c=>{const active=c[0]===sortKey;
    return `<th class="${c[2]==='num'?'num':''} ${c[2]==='no'?'no':''}" data-sk="${c[0]}">${c[1]}${active?` <span class="ar">${sortDir<0?'▼':'▲'}</span>`:''}</th>`;}).join('');
  const retCol=p=>p>=70?'#1f8a5b':(p>=45?'#d9920a':'#E10600');
  const body=shown.map((a,i)=>{
    const dorm=a.riesgo+a.inact;
    return `<tr class="click" data-ase="${a.ase.replace(/"/g,'&quot;')}">
      <td class="rk">${i+1}</td>
      <td><div class="aname">${aseShort(a.ase)}</div><div class="asmall">${a.suc}</div></td>
      <td class="num">${nfK.format(a.n)}</td>
      <td class="num">${nfK.format(a.activos)}</td>
      <td class="num"><span style="color:#1f8a5b">${a.nuevos?'+'+nfK.format(a.nuevos):'—'}</span></td>
      <td class="num"><span style="color:${dorm>a.activos?'#E10600':'var(--txt2)'}">${nfK.format(dorm)}</span></td>
      <td class="num"><span class="retbar"><i style="width:${Math.min(100,a.ret)}%;background:${retCol(a.ret)}"></i></span>${nf1.format(a.ret)}%</td>
      <td class="num">${kgC(a.kg)}</td>
      <td class="num">${nf1.format(a.pCred)}%</td>
      <td class="num">${a.moraVal>0?`<span class="pill bad">${copM(a.moraVal)}</span>`:'<span style="color:var(--txt3)">—</span>'}</td></tr>`;}).join('');
  document.getElementById('aseTableWrap').innerHTML=`<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  document.querySelectorAll('#aseTableWrap th[data-sk]').forEach(th=>{if(th.classList.contains('no'))return;
    th.onclick=()=>{const k=th.dataset.sk;if(k===sortKey)sortDir*=-1;else{sortKey=k;sortDir=(k==='ase')?1:-1;}render();};});
  document.querySelectorAll('#aseTableWrap tr.click').forEach(tr=>tr.onclick=()=>location.href='Hoja de Asesor.html?asesor='+encodeURIComponent(tr.dataset.ase));
  const more=document.getElementById('aseMore');
  if(arr.length>aseLimit){more.textContent=`▼ Ver más (${nfK.format(arr.length-aseLimit)} asesores más · mostrando ${aseLimit})`;more.onclick=()=>{aseLimit+=30;render();};}
  else{more.textContent=arr.length>20?`Mostrando los ${nfK.format(arr.length)} asesores de la vista`:'';more.onclick=null;}
  document.getElementById('aseHint').textContent=`${nfK.format(arr.length)} asesores · clic en una fila para abrir su hoja`;
}

// ===== tendencia de pago: aging de cartera =====
function renderPayTrend(rows){
  const buckets=[[1,30,'1–30 d',0,0],[31,60,'31–60 d',0,0],[61,90,'61–90 d',0,0],[91,9999,'+90 d',0,0]];
  let totVal=0,nConMora=0,sumDias=0,nFact=0;
  rows.forEach(x=>{(x.c.mora||[]).forEach(([f,d,v])=>{const b=buckets.find(b=>d>=b[0]&&d<=b[1]);if(b){b[3]++;b[4]+=v;}totVal+=v;sumDias+=d*1;nFact++;});if(x.nMora>0)nConMora++;});
  const alDia=rows.length-nConMora,pctAlDia=rows.length?alDia/rows.length*100:0;
  const diasProm=nFact?sumDias/nFact:0;
  const cls=['warn','warn','bad','bad'];const colN=['#d9920a','#d9920a','#E10600','#E10600'];
  document.getElementById('payTrendBox').innerHTML=`
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:14px">
      <div style="flex:1;min-width:130px;background:var(--bg);border:1px solid var(--line);border-radius:11px;padding:13px 15px">
        <div style="font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--txt3);font-family:Oswald">Clientes al día</div>
        <div style="font-family:Oswald;font-size:28px;font-weight:600;color:#1f8a5b;margin-top:6px">${nf1.format(pctAlDia)}%</div>
        <div style="font-size:11px;color:var(--txt2);font-family:IBM Plex Mono;margin-top:3px">${nfK.format(alDia)} de ${nfK.format(rows.length)} sin mora</div>
      </div>
      <div style="flex:1;min-width:130px;background:var(--bg);border:1px solid var(--line);border-radius:11px;padding:13px 15px">
        <div style="font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--txt3);font-family:Oswald">Mora promedio</div>
        <div style="font-family:Oswald;font-size:28px;font-weight:600;color:${diasProm>60?'#E10600':'#d9920a'};margin-top:6px">${nfK.format(diasProm)} <span style="font-size:14px;color:var(--txt3)">días</span></div>
        <div style="font-size:11px;color:var(--txt2);font-family:IBM Plex Mono;margin-top:3px">${nfK.format(nFact)} facturas vencidas</div>
      </div>
    </div>
    <div style="font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--txt3);font-family:Oswald;margin-bottom:8px">Facturas vencidas por antigüedad</div>
    <div class="aging">${buckets.map((b,i)=>`<div class="agbox"><div class="n" style="color:${colN[i]}">${nfK.format(b[3])}</div><div style="font-size:10px;color:var(--txt3)">facturas</div><div class="r">${b[2]}</div><div class="m">${copM(b[4])}</div></div>`).join('')}</div>
    <div class="barrow" style="border:none;padding-top:6px"><div class="nm" style="width:auto;flex:1;color:var(--txt2)">Total cartera vencida</div><b style="font-family:IBM Plex Mono;color:var(--red)">${copM(totVal)}</b></div>`;
  document.getElementById('payTrendHint').textContent=`${nfK.format(nConMora)} clientes con mora · ${nf1.format(pctAlDia)}% al día`;
}

// ===== tipos de plazo =====
function renderPlazo(rows){
  const m={};rows.forEach(x=>{m[x.plazo]=(m[x.plazo]||0)+1;});
  const arr=Object.entries(m).map(([k,v])=>({nm:k,n:v})).sort((a,b)=>b.n-a.n);
  const tot=rows.length||1,max=arr[0]?arr[0].n:1;
  document.getElementById('plazoBox').innerHTML=arr.slice(0,9).map(p=>{
    const isCont=/contado/i.test(p.nm);
    return `<div class="barrow"><div class="nm" style="width:220px" title="${p.nm}">${p.nm}</div>
      <div class="bar"><i style="width:${(p.n/max*100).toFixed(1)}%;background:${isCont?'linear-gradient(90deg,#7a8088,#5a6066)':'linear-gradient(90deg,var(--acc),var(--acc2))'}"></i></div>
      <div class="nv">${nfK.format(p.n)}</div><div class="pc">${nf1.format(p.n/tot*100)}%</div></div>`;}).join('');
  document.getElementById('plazoHint').textContent=`${arr.length} condiciones · top ${Math.min(9,arr.length)}`;
}

// ===== desempeño por sede =====
let sedeSort={key:'n',dir:-1},sedeBaseCache=null;
window.sedeSortBy=function(key){
  if(sedeSort.key===key){sedeSort.dir*=-1;}
  else{sedeSort={key,dir:key==='nm'?1:-1};}
  if(sedeBaseCache)renderSede(sedeBaseCache);
};
function renderSede(base){
  sedeBaseCache=base;
  const m={};base.forEach(x=>{const s=m[x.suc]=m[x.suc]||{nm:x.suc,n:0,activos:0,nuevos:0,kg:0};
    s.n++;if(x.activo)s.activos++;if(x.state==='nuevo')s.nuevos++;s.kg+=x.kg;});
  const arr=Object.values(m);
  arr.forEach(s=>{s.ret=s.n?s.activos/s.n*100:0;
    const meta=(DATA.metaSede&&DATA.metaSede[s.nm])||0;
    s.metaPct=meta>0?s.kg/meta*100:-1;});
  const k=sedeSort.key,d=sedeSort.dir;
  arr.sort((a,b)=>k==='nm'?d*a.nm.localeCompare(b.nm,'es'):d*((a[k]||0)-(b[k]||0)));
  const max=Math.max(1,...arr.map(s=>s.n));
  const kgTot=base.reduce((s,x)=>s+x.kg,0)||1;
  const _lm=+((MONTHS[MONTHS.length-1]||'2026-01').split('-')[1])||MONTHS.length;
  const expPace=Math.min(1,_lm/12);
  const metaCell=(kg,meta)=>{if(!(meta>0))return '<span style="color:var(--txt3)">—</span>';
    const p=expPace>0?(kg/meta)/expPace:0;const col=p>=0.98?'#1f8a5b':(p>=0.85?'#d9920a':'#E10600');
    return `<span style="color:${col}" title="meta anual ${kgC(meta)} kg">${nf1.format(kg/meta*100)}% meta</span>`;};
  const th=(key,label,style)=>{const on=sedeSort.key===key;
    return `<div class="sth${on?' on':''}" style="${style||''}" onclick="sedeSortBy('${key}')">${label}${on?(sedeSort.dir<0?' ▾':' ▴'):''}</div>`;};
  const head=`<div class="barrow shead">
      ${th('nm','Sede','width:200px;text-align:left')}
      <div class="sth" style="flex:1;cursor:default"></div>
      ${th('n','Clientes','width:92px')}
      ${th('activos','Activos · nuevos','width:96px')}
      ${th('kg','Kg · %','width:110px')}
      ${th('metaPct','% meta','width:84px')}
      ${th('ret','Ret.','width:54px')}
    </div>`;
  document.getElementById('sucBox').innerHTML=head+arr.map(s=>{const ret=s.ret;
    const meta=(DATA.metaSede&&DATA.metaSede[s.nm])||0;
    return `<div class="barrow"><div class="nm" title="${s.nm}">${s.nm}</div>
      <div class="bar"><i style="width:${(s.activos/max*100).toFixed(1)}%;background:linear-gradient(90deg,#cfd4da,#cfd4da)"></i><i style="width:0"></i></div>
      <div class="nv">${nfK.format(s.n)} <span style="color:var(--txt3);font-size:10px">cli</span></div>
      <div class="cm" style="width:96px;font-size:11px;color:var(--txt2)">${nfK.format(s.activos)} act · ${s.nuevos?'+'+s.nuevos:'0'} nv</div>
      <div class="cm" style="width:110px;font-size:11px;color:var(--txt2);text-align:right;font-family:IBM Plex Mono">${kgC(s.kg)} kg · ${nf1.format(s.kg/kgTot*100)}%</div>
      <div class="cm" style="width:84px;font-size:11px">${metaCell(s.kg,meta)}</div>
      <div class="pc" style="color:${ret>=55?'#1f8a5b':(ret>=40?'#d9920a':'#E10600')}">${nf1.format(ret)}%</div></div>`;}).join('');
  document.getElementById('sucHint').textContent=`${arr.length} sedes · barra = activos · kg y % meta anual · % = retención`;
}

// ===== frecuencia de compra =====
let freqSel=null,freqBaseCache=null;
window.freqPick=function(i){freqSel=freqSel===i?null:i;if(freqBaseCache)renderFreq(freqBaseCache);};
function renderFreq(base){
  freqBaseCache=base;
  const cnt=[0,0,0,0,0,0]; // 0..5 meses
  base.forEach(x=>{cnt[x.nMeses]++;});
  const tot=base.length||1;
  const labels=['0 meses','1 mes','2 meses','3 meses','4 meses','5 meses'];
  const cols=['#aeb4ba','#cfd4da','#9aa1a8','#5a6066','#B00500','#E10600'];
  // mostramos 1..5 (0 = nunca compró, suele ser 0 en estos datos)
  const show=[1,2,3,4,5];
  let detail='';
  if(freqSel!=null){
    const grp=base.filter(x=>x.nMeses===freqSel).sort((a,b)=>b.kg-a.kg);
    const gKg=grp.reduce((s,x)=>s+x.kg,0);
    const CAP=40,shown=grp.slice(0,CAP);
    detail=`<div class="fqdet">
      <div class="fqdet-head">
        <span style="font-family:Oswald;font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--txt2)">
          <span class="dot" style="background:${cols[freqSel]};display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px"></span>
          Clientes con ${labels[freqSel]} de compra · ${nfK.format(grp.length)}</span>
        <span style="font-size:11px;color:var(--txt3);cursor:pointer" onclick="freqPick(${freqSel})">✕ cerrar</span>
      </div>
      <div class="fqdet-sum" style="grid-template-columns:repeat(2,1fr)">
        <div><span class="l">Clientes</span><span class="v">${nfK.format(grp.length)}</span></div>
        <div><span class="l">Volumen a la fecha</span><span class="v">${kgC(gKg)}<small style="font-size:11px;color:var(--txt3)"> kg</small></span></div>
      </div>
      <div style="max-height:250px;overflow:auto">
        ${shown.map(x=>`<div class="barrow" style="padding:5px 0">
          <div class="nm" style="width:230px" title="${(x.name||'').replace(/"/g,'&quot;')}">${x.name}</div>
          <div class="cm" style="width:auto;flex:1;text-align:left;color:var(--txt3);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${x.suc}</div>
          <div class="nv" style="width:80px">${kgC(x.kg)} <span style="color:var(--txt3);font-size:10px">kg</span></div>
          <div class="pc" style="width:64px;color:var(--txt2)">${nf1.format(gKg?x.kg/gKg*100:0)}%</div></div>`).join('')||'<div class="foot-note">Sin clientes en este grupo.</div>'}
      </div>
      ${grp.length>CAP?`<div class="foot-note" style="margin-top:6px">Mostrando ${CAP} de ${nfK.format(grp.length)} clientes (ordenados por volumen).</div>`:''}
    </div>`;
  }
  document.getElementById('freqBox').innerHTML=`<div class="freq">${show.map(i=>`
    <div class="fqbox${freqSel===i?' sel':''}" onclick="freqPick(${i})" title="clic para ver clientes y volumen"><div class="top" style="background:${cols[i]}"></div>
      <div class="n" style="color:${i>=4?cols[i]:'var(--txt)'}">${nfK.format(cnt[i])}</div>
      <div class="r">${labels[i]}</div>
      <div class="p">${nf1.format(cnt[i]/tot*100)}%</div></div>`).join('')}</div>
    ${detail}
    <div class="foot-note">Cuántos de los 5 meses compró cada cliente. Más meses = mayor fidelidad. Los de 4–5 meses son la columna vertebral de la base. Clic en un grupo para ver sus clientes y volumen.</div>`;
}

// ===== cobertura geográfica =====
function renderGeo(base){
  const m={};base.forEach(x=>{const c=m[x.ciu]=m[x.ciu]||{nm:x.ciu,n:0,activos:0,kg:0};c.n++;if(x.activo)c.activos++;c.kg+=x.kg;});
  const arr=Object.values(m).sort((a,b)=>b.n-a.n).slice(0,12);
  const max=arr[0]?arr[0].n:1,tot=base.length||1;
  const kgTot=base.reduce((s,x)=>s+x.kg,0)||1;
  document.getElementById('geoBox').innerHTML=arr.map(s=>`<div class="barrow">
    <div class="nm" title="${s.nm}">${s.nm}</div>
    <div class="bar"><i style="width:${(s.n/max*100).toFixed(1)}%"></i></div>
    <div class="nv">${nfK.format(s.n)}</div><div class="pc">${nf1.format(s.n/tot*100)}%</div>
    <div class="cm" style="width:96px;color:var(--txt2);font-size:11px">${nfK.format(s.activos)} activos</div>
    <div class="cm" style="width:110px;color:var(--txt2);font-size:11px;text-align:right;font-family:IBM Plex Mono">${kgC(s.kg)} kg · ${nf1.format(s.kg/kgTot*100)}%</div></div>`).join('');
  document.getElementById('geoHint').textContent=`top 12 de ${Object.keys(m).length} ciudades · clientes y volumen`;
}

// ===== binds =====
function bindFilters(){
  const map={fSuc:'suc',fAse:'ase',fEstado:'estado',fPago:'pago'};
  for(const id in map){const el=document.getElementById(id);el.value=ST[map[id]]||'';
    el.onchange=()=>{ST[map[id]]=el.value;aseLimit=20;saveState();render();};}
  const sb=document.getElementById('fSearch');sb.value=ST.q||'';
  let t;sb.oninput=()=>{clearTimeout(t);t=setTimeout(()=>{ST.q=sb.value.trim();aseLimit=20;saveState();render();},220);};
  document.getElementById('fClear').onclick=()=>{Object.keys(ST).forEach(k=>ST[k]='');aseLimit=20;
    for(const id in map)document.getElementById(id).value='';sb.value='';saveState();render();};
}

function boot(){
  const sub=document.getElementById('subt');
  if(sub){const rango=MES[0]+'–'+MES[MONTHS.length-1]+' '+YR;
    const refTxt=PARTIAL?` · ${MES[MONTHS.length-1]} parcial · mes de referencia: ${MES[REF]}`:'';
    sub.textContent=`La Campana · ${rango}${refTxt} · ${nfK.format(ALL.length)} clientes · ${window.LC_DATA_IMPORTED?'datos importados':'datos demo'}`;}
  bindFilters();render();
  const pb=document.getElementById('printBtn');if(pb)pb.onclick=()=>window.print();
  const tvb=document.getElementById('tvBtn'),tvx=document.getElementById('tvExit');
  if(tvb&&tvx){const setTV=on=>{document.body.classList.toggle('tv',on);
      try{if(on&&document.documentElement.requestFullscreen)document.documentElement.requestFullscreen().catch(()=>{});
      else if(!on&&document.fullscreenElement)document.exitFullscreen();}catch(e){}};
    tvb.onclick=()=>setTV(true);tvx.onclick=()=>setTV(false);
    document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)document.body.classList.remove('tv');});}
  const gm=document.getElementById('guideModal');if(gm){
    document.getElementById('guideBtn').onclick=()=>gm.classList.add('show');
    document.getElementById('guideClose').onclick=()=>gm.classList.remove('show');
    gm.onclick=e=>{if(e.target===gm)gm.classList.remove('show');};
  }
  document.getElementById('loading').classList.add('hide');
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
};
