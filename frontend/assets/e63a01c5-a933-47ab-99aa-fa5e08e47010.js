/* ===== Panorama de Producción Diaria · La Campana · IPN =====
   Igual que Producción, pero conservando el DÍA de la Fecha (no se agrega por mes).
   Objetivo: días muertos, rendimiento por máquina y días más productivos.
   Fuente: export IPN (Fecha · Codigo de Almacen · Nombre de Usuario · Grupo · Maquina · Articulo · Cantidad Requerida (Kg) · Comentarios) */
window.LCBootProdDaily=function(){
'use strict';
const DATA=window.PROD_DAILY_DATA;
const hasData=!!(DATA&&DATA.days&&DATA.days.length&&DATA.recs&&DATA.recs.length);

const MES=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const DOW=['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const nfK=new Intl.NumberFormat('es-CO',{maximumFractionDigits:0});
const nf1=new Intl.NumberFormat('es-CO',{minimumFractionDigits:1,maximumFractionDigits:1});
function kgC(v){ if(Math.abs(v)>=1e6) return nf1.format(v/1e6)+' M'; if(Math.abs(v)>=1e3) return nf1.format(v/1e3)+' k'; return nfK.format(v); }
function tC(v){ const t=v/1000; if(Math.abs(t)>=1e3) return nf1.format(t/1e3)+' k'; return nf1.format(t); }
function esc(s){return (s==null?'':(''+s)).replace(/"/g,'&quot;').replace(/</g,'&lt;');}

// ---- estado vacío (sin dataset importado) ----
function showEmpty(){
  document.getElementById('loading').classList.add('hide');
  const box=document.getElementById('dailyMain');
  if(box)box.innerHTML=`<div class="empty-state">
    <div class="es-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/><path d="M7 13h2M11 13h2M15 13h2M7 17h2M11 17h2"/></svg></div>
    <h2>Sin datos diarios cargados</h2>
    <p>Este panel muestra la producción <b>día por día</b> de cada máquina, tomando la <b>Fecha</b> exacta de tu export IPN (sin agregar por mes). Sube tu Excel para ver días muertos, rendimiento por máquina y qué días son los más productivos.</p>
    <button class="btn" id="esLoad"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/></svg> Cargar Excel</button>
    <div class="es-hint">Se reconoce el mismo archivo que usas en <b>PRODUCCIÓN</b>. La única diferencia: aquí se conserva el día completo de la Fecha.</div>
  </div>`;
  const b=document.getElementById('esLoad');if(b)b.onclick=()=>document.getElementById('xlsModal').classList.add('show');
  document.getElementById('subt').textContent='La Campana · sube tu Excel para comenzar';
  ['fPlanta','fGrupo','fMaq','fSearch','fWin'].forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=true;});
}

if(!hasData){ bindExcel(); showEmpty(); return; }

// =============================================================
//  Con datos
// =============================================================
const DAYS=DATA.days;                 // ["2026-01-02", ...] ordenadas
const MACHS=DATA.machines||[];        // [{name,tipo,meta}]
const GROUPS=DATA.groups||[];
const PLANT_NAMES=Object.assign({SCESE:'Cesar (SCESE)'},DATA.plantas||{});
const plantName=c=>PLANT_NAMES[c]||c||'(Sin almacén)';
function canonTipo(name){const u=(name||'').toString().toUpperCase();return /\bSLITTER\b|\bCTL\b|CUT.?TO.?LENGTH/.test(u)?'corte':'transformacion';}
const tipoOf=i=>(MACHS[i]&&MACHS[i].tipo)||canonTipo(MACHS[i]&&MACHS[i].name);

// ===== metas mensuales por máquina (kg/mes) =====
// Compartidas con el panorama de PRODUCCIÓN mediante el mismo almacén (prod_config).
const METAS={};
(MACHS||[]).forEach(m=>{if(m&&m.name&&+m.meta>0)METAS[m.name]=+m.meta;});
((window.PROD_DAILY_CFG&&window.PROD_DAILY_CFG.machines)||[]).forEach(m=>{if(m&&m.name)METAS[m.name]=+m.meta||0;});
function metaOf(name){return +METAS[name]||0;}
function saveMeta(name,kg){
  METAS[name]=+kg||0;
  // fusiona con la configuración existente para no pisar tipo/asignaciones
  return lcGet('prod_config').then(cfg=>{
    cfg=cfg||{};
    const machines=Array.isArray(cfg.machines)?cfg.machines.slice():[];
    const idx=machines.findIndex(m=>m&&m.name===name);
    if(idx>=0)machines[idx]=Object.assign({},machines[idx],{meta:+kg||0});
    else machines.push({name,meta:+kg||0,tipo:tipoOf(MACHS.findIndex(m=>m.name===name))});
    cfg.machines=machines;
    return lcSet('prod_config',cfg);
  }).catch(()=>{});
}

// precompute info por día
const DINFO=DAYS.map(s=>{const [y,m,d]=s.split('-').map(Number);const dow=new Date(y,m-1,d).getDay();
  return {s,y,m,d,dow,lab:d+' '+MES[m-1],work:dow!==0&&dow!==6};}); // laboral = lun-vie (excluye sábado y domingo)
const NWORK=DINFO.filter(x=>x.work).length;

// =============== state / filtros ===============
const ST={planta:'',grupo:'',maq:'',q:'',win:''};
try{const s=JSON.parse(localStorage.getItem('LC_PRODD_FILTERS')||'null');if(s)Object.assign(ST,s);}catch(e){}
function saveState(){try{localStorage.setItem('LC_PRODD_FILTERS',JSON.stringify(ST));}catch(e){}}

// ventana de tiempo -> rango de índices de día visibles
function winRange(){
  const n=DAYS.length; let from=0;
  const w=+ST.win||0;
  if(w>0){ // últimos w días de calendario
    const lastS=DAYS[n-1], [ly,lm,ld]=lastS.split('-').map(Number);
    const cutoff=new Date(ly,lm-1,ld); cutoff.setDate(cutoff.getDate()-(w-1));
    const cs=cutoff.getFullYear()+'-'+('0'+(cutoff.getMonth()+1)).slice(-2)+'-'+('0'+cutoff.getDate()).slice(-2);
    from=DAYS.findIndex(s=>s>=cs); if(from<0)from=0;
  }
  return {from,to:n-1};
}

// listas de opciones
function uniqSorted(a){return [...new Set(a)].sort((x,y)=>x.localeCompare(y,'es'));}
const PLANTAS=uniqSorted(DATA.recs.map(r=>plantName(r.al)));
const GRPS=uniqSorted(DATA.recs.map(r=>GROUPS[r.g]||'(s/g)'));
const MAQNAMES=uniqSorted(MACHS.map(m=>m.name));
function fillSel(id,opts,allLabel){const el=document.getElementById(id);if(!el)return;
  el.innerHTML=`<option value="">${allLabel}</option>`+opts.map(o=>`<option value="${esc(o)}">${o}</option>`).join('');}
fillSel('fPlanta',PLANTAS,'Todas');fillSel('fGrupo',GRPS,'Todos');fillSel('fMaq',MAQNAMES,'Todas');

function passes(r){
  if(ST.planta&&plantName(r.al)!==ST.planta)return false;
  if(ST.grupo&&(GROUPS[r.g]||'(s/g)')!==ST.grupo)return false;
  if(ST.maq&&(MACHS[r.mq]&&MACHS[r.mq].name)!==ST.maq)return false;
  if(ST.q){const q=ST.q.toLowerCase();const nm=(MACHS[r.mq]&&MACHS[r.mq].name||'').toLowerCase(),g=(GROUPS[r.g]||'').toLowerCase(),d=(r.d||'').toLowerCase(),c=(r.com||'').toLowerCase();
    if(!nm.includes(q)&&!g.includes(q)&&!d.includes(q)&&!c.includes(q))return false;}
  return true;
}

// =============== agregación diaria ===============
function build(){
  const {from,to}=winRange();
  const nD=DAYS.length;
  const dayTot=new Array(nD).fill(0);           // kg totales por día (todo el rango de días)
  const machDay={};                              // name -> array[nD]
  MACHS.forEach(m=>machDay[m.name]=new Array(nD).fill(0));
  const machArtDay={};                           // name -> { di -> { articulo -> kg } }
  let grand=0, nRec=0;
  DATA.recs.forEach(r=>{
    if(!passes(r))return; nRec++;
    const nm=(MACHS[r.mq]&&MACHS[r.mq].name)||'(sin máquina)';
    if(!machDay[nm])machDay[nm]=new Array(nD).fill(0);
    const art=(r.d||'(sin artículo)');
    let mad=machArtDay[nm]; if(!mad)mad=machArtDay[nm]={};
    r.cells.forEach(c=>{const di=c[0],kg=c[1]; if(di<from||di>to)return; machDay[nm][di]+=kg; dayTot[di]+=kg; grand+=kg;
      let dd=mad[di]; if(!dd)dd=mad[di]={}; dd[art]=(dd[art]||0)+kg;});
  });
  // stats por máquina (dentro de su rango activo, solo días laborales)
  const machines=Object.keys(machDay).map(nm=>{
    const arr=machDay[nm]; let first=-1,last=-1;
    for(let i=from;i<=to;i++){if(arr[i]>0){if(first<0)first=i;last=i;}}
    let active=0,dead=0,low=0,sum=0; const activeVals=[];
    for(let i=from;i<=to;i++){ if(!DINFO[i].work)continue;
      if(arr[i]>0){active++;activeVals.push(arr[i]);sum+=arr[i];} else dead++; }
    activeVals.sort((a,b)=>a-b);
    const med=activeVals.length?activeVals[Math.floor(activeVals.length/2)]:0;
    if(first>=0){for(let i=from;i<=to;i++){if(DINFO[i].work&&arr[i]>0&&arr[i]<0.2*med)low++;}}
    const totDays=active+dead;
    return {name:nm,tipo:tipoOf(MACHS.findIndex(m=>m.name===nm)),arr,first,last,active,dead,low,sum,med,arts:machArtDay[nm]||{},
      avg:active?sum/active:0,util:totDays?active/totDays:0,best:activeVals.length?activeVals[activeVals.length-1]:0};
  }).filter(m=>m.sum>0||m.dead>0);
  machines.sort((a,b)=>b.sum-a.sum);
  return {from,to,dayTot,machines,grand,nRec};
}

// =============== charts ===============
const semU=u=>u>=0.9?'#1f8a5b':(u>=0.7?'#d9920a':'#E10600');
function heatColor(v,max){ if(v<=0)return null; const t=Math.min(1,Math.pow(v/max,0.6));
  // gris claro -> ferrari
  const r=Math.round(233*t+230*(1-t)),g=Math.round(6*t+232*(1-t)),b=Math.round(0*t+235*(1-t));
  return `rgb(${r},${g},${b})`; }

// =============== render ===============
function render(){
  const B=build();
  const {from,to,dayTot,machines,grand,nRec}=B;
  const vDays=DINFO.slice(from,to+1);
  const workDays=vDays.filter(x=>x.work);
  const activeDayCount=dayTot.slice(from,to+1).filter((v,i)=>v>0).length;
  // día muerto global = día laboral dentro del rango con producción>0 en algún punto, sin producción
  const firstProd=dayTot.findIndex((v,i)=>i>=from&&v>0);
  const lastProd=(()=>{for(let i=to;i>=from;i--)if(dayTot[i]>0)return i;return -1;})();
  let deadGlobal=0;
  if(firstProd>=0)for(let i=firstProd;i<=lastProd;i++)if(DINFO[i].work&&dayTot[i]===0)deadGlobal++;
  const avgWork=(()=>{let s=0,c=0;if(firstProd>=0)for(let i=firstProd;i<=lastProd;i++){if(DINFO[i].work&&dayTot[i]>0){s+=dayTot[i];c++;}}return c?s/c:0;})();
  // mejor día
  let bi=-1;for(let i=from;i<=to;i++){if(bi<0||dayTot[i]>dayTot[bi])bi=i;}
  const totMachActive=machines.filter(m=>m.sum>0).length;
  const totDead=machines.reduce((s,m)=>s+m.dead,0);

  document.getElementById('fCount').innerHTML=`<b>${nfK.format(nRec)}</b> registros · ${kgC(grand)} kg · ${activeDayCount} días con producción · ${totMachActive} máquinas activas`;

  // KPIs
  const rangeLbl=vDays.length?`${DINFO[from].lab} – ${DINFO[to].lab}`:'—';
  // meta mensual — solo al filtrar por una máquina
  let metaKpis='';
  if(ST.maq){
    const meta=metaOf(ST.maq),monthKg={};
    for(let i=from;i<=to;i++){if(dayTot[i]>0){const k=DINFO[i].y+'-'+DINFO[i].m;monthKg[k]=(monthKg[k]||0)+dayTot[i];}}
    const nMonths=Object.keys(monthKg).length,avgMonth=nMonths?grand/nMonths:0;
    CUR_META_CTX={avgMonth,nMonths};
    metaKpis=kpiMetaEdit(ST.maq,meta)+kpiMetaComp(avgMonth,meta,nMonths);
  }
  document.getElementById('kpis').innerHTML=metaKpis+`
    ${kpi('Producción total','🏭',`${kgC(grand)}<small> kg</small>`,`${tC(grand)} t · ${rangeLbl}`)}
    ${kpi('Promedio por día laboral','📦',`${kgC(avgWork)}<small> kg</small>`,`solo lun–vie con producción`)}
    ${kpi('Días con producción','📅',`${activeDayCount}<small> / ${workDays.length}</small>`,`de ${workDays.length} días laborales en el rango`)}
    ${kpiDead('Días muertos (global)',deadGlobal,workDays.length)}
    ${kpi('Día muerto·máquina','🛑',`<span style="color:${totDead?'var(--red)':'var(--txt)'}">${nfK.format(totDead)}</span>`,'días laborales sin carga (suma por máquina)')}
    ${kpiBestDay(bi,dayTot)}`;
  if(ST.maq)bindMetaInput(ST.maq);

  renderHeatmap(dayTot,from,to);
  renderWeekday(dayTot,from,to);
  renderTopDays(dayTot,from,to);
  renderMachineUtil(machines,workDays.length);
  renderMachineTrend(machines,from,to);
  renderMachineArticles(machines,from,to);
  renderDetail(machines,from,to);
  renderAlerts(machines,deadGlobal,bi,dayTot);
}

function kpi(l,ic,v,d){return `<div class="kpi"><div class="accent"></div><div class="l">${ic} ${l}</div><div class="v">${v}</div><div class="d">${d}</div></div>`;}
function kpiDead(l,n,tot){const bad=n>0,pct=tot?n/tot*100:0;
  return `<div class="kpi ${bad?'risk':''}"><div class="accent"></div><div class="l">🛑 ${l}</div>
    <div class="v">${nfK.format(n)}</div>
    <div class="d">${nf1.format(pct)}% de los días laborales${bad?' sin producción alguna':''}</div></div>`;}
function kpiBestDay(bi,dayTot){ if(bi<0)return kpi('Día más productivo','🏆','—','sin datos');
  return `<div class="kpi"><div class="accent"></div><div class="l">🏆 Día más productivo</div>
    <div class="v">${DINFO[bi].d} ${MES[DINFO[bi].m-1]}<small style="font-size:13px"> · ${DOW[DINFO[bi].dow]}</small></div>
    <div class="d">${kgC(dayTot[bi])} kg en el día</div></div>`;}

// ===== meta mensual por máquina (KPIs al filtrar por una máquina) =====
let CUR_META_CTX={avgMonth:0,nMonths:0};
const metaCol=(meta,pct)=>meta>0?(pct>=0.98?'#1f8a5b':(pct>=0.85?'#d9920a':'#E10600')):'var(--txt3)';
function kpiMetaEdit(name,meta){
  return `<div class="kpi kpi-metaedit"><div class="accent"></div>
    <div class="l">🎯 Meta mensual · <b style="color:var(--txt2);font-weight:600">${esc(name)}</b></div>
    <div class="v"><input id="metaInput" class="meta-in" type="text" inputmode="numeric" autocomplete="off" value="${meta>0?nfK.format(meta):''}" placeholder="0"><small> kg/mes</small></div>
    <div class="d">objetivo de producción por mes · <span id="metaSaved" style="color:var(--txt3)">escribe para guardar</span></div></div>`;
}
function kpiMetaComp(avgMonth,meta,nMonths){
  const pct=meta>0?avgMonth/meta:0,col=metaCol(meta,pct);
  return `<div class="kpi" id="metaCompCard"><div class="accent" style="background:${col}"></div>
    <div class="l">📊 Cumplimiento de meta</div>
    <div class="v" style="color:${col}">${meta>0?nf1.format(pct*100):'—'}<small>%</small></div>
    <div class="mbar"><i style="width:${meta>0?Math.min(100,pct*100).toFixed(1):0}%;background:${col}"></i></div>
    <div class="d">${kgC(avgMonth)} / ${meta>0?kgC(meta):'—'} kg · promedio de ${nMonths} mes${nMonths!==1?'es':''}</div></div>`;
}
function updateMetaComp(kg){
  const card=document.getElementById('metaCompCard');if(!card)return;
  const {avgMonth,nMonths}=CUR_META_CTX,meta=+kg||0,pct=meta>0?avgMonth/meta:0,col=metaCol(meta,pct);
  card.querySelector('.accent').style.background=col;
  const v=card.querySelector('.v');v.style.color=col;v.innerHTML=`${meta>0?nf1.format(pct*100):'—'}<small>%</small>`;
  const bar=card.querySelector('.mbar i');bar.style.width=(meta>0?Math.min(100,pct*100):0)+'%';bar.style.background=col;
  card.querySelector('.d').innerHTML=`${kgC(avgMonth)} / ${meta>0?kgC(meta):'—'} kg · promedio de ${nMonths} mes${nMonths!==1?'es':''}`;
}
function bindMetaInput(name){
  const inp=document.getElementById('metaInput');if(!inp)return;
  const saved=document.getElementById('metaSaved');let t;
  inp.oninput=()=>{const kg=_num(inp.value);updateMetaComp(kg);
    if(saved){saved.textContent='guardando…';saved.style.color='var(--txt3)';}
    clearTimeout(t);t=setTimeout(()=>{saveMeta(name,kg);if(saved){saved.textContent='✓ meta guardada';saved.style.color='#1f8a5b';}},500);};
  inp.onblur=()=>{const kg=_num(inp.value);inp.value=kg>0?nfK.format(kg):'';};
}

// -------- gráfica lineal · producción diaria (días en la horizontal) --------
function renderHeatmap(dayTot,from,to){
  const box=document.getElementById('heatBox'),hint=document.getElementById('heatHint');if(!box)return;
  const n=to-from+1;
  if(n<=0){box.innerHTML=emptyRow();if(hint)hint.textContent='';return;}
  let max=0;for(let i=from;i<=to;i++)if(dayTot[i]>max)max=dayTot[i];if(max<=0)max=1;
  // geometría: llena el ancho del panel; sólo hace scroll si hay muchísimos días
  const W=n>46?(n*30+90):1280,H=440,padL=66,padR=22,padT=22,padB=56;
  const iw=W-padL-padR, ih=H-padT-padB;
  const X=k=>padL+(n===1?iw/2:iw*k/(n-1));
  const Y=v=>padT+ih-(v/max)*ih;
  // línea + área
  let path='',area='',dots='',deadMarks='',xlabels='';
  const pts=[];
  for(let k=0;k<n;k++){const i=from+k,v=dayTot[i];const x=X(k),y=Y(v);pts.push([x,y,i,v]);}
  path=pts.map((p,k)=>(k?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
  area='M'+pts[0][0].toFixed(1)+' '+(padT+ih)+' '+pts.map(p=>'L'+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ')+' L'+pts[n-1][0].toFixed(1)+' '+(padT+ih)+' Z';
  pts.forEach(p=>{const i=p[2],v=p[3],dead=v===0&&DINFO[i].work;
    if(v>0)dots+=`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="var(--ferrari)"><title>${DINFO[i].lab} (${DOW[DINFO[i].dow]}) · ${kgC(v)} kg</title></circle>`;
    if(dead)deadMarks+=`<rect x="${(p[0]-3).toFixed(1)}" y="${padT+ih-6}" width="6" height="6" rx="1.5" fill="none" stroke="var(--red)" stroke-width="1.4"><title>${DINFO[i].lab} (${DOW[DINFO[i].dow]}) · día muerto</title></rect>`;
  });
  // etiquetas del eje X: día + fecha (día, mes) y día de la semana; espaciadas para no encimarse
  const stepPx=44, perDay=n>1?iw/(n-1):iw, every=Math.max(1,Math.round(stepPx/perDay));
  for(let k=0;k<n;k++){const i=from+k;const monthStart=DINFO[i].d===1;const edge=k===0||k===n-1;
    if(!(monthStart||edge||k%every===0))continue;
    const x=X(k);const lab=DINFO[i].d+' '+MES[DINFO[i].m-1];
    xlabels+=`<line x1="${x.toFixed(1)}" y1="${padT+ih}" x2="${x.toFixed(1)}" y2="${(padT+ih+5).toFixed(1)}" stroke="var(--line2)"/>
      <text x="${x.toFixed(1)}" y="${(padT+ih+17).toFixed(1)}" fill="var(--txt2)" font-size="9.5" text-anchor="middle" font-family="IBM Plex Mono">${lab}</text>
      <text x="${x.toFixed(1)}" y="${(padT+ih+29).toFixed(1)}" fill="var(--txt3)" font-size="8.5" text-anchor="middle" font-family="IBM Plex Mono">${DOW[DINFO[i].dow]}</text>`;
  }
  // ticks horizontales del eje Y (0, 25, 50, 75, 100%)
  let ygrid='';for(let t=0;t<=4;t++){const v=max*t/4,y=Y(v);
    ygrid+=`<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W-padR}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-dasharray="2 4"/>
      <text x="${(padL-8)}" y="${(y+3).toFixed(1)}" fill="var(--txt3)" font-size="9.5" text-anchor="end" font-family="IBM Plex Mono">${kgC(v)}</text>`;}
  const svg=`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="${n>46?'xMinYMid meet':'none'}" style="width:${n>46?W+'px':'100%'};height:${H}px;display:block">
    ${ygrid}
    <defs><linearGradient id="daFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--ferrari)" stop-opacity="0.18"/><stop offset="1" stop-color="var(--ferrari)" stop-opacity="0"/></linearGradient></defs>
    <path d="${area}" fill="url(#daFill)"/>
    <path d="${path}" fill="none" stroke="var(--ferrari)" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    ${deadMarks}${dots}${xlabels}
  </svg>`;
  box.innerHTML=`<div style="overflow-x:auto">${svg}</div>
    <div class="hm-legend"><span style="display:inline-flex;align-items:center;gap:5px"><i style="width:16px;height:2px;background:var(--ferrari);display:inline-block"></i> kg producidos por día</span>
      <span class="hm-dead"><i style="border-radius:1.5px"></i> día muerto (laboral, 0 kg)</span></div>`;
  if(hint)hint.textContent=`${n} días · pico ${kgC(max)} kg`;
}

// -------- productividad por día de la semana --------
function renderWeekday(dayTot,from,to){
  const box=document.getElementById('dowBox'),hint=document.getElementById('dowHint');if(!box)return;
  const order=[1,2,3,4,5,6,0]; // lun..dom
  const sum=new Array(7).fill(0),cnt=new Array(7).fill(0),act=new Array(7).fill(0);
  for(let i=from;i<=to;i++){const w=DINFO[i].dow;cnt[w]++;if(dayTot[i]>0){sum[w]+=dayTot[i];act[w]++;}}
  const avg=order.map(w=>act[w]?sum[w]/act[w]:0);
  const max=Math.max(...avg,1);
  box.innerHTML=order.map((w,k)=>{
    const a=avg[k],pct=a/max*100,sun=w===0||w===6;
    return `<div class="dow-row">
      <div class="dow-nm ${sun?'sun':''}">${DOW[w]}${sun?' <span>·no laboral</span>':''}</div>
      <div class="dow-bar"><i style="width:${pct.toFixed(1)}%;background:${sun?'var(--txt3)':'var(--ferrari)'}"></i></div>
      <div class="dow-v">${kgC(a)}<span> kg/día</span></div>
      <div class="dow-c">${act[w]} de ${cnt[w]} días</div></div>`;
  }).join('');
  const bestW=order[avg.indexOf(Math.max(...avg.filter((v,i)=>order[i]!==0)))]!==undefined?order[avg.reduce((bi,v,i)=>order[i]!==0&&v>avg[bi]?i:bi,0)]:1;
  if(hint)hint.textContent=`promedio kg por día activo · mejor: ${DOW[bestW]}`;
}

// -------- ranking días más productivos --------
function renderTopDays(dayTot,from,to){
  const box=document.getElementById('topBox'),hint=document.getElementById('topHint');if(!box)return;
  const arr=[];for(let i=from;i<=to;i++)if(dayTot[i]>0)arr.push({i,v:dayTot[i]});
  arr.sort((a,b)=>b.v-a.v);
  const top=arr.slice(0,12),max=top[0]?top[0].v:1;
  box.innerHTML=top.map((o,k)=>`<div class="barrow">
    <div class="rk" style="width:22px">${k+1}</div>
    <div class="nm" style="width:130px">${DINFO[o.i].lab} <span style="color:var(--txt3);font-size:11px">${DOW[DINFO[o.i].dow]}</span></div>
    <div class="bar"><i style="width:${(o.v/max*100).toFixed(1)}%"></i></div>
    <div class="nv">${kgC(o.v)}</div></div>`).join('')||emptyRow();
  if(hint)hint.textContent=`${arr.length} días con producción`;
}

// -------- máquinas · días activos vs muertos --------
function renderMachineUtil(machines,nWork){
  const box=document.getElementById('utilBox'),hint=document.getElementById('utilHint');if(!box)return;
  const arr=machines.filter(m=>m.active>0||m.dead>0).sort((a,b)=>a.util-b.util);
  if(!arr.length){box.innerHTML=emptyRow();return;}
  const rows=arr.map((m,i)=>{const col=semU(m.util);const total=m.active+m.dead;
    return `<div class="urow">
      <div class="u-l"><span class="u-rk">${i+1}</span><span class="u-nm" title="${esc(m.name)}">${m.name}</span><span class="u-tp ${m.tipo}">${m.tipo==='corte'?'corte':'transf.'}</span></div>
      <div class="u-track" title="${m.active} activos · ${m.dead} muertos"><div class="u-fill" style="width:${(m.util*100).toFixed(1)}%;background:${col}"></div></div>
      <div class="u-pct" style="color:${col}">${nf1.format(m.util*100)}%</div>
      <div class="u-v">${m.active}<span> act.</span></div>
      <div class="u-d" style="color:${m.dead?'var(--red)':'var(--txt3)'}">${m.dead}<span> muertos</span></div>
      <div class="u-avg">${kgC(m.avg)}<span>/día</span></div></div>`;}).join('');
  const totA=arr.reduce((s,m)=>s+m.active,0),totD=arr.reduce((s,m)=>s+m.dead,0),gU=(totA+totD)?totA/(totA+totD):0;
  box.innerHTML=`<div class="meta-sum">
      <div><span class="l">Máquinas</span><span class="v">${arr.length}</span></div>
      <div><span class="l">Utilización global</span><span class="v" style="color:${semU(gU)}">${nf1.format(gU*100)}%</span></div>
      <div><span class="l">Días activos (∑)</span><span class="v">${nfK.format(totA)}</span></div>
      <div><span class="l">Días muertos (∑)</span><span class="v" style="color:${totD?'var(--red)':'var(--txt)'}">${nfK.format(totD)}</span></div>
    </div>
    <div class="ucolh"><div>Máquina · ranking (peor utilización primero)</div><div>Utilización (días activos)</div><div>%</div><div>Activos</div><div>Muertos</div><div>Prom.</div></div>
    ${rows}
    <div class="foot-note" style="margin-top:10px">Utilización = días laborales (lun–vie) con producción ÷ total de días laborales de la ventana de tiempo seleccionada. <b>Día muerto</b> = día laboral sin producción en esa ventana. Verde ≥90% · ámbar ≥70% · rojo &lt;70%.</div>`;
  if(hint)hint.textContent=`${arr.length} máquinas · ${nfK.format(totD)} días muertos en total`;
}

// -------- tendencia diaria por máquina (small multiples) --------
function dSpark(arr,from,to,H){H=H||44;const seg=arr.slice(from,to+1);const max=Math.max(...seg,1),n=seg.length,W=280,step=W/n,bw=Math.max(1,step*0.72);
  let bars='';seg.forEach((v,i)=>{const dead=v===0&&DINFO[from+i].work;const h=v>0?(v/max)*(H-6):0;const x=i*step+(step-bw)/2,y=H-Math.max(v>0?1.2:0,h);
    bars+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(v>0?1.2:(dead?H-6:0),h).toFixed(1)}" rx="1" fill="${v>0?'var(--ferrari)':(dead?'rgba(225,6,0,.12)':'transparent')}"/>`;});
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:${H}px;display:block">${bars}</svg>`;}
function renderMachineTrend(machines,from,to){
  const box=document.getElementById('mtBox'),hint=document.getElementById('mtHint');if(!box)return;
  const arr=machines.filter(m=>m.sum>0).sort((a,b)=>{if(a.tipo!==b.tipo)return a.tipo==='corte'?-1:1;return b.sum-a.sum;});
  if(!arr.length){box.innerHTML=emptyRow();return;}
  box.innerHTML=`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px">${arr.map(m=>{
    const badge=m.tipo==='corte'?'#1f5fd9':'#8a5a1f';
    return `<div style="border:1px solid var(--line);border-radius:9px;padding:11px 12px 9px;background:#fff">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:7px">
        <span style="font-family:Oswald;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(m.name)}">${m.name}</span>
        <span style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:${badge};border:1px solid ${badge}33;border-radius:4px;padding:1px 5px;flex:none">${m.tipo==='corte'?'corte':'transf.'}</span></div>
      ${dSpark(m.arr,from,to)}
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:7px;font-size:11px;font-family:IBM Plex Mono">
        <span style="color:var(--txt)">${kgC(m.avg)}<small style="color:var(--txt3)">/día</small></span>
        <span style="color:${m.dead?'var(--red)':'var(--txt3)'}">${m.dead} muertos</span>
        <span style="color:var(--txt2)">${m.active} act.</span></div></div>`;}).join('')}</div>
    <div class="foot-note" style="margin-top:12px">Cada barra es un día del rango (${DINFO[from].lab}–${DINFO[to].lab}). Las marcas rojas tenues son días laborales sin producción dentro de la ventana de tiempo.</div>`;
  if(hint)hint.textContent=`${arr.length} máquinas · serie diaria`;
}

// -------- artículos por máquina · por día (drill-down) --------
function maDetailHTML(m){
  const dis=Object.keys(m.arts).map(Number).sort((a,b)=>b-a); // más reciente primero
  if(!dis.length)return '<div class="art-empty">Sin artículos en esta vista.</div>';
  return dis.map(di=>{
    const arts=m.arts[di];
    const list=Object.keys(arts).map(a=>({a,kg:arts[a]})).sort((x,y)=>y.kg-x.kg);
    const dtot=list.reduce((s,o)=>s+o.kg,0),max=list[0]?list[0].kg:1;
    return `<div class="ma-day">
      <div class="ma-dayh"><span class="ma-date">${DINFO[di].lab} <b>${DOW[DINFO[di].dow]}</b></span><span class="ma-daytot">${kgC(dtot)} kg · ${list.length} art.</span></div>
      ${list.map(o=>`<div class="ma-art"><span class="ma-an" title="${esc(o.a)}">${esc(o.a)}</span><span class="ma-abar"><i style="width:${(o.kg/max*100).toFixed(0)}%"></i></span><span class="ma-akg">${kgC(o.kg)}</span></div>`).join('')}
    </div>`;
  }).join('');
}
function renderMachineArticles(machines,from,to){
  const box=document.getElementById('maBox'),hint=document.getElementById('maHint');if(!box)return;
  const arr=machines.filter(m=>m.sum>0).sort((a,b)=>b.sum-a.sum);
  if(!arr.length){box.innerHTML=emptyRow();if(hint)hint.textContent='';return;}
  box.innerHTML=arr.map((m,i)=>{
    const nArt=new Set();Object.keys(m.arts).forEach(di=>Object.keys(m.arts[di]).forEach(a=>nArt.add(a)));
    return `<div class="mwrap" data-mi="${i}">
      <div class="ma-head">
        <span class="m-chev">▶</span>
        <span class="u-rk">${i+1}</span>
        <span class="ma-nm"><span class="nmt" title="${esc(m.name)}">${m.name}</span><span class="u-tp ${m.tipo}">${m.tipo==='corte'?'corte':'transf.'}</span></span>
        <span class="ma-cnt">${nfK.format(nArt.size)} artículos</span>
        <span class="ma-kg">${kgC(m.sum)}<span style="color:var(--txt3);font-weight:400"> kg</span></span>
        <span class="ma-days">${m.active} d.</span>
      </div>
      <div class="mdetail"></div>
    </div>`;
  }).join('');
  box.querySelectorAll('.mwrap').forEach(w=>{
    const head=w.querySelector('.ma-head'),det=w.querySelector('.mdetail'),mi=+w.dataset.mi;
    head.onclick=()=>{const open=w.classList.toggle('exp');if(open&&!det.dataset.built){det.innerHTML=maDetailHTML(arr[mi]);det.dataset.built='1';}};
  });
  if(hint)hint.textContent=`${arr.length} máquinas · toca una para ver sus artículos día a día`;
}

// -------- detalle diario en tabla (día × máquina) --------
let DET_SORT={k:'day',dir:-1};
function renderDetail(machines,from,to){
  const box=document.getElementById('detBox'),hint=document.getElementById('detHint');if(!box)return;
  const active=machines.filter(m=>m.sum>0);
  // filas por día con kg por máquina (solo días con producción)
  const rows=[];
  for(let i=from;i<=to;i++){let tot=0,nm=0,best={v:-1,name:''};
    active.forEach(m=>{const v=m.arr[i];if(v>0){tot+=v;nm++;if(v>best.v)best={v,name:m.name};}});
    const dead=tot===0&&DINFO[i].work;
    if(tot>0||dead)rows.push({i,tot,nm,best,dead,dow:DINFO[i].dow});
  }
  const {k,dir}=DET_SORT;
  rows.sort((a,b)=>{let av,bv; if(k==='day'){av=a.i;bv=b.i;} else if(k==='tot'){av=a.tot;bv=b.tot;} else if(k==='nm'){av=a.nm;bv=b.nm;} else {av=a.i;bv=b.i;} return (av-bv)*dir;});
  const CAP=60,shown=rows.slice(0,CAP);
  const ar=(c)=>DET_SORT.k===c?`<span class="ar">${DET_SORT.dir>0?'▲':'▼'}</span>`:'';
  box.innerHTML=`<div class="tscroll"><table><thead><tr>
      <th data-sk="day" style="cursor:pointer">Día ${ar('day')}</th>
      <th class="no">DÍA SEM.</th>
      <th data-sk="tot" style="text-align:right;cursor:pointer">Producción (kg) ${ar('tot')}</th>
      <th data-sk="nm" style="text-align:right;cursor:pointer">Máq. activas ${ar('nm')}</th>
      <th class="no">Máquina líder del día</th>
    </tr></thead><tbody>${shown.map(r=>`<tr class="${r.dead?'row-dead':''}">
      <td class="cname">${DINFO[r.i].lab} <span class="csmall">${DINFO[r.i].y}</span></td>
      <td>${DOW[r.dow]}${(r.dow===0||r.dow===6)?' <span class="csmall">no lab.</span>':''}</td>
      <td class="num">${r.dead?'<span style="color:var(--red)">día muerto</span>':kgC(r.tot)}</td>
      <td class="num">${r.dead?'0':r.nm}</td>
      <td>${r.dead?'—':`<span title="${esc(r.best.name)}">${r.best.name}</span> <span class="csmall">${kgC(r.best.v)}</span>`}</td>
    </tr>`).join('')}</tbody></table></div>
    ${rows.length>CAP?`<div class="foot-note">Mostrando ${CAP} de ${rows.length} días. Usa los filtros o la ventana de tiempo para acotar.</div>`:''}`;
  box.querySelectorAll('th[data-sk]').forEach(th=>th.onclick=()=>{const c=th.dataset.sk;if(DET_SORT.k===c)DET_SORT.dir*=-1;else{DET_SORT={k:c,dir:c==='day'?-1:-1};}renderDetail(machines,from,to);});
  if(hint)hint.textContent=`${rows.length} días · ${rows.filter(r=>r.dead).length} muertos`;
}

// -------- alertas --------
function renderAlerts(machines,deadGlobal,bi,dayTot){
  const box=document.getElementById('alerts');if(!box)return;const al=[];
  const worst=machines.filter(m=>m.dead>0).sort((a,b)=>b.dead-a.dead);
  if(worst.length)al.push({c:'red',t:`🔴 <b>${worst[0].name}</b> acumula <b>${worst[0].dead}</b> días muertos (utilización ${nf1.format(worst[0].util*100)}%)`});
  const lowU=machines.filter(m=>m.active+m.dead>=4&&m.util<0.6).sort((a,b)=>a.util-b.util);
  if(lowU.length)al.push({c:'amb',t:`⚠ <b>${lowU.length}</b> máquina${lowU.length>1?'s':''} con utilización &lt;60% — capacidad ociosa`});
  if(deadGlobal>0)al.push({c:'amb',t:`📅 <b>${deadGlobal}</b> día${deadGlobal>1?'s':''} laboral${deadGlobal>1?'es':''} sin producción alguna en toda la planta`});
  if(bi>=0)al.push({c:'grn',t:`🏆 Día pico: <b>${DINFO[bi].lab}</b> (${DOW[DINFO[bi].dow]}) con ${kgC(dayTot[bi])} kg`});
  if(!al.length)al.push({c:'grn',t:'✅ Sin alertas críticas en la vista actual'});
  box.innerHTML=al.map(a=>`<div class="alert ${a.c}">${a.t}</div>`).join('');
}

function emptyRow(){return '<div class="foot-note" style="padding:8px 0">Sin producción en esta vista.</div>';}

// =============== filtros bind ===============
function bindFilters(){
  const map={fPlanta:'planta',fGrupo:'grupo',fMaq:'maq',fWin:'win'};
  for(const id in map){const el=document.getElementById(id);if(!el)continue;el.value=ST[map[id]]||'';
    el.onchange=()=>{ST[map[id]]=el.value;saveState();render();};}
  const sb=document.getElementById('fSearch');if(sb){sb.value=ST.q||'';let t;sb.oninput=()=>{clearTimeout(t);t=setTimeout(()=>{ST.q=sb.value.trim();saveState();render();},220);};}
  document.getElementById('fClear').onclick=()=>{Object.keys(ST).forEach(k=>ST[k]='');for(const id in map){const el=document.getElementById(id);if(el)el.value='';}if(sb)sb.value='';saveState();render();};
}

// =============== boot ===============
bindExcel();bindTV();bindFilters();bindGuide();
document.getElementById('printBtn').onclick=()=>window.print();
document.getElementById('subt').textContent=`La Campana · ${DINFO[0].lab} – ${DINFO[DINFO.length-1].lab} · ${DAYS.length} días de calendario · ${nfK.format(DATA.recs.length)} registros`;
render();
document.getElementById('loading').classList.add('hide');
};

/* ============================================================
   Import Excel · conserva el DÍA de la Fecha (YYYY-MM-DD)
   ============================================================ */
function _num(v){if(v==null||v==='')return 0;if(typeof v==='number')return v;
  let t=(''+v).trim().replace(/[^0-9,.\-]/g,'');if(!t)return 0;
  const hasC=t.indexOf(',')>=0,hasD=t.indexOf('.')>=0;
  if(hasC&&hasD){ if(t.lastIndexOf(',')>t.lastIndexOf('.'))t=t.replace(/\./g,'').replace(',','.'); else t=t.replace(/,/g,''); }
  else if(hasC){ const last=t.split(',').pop(); t=(t.match(/,/g)||[]).length>1||last.length===3?t.replace(/,/g,''):t.replace(',','.'); }
  else if(hasD){ const dots=(t.match(/\./g)||[]).length,last=t.split('.').pop(); if(dots>1||last.length===3)t=t.replace(/\./g,''); }
  const n=parseFloat(t);return isNaN(n)?0:n;}
function _ymd(v){if(v==null||v==='')return null;
  if(typeof v==='number'){const d=new Date(Date.UTC(1899,11,30)+Math.round(v)*86400000);return d.getUTCFullYear()+'-'+('0'+(d.getUTCMonth()+1)).slice(-2)+'-'+('0'+d.getUTCDate()).slice(-2);}
  const s=(''+v).trim();
  let m=s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);if(m)return m[1]+'-'+('0'+m[2]).slice(-2)+'-'+('0'+m[3]).slice(-2);
  m=s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);if(m)return m[3]+'-'+('0'+m[2]).slice(-2)+'-'+('0'+m[1]).slice(-2);
  const d=new Date(s);return isNaN(d)?null:d.getUTCFullYear()+'-'+('0'+(d.getUTCMonth()+1)).slice(-2)+'-'+('0'+d.getUTCDate()).slice(-2);}
function _norm(s){return (s==null?'':(''+s)).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();}
function _resolve(H,cands){const N=H.map(_norm);for(const c of cands){const i=N.indexOf(c);if(i>=0)return H[i];}
  for(const c of cands){const i=N.findIndex(n=>n.includes(c));if(i>=0)return H[i];}return null;}

function rebuildDaily(wb){
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:null});
  if(!rows.length)return null;
  const H=Object.keys(rows[0]);
  const K={
    fecha:_resolve(H,['fecha de produccion','fecha']),
    planta:_resolve(H,['codigo de almacen','codigo almacen','almacen','bodega','planta','sede']),
    user:_resolve(H,['nombre de usuario','usuario','operario','operador','responsable']),
    grupo:_resolve(H,['grupo de articulos','grupo de articulo','grupo','linea','familia','categoria']),
    maq:_resolve(H,['maquina','máquina','linea de produccion','centro de trabajo']),
    cod:_resolve(H,['codigo de articulo','código de articulo','codigo articulo','cod articulo','codigo','código','sku','referencia']),
    desc:_resolve(H,['articulo','descripcion','desripcion','producto','detalle']),
    kg:_resolve(H,['cantidad requerida','cantidad requerida (kg)','requerida','requerido','cantidad','kilos','kg','cantidad producida','producido']),
    com:_resolve(H,['comentarios','comentario','observacion','observaciones','novedad','nota','planilla','orden'])
  };
  if(!K.fecha||!K.desc||!K.kg)return null;
  const NK=s=>(s==null?'':(''+s)).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ').trim();
  const CODEMAP=window.PROD_CODEMAP||{}, ARTMAP=window.PROD_ARTMAP||{};
  function canonTipo(name){const u=(name||'').toString().toUpperCase();return /\bSLITTER\b|\bCTL\b|CUT.?TO.?LENGTH/.test(u)?'corte':'transformacion';}
  let nByMaq=0,nByCod=0,nByArt=0,nSin=0;
  function resolveMaq(r,d){
    if(K.maq){const v=(r[K.maq]||'').toString().trim();if(v){nByMaq++;return v;}}
    if(K.cod){const c=(r[K.cod]||'').toString().trim();if(c&&CODEMAP[NK(c)]){nByCod++;return CODEMAP[NK(c)];}}
    if(d&&ARTMAP[NK(d)]){nByArt++;return ARTMAP[NK(d)];}
    nSin++;return '(sin máquina)';
  }
  const groups=[],gIdx={};const gi=n=>{n=(n||'').toString().trim()||'(s/g)';if(!(n in gIdx)){gIdx[n]=groups.length;groups.push(n);}return gIdx[n];};
  const machines=[],mIdx={};const machMeta={};
  ((window.PROD_DATA&&window.PROD_DATA.machines)||[]).forEach(m=>machMeta[m.name]=m.meta);
  const mi=n=>{n=(n||'(sin máquina)').toString().trim()||'(sin máquina)';if(!(n in mIdx)){mIdx[n]=machines.length;machines.push({name:n,meta:machMeta[n]||0,tipo:canonTipo(n)});}return mIdx[n];};
  // acumula por (planta|user|grupo|maq|articulo) -> {ymd: kg}
  const map={},allYMD=new Set(),plants={},planillas=new Set();
  rows.forEach(r=>{
    const ymd=_ymd(r[K.fecha]);if(!ymd)return;
    const d=(K.desc?(r[K.desc]||''):'').toString().trim();if(!d)return;
    const pc=(K.planta?(r[K.planta]||''):'').toString().trim()||'(Sin almacén)';
    const u=(K.user?(r[K.user]||''):'').toString().trim()||'(Sin usuario)';
    const gname=(K.grupo?(r[K.grupo]||'(s/g)'):'(s/g)').toString().trim()||'(s/g)';
    const mqname=resolveMaq(r,d);
    const g=gi(gname),mq=mi(mqname);
    const kg=_num(r[K.kg]); if(kg<=0)return;
    plants[pc]=pc;
    const com=K.com?(r[K.com]||'').toString().trim():'';
    if(com)planillas.add(com.toUpperCase().replace(/\s+/g,''));
    const key=pc+'|'+u+'|'+g+'|'+mq+'|'+d;
    let rec=map[key];if(!rec)rec=map[key]={al:pc,u,g,mq,d,k:{},com:''};
    rec.k[ymd]=(rec.k[ymd]||0)+kg;if(com)rec.com=com;
    allYMD.add(ymd);
  });
  const days=[...allYMD].sort();
  const dIdx={};days.forEach((s,i)=>dIdx[s]=i);
  const recs=[];
  for(const key in map){const r=map[key];const cells=[];
    for(const ymd in r.k){const kg=Math.round(r.k[ymd]);if(kg>0)cells.push([dIdx[ymd],kg]);}
    if(cells.length)recs.push({al:r.al,u:r.u,g:r.g,mq:r.mq,d:r.d,cells,com:r.com});}
  const DATA={days,groups,machines,plantas:plants,recs,planillas:planillas.size};
  return {DATA,report:{registros:recs.length,filas:rows.length,dias:days.length,d0:days[0],d1:days[days.length-1],
    plantas:Object.keys(plants).length,grupos:groups.length,maquinas:machines.length,planillas:planillas.size,
    maqCol:!!K.maq,nByMaq,nByCod,nByArt,nSin}};
}

function bindExcel(){
  const modal=document.getElementById('xlsModal'),drop=document.getElementById('xlsDrop'),inp=document.getElementById('xlsInput');
  const eb=document.getElementById('excelBtn');if(eb&&modal)eb.onclick=()=>modal.classList.add('show');
  const xc=document.getElementById('xlsClose');if(xc&&modal)xc.onclick=()=>modal.classList.remove('show');
  if(modal)modal.onclick=e=>{if(e.target===modal)modal.classList.remove('show');};
  if(drop&&inp){
    drop.onclick=()=>inp.click();
    drop.ondragover=e=>{e.preventDefault();drop.classList.add('over');};
    drop.ondragleave=()=>drop.classList.remove('over');
    drop.ondrop=e=>{e.preventDefault();drop.classList.remove('over');if(e.dataTransfer.files[0])handleFile(e.dataTransfer.files[0]);};
    inp.onchange=()=>{if(inp.files[0])handleFile(inp.files[0]);};
  }
  const rs=document.getElementById('xlsReset');if(rs)rs.onclick=()=>{
    if(!confirm('¿Borrar el dataset diario importado en este navegador?'))return;
    lcDel('prod_daily_dataset').then(()=>location.reload());};
}
function handleFile(file){
  const res=document.getElementById('xlsResult');
  res.innerHTML='<span style="color:var(--txt2)">Leyendo archivo… en archivos grandes puede tardar varios segundos.</span>';
  const fr=new FileReader();
  fr.onload=e=>{setTimeout(()=>processBuf(e.target.result,res),60);};
  fr.onerror=()=>{res.innerHTML='<span class="warn">No se pudo leer el archivo.</span>';};
  fr.readAsArrayBuffer(file);
}
function processBuf(buf,res){
  try{
    res.innerHTML='<span style="color:var(--txt2)">Procesando producción y agregando por día…</span>';
    const wb=XLSX.read(buf,{type:'array'});
    const full=rebuildDaily(wb);
    if(!full||!full.DATA.recs.length){res.innerHTML='<span class="warn">No se reconoció el formato. Asegúrate de incluir <b>Fecha</b>, <b>Articulo</b> y <b>Cantidad Requerida (Kg)</b>.</span>';return;}
    const r=full.report;
    res.innerHTML='<span style="color:var(--txt2)">Guardando…</span>';
    lcSet('prod_daily_dataset',{data:full.DATA}).then(()=>{
      const asig=(r.maqCol&&r.nByMaq)?`columna Maquina (${nfK2(r.nByMaq)})`:'';const auto=[];
      if(r.nByCod)auto.push(`${nfK2(r.nByCod)} por código`);if(r.nByArt)auto.push(`${nfK2(r.nByArt)} por nombre`);
      const sinTxt=r.nSin?` · <span style="color:var(--red)">${nfK2(r.nSin)} sin máquina</span>`:'';
      res.innerHTML=`<span class="ok">✓ Producción diaria actualizada.</span><br>
        ${nfK2(r.registros)} registros · ${nfK2(r.filas)} filas · ${nfK2(r.dias)} días (${r.d0}…${r.d1}) · ${nfK2(r.maquinas)} máquinas · ${nfK2(r.grupos)} grupos.<br>
        <span style="color:var(--txt2)">Máquina asignada: ${[asig,...auto].filter(Boolean).join(' · ')||'—'}${sinTxt}.</span><br>
        <span style="color:var(--txt3)">Recargando…</span>`;
      setTimeout(()=>location.reload(),1800);
    }).catch(e=>{res.innerHTML='<span class="warn">Error al guardar: '+e+'</span>';});
  }catch(e){res.innerHTML='<span class="warn">Error al procesar: '+(e&&e.message||e)+'</span>';}
}
const nfK2=v=>new Intl.NumberFormat('es-CO',{maximumFractionDigits:0}).format(v);

/* modo TV + guía (compartidos, definidos fuera del boot para el estado vacío) */
function bindTV(){
  const b=document.getElementById('tvBtn'),x=document.getElementById('tvExit');if(!b||!x)return;
  const setTV=on=>{document.body.classList.toggle('tv',on);
    try{if(on&&document.documentElement.requestFullscreen)document.documentElement.requestFullscreen().catch(()=>{});
    else if(!on&&document.fullscreenElement)document.exitFullscreen();}catch(e){}};
  b.onclick=()=>setTV(true);x.onclick=()=>setTV(false);
  document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)document.body.classList.remove('tv');});
}
function bindGuide(){
  const modal=document.getElementById('guideModal'),body=document.getElementById('guideBody'),btn=document.getElementById('guideBtn');
  if(!modal||!body||!btn)return;
  body.innerHTML=`
  <div class="gd-intro">Este panorama toma el <b>export IPN</b> y conserva el <b>día exacto</b> de la Fecha (no lo agrega por mes). Sirve para ver <b>días muertos</b>, <b>rendimiento por máquina</b> y <b>qué días son los más productivos</b>. Se consideran <b>laborales</b> los días de <b>lunes a viernes</b>.</div>
  <div class="gd-item"><span class="gd-tag">KPIs</span><h4>Indicadores</h4><p>kg totales del rango, promedio por día laboral con producción, días con producción vs. días laborales, días muertos globales, máquinas activas y el día más productivo.</p></div>
  <div class="gd-item"><span class="gd-tag">Calendario</span><h4>Mapa de calor día × mes</h4><p>Cada celda es un día; el color indica los kg producidos. Los <b>días muertos</b> (laborales, 0 kg) se marcan con contorno rojo tenue; los <b>sábados y domingos</b> aparecen atenuados.</p></div>
  <div class="gd-item"><span class="gd-tag">Semana</span><h4>Productividad por día de la semana</h4><p>Promedio de kg por día activo para cada día (lun–dom). Ayuda a ver qué días rinden más.</p></div>
  <div class="gd-item"><span class="gd-tag">Ranking</span><h4>Días más productivos</h4><p>Los mejores días del rango por kg producidos.</p></div>
  <div class="gd-item"><span class="gd-tag">Máquinas</span><h4>Activos vs. muertos</h4><p><b>Utilización</b> = días laborales con producción ÷ total de días laborales de la ventana de tiempo seleccionada. <b>Día muerto</b> = día laboral (lun–vie) sin producción en esa ventana. Se ordena por peor utilización primero.</p></div>
  <div class="gd-item"><span class="gd-tag">Tendencia</span><h4>Serie diaria por máquina</h4><p>Una barra por día; las marcas rojas tenues son días muertos.</p></div>
  <div class="gd-item"><span class="gd-tag">Artículos</span><h4>Artículos por máquina · por día</h4><p>Toca una máquina para desplegar, día a día (más reciente primero), <b>qué artículos procesó</b> y cuántos kg de cada uno. Respeta los filtros y la ventana de tiempo activos.</p></div>
  <div class="gd-item"><span class="gd-tag">Detalle</span><h4>Tabla diaria</h4><p>Un renglón por día con kg totales, número de máquinas activas y la máquina líder. Ordenable. Las filas de día muerto se resaltan.</p></div>`;
  btn.onclick=()=>modal.classList.add('show');
  document.getElementById('guideClose').onclick=()=>modal.classList.remove('show');
  modal.onclick=e=>{if(e.target===modal)modal.classList.remove('show');};
}

/* Carga dataset diario desde IndexedDB y arranca */
(async function(){
  try{
    const ds=await lcGet('prod_daily_dataset');
    if(ds&&ds.data&&ds.data.days&&ds.data.recs&&ds.data.recs[0]&&Array.isArray(ds.data.recs[0].cells)){
      window.PROD_DAILY_DATA=ds.data;
    }
  }catch(e){console.warn('LC daily load',e);}
  try{const cfg=await lcGet('prod_config');if(cfg&&Array.isArray(cfg.machines))window.PROD_DAILY_CFG=cfg;}catch(e){}
  (window.LCBootProdDaily||function(){})();
})();
