/* Hoja de Sede · lógica de cálculo y render · La Campana */
(function(){
'use strict';
const nf0=new Intl.NumberFormat('es-CO',{maximumFractionDigits:0});
const nf1=new Intl.NumberFormat('es-CO',{maximumFractionDigits:1,minimumFractionDigits:0});
const kg=x=>nf0.format(Math.round(x));

const DEF_CFG={metodo:'dias',minDias:15,maxDias:30,minPct:50,maxPct:120,meses:6,prioridad:[]};
let SD=null,CFG=null,cur=null,sortKey='sug',sortDir=-1,q='';
let CALC=null; // {rows:{sede:[row]}, tot:{sede:{...}}, planta:[...], kpi:{...}}

function loadCfg(){
  try{CFG=Object.assign({},DEF_CFG,JSON.parse(localStorage.getItem('lc_sede_cfg')||'{}'));}
  catch(e){CFG=Object.assign({},DEF_CFG);}
}
function saveCfg(){try{localStorage.setItem('lc_sede_cfg',JSON.stringify(CFG));}catch(e){}}

function syncPrioridad(){
  const set=new Set(SD.sedes);
  CFG.prioridad=CFG.prioridad.filter(s=>set.has(s));
  SD.sedes.forEach(s=>{if(!CFG.prioridad.includes(s))CFG.prioridad.push(s);});
}

// ===== cálculo =====
function compute(){
  const n=Math.max(1,Math.min(CFG.meses,SD.months.length));
  const i0=SD.months.length-n;
  const rows={},tot={};
  const codes=Object.keys(SD.arts);
  // filas por sede
  CFG.prioridad.forEach(sede=>{
    const list=[];
    codes.forEach(cod=>{
      const serie=(SD.v[sede]||{})[cod];
      let sk=0,su=0;
      if(serie)for(let i=i0;i<SD.months.length;i++){sk+=serie[i]?serie[i].k:0;su+=serie[i]?serie[i].u:0;}
      const promK=sk/n,promU=su/n;
      const s25=SD.stock25[cod]||{k:0,u:0};
      const kpu=su>0?sk/su:(s25.kpu||(s25.u>0?s25.k/s25.u:0));
      let mn,mx;
      if(CFG.metodo==='dias'){mn=promK*CFG.minDias/30;mx=promK*CFG.maxDias/30;}
      else{mn=promK*CFG.minPct/100;mx=promK*CFG.maxPct/100;}
      const stkO=(SD.stockSede[sede]||{})[cod]||{k:0,u:0};
      const stk=stkO.k||0;
      let sug=0;
      if(promK>0&&stk<mn)sug=Math.max(0,mx-stk);
      const sugU=kpu>0?Math.ceil(sug/kpu):0;
      if(promK<=0&&stk<=0&&sug<=0)return; // sin actividad
      list.push({cod,d:SD.arts[cod].d,c:SD.arts[cod].c,promK,promU,kpu,mn,mx,stk,sug,sugU,asig:0,asigU:0,estado:''});
    });
    rows[sede]=list;
  });
  // asignación por prioridad
  const avail={};codes.forEach(c=>{avail[c]=(SD.stock25[c]||{}).k||0;});
  CFG.prioridad.forEach(sede=>{
    rows[sede].forEach(r=>{
      if(r.sug>0){
        r.asig=Math.min(r.sug,Math.max(0,avail[r.cod]));
        avail[r.cod]-=r.asig;
        r.asigU=r.kpu>0?Math.floor(r.asig/r.kpu):0;
      }
      r.estado=r.sug<=0?(r.promK>0&&r.stk>r.mx&&r.mx>0?'EXCESO':'OK')
        :(r.asig>=r.sug-0.5?'COMPLETO':(r.asig>0.5?'PARCIAL':'SIN STOCK'));
    });
    const t={sug:0,asig:0,arts:0,falt:0};
    rows[sede].forEach(r=>{if(r.sug>0){t.sug+=r.sug;t.asig+=r.asig;t.arts++;if(r.estado!=='COMPLETO')t.falt++;}});
    tot[sede]=t;
  });
  // consolidado planta
  const planta=[];
  codes.forEach(cod=>{
    let need=0,asig=0;const porSede=[];
    CFG.prioridad.forEach(sede=>{const r=rows[sede].find(x=>x.cod===cod);
      if(r&&r.sug>0){need+=r.sug;asig+=r.asig;porSede.push({sede,sug:r.sug,asig:r.asig});}});
    const disp=(SD.stock25[cod]||{}).k||0;
    if(need>0&&asig<need-0.5)planta.push({cod,d:SD.arts[cod].d,need,disp,asig,falt:need-asig,porSede});
  });
  planta.sort((a,b)=>b.falt-a.falt);
  const kpi={sug:0,asig:0,arts:0,sinStock:0};
  CFG.prioridad.forEach(s=>{kpi.sug+=tot[s].sug;kpi.asig+=tot[s].asig;kpi.arts+=tot[s].arts;});
  kpi.sinStock=planta.filter(p=>p.asig<=0.5).length;
  CALC={rows,tot,planta,kpi,n,i0};
}

// ===== render =====
function renderParams(){
  const dias=CFG.metodo==='dias';
  const pr=CFG.prioridad.map((s,i)=>`<span class="pchip"><span class="rank">${i+1}</span>${s}
    <button title="Subir prioridad" onclick="sdMove(${i},-1)">▲</button><button title="Bajar prioridad" onclick="sdMove(${i},1)">▼</button></span>`).join('');
  document.getElementById('params').innerHTML=`
    <div class="pgroup"><label>Método mín / máx</label>
      <div class="seg">
        <button class="${dias?'on':''}" onclick="sdMetodo('dias')">Días de cobertura</button>
        <button class="${dias?'':'on'}" onclick="sdMetodo('pct')">% venta mensual</button>
      </div></div>
    <div class="pgroup"><label>${dias?'Cobertura (días de venta)':'Porcentaje de la venta mensual'}</label>
      <div class="numrow">Mín <input type="number" min="1" value="${dias?CFG.minDias:CFG.minPct}" onchange="sdNum('min',this.value)">
      Máx <input type="number" min="1" value="${dias?CFG.maxDias:CFG.maxPct}" onchange="sdNum('max',this.value)"> ${dias?'días':'%'}</div></div>
    <div class="pgroup"><label>Meses de historia</label>
      <select onchange="sdMeses(this.value)">${[1,2,3,4,5,6,9,12].map(m=>`<option value="${m}" ${m===CFG.meses?'selected':''}>${m} ${m===1?'mes':'meses'}</option>`).join('')}</select></div>
    <div class="pgroup" style="flex:1;min-width:280px"><label>Prioridad de sedes (reparto del stock del alm. 25)</label>
      <div class="prio">${pr}</div></div>
    <div class="pgroup"><div class="phint">El mínimo dispara el pedido y el máximo define hasta dónde surtir. Se recalculan solos con la venta promedio de los últimos ${CFG.meses} meses.</div></div>`;
}
window.sdMetodo=function(m){CFG.metodo=m;saveCfg();refresh();};
window.sdNum=function(w,v){v=Math.max(1,parseFloat(v)||1);
  if(CFG.metodo==='dias'){if(w==='min')CFG.minDias=v;else CFG.maxDias=v;if(CFG.minDias>CFG.maxDias)CFG.maxDias=CFG.minDias;}
  else{if(w==='min')CFG.minPct=v;else CFG.maxPct=v;if(CFG.minPct>CFG.maxPct)CFG.maxPct=CFG.minPct;}
  saveCfg();refresh();};
window.sdMeses=function(v){CFG.meses=parseInt(v,10)||6;saveCfg();refresh();};
window.sdMove=function(i,d){const j=i+d;if(j<0||j>=CFG.prioridad.length)return;
  const a=CFG.prioridad;[a[i],a[j]]=[a[j],a[i]];saveCfg();refresh();};

function renderKpis(){
  const k=CALC.kpi;
  const cob=k.sug>0?k.asig/k.sug*100:100;
  const cobCol=cob>=98?'var(--green)':(cob>=80?'var(--amber)':'var(--red)');
  const per=CFG.metodo==='dias'?`mín ${CFG.minDias}d · máx ${CFG.maxDias}d`:`mín ${CFG.minPct}% · máx ${CFG.maxPct}%`;
  document.getElementById('kpis').innerHTML=`
    <div class="kpi"><div class="accent"></div><div class="l">Kg a despachar (todas las sedes)</div>
      <div class="v">${kg(k.sug)} <small>kg</small></div><div class="d">${k.arts} líneas con necesidad</div></div>
    <div class="kpi"><div class="accent" style="background:${cobCol}"></div><div class="l">Cobertura del almacén 25</div>
      <div class="v" style="color:${cobCol}">${nf1.format(cob)}<small>%</small></div><div class="d">${kg(k.asig)} kg asignados</div></div>
    <div class="kpi"><div class="accent" style="background:var(--steel)"></div><div class="l">Faltante en planta</div>
      <div class="v">${kg(k.sug-k.asig)} <small>kg</small></div><div class="d">${CALC.planta.length} artículos cortos · ${k.sinStock} sin stock</div></div>
    <div class="kpi"><div class="accent" style="background:var(--steel)"></div><div class="l">Parámetros vigentes</div>
      <div class="v" style="font-size:20px;line-height:1.25;margin-top:11px">${per}</div>
      <div class="d">promedio ${CALC.n} meses (${SD.months[CALC.i0]} → ${SD.months[SD.months.length-1]})</div></div>`;
}

function renderTabs(){
  document.getElementById('sedetabs').innerHTML=CFG.prioridad.map((s,i)=>{
    const t=CALC.tot[s];
    return `<div class="stab ${s===cur?'on':''}" onclick="sdSede('${s.replace(/'/g,"\\'")}')">
      <div class="sn"><span class="rk">${i+1}</span>${s}</div>
      <div class="sv"><b>${kg(t.sug)} kg</b> · ${t.arts} art.${t.falt?` · <span style="color:var(--red)">${t.falt} cortos</span>`:''}</div></div>`;}).join('');
}
window.sdSede=function(s){cur=s;renderTabs();renderTable();};

const COLS=[
  {k:'art',l:'Artículo',tl:1},{k:'promK',l:'Venta prom kg/mes'},{k:'mn',l:'Mín kg'},{k:'mx',l:'Máx kg'},
  {k:'stk',l:'Stock sede kg'},{k:'rng',l:'Nivel vs mín·máx',sort:0},{k:'sug',l:'Surtir kg'},{k:'sugU',l:'Surtir un'},
  {k:'asig',l:'Asignado kg'},{k:'estado',l:'Estado'}];
window.sdSort=function(k){if(sortKey===k)sortDir*=-1;else{sortKey=k;sortDir=k==='art'?1:-1;}renderTable();};

function renderTable(){
  const list=(CALC.rows[cur]||[]).filter(r=>{
    if(!q)return true;const s=(r.cod+' '+r.d+' '+r.c).toLowerCase();return s.includes(q);});
  list.sort((a,b)=>{
    if(sortKey==='art')return sortDir*a.d.localeCompare(b.d,'es');
    if(sortKey==='estado'){const o={'SIN STOCK':0,'PARCIAL':1,'COMPLETO':2,'EXCESO':3,'OK':4};return sortDir*((o[b.estado]||0)-(o[a.estado]||0));}
    return sortDir*((a[sortKey]||0)-(b[sortKey]||0));});
  const head='<thead><tr>'+COLS.map(c=>c.sort===0?`<th style="cursor:default">${c.l}</th>`
    :`<th class="${c.tl?'tl ':''}${sortKey===c.k?'on':''}" onclick="sdSort('${c.k}')">${c.l}${sortKey===c.k?(sortDir<0?' ▾':' ▴'):''}</th>`).join('')+'</tr></thead>';
  const pill=e=>({OK:'<span class="pill ok">OK</span>',EXCESO:'<span class="pill exc">EXCESO</span>',
    COMPLETO:'<span class="pill full">COMPLETO</span>',PARCIAL:'<span class="pill warn">PARCIAL</span>',
    'SIN STOCK':'<span class="pill bad">SIN STOCK</span>'}[e]||'<span class="pill mut">—</span>');
  const body='<tbody>'+list.map(r=>{
    const w=r.mx>0?Math.min(100,r.stk/r.mx*100):0;
    const mkMin=r.mx>0?Math.min(100,r.mn/r.mx*100):0;
    return `<tr>
      <td class="tl"><div class="art"><div class="ds">${r.d}</div><div class="cd">${r.cod} · ${r.c}</div></div></td>
      <td>${kg(r.promK)}</td><td>${kg(r.mn)}</td><td>${kg(r.mx)}</td><td>${kg(r.stk)}</td>
      <td><span class="rng"><i style="width:${w.toFixed(1)}%"></i><span class="mk" style="left:${mkMin.toFixed(1)}%"></span><span class="mk2" style="left:calc(100% - 2px)"></span></span></td>
      <td class="sug">${r.sug>0?`<b>${kg(r.sug)}</b>`:'—'}</td>
      <td>${r.sug>0&&r.sugU>0?nf0.format(r.sugU):'—'}</td>
      <td>${r.sug>0?kg(r.asig):'—'}</td>
      <td>${pill(r.estado)}</td></tr>`;}).join('')+'</tbody>';
  document.getElementById('tbl').innerHTML=head+body;
  const t=CALC.tot[cur];
  document.getElementById('tblTitle').textContent=`Surtido sugerido · ${cur}`;
  document.getElementById('tblHint').textContent=`${list.length} artículos · pedir ${kg(t.sug)} kg a planta`;
  document.getElementById('tblFoot').textContent=`Barra: stock actual de la sede frente al máximo (marca roja = mínimo). «Surtir» = máximo − stock cuando el stock cae bajo el mínimo. «Asignado» = lo que el almacén 25 puede cubrir según prioridad.`;
  document.getElementById('printSub').textContent=`Sede: ${cur} · ${new Date().toLocaleDateString('es-CO',{day:'2-digit',month:'long',year:'numeric'})} · promedio ${CALC.n} meses · ${CFG.metodo==='dias'?`cobertura ${CFG.minDias}–${CFG.maxDias} días`:`${CFG.minPct}–${CFG.maxPct}% venta mensual`}`;
}

function renderPlanta(){
  const p=CALC.planta;
  document.getElementById('plHint').textContent=p.length?`${p.length} artículos no se cubren por completo`:'El almacén 25 cubre toda la necesidad ✓';
  if(!p.length){document.getElementById('plTbl').innerHTML='';return;}
  const head='<thead><tr><th class="tl">Artículo</th><th>Necesidad total kg</th><th>Disponible alm. 25 kg</th><th>Asignado kg</th><th>Faltante kg</th><th class="tl">Sedes afectadas</th></tr></thead>';
  const body='<tbody>'+p.map(r=>{
    const af=r.porSede.filter(x=>x.asig<x.sug-0.5).map(x=>x.sede).join(', ');
    return `<tr><td class="tl"><div class="art"><div class="ds">${r.d}</div><div class="cd">${r.cod}</div></div></td>
      <td>${kg(r.need)}</td><td>${kg(r.disp)}</td><td>${kg(r.asig)}</td>
      <td style="color:var(--red);font-weight:600">${kg(r.falt)}</td>
      <td class="tl" style="font-size:11px;color:var(--txt2)">${af}</td></tr>`;}).join('')+'</tbody>';
  document.getElementById('plTbl').innerHTML=head+body;
}

function refresh(){syncPrioridad();compute();if(!cur||!SD.sedes.includes(cur))cur=CFG.prioridad[0];
  renderParams();renderKpis();renderTabs();renderTable();renderPlanta();
  document.getElementById('demobar').style.display=SD.demo?'flex':'none';}
window.sdRefresh=refresh;
window.sdSetData=function(ds){SD=ds;window.SD=ds;cur=null;refresh();};

// ===== impresión =====
window.printSede=function(){document.body.classList.remove('print-guia');window.print();};
window.openGuia=function(){document.getElementById('guiaOverlay').classList.add('open');};
window.closeGuia=function(){document.getElementById('guiaOverlay').classList.remove('open');document.body.classList.remove('print-guia');};
window.printGuia=function(){document.body.classList.add('print-guia');window.print();setTimeout(()=>document.body.classList.remove('print-guia'),400);};

document.getElementById('q').addEventListener('input',e=>{q=e.target.value.trim().toLowerCase();renderTable();});

// ===== arranque =====
loadCfg();
function boot(ds){SD=ds;window.SD=ds;refresh();}
if(window.lcGet){window.lcGet('sede_dataset').then(ds=>boot(ds||window.SEDE_DEMO)).catch(()=>boot(window.SEDE_DEMO));}
else boot(window.SEDE_DEMO);
})();
