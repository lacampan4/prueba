/* Costos de Producción · La Campana · lógica del dashboard + editor mensual */
(function(){
  const LS='lc_costos_v1';
  const COMPS=[
    ['sueldos','Sueldos','#E10600'],
    ['arriendo','Arriendo','#14161a'],
    ['maqEquipo','Maq. y Equipo','#4a5058'],
    ['energiaElectrica','Energía Eléctrica','#6b7176'],
    ['depreciacion','Depreciación','#8a9098'],
    ['administracion','Administración','#a7adb4'],
    ['otros','Otros','#c2c7cd'],
    ['gas','Gas','#dadfe3']
  ];
  const FIELDS=['producto','nMaq','operarios','m2','capacidad','kilos','arriendo','administracion','energiaElectrica','gas','otros','maqEquipo','sueldos','depreciacion'];

  // ---------- store ----------
  function clone(o){return JSON.parse(JSON.stringify(o));}
  function load(){
    try{const raw=localStorage.getItem(LS);if(raw){const d=JSON.parse(raw);if(d&&d.months&&d.months.length)return d;}}catch(e){}
    return clone(window.COSTOS_SEED);
  }
  function save(){try{localStorage.setItem(LS,JSON.stringify(STATE.data));}catch(e){alert('No se pudo guardar: '+e);}}

  // ---------- compute ----------
  function lineTotal(l){return COMPS.reduce((s,[k])=>s+(+l[k]||0),0);}
  function lineCostoKg(l){const t=lineTotal(l),k=+l.kilos||0;return k>0?t/k:0;}
  function monthAgg(m){
    const a={total:0,kilos:0,capacidad:0,operarios:0,m2:0,nMaq:0,comp:{}};
    COMPS.forEach(([k])=>a.comp[k]=0);
    m.lines.forEach(l=>{a.total+=lineTotal(l);a.kilos+=(+l.kilos||0);a.capacidad+=(+l.capacidad||0);a.operarios+=(+l.operarios||0);a.m2+=(+l.m2||0);a.nMaq+=(+l.nMaq||0);COMPS.forEach(([k])=>a.comp[k]+=(+l[k]||0));});
    a.costoKg=a.kilos>0?a.total/a.kilos:0;
    return a;
  }

  // ---------- format (es-CO) ----------
  const nf0=new Intl.NumberFormat('es-CO',{maximumFractionDigits:0});
  const nf2=new Intl.NumberFormat('es-CO',{minimumFractionDigits:2,maximumFractionDigits:2});
  const money=n=>'$'+nf0.format(Math.round(+n||0));
  const moneyM=n=>{n=+n||0;if(Math.abs(n)>=1e6)return '$'+nf2.format(n/1e6)+' M';return money(n);};
  const kg=n=>nf0.format(Math.round(+n||0));
  const ckg=n=>'$'+nf2.format(+n||0);
  const pct=n=>nf0.format(Math.round(+n||0))+'%';

  // ---------- state ----------
  const STATE={data:load(),monthKey:null,cmpKey:null,editing:false,work:null};
  function months(){return STATE.data.months;}
  function curMonth(){return STATE.editing?STATE.work:months().find(m=>m.key===STATE.monthKey);}
  function cmpMonth(){return months().find(m=>m.key===STATE.cmpKey)||null;}

  // ---------- render ----------
  function el(id){return document.getElementById(id);}
  function h(tag,cls,html){const e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;return e;}

  function renderControls(){
    const ms=months();
    // month select
    const sel=el('cMonth');sel.innerHTML=ms.map(m=>`<option value="${m.key}"${m.key===STATE.monthKey?' selected':''}>${m.label}</option>`).join('');
    // compare select
    const csel=el('cCmp');csel.innerHTML='<option value="">— sin comparar —</option>'+ms.filter(m=>m.key!==STATE.monthKey).map(m=>`<option value="${m.key}"${m.key===STATE.cmpKey?' selected':''}>${m.label}</option>`).join('');
    // buttons visibility
    el('btnEdit').style.display=STATE.editing?'none':'';
    el('btnNew').style.display=STATE.editing?'none':'';
    el('btnSave').style.display=STATE.editing?'':'none';
    el('btnCancel').style.display=STATE.editing?'':'none';
    el('cMonth').disabled=STATE.editing;el('cCmp').disabled=STATE.editing;
    el('editHint').style.display=STATE.editing?'':'none';
  }

  function renderSub(){
    const m=curMonth();const a=monthAgg(m);
    el('subt').textContent='La Campana · '+m.label+' · '+kg(a.kilos)+' kg producidos · costo promedio '+ckg(a.costoKg)+'/kg';
  }

  function delta(cur,prev){ // returns {txt,cls} for a cost metric (up=bad)
    if(prev==null||!isFinite(prev)||prev===0)return null;
    const d=(cur-prev)/prev*100;
    const arrow=d>0?'▲':(d<0?'▼':'–');
    const cls=d>0.05?'neg':(d<-0.05?'pos':'');
    return {txt:arrow+' '+nf2.format(Math.abs(d))+'%',cls,val:d};
  }

  function renderKPIs(){
    const m=curMonth(),a=monthAgg(m);
    const cm=cmpMonth();const ca=cm?monthAgg(cm):null;
    const box=el('kpis');box.innerHTML='';
    function kpi(label,val,sub,opts){opts=opts||{};
      const d=h('div','kpi'+(opts.risk?' risk':''));
      d.innerHTML=`<div class="accent"></div><div class="l">${label}</div><div class="v">${val}</div>`+(sub?`<div class="d">${sub}</div>`:'')+(opts.bar!=null?`<div class="mbar"><i class="${opts.bar>85?'hi':''}" style="width:${Math.min(100,opts.bar)}%"></i></div>`:'');
      box.appendChild(d);
    }
    // costo total
    let sub='';if(ca){const dl=delta(a.total,ca.total);if(dl)sub=`<span class="${dl.cls}">${dl.txt}</span> vs ${cm.label}`;}
    kpi('Costo total del mes',moneyM(a.total),sub);
    // kilos
    sub='';if(ca){const dl=delta(a.kilos,ca.kilos);if(dl){const inv=dl.val>0?'pos':(dl.val<0?'neg':'');sub=`<span class="${inv}">${dl.txt}</span> vs ${cm.label}`;}}
    kpi('Kilos producidos',kg(a.kilos)+' <small>kg</small>',sub);
    // costo promedio /kg
    sub='';let risk=false;if(ca){const dl=delta(a.costoKg,ca.costoKg);if(dl){sub=`<span class="${dl.cls}">${dl.txt}</span> vs ${cm.label}`;risk=dl.val>0;}}
    kpi('Costo promedio /kg',ckg(a.costoKg),sub,{risk});
    // utilizacion capacidad
    const util=a.capacidad>0?a.kilos/a.capacidad*100:0;
    kpi('Utilización de capacidad',pct(util),kg(a.kilos)+' de '+kg(a.capacidad)+' kg',{bar:util});
    // operarios
    kpi('Operarios en planta',nf0.format(a.operarios),a.nMaq+' máquinas · '+kg(a.m2)+' m²');
    // mayor rubro
    let top=null;COMPS.forEach(([k,lab])=>{if(top==null||a.comp[k]>top.v)top={k,lab,v:a.comp[k]};});
    kpi('Mayor rubro de costo',top.lab,moneyM(top.v)+' · '+pct(top.v/a.total*100)+' del total');
  }

  function renderCostoKg(){
    const m=curMonth();const cm=cmpMonth();
    const rows=m.lines.map(l=>({l,ckg:lineCostoKg(l)})).filter(x=>x.ckg>0).sort((a,b)=>b.ckg-a.ckg);
    const max=Math.max(...rows.map(x=>x.ckg),1);
    const box=el('ckgBox');box.innerHTML='';
    const head=h('div','bhead');head.innerHTML='<div class="nm">Línea de producción</div><div class="bar">Costo por kilo</div><div class="nv">$ / kg</div>'+(cm?'<div class="cm">vs '+cm.label.split(' ')[0]+'</div>':'');
    box.appendChild(head);
    rows.forEach(({l,ckg:c})=>{
      const r=h('div','barrow');
      let cmCell='';
      if(cm){const pl=cm.lines.find(x=>x.producto===l.producto);const pc=pl?lineCostoKg(pl):null;const dl=pc?delta(c,pc):null;cmCell=`<div class="cm cmgr ${dl?dl.cls:'nd'}">${dl?dl.txt:'—'}</div>`;}
      r.innerHTML=`<div class="nm" title="${l.producto}">${l.producto}</div><div class="bar"><i style="width:${c/max*100}%"></i></div><div class="nv">${ckg(c)}</div>`+cmCell;
      box.appendChild(r);
    });
    el('ckgHint').textContent=rows.length+' líneas con producción';
  }

  function renderEstructura(){
    const m=curMonth(),a=monthAgg(m);
    const parts=COMPS.map(([k,lab,col])=>({k,lab,col,v:a.comp[k]})).filter(p=>p.v>0).sort((a,b)=>b.v-a.v);
    const tot=parts.reduce((s,p)=>s+p.v,0)||1;
    // donut
    const R=52,C=2*Math.PI*R;let off=0;
    const segs=parts.map(p=>{const frac=p.v/tot;const seg=`<circle cx="70" cy="70" r="${R}" fill="none" stroke="${p.col}" stroke-width="24" stroke-dasharray="${(frac*C).toFixed(2)} ${(C-frac*C).toFixed(2)}" stroke-dashoffset="${(-off*C).toFixed(2)}" transform="rotate(-90 70 70)"></circle>`;off+=frac;return seg;}).join('');
    const leg=parts.map(p=>`<div class="li"><span class="sw" style="background:${p.col}"></span><span style="flex:1">${p.lab}</span><b>${moneyM(p.v)}</b><span style="color:var(--txt3);width:44px;text-align:right">${pct(p.v/tot*100)}</span></div>`).join('');
    el('estrBox').innerHTML=`<div class="donut-wrap"><svg width="140" height="140" viewBox="0 0 140 140" style="flex:none"><circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--bg2)" stroke-width="24"></circle>${segs}<text x="70" y="64" text-anchor="middle" font-family="Oswald" font-weight="600" font-size="16" fill="var(--txt)">${moneyM(tot).replace('$','')}</text><text x="70" y="82" text-anchor="middle" font-family="IBM Plex Mono" font-size="9" fill="var(--txt3)">COSTO TOTAL</text></svg><div class="donut-leg" style="flex:1;min-width:220px">${leg}</div></div>`;
  }

  function renderDrivers(){
    const m=curMonth();const d=m.drivers||{};
    const rows=[
      ['administracion','Administración','$ / m²','m²'],
      ['energia','Energía Eléctrica','$ / KW','KW'],
      ['acueducto','Acueducto y Alcant.','$ / m³','m³'],
      ['sueldos','Sueldos','$ / operario','oper.']
    ];
    const box=el('drvBox');
    let html='<div class="drv-head"><div>Rubro base</div><div>Valor total</div><div>Consumo</div><div>Costo unitario</div></div>';
    rows.forEach(([k,lab,uni,cu])=>{
      const r=d[k]||{valor:0,consumo:0};const frac=r.consumo>0?r.valor/r.consumo:0;
      if(STATE.editing){
        html+=`<div class="drv-row"><div class="drv-l">${lab}</div><div><input class="cin" type="number" data-dk="${k}" data-df="valor" value="${r.valor}"></div><div><input class="cin" type="number" data-dk="${k}" data-df="consumo" value="${r.consumo}"> <span class="drv-u">${cu}</span></div><div class="drv-frac" data-dfr="${k}">${money(frac)}</div></div>`;
      }else{
        html+=`<div class="drv-row"><div class="drv-l">${lab}</div><div class="drv-v">${money(r.valor)}</div><div class="drv-v">${nf0.format(r.consumo)} ${cu}</div><div class="drv-frac">${money(frac)} <span class="drv-u">${uni}</span></div></div>`;
      }
    });
    box.innerHTML=html;
  }

  function renderCap(){
    const m=curMonth();
    const rows=m.lines.filter(l=>(+l.capacidad||0)>0).map(l=>({l,u:(+l.kilos||0)/(+l.capacidad||1)*100})).sort((a,b)=>b.u-a.u);
    const box=el('capBox');box.innerHTML='';
    const head=h('div','cap-head');head.innerHTML='<div>Línea</div><div>Uso de capacidad</div><div class="capn">Producido</div><div class="capn">Capacidad</div><div class="capn">Uso</div>';box.appendChild(head);
    rows.forEach(({l,u})=>{
      const r=h('div','cap-row');
      const col=u>=85?'var(--green)':(u>=45?'var(--gold)':'var(--red)');
      r.innerHTML=`<div class="cap-l" title="${l.producto}">${l.producto}</div><div class="cap-track"><i style="width:${Math.min(100,u)}%;background:${col}"></i></div><div class="capn">${kg(l.kilos)}</div><div class="capn">${kg(l.capacidad)}</div><div class="capn" style="color:${col};font-weight:600">${pct(u)}</div>`;
      box.appendChild(r);
    });
    const m2=monthAgg(m);el('capHint').textContent='Utilización global '+pct(m2.capacidad>0?m2.kilos/m2.capacidad*100:0);
  }

  function renderCmp(){
    const panel=el('cmpPanel');const cm=cmpMonth();const m=curMonth();
    if(!cm){panel.style.display='none';return;}
    panel.style.display='';
    const rows=m.lines.map(l=>{const pl=cm.lines.find(x=>x.producto===l.producto);const c=lineCostoKg(l);const p=pl?lineCostoKg(pl):null;const d=(p&&p>0)?(c-p)/p*100:null;return {nm:l.producto,c,p,d};}).filter(x=>x.c>0||x.p>0);
    const up=rows.filter(r=>r.d!=null&&r.d>0.5).sort((a,b)=>b.d-a.d);
    const dn=rows.filter(r=>r.d!=null&&r.d<-0.5).sort((a,b)=>a.d-b.d);
    function list(arr){return `<div class="ghead"><div>Línea</div><div style="display:flex;gap:16px"><span style="width:70px;text-align:right">${cm.label.split(' ')[0]}</span><span style="width:70px;text-align:right">${m.label.split(' ')[0]}</span><span style="width:60px;text-align:right">Δ</span></div></div>`+arr.map(r=>`<div class="grow"><div class="gn" title="${r.nm}">${r.nm}</div><div style="display:flex;gap:16px;font-family:'IBM Plex Mono'"><span style="width:70px;text-align:right;color:var(--txt3)">${ckg(r.p)}</span><span style="width:70px;text-align:right">${ckg(r.c)}</span><span class="cmgr ${r.d>0?'neg':'pos'}" style="width:60px;text-align:right">${(r.d>0?'+':'')+nf0.format(r.d)}%</span></div></div>`).join('')||'<div class="grow" style="color:var(--txt3)">Sin cambios relevantes</div>';}
    el('cmpBox').innerHTML=`<div class="gcols"><div class="glist"><h4><span class="dot" style="background:var(--red)"></span>Líneas que encarecen</h4>${list(up)}</div><div class="glist"><h4><span class="dot" style="background:var(--green)"></span>Líneas que abaratan</h4>${list(dn)}</div></div>`;
    const am=monthAgg(m),ac=monthAgg(cm);const dd=ac.costoKg>0?(am.costoKg-ac.costoKg)/ac.costoKg*100:0;
    el('cmpHint').innerHTML=`costo promedio ${ckg(ac.costoKg)} → ${ckg(am.costoKg)} · <b style="color:${dd>0?'var(--red)':'var(--green)'}">${(dd>0?'+':'')+nf0.format(dd)}%</b>`;
  }

  function renderDetail(){
    const m=curMonth();const box=el('detBox');
    const cols=[['producto','Línea','txt'],['nMaq','#Máq','n'],['operarios','Oper.','n'],['m2','m²','n'],['capacidad','Capacidad','n'],['kilos','Kilos','n'],['arriendo','Arriendo','n'],['administracion','Admin.','n'],['energiaElectrica','Energía','n'],['gas','Gas','n'],['otros','Otros','n'],['maqEquipo','Maq.&Eq.','n'],['sueldos','Sueldos','n'],['depreciacion','Deprec.','n']];
    let html='<table id="detTable"><thead><tr>';
    if(STATE.editing)html+='<th class="no"></th>';
    cols.forEach(([k,lab,t])=>html+=`<th class="${t==='txt'?'':'num'}">${lab}</th>`);
    html+='<th class="num">Total</th><th class="num">$ / kg</th></tr></thead><tbody>';
    m.lines.forEach((l,i)=>{
      html+='<tr data-li="'+i+'">';
      if(STATE.editing)html+=`<td><button class="delrow" data-del="${i}" title="Eliminar línea">×</button></td>`;
      cols.forEach(([k,lab,t])=>{
        if(STATE.editing){
          if(t==='txt')html+=`<td><input class="cin cin-txt" type="text" data-li="${i}" data-f="${k}" value="${(l[k]||'').replace(/"/g,'&quot;')}"></td>`;
          else html+=`<td class="num"><input class="cin cin-num" type="number" data-li="${i}" data-f="${k}" value="${l[k]||0}"></td>`;
        }else{
          if(t==='txt')html+=`<td class="cname" title="${l.producto}">${l.producto}</td>`;
          else html+=`<td class="num">${['nMaq','operarios','m2','capacidad','kilos'].includes(k)?nf0.format(+l[k]||0):money(l[k])}</td>`;
        }
      });
      html+=`<td class="num tot" data-tot="${i}">${money(lineTotal(l))}</td><td class="num ckgc" data-ckg="${i}">${ckg(lineCostoKg(l))}</td>`;
      html+='</tr>';
    });
    // totals row
    const a=monthAgg(m);
    html+='<tr class="totrow">';if(STATE.editing)html+='<td></td>';
    html+='<td>TOTAL</td>';
    cols.slice(1).forEach(([k])=>{
      if(k==='nMaq'||k==='operarios'||k==='m2'||k==='capacidad'||k==='kilos')html+=`<td class="num">${nf0.format(a[k==='m2'?'m2':k==='nMaq'?'nMaq':k==='operarios'?'operarios':k==='capacidad'?'capacidad':'kilos'])}</td>`;
      else html+=`<td class="num" data-ttl="${k}">${money(a.comp[k])}</td>`;
    });
    html+=`<td class="num" id="grandTot">${money(a.total)}</td><td class="num" id="grandCkg">${ckg(a.costoKg)}</td>`;
    html+='</tr></tbody></table>';
    if(STATE.editing)html+='<div style="padding:12px 4px 2px"><button class="btn ghost" id="addRow" style="font-size:12px;padding:8px 14px">+ Agregar línea</button></div>';
    box.innerHTML=html;
  }

  function recalcEdit(){ // live recompute in edit mode
    const m=STATE.work;const a=monthAgg(m);
    m.lines.forEach((l,i)=>{const tt=document.querySelector(`[data-tot="${i}"]`);if(tt)tt.textContent=money(lineTotal(l));const ck=document.querySelector(`[data-ckg="${i}"]`);if(ck)ck.textContent=ckg(lineCostoKg(l));});
    COMPS.forEach(([k])=>{const c=document.querySelector(`[data-ttl="${k}"]`);if(c)c.textContent=money(a.comp[k]);});
    const gt=el('grandTot');if(gt)gt.textContent=money(a.total);
    const gc=el('grandCkg');if(gc)gc.textContent=ckg(a.costoKg);
    // drivers frac
    document.querySelectorAll('[data-dfr]').forEach(node=>{const k=node.dataset.dfr;const r=(m.drivers||{})[k]||{valor:0,consumo:0};node.textContent=money(r.consumo>0?r.valor/r.consumo:0);});
  }

  function renderAll(){
    renderControls();renderSub();renderKPIs();renderCostoKg();renderEstructura();renderDrivers();renderCap();renderCmp();renderDetail();
  }

  // ---------- edit actions ----------
  function startEdit(){STATE.editing=true;STATE.work=clone(months().find(m=>m.key===STATE.monthKey));renderAll();}
  function cancelEdit(){STATE.editing=false;STATE.work=null;renderAll();}
  function commitEdit(){const idx=STATE.data.months.findIndex(m=>m.key===STATE.monthKey);if(idx>=0)STATE.data.months[idx]=STATE.work;STATE.editing=false;STATE.work=null;save();renderAll();flash('Mes guardado');}
  function newMonth(){
    const label=prompt('Nombre del nuevo mes (p. ej. "Julio 2026"):');if(!label)return;
    let key=prompt('Clave de orden (AAAA-MM, p. ej. 2026-07):',guessKey(label));if(!key)return;key=key.trim();
    if(months().some(m=>m.key===key)){alert('Ya existe un mes con esa clave.');return;}
    const base=months().find(m=>m.key===STATE.monthKey)||months()[months().length-1];
    const nm=clone(base);nm.key=key;nm.label=label.trim();
    STATE.data.months.push(nm);STATE.data.months.sort((a,b)=>a.key<b.key?-1:1);
    STATE.monthKey=key;save();
    STATE.editing=true;STATE.work=clone(nm);renderAll();
    flash('Mes creado — ajusta los valores y guarda');
  }
  function guessKey(label){const map={enero:'01',febrero:'02',marzo:'03',abril:'04',mayo:'05',junio:'06',julio:'07',agosto:'08',septiembre:'09',octubre:'10',noviembre:'11',diciembre:'12'};const l=label.toLowerCase();let mo='';for(const k in map)if(l.includes(k))mo=map[k];const y=(l.match(/(20\d\d)/)||[])[1]||new Date().getFullYear();return mo?y+'-'+mo:'';}
  function resetData(){if(!confirm('¿Restablecer todos los datos a la carga original del Excel? Se perderán los cambios guardados.'))return;localStorage.removeItem(LS);STATE.data=clone(window.COSTOS_SEED);STATE.monthKey=STATE.data.months[STATE.data.months.length-1].key;STATE.cmpKey=STATE.data.months.length>1?STATE.data.months[STATE.data.months.length-2].key:null;STATE.editing=false;STATE.work=null;renderAll();flash('Datos restablecidos');}

  let flashT;function flash(msg){const n=el('flash');n.textContent=msg;n.classList.add('on');clearTimeout(flashT);flashT=setTimeout(()=>n.classList.remove('on'),2200);}

  // ---------- events ----------
  function wire(){
    el('cMonth').addEventListener('change',e=>{STATE.monthKey=e.target.value;if(STATE.cmpKey===STATE.monthKey)STATE.cmpKey=null;renderAll();});
    el('cCmp').addEventListener('change',e=>{STATE.cmpKey=e.target.value||null;renderAll();});
    el('btnEdit').addEventListener('click',startEdit);
    el('btnSave').addEventListener('click',commitEdit);
    el('btnCancel').addEventListener('click',cancelEdit);
    el('btnNew').addEventListener('click',newMonth);
    el('btnReset').addEventListener('click',resetData);
    // delegated edit inputs
    document.addEventListener('input',e=>{
      const t=e.target;if(!STATE.editing||!STATE.work)return;
      if(t.dataset.li!=null&&t.dataset.f){const l=STATE.work.lines[+t.dataset.li];const f=t.dataset.f;l[f]=f==='producto'?t.value:(parseFloat(t.value)||0);recalcEdit();}
      else if(t.dataset.dk&&t.dataset.df){STATE.work.drivers=STATE.work.drivers||{};STATE.work.drivers[t.dataset.dk]=STATE.work.drivers[t.dataset.dk]||{valor:0,consumo:0};STATE.work.drivers[t.dataset.dk][t.dataset.df]=parseFloat(t.value)||0;recalcEdit();}
    });
    document.addEventListener('click',e=>{
      const del=e.target.closest('[data-del]');if(del&&STATE.editing){if(confirm('¿Eliminar esta línea?')){STATE.work.lines.splice(+del.dataset.del,1);renderDetail();renderDrivers();}return;}
      if(e.target.id==='addRow'&&STATE.editing){const blank={producto:'Nueva línea',nMaq:0,operarios:0,m2:0,capacidad:0,kilos:0,arriendo:0,administracion:0,energiaElectrica:0,gas:0,otros:0,maqEquipo:0,sueldos:0,depreciacion:0};STATE.work.lines.push(blank);renderDetail();}
    });
    // print / tv
    el('printBtn').addEventListener('click',()=>window.print());
    el('tvBtn').addEventListener('click',()=>document.body.classList.add('tv'));
    el('tvExit').addEventListener('click',()=>document.body.classList.remove('tv'));
  }

  // ---------- boot ----------
  window.addEventListener('DOMContentLoaded',()=>{
    const ms=months();
    STATE.monthKey=ms[ms.length-1].key;
    STATE.cmpKey=ms.length>1?ms[ms.length-2].key:null;
    wire();renderAll();
    setTimeout(()=>el('loading').classList.add('hide'),250);
  });
})();
