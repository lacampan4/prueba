/* ===== Panorama de Producción · La Campana · IPN =====
   Fuente: export IPN (Fecha · Codigo de Almacen · Nombre de Usuario · Grupo · Maquina · Articulo · Cantidad Requerida (Kg) · Comentarios)
   Producción = Cantidad Requerida (Kg). Máquina = columna real del IPN. Meta = kg/mes por máquina (editable). */
window.LCBootProd=function(){
'use strict';
const DATA=window.PROD_DATA;
const MONTHS=DATA.months, GROUPS=DATA.groups, RECS=DATA.recs;
const PLANT_NAMES=Object.assign({
  SCESE:'Cesar (SCESE)',SPALQ:'Paloquemao',SFONT:'Fontibón',SCENT:'Centro',SSOAC:'Soacha',SMOSQ:'Mosquera',
  SIBAG:'Ibagué',SVILL:'Villavicencio',SBARR:'Barranquilla',SNCEN:'Neiva Centro',S7AGO:'7 de Agosto',
  SNZIN:'Neiva Z.I.',SRIC1:'Ricaurte',SRIC2:'Ricaurte No.2',CPFAC:'Facatativá',MPFAC:'Facatativá',PBUEN:'Buenaventura'
}, DATA.plantas||{});
const plantName=c=>PLANT_NAMES[c]||c||'(Sin almacén)';

const MES=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const nfK=new Intl.NumberFormat('es-CO',{maximumFractionDigits:0});
const nf1=new Intl.NumberFormat('es-CO',{minimumFractionDigits:1,maximumFractionDigits:1});
function kgC(v){ if(Math.abs(v)>=1e6) return nf1.format(v/1e6)+' M';
  if(Math.abs(v)>=1e3) return nf1.format(v/1e3)+' k'; return nfK.format(v); }
function tC(v){ const t=v/1000; if(Math.abs(t)>=1e3) return nf1.format(t/1e3)+' k'; return nf1.format(t); }
const CAP=0.20;
function loglin(s){const xs=[],ys=[];s.forEach((v,i)=>{if(v>0){xs.push(i);ys.push(Math.log(v));}});
  if(xs.length<2)return null;const n=xs.length,sx=xs.reduce((a,b)=>a+b,0),sy=ys.reduce((a,b)=>a+b,0),
  sxx=xs.reduce((a,b)=>a+b*b,0),sxy=xs.reduce((a,b,i)=>a+b*ys[i],0),den=n*sxx-sx*sx;if(!den)return null;
  return Math.exp((n*sxy-sx*sy)/den)-1;}
function avgA(s){const v=s.filter(x=>x>0);return v.length?v.reduce((a,b)=>a+b,0)/v.length:0;}
// ===== mes parcial: si el último mes viene muy por debajo de la mediana (export a mitad
// de mes), se excluye de promedios, cumplimiento de meta y CMGR (REF = último mes completo).
let REF=MONTHS.length-1,PARTIAL=false;
(function detectPartial(){
  if(MONTHS.length<3)return;
  const g=MONTHS.map(_=>0);(RECS||[]).forEach(r=>r.k.forEach((v,i)=>g[i]+=v));
  const prev=g.slice(0,-1).filter(v=>v>0).sort((a,b)=>a-b);
  const med=prev.length?prev[Math.floor(prev.length/2)]:0;
  if(med>0&&g[g.length-1]<med*0.5){PARTIAL=true;REF=MONTHS.length-2;}
})();
function avgRef(s){return avgA(s.slice(0,REF+1));}
function loglinRef(s){return loglin(s.slice(0,REF+1));}
function gAdj(cm){if(cm==null)return 0;return Math.max(-CAP,Math.min(CAP,cm));}
const cmgrCell=cm=>{if(cm==null)return '<span class="cmgr nd">N/D</span>';const v=cm*100,cls=v>0.5?'pos':(v<-0.5?'neg':'nd');
  return `<span class="cmgr ${cls}">${v>0?'▲':(v<0?'▼':'·')} ${nf1.format(Math.abs(v))}%</span>`;};
const SEM={g:'#1f8a5b',a:'#d9920a',r:'#E10600'};
const semCol=p=>p>=0.98?SEM.g:(p>=0.85?SEM.a:SEM.r);
function colUtil(u){return u>=0.90?'#E10600':(u>=0.65?'#1f8a5b':(u>=0.40?'#d9920a':'#949aa1'));}
function utilEstado(u){return u>=0.90?'Cuello':(u>=0.65?'Óptima':(u>=0.40?'Media':'Holgura'));}

// ===== catálogo de máquinas (nombre + meta kg/mes + tipo: corte | transformacion) =====
// Clasificación canónica por nombre: las cortadoras (SLITTER / CTL = cut-to-length) son "corte";
// el resto, "transformacion". Sirve de respaldo cuando el dato importado o la config guardada
// no traen el campo tipo (p. ej. tras importar un Excel).
function canonTipo(name){const u=(name||'').toString().toUpperCase();
  return /\bSLITTER\b|\bCTL\b|CUT.?TO.?LENGTH/.test(u)?'corte':'transformacion';}
// tipo efectivo: las cortadoras (SLITTER/CTL) son SIEMPRE "corte" aunque una config vieja
// las haya guardado mal; el resto respeta el tipo guardado o el del dato.
function effTipo(name,stored){return canonTipo(name)==='corte'?'corte':(stored||TIPO_BY_NAME[name]||'transformacion');}
const TIPO_BY_NAME={};(DATA.machines||[]).forEach(m=>{TIPO_BY_NAME[m.name]=m.tipo||'';});
const DEFAULT_MACHINES=(DATA.machines||[]).map(m=>({name:m.name,meta:+m.meta||0,tipo:effTipo(m.name,m.tipo)}));
const CFG=window.PROD_CONFIG||{};
let MACHINES=(CFG.machines&&CFG.machines.length)?CFG.machines.map(m=>({name:m.name,meta:+m.meta||0,tipo:effTipo(m.name,m.tipo)}))
  :DEFAULT_MACHINES.map(m=>({...m}));
function metaOf(name){const m=MACHINES.find(x=>x.name===name);return m?m.meta:0;}
function tipoOf(name){const m=MACHINES.find(x=>x.name===name);return effTipo(name,m&&m.tipo);}
function machineList(){return MACHINES.map(m=>m.name);}
// override manual: nombre de artículo -> máquina asignada (para los que llegan sin máquina)
let ARTOVR=(CFG.artmap&&typeof CFG.artmap==='object')?{...CFG.artmap}:{};

function buildMachineAgg(rows){
  const mon={},present={};
  rows.forEach(x=>{ if(!present[x.maquina]){present[x.maquina]=true;mon[x.maquina]=MONTHS.map(_=>0);} });
  MACHINES.forEach(m=>{if(!mon[m.name])mon[m.name]=MONTHS.map(_=>0);});
  rows.forEach(x=>{ x.k.forEach((v,i)=>mon[x.maquina][i]+=v); });
  const names=new Set([...MACHINES.map(m=>m.name),...Object.keys(present)]);
  const arr=[...names].map(name=>{const ms=mon[name]||MONTHS.map(_=>0),sum=ms.reduce((a,b)=>a+b,0),avg=avgRef(ms),
    meta=metaOf(name);
    return {name,tipo:tipoOf(name),meta,sum,avg,last:ms[ms.length-1],mon:ms,metaC:meta>0?avg/meta:0,delta:avg-meta,cmgr:loglinRef(ms)};});
  return {arr};
}

// ===== agregación por artículo dentro de cada máquina (para drill-down) =====
function buildArticleAgg(rows){
  const byMach={};
  rows.forEach(x=>{
    const m=byMach[x.maquina]||(byMach[x.maquina]={});
    const a=m[x.d]||(m[x.d]={d:x.d,mon:MONTHS.map(_=>0)});
    x.k.forEach((v,i)=>a.mon[i]+=v);
  });
  const out={};
  for(const mq in byMach){
    const arr=Object.values(byMach[mq]).map(a=>({d:a.d,mon:a.mon,sum:a.mon.reduce((s,v)=>s+v,0),avg:avgRef(a.mon),last:a.mon[a.mon.length-1],cmgr:loglinRef(a.mon)}))
      .filter(a=>a.sum>0).sort((x,y)=>y.sum-x.sum);
    const tot=arr.reduce((s,a)=>s+a.sum,0)||1;
    arr.forEach(a=>a.part=a.sum/tot*100);
    out[mq]=arr;
  }
  return out;
}
function artDetailHTML(arr){
  if(!arr||!arr.length)return '<div class="art-empty">Sin artículos en esta vista.</div>';
  const CAP=25,shown=arr.slice(0,CAP),rest=arr.slice(CAP);
  const header=`<div class="art-colh"><div>Artículo</div><div>Tendencia mes a mes</div><div>Prod./mes</div><div>% máq.</div><div>CMGR</div><div>MoM</div></div>`;
  const body=shown.map(a=>{
    const mom=(REF>=1&&a.mon[REF-1]>0)?((a.mon[REF]/a.mon[REF-1]-1)*100):null;
    return `<div class="art-row">
      <div class="art-nm" title="${(a.d||'').replace(/"/g,'&quot;')}">${a.d}</div>
      <div class="art-spark">${sparkline(a.mon,null,30)}</div>
      <div class="art-v">${kgC(a.avg)}<span> kg</span></div>
      <div class="art-pc">${nf1.format(a.part)}%</div>
      <div class="art-cm">${cmgrCell(a.cmgr)}</div>
      <div class="art-mom ${mom==null?'':(mom>=0?'pos':'neg')}">${mom==null?'·':(mom>=0?'+':'')+nf1.format(mom)+'%'}</div>
    </div>`;}).join('');
  let note='';
  if(rest.length){const rsum=rest.reduce((s,a)=>s+a.sum,0),rpart=rest.reduce((s,a)=>s+a.part,0);
    note=`<div class="art-empty">+ ${nfK.format(rest.length)} artículos más · ${kgC(rsum)} kg (${nf1.format(rpart)}%)</div>`;}
  return header+body+note;
}
const EXP=new Set();

// ===== precompute per record =====
const ALL=RECS.map((r,idx)=>{
  const baseTot=r.k.reduce((a,b)=>a+b,0);
  const grupo=GROUPS[r.g]||'(s/g)';
  const maqRaw=(DATA.machines[r.mq]&&DATA.machines[r.mq].name)||'(sin máquina)';
  const maquina=(maqRaw==='(sin máquina)'&&ARTOVR[r.d])?ARTOVR[r.d]:maqRaw;
  return {idx,al:r.al,planta:plantName(r.al),u:r.u||'(Sin usuario)',g:r.g,grupo,d:r.d,com:r.com||'',
    k:r.k,baseTot,cmgr:loglin(r.k),maqRaw,maquina};
});
// reaplica los overrides manuales sobre el campo .maquina de cada registro
function applyArtOverrides(){ALL.forEach(x=>{x.maquina=(x.maqRaw==='(sin máquina)'&&ARTOVR[x.d])?ARTOVR[x.d]:x.maqRaw;});}
// artículos que siguen sin máquina real (agregados por nombre, con sus kg)
function unassignedArticles(){const m={};
  ALL.forEach(x=>{if(x.maqRaw==='(sin máquina)'){const a=m[x.d]||(m[x.d]={d:x.d,kg:0});a.kg+=x.baseTot;}});
  return Object.values(m).sort((a,b)=>b.kg-a.kg);}

// ===== option lists =====
function uniqSorted(arr){return [...new Set(arr)].sort((a,b)=>a.localeCompare(b,'es'));}
const PLANTAS=(()=>{const m={};ALL.forEach(x=>m[x.planta]=(m[x.planta]||0)+x.baseTot);return Object.keys(m).sort((a,b)=>m[b]-m[a]);})();
const USERS=uniqSorted(ALL.map(x=>x.u));
const GRPS=(()=>{const m={};ALL.forEach(x=>m[x.grupo]=(m[x.grupo]||0)+x.baseTot);return Object.keys(m).sort((a,b)=>m[b]-m[a]);})();
function fillSel(id,opts,allLabel){const el=document.getElementById(id);if(!el)return;
  const cur=el.value;
  el.innerHTML=`<option value="">${allLabel}</option>`+opts.map(o=>`<option value="${(o+'').replace(/"/g,'&quot;')}">${o}</option>`).join('');
  if(cur)el.value=cur;}
fillSel('fPlanta',PLANTAS,'Todos');fillSel('fUser',USERS,'Todos');fillSel('fGrupo',GRPS,'Todos');
function refreshMachineSel(){fillSel('fMaq',uniqSorted(ALL.map(x=>x.maquina)),'Todas');
  const el=document.getElementById('fMaq');if(el)el.value=ST.maq||'';}

// ===== state =====
const ST={planta:'',user:'',grupo:'',maq:'',q:''};
try{const s=JSON.parse(localStorage.getItem('LC_PROD_FILTERS')||'null');if(s)Object.assign(ST,s);}catch(e){}
function saveState(){try{localStorage.setItem('LC_PROD_FILTERS',JSON.stringify(ST));}catch(e){}}

function passes(x){
  if(ST.planta&&x.planta!==ST.planta)return false;
  if(ST.user&&x.u!==ST.user)return false;
  if(ST.grupo&&x.grupo!==ST.grupo)return false;
  if(ST.maq&&x.maquina!==ST.maq)return false;
  if(ST.q){const q=ST.q.toLowerCase();if(!x.d.toLowerCase().includes(q)&&!x.grupo.toLowerCase().includes(q)&&!(x.com||'').toLowerCase().includes(q)&&!x.maquina.toLowerCase().includes(q))return false;}
  return true;
}

function aggregate(rows){
  const base=MONTHS.map(_=>0);let baseTot=0;
  const gAgg={};
  rows.forEach(x=>{
    baseTot+=x.baseTot; x.k.forEach((v,i)=>base[i]+=v);
    const g=gAgg[x.grupo]=gAgg[x.grupo]||{base:0,m:MONTHS.map(_=>0)};
    g.base+=x.baseTot;x.k.forEach((v,i)=>g.m[i]+=v);
  });
  return {n:rows.length,base,baseTot,gAgg};
}

// ===== charts =====
function projLabels(k){const out=[];let [y,m]=MONTHS[MONTHS.length-1].split('-').map(Number);
  for(let i=0;i<k;i++){m++;if(m>12){m=1;y++;}out.push(MES[m-1]);}return out;}
function monthLabel(i){const [y,m]=MONTHS[i].split('-').map(Number);return MES[m-1];}
function svgProd(base,proj,metaLine){
  const all=base.concat(proj),max=Math.max(...all,metaLine||0,1),W=560,H=210,pad=34,n=all.length,step=(W-pad*2)/n,bw=step*0.58;
  const labels=MONTHS.map((_,i)=>monthLabel(i)).concat(projLabels(proj.length));
  let bars='';
  all.forEach((v,i)=>{const h=(v/max)*(H-pad-30),x=pad+i*step+step*0.21,y=H-pad-h,pj=i>=base.length,part=PARTIAL&&i===base.length-1;
    bars+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0,h).toFixed(1)}" rx="2.5" fill="${pj?'var(--txt3)':'var(--ferrari)'}" ${pj?'opacity="0.55"':(part?'opacity="0.45"':'')}/>`;
    bars+=`<text x="${(x+bw/2).toFixed(1)}" y="${H-pad+14}" fill="var(--txt3)" font-size="10" text-anchor="middle" font-family="IBM Plex Mono">${labels[i]}</text>
      <text x="${(x+bw/2).toFixed(1)}" y="${(y-5).toFixed(1)}" fill="${pj?'var(--txt3)':'var(--txt)'}" font-size="9" text-anchor="middle" font-family="IBM Plex Mono">${kgC(v)}</text>`;});
  let meta='';
  if(metaLine>0){const my=H-pad-(metaLine/max)*(H-pad-30);
    meta=`<line x1="${pad}" y1="${my.toFixed(1)}" x2="${W-pad}" y2="${my.toFixed(1)}" stroke="var(--txt)" stroke-width="1.6" stroke-dasharray="5 3" opacity="0.65"/>
      <text x="${W-pad}" y="${(my-5).toFixed(1)}" fill="var(--txt2)" font-size="9.5" text-anchor="end" font-family="IBM Plex Mono">meta ${kgC(metaLine)}</text>`;}
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto"><line x1="${pad}" y1="${H-pad}" x2="${W-pad}" y2="${H-pad}" stroke="var(--line2)"/>${meta}${bars}</svg>`;
}

// ===== main render =====
function render(){
  const rows=ALL.filter(passes);
  const A=aggregate(rows);
  const tot=A.baseTot||1;
  const MA=buildMachineAgg(rows);
  const mActive=MA.arr.filter(m=>m.sum>0);
  const totMeta=mActive.filter(m=>m.meta>0).reduce((s,m)=>s+m.meta,0);
  const avgMon=avgRef(A.base);
  const avgMeta=mActive.filter(m=>m.meta>0).reduce((s,m)=>s+m.avg,0);
  const metaC=totMeta?avgMeta/totMeta:0;
  const cuellos=mActive.filter(m=>m.meta>0&&m.metaC>=0.90).length;
  const pCMGR=loglinRef(A.base);
  const momDelta=REF>=1?((A.base[REF]/(A.base[REF-1]||1)-1)*100):0;
  document.getElementById('fCount').innerHTML=`<b>${nfK.format(A.n)}</b> registros · ${kgC(A.baseTot)} kg producidos · ${mActive.length} máquinas con carga`;

  // KPIs
  document.getElementById('kpis').innerHTML=`
    ${kpi('Producción total','🏭',`${kgC(A.baseTot)}<small> kg</small>`,`${tC(A.baseTot)} t · ${monthLabel(0)}–${monthLabel(A.base.length-1)} 2026`)}
    ${kpi('Producción mensual','📦',`${kgC(avgMon)}<small> kg</small>`,`promedio · ${REF+1} meses${PARTIAL?' · excluye '+monthLabel(MONTHS.length-1)+' (parcial)':''}`)}
    ${kpi('Crecimiento','📈',cmgrBig(pCMGR),`MoM ${monthLabel(Math.max(0,REF-1))}→${monthLabel(REF)}: <span class="${momDelta>=0?'pos':'neg'}">${momDelta>=0?'+':''}${nf1.format(momDelta)}%</span>`)}
    ${kpiMeta('Cumplimiento de meta',metaC,avgMeta,totMeta)}
    ${kpi('Máquinas con carga','🏗️',`${mActive.length}`,`de ${MACHINES.length} en catálogo`)}
    ${kpi('Cuellos de botella','🛑',`<span style="color:${cuellos?'var(--red)':'var(--txt)'}">${cuellos}</span>`,'máquinas ≥90% de su meta')}
    ${kpiMix2(mActive,A.baseTot)}
    ${kpiBestWorst(A.base)}`;

  // tendencia (+ proyección 3m + línea de meta total)
  const proj=[1,2,3].map(k=>avgMon*Math.pow(1+gAdj(pCMGR),k));
  document.getElementById('trendBox').innerHTML=svgProd(A.base,proj,totMeta)+
    `<div style="display:flex;gap:18px;font-size:11.5px;color:var(--txt2);margin-top:6px;justify-content:center;flex-wrap:wrap">
      <span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:var(--ferrari);margin-right:5px"></span>Producido</span>
      <span><span style="display:inline-block;width:14px;height:0;border-top:2px dashed var(--txt);margin-right:5px;vertical-align:middle"></span>Meta total/mes</span>
      <span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:var(--txt3);margin-right:5px"></span>Proyección (3 meses)</span></div>`;
  document.getElementById('trendHint').textContent=`producido ${kgC(A.baseTot)} kg · CMGR ${pCMGR!=null?nf1.format(pCMGR*100)+'%':'N/D'}${PARTIAL?' · '+monthLabel(MONTHS.length-1)+' parcial (atenuado)':''}`;

  // máquinas · cumplimiento de meta por categoría + tendencia por máquina
  const ARTAGG=buildArticleAgg(rows);
  renderMachineGroup(MA,'corte','machCorteBox','machCorteHint',ARTAGG);
  renderMachineGroup(MA,'transformacion','machTransBox','machTransHint',ARTAGG);
  renderMachineTrend(MA);

  // por grupo
  const gArr=Object.entries(A.gAgg).map(([k,v])=>({nm:k,base:v.base,m:v.m,part:v.base/tot*100,cmgr:loglin(v.m)}))
    .sort((a,b)=>b.base-a.base);
  const gMax=gArr[0]?gArr[0].base:1;
  document.getElementById('grpBars').innerHTML=`<div class="bhead"><div class="nm">Grupo</div><div class="bar">Volumen</div><div class="nv">kg</div><div class="pc">Part.</div><div class="cm">CMGR</div></div>`+(gArr.map(g=>`<div class="barrow">
    <div class="nm" title="${g.nm}">${g.nm}</div>
    <div class="bar"><i style="width:${(g.base/gMax*100).toFixed(1)}%"></i></div>
    <div class="nv">${kgC(g.base)}</div><div class="pc">${nf1.format(g.part)}%</div>
    <div class="cm">${cmgrCell(g.cmgr)}</div></div>`).join('')||emptyRow());
  document.getElementById('grpHint').textContent=`${gArr.length} grupos · kg producidos y CMGR`;
  const rel=gArr.filter(g=>g.part>=1&&g.cmgr!=null);
  const up=rel.filter(g=>g.cmgr>0).sort((a,b)=>b.cmgr-a.cmgr).slice(0,6);
  const dn=rel.filter(g=>g.cmgr<0).sort((a,b)=>a.cmgr-b.cmgr).slice(0,6);
  const gline=g=>`<div class="grow"><span class="gn" title="${g.nm}">${g.nm}</span><span>${cmgrCell(g.cmgr)} <span style="color:var(--txt3)">· ${nf1.format(g.part)}%</span></span></div>`;
  const ghd='<div class="ghead"><span>Grupo</span><span>CMGR · Part.</span></div>';
  document.getElementById('grpUp').innerHTML=up.length?ghd+up.map(gline).join(''):'<div class="foot-note">Sin grupos en crecimiento.</div>';
  document.getElementById('grpDn').innerHTML=dn.length?ghd+dn.map(gline).join(''):'<div class="foot-note">Sin grupos en caída.</div>';

  renderAlerts(mActive,cuellos,momDelta,gArr);
  renderCompare(MA,gArr,A);
}

// ===== alertas semaforizadas =====
function renderAlerts(mActive,cuellos,momDelta,gArr){
  const box=document.getElementById('alerts');if(!box)return;
  const al=[];
  const bajo=mActive.filter(m=>m.meta>0&&m.metaC<0.85).sort((a,b)=>a.metaC-b.metaC);
  if(bajo.length)al.push({c:'red',t:`🔴 <b>${bajo.length}</b> máquina${bajo.length>1?'s':''} bajo meta (&lt;85%) · peor: <b>${bajo[0].name}</b> ${nf1.format(bajo[0].metaC*100)}%`});
  if(momDelta<=-5)al.push({c:'red',t:`📉 La producción total cayó <b>${nf1.format(Math.abs(momDelta))}%</b> el último mes`});
  else if(momDelta>=5)al.push({c:'grn',t:`📈 La producción total creció <b>+${nf1.format(momDelta)}%</b> el último mes`});
  const gFall=gArr.filter(g=>g.part>=3&&g.cmgr!=null&&g.cmgr<-0.05).slice(0,3);
  if(gFall.length)al.push({c:'amb',t:`⚠ Grupos relevantes en caída sostenida: <b>${gFall.map(g=>g.nm).join(' · ')}</b>`});
  if(cuellos)al.push({c:'amb',t:`⚙️ <b>${cuellos}</b> máquina${cuellos>1?'s':''} ≥90% de su meta — revisar capacidad (posible cuello de botella)`});
  if(!al.length)al.push({c:'grn',t:'✅ Sin alertas críticas en la vista actual'});
  box.innerHTML=al.map(a=>`<div class="alert ${a.c}">${a.t}</div>`).join('');
}

// ===== comparador último mes vs anterior =====
function renderCompare(MA,gArr,A){
  const box=document.getElementById('cmpBox'),hint=document.getElementById('cmpHint');if(!box)return;
  const n=MONTHS.length;
  if(n<2){box.innerHTML='<div class="foot-note">Se necesitan al menos 2 meses de datos.</div>';return;}
  const li=REF,pi=REF-1,lm=monthLabel(li),pm=monthLabel(pi);
  const totL=A.base[li],totP=A.base[pi],totD=totL-totP,totPct=totP>0?totD/totP*100:null;
  const mk=arr=>arr.map(o=>({nm:o.nm,prev:o.m[pi],last:o.m[li],d:o.m[li]-o.m[pi]}))
    .filter(o=>o.prev>0||o.last>0).sort((a,b)=>Math.abs(b.d)-Math.abs(a.d)).slice(0,8);
  const mArr=mk(MA.arr.filter(m=>m.sum>0).map(m=>({nm:m.name,m:m.mon})));
  const gA=mk(gArr.map(g=>({nm:g.nm,m:g.m})));
  const row=o=>{const pct=o.prev>0?(o.d/o.prev*100):null;
    return `<div class="grow"><span class="gn" title="${o.nm}">${o.nm}</span>`+
    `<span class="mono" style="font-size:11.5px;white-space:nowrap">${kgC(o.prev)} → ${kgC(o.last)} <span class="cmgr ${o.d>=0?'pos':'neg'}">${o.d>=0?'▲':'▼'} ${kgC(Math.abs(o.d))}${pct!=null?' ('+(o.d>=0?'+':'')+nf1.format(pct)+'%)':''}</span></span></div>`;};
  box.innerHTML=`
    <div class="meta-sum" style="grid-template-columns:repeat(3,1fr)">
      <div><span class="l">${pm} (anterior)</span><span class="v">${kgC(totP)}<small style="font-size:11px;color:var(--txt3)"> kg</small></span></div>
      <div><span class="l">${lm} (último)</span><span class="v">${kgC(totL)}<small style="font-size:11px;color:var(--txt3)"> kg</small></span></div>
      <div><span class="l">Variación</span><span class="v" style="color:${totD>=0?'var(--green)':'var(--red)'}">${totD>=0?'+':''}${kgC(totD)}<small style="font-size:11px;color:var(--txt3)">${totPct!=null?' · '+(totD>=0?'+':'')+nf1.format(totPct)+'%':''}</small></span></div>
    </div>
    <div class="gcols">
      <div class="glist"><h4><span class="dot" style="background:var(--ferrari)"></span>Máquinas · mayores cambios</h4><div class="ghead"><span>Máquina</span><span>${pm} → ${lm} · Cambio (%)</span></div>${mArr.map(row).join('')||'<div class="foot-note">Sin datos.</div>'}</div>
      <div class="glist"><h4><span class="dot" style="background:var(--txt)"></span>Grupos · mayores cambios</h4><div class="ghead"><span>Grupo</span><span>${pm} → ${lm} · Cambio (%)</span></div>${gA.map(row).join('')||'<div class="foot-note">Sin datos.</div>'}</div>
    </div>
    <div class="foot-note" style="margin-top:10px">Compara ${pm} contra ${lm} en la vista filtrada actual. Se muestran los 8 mayores cambios absolutos en kg.${PARTIAL?` ${monthLabel(MONTHS.length-1)} viene parcial en el archivo y no se usa en esta comparación.`:''}</div>`;
  if(hint)hint.textContent=`${pm} → ${lm} · ${totD>=0?'+':''}${kgC(totD)} kg`;
}

function emptyRow(){return '<div class="foot-note" style="padding:8px 0">Sin producción en esta vista.</div>';}
function kpi(l,ic,v,d){return `<div class="kpi"><div class="accent"></div><div class="l">${ic} ${l}</div><div class="v">${v}</div><div class="d">${d}</div></div>`;}
function kpiMeta(l,c,base,meta){const col=meta>0?semCol(c):'var(--txt3)',pct=c*100;
  return `<div class="kpi"><div class="accent" style="background:${col}"></div><div class="l">🎯 ${l}</div>
    <div class="v" style="color:${col}">${meta>0?nf1.format(pct):'—'}<small>%</small></div>
    <div class="mbar"><i style="width:${Math.min(100,pct).toFixed(1)}%;background:${col}"></i></div>
    <div class="d">${kgC(base)} / ${kgC(meta)} kg meta·mes</div></div>`;}
function cmgrBig(cm){if(cm==null)return '<span style="color:var(--txt3)">N/D</span>';const v=cm*100;
  return `<span style="color:${v>=0?'var(--green)':'var(--red)'}">${v>=0?'+':''}${nf1.format(v)}<small>%/mes</small></span>`;}
function kpiMix2(mActive,tot){
  const corte=mActive.filter(m=>m.tipo==='corte').reduce((s,m)=>s+m.sum,0);
  const pc=tot>0?corte/tot*100:0;
  return `<div class="kpi"><div class="accent" style="background:#1f5fd9"></div><div class="l">⚙️ Mix corte / transf.</div>
    <div class="v">${nf1.format(pc)}<small>%</small> <small style="font-size:13px">corte</small></div>
    <div class="mbar" style="background:#e6d9c8"><i style="width:${Math.min(100,pc).toFixed(1)}%;background:#1f5fd9"></i></div>
    <div class="d">corte ${nf1.format(pc)}% · transformación ${nf1.format(100-pc)}%</div></div>`;}
function kpiBestWorst(base){
  if(!base.length)return '';
  let bi=0,wi=0;base.forEach((v,i)=>{if(i>REF)return;if(v>base[bi])bi=i;if(v<base[wi])wi=i;});
  return `<div class="kpi"><div class="accent"></div><div class="l">📅 Mejor / peor mes</div>
    <div class="v">${monthLabel(bi)}<small style="font-size:13px"> · ${kgC(base[bi])} kg</small></div>
    <div class="d">peor: <span class="neg" style="color:var(--red)">${monthLabel(wi)}</span> · ${kgC(base[wi])} kg</div></div>`;}

// ===== máquinas · cumplimiento de meta (prom. mensual vs meta mensual) =====
function machRow(m,i,artList){const hasM=m.meta>0,col=hasM?semCol(m.metaC):'#949aa1',pct=hasM?Math.min(108,m.metaC*100):0;
  const na=artList?artList.length:0,esc=(m.name||'').replace(/"/g,'&quot;');
  return `<div class="mwrap${EXP.has(m.name)?' exp':''}" data-mq="${esc}">
    <div class="mrow${na?' expandable':''}">
    <div class="m-l"><span class="m-chev">${na?'▸':''}</span><span class="m-rk">${i+1}</span><span class="m-nm" title="${esc}">${m.name}</span>${na?`<span class="m-art">${na} art.</span>`:''}</div>
    <div class="meta-track">${hasM?`<div class="meta-fill" style="width:${Math.min(100,pct).toFixed(1)}%;background:${col}"></div><div class="meta-exp" style="left:100%" title="Meta 100%"></div>`:'<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:9.5px;color:var(--txt3);font-family:IBM Plex Mono">sin meta</div>'}</div>
    <div class="m-pct" style="color:${hasM?col:'var(--txt3)'}">${hasM?nf1.format(m.metaC*100)+'%':'—'}</div>
    <div class="m-v">${kgC(m.avg)}<span> / ${hasM?kgC(m.meta):'—'}</span></div>
    <div class="m-idle" style="color:${hasM?(m.delta>=0?'var(--green)':'var(--red)'):'var(--txt3)'}">${hasM?(m.delta>=0?'+':'')+kgC(m.delta):'—'}</div>
    <div class="m-meta">${cmgrCell(m.cmgr)}</div>
    <div class="meta-sem"><span class="dots" style="background:${col}"></span>${hasM?(m.metaC>=0.98?'En meta':(m.metaC>=0.85?'Cerca':'Bajo meta')):'—'}</div></div>
    ${na?`<div class="mdetail">${artDetailHTML(artList)}</div>`:''}
  </div>`;}

function renderMachineGroup(MA,tipo,boxId,hintId,ARTAGG){
  const box=document.getElementById(boxId),hint=document.getElementById(hintId);if(!box)return;
  const inTipo=MA.arr.filter(m=>m.tipo===tipo);
  const arr=inTipo.filter(m=>m.sum>0).sort((a,b)=>b.avg-a.avg);
  if(!arr.length){box.innerHTML='<div class="foot-note" style="padding:8px 0">Sin producción registrada en esta categoría para la vista actual.'+(tipo==='transformacion'?' Asigna grupos/artículos a estas máquinas en <b>Configurar máquinas</b>.':'')+'</div>';if(hint)hint.textContent=inTipo.length+' máquinas · sin carga';return;}
  const withMeta=arr.filter(m=>m.meta>0);
  const totAvg=withMeta.reduce((s,m)=>s+m.avg,0),totMeta=withMeta.reduce((s,m)=>s+m.meta,0),gC=totMeta?totAvg/totMeta:0;
  const cuellos=withMeta.filter(m=>m.metaC>=0.90).length,bajo=withMeta.filter(m=>m.metaC<0.85).length;
  const rowsH=arr.map((m,i)=>machRow(m,i,ARTAGG&&ARTAGG[m.name])).join('');
  box.innerHTML=`
    <div class="meta-sum">
      <div><span class="l">Máquinas con carga</span><span class="v">${nfK.format(arr.length)}<small style="font-size:11px;color:var(--txt3)"> / ${inTipo.length}</small></span></div>
      <div><span class="l">Cumplimiento global</span><span class="v" style="color:${totMeta?semCol(gC):'var(--txt3)'}">${totMeta?nf1.format(gC*100)+'%':'—'}</span></div>
      <div><span class="l">En/sobre meta (≥90%)</span><span class="v" style="color:${cuellos?'var(--green)':'var(--txt)'}">${cuellos}</span></div>
      <div><span class="l">Bajo meta (&lt;85%)</span><span class="v" style="color:${bajo?'var(--red)':'var(--txt)'}">${bajo}</span></div>
    </div>
    <div class="mcolh"><div>Máquina · ranking</div><div>Avance vs. meta</div><div>% meta</div><div>Prod./mes · meta</div><div>Δ vs meta</div><div>CMGR</div><div>Estado</div></div>
    ${rowsH}
    <div class="foot-note" style="margin-top:10px">Cumplimiento = producción promedio mensual ÷ meta mensual${PARTIAL?` (promedio hasta ${monthLabel(REF)}; ${monthLabel(MONTHS.length-1)} viene parcial y se excluye)`:''}. La marca vertical es el 100% de la meta. Estado: ✅ ≥98% · ⚠ ≥85% · 🔴 &lt;85%. <b>Haz clic en una máquina</b> para ver su producción detallada por artículo y la tendencia mes a mes. Edita metas y categoría en <b>Configurar máquinas</b>.</div>`;
  box.querySelectorAll('.mrow.expandable').forEach(r=>{r.onclick=()=>{const w=r.closest('.mwrap'),mq=w.dataset.mq;w.classList.toggle('exp');if(w.classList.contains('exp'))EXP.add(mq);else EXP.delete(mq);};});
  if(hint)hint.textContent=`${arr.length} de ${inTipo.length} máquinas con carga${totMeta?' · cumplimiento '+nf1.format(gC*100)+'%':''}`;
}

// ===== tendencia mes a mes por máquina (small multiples) =====
function sparkline(s,col,H){H=H||46;const max=Math.max(...s,1),W=160,n=s.length,step=W/n,bw=step*0.6;
  let bars='';
  s.forEach((v,i)=>{const h=(v/max)*(H-7),x=i*step+(step-bw)/2,y=H-h,last=i===n-1;
    bars+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5,h).toFixed(1)}" rx="1.5" fill="${last?(col||'var(--ferrari)'):'var(--line2)'}"/>`;});
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px;display:block">${bars}</svg>`;}
function renderMachineTrend(MA){
  const box=document.getElementById('machTrendBox'),hint=document.getElementById('machTrendHint');if(!box)return;
  const arr=MA.arr.filter(m=>m.sum>0).sort((a,b)=>{if(a.tipo!==b.tipo)return a.tipo==='corte'?-1:1;return b.avg-a.avg;});
  if(!arr.length){box.innerHTML=emptyRow();if(hint)hint.textContent='';return;}
  const card=m=>{const mom=(REF>=1&&m.mon[REF-1]>0)?((m.mon[REF]/m.mon[REF-1]-1)*100):null;
    const badge=m.tipo==='corte'?'#1f5fd9':'#8a5a1f';
    return `<div style="border:1px solid var(--line);border-radius:9px;padding:11px 12px 9px;background:#fff">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:7px">
        <span style="font-family:Oswald;font-size:13px;font-weight:600;letter-spacing:.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${m.name}">${m.name}</span>
        <span style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:${badge};border:1px solid ${badge}33;border-radius:4px;padding:1px 5px;flex:none">${m.tipo==='corte'?'corte':'transf.'}</span></div>
      ${sparkline(m.mon)}
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:7px;font-size:11.5px">
        <span style="font-family:IBM Plex Mono;color:var(--txt)">${kgC(m.avg)}<small style="color:var(--txt3)">/mes</small></span>
        <span>${cmgrCell(m.cmgr)}</span>
        <span class="${mom==null?'':(mom>=0?'pos':'neg')}" style="font-family:IBM Plex Mono;font-size:11px">MoM ${mom==null?'·':(mom>=0?'+':'')+nf1.format(mom)+'%'}</span>
      </div></div>`;};
  box.innerHTML=`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:12px">${arr.map(card).join('')}</div>
    <div class="foot-note" style="margin-top:12px">Cada miniatura es la serie mensual (${monthLabel(0)}–${monthLabel(MONTHS.length-1)} 2026) de kg producidos por la máquina; la última barra resaltada es ${monthLabel(MONTHS.length-1)}. MoM = variación del último mes · CMGR = crecimiento compuesto mensual.</div>`;
  if(hint)hint.textContent=`${arr.length} máquinas con carga · prom. mensual hasta ${monthLabel(REF)}${PARTIAL?' · excluye '+monthLabel(MONTHS.length-1)+' (parcial)':''}`;
}

// ===== filters =====
function bindFilters(){
  const map={fPlanta:'planta',fUser:'user',fGrupo:'grupo',fMaq:'maq'};
  refreshMachineSel();
  for(const id in map){const el=document.getElementById(id);if(!el)continue;el.value=ST[map[id]]||'';
    el.onchange=()=>{ST[map[id]]=el.value;saveState();render();};}
  const sb=document.getElementById('fSearch');if(sb){sb.value=ST.q||'';
    let t;sb.oninput=()=>{clearTimeout(t);t=setTimeout(()=>{ST.q=sb.value.trim();saveState();render();},220);};}
  document.getElementById('fClear').onclick=()=>{Object.keys(ST).forEach(k=>ST[k]='');
    for(const id in map){const el=document.getElementById(id);if(el)el.value='';}if(sb)sb.value='';saveState();render();};
}

// ===== configuración de máquinas (editor de metas + persistencia) =====
let CFG_WORK=null;
function openConfig(){CFG_WORK={machines:MACHINES.map(m=>({...m})),artmap:{...ARTOVR}};renderConfigBody();renderArticlesBody();document.getElementById('cfgModal').classList.add('show');}
function renderConfigBody(){
  const mt=CFG_WORK.machines.map((m,i)=>`<tr>
    <td><input data-mi="${i}" data-mk="name" value="${(m.name||'').replace(/"/g,'&quot;')}" class="cfg-in"></td>
    <td><select data-mi="${i}" data-mk="tipo" class="cfg-in cfg-tipo"><option value="corte" ${m.tipo==='corte'?'selected':''}>Servicio de corte</option><option value="transformacion" ${m.tipo!=='corte'?'selected':''}>Transformación</option></select></td>
    <td><input data-mi="${i}" data-mk="meta" type="number" value="${m.meta}" class="cfg-in cfgnum"></td>
    <td style="text-align:center"><button class="cfg-del" data-del="${i}" title="Eliminar">✕</button></td></tr>`).join('');
  document.getElementById('cfgMachines').innerHTML=`<table class="cfg-tbl"><thead><tr><th>Máquina / línea</th><th>Tipo</th><th>Meta (kg/mes)</th><th></th></tr></thead><tbody>${mt}</tbody></table>`;
  document.querySelectorAll('#cfgMachines .cfg-in').forEach(inp=>{const ev=inp.tagName==='SELECT'?'onchange':'oninput';inp[ev]=()=>{const i=+inp.dataset.mi,k=inp.dataset.mk;CFG_WORK.machines[i][k]=(k==='name'||k==='tipo')?inp.value:(+inp.value||0);};});
  document.querySelectorAll('#cfgMachines .cfg-del').forEach(b=>{b.onclick=()=>{CFG_WORK.machines.splice(+b.dataset.del,1);renderConfigBody();};});
}
// editor de asignación de artículos sin máquina
function renderArticlesBody(){
  const box=document.getElementById('cfgArticles');if(!box)return;
  const list=unassignedArticles();
  if(!list.length){box.innerHTML='<div class="foot-note">Todos los artículos tienen máquina asignada. ✅</div>';return;}
  const corte=CFG_WORK.machines.filter(m=>m.tipo==='corte'&&m.name.trim()).map(m=>m.name.trim());
  const trans=CFG_WORK.machines.filter(m=>m.tipo!=='corte'&&m.name.trim()).map(m=>m.name.trim());
  const og=(lbl,ns)=>ns.length?`<optgroup label="${lbl}">${ns.map(n=>`<option value="${n.replace(/"/g,'&quot;')}">${n}</option>`).join('')}</optgroup>`:'';
  box.innerHTML=list.map(a=>{const cur=CFG_WORK.artmap[a.d]||'';const esc=(a.d||'').replace(/"/g,'&quot;');
    const optsHtml=og('Transformación',trans)+og('Servicio de corte',corte);
    return `<div class="cfg-grow"><span class="cfg-gn ${cur?'':'na'}" title="${esc}">${a.d} <span style="color:var(--txt3);font-family:'IBM Plex Mono';font-size:11px">· ${kgC(a.kg)} kg</span></span>`+
      `<select class="cfg-sel cfg-art" data-art="${esc}"><option value="">— sin asignar —</option>${optsHtml}</select></div>`;}).join('');
  box.querySelectorAll('.cfg-art').forEach(s=>{const d=s.dataset.art;s.value=CFG_WORK.artmap[d]||'';
    s.onchange=()=>{if(s.value)CFG_WORK.artmap[d]=s.value;else delete CFG_WORK.artmap[d];
      const gn=s.closest('.cfg-grow').querySelector('.cfg-gn');if(gn)gn.classList.toggle('na',!s.value);};});
}
function bindConfig(){
  document.getElementById('cfgBtn').onclick=openConfig;
  document.getElementById('cfgClose').onclick=()=>document.getElementById('cfgModal').classList.remove('show');
  document.getElementById('cfgModal').onclick=e=>{if(e.target.id==='cfgModal')document.getElementById('cfgModal').classList.remove('show');};
  document.getElementById('cfgAdd').onclick=()=>{CFG_WORK.machines.push({name:'NUEVA MÁQUINA',meta:0,tipo:'transformacion'});renderConfigBody();renderArticlesBody();};
  document.getElementById('cfgSave').onclick=()=>{
    MACHINES=CFG_WORK.machines.filter(m=>m.name&&m.name.trim()).map(m=>({name:m.name.trim(),meta:+m.meta||0,tipo:effTipo(m.name.trim(),m.tipo)}));
    ARTOVR={...CFG_WORK.artmap};applyArtOverrides();
    refreshMachineSel();
    lcSet('prod_config',{machines:MACHINES,artmap:ARTOVR}).then(()=>{document.getElementById('cfgModal').classList.remove('show');render();}).catch(()=>{document.getElementById('cfgModal').classList.remove('show');render();});
  };
  document.getElementById('cfgReset').onclick=()=>{if(!confirm('¿Restablecer el catálogo de máquinas, metas y asignaciones a los valores por defecto? Se perderá la configuración guardada en este navegador.'))return;lcDel('prod_config').then(()=>location.reload());};
}

// ===== Excel import =====
function _num(v){if(v==null||v==='')return 0;if(typeof v==='number')return v;
  let t=(''+v).trim().replace(/[^0-9,.\-]/g,'');if(!t)return 0;
  const hasC=t.indexOf(',')>=0,hasD=t.indexOf('.')>=0;
  if(hasC&&hasD){ if(t.lastIndexOf(',')>t.lastIndexOf('.'))t=t.replace(/\./g,'').replace(',','.');
                  else t=t.replace(/,/g,''); }
  else if(hasC){ const last=t.split(',').pop(); t=(t.match(/,/g)||[]).length>1||last.length===3?t.replace(/,/g,''):t.replace(',','.'); }
  else if(hasD){ const dots=(t.match(/\./g)||[]).length,last=t.split('.').pop(); if(dots>1||last.length===3)t=t.replace(/\./g,''); }
  const n=parseFloat(t);return isNaN(n)?0:n;}
function _ym(v){if(v==null||v==='')return null;
  if(typeof v==='number'){const d=new Date(Date.UTC(1899,11,30)+Math.round(v)*86400000);return d.getUTCFullYear()+'-'+('0'+(d.getUTCMonth()+1)).slice(-2);}
  const s=(''+v).trim();let m=s.match(/(\d{4})[-/.](\d{1,2})/);if(m)return m[1]+'-'+('0'+m[2]).slice(-2);
  m=s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);if(m)return m[3]+'-'+('0'+m[2]).slice(-2);
  const d=new Date(s);return isNaN(d)?null:d.getUTCFullYear()+'-'+('0'+(d.getUTCMonth()+1)).slice(-2);}
function _norm(s){return (s==null?'':(''+s)).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();}
function _resolve(H,cands){const N=H.map(_norm);for(const c of cands){const i=N.indexOf(c);if(i>=0)return H[i];}
  for(const c of cands){const i=N.findIndex(n=>n.includes(c));if(i>=0)return H[i];}return null;}
const MAXM=12;

function rebuildProd(wb){
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
  // diccionario Código de Artículo → Máquina (y nombre de artículo como respaldo), horneado desde el IPN con columna Maquina.
  const NK=s=>(s==null?'':(''+s)).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ').trim();
  const CODEMAP=window.PROD_CODEMAP||{}, ARTMAP=window.PROD_ARTMAP||{};
  let nByMaq=0,nByCod=0,nByArt=0,nSin=0;
  function resolveMaq(r,d){
    // 1) columna Maquina explícita
    if(K.maq){const v=(r[K.maq]||'').toString().trim();if(v){nByMaq++;return v;}}
    // 2) por Código de Artículo
    if(K.cod){const c=(r[K.cod]||'').toString().trim();if(c&&CODEMAP[NK(c)]){nByCod++;return CODEMAP[NK(c)];}}
    // 3) por nombre de Artículo
    if(d&&ARTMAP[NK(d)]){nByArt++;return ARTMAP[NK(d)];}
    nSin++;return '(sin máquina)';
  }
  const groups=[],gIdx={};const gi=n=>{n=(n||'').toString().trim()||'(s/g)';if(!(n in gIdx)){gIdx[n]=groups.length;groups.push(n);}return gIdx[n];};
  const machines=[],mIdx={};const machMeta={};
  (window.PROD_DATA.machines||[]).forEach(m=>machMeta[m.name]=m.meta);
  const mi=n=>{n=(n||'(sin máquina)').toString().trim()||'(sin máquina)';if(!(n in mIdx)){mIdx[n]=machines.length;machines.push({name:n,meta:machMeta[n]||0,tipo:canonTipo(n)});}return mIdx[n];};
  const map={}, allYM=new Set(), plants={}, planillas=new Set();
  rows.forEach(r=>{
    const ym=_ym(r[K.fecha]);if(!ym)return;
    const d=(K.desc?(r[K.desc]||''):'').toString().trim();if(!d)return;
    const pc=(K.planta?(r[K.planta]||''):'').toString().trim()||'(Sin almacén)';
    const u=(K.user?(r[K.user]||''):'').toString().trim()||'(Sin usuario)';
    const gname=(K.grupo?(r[K.grupo]||'(s/g)'):'(s/g)').toString().trim()||'(s/g)';
    const mqname=resolveMaq(r,d);
    const g=gi(gname),mq=mi(mqname);
    const kg=_num(r[K.kg]); if(kg<=0)return;
    plants[pc]=plants[pc]||pc;
    const com=K.com?(r[K.com]||'').toString().trim():'';
    if(com)planillas.add(com.toUpperCase().replace(/\s+/g,''));
    const key=pc+'|'+u+'|'+g+'|'+mq+'|'+d;
    let rec=map[key];if(!rec)rec=map[key]={p:pc,u,g,mq,d,k:{},com:''};
    rec.k[ym]=(rec.k[ym]||0)+kg; if(com)rec.com=com;
    allYM.add(ym);
  });
  const MONTHS=[...allYM].sort().slice(-MAXM);
  const recs=[];
  for(const key in map){const r=map[key];
    const k=MONTHS.map(ym=>Math.round(r.k[ym]||0));
    if(k.reduce((a,b)=>a+b,0)>0)recs.push({al:r.p,u:r.u,g:r.g,mq:r.mq,d:r.d,k,com:r.com});}
  const DATA={months:MONTHS,groups,machines,plantas:plants,recs,planillas:planillas.size};
  return {DATA,report:{art:recs.length,filas:rows.length,meses:MONTHS,plantas:Object.keys(plants).length,grupos:groups.length,maquinas:machines.length,planillas:planillas.size,
    maqCol:!!K.maq,codCol:!!K.cod,nByMaq,nByCod,nByArt,nSin}};
}

// ===== plantilla Excel descargable (incluye columna Maquina) =====
function downloadProdTemplate(){
  try{
    const wb=XLSX.utils.book_new();
    const hdr=['Fecha','Codigo de Almacen','Nombre de Usuario','Grupo','Maquina','Codigo de Articulo','Articulo','Cantidad Requerida (Kg)','Comentarios'];
    const mNames=machineList().filter(n=>n&&n!=='(sin máquina)');
    const ex=[
      ['2026-07-01','ALM01','J. PEREZ','LAMINA',mNames[0]||'SLITTER 1','ART-0001','LAMINA CAL 20 1.22x2.44',1250,'PLANILLA 12345'],
      ['2026-07-02','ALM01','M. GOMEZ','TUBERIA',mNames[1]||mNames[0]||'TUBERA 1','ART-0002','TUBO CUADRADO 2x2 CAL 18',890,'PLANILLA 12346']
    ];
    const ws=XLSX.utils.aoa_to_sheet([hdr,...ex]);
    ws['!cols']=hdr.map(h=>({wch:Math.max(15,h.length+3)}));
    XLSX.utils.book_append_sheet(wb,ws,'IPN');
    const ws2=XLSX.utils.aoa_to_sheet([
      ['Maquina (usar el nombre exacto en la columna Maquina)','Tipo','Meta kg/mes'],
      ...MACHINES.map(m=>[m.name,m.tipo==='corte'?'corte':'transformación',m.meta||0])
    ]);
    ws2['!cols']=[{wch:44},{wch:16},{wch:13}];
    XLSX.utils.book_append_sheet(wb,ws2,'Maquinas');
    XLSX.writeFile(wb,'Plantilla IPN - Produccion La Campana.xlsx');
  }catch(e){alert('No se pudo generar la plantilla: '+e);}
}

function bindExcel(){
  const modal=document.getElementById('xlsModal'),drop=document.getElementById('xlsDrop'),inp=document.getElementById('xlsInput');
  const eb=document.getElementById('excelBtn');if(eb&&modal)eb.onclick=()=>modal.classList.add('show');
  const xc=document.getElementById('xlsClose');if(xc&&modal)xc.onclick=()=>modal.classList.remove('show');
  if(modal)modal.onclick=e=>{if(e.target===modal)modal.classList.remove('show');};
  const tpl=document.getElementById('xlsTpl');if(tpl)tpl.onclick=downloadProdTemplate;
  if(drop&&inp){
    drop.onclick=()=>inp.click();
    drop.ondragover=e=>{e.preventDefault();drop.classList.add('over');};
    drop.ondragleave=()=>drop.classList.remove('over');
    drop.ondrop=e=>{e.preventDefault();drop.classList.remove('over');if(e.dataTransfer.files[0])handleFile(e.dataTransfer.files[0]);};
    inp.onchange=()=>{if(inp.files[0])handleFile(inp.files[0]);};
  }
  const xr=document.getElementById('xlsReset');
  if(xr)xr.onclick=()=>{
    if(!confirm('¿Restablecer los datos de demostración? Se borrará el dataset de producción importado en este navegador.'))return;
    lcDel('prod_dataset').then(()=>location.reload());};
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
    res.innerHTML='<span style="color:var(--txt2)">Procesando producción y agregando por mes…</span>';
    const wb=XLSX.read(buf,{type:'array'});
    const full=rebuildProd(wb);
    if(!full||!full.DATA.recs.length){
      res.innerHTML='<span class="warn">No se reconoció el formato. Asegúrate de incluir <b>Fecha</b>, <b>Articulo</b> y <b>Cantidad Requerida (Kg)</b>.</span>';return;}
    const r=full.report;
    res.innerHTML='<span style="color:var(--txt2)">Guardando…</span>';
    lcSet('prod_dataset',{data:full.DATA}).then(()=>{
      const asig=(r.maqCol&&r.nByMaq)?`columna <b>Maquina</b> (${nfK.format(r.nByMaq)})`:'';
      const auto=[];if(r.nByCod)auto.push(`${nfK.format(r.nByCod)} por Código de Artículo`);if(r.nByArt)auto.push(`${nfK.format(r.nByArt)} por nombre de artículo`);
      const sinTxt=r.nSin?` · <span style="color:var(--red)">${nfK.format(r.nSin)} sin máquina</span>`:'';
      const asigLine=`<br><span style="color:var(--txt2)">Máquina asignada: ${[asig,...auto].filter(Boolean).join(' · ')||'—'}${sinTxt}.</span>`;
      res.innerHTML=`<span class="ok">✓ Producción actualizada.</span><br>
        ${nfK.format(r.art)} registros · ${nfK.format(r.filas)} filas · ${nfK.format(r.maquinas)} máquinas · ${nfK.format(r.grupos)} grupos · ${r.meses.length} meses (${r.meses[0]}…${r.meses[r.meses.length-1]}) · ${nfK.format(r.planillas)} planillas/órdenes.${asigLine}<br>
        <span style="color:var(--txt3)">Tus metas por máquina se conservan. Recargando…</span>`;
      setTimeout(()=>location.reload(),1800);
    }).catch(e=>{res.innerHTML='<span class="warn">Error al guardar: '+e+'</span>';});
  }catch(e){res.innerHTML='<span class="warn">Error al procesar: '+(e&&e.message||e)+'</span>';}
}

// ===== guía · cómo leer cada panel =====
function bindGuide(){
  const modal=document.getElementById('guideModal'),body=document.getElementById('guideBody');
  if(!modal||!body)return;
  body.innerHTML=`
  <div class="gd-intro">Este panorama parte del <b>export IPN</b> (una fila por artículo producido). La producción es la <b>Cantidad Requerida (Kg)</b> agregada por máquina real y por mes. Todo se recalcula al aplicar filtros (planta, grupo, máquina o búsqueda).</div>

  <div class="gd-item"><span class="gd-tag">Filtros</span><h4>Barra de filtros</h4>
    <p>Acota todo el tablero por <b>almacén/planta</b>, <b>grupo</b>, <b>máquina</b> o texto libre (artículo, grupo o N° de planilla). Cada KPI, gráfico y tabla se recalcula sobre lo filtrado. El contador indica cuántos registros quedan activos.</p></div>

  <div class="gd-item"><span class="gd-tag">KPIs</span><h4>Indicadores principales</h4>
    <p>Cifras de cabecera del periodo: <b>kg totales</b>, <b>promedio mensual</b>, <b>cumplimiento global de meta</b> y tendencia. La barra y el color reflejan qué tan cerca se está de la meta agregada.</p></div>

  <div class="gd-item"><span class="gd-tag">Tendencia</span><h4>Producción mensual · kg</h4>
    <p>Evolución del volumen total mes a mes. Sirve para ver estacionalidad y si la producción sube o baja en el conjunto seleccionado.</p></div>

  <div class="gd-item"><span class="gd-tag">Meta</span><h4>Servicio de corte / Transformación · cumplimiento de meta</h4>
    <p>Ranking de máquinas por <b>% de cumplimiento</b> = producción promedio mensual ÷ meta mensual. La barra muestra el avance y la <b>marca vertical es el 100%</b> de la meta. El estado usa: <b>✅ ≥98%</b>, <b>⚠ ≥85%</b>, <b>🔴 &lt;85%</b>. <code>CMGR</code> es la tasa de crecimiento mensual compuesta.</p>
    <p><b>Haz clic en una máquina</b> para desplegar su <b>producción detallada por artículo</b>: tendencia mes a mes (mini-gráfico), promedio kg/mes, % de participación dentro de la máquina, CMGR y variación contra el mes anterior (MoM). Las máquinas con muchos artículos muestran el top 25 y un resumen del resto.</p>
    <p>Las metas y la categoría (corte / transformación) se editan en <b>Configurar máquinas</b>.</p></div>

  <div class="gd-item"><span class="gd-tag">Tendencia</span><h4>Tendencia mes a mes por máquina · kg</h4>
    <p>Mini-gráficos por máquina para comparar de un vistazo quién crece y quién cae a lo largo de los meses, independientemente de su meta.</p></div>

  <div class="gd-item"><span class="gd-tag">Grupos</span><h4>Producción por grupo · kg</h4>
    <p>Distribución del volumen por grupo de producto y su peso relativo. Abajo, la dinámica por <code>CMGR</code>:</p>
    <ul>
      <li><b>Lo que más crece</b> — solo grupos con crecimiento real (CMGR positivo ▲), de mayor a menor.</li>
      <li><b>Lo que más cae</b> — solo grupos en descenso (CMGR negativo ▼), del que más cae hacia abajo.</li>
    </ul>
    <p>Si en la vista filtrada no hay grupos creciendo (o cayendo), la columna lo indica en vez de rellenar con el caso contrario.</p></div>

  <div class="gd-item"><span class="gd-tag">Cálculos</span><h4>Cómo se calcula</h4>
    <ul>
      <li><b>Cumplimiento</b> = producción promedio mensual ÷ meta mensual.</li>
      <li><b>CMGR</b> = tasa de crecimiento mensual compuesta sobre la serie de meses.</li>
      <li><b>Proyección</b> = promedio mensual × (1+CMGR)^k, topada a ±20%.</li>
      <li><b>MoM</b> = variación del último mes respecto al anterior.</li>
    </ul></div>`;
  document.getElementById('guideBtn').onclick=()=>modal.classList.add('show');
  document.getElementById('guideClose').onclick=()=>modal.classList.remove('show');
  modal.onclick=e=>{if(e.target===modal)modal.classList.remove('show');};
}

// ===== modo TV =====
function bindTV(){
  const b=document.getElementById('tvBtn'),x=document.getElementById('tvExit');
  if(!b||!x)return;
  const setTV=on=>{document.body.classList.toggle('tv',on);
    try{if(on&&document.documentElement.requestFullscreen)document.documentElement.requestFullscreen().catch(()=>{});
    else if(!on&&document.fullscreenElement)document.exitFullscreen();}catch(e){}};
  b.onclick=()=>setTV(true);x.onclick=()=>setTV(false);
  document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)document.body.classList.remove('tv');});
}

// ===== boot =====
document.getElementById('printBtn').onclick=()=>window.print();
bindTV();
bindFilters();bindExcel();bindConfig();bindGuide();
const totK0=ALL.reduce((a,x)=>a+x.baseTot,0);
document.getElementById('subt').textContent=`La Campana · ${monthLabel(0)}–${monthLabel(MONTHS.length-1)} 2026${PARTIAL?' · '+monthLabel(MONTHS.length-1)+' parcial · mes de referencia: '+monthLabel(REF):''} · ${kgC(totK0)} kg · ${nfK.format(ALL.length)} registros · ${nfK.format(DATA.planillas||0)} planillas`;
render();
document.getElementById('loading').classList.add('hide');
};
