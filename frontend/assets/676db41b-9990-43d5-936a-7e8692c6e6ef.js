/* ===== Portafolio & Cartera · pestaña del Panorama Comercial (ids prefijados pf_) ===== */
window.LCBoot=function(){
'use strict';
const DATA=window.LC_DATA, CATS=DATA.cats, CATALOG=DATA.catalog, CLI=DATA.clients, MONTHS=DATA.months;
// Metas anuales fijadas manualmente (kg/año) — prevalecen sobre lo importado del Excel
DATA.metaSede=Object.assign({},DATA.metaSede,{'PALOQUEMAO':39000000});
// inventario (el bootstrap ya fusionó el override en window.LC_INV)
let INV=Object.assign({}, window.LC_INV||{});

const MES0=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const MES=MONTHS.map(mk=>MES0[((+String(mk).split('-')[1])||1)-1]);
const nfK=new Intl.NumberFormat('es-CO',{maximumFractionDigits:0});
const nf1=new Intl.NumberFormat('es-CO',{minimumFractionDigits:1,maximumFractionDigits:1});
const cop=new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0});
function copM(v){ // money compact in millones / miles de millones
  if(Math.abs(v)>=1e9) return '$'+nf1.format(v/1e9)+' mil M';
  if(Math.abs(v)>=1e6) return '$'+nf1.format(v/1e6)+' M';
  return cop.format(v);
}
function kgC(v){ // kg compact
  if(Math.abs(v)>=1e6) return nf1.format(v/1e6)+' M';
  if(Math.abs(v)>=1e3) return nf1.format(v/1e3)+' k';
  return nfK.format(v);
}
const CAP=0.20;
function loglin(s){const xs=[],ys=[];s.forEach((v,i)=>{if(v>0){xs.push(i);ys.push(Math.log(v));}});
  if(xs.length<2)return null;const n=xs.length,sx=xs.reduce((a,b)=>a+b,0),sy=ys.reduce((a,b)=>a+b,0),
  sxx=xs.reduce((a,b)=>a+b*b,0),sxy=xs.reduce((a,b,i)=>a+b*ys[i],0),den=n*sxx-sx*sx;if(!den)return null;
  return Math.exp((n*sxy-sx*sy)/den)-1;}
function avgA(s){const v=s.filter(x=>x>0);return v.length?v.reduce((a,b)=>a+b,0)/v.length:0;}
function gAdj(cm){if(cm==null)return 0;return Math.max(-CAP,Math.min(CAP,cm));}
function sucOf(ase){if(!ase)return '(Sin asignar)';const m=ase.match(/^\s*([^-]+?)\s*-\s*\S/);let s=null;if(m)s=m[1].trim();
  else if(ase.trim().startsWith('-'))return '(Sin asignar)';else s='(Otros)';
  if(/^MOSTRADOR\s*P\b/i.test(s))return 'PALOQUEMAO';return s;}
function cityNorm(c){if(!c)return '(Sin ciudad)';return c.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s*\(.*?\)\s*/g,'').trim()||'(Sin ciudad)';}
const cmgrCell=cm=>{if(cm==null)return '<span class="cmgr nd">N/D</span>';const v=cm*100,cls=v>0.5?'pos':(v<-0.5?'neg':'nd');
  return `<span class="cmgr ${cls}">${v>0?'▲':(v<0?'▼':'·')} ${nf1.format(Math.abs(v))}%</span>`;};

// ===== precompute per-client =====
const ALL=[];
for(const name in CLI){
  const c=CLI[name];
  const monthly=MONTHS.map(_=>0);
  const byG={};
  c.a.forEach(([cod,s])=>{
    let t=0;s.forEach((v,i)=>{monthly[i]+=v;t+=v;});
    const gi=CATALOG[cod]?CATALOG[cod][1]:-1;
    const g=byG[gi]=byG[gi]||{kg:0,m:MONTHS.map(_=>0)};
    g.kg+=t;s.forEach((v,i)=>g.m[i]+=v);
  });
  const moraVal=c.mora.reduce((a,m)=>a+m[2],0);
  const maxMora=c.mora.reduce((a,m)=>Math.max(a,m[1]),0);
  ALL.push({name,c,kg:c.kg,monthly,cmgr:loglin(monthly),
    suc:sucOf(c.ase),ase:c.ase||'(Sin asignar)',ciu:cityNorm(c.ciu),
    cred:c.cc>0,cc:c.cc,cu:c.cu,moraVal,maxMora,nMora:c.mora.length,byG});
}

// ===== filter option lists =====
function uniqSorted(arr){return [...new Set(arr)].sort((a,b)=>a.localeCompare(b,'es'));}
const SUCS=uniqSorted(ALL.map(x=>x.suc));
const ASES=uniqSorted(ALL.map(x=>x.ase));
const CIUS=(()=>{const m={};ALL.forEach(x=>m[x.ciu]=(m[x.ciu]||0)+x.kg);return Object.keys(m).sort((a,b)=>m[b]-m[a]);})();
function fillSel(id,opts,allLabel){const el=document.getElementById(id);
  el.innerHTML=`<option value="">${allLabel}</option>`+opts.map(o=>`<option value="${o.replace(/"/g,'&quot;')}">${o}</option>`).join('');}
fillSel('pf_fSuc',SUCS,'Todas');fillSel('pf_fAse',ASES,'Todos');fillSel('fCiu',CIUS,'Todas');

// ===== state =====
const ST={suc:'',ase:'',ciu:'',tipo:'',mora:'',q:'',vol:'',grp:''};
// Segmentos por volumen de compra (kg) en el período
const SEG=[
  {l:'0 – 1.000 kg'},
  {l:'1.001 – 10.000 kg'},
  {l:'10.001 – 50.000 kg'},
  {l:'50.001 – 100.000 kg'},
  {l:'100.001 kg en adelante'}
];
function segIdx(kg){return kg<=1000?0:(kg<=10000?1:(kg<=50000?2:(kg<=100000?3:4)));}
let sortKey='kg',sortDir=-1,cliLimit=40,riskBk=null;
window.pfClearSeg=function(){ST.vol='';saveState();render();};
window.pfClearGrp=function(){ST.grp='';saveState();render();};
function riskDetail(rows){
  if(riskBk==null)return '';
  const RG=[[1,30],[31,60],[61,90],[91,9999]][riskBk];
  const lbl=['1–30','31–60','61–90','+90'][riskBk];
  const det=[];
  rows.forEach(x=>{(x.c.mora||[]).forEach(([f,d,v])=>{if(d>=RG[0]&&d<=RG[1])det.push({cli:x.name,ase:x.ase,f:(f||'—'),d,v});});});
  det.sort((a,b)=>b.v-a.v);
  const CAP=60,shown=det.slice(0,CAP);
  const aShort=a=>{const m=(a||'').match(/-\s*(.+)$/);return m?m[1].trim():(a||'(Sin asignar)');};
  if(!det.length)return '<div class="foot-note" style="margin:2px 0 14px">Sin facturas vencidas en este rango.</div>';
  return `<div style="margin:2px 0 14px;border:1px solid var(--line);border-radius:10px;overflow:hidden">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--bg);border-bottom:1px solid var(--line)">
      <span style="font-family:Oswald;font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--txt2)">Facturas vencidas ${lbl} días · ${nfK.format(det.length)}</span>
      <span style="font-size:11px;color:var(--txt3);cursor:pointer" data-bkclose>✕ cerrar</span></div>
    <div style="max-height:280px;overflow:auto">
    <table style="width:100%;border-collapse:collapse;font-size:11.5px">
      <thead><tr style="color:var(--txt3);text-align:left">
        <th style="padding:7px 12px;font-weight:500">Cliente</th><th style="padding:7px 8px;font-weight:500">Factura</th><th style="padding:7px 8px;text-align:right;font-weight:500">Días mora</th><th style="padding:7px 8px;text-align:right;font-weight:500">Valor</th><th style="padding:7px 12px;font-weight:500">Asesor</th></tr></thead>
      <tbody>${shown.map(r=>`<tr style="border-top:1px solid var(--line);cursor:pointer" data-cli="${r.cli.replace(/"/g,'&quot;')}">
        <td style="padding:6px 12px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.cli}">${r.cli}</td>
        <td style="padding:6px 8px;font-family:IBM Plex Mono;color:var(--txt2)">${r.f}</td>
        <td style="padding:6px 8px;text-align:right;font-family:IBM Plex Mono;color:${r.d>90?'var(--red)':'var(--gold)'}">${nfK.format(r.d)}</td>
        <td style="padding:6px 8px;text-align:right;font-family:IBM Plex Mono;color:var(--red)">${copM(r.v)}</td>
        <td style="padding:6px 12px;white-space:nowrap" title="${r.ase}">${aShort(r.ase)}</td></tr>`).join('')}</tbody></table></div>
    ${det.length>CAP?`<div class="foot-note" style="padding:6px 12px;border-top:1px solid var(--line)">Mostrando ${CAP} de ${nfK.format(det.length)} facturas (ordenadas por valor).</div>`:''}
    </div>`;
}
try{const s=JSON.parse(localStorage.getItem('LC_PORT_FILTERS')||'null');if(s)Object.assign(ST,s);}catch(e){}
function saveState(){try{localStorage.setItem('LC_PORT_FILTERS',JSON.stringify(ST));}catch(e){}}

function passes(x,skipVol,skipGrp){
  if(ST.suc&&x.suc!==ST.suc)return false;
  if(ST.ase&&x.ase!==ST.ase)return false;
  if(ST.ciu&&x.ciu!==ST.ciu)return false;
  if(ST.tipo==='cred'&&!x.cred)return false;
  if(ST.tipo==='cont'&&x.cred)return false;
  if(ST.mora==='mora'&&x.nMora===0)return false;
  if(ST.mora==='critica'&&x.maxMora<=90)return false;
  if(ST.mora==='aldia'&&x.nMora>0)return false;
  if(ST.q){const q=ST.q.toLowerCase();if(!x.name.toLowerCase().includes(q)&&!(x.c.nit||'').toLowerCase().includes(q))return false;}
  if(!skipVol&&ST.vol!==''&&ST.vol!=null&&segIdx(x.kg)!==+ST.vol)return false;
  if(!skipGrp&&ST.grp){const gi=ST.grp==='(s/g)'?-1:CATS.indexOf(ST.grp);if(!(x.byG&&x.byG[gi]&&x.byG[gi].kg>0))return false;}
  return true;
}

// ===== aggregate =====
function aggregate(rows){
  const monthly=MONTHS.map(_=>0);let kg=0,cc=0,cu=0,moraVal=0,nMora=0,nCred=0,nCont=0,nMora90=0;
  const gAgg={},sAgg={},aAgg={},ciAgg={};
  const buckets=[[1,30,0,0],[31,60,0,0],[61,90,0,0],[91,9999,0,0]];
  rows.forEach(x=>{
    kg+=x.kg;x.monthly.forEach((v,i)=>monthly[i]+=v);
    if(x.cred){cc+=x.cc;cu+=x.cu;nCred++;}else nCont++;
    moraVal+=x.moraVal;if(x.nMora>0)nMora++;if(x.maxMora>90)nMora90++;
    for(const gi in x.byG){const g=gAgg[gi]=gAgg[gi]||{kg:0,m:MONTHS.map(_=>0)};g.kg+=x.byG[gi].kg;x.byG[gi].m.forEach((v,i)=>g.m[i]+=v);}
    const s=sAgg[x.suc]=sAgg[x.suc]||{kg:0,n:0,mora:0};s.kg+=x.kg;s.n++;s.mora+=x.moraVal;
    const a=aAgg[x.ase]=aAgg[x.ase]||{kg:0,n:0};a.kg+=x.kg;a.n++;
    const ci=ciAgg[x.ciu]=ciAgg[x.ciu]||{kg:0,n:0};ci.kg+=x.kg;ci.n++;
    x.c.mora.forEach(([f,d,v])=>{const b=buckets.find(b=>d>=b[0]&&d<=b[1]);if(b){b[2]++;b[3]+=v;}});
  });
  return {n:rows.length,kg,monthly,cc,cu,moraVal,nMora,nMora90,nCred,nCont,gAgg,sAgg,aAgg,ciAgg,buckets};
}

// ===== renderers =====
function svgBars(real,proj){
  const all=real.concat(proj),max=Math.max(...all,1),W=560,H=190,pad=34,n=all.length,step=(W-pad*2)/n,bw=step*0.58;
  const labels=MES.slice(0,real.length).concat(projLabels(proj.length));
  let bars='';
  all.forEach((v,i)=>{const h=(v/max)*(H-pad-26),x=pad+i*step+step*0.21,y=H-pad-h,pj=i>=real.length;
    bars+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0,h).toFixed(1)}" rx="2.5" fill="${pj?'var(--txt3)':'var(--ferrari)'}" ${pj?'opacity="0.65"':''}/>
      <text x="${(x+bw/2).toFixed(1)}" y="${H-pad+14}" fill="var(--txt3)" font-size="10" text-anchor="middle" font-family="IBM Plex Mono">${labels[i]}</text>
      <text x="${(x+bw/2).toFixed(1)}" y="${(y-5).toFixed(1)}" fill="${pj?'var(--txt3)':'var(--txt)'}" font-size="9" text-anchor="middle" font-family="IBM Plex Mono">${kgC(v)}</text>`;});
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto"><line x1="${pad}" y1="${H-pad}" x2="${W-pad}" y2="${H-pad}" stroke="var(--line2)"/>${bars}</svg>`;
}
const GT_COLORS=['#E10600','#14161a','#1f8a5b','#d9920a','#2563a8','#8b4bb8','#c2185b','#5a6066'];
function svgLines(series){ // series: [{nm,color,m,mut(atenuada),dots,lab}]
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
  let mut='',lines='';
  // etiquetas de nombre al final, sin solaparse (mín. 11px de separación vertical)
  let labs=[];
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
// panel tendencia por grupo: estado de selección (persistente entre re-renders)
let GT_ARR=[];const GT_SEL=new Set();
window.gtToggle=function(nm){if(GT_SEL.has(nm))GT_SEL.delete(nm);else GT_SEL.add(nm);renderGrpTrend();};
window.gtAll=function(){GT_SEL.clear();renderGrpTrend();};
function renderGrpTrend(){
  const box=document.getElementById('grpTrendBox');if(!box)return;
  const hint=document.getElementById('grpTrendHint');
  if(!GT_ARR.length){box.innerHTML='<div class="foot-note">Sin datos de grupos en la vista actual.</div>';if(hint)hint.textContent='';return;}
  for(const nm of [...GT_SEL])if(!GT_ARR.some(g=>g.nm===nm))GT_SEL.delete(nm);
  // sin selección: destacar top 6, el resto como líneas grises de contexto
  const hi=GT_SEL.size?GT_ARR.filter(g=>GT_SEL.has(g.nm)):GT_ARR.slice(0,6);
  const series=GT_ARR.map((g,i)=>{const on=hi.includes(g);
    return {nm:g.nm,m:g.m,kg:g.kg,mut:!on,color:on?GT_COLORS[hi.indexOf(g)%GT_COLORS.length]:'',lab:on&&hi.length<=3};});
  const colorOf=nm=>{const s=series.find(x=>x.nm===nm);return s&&!s.mut?s.color:null;};
  const esc=s=>String(s).replace(/'/g,"\\'").replace(/"/g,'&quot;');
  const chips=GT_ARR.map(g=>{const sel=GT_SEL.has(g.nm),col=colorOf(g.nm);
    return `<span onclick="gtToggle('${esc(g.nm)}')" title="${esc(g.nm)} · ${kgC(g.kg)} kg" style="display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:20px;border:1px solid ${sel?col:'var(--line2)'};background:${sel?col:'var(--panel)'};color:${sel?'#fff':(col?'var(--txt)':'var(--txt3)')};font-size:11px;cursor:pointer;user-select:none;line-height:1.4;transition:.12s"><span style="width:8px;height:8px;border-radius:2px;background:${sel?'#fff':(col||'var(--line2)')};flex:none"></span>${g.nm} <span style="font-family:'IBM Plex Mono';font-size:10px;color:${sel?'rgba(255,255,255,.8)':'var(--txt3)'}">${kgC(g.kg)}</span></span>`;}).join('');
  const clear=GT_SEL.size?`<span onclick="gtAll()" style="font-size:11px;color:var(--acc2);cursor:pointer;text-decoration:underline;font-family:'IBM Plex Mono';align-self:center;white-space:nowrap">quitar selección ✕</span>`:'';
  box.innerHTML=`<div style="display:flex;gap:5px 6px;flex-wrap:wrap;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--bg2)">${chips}${clear}</div>`+svgLines(series)+
    `<div class="foot-note" style="text-align:center;margin-top:4px">${GT_SEL.size?'Grupos seleccionados en color; el resto en gris de contexto.':'Top 6 grupos en color; el resto en gris. Clic en una etiqueta para aislar grupos.'}</div>`;
  if(hint)hint.textContent=`${hi.length} de ${GT_ARR.length} grupos destacados`;
}
function projLabels(k){const out=[];let [y,m]=MONTHS[MONTHS.length-1].split('-').map(Number);
  for(let i=0;i<k;i++){m++;if(m>12){m=1;y++;}out.push(MES0[m-1]);}return out;}

function donut(used,avail){
  const tot=used+avail||1,frac=used/tot,R=52,C=2*Math.PI*R,off=C*(1-frac);
  return `<svg viewBox="0 0 140 140" width="140" height="140">
    <circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--bg)" stroke-width="16"/>
    <circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--acc)" stroke-width="16" stroke-linecap="round"
      stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 70 70)"/>
    <text x="70" y="66" text-anchor="middle" font-family="Oswald" font-weight="600" font-size="26" fill="var(--acc2)">${nf1.format(frac*100)}%</text>
    <text x="70" y="86" text-anchor="middle" font-family="IBM Plex Mono" font-size="9" fill="var(--txt3)">UTILIZADO</text></svg>`;
}
function barList(items,max,opt){ // items: {nm,kg,part,cmgr?,extra?}
  return items.map(it=>`<div class="barrow">
    <div class="nm" title="${(it.nm+'').replace(/"/g,'')}">${it.nm}</div>
    <div class="bar"><i style="width:${(it.kg/max*100).toFixed(1)}%"></i></div>
    <div class="nv">${kgC(it.kg)}</div>
    <div class="pc">${nf1.format(it.part)}%</div>
    ${opt&&opt.cmgr?`<div class="cm">${cmgrCell(it.cmgr)}</div>`:''}
    ${opt&&opt.extra?`<div class="cm" style="width:auto;min-width:90px;color:var(--txt2);font-size:11px">${it.extra}</div>`:''}
  </div>`).join('');
}

// Serie mensual de ventas del asesor atribuida por FACTURA (quién facturó cada venta),
// no por el asesor asignado al cliente. Coincide con el panel de cumplimiento de meta.
// Sólo aplica cuando el asesor es el único filtro que afecta el volumen, para no chocar
// con filtros de ciudad / tipo / mora / volumen / búsqueda (que la atribución por factura no resuelve).
function aseVolSeries(){
  if(!ST.ase) return null;
  if(!DATA.aseKgMons || !DATA.aseKgMons[ST.ase]) return null;
  if(ST.ciu||ST.tipo||ST.mora||ST.q||(ST.vol!==''&&ST.vol!=null)) return null;
  return DATA.aseKgMons[ST.ase].slice();
}

function render(){
  const rows=ALL.filter(x=>passes(x));
  const A=aggregate(rows);
  const tot=A.kg||1;
  // Volumen del asesor: al filtrar por un asesor, su volumen REAL es el atribuido por factura
  // (coincide con el panel de cumplimiento), no la suma de los clientes que tiene asignados.
  const aseSer=aseVolSeries();
  const volMonthly=aseSer||A.monthly;
  const volKg=aseSer?aseSer.reduce((a,b)=>a+b,0):A.kg;
  const segChip=(ST.vol!==''&&ST.vol!=null)?` · <span onclick="pfClearSeg()" style="display:inline-block;background:#E10600;color:#fff;border-radius:20px;padding:2px 10px;font-size:11px;cursor:pointer" title="Clic para quitar este filtro">segmento ${SEG[+ST.vol].l} ✕</span>`:'';
  const grpChip=ST.grp?` · <span onclick="pfClearGrp()" style="display:inline-block;background:#14161a;color:#fff;border-radius:20px;padding:2px 10px;font-size:11px;cursor:pointer" title="Clic para quitar este filtro">grupo ${ST.grp} ✕</span>`:'';
  document.getElementById('pf_fCount').innerHTML=`<b>${nfK.format(A.n)}</b> clientes en vista · ${kgC(volKg)} kg · ${nfK.format(A.nCred)} crédito / ${nfK.format(A.nCont)} contado${segChip}${grpChip}`;

  // KPIs
  const pCMGR=loglin(volMonthly);
  const ticket=A.n?volKg/A.n:0;
  const util=A.cc>0?A.cu/A.cc*100:0;
  const lastM=volMonthly[volMonthly.length-1],firstNon=volMonthly.find(v=>v>0)||0;
  const momDelta=volMonthly.length>=2?((volMonthly[volMonthly.length-1]/(volMonthly[volMonthly.length-2]||1)-1)*100):0;
  // meta anual: total empresa (editable) o ajustada al filtro de sucursal/asesor
  let mScope,mVal;
  if(ST.ase){mScope='asesor';mVal=(DATA.metaAse&&DATA.metaAse[ST.ase])||0;}
  else if(ST.suc){mScope='sede';mVal=(DATA.metaSede&&DATA.metaSede[ST.suc])||0;}
  else {mScope='total';mVal=getMetaTotal();}
  document.getElementById('pf_kpis').innerHTML=`
    ${kpiMeta(mScope,mVal,volKg)}
    ${kpi('Volumen total','📦',`${kgC(volKg)}<small> kg</small>`,`${MES[0]}–${MES[volMonthly.length-1]} ${(MONTHS[MONTHS.length-1]||'2026').split('-')[0]}`)}
    ${kpi('Clientes','👥',nfK.format(A.n),`${nfK.format(A.nCred)} crédito · ${nfK.format(A.nCont)} contado`)}
    ${kpiUtil('Crédito utilizado',util,A.cu,A.cc)}
    ${kpiRisk('Cartera vencida',A.moraVal,A.nMora,A.nMora90)}
    ${kpi('Crecimiento portafolio','📈',cmgrBig(pCMGR),`MoM ${MES[Math.max(0,volMonthly.length-2)]}→${MES[volMonthly.length-1]}: <span class="${momDelta>=0?'pos':'neg'}">${momDelta>=0?'+':''}${nf1.format(momDelta)}%</span>`)}
    ${kpiV90(A)}`;
  const _me=document.getElementById('metaEdit');
  if(_me)_me.onclick=ev=>{ev.stopPropagation();
    const vEl=_me.closest('.kpi').querySelector('.v');
    const cur=getMetaTotal();
    vEl.innerHTML=`<input id="metaInp" type="text" value="${nfK.format(cur)}" style="width:100%;font-family:'Oswald';font-size:20px;font-weight:600;background:var(--bg2);border:1px solid var(--acc);color:var(--txt);border-radius:6px;padding:2px 6px;box-sizing:border-box">`;
    const inp=document.getElementById('metaInp');inp.focus();inp.select();
    let done=false;
    const commit=()=>{if(done)return;done=true;const v=parseInt((inp.value||'').replace(/[^0-9]/g,''),10);if(v>0){try{localStorage.setItem('LC_META_TOTAL',String(v));}catch(e){}}render();};
    inp.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();commit();}else if(e.key==='Escape'){done=true;render();}};
    inp.onblur=commit;};

  // trend
  const avgP=avgA(volMonthly),proj=[1,2,3].map(k=>avgP*Math.pow(1+gAdj(pCMGR),k));
  document.getElementById('trendBox').innerHTML=svgBars(volMonthly,proj)+
    `<div style="display:flex;gap:18px;font-size:11.5px;color:var(--txt2);margin-top:6px;justify-content:center"><span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:var(--ferrari);margin-right:5px"></span>Real</span><span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:var(--txt3);margin-right:5px"></span>Proyección</span></div>`;
  const anyFilter=ST.suc||ST.ase||ST.ciu||ST.tipo||ST.mora||ST.q||ST.grp||(ST.vol!==''&&ST.vol!=null);
  document.getElementById('trendHint').textContent=`${anyFilter?'⚠ vista filtrada · ':''}total ${kgC(volKg)} kg · CMGR ${pCMGR!=null?nf1.format(pCMGR*100)+'%':'N/D'}`;
  if(anyFilter)document.getElementById('trendHint').style.color='#d9920a';else document.getElementById('trendHint').style.color='';

  // tendencia mensual por grupo (líneas)
  GT_ARR=Object.entries(A.gAgg).map(([gi,v])=>({nm:gi>=0?CATS[gi]:'(s/g)',kg:v.kg,m:v.m})).sort((a,b)=>b.kg-a.kg);
  renderGrpTrend();

  // credit donut
  document.getElementById('creditBox').innerHTML=`<div class="donut-wrap">
    ${donut(A.cu,Math.max(0,A.cc-A.cu))}
    <div class="donut-leg">
      <div class="li"><span class="sw" style="background:var(--bg);border:1px solid var(--line2)"></span>Cupo asignado <b>${copM(A.cc)}</b></div>
      <div class="li"><span class="sw" style="background:var(--acc)"></span>Cupo usado <b>${copM(A.cu)}</b></div>
      <div class="li"><span class="sw" style="background:var(--line2)"></span>Disponible <b>${copM(Math.max(0,A.cc-A.cu))}</b></div>
      <div class="li" style="margin-top:6px;color:var(--txt3)">${nfK.format(A.nCred)} con crédito · ${nfK.format(A.nCont)} de contado</div>
    </div></div>`;

  // top clients (ABC over filtered)
  const sorted=[...rows].sort((a,b)=>b.kg-a.kg);let cum=0;
  sorted.forEach(x=>{x.part=x.kg/tot*100;cum+=x.part;x.abc=cum<=80?'A':(cum<=95?'B':'C');});
  renderCliTable(sorted,tot);

  // segmentación por volumen de compra (calculada sin el propio filtro de volumen)
  renderSeg(ALL.filter(x=>passes(x,true)));

  // segmentación por grupo (calculada sin el propio filtro de grupo)
  renderSegGrp(ALL.filter(x=>passes(x,false,true)));

  // sucursal — con Meta Anual Sede
  const _lm=+((MONTHS[MONTHS.length-1]||'2026-01').split('-')[1])||MONTHS.length;
  const expPace=Math.min(1,_lm/12);
  const SEMc={g:'#1f8a5b',a:'#d9920a',r:'#E10600'};
  const semCol=pct=>{const p=expPace>0?pct/expPace:0;return p>=0.98?SEMc.g:(p>=0.85?SEMc.a:SEMc.r);};
  const metaPctCell=(kg,meta)=>meta>0?`<span style="color:${semCol(kg/meta)}" title="meta anual ${kgC(meta)} kg">${nf1.format(kg/meta*100)}% meta</span>`:`<span style="color:var(--txt3)">—</span>`;
  const sArr=Object.entries(A.sAgg).map(([k,v])=>({nm:k,kg:v.kg,n:v.n,mora:v.mora,part:v.kg/tot*100,meta:(DATA.metaSede&&DATA.metaSede[k])||0}))
    .sort((a,b)=>b.kg-a.kg);
  const sMax=sArr[0]?sArr[0].kg:1;
  const _sucEl=document.getElementById('pf_sucBox');if(_sucEl)_sucEl.innerHTML=sArr.map(s=>`<div class="barrow">
    <div class="nm" title="${s.nm}">${s.nm}</div>
    <div class="bar"><i style="width:${(s.kg/sMax*100).toFixed(1)}%"></i></div>
    <div class="nv">${kgC(s.kg)}</div><div class="pc">${nf1.format(s.part)}%</div>
    <div class="cm" style="width:64px;color:var(--txt3);font-size:11px">${nfK.format(s.n)} cli</div>
    <div class="cm" style="width:84px;font-size:11px">${metaPctCell(s.kg,s.meta)}</div></div>`).join('');
  const _sucH=document.getElementById('pf_sucHint');if(_sucH)_sucH.textContent=`${sArr.length} sucursales · % vs meta anual sede`;

  // asesores (ventas atribuidas por factura, no por cliente)
  const aseKgF=aseKgMap();
  const aseTotKg=Object.values(aseKgF).reduce((s,v)=>s+v,0)||1;
  const aArr=Object.entries(aseKgF).map(([k,v])=>({nm:k,kg:v,part:v/aseTotKg*100}))
    .sort((a,b)=>b.kg-a.kg).slice(0,12);
  const aMax=aArr[0]?aArr[0].kg:1;
  document.getElementById('aseBox').innerHTML=aArr.map(s=>`<div class="barrow">
    <div class="nm" style="width:230px" title="${s.nm}">${s.nm}</div>
    <div class="bar"><i style="width:${(s.kg/aMax*100).toFixed(1)}%"></i></div>
    <div class="nv">${kgC(s.kg)}</div><div class="pc">${nf1.format(s.part)}%</div></div>`).join('');
  document.getElementById('pf_aseHint').textContent=`top 12 de ${Object.keys(aseKgF).length}`;
  renderMeta();

  // grupos
  const gArr=Object.entries(A.gAgg).map(([gi,v])=>({gi,nm:gi>=0?CATS[gi]:'(s/g)',kg:v.kg,m:v.m,part:v.kg/tot*100,cmgr:loglin(v.m)}))
    .sort((a,b)=>b.kg-a.kg);
  const gTop=gArr.slice(0,12),gMax=gTop[0]?gTop[0].kg:1;
  document.getElementById('grpBars').innerHTML=gTop.map(g=>`<div class="barrow">
    <div class="nm" title="${g.nm}">${g.nm}</div>
    <div class="bar"><i style="width:${(g.kg/gMax*100).toFixed(1)}%"></i></div>
    <div class="nv">${kgC(g.kg)}</div><div class="pc">${nf1.format(g.part)}%</div>
    <div class="cm">${cmgrCell(g.cmgr)}</div>
    <div class="cm" style="width:84px;font-size:11px">${metaPctCell(g.kg,(DATA.metaGrupo&&DATA.metaGrupo[g.nm])||0)}</div></div>`).join('');
  document.getElementById('grpHint').textContent=`${gArr.length} grupos · top 12 · % vs meta anual grupo`;
  // dinamica: grupos relevantes (>=1% del total)
  const rel=gArr.filter(g=>g.part>=1&&g.cmgr!=null);
  const up=[...rel].sort((a,b)=>b.cmgr-a.cmgr).slice(0,6);
  const dn=[...rel].sort((a,b)=>a.cmgr-b.cmgr).slice(0,6);
  const gline=g=>`<div class="grow"><span class="gn" title="${g.nm}">${g.nm}</span><span>${cmgrCell(g.cmgr)} <span style="color:var(--txt3)">· ${nf1.format(g.part)}%</span></span></div>`;
  document.getElementById('grpUp').innerHTML=up.map(gline).join('')||'<div class="foot-note">Sin grupos en crecimiento.</div>';
  document.getElementById('grpDn').innerHTML=dn.map(gline).join('')||'<div class="foot-note">Sin grupos en caída.</div>';

  // geo
  const ciArr=Object.entries(A.ciAgg).map(([k,v])=>({nm:k,kg:v.kg,n:v.n,part:v.kg/tot*100}))
    .sort((a,b)=>b.kg-a.kg).slice(0,12);
  const ciMax=ciArr[0]?ciArr[0].kg:1;
  const _geoEl=document.getElementById('pf_geoBox');if(_geoEl)_geoEl.innerHTML=ciArr.map(s=>`<div class="barrow">
    <div class="nm" title="${s.nm}">${s.nm}</div>
    <div class="bar"><i style="width:${(s.kg/ciMax*100).toFixed(1)}%"></i></div>
    <div class="nv">${kgC(s.kg)}</div><div class="pc">${nf1.format(s.part)}%</div>
    <div class="cm" style="width:96px;color:var(--txt2);font-size:11px">${nfK.format(s.n)} cli</div></div>`).join('');
  const _geoH=document.getElementById('pf_geoHint');if(_geoH)_geoH.textContent=`top 12 de ${Object.keys(A.ciAgg).length} ciudades`;

  // risk
  const labels=['1–30 d','31–60 d','61–90 d','+90 d'],cls=['warn','warn','bad','bad'];
  const bTotV=A.buckets.reduce((a,b)=>a+b[3],0)||1;
  const deud=[...rows].filter(x=>x.moraVal>0).sort((a,b)=>b.moraVal-a.moraVal).slice(0,6);
  document.getElementById('riskBox').innerHTML=`
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-bottom:14px">
      ${A.buckets.map((b,i)=>`<div data-bk="${i}" style="background:var(--bg);border:1px solid ${riskBk===i?'var(--red)':'var(--line)'};border-radius:10px;padding:11px 9px;text-align:center;cursor:pointer" title="Clic para ver el detalle de facturas">
        <div style="font-family:Oswald;font-size:22px;font-weight:600;color:var(--${cls[i]==='bad'?'red':'gold'})">${nfK.format(b[2])}</div>
        <div style="font-size:9.5px;color:var(--txt3);text-transform:uppercase;letter-spacing:.4px;margin-top:2px">${labels[i]}</div>
        <div style="font-size:10px;color:var(--txt2);font-family:IBM Plex Mono;margin-top:4px">${copM(b[3])}</div></div>`).join('')}
    </div>
    ${riskDetail(rows)}
    <div class="metric" style="display:flex;justify-content:space-between;font-size:13px;padding:6px 0;border-bottom:1px dashed var(--line)"><span style="color:var(--txt2)">Total vencido</span><b style="color:var(--red);font-family:IBM Plex Mono">${copM(A.moraVal)}</b></div>
    <div style="font-size:11px;color:var(--txt3);margin:10px 0 6px;text-transform:uppercase;letter-spacing:.4px;font-family:Oswald">Mayores deudores</div>
    ${deud.map(x=>`<div class="barrow" style="cursor:pointer" data-cli="${x.name.replace(/"/g,'&quot;')}">
      <div class="nm" style="width:auto;flex:1" title="${x.name}">${x.name}</div>
      <div class="cm" style="width:auto"><span class="pill ${x.maxMora>90?'bad':'warn'}">${x.maxMora} d</span></div>
      <div class="nv" style="width:110px;color:var(--red)">${copM(x.moraVal)}</div></div>`).join('')||'<div class="foot-note">Sin cartera vencida en esta vista.</div>'}`;
  document.querySelectorAll('#riskBox [data-cli]').forEach(el=>el.onclick=()=>openCli(el.dataset.cli));
  document.querySelectorAll('#riskBox [data-bk]').forEach(el=>el.onclick=()=>{const i=+el.dataset.bk;riskBk=(riskBk===i)?null:i;render();});
  const _bc=document.querySelector('#riskBox [data-bkclose]');if(_bc)_bc.onclick=e=>{e.stopPropagation();riskBk=null;render();};

  renderAlerts(rows,A,momDelta,util);
  renderCompare(rows,A);
}

// ===== alertas semaforizadas =====
function renderAlerts(rows,A,momDelta,util){
  const box=document.getElementById('pf_alerts');if(!box)return;
  const al=[];
  if(momDelta<=-5)al.push({c:'red',t:`📉 El volumen cayó <b>${nf1.format(Math.abs(momDelta))}%</b> el último mes`});
  else if(momDelta>=5)al.push({c:'grn',t:`📈 El volumen creció <b>+${nf1.format(momDelta)}%</b> el último mes`});
  const v90=A.buckets[3][3];
  if(A.moraVal>0&&v90/A.moraVal>=0.35)al.push({c:'red',t:`🔴 El <b>${nf1.format(v90/A.moraVal*100)}%</b> de la cartera vencida tiene +90 días (${copM(v90)}) — riesgo de incobrable`});
  const lim=rows.filter(x=>x.cred&&x.cc>0&&x.cu/x.cc>=0.9);
  if(lim.length)al.push({c:'amb',t:`🚦 <b>${nfK.format(lim.length)}</b> clientes con ≥90% del cupo usado — puede frenar sus compras`});
  if(util>=80)al.push({c:'amb',t:`💳 Crédito global al <b>${nf1.format(util)}%</b> de utilización`});
  if(A.nMora90>0)al.push({c:'amb',t:`⚠ <b>${nfK.format(A.nMora90)}</b> clientes con facturas de +90 días de mora`});
  if(!al.length)al.push({c:'grn',t:'✅ Sin alertas críticas en la vista actual'});
  box.innerHTML=al.map(a=>`<div class="alert ${a.c}">${a.t}</div>`).join('');
}

// ===== comparador último mes vs anterior =====
function renderCompare(rows,A){
  const box=document.getElementById('pf_cmpBox'),hint=document.getElementById('pf_cmpHint');if(!box)return;
  const n=MONTHS.length;
  if(n<2){box.innerHTML='<div class="foot-note">Se necesitan al menos 2 meses de datos.</div>';return;}
  const li=n-1,pi=n-2,lm=MES[li],pm=MES[pi];
  const totP=A.monthly[pi],totL=A.monthly[li],totD=totL-totP,totPct=totP>0?totD/totP*100:null;
  const gA=Object.entries(A.gAgg).map(([gi,v])=>({nm:gi>=0?CATS[gi]:'(s/g)',prev:v.m[pi],last:v.m[li],d:v.m[li]-v.m[pi]}))
    .filter(o=>o.prev>0||o.last>0).sort((a,b)=>Math.abs(b.d)-Math.abs(a.d)).slice(0,8);
  const cA=rows.map(x=>({nm:x.name,prev:x.monthly[pi],last:x.monthly[li],d:x.monthly[li]-x.monthly[pi]}))
    .filter(o=>o.prev>0||o.last>0).sort((a,b)=>Math.abs(b.d)-Math.abs(a.d)).slice(0,8);
  const row=o=>{const pct=o.prev>0?(o.d/o.prev*100):null;
    return `<div class="grow"><span class="gn" title="${(o.nm+'').replace(/"/g,'&quot;')}">${o.nm}</span>`+
    `<span style="font-family:'IBM Plex Mono';font-size:11.5px;white-space:nowrap">${kgC(o.prev)} → ${kgC(o.last)} <span class="cmgr ${o.d>=0?'pos':'neg'}">${o.d>=0?'▲':'▼'} ${kgC(Math.abs(o.d))}${pct!=null?' ('+(o.d>=0?'+':'')+nf1.format(pct)+'%)':''}</span></span></div>`;};
  box.innerHTML=`
    <div class="cmp-sum">
      <div><span class="l">${pm} (anterior)</span><span class="v">${kgC(totP)}<small style="font-size:11px;color:var(--txt3)"> kg</small></span></div>
      <div><span class="l">${lm} (último)</span><span class="v">${kgC(totL)}<small style="font-size:11px;color:var(--txt3)"> kg</small></span></div>
      <div><span class="l">Variación</span><span class="v" style="color:${totD>=0?'#1f8a5b':'#E10600'}">${totD>=0?'+':''}${kgC(totD)}<small style="font-size:11px;color:var(--txt3)">${totPct!=null?' · '+(totD>=0?'+':'')+nf1.format(totPct)+'%':''}</small></span></div>
    </div>
    <div class="gcols">
      <div class="glist"><h4><span class="dot" style="background:var(--ferrari)"></span>Grupos · mayores cambios</h4>${gA.map(row).join('')||'<div class="foot-note">Sin datos.</div>'}</div>
      <div class="glist"><h4><span class="dot" style="background:#14161a"></span>Clientes · mayores cambios</h4>${cA.map(row).join('')||'<div class="foot-note">Sin datos.</div>'}</div>
    </div>
    <div class="foot-note" style="margin-top:10px">Compara ${pm} contra ${lm} en la vista filtrada. Se muestran los 8 mayores cambios absolutos en kg.</div>`;
  if(hint)hint.textContent=`${pm} → ${lm} · ${totD>=0?'+':''}${kgC(totD)} kg`;
}

function kpi(l,ic,v,d){return `<div class="kpi"><div class="accent"></div><div class="l">${ic} ${l}</div><div class="v">${v}</div><div class="d">${d}</div></div>`;}
function kpiLimite(rows,A){
  const lim=rows.filter(x=>x.cred&&x.cc>0&&x.cu/x.cc>=0.9);
  const ocioso=Math.max(0,A.cc-A.cu);
  const col=lim.length?'#d9920a':'#1f8a5b';
  return `<div class="kpi"><div class="accent" style="background:${col}"></div><div class="l">🚦 Clientes al límite de cupo</div>
    <div class="v" style="color:${lim.length?'#d9920a':'var(--txt)'}">${nfK.format(lim.length)}</div>
    <div class="d">≥90% del cupo usado · cupo ocioso: ${copM(ocioso)}</div></div>`;}
function kpiV90(A){
  const v90=A.buckets[3][3],pc=A.moraVal>0?v90/A.moraVal*100:0;
  const col=pc>=40?'#E10600':(pc>=20?'#d9920a':'#1f8a5b');
  return `<div class="kpi"><div class="accent" style="background:${col}"></div><div class="l">⏳ Vencido +90 días</div>
    <div class="v" style="color:${A.moraVal>0?col:'var(--txt3)'}">${A.moraVal>0?nf1.format(pc)+'<small>%</small>':'—'}</div>
    <div class="d">${copM(v90)} del vencido · ${nfK.format(A.buckets[3][2])} facturas</div></div>`;}
function getMetaTotal(){try{const v=+localStorage.getItem('LC_META_TOTAL');return v>0?v:150000000;}catch(e){return 150000000;}}
function kpiMeta(scope,meta,kg){
  const ach=meta?kg/meta*100:0;
  const lm=+((MONTHS[MONTHS.length-1]||'2026-01').split('-')[1])||MONTHS.length;
  const exp=Math.min(1,lm/12)*100;
  const col=meta?(ach>=exp*0.98?'#1f8a5b':(ach>=exp*0.85?'#d9920a':'#E10600')):'var(--txt3)';
  const lbl=scope==='asesor'?'asesor':(scope==='sede'?'sucursal':'empresa');
  const edit=scope==='total'?` <span id="metaEdit" style="cursor:pointer;color:var(--acc)" title="Editar meta total">✎</span>`:'';
  return `<div class="kpi"><div class="accent" style="background:${col}"></div>
    <div class="l">🎯 Meta anual ${lbl}${edit}</div>
    <div class="v" style="color:${meta?col:'var(--txt3)'}">${meta?nf1.format(ach)+'<small>%</small>':'—'}</div>
    <div class="mbar"><i style="width:${Math.min(100,ach).toFixed(1)}%;background:${col}"></i></div>
    <div class="d">${kgC(kg)} / ${meta?kgC(meta)+' kg':'sin meta'}</div></div>`;}
function kpiUtil(l,util,cu,cc){const hi=util>=70;
  return `<div class="kpi"><div class="accent"></div><div class="l">💳 ${l}</div>
    <div class="v">${nf1.format(util)}<small>%</small></div>
    <div class="mbar"><i class="${hi?'hi':''}" style="width:${Math.min(100,util)}%"></i></div>
    <div class="d">${copM(cu)} de ${copM(cc)}</div></div>`;}
function kpiRisk(l,val,n,n90){return `<div class="kpi risk"><div class="accent"></div><div class="l">⚠️ ${l}</div>
  <div class="v">${copM(val)}</div><div class="d">${nfK.format(n)} clientes · ${nfK.format(n90)} con +90 d</div></div>`;}
function cmgrBig(cm){if(cm==null)return '<span style="color:var(--txt3)">N/D</span>';const v=cm*100;
  return `<span style="color:${v>=0?'var(--green)':'var(--red)'}">${v>=0?'+':''}${nf1.format(v)}<small>%/mes</small></span>`;}

// ===== client table (sortable) =====
function renderCliTable(sorted,tot){
  const cols=[['rk','#','no'],['name','Cliente','l'],['ciu','Ciudad',''],['suc','Sucursal',''],
    ['abc','ABC','c'],['kg','Kg (5m)','num'],['cmgr','CMGR','num'],['util','Crédito','num'],['mora','Mora','num']];
  const arr=[...sorted];
  arr.sort((a,b)=>{let r;switch(sortKey){
    case 'name':r=a.name.localeCompare(b.name,'es');break;
    case 'ciu':r=a.ciu.localeCompare(b.ciu,'es');break;
    case 'suc':r=a.suc.localeCompare(b.suc,'es');break;
    case 'cmgr':r=(a.cmgr==null?-9:a.cmgr)-(b.cmgr==null?-9:b.cmgr);break;
    case 'util':r=(a.cred?a.cu/a.cc:-1)-(b.cred?b.cu/b.cc:-1);break;
    case 'mora':r=a.moraVal-b.moraVal;break;
    case 'abc':r=a.kg-b.kg;break;
    default:r=a.kg-b.kg;}
    return r*sortDir;});
  const shown=arr.slice(0,cliLimit);
  const head=cols.map(c=>{const active=c[0]===sortKey;
    return `<th class="${c[2]==='num'?'num':''} ${c[2]==='no'?'no':''}" data-sk="${c[0]}">${c[1]}${active?` <span class="ar">${sortDir<0?'▼':'▲'}</span>`:''}</th>`;}).join('');
  const body=shown.map((x,i)=>{
    const util=x.cred?x.cu/x.cc*100:null;
    const utilCell=x.cred?`<span class="pill ${util>=90?'bad':(util>=70?'warn':'ok')}">${nf1.format(util)}%</span>`:`<span class="pill cash">Contado</span>`;
    const moraCell=x.moraVal>0?`<span class="pill ${x.maxMora>90?'bad':'warn'}" title="máx ${x.maxMora} d">${copM(x.moraVal)}</span>`:'<span style="color:var(--txt3)">—</span>';
    return `<tr class="click" data-cli="${x.name.replace(/"/g,'&quot;')}">
      <td class="rk">${i+1}</td>
      <td><div class="cname">${x.name}</div><div class="csmall">NIT ${x.c.nit||'—'}</div></td>
      <td>${x.ciu}</td><td style="font-size:11.5px">${x.suc}</td>
      <td><span class="badge ${x.abc}">${x.abc}</span></td>
      <td class="num">${nfK.format(x.kg)}</td>
      <td class="num">${cmgrCell(x.cmgr)}</td>
      <td class="num">${utilCell}</td>
      <td class="num">${moraCell}</td></tr>`;}).join('');
  document.getElementById('cliTableWrap').innerHTML=`<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  document.querySelectorAll('#cliTableWrap th[data-sk]').forEach(th=>{if(th.classList.contains('no'))return;
    th.onclick=()=>{const k=th.dataset.sk;if(k===sortKey)sortDir*=-1;else{sortKey=k;sortDir=(k==='name'||k==='ciu'||k==='suc')?1:-1;}render();};});
  document.querySelectorAll('#cliTableWrap tr.click').forEach(tr=>tr.onclick=()=>openCli(tr.dataset.cli));
  const more=document.getElementById('cliMore');
  if(arr.length>cliLimit){more.textContent=`▼ Ver más (${nfK.format(arr.length-cliLimit)} clientes más · mostrando ${cliLimit})`;
    more.onclick=()=>{cliLimit+=80;render();};}
  else{more.textContent=arr.length>40?`Mostrando los ${nfK.format(arr.length)} clientes de la vista`:'';more.onclick=null;}
}
function openCli(name){location.href='Hoja de Ruta - Cliente.html?cliente='+encodeURIComponent(name);}

// ===== segmentación por grupo (kg) =====
let sgrpAll=false;
window.sgrpMore=function(){sgrpAll=!sgrpAll;render();};
function renderSegGrp(rows){
  const agg={};let totN=0,totKg=0;
  rows.forEach(x=>{totN++;for(const gi in x.byG){const v=x.byG[gi];if(v.kg<=0)continue;
    const nm=gi>=0?CATS[gi]:'(s/g)';const g=agg[nm]=agg[nm]||{nm,n:0,kg:0};g.n++;g.kg+=v.kg;totKg+=v.kg;}});
  const arr=Object.values(agg).sort((a,b)=>b.kg-a.kg);
  const box=document.getElementById('segGrpBox');if(!box)return;
  if(!arr.length){box.innerHTML='<div class="foot-note">Sin datos de grupos en la vista actual.</div>';return;}
  const LIM=12,shown=sgrpAll?arr:arr.slice(0,LIM);
  const maxN=Math.max(...arr.map(g=>g.n),1);
  const rkCol=i=>['#E10600','#B00500','#14161a','#3a3f45','#5a6066','#6b7176'][i]||'#949aa1';
  const html=shown.map((g,i)=>{
    const on=ST.grp===g.nm,pcN=totN?g.n/totN*100:0,pcKg=totKg?g.kg/totKg*100:0;
    return `<div class="segrow${on?' on':''}" data-grp="${g.nm.replace(/"/g,'&quot;')}" title="Clic para ${on?'quitar el filtro':'ver solo los clientes que compran este grupo'}">
      <div class="seg-rank" style="background:${rkCol(i)}">${i+1}</div>
      <div class="seg-l" title="${g.nm}">${g.nm}</div>
      <div class="seg-bar"><i style="width:${(g.n/maxN*100).toFixed(1)}%;background:${rkCol(i)}"></i></div>
      <div class="seg-n">${nfK.format(g.n)} <span>cli</span></div>
      <div class="seg-pcn">${nf1.format(pcN)}%</div>
      <div class="seg-kg">${kgC(g.kg)} <span>kg</span></div>
      <div class="seg-pck">${nf1.format(pcKg)}%</div>
    </div>`;}).join('');
  box.innerHTML=`<div class="seg-head"><div></div><div></div><div></div><div class="seg-th">Clientes</div><div class="seg-th">% cli</div><div class="seg-th">Volumen</div><div class="seg-th">% kg</div></div>${html}`+
    (arr.length>LIM?`<span class="morelink" onclick="sgrpMore()">${sgrpAll?'Ver menos':`Ver los ${arr.length} grupos`}</span>`:'')+
    `<div class="foot-note" style="margin-top:8px">% cli = clientes que compran el grupo sobre los de la vista (un cliente puede contar en varios grupos). % kg sobre el volumen total.</div>`;
  const hint=document.getElementById('segGrpHint');
  if(hint)hint.textContent=ST.grp?'filtrando · clic para quitar':'clic en un grupo para filtrar';
  box.querySelectorAll('.segrow').forEach(el=>el.onclick=()=>{
    const nm=el.dataset.grp;ST.grp=(ST.grp===nm)?'':nm;cliLimit=40;saveState();render();
  });
}

// ===== segmentación por volumen de compra (kg) =====
function renderSeg(rows){
  const segs=SEG.map(s=>({l:s.l,n:0,kg:0}));
  let totN=0,totKg=0;
  rows.forEach(x=>{const i=segIdx(x.kg);segs[i].n++;segs[i].kg+=x.kg;totN++;totKg+=x.kg;});
  const maxN=Math.max(1,...segs.map(s=>s.n));
  const active=(ST.vol!==''&&ST.vol!=null)?+ST.vol:-1;
  const colors=['#aeb4ba','#8a96a4','#5a6066','#B00500','#E10600'];
  const html=segs.map((s,i)=>{
    const pcN=totN?s.n/totN*100:0, pcKg=totKg?s.kg/totKg*100:0, on=i===active;
    return `<div class="segrow${on?' on':''}" data-seg="${i}" title="Clic para ${on?'quitar el filtro':'ver solo este segmento'}">
      <div class="seg-rank" style="background:${colors[i]}">${i+1}</div>
      <div class="seg-l">${s.l}</div>
      <div class="seg-bar"><i style="width:${(s.n/maxN*100).toFixed(1)}%;background:${colors[i]}"></i></div>
      <div class="seg-n">${nfK.format(s.n)} <span>cli</span></div>
      <div class="seg-pcn">${nf1.format(pcN)}%</div>
      <div class="seg-kg">${kgC(s.kg)} <span>kg</span></div>
      <div class="seg-pck">${nf1.format(pcKg)}%</div>
    </div>`;
  }).join('');
  document.getElementById('segBox').innerHTML=
    `<div class="seg-head"><div></div><div></div><div></div><div class="seg-th">Clientes</div><div class="seg-th">% cli</div><div class="seg-th">Volumen</div><div class="seg-th">% kg</div></div>${html}`;
  document.getElementById('segHint').textContent=active>=0?'filtrando · clic para quitar':'clic en un segmento para filtrar';
  document.querySelectorAll('#segBox .segrow').forEach(el=>el.onclick=()=>{
    const i=+el.dataset.seg;ST.vol=(active===i)?'':String(i);cliLimit=40;saveState();render();
  });
}

// ===== ventas en kg por asesor (atribuidas por factura) =====
// Usa DATA.aseKg (calculado fila por fila en la importación). Respeta filtros de sucursal/asesor.
// Para datos demo (sin aseKg) cae al agregado por cliente.
function aseKgMap(){
  const out={};
  if(DATA.aseKg && Object.keys(DATA.aseKg).length){
    for(const a in DATA.aseKg){
      if(ST.ase && a!==ST.ase) continue;
      if(ST.suc && sucOf(a)!==ST.suc) continue;
      out[a]=DATA.aseKg[a];
    }
  } else {
    ALL.forEach(x=>{if(ST.suc&&x.suc!==ST.suc)return;if(ST.ase&&x.ase!==ST.ase)return;out[x.ase]=(out[x.ase]||0)+x.kg;});
  }
  return out;
}

// ===== cumplimiento de meta anual por asesor =====
let metaSort={key:'pct',dir:-1};
window.metaSortBy=function(key){
  if(metaSort.key===key){metaSort.dir*=-1;}
  else{metaSort={key,dir:key==='a'?1:-1};}
  renderMeta();
};
function renderMeta(){
  const box=document.getElementById('metaBox'), hint=document.getElementById('metaHint');
  const meta=DATA.metaAse||{};
  if(!Object.keys(meta).some(a=>meta[a]>0)){
    box.innerHTML=`<div class="foot-note" style="font-size:13px;padding:6px 0">Este panel se activa cuando tu Excel incluye la columna <b>"Meta Anual Asesor"</b>. Vuelve a cargar tu export de ventas para verlo.</div>`;
    hint.textContent='requiere columna "Meta Anual Asesor"';return;
  }
  const kgAse=aseKgMap();
  const nMonths=MONTHS.length||1;
  const lastMM=+(MONTHS[MONTHS.length-1].split('-')[1])||nMonths;
  const expected=Math.min(1,lastMM/12); // ritmo esperado a la fecha (% del año transcurrido)
  let arr=Object.keys(meta).filter(a=>meta[a]>0).map(a=>{
    const vend=kgAse[a]||0,m=meta[a],pct=m?vend/m:0,proj=(vend/nMonths)*12;
    const pace=expected>0?pct/expected:0; // 1 = justo en ritmo
    return {a,vend,m,pct,proj,pace};
  });
  const _mk=metaSort.key,_md=metaSort.dir;
  arr.sort((x,y)=>_mk==='a'?_md*x.a.localeCompare(y.a,'es'):_md*((x[_mk]||0)-(y[_mk]||0)));
  const totV=arr.reduce((s,r)=>s+r.vend,0),totM=arr.reduce((s,r)=>s+r.m,0);
  const gPct=totM?totV/totM*100:0;
  const SC={g:'#1f8a5b',a:'#d9920a',r:'#E10600'};
  const SL={g:'En ritmo',a:'Atención',r:'Atrasado'};
  const sem=p=>p>=0.98?'g':(p>=0.85?'a':'r');
  const rows=arr.map(r=>{
    const st=sem(r.pace),col=SC[st],pctClamp=Math.min(100,r.pct*100);
    const projPct=r.m?r.proj/r.m*100:0;
    return `<div class="metarow">
      <div class="meta-l" title="${r.a}">${r.a}</div>
      <div class="meta-track">
        <div class="meta-fill" style="width:${pctClamp.toFixed(1)}%;background:${col}"></div>
        <div class="meta-exp" style="left:${(expected*100).toFixed(1)}%" title="Ritmo esperado: ${nf1.format(expected*100)}%"></div>
      </div>
      <div class="meta-pct" style="color:${col}">${nf1.format(r.pct*100)}%</div>
      <div class="meta-v">${kgC(r.vend)} <span>/ ${kgC(r.m)}</span></div>
      <div class="meta-proj">${nf1.format(projPct)}%</div>
      <div class="meta-sem"><span class="dots" style="background:${col}"></span>${SL[st]}</div>
    </div>`;
  }).join('');
  box.innerHTML=`
    <div class="meta-sum">
      <div><span class="l">Asesores con meta</span><span class="v">${nfK.format(arr.length)}</span></div>
      <div><span class="l">Vendido acumulado</span><span class="v">${kgC(totV)} kg</span></div>
      <div><span class="l">Meta anual total</span><span class="v">${kgC(totM)} kg</span></div>
      <div><span class="l">Cumplimiento global</span><span class="v" style="color:${gPct>=expected*100?SC.g:(gPct>=expected*85?SC.a:SC.r)}">${nf1.format(gPct)}%</span></div>
    </div>
    <div class="meta-head"><div></div><div class="meta-mark" style="left:calc(${(expected*100).toFixed(1)}% )">▎ritmo esperado ${nf1.format(expected*100)}%</div></div>
    <div class="meta-colh">${[['a','Asesor'],['pct','Avance vs. meta'],['pct2','% meta'],['vend','Vendido / meta'],['proj','Proy. cierre'],['pace','Estado']].map(([k,l])=>{
      const kk=k==='pct2'?'pct':k;const on=metaSort.key===kk&&(k!=='pct'||true);
      const act=metaSort.key===kk;
      return `<div class="srt${act?' on':''}" onclick="metaSortBy('${kk}')">${l}${act?(metaSort.dir<0?' ▾':' ▴'):''}</div>`;}).join('')}</div>
    ${rows}
    <div class="foot-note" style="margin-top:10px">Avance = kg vendidos (datos cargados) ÷ meta anual. La marca vertical es el ritmo esperado (${nf1.format(expected*100)}% del año, a ${MES0[lastMM-1]}). Proy. cierre = ritmo actual anualizado ÷ meta. Estado: ✅ en ritmo · ⚠ atención · 🔴 atrasado.</div>`;
  hint.textContent=`${nfK.format(arr.length)} asesores · meta total ${kgC(totM)} kg`;
}

function bindFilters(){
  const map={pf_fSuc:'suc',pf_fAse:'ase',fCiu:'ciu',fTipo:'tipo',fMora:'mora'};
  for(const id in map){const el=document.getElementById(id);el.value=ST[map[id]]||'';
    el.onchange=()=>{ST[map[id]]=el.value;cliLimit=40;saveState();render();};}
  const sb=document.getElementById('pf_fSearch');sb.value=ST.q||'';
  let t;sb.oninput=()=>{clearTimeout(t);t=setTimeout(()=>{ST.q=sb.value.trim();cliLimit=40;saveState();render();},220);};
  document.getElementById('pf_fClear').onclick=()=>{Object.keys(ST).forEach(k=>ST[k]='');cliLimit=40;
    for(const id in map)document.getElementById(id).value='';sb.value='';saveState();render();};
}

// ===== theme / accent =====
function bindTheme(){
  const root=document.documentElement;
  try{const t=localStorage.getItem('LC_THEME');if(t)root.dataset.theme=t;const a=localStorage.getItem('LC_ACCENT');if(a)root.dataset.accent=a;}catch(e){}
  document.querySelectorAll('#themeSeg .c').forEach(c=>{c.classList.toggle('on',c.dataset.theme===root.dataset.theme);
    c.onclick=()=>{root.dataset.theme=c.dataset.theme;try{localStorage.setItem('LC_THEME',c.dataset.theme);}catch(e){}
      document.querySelectorAll('#themeSeg .c').forEach(x=>x.classList.toggle('on',x===c));render();};});
  document.querySelectorAll('#accentSeg .c').forEach(c=>{c.classList.toggle('on',c.dataset.accent===root.dataset.accent);
    c.onclick=()=>{root.dataset.accent=c.dataset.accent;try{localStorage.setItem('LC_ACCENT',c.dataset.accent);}catch(e){}
      document.querySelectorAll('#accentSeg .c').forEach(x=>x.classList.toggle('on',x===c));render();};});
}

// ===== Excel: importar / reconstruir todo el dataset =====
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
  const tpl=document.getElementById('xlsTemplate');if(tpl)tpl.onclick=buildTemplate;
  const xr=document.getElementById('xlsReset');
  if(xr)xr.onclick=()=>{
    if(!confirm('¿Restablecer los datos de demostración? Se borrará el dataset importado en este navegador.'))return;
    Promise.all([lcDel('dataset'),lcDel('inv')]).then(()=>location.reload());};
}
// helpers de mapeo
function _norm(s){return (s==null?'':(''+s)).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();}
function _num(v){if(v==null||v==='')return 0;if(typeof v==='number')return v;
  let t=(''+v).trim().replace(/[^0-9,.\-]/g,'');if(!t)return 0;
  const hasC=t.indexOf(',')>=0,hasD=t.indexOf('.')>=0;
  if(hasC&&hasD){ if(t.lastIndexOf(',')>t.lastIndexOf('.'))t=t.replace(/\./g,'').replace(',','.'); // 1.234,56 (EU)
                  else t=t.replace(/,/g,''); }                                                    // 1,234.56 (US)
  else if(hasC){ const last=t.split(',').pop(); t=(t.match(/,/g)||[]).length>1||last.length===3?t.replace(/,/g,''):t.replace(',','.'); }
  else if(hasD){ const dots=(t.match(/\./g)||[]).length,last=t.split('.').pop();
    if(dots>1||last.length===3)t=t.replace(/\./g,''); }
  const n=parseFloat(t);return isNaN(n)?0:n;}
function _pick(row,cands){ // exact match primero, luego incluye
  const keys=Object.keys(row);
  for(const c of cands){for(const k of keys){if(_norm(k)===c)return row[k];}}
  for(const c of cands){for(const k of keys){if(_norm(k).includes(c))return row[k];}}
  return undefined;}
function _findSheet(wb,cands){return wb.SheetNames.find(sn=>{const n=_norm(sn);return cands.some(c=>n.includes(c));});}
function _monthKey(h){const m=_norm(h).match(/(20\d\d)[-_/. ]?(0?[1-9]|1[0-2])(?!\d)/);return m?m[1]+'-'+('0'+m[2]).slice(-2):null;}

function rebuild(wb){
  const shVen=_findSheet(wb,['venta','compra']);
  if(!shVen)return null;
  const ven=XLSX.utils.sheet_to_json(wb.Sheets[shVen],{defval:''});
  if(!ven.length)return null;
  const headers=Object.keys(ven[0]);
  const monthCols=headers.map(h=>({h,k:_monthKey(h)})).filter(x=>x.k).sort((a,b)=>a.k<b.k?-1:1);
  if(!monthCols.length)return {error:'La hoja Ventas no tiene columnas de mes en formato AAAA-MM (ej. 2026-01).'};
  const MONTHS=monthCols.map(x=>x.k);
  const cats=[],catIdx={};
  const gi=name=>{name=(name||'').toString().trim()||'(s/g)';if(!(name in catIdx)){catIdx[name]=cats.length;cats.push(name);}return catIdx[name];};
  const catalog={},CLI={};
  const getCli=name=>{name=(name||'').toString().trim();if(!name)return null;
    if(!CLI[name])CLI[name]={nit:'',ciu:'',dep:'',ase:'',plazo:'',cc:0,cu:0,kg:0,a:[],mora:[],_am:{}};return CLI[name];};
  const report={clientes:0,ventas:0,cartera:0,inv:0,meses:MONTHS};
  ven.forEach(r=>{
    const name=(_pick(r,['cliente','razon social','razon','nombre cliente'])||'').toString().trim();
    const cod=(_pick(r,['codigo','referencia','sku','cod','item'])||'').toString().trim();
    if(!name||!cod)return;
    const desc=(_pick(r,['descripcion','articulo','detalle','producto'])||cod).toString().trim();
    const grp=(_pick(r,['grupo','categoria','linea','familia'])||'(s/g)').toString().trim();
    if(!catalog[cod])catalog[cod]=[desc,gi(grp)];
    const c=getCli(name);if(!c._am[cod])c._am[cod]=MONTHS.map(_=>0);
    monthCols.forEach((mc,i)=>{c._am[cod][i]+=_num(r[mc.h]);});
    report.ventas++;
  });
  Object.values(CLI).forEach(c=>{c.a=Object.entries(c._am).map(([cod,s])=>[cod,s]);
    c.kg=c.a.reduce((t,[,s])=>t+s.reduce((a,b)=>a+b,0),0);delete c._am;});
  // Clientes (atributos)
  const shCli=_findSheet(wb,['client']);
  if(shCli){XLSX.utils.sheet_to_json(wb.Sheets[shCli],{defval:''}).forEach(r=>{
    const name=(_pick(r,['cliente','razon social','razon','nombre'])||'').toString().trim();if(!name)return;
    const c=getCli(name);
    c.nit=(_pick(r,['nit','documento','identificacion'])||c.nit||'').toString().trim();
    c.ciu=(_pick(r,['ciudad','municipio'])||c.ciu||'').toString().trim();
    c.dep=(_pick(r,['departamento','depto','region','estado'])||c.dep||'').toString().trim();
    c.ase=(_pick(r,['asesor','vendedor','comercial','ejecutivo'])||c.ase||'').toString().trim();
    c.plazo=(_pick(r,['plazo','condicion de pago','condicion','termino'])||c.plazo||'').toString().trim();
    const cc=_num(_pick(r,['cupo credito','cupo de credito','cupo_credito','limite de credito','cupo asignado','cupo']));
    const cu=_num(_pick(r,['cupo usado','cupo_usado','saldo cartera','utilizado','usado','deuda']));
    if(cc)c.cc=cc;if(cu)c.cu=cu;report.clientes++;
  });}
  // Cartera / mora
  const shCar=_findSheet(wb,['cartera','mora']);
  if(shCar){XLSX.utils.sheet_to_json(wb.Sheets[shCar],{defval:''}).forEach(r=>{
    const name=(_pick(r,['cliente','razon social','razon'])||'').toString().trim();if(!name)return;
    const c=getCli(name);
    const fact=(_pick(r,['factura','documento','fact','numero'])||'').toString().trim();
    const dias=_num(_pick(r,['dias vencido','dias_vencido','dias','vencimiento','mora']));
    const val=_num(_pick(r,['valor','saldo','monto','vencido','importe']));
    if(val>0||dias>0){c.mora.push([fact,Math.round(dias),Math.round(val)]);report.cartera++;}
  });}
  // Inventario
  const INV={};
  const shInv=_findSheet(wb,['inventar','stock','existenc']);
  if(shInv){XLSX.utils.sheet_to_json(wb.Sheets[shInv],{defval:''}).forEach(r=>{
    const cod=(_pick(r,['codigo','referencia','sku','cod'])||'').toString().trim();if(!cod)return;
    const k=_num(_pick(r,['stock_kg','stock','existencia','inventario','kg','saldo','disponible','cantidad']));
    INV[cod]={k:Math.round(k)};report.inv++;
    if(!catalog[cod]){const d=(_pick(r,['descripcion','articulo'])||cod).toString().trim();const g=(_pick(r,['grupo','categoria'])||'(s/g)').toString().trim();catalog[cod]=[d,gi(g)];}
  });}
  const DATA={months:MONTHS,cats,catalog,clients:CLI,ntop:Object.keys(CLI).length,pct:100,volshare:100};
  return {DATA,INV,report};
}

// ---- Lector del EXPORT CRUDO (una hoja, una fila por línea de factura) ----
const MAXM=12; // meses a conservar (los más recientes)
function _ym(v){if(v==null||v==='')return null;
  if(typeof v==='number'){const d=new Date(Date.UTC(1899,11,30)+Math.round(v)*86400000);return d.getUTCFullYear()+'-'+('0'+(d.getUTCMonth()+1)).slice(-2);}
  const s=(''+v).trim();let m=s.match(/(\d{4})[-/.](\d{1,2})/);if(m)return m[1]+'-'+('0'+m[2]).slice(-2);
  m=s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);if(m)return m[3]+'-'+('0'+m[2]).slice(-2);
  const d=new Date(s);return isNaN(d)?null:d.getUTCFullYear()+'-'+('0'+(d.getUTCMonth()+1)).slice(-2);}
function _resolve(H,cands){const N=H.map(_norm);for(const c of cands){const i=N.indexOf(c);if(i>=0)return H[i];}
  for(const c of cands){const i=N.findIndex(n=>n.includes(c));if(i>=0)return H[i];}return null;}
// Columna de meta del ASESOR (evita "Meta Anual Sede"/"Meta Anual Grupo"/zona/etc.)
function _metaCol(H){const N=H.map(_norm),BAD=/(sede|grupo|zona|sucursal|region|nacional|empresa|ciudad|departamento)/;
  let i=N.findIndex(n=>n.includes('meta')&&n.includes('asesor'));if(i>=0)return H[i];
  i=N.findIndex(n=>n.includes('meta')&&(n.includes('vendedor')||n.includes('comercial')));if(i>=0)return H[i];
  i=N.findIndex(n=>n.includes('meta')&&n.includes('anual')&&!BAD.test(n));if(i>=0)return H[i];
  i=N.findIndex(n=>n.includes('meta')&&!BAD.test(n));return i>=0?H[i]:null;}
function _metaSedeCol(H){const N=H.map(_norm);const i=N.findIndex(n=>n.includes('meta')&&(n.includes('sede')||n.includes('sucursal')));return i>=0?H[i]:null;}
function _metaGrupoCol(H){const N=H.map(_norm);const i=N.findIndex(n=>n.includes('meta')&&(n.includes('grupo')||n.includes('linea')||n.includes('familia')||n.includes('categoria')));return i>=0?H[i]:null;}
// Clasifica una venta en una REGIÓN geográfica para agrupar el stock por cercanía.
// Sedes lejanas (inventario aislado): Barranquilla, Villavicencio, Neiva, Ibagué. El resto = pool Bogotá.
// Mapa de CÓDIGO de bodega (encabezados SPALQ, SVILL, …) → región.
const FAR_WH={SVILL:'Villavicencio',SBARR:'Barranquilla',SNCEN:'Neiva',SNZIN:'Neiva',SIBAG:'Ibagué'};
function _regCode(code){if(code==null)return 'Bogotá';const c=(''+code).trim().toUpperCase();
  if(FAR_WH[c])return FAR_WH[c];
  const n=_norm(c);
  if(n.includes('barranq')||c==='SBARR')return 'Barranquilla';
  if(n.includes('villavic')||c==='SVILL')return 'Villavicencio';
  if(n.includes('neiva'))return 'Neiva';
  if(n.includes('ibague'))return 'Ibagué';
  return 'Bogotá';}
function _regionCity(sede){const s=_norm(sede);
  if(s.includes('barranquilla'))return 'Barranquilla';
  if(s.includes('villavicencio'))return 'Villavicencio';
  if(s.includes('neiva'))return 'Neiva';
  if(s.includes('ibague'))return 'Ibagué';
  return 'Bogotá';}
function rebuildRaw(wb){
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:null});
  if(!rows.length)return null;
  const H=Object.keys(rows[0]);
  const K={cli:_resolve(H,['cliente','razon social']),nit:_resolve(H,['nit','documento']),ciu:_resolve(H,['ciudad','municipio']),
    dep:_resolve(H,['departamento','depto']),ase:_resolve(H,['asesor','vendedor']),plazo:_resolve(H,['plazo']),
    cc:_resolve(H,['cupo de credito','cupo credito']),cu:_resolve(H,['cupo usado']),
    cod:_resolve(H,['codigo de articulo','codigo','referencia']),art:_resolve(H,['articulo','descripcion']),grp:_resolve(H,['grupo']),
    fecha:_resolve(H,['fecha de factura','fecha']),kilos:_resolve(H,['kilos','kg']),stock:_resolve(H,['stock en kg','stock']),
    dias:_resolve(H,['dias de mora','dias']),numF:_resolve(H,['numero de factura','factura']),alm:_resolve(H,['almacen','bodega']),
    sede:_resolve(H,['sede','sucursal','agencia','regional']),
    meta:_metaCol(H),metaSede:_metaSedeCol(H),metaGrupo:_metaGrupoCol(H),
    valK:_resolve(H,['valor kilo','valor por kilo','valor kg','precio kilo','precio por kilo','precio kg']),
    costK:_resolve(H,['costo kilo','costo por kilo','costo kg']),
    pesoU:_resolve(H,['peso unitario','peso unidad','peso por unidad']),
    valT:_resolve(H,['valor total articulo','valor total']),valP:_resolve(H,['valor pagado']),paga:_resolve(H,['factura paga total'])};
  if(!K.cod||!K.fecha||!K.kilos)return null; // no es el export crudo
  const metaAse={},metaCnt={}; // meta anual (kg) por asesor — se toma el valor más frecuente
  const metaSedeCnt={},metaGrupoCnt={}; // meta anual por sucursal y por grupo (valor más frecuente)
  const aseKgM={}; // asesor -> ym -> kg (ventas por asesor, por FILA/factura)
  const rentGM={}; // grupo -> {rev:{ym},cost:{ym},kg:{ym}} rentabilidad mensual por grupo (global)
  const aseRevM={},aseCostM={}; // asesor -> {ym} venta/costo (rentabilidad por asesor, por factura)
  const artWh={}; // stock por artículo → bodega (columnas SPALQ…) o almacén (fallback), a nivel artículo
  // columnas de bodega: stock del artículo por bodega. Se detectan por (a) coincidir con un valor de Almacen
  // y (b) la lista conocida de códigos de bodega, para no depender de que cada bodega tenga ventas.
  const KNOWN_WH=['SPALQ','SCENT','CPFAC','SIBAG','PBUEN','SCESE','SFONT','SNCEN','SRIC2','SNZIN','S7AGO','SRIC1','SSOAC','SVILL','SBARR','SMOSQ'];
  let whCols=[];{const av=new Set();if(K.alm){for(let i=0;i<rows.length;i++){const a=(rows[i][K.alm]||'').toString().trim();if(a)av.add(a);}}
    whCols=H.filter(h=>{const t=(h||'').toString().trim();return t&&t!==K.stock&&(av.has(t)||KNOWN_WH.indexOf(t.toUpperCase())>=0);});}
  const cats=[],catIdx={};const gi=n=>{n=(n||'').toString().trim()||'(s/g)';if(!(n in catIdx)){catIdx[n]=cats.length;cats.push(n);}return catIdx[n];};
  const catalog={},INV={},CLI={},fact={};
  rows.forEach(r=>{
    const name=(r[K.cli]||'').toString().trim();if(!name)return;
    let c=CLI[name];if(!c)c=CLI[name]={nit:'',ciu:'',dep:'',ase:'',plazo:'',cc:0,cu:0,am:{},regKg:{},rev:0,cost:0,rgByG:{}};
    if(!c.nit&&K.nit)c.nit=(r[K.nit]||'').toString().trim();
    if(!c.ciu&&K.ciu)c.ciu=(r[K.ciu]||'').toString().trim();
    if(!c.dep&&K.dep)c.dep=(r[K.dep]||'').toString().trim();
    if(!c.ase&&K.ase)c.ase=(r[K.ase]||'').toString().trim();
    if(!c.plazo&&K.plazo)c.plazo=(r[K.plazo]||'').toString().trim();
    if(K.meta&&c.ase){const mv=_num(r[K.meta]);if(mv>0){const mc=metaCnt[c.ase]||(metaCnt[c.ase]={});mc[mv]=(mc[mv]||0)+1;}}
    const _rAse=(K.ase?(r[K.ase]||'').toString().trim():'')||c.ase;
    if(K.metaSede&&_rAse){const su=sucOf(_rAse);const mv=_num(r[K.metaSede]);if(mv>0){const mc=metaSedeCnt[su]||(metaSedeCnt[su]={});mc[mv]=(mc[mv]||0)+1;}}
    if(K.metaGrupo){const gp=(K.grp?(r[K.grp]||'').toString().trim():'')||'(s/g)';const mv=_num(r[K.metaGrupo]);if(mv>0){const mc=metaGrupoCnt[gp]||(metaGrupoCnt[gp]={});mc[mv]=(mc[mv]||0)+1;}}
    if(K.cc){const v=_num(r[K.cc]);if(v>c.cc)c.cc=v;}
    if(K.cu){const v=_num(r[K.cu]);if(v>c.cu)c.cu=v;}
    const cod=(r[K.cod]||'').toString().trim(),ym=_ym(r[K.fecha]);
    if(cod&&ym){
      const gname=(K.grp?(r[K.grp]||'(s/g)'):'(s/g)').toString().trim()||'(s/g)';
      const gidx=gi(gname);
      if(!catalog[cod])catalog[cod]=[(K.art?(r[K.art]||cod):cod).toString().trim(),gidx];
      if(K.pesoU&&catalog[cod]&&catalog[cod][2]==null){const pu=_num(r[K.pesoU]);if(pu)catalog[cod][2]=pu;}
      const kk=_num(r[K.kilos]);
      const am=c.am[cod]||(c.am[cod]={});am[ym]=(am[ym]||0)+kk;
      if(K.valK||K.costK){
        const vk=K.valK?_num(r[K.valK]):0, ck=K.costK?_num(r[K.costK]):0;
        const rev=vk*kk, cost=ck*kk;
        c.rev+=rev;c.cost+=cost;
        const rgg=c.rgByG[gidx]||(c.rgByG[gidx]={rev:0,cost:0});rgg.rev+=rev;rgg.cost+=cost;
        const gm=rentGM[gname]||(rentGM[gname]={rev:{},cost:{},kg:{}});
        gm.rev[ym]=(gm.rev[ym]||0)+rev;gm.cost[ym]=(gm.cost[ym]||0)+cost;gm.kg[ym]=(gm.kg[ym]||0)+kk;
        const asn2=(K.ase?(r[K.ase]||'').toString().trim():'');
        if(asn2){(aseRevM[asn2]||(aseRevM[asn2]={}))[ym]=(aseRevM[asn2][ym]||0)+rev;(aseCostM[asn2]||(aseCostM[asn2]={}))[ym]=(aseCostM[asn2][ym]||0)+cost;}
      }
    }
    // Ventas por ASESOR atribuidas a quien hizo CADA factura (la fila), no al asesor del cliente.
    if(K.ase&&ym){const asn=(r[K.ase]||'').toString().trim();if(asn){const k=_num(r[K.kilos]);if(k){(aseKgM[asn]||(aseKgM[asn]={}))[ym]=(aseKgM[asn][ym]||0)+k;}}}
    // Región del cliente según el ALMACÉN (código) donde facturó (luego se toma la dominante por kilos).
    const _almCode=(K.alm?(r[K.alm]||'').toString().trim():'');
    const _reg=_almCode?_regCode(_almCode):_regionCity(K.sede?r[K.sede]:'');
    if(ym)c.regKg[_reg]=(c.regKg[_reg]||0)+_num(r[K.kilos]);
    // Stock del artículo por BODEGA: columnas SPALQ…SMOSQ (nivel artículo, se toma el máximo visto;
    // así no se duplica aunque el artículo aparezca en varias facturas/fechas).
    if(cod){const aw=artWh[cod]||(artWh[cod]={});
      if(whCols.length){for(let wi=0;wi<whCols.length;wi++){const w=whCols[wi];const v=_num(r[w]);if(v>(aw[w]||0))aw[w]=v;}}
      else if(K.stock){const a2=_almCode||'_';const v=_num(r[K.stock]);if(v>(aw[a2]||0))aw[a2]=v;}}
    if(K.numF&&K.dias){const nf=(r[K.numF]||'').toString().trim();if(nf){const f=fact[nf]||(fact[nf]={cli:name,dias:0,total:0,pag:0,paga:''});
      f.dias=Math.max(f.dias,_num(r[K.dias]));if(K.valT)f.total+=_num(r[K.valT]);if(K.valP)f.pag=Math.max(f.pag,_num(r[K.valP]));
      if(K.paga){const p=(r[K.paga]||'').toString().trim().toUpperCase();if(p)f.paga=p;}}}
  });
  const allYM=new Set();for(const n in CLI){const am=CLI[n].am;for(const cod in am)for(const ym in am[cod])allYM.add(ym);}
  const MONTHS=[...allYM].sort().slice(-MAXM);
  // Mapa bodega→región y conteo de sedes (bodegas) por región, para la etiqueta.
  const whReg={};whCols.forEach(w=>{whReg[w]=_regCode(w);});
  const regSedeCount={};
  if(whCols.length){whCols.forEach(w=>{const rg=whReg[w];regSedeCount[rg]=(regSedeCount[rg]||0)+1;});}
  // Stock regional por artículo: suma del stock de las bodegas de cada región. INV global = total.
  const regionStock={};
  for(const cod in artWh){const aw=artWh[cod],rs=regionStock[cod]={};let tot=0;
    if(whCols.length){for(const w in aw){const rg=whReg[w];rs[rg]=(rs[rg]||0)+aw[w];tot+=aw[w];}}
    else{for(const al in aw){const rg=_regCode(al);rs[rg]=(rs[rg]||0)+aw[al];tot+=aw[al];}}
    for(const rg in rs)rs[rg]=Math.round(rs[rg]);
    if(!(cod in INV))INV[cod]={k:Math.round(tot)};}
  const clients={};
  for(const name in CLI){const c=CLI[name],a=[];let kg=0;
    for(const cod in c.am){const s=MONTHS.map(ym=>Math.round(c.am[cod][ym]||0));const t=s.reduce((x,y)=>x+y,0);if(t>0){a.push([cod,s]);kg+=t;}}
    if(!a.length&&c.cc<=0)continue;
    // región dominante del cliente = donde más kilos compró
    let reg='Bogotá',best=-1;for(const rg in c.regKg){if(c.regKg[rg]>best){best=c.regKg[rg];reg=rg;}}
    // stock disponible = stock del artículo en la región del cliente (pool por cercanía)
    const stk={};for(const cod in c.am){const rs=regionStock[cod];if(rs&&rs[reg]!=null)stk[cod]=rs[reg];}
    clients[name]={nit:c.nit,ciu:c.ciu,dep:c.dep,ase:c.ase,plazo:c.plazo,cc:c.cc,cu:c.cu,kg,a,mora:[],stk,reg,
      rev:Math.round(c.rev||0),cost:Math.round(c.cost||0),
      rg:Object.entries(c.rgByG||{}).map(([g,o])=>[+g,Math.round(o.rev),Math.round(o.cost)])};}
  let nCart=0;for(const nf in fact){const f=fact[nf];if(f.dias>0&&f.paga!=='SI'){const pend=Math.max(0,Math.round(f.total-f.pag));
    if(pend>0&&clients[f.cli]){clients[f.cli].mora.push([nf,Math.round(f.dias),pend]);nCart++;}}}
  // meta por asesor/sede/grupo = valor más frecuente (robusto ante filas con dato erróneo)
  const _mode=cnt=>{const o={};for(const k in cnt){let best=0,bc=-1;const mc=cnt[k];for(const v in mc){if(mc[v]>bc){bc=mc[v];best=+v;}}o[k]=best;}return o;};
  Object.assign(metaAse,_mode(metaCnt));
  const metaSede=_mode(metaSedeCnt),metaGrupo=_mode(metaGrupoCnt);
  // ventas por asesor (suma de las filas/facturas de ese asesor en los meses conservados)
  const aseKg={},aseKgMons={};
  for(const a in aseKgM){let t=0;const ser=MONTHS.map(ym=>Math.round(aseKgM[a][ym]||0));ser.forEach(v=>t+=v);if(t>0){aseKg[a]=Math.round(t);aseKgMons[a]=ser;}}
  // rentabilidad: valor/costo por kilo -> serie mensual por grupo y totales por asesor
  const hasRent=(K.valK!=null||K.costK!=null);
  const rentGrupoMon={};
  for(const g in rentGM){const gm=rentGM[g];rentGrupoMon[g]={rev:MONTHS.map(ym=>Math.round(gm.rev[ym]||0)),cost:MONTHS.map(ym=>Math.round(gm.cost[ym]||0)),kg:MONTHS.map(ym=>Math.round(gm.kg[ym]||0))};}
  const aseRev={},aseCost={};
  for(const a in aseRevM){let t=0;MONTHS.forEach(ym=>t+=aseRevM[a][ym]||0);if(t)aseRev[a]=Math.round(t);}
  for(const a in aseCostM){let t=0;MONTHS.forEach(ym=>t+=aseCostM[a][ym]||0);if(t)aseCost[a]=Math.round(t);}
  const DATA={months:MONTHS,cats,catalog,clients,ntop:Object.keys(clients).length,pct:100,volshare:100,metaAse,metaSede,metaGrupo,aseKg,aseKgMons,regionSedes:regSedeCount,hasRent,rentGrupoMon,aseRev,aseCost};
  return {DATA,INV,report:{clientes:Object.keys(clients).length,filas:rows.length,meses:MONTHS,cartera:nCart,inv:Object.keys(INV).length}};
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
    res.innerHTML='<span style="color:var(--txt2)">Procesando ventas y agregando por mes…</span>';
    const wb=XLSX.read(buf,{type:'array'});
    let full=rebuildRaw(wb);            // export crudo (tu formato)
    if(!full)full=rebuild(wb);          // plantilla multi-hoja
    if(full&&full.error){res.innerHTML=`<span class="warn">${full.error}</span>`;return;}
    if(full&&Object.keys(full.DATA.clients).length){
      const r=full.report;
      res.innerHTML='<span style="color:var(--txt2)">Guardando…</span>';
      lcSet('dataset',{data:full.DATA,inv:full.INV}).then(()=>lcDel('inv')).then(()=>{
        res.innerHTML=`<span class="ok">✓ Datos actualizados.</span><br>
          ${nfK.format(r.clientes)} clientes · ${nfK.format(r.filas||r.ventas||0)} filas · ${r.meses.length} meses (${r.meses.join(', ')})<br>
          ${nfK.format(r.cartera)} facturas en cartera · ${nfK.format(r.inv)} referencias de inventario<br>
          <span style="color:var(--txt3)">Recargando con tus datos…</span>`;
        setTimeout(()=>location.reload(),1600);
      }).catch(err=>{res.innerHTML=`<span class="warn">No se pudo guardar (${err.message}).</span> Es posible que el dataset sea muy grande para este navegador.`;});
      return;
    }
    // Fallback: solo inventario
    let matched=0,unmatched=0;const override={};const codes=new Set(Object.keys(CATALOG));
    wb.SheetNames.forEach(sn=>{
      const rows=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,blankrows:false});if(!rows.length)return;
      let hr=-1,ci=-1,ki=-1;
      for(let r=0;r<Math.min(8,rows.length);r++){const cells=rows[r].map(x=>(x+'').toLowerCase().trim());
        const c=cells.findIndex(h=>/(cod|refer|sku|item)/.test(h));const k=cells.findIndex(h=>/(stock|kg|kilo|existen|inventar)/.test(h));
        if(c>=0&&k>=0){hr=r;ci=c;ki=k;break;}}
      if(hr<0)return;
      for(let r=hr+1;r<rows.length;r++){const row=rows[r];if(!row)continue;const code=(row[ci]+'').trim();if(!code||code==='undefined')continue;
        const val=_num(row[ki]);override[code]={k:Math.round(val)};codes.has(code)?matched++:unmatched++;}});
    if(matched>0){
      lcSet('inv',override).then(()=>{res.innerHTML=`<span class="ok">✓ Inventario actualizado.</span><br>${nfK.format(matched)} referencias.<br><span style="color:var(--txt3)">Recargando…</span>`;setTimeout(()=>location.reload(),1200);});
    }else{
      res.innerHTML=`<span class="warn">No reconocí el archivo.</span><br>Sube tu export de ventas (con columnas <b>Codigo de Articulo</b>, <b>Fecha de Factura</b> y <b>Kilos</b>) o usa la plantilla.`;
    }
  }catch(err){res.innerHTML=`<span class="warn">Error al procesar:</span> ${err.message}`;}
}

function buildTemplate(){
  const wb=XLSX.utils.book_new();
  const inst=[['PLANTILLA DE ACTUALIZACIÓN · RUTA ESTRATÉGICA CLIENTES (REC)'],[''],
    ['Llena las hojas y cárgala con el botón "Cargar Excel". Reconstruye TODO el panel.'],[''],
    ['Clientes  : una fila por cliente con sus datos, asesor, plazo y cupos de crédito.'],
    ['Ventas    : una fila por cliente + código. Una columna por mes en formato AAAA-MM (ej. 2026-01) con KILOS.'],
    ['Cartera   : una fila por factura vencida (cliente, factura, días vencido, valor).'],
    ['Inventario: stock actual en KG por código.'],[''],
    ['IMPORTANTE: el nombre del cliente debe ser idéntico en todas las hojas.'],
    ['Los códigos de Ventas e Inventario deben coincidir.']];
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(inst),'Instrucciones');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
    ['cliente','nit','ciudad','departamento','asesor','plazo','cupo_credito','cupo_usado'],
    ['ACEROS DEMO S.A.S.','900123456-1','Bogotá','Cundinamarca','PALOQUEMAO - JUAN PEREZ','30 días',50000000,12000000],
    ['FERRETERÍA DEMO LTDA','900987654-2','Medellín','Antioquia','CENTRO - ANA GÓMEZ','Contado',0,0]]),'Clientes');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
    ['cliente','codigo','descripcion','grupo','2026-01','2026-02','2026-03','2026-04','2026-05'],
    ['ACEROS DEMO S.A.S.','HRO3.00UP6.00','LÁMINA HOT ROLLED 3.0','HOT ROLLED',1200,1500,900,2000,1700],
    ['ACEROS DEMO S.A.S.','TUB2X2','TUBERÍA ESTRUCTURAL 2X2','TUBERIA ESTRUCTURAL CUADRADO',400,520,610,500,700],
    ['FERRETERÍA DEMO LTDA','CAN3.00UP6.00','CANAL 3.0','CANAL',300,0,450,200,260]]),'Ventas');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
    ['cliente','factura','dias_vencido','valor'],
    ['ACEROS DEMO S.A.S.','F-10234',45,3200000],
    ['ACEROS DEMO S.A.S.','F-10301',95,1800000]]),'Cartera');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
    ['codigo','descripcion','grupo','stock_kg'],
    ['HRO3.00UP6.00','LÁMINA HOT ROLLED 3.0','HOT ROLLED',12500],
    ['TUB2X2','TUBERÍA ESTRUCTURAL 2X2','TUBERIA ESTRUCTURAL CUADRADO',3400],
    ['CAN3.00UP6.00','CANAL 3.0','CANAL',340]]),'Inventario');
  XLSX.writeFile(wb,'Plantilla_REC.xlsx');
}

// ===== boot =====
function monLabel(mk){const [y,m]=mk.split('-').map(Number);return MES0[(m||1)-1]+' '+y;}
function boot(){
  // subtítulo dinámico
  const sub=document.getElementById('pf_subt');
  if(sub){const rango=MONTHS.length?monLabel(MONTHS[0])+'–'+monLabel(MONTHS[MONTHS.length-1]):'';
    sub.textContent=`La Campana · ${rango} · ${nfK.format(Object.keys(CLI).length)} clientes · ${window.LC_DATA_IMPORTED?'datos importados':'datos demo'}`;}
  const ld=document.querySelector('#loading p');if(ld)ld.textContent=`Procesando ${nfK.format(Object.keys(CLI).length)} clientes…`;
  if(window.LC_DATA_IMPORTED){const fn=document.querySelector('#tab-pf .foot-note[style*="center"]');
    if(fn)fn.textContent='La Campana · Ruta Estratégica Clientes · Datos importados desde Excel · Proyección = promedio mensual × (1+CMGR)^k, topado a ±20%.';}
  bindFilters();bindExcel();render();
  const pb=document.getElementById('pf_printBtn');if(pb)pb.onclick=()=>window.print();
  const tvb=document.getElementById('pf_tvBtn'),tvx=document.getElementById('pf_tvExit');
  if(tvb&&tvx){const setTV=on=>{document.body.classList.toggle('tv',on);
      try{if(on&&document.documentElement.requestFullscreen)document.documentElement.requestFullscreen().catch(()=>{});
      else if(!on&&document.fullscreenElement)document.exitFullscreen();}catch(e){}};
    tvb.onclick=()=>setTV(true);tvx.onclick=()=>setTV(false);
    document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)document.body.classList.remove('tv');});}
  document.getElementById('loading').classList.add('hide');
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
};
