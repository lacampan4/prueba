
const DATA = window.LC_NOGALES;
const MONTHS = DATA.months;
const MES0=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const MES = MONTHS.map(m=>MES0[(+m.split('-')[1])-1]);
const nfK = new Intl.NumberFormat('es-CO',{maximumFractionDigits:0});
const BASE_PREFIXES=['LAF','LAC','GAL','LAL','PLA','LAD','TRM','TCM','TEM','TAN','TGC','TCH','PEH','EPH'];
const PRIMERA_ONLY_PREFIXES=['TRM','TCM','TEM','TAN','TGC','TCH','PEH','EPH'];
const NEW_PREFIXES=['CBMR','CBRB','CBRR','CBVR','ANC','CAA','CAM','CAN','CAV','CPP','CTR','CUA','ANT','CABG','CAR','CEM','CTA','CTM','CTV','CUBG','CUC','CUM','CUR','CUV','EPGV','EPHC','FAC','FACG','FAE','FAEG','FCC','FCE','FCEG','FCG','FCM','FCR','FCRG','FML','HEA','IPE','MES','MPA','MPC','MPCE','MVA','MVC','PEG','PLA','PLC','PMN','PTA','PTJ','PTN','PZC','RAC','RAF','RAG','RAP','RGA','RPL','TCO','TEC','TEE','TEO','TER','TEZ','TEZA','TGD','TGE','TOM','TVA','TVC','VAC','VAE','VAGR','VAL','VACD'];
const PREFIXES=[...new Set([...BASE_PREFIXES,...NEW_PREFIXES])];
const PREFIXES_LONGEST=[...PREFIXES].sort((a,b)=>b.length-a.length);
const DYNAMIC_PREFIXES=[...new Set([...PRIMERA_ONLY_PREFIXES,...NEW_PREFIXES])];
function matchPrefix(cod){cod=(cod||'').toUpperCase();return PREFIXES_LONGEST.find(p=>cod.startsWith(p))||'';}
function qualityOK(cod,desc){const pre=matchPrefix(cod);if(PRIMERA_ONLY_PREFIXES.includes(pre))return /PRIMERA/i.test(desc||'');return !/segunda/i.test(desc||'');}

let arts=[], groups=[], maxAvg=1, sortCol=null, sortDir=-1;
const fGrp=document.getElementById('fGrp'), fPre=document.getElementById('fPre'), fQ=document.getElementById('fQ'), fRec=document.getElementById('fRec');

function rebuild(){
  arts = Object.entries(DATA.articles).filter(([cod,a])=>!/segunda/i.test(a.d)).map(([cod,a])=>{
    const n = a.m.length;
    const avg = a.m.reduce((x,y)=>x+y,0)/n;
    const top3 = [...a.m].sort((x,y)=>y-x).slice(0,3);
    const top3avg = top3.reduce((x,y)=>x+y,0)/top3.length;
    const pre = matchPrefix(cod);
    const recurrente = a.m.length>0 && a.m.every(v=>v>0);
    return {cod,desc:a.d,grp:a.g,pre,m:a.m,avg,top3avg,recurrente,total:a.m.reduce((x,y)=>x+y,0)};
  });
  groups = [...new Set(arts.map(a=>a.grp))].sort((a,b)=>{
    const ta = arts.filter(x=>x.grp===a).reduce((s,x)=>s+x.total,0);
    const tb = arts.filter(x=>x.grp===b).reduce((s,x)=>s+x.total,0);
    return tb-ta;
  });
  fGrp.innerHTML = '<option value="">Todos</option>';
  [...groups].sort((a,b)=>a.localeCompare(b)).forEach(g=>{const o=document.createElement('option');o.value=g;o.textContent=g;fGrp.appendChild(o);});
  document.getElementById('rango').textContent = `${MES[0]}–${MES[MES.length-1]} ${MONTHS[0].split('-')[0]} · ${arts.length} referencias · ${PREFIXES.length} prefijos${MONTHS.length>4?' · ⇆ desliza la tabla para ver todos los meses':''}`;
  maxAvg = Math.max(...arts.map(a=>a.avg));
}

[...PREFIXES].sort((a,b)=>a.localeCompare(b)).forEach(p=>{const o=document.createElement('option');o.value=p;o.textContent=p;fPre.appendChild(o);});
rebuild();
render();

/* Si hay un Excel importado en LABOR COMERCIAL o una sincronización de SAP
   (IndexedDB), la página muestra ÚNICAMENTE esos datos: se descarta por
   completo el archivo estático empaquetado (meses y referencias) y se
   reconstruye todo (meses, grupos y referencias) a partir de lo cargado,
   igual que hace "Exportar datos". No se conserva ningún histórico previo:
   si el rango cargado no incluye un mes o una referencia, simplemente no
   aparece en la tabla. */
(async function loadLiveData(){
  try{
    if(typeof lcGet!=='function') return;
    const ds = await lcGet('dataset');
    if(!ds || !ds.data || !ds.data.catalog || !ds.data.clients) return;
    const live = ds.data;
    const liveMonths = (live.months||[]).slice().sort();
    if(!liveMonths.length) return;

    // Reemplaza por completo las columnas de mes con las del dataset cargado.
    MONTHS.length = 0;
    liveMonths.forEach(ym=>MONTHS.push(ym));
    MES.length = 0;
    MONTHS.forEach(m=>MES.push(MES0[(+m.split('-')[1])-1]));

    const idxMap = liveMonths.map(ym=>MONTHS.indexOf(ym));
    // Igual que exportData(): los prefijos dinámicos exigen calidad PRIMERA;
    // el resto (incluidos los prefijos base) entra sin ese filtro.
    const wanted = Object.entries(live.catalog).filter(([cod,v])=>DYNAMIC_PREFIXES.some(p=>cod.startsWith(p)) ? qualityOK(cod,v[0]) : true);
    const sums = {};
    wanted.forEach(([cod])=>sums[cod]=MONTHS.map(_=>0));
    for(const name in live.clients){
      const cl = live.clients[name];
      if(!cl.a) continue;
      for(const [cod,arr] of cl.a){
        if(!sums[cod]) continue;
        arr.forEach((v,i)=>{const j=idxMap[i]; if(j>=0) sums[cod][j]+=(v||0);});
      }
    }
    // Se descarta todo lo estático y se deja solo lo que trae la carga actual.
    Object.keys(DATA.articles).forEach(k=>delete DATA.articles[k]);
    wanted.forEach(([cod,v])=>{
      if(!sums[cod].some(x=>x>0)) return; // sin movimiento en el rango cargado: no se muestra
      DATA.articles[cod] = {d:v[0], g:live.cats[v[1]]||v[1], m:sums[cod]};
    });
    rebuild();
    render();
  }catch(e){ console.warn('Nogales: no se pudo cargar dataset en vivo', e); }
})();

function syncStickyCols(){
  const wrap = document.querySelector('.tblwrap');
  const c1 = document.querySelector('thead th:first-child');
  if(!wrap||!c1) return;
  wrap.style.setProperty('--stcol1', c1.getBoundingClientRect().width+'px');
}
window.addEventListener('resize', ()=>{ clearTimeout(window.__stcolT); window.__stcolT=setTimeout(syncStickyCols,150); });
function render(){
  const q=(fQ.value||'').toLowerCase().trim();
  const g=fGrp.value, p=fPre.value, rec=fRec.value;
  const filtered = arts.filter(a=>(!g||a.grp===g)&&(!p||a.pre===p)&&(!rec||a.recurrente)&&(!q||a.cod.toLowerCase().includes(q)||a.desc.toLowerCase().includes(q)));
  document.getElementById('fcount').innerHTML = `<b>${nfK.format(filtered.length)}</b> de ${arts.length} referencias`;

  const thead=document.getElementById('thead');
  const cols=['Código','Descripción',...MES,'Promedio','Prom. Top 3'];
  thead.innerHTML = cols.map((c,i)=>`<th data-col="${i}"${i===sortCol?' class="on"':''}>${c}${(i===0||i>=2)&&i===sortCol?(sortDir<0?' ↓':' ↑'):''}</th>`).join('');
  thead.querySelectorAll('th[data-col]').forEach(th=>{
    const i=+th.dataset.col; if(i===1) return;
    th.onclick=()=>{ if(sortCol===i){sortDir=-sortDir;}else{sortCol=i;sortDir=(i===0?1:-1);} render(); };
  });
  function sortVal(a,i){ if(i<MES.length+2) return a.m[i-2]; if(i===MES.length+2) return a.avg; return a.top3avg; }

  const byGrp={};
  filtered.forEach(a=>{(byGrp[a.grp]=byGrp[a.grp]||[]).push(a);});
  const ordGroups = groups.filter(g=>byGrp[g]);

  const tbody=document.getElementById('tbody');
  let html='';
  ordGroups.forEach(g=>{
    const list = byGrp[g].slice().sort((a,b)=>{
      if(sortCol==null) return a.cod.localeCompare(b.cod);
      if(sortCol===0) return a.cod.localeCompare(b.cod)*sortDir;
      return (sortVal(b,sortCol)-sortVal(a,sortCol))*(-sortDir);
    });
    const gTotal = list.reduce((s,x)=>s+x.total,0);
    const gAvg = list.reduce((s,x)=>s+x.avg,0);
    const gTop3 = list.reduce((s,x)=>s+x.top3avg,0);
    const gMonthly = MONTHS.map((_,i)=>list.reduce((s,x)=>s+x.m[i],0));
    html += `<tr class="grow"><td colspan="${2+MONTHS.length+2}">${g}<span>${list.length} referencias · ${nfK.format(gTotal)} kg totales</span></td></tr>`;
    list.forEach(a=>{
      const pct = maxAvg? (a.avg/maxAvg*100):0;
      html += `<tr>
        <td>${a.cod}<span class="pillpre">${a.pre}</span></td>
        <td title="${a.desc}">${a.desc}</td>
        ${a.m.map(v=>`<td>${nfK.format(v)}</td>`).join('')}
        <td class="hi"><span class="bar"><i style="width:${pct}%"></i></span>${nfK.format(a.avg)}</td>
        <td class="hi">${nfK.format(a.top3avg)}</td>
      </tr>`;
    });
    html += `<tr class="gtot">
      <td>SUBTOTAL ${g}</td><td></td>
      ${gMonthly.map(v=>`<td>${nfK.format(v)}</td>`).join('')}
      <td>${nfK.format(gAvg)}</td>
      <td>${nfK.format(gTop3)}</td>
    </tr>`;
  });
  tbody.innerHTML = html;
  syncStickyCols();

  // KPIs
  const totalKg = filtered.reduce((s,x)=>s+x.total,0);
  const totalAvg = filtered.reduce((s,x)=>s+x.avg,0);
  const totalTop3 = filtered.reduce((s,x)=>s+x.top3avg,0);
  const topArt = [...filtered].sort((a,b)=>b.avg-a.avg)[0];
  const topGrpName = ordGroups[0]||'—';
  document.getElementById('kpis').innerHTML = `
    <div class="kpi"><div class="accent"></div><div class="l">Total kg (7 meses)</div><div class="v">${nfK.format(totalKg)}<small> kg</small></div><div class="d">${filtered.length} referencias</div></div>
    <div class="kpi"><div class="accent"></div><div class="l">Promedio mensual</div><div class="v">${nfK.format(totalAvg)}<small> kg/mes</small></div><div class="d">Suma de promedios por referencia</div></div>
    <div class="kpi"><div class="accent"></div><div class="l">Promedio top 3 meses</div><div class="v">${nfK.format(totalTop3)}<small> kg/mes</small></div><div class="d">Meses de mayor venta por referencia</div></div>
    <div class="kpi"><div class="accent"></div><div class="l">Referencia líder</div><div class="v" style="font-size:16px">${topArt?topArt.cod:'—'}</div><div class="d">${topArt?nfK.format(topArt.avg)+' kg/mes prom.':''}</div></div>
    <div class="kpi"><div class="accent"></div><div class="l">Grupo con más volumen</div><div class="v" style="font-size:16px">${topGrpName}</div><div class="d">${groups.length} grupos en total</div></div>
  `;
}
/* Exporta nogales_data.js horneando los meses del Excel importado (IndexedDB).
   Mantiene los grupos NO dinámicos del archivo estático y recalcula los dinámicos
   desde los datos reales, para que el tablero funcione sin importación. */
async function exportData(){
  const btn=document.getElementById('exportBtn');
  const old=btn.textContent;
  try{
    if(typeof lcGet!=='function') throw new Error('Almacén no disponible');
    const ds=await lcGet('dataset');
    if(!ds||!ds.data||!ds.data.catalog||!ds.data.clients){
      alert('No hay un Excel importado en LABOR COMERCIAL. Importa el archivo del mes y vuelve a intentar.');
      return;
    }
    btn.textContent='Generando…'; btn.disabled=true;
    const live=ds.data;
    const liveMonths=live.months||[];
    const out={months:liveMonths.slice(), articles:{}};
    // TODOS los grupos (dinámicos y no dinámicos) se recalculan desde el Excel.
    // Los grupos dinámicos mantienen su regla de solo material PRIMERA.
    const wanted=Object.entries(live.catalog).filter(([cod,v])=>{
      return DYNAMIC_PREFIXES.some(p=>cod.startsWith(p)) ? qualityOK(cod,v[0]) : true;
    });
    const sums={};
    wanted.forEach(([cod])=>sums[cod]=liveMonths.map(_=>0));
    for(const name in live.clients){
      const cl=live.clients[name]; if(!cl.a) continue;
      for(const [cod,arr] of cl.a){ if(!sums[cod]) continue; arr.forEach((v,i)=>{ if(i<liveMonths.length) sums[cod][i]+=(v||0); }); }
    }
    wanted.forEach(([cod,v])=>{ if(sums[cod].some(x=>x>0)) out.articles[cod]={d:v[0],g:live.cats[v[1]]||v[1],m:sums[cod]}; });
    const content='window.LC_NOGALES='+JSON.stringify(out)+';';
    const blob=new Blob([content],{type:'application/javascript'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download='nogales_data.js';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
    const mesFin=MES0[(+liveMonths[liveMonths.length-1].split('-')[1])-1];
    btn.textContent='✓ '+liveMonths.length+' meses';
    setTimeout(()=>{btn.textContent=old;btn.disabled=false;},2600);
  }catch(e){
    console.error(e); alert('No se pudo exportar: '+e.message);
    btn.textContent=old; btn.disabled=false;
  }
}
document.getElementById('exportBtn').onclick=exportData;

[fGrp,fPre,fQ,fRec].forEach(el=>el.addEventListener('input',render));
document.getElementById('clrBtn').onclick=()=>{fGrp.value='';fPre.value='';fQ.value='';fRec.value='';render();};
document.getElementById('printBtn').onclick=()=>window.print();
render();



(function(){
  var b=document.getElementById('backMenuBtn');
  if(b) b.addEventListener('click', function(){ window.location.href='menu.html'; });
})();


(function(){const modal=document.getElementById('lcExcelModal'),btn=document.getElementById('excelBtn'),drop=document.getElementById('lcExcelDrop'),inp=document.getElementById('lcExcelInput'),res=document.getElementById('lcExcelResult');if(!modal)return;document.getElementById('lcExcelTitle').textContent='Actualizar planeación desde Excel';document.getElementById('lcExcelDesc').textContent='Carga el Excel de ventas utilizado por este módulo para actualizar la planeación.';function open(){modal.style.display='flex';}function close(){modal.style.display='none';}if(btn)btn.addEventListener('click',open);document.getElementById('lcExcelClose').addEventListener('click',close);modal.addEventListener('click',e=>{if(e.target===modal)close();});drop.addEventListener('click',()=>inp.click());drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('over');});drop.addEventListener('dragleave',()=>drop.classList.remove('over'));drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('over');if(e.dataTransfer.files[0])handle(e.dataTransfer.files[0]);});inp.addEventListener('change',()=>{if(inp.files[0])handle(inp.files[0]);});function handle(file){res.innerHTML='✓ Archivo seleccionado: <b>'+file.name.replace(/[<>]/g,'')+'</b><br>Listo para procesar en este módulo.';}})();