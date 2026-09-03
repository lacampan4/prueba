
window.LCBootDetail=function(){
const DATA=window.LC_DATA;
let INV=Object.assign({}, window.LC_INV||{});
const MONTHS=DATA.months, CATS=DATA.cats, CATALOG=DATA.catalog, CLI=DATA.clients;
const MES=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const nfK=new Intl.NumberFormat('es-CO',{maximumFractionDigits:0});
const nf1=new Intl.NumberFormat('es-CO',{minimumFractionDigits:1,maximumFractionDigits:1});
const nf2=new Intl.NumberFormat('es-CO',{minimumFractionDigits:2,maximumFractionDigits:2});
const cop=new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0});
const aName=c=>CATALOG[c]?CATALOG[c][0]:c, aGrp=c=>CATALOG[c]?CATS[CATALOG[c][1]]:'(s/g)';
const stockOf=c=>INV[c]?INV[c].k:0;
let capCMGR=20, current=null;

const order=Object.keys(CLI).sort((a,b)=>CLI[b].kg-CLI[a].kg);
const rankMap={}; order.forEach((c,i)=>rankMap[c]=i+1);
document.getElementById('emptySub').textContent=`${nfK.format(DATA.ntop)} clientes (top ${DATA.pct}% · ${DATA.volshare}% del volumen). Empieza a escribir para autocompletar.`;
const dl=document.getElementById('cliList');
dl.innerHTML=order.map(c=>`<option value="${c.replace(/"/g,'&quot;')}">`).join('');

function nextMonths(n){const out=[];let [y,m]=MONTHS[MONTHS.length-1].split('-').map(Number);
  for(let i=0;i<n;i++){m++;if(m>12){m=1;y++;}out.push(MES[m-1]);}return out;}
const PROJ=nextMonths(3);

function loglin(s){const xs=[],ys=[];s.forEach((v,i)=>{if(v>0){xs.push(i);ys.push(Math.log(v));}});
  if(xs.length<2)return null;const n=xs.length,sx=xs.reduce((a,b)=>a+b,0),sy=ys.reduce((a,b)=>a+b,0),
  sxx=xs.reduce((a,b)=>a+b*b,0),sxy=xs.reduce((a,b,i)=>a+b*ys[i],0),den=n*sxx-sx*sx;if(!den)return null;
  return Math.exp((n*sxy-sx*sy)/den)-1;}
function avgA(s){const v=s.filter(x=>x>0);return v.length?v.reduce((a,b)=>a+b,0)/v.length:0;}
function gAdj(cm){if(cm==null)return 0;const l=capCMGR/100;return Math.max(-l,Math.min(l,cm));}
function lastA(s){const v=s[s.length-1];return v>0?v:avgA(s);}
function isCap(cm){return cm!=null&&Math.abs(cm*100)>capCMGR;}

function build(cli){
  const c=CLI[cli];
  // Stock por cliente (importado): el del almacén donde ESTE cliente facturó.
  // Si no hay (datos demo), usa el inventario global.
  const stk = c.stk ? (cod=>c.stk[cod]||0) : stockOf;
  // Unifica variantes de código del mismo artículo (mismo nombre, p.ej. "...GR50" vs sin sufijo):
  // suma las compras del cliente y el stock de todos sus códigos en una sola fila.
  const byName={};
  c.a.forEach(([cod,s])=>{const nm=aName(cod);
    let g=byName[nm];
    if(!g){g=byName[nm]={cod,s:s.slice(),codes:[cod]};}
    else{g.s=g.s.map((v,i)=>v+(s[i]||0));g.codes.push(cod);
      if(stk(cod)>stk(g.cod))g.cod=cod;} // código representativo = el que tiene el stock
  });
  let arts=Object.values(byName).map(g=>{const total=g.s.reduce((a,b)=>a+b,0);
    const stock=g.codes.reduce((t,cd)=>t+stk(cd),0); // stock real total del artículo (todas sus variantes)
    return {cod:g.cod,codes:g.codes,s:g.s,total,avg:avgA(g.s),cmgr:loglin(g.s),grp:aGrp(g.cod),stock};});
  arts.sort((a,b)=>b.total-a.total);
  const tot=arts.reduce((a,r)=>a+r.total,0)||1;
  let cum=0; arts.forEach(r=>{r.part=r.total/tot*100;cum+=r.part;r.abc=cum<=80?'A':(cum<=95?'B':'C');});
  const gm={};
  arts.forEach(r=>{const g=gm[r.grp]=gm[r.grp]||{grp:r.grp,kg:0,s:MONTHS.map(_=>0),arts:[]};
    g.kg+=r.total;r.s.forEach((v,i)=>g.s[i]+=v);g.arts.push(r);});
  const groups=Object.values(gm).sort((a,b)=>b.kg-a.kg);
  groups.forEach(g=>{g.part=g.kg/tot*100;g.cmgr=loglin(g.s);g.avg=avgA(g.s);});
  return {c,arts,groups,tot};
}

function spark(s,proj,months){
  const all=proj?s.concat(proj):s;const max=Math.max(...all,1),w=90,ch=22,h=months?32:26,n=all.length,step=w/(n-1);
  const pts=s.map((v,i)=>`${(i*step).toFixed(1)},${(ch-2-(v/max)*(ch-4)).toFixed(1)}`).join(' ');
  let extra='';
  if(proj){const base=s.length-1;
    const ppts=[`${(base*step).toFixed(1)},${(ch-2-(s[s.length-1]/max)*(ch-4)).toFixed(1)}`]
      .concat(proj.map((v,i)=>`${((base+i+1)*step).toFixed(1)},${(ch-2-(v/max)*(ch-4)).toFixed(1)}`)).join(' ');
    extra=`<polyline points="${ppts}" fill="none" stroke="var(--amber2)" stroke-width="1.4" stroke-dasharray="3 2"/>`;}
  const last=s[s.length-1],first=s.find(v=>v>0)||0,col=last>=first?'var(--green)':'var(--red)';
  let lbl='';
  if(months&&months.length){
    lbl=`<text x="0" y="${h-2}" fill="var(--txt3)" font-size="7" font-family="IBM Plex Mono" text-anchor="start">${months[0]}</text>
      <text x="${w}" y="${h-2}" fill="var(--txt3)" font-size="7" font-family="IBM Plex Mono" text-anchor="end">${months[months.length-1]}</text>`;
  }
  return `<svg width="${w}" height="${h}" style="display:block"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round"/>${extra}${lbl}</svg>`;}

function cmgrCell(cm){if(cm==null)return '<span class="cmgr nd">N/D</span>';
  const v=cm*100,cls=isCap(cm)?'cap':(v>0?'pos':(v<0?'neg':'nd'));
  const tip=isCap(cm)?` title="real ${nf1.format(v)}% · tope ±${capCMGR}%"`:'';
  return `<span class="cmgr ${cls}"${tip}>${v>0?'▲':(v<0?'▼':'·')} ${nf1.format(Math.abs(v))}%</span>`;}

function creditCard(c){
  if(c.cc<=0) return `<div class="card"><h3>Crédito</h3>
     <div class="metric"><span class="k">Plazo</span><span class="v">${c.plazo}</span></div>
     <div style="margin-top:12px"><span class="pill cash">Cliente de contado · sin cupo asignado</span></div>
     <div class="foot-note">No tiene línea de crédito registrada en la matriz.</div></div>`;
  const disp=c.cc-c.cu, util=c.cu/c.cc*100;
  const pill=util>=90?'bad':(util>=70?'warn':'ok');
  return `<div class="card"><h3>Crédito</h3>
    <div class="metric"><span class="k">Cupo de crédito</span><span class="v">${cop.format(c.cc)}</span></div>
    <div class="metric"><span class="k">Cupo usado</span><span class="v">${cop.format(c.cu)}</span></div>
    <div class="metric"><span class="k">Disponible</span><span class="v" style="color:${disp<0?'var(--red)':'var(--green)'}">${cop.format(disp)}</span></div>
    <div class="util"><i class="${util>=70?'hi':''}" style="width:${Math.min(100,util)}%"></i></div>
    <div style="display:flex;justify-content:space-between;align-items:center"><span class="pill ${pill}">${nf1.format(util)}% utilizado</span><span class="k" style="font-size:11px;color:var(--txt3)">Plazo: ${c.plazo}</span></div></div>`;
}
function moraCard(c){
  const buckets=[[1,30,'1–30 d','b1'],[31,60,'31–60 d','b2'],[61,90,'61–90 d','b3'],[91,9999,'+90 d','b4']];
  const cnt=[0,0,0,0],val=[0,0,0,0];
  c.mora.forEach(([f,d,v])=>{const i=buckets.findIndex(b=>d>=b[0]&&d<=b[1]);if(i>=0){cnt[i]++;val[i]+=v;}});
  const totV=c.mora.reduce((a,m)=>a+m[2],0), maxD=c.mora.reduce((a,m)=>Math.max(a,m[1]),0);
  if(!c.mora.length) return `<div class="card"><h3>Cartera / Mora</h3>
     <div style="margin-top:6px"><span class="pill ok">Al día · sin facturas en mora</span></div>
     <div class="foot-note">No se registran facturas vencidas en el período.</div></div>`;
  const list=[...c.mora].sort((a,b)=>b[1]-a[1]).map(([f,d,v])=>
    `<div class="morarow"><span>Fact. ${f}</span><span class="d" style="color:${d>90?'var(--red)':(d>60?'var(--amber2)':'var(--gold)')}">${d} d</span><span>${cop.format(v)}</span></div>`).join('');
  return `<div class="card"><h3>Cartera / Mora</h3>
    <div class="scale">${buckets.map((b,i)=>`<div class="scbox ${b[3]}"><div class="n">${cnt[i]}</div><div class="r">${b[2]}</div></div>`).join('')}</div>
    <div class="metric"><span class="k">Total en mora</span><span class="v" style="color:var(--red)">${cop.format(totV)}</span></div>
    <div class="metric"><span class="k">Mora máxima</span><span class="v">${maxD} días</span></div>
    <div class="foot-note" style="margin:8px 0 4px">Facturas vencidas:</div>
    <div class="moralist">${list}</div></div>`;
}
function signalsCard(d){
  const {c,arts,groups,tot}=d; const sigs=[];
  const g0=groups[0]; sigs.push(['📊',`Concentra el <b>${nf1.format(g0.part)}%</b> de sus kilos en <b>${g0.grp}</b> (${groups.length} grupos en total).`]);
  const withCm=arts.filter(a=>a.cmgr!=null);
  const up=withCm.filter(a=>a.cmgr>0.02), dn=withCm.filter(a=>a.cmgr<-0.02);
  sigs.push(['📈',`<b>${up.length}</b> artículos en crecimiento y <b>${dn.length}</b> en caída (de ${withCm.length} con tendencia).`]);
  const topUp=[...up].sort((a,b)=>b.cmgr-a.cmgr)[0];
  if(topUp)sigs.push(['🚀',`Mayor crecimiento: <b>${aName(topUp.cod)}</b> (${nf1.format(topUp.cmgr*100)}%/mes).`]);
  const topDn=[...dn].sort((a,b)=>a.cmgr-b.cmgr)[0];
  if(topDn)sigs.push(['⚠️',`Mayor caída: <b>${aName(topDn.cod)}</b> (${nf1.format(topDn.cmgr*100)}%/mes) — riesgo de fuga.`]);
  // inventario riesgo (solo si hay datos de stock: columnas de bodega o Excel de inventario)
  const hasInv=arts.some(a=>a.stock>0);
  const proj1=arts.map(a=>({cod:a.cod, need:a.avg*Math.pow(1+gAdj(a.cmgr),1), stock:a.stock}));
  const quiebre=hasInv?proj1.filter(p=>p.need>0 && p.stock < p.need*0.5):[];
  if(quiebre.length){const w=[...quiebre].sort((a,b)=>(b.need-b.stock)-(a.need-a.stock))[0];
    sigs.push(['📦',`<b>${quiebre.length}</b> referencias con inventario por debajo del 50% de su próxima compra — riesgo de quiebre (p.ej. <b>${aName(w.cod)}</b>).`]);}
  if(c.cc>0){const u=c.cu/c.cc*100;if(u>=80)sigs.push(['🔴',`Cupo de crédito al <b>${nf1.format(u)}%</b> — revisar antes de despachar.`]);}
  if(c.mora.length){const totV=c.mora.reduce((a,m)=>a+m[2],0),maxD=c.mora.reduce((a,m)=>Math.max(a,m[1]),0);
    sigs.push(['💰',`Cartera vencida de <b>${cop.format(totV)}</b> a hasta <b>${maxD} días</b> — gestionar recaudo.`]);}
  return `<div class="card"><h3>Señales estratégicas</h3><div class="sigs">${sigs.map(s=>`<div class="sig"><span class="b">${s[0]}</span><span>${s[1]}</span></div>`).join('')}</div></div>`;
}

function covClass(months){if(months<=0.5)return 'q';if(months<1.2)return 'b';if(months<=4)return 'o';return 'x';}
function covLabel(months){if(months<=0.5)return 'Quiebre';if(months<1.2)return 'Bajo';if(months<=4)return 'OK';return 'Exceso';}
function inventoryPanel(d){
  const {arts}=d;
  const imported=!!window.LC_DATA_IMPORTED;
  const reg=d.c.reg;
  let regLabel='';
  if(imported&&reg){const nSed=(DATA.regionSedes&&DATA.regionSedes[reg])||0;
    regLabel=(reg==='Bogotá')?`zona Bogotá${nSed?` · ${nSed} sedes`:''}`:`sede ${reg}`;}
  // rows: only refs the client buys
  const rows=arts.map(a=>{
    const stock=a.stock;
    const need1=a.avg*Math.pow(1+gAdj(a.cmgr),1); // próxima compra estimada
    const cover=need1>0?stock/need1:(stock>0?99:0); // months of coverage vs next purchase
    return {...a, stock, need1, cover};
  });
  // risk sort: lowest coverage among those that buy
  const risk=[...rows].filter(r=>r.need1>0).sort((a,b)=>a.cover-b.cover);
  const quiebre=risk.filter(r=>r.cover<=0.5).length;
  const bajo=risk.filter(r=>r.cover>0.5&&r.cover<1.2).length;
  const okc=risk.filter(r=>r.cover>=1.2).length;
  const totStock=rows.reduce((s,r)=>s+r.stock,0);
  const totNeed=rows.reduce((s,r)=>s+r.need1,0);
  const body=risk.map(r=>{
    const cl=covClass(r.cover);
    const covTxt=r.cover>=99?'—':(r.cover<10?nf1.format(r.cover):nfK.format(r.cover))+'×';
    return `<tr>
      <td><span class="badge ${r.abc}">${r.abc}</span></td>
      <td>${aName(r.cod)} <span class="cod">· ${r.cod}</span></td>
      <td class="num">${nfK.format(r.stock)}</td>
      <td class="num">${nfK.format(r.need1)}</td>
      <td class="num">${covTxt}</td>
      <td><span class="cov ${cl}">${covLabel(r.cover)}</span></td>
    </tr>`;}).join('');
  return `<div class="panel"><div class="phead"><h2>Inventario de sus referencias · kg</h2>
      <span class="hint">${rows.length} referencias · stock${regLabel?' · '+regLabel:''} vs. próxima compra</span></div>
    <div class="pbody">
      <div class="invsum">
        <div class="invk"><div class="l">Stock total${regLabel?' ('+regLabel+')':' (sus refs)'}</div><div class="v">${nfK.format(totStock)} <span style="font-size:12px;color:var(--txt3)">kg</span></div></div>
        <div class="invk q"><div class="l">En quiebre (&lt;0,5× compra)</div><div class="v">${quiebre}</div></div>
        <div class="invk b"><div class="l">Stock bajo (&lt;1,2×)</div><div class="v">${bajo}</div></div>
        <div class="invk o"><div class="l">Con cobertura</div><div class="v">${okc}</div></div>
      </div>
      <div class="foot-note" style="margin:4px 0 10px">Cobertura = stock disponible ÷ próxima compra estimada del cliente (proyección mes ${PROJ[0]}). Ordenado por mayor riesgo de quiebre.</div>
      <div class="tscroll" style="max-height:340px"><table><thead><tr>
        <th>ABC</th><th>Referencia</th><th class="num">Stock kg</th><th class="num">Compra est. ${PROJ[0]}</th><th class="num">Cobertura</th><th>Estado</th>
      </tr></thead><tbody>${body}</tbody></table></div>
      ${imported
        ? `<div class="foot-note">Stock disponible según la ubicación del cliente: ${reg==='Bogotá'?'suma de las sedes de la zona Bogotá (cercanas, se resurten entre sí)':`solo la sede ${reg} (lejana, inventario aislado)`}.</div>`
        : `<div class="foot-note">⚠ Inventario en modo demostración (generado, estable por referencia). Carga el Excel de stock real desde el Panorama para reemplazarlo.</div>`}
    </div></div>`;
}

function render(cli){
  const d=build(cli); const {c,arts,groups,tot}=d;
  current=cli;
  document.getElementById('cliInput').value=cli;
  document.getElementById('empty').style.display='none';
  const rep=document.getElementById('report'); rep.style.display='block';
  const monthlyTot=MONTHS.map((_,i)=>arts.reduce((s,a)=>s+a.s[i],0));
  const lastTot=monthlyTot[monthlyTot.length-1]||avgA(monthlyTot);
  const cmgrTot=gAdj(loglin(monthlyTot));
  const projTot=[1,2,3].map(k=>lastTot*Math.pow(1+cmgrTot,k));

  let rows='';
  groups.forEach(g=>{
    rows+=`<tr class="grp-row"><td colspan="3">${g.grp}</td>
      <td class="num">${nfK.format(g.kg)}</td><td class="num">${nf1.format(g.part)}%</td>
      <td class="num">${cmgrCell(g.cmgr)}</td>
      <td class="num m1">${nfK.format(lastA(g.s)*Math.pow(1+gAdj(g.cmgr),1))}</td>
      <td class="num m2">${nfK.format(lastA(g.s)*Math.pow(1+gAdj(g.cmgr),2))}</td>
      <td class="num m3">${nfK.format(lastA(g.s)*Math.pow(1+gAdj(g.cmgr),3))}</td>
      <td>${spark(g.s,null,MES.slice(0,MONTHS.length))}</td></tr>`;
    g.arts.forEach(a=>{
      rows+=`<tr><td><span class="badge ${a.abc}">${a.abc}</span></td>
        <td colspan="2" class="art">${aName(a.cod)} <span class="cod">· ${a.cod}</span></td>
        <td class="num">${nfK.format(a.total)}</td>
        <td class="num" style="color:var(--txt3)">${nf2.format(a.part)}%</td>
        <td class="num">${cmgrCell(a.cmgr)}</td>
        <td class="num m1">${nfK.format(lastA(a.s)*Math.pow(1+gAdj(a.cmgr),1))}</td>
        <td class="num m2">${nfK.format(lastA(a.s)*Math.pow(1+gAdj(a.cmgr),2))}</td>
        <td class="num m3">${nfK.format(lastA(a.s)*Math.pow(1+gAdj(a.cmgr),3))}</td>
        <td>${spark(a.s,[1,2,3].map(k=>lastA(a.s)*Math.pow(1+gAdj(a.cmgr),k)),MES.slice(0,MONTHS.length))}</td></tr>`;
    });
  });

  rep.innerHTML=`
   <div class="cli-head">
     <div><div class="nm">${cli}</div>
       <div class="det"><span>NIT <b>${c.nit}</b></span><span>${c.ciu}${c.dep?', '+c.dep:''}</span>
         <span>Asesor: <b>${c.ase}</b></span><span>Plazo: <b>${c.plazo}</b></span></div></div>
     <div class="rank"><div class="v" style="font-size:20px">#${rankMap[cli]}</div><div class="l">Ranking por volumen</div>
       <div style="margin-top:8px;font-family:'IBM Plex Mono';font-size:15px;color:var(--txt);font-weight:700">${nfK.format(c.kg)} kg <span style="color:var(--txt3)">(${MES[0]}–${MES[MONTHS.length-1]})</span></div></div>
   </div>
   <div class="cards3">${creditCard(c)}${moraCard(c)}${signalsCard(d)}</div>

   <div class="panel"><div class="phead"><h2>Tendencia de compra · total cliente</h2>
     <div class="legendm"><span><span class="dot" style="background:var(--steel)"></span>Real ${MES[0]}–${MES[MONTHS.length-1]}</span><span><span class="dot" style="background:var(--amber2)"></span>Proyección ${PROJ.join(' · ')}</span></div></div>
     <div class="pbody">${bigTrend(monthlyTot,projTot)}</div></div>


   <div class="panel"><div class="phead"><h2>Grupos que compra</h2><span class="hint">${groups.length} grupos · ${nfK.format(tot)} kg</span></div>
     <div class="pbody">${groupBars(groups,tot)}</div></div>

   <div class="panel tablepanel"><div class="phead"><h2>Artículos por grupo · CMGR y proyección a 3 meses</h2><span class="hint">${arts.length} artículos · kilos</span></div>
     <div class="tscroll"><table><thead><tr>
       <th>ABC</th><th colspan="2">Artículo / Grupo</th><th class="num">Kg total</th><th class="num">Part.</th>
       <th class="num">CMGR/mes</th><th class="num cm1">${PROJ[0]}</th><th class="num cm2">${PROJ[1]}</th><th class="num cm3">${PROJ[2]}</th><th>Tendencia</th>
     </tr></thead><tbody>${rows}</tbody></table></div>
     <div class="pbody"><div class="foot-note">Proyección = último mes con compra × (1+CMGR)^k. CMGR topado a ±${capCMGR}% (ajustable). Cifras en kilos.</div></div></div>

   <div class="panel promopanel"><div class="phead"><h2>Productos que comercializamos</h2><span class="hint">${CATS.length} grupos · portafolio La Campana</span></div>
     <div class="pbody"><div style="display:flex;flex-wrap:wrap;gap:8px">${CATS.filter(g=>!['OTROS','Articulos','Artículos','ALAMBRE','SOLDADURA','PUNTILLAS','BASCULA','TEJA ALUZINC','TABLERO','FIGURADO','CORTE','ARRIENDO','TEJA DE ZINC','CHIPA','CONOS','RETAL','TEJA POLICARBONATO','ALUZINC','CERRADURA','MASILLAS','PUERTAS','CINTA HOT ROLLED','PERLIN EN C COLD ROLLED'].includes(g)).sort((a,b)=>a.localeCompare(b,'es')).map(g=>`<span class="pill" style="background:var(--panel2);border:1px solid var(--line2);color:var(--txt2)">${g}</span>`).join('')}</div></div></div>`;
  document.getElementById('pdfBtn').disabled=false;
  const _adz=document.getElementById('adzone');if(_adz)_adz.style.display='block';
  window.scrollTo(0,0);
}

function bigTrend(real,proj){
  const all=real.concat(proj),max=Math.max(...all,1),W=820,H=160,pad=30,n=all.length,step=(W-pad*2)/n,bw=step*0.6;
  const labels=MES.slice(0,real.length).concat(PROJ);
  let bars='';
  all.forEach((v,i)=>{const h=(v/max)*(H-pad-22),x=pad+i*step+step*0.2,y=H-pad-h,pj=i>=real.length;
    bars+=`<rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="2" fill="${pj?'var(--amber2)':'var(--steel)'}" ${pj?'opacity="0.55"':''}/>
      <text x="${x+bw/2}" y="${H-pad+13}" fill="var(--txt3)" font-size="9.5" text-anchor="middle" font-family="IBM Plex Mono">${labels[i]}</text>
      <text x="${x+bw/2}" y="${y-4}" fill="${pj?'var(--amber2)':'var(--txt2)'}" font-size="8" text-anchor="middle" font-family="IBM Plex Mono">${nfK.format(v)}</text>`;});
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto"><line x1="${pad}" y1="${H-pad}" x2="${W-pad}" y2="${H-pad}" stroke="var(--line2)"/>${bars}</svg>`;
}
function groupBars(groups,tot){
  const max=groups[0].kg||1;
  const head=`<div style="display:flex;align-items:center;gap:12px;padding:0 0 8px;border-bottom:1px solid var(--line)">
      <div style="width:230px;font-family:'Oswald';font-weight:500;font-size:10.5px;letter-spacing:.5px;text-transform:uppercase;color:var(--txt2)">Grupo</div>
      <div style="flex:1;font-family:'Oswald';font-weight:500;font-size:10.5px;letter-spacing:.5px;text-transform:uppercase;color:var(--txt2)">Volumen</div>
      <div style="width:90px;font-family:'Oswald';font-weight:500;font-size:10.5px;letter-spacing:.5px;text-transform:uppercase;color:var(--txt2);text-align:right">Kg</div>
      <div style="width:54px;font-family:'Oswald';font-weight:500;font-size:10.5px;letter-spacing:.5px;text-transform:uppercase;color:var(--txt2);text-align:right">Part.</div>
      <div style="width:96px;font-family:'Oswald';font-weight:500;font-size:10.5px;letter-spacing:.5px;text-transform:uppercase;color:var(--txt2)">CMGR/mes</div>
      <div style="width:90px;font-family:'Oswald';font-weight:500;font-size:10.5px;letter-spacing:.5px;text-transform:uppercase;color:var(--txt2)">Tendencia</div></div>`;
  return head+groups.map(g=>{
    return `<div style="display:flex;align-items:center;gap:12px;padding:6px 0;border-bottom:1px solid var(--bg2)">
      <div style="width:230px;font-size:12.5px;line-height:1.2">${g.grp}</div>
      <div style="flex:1;height:14px;background:var(--bg);border-radius:4px;overflow:hidden"><i style="display:block;height:100%;width:${g.kg/max*100}%;background:linear-gradient(90deg,var(--amber),var(--amber2))"></i></div>
      <div class="num" style="width:90px;font-size:12px">${nfK.format(g.kg)}</div>
      <div class="num" style="width:54px;font-size:12px;color:var(--amber2)">${nf1.format(g.part)}%</div>
      <div style="width:96px">${cmgrCell(g.cmgr)}</div>
      <div style="width:90px">${spark(g.s,null,MES.slice(0,MONTHS.length))}</div></div>`;}).join('');
}

document.getElementById('cliInput').addEventListener('change',e=>{const v=e.target.value.trim();if(CLI[v])render(v);});
document.getElementById('cliInput').addEventListener('input',e=>{const v=e.target.value.trim();if(CLI[v])render(v);});
document.getElementById('fCap').onclick=e=>{const c=e.target.closest('.c');if(!c)return;capCMGR=+c.dataset.cap;
  document.querySelectorAll('#fCap .c').forEach(x=>x.classList.toggle('on',x===c));if(current)render(current);};
document.getElementById('pdfBtn').onclick=()=>{if(!current)return;
  const prev=document.title;document.title='Hoja de Ruta - '+current.replace(/[\\/:*?"<>|]+/g,' ').trim();
  window.print();setTimeout(()=>document.title=prev,500);};

// abrir cliente desde URL (?cliente=NOMBRE)
const qp=new URLSearchParams(location.search).get('cliente');
if(qp && CLI[qp]) render(qp);
(function(){const gm=document.getElementById('guideModal');if(!gm)return;
  document.getElementById('guideBtn').onclick=()=>gm.classList.add('show');
  document.getElementById('guideClose').onclick=()=>gm.classList.remove('show');
  gm.onclick=e=>{if(e.target===gm)gm.classList.remove('show');};})();
};
/* Carga el dataset importado desde IndexedDB (si existe) y arranca */
(async function(){
  try{
    const ds=await lcGet('dataset');
    if(ds&&ds.data){window.LC_DATA=ds.data;window.LC_INV=ds.inv||{};window.LC_DATA_IMPORTED=true;}
    const iv=await lcGet('inv');if(iv)window.LC_INV=Object.assign({},window.LC_INV||{},iv);
  }catch(e){console.warn('LC load',e);}
  window.LCBootDetail();
})();



(function(){
  var b=document.getElementById('backMenuBtn');
  if(b) b.addEventListener('click', function(){ window.location.href='menu.html'; });
})();


(function(){const modal=document.getElementById('lcExcelModal'),btn=document.getElementById('excelBtn'),drop=document.getElementById('lcExcelDrop'),inp=document.getElementById('lcExcelInput'),res=document.getElementById('lcExcelResult');if(!modal)return;document.getElementById('lcExcelTitle').textContent='Actualizar hoja del cliente desde Excel';document.getElementById('lcExcelDesc').textContent='Carga el Excel comercial utilizado por este módulo para actualizar la información del cliente.';function open(){modal.style.display='flex';}function close(){modal.style.display='none';}if(btn)btn.addEventListener('click',open);document.getElementById('lcExcelClose').addEventListener('click',close);modal.addEventListener('click',e=>{if(e.target===modal)close();});drop.addEventListener('click',()=>inp.click());drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('over');});drop.addEventListener('dragleave',()=>drop.classList.remove('over'));drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('over');if(e.dataTransfer.files[0])handle(e.dataTransfer.files[0]);});inp.addEventListener('change',()=>{if(inp.files[0])handle(inp.files[0]);});function handle(file){res.innerHTML='✓ Archivo seleccionado: <b>'+file.name.replace(/[<>]/g,'')+'</b><br>Listo para procesar en este módulo.';}})();