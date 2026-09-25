/* La Campana V2.0 · selector de año + comparativo anual dentro de cada tablero.
   data-mod: comercial | portafolio | asesor | cliente | produccion | costos | margen (solo selector) */
(function(){
'use strict';
const S=document.currentScript,MOD=(S&&S.getAttribute('data-mod'))||'';
const KEY={comercial:'dataset',portafolio:'dataset',asesor:'dataset',cliente:'dataset',produccion:'prod_dataset',margen:'margen'}[MOD]||null;
const COMP=['comercial','portafolio','asesor','cliente','produccion','costos'].indexOf(MOD)>=0;
const DEMO=/[?&]demoanio=1/.test(location.search);
const MES=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const nf=n=>new Intl.NumberFormat('es-CO',{maximumFractionDigits:0}).format(Math.round(n||0));
const nf1=n=>new Intl.NumberFormat('es-CO',{maximumFractionDigits:1}).format(n||0);
const kg=n=>Math.abs(n)>=1e6?nf1(n/1e6)+' M':nf(n);
const money=n=>{const a=Math.abs(n||0);if(a>=1e6)return '$'+nf1(n/1e6)+' M';return '$'+nf(n)};
const ckg=n=>'$'+new Intl.NumberFormat('es-CO',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n||0);
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const LSON='LC_COMP_'+MOD;

const css=document.createElement('style');
css.textContent='.lcy{display:flex;align-items:center;gap:8px;flex-wrap:wrap}'+
'.lcy-seg{display:flex;align-items:center;background:var(--bg2,#e6e8eb);border:1px solid var(--line2,#d2d6db);border-radius:10px;padding:3px;gap:2px}'+
'.lcy-seg span{font-family:Oswald,sans-serif;font-size:10px;letter-spacing:.6px;text-transform:uppercase;color:var(--txt3,#949aa1);padding:0 6px 0 7px}'+
'.lcy-seg button{border:none;background:none;font-family:Oswald,sans-serif;font-weight:600;font-size:13px;letter-spacing:.4px;padding:7px 11px;border-radius:7px;color:var(--txt2,#5a6066);cursor:pointer}'+
'.lcy-seg button.on{background:var(--panel,#fff);color:var(--acc,#E10600);box-shadow:0 1px 3px rgba(0,0,0,.1)}'+
'.lcy-cmp{background:var(--panel,#fff);border:1px solid var(--line2,#d2d6db);color:var(--txt,#14161a);font-family:Oswald,sans-serif;font-weight:600;font-size:13px;letter-spacing:.5px;text-transform:uppercase;padding:10px 14px;border-radius:10px;cursor:pointer;line-height:1;transition:.15s}'+
'.lcy-cmp:hover{border-color:var(--acc,#E10600);color:var(--acc,#E10600)}'+
'.lcy-cmp.on{background:var(--txt,#14161a);border-color:var(--txt,#14161a);color:#fff}'+
'.lcc{background:var(--panel,#fff);border:1px solid var(--line,#e3e5e9);border-radius:var(--radius,14px);margin-bottom:16px;overflow:hidden}'+
'.lcc-h{display:flex;justify-content:space-between;align-items:center;gap:10px 18px;flex-wrap:wrap;padding:14px 18px;border-bottom:1px solid var(--line,#e3e5e9)}'+
'.lcc-h h2{font-family:Oswald,sans-serif;font-weight:500;font-size:15px;letter-spacing:.6px;text-transform:uppercase;margin:0}'+
'.lcc-h h2 b{color:var(--acc,#E10600);font-weight:600}'+
'.lcc-meta{display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-family:"IBM Plex Mono",monospace;font-size:11.5px;color:var(--txt2,#5a6066)}'+
'.lcc-meta i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}'+
'.lcc-meta select{font-family:"IBM Plex Mono",monospace;font-size:11.5px;background:var(--bg2,#e6e8eb);border:1px solid var(--line2,#d2d6db);border-radius:6px;padding:4px 6px;color:var(--txt,#14161a)}'+
'.lcc-b{padding:16px 18px 18px;display:grid;gap:16px}'+
'.lcc-k{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}'+
'.lcc-k>div{border:1px solid var(--line,#e3e5e9);border-radius:12px;padding:13px 15px;background:var(--panel2,#f5f6f7)}'+
'.lcc-k .l{font-family:Oswald,sans-serif;font-size:10.5px;letter-spacing:.6px;text-transform:uppercase;color:var(--txt3,#949aa1)}'+
'.lcc-k .v{font-family:Oswald,sans-serif;font-weight:600;font-size:26px;line-height:1.1;margin-top:7px}'+
'.lcc-k .p{font-family:"IBM Plex Mono",monospace;font-size:11.5px;color:var(--txt2,#5a6066);margin-top:5px;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}'+
'.lcc-d{font-family:"IBM Plex Mono",monospace;font-weight:600;font-size:11.5px;padding:2px 6px;border-radius:5px;white-space:nowrap}'+
'.lcc-d.up{color:var(--green,#1f8a5b);background:rgba(31,138,91,.1)}.lcc-d.dn{color:var(--red,#E10600);background:rgba(225,6,0,.08)}.lcc-d.eq{color:var(--txt3,#949aa1);background:var(--bg2,#e6e8eb)}'+
'.lcc-g{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:16px}'+
'@media(max-width:1000px){.lcc-g{grid-template-columns:minmax(0,1fr)}}'+
'.lcc-st{font-family:Oswald,sans-serif;font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:var(--txt3,#949aa1);margin-bottom:8px}'+
'.lcc svg{width:100%;height:auto;display:block}'+
'.lcc-t{width:100%;border-collapse:collapse;font-size:12.5px}'+
'.lcc-t th{font-family:Oswald,sans-serif;font-weight:500;font-size:10.5px;letter-spacing:.5px;text-transform:uppercase;color:var(--txt3,#949aa1);text-align:right;padding:6px 8px;border-bottom:1px solid var(--line2,#d2d6db)}'+
'.lcc-t th:first-child,.lcc-t td:first-child{text-align:left}'+
'.lcc-t td{padding:6px 8px;border-bottom:1px solid var(--line,#e3e5e9);text-align:right;font-family:"IBM Plex Mono",monospace;font-size:11.5px;font-variant-numeric:tabular-nums}'+
'.lcc-t td:first-child{font-family:Archivo,sans-serif;font-size:12px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'+
'.lcc-empty{font-size:13px;color:var(--txt2,#5a6066);line-height:1.6;max-width:720px}'+
'.lcc-empty a{color:var(--acc,#E10600)}'+
'.lcc-demo{font-family:"IBM Plex Mono",monospace;font-size:11px;color:#fff;background:var(--amber,#d9920a);border-radius:5px;padding:3px 7px}';
document.head.appendChild(css);

/* ---------- años disponibles ---------- */
function costosData(){try{const r=localStorage.getItem('lc_costos_v1');if(r){const d=JSON.parse(r);if(d&&d.months&&d.months.length)return d;}}catch(e){}return window.COSTOS_SEED||{months:[]};}
function yearsHere(){
  if(MOD==='costos'){const s=new Set(costosData().months.map(m=>+String(m.key).slice(0,4)));return [...s].sort();}
  return (window.lcAnios?window.lcAnios(KEY):[]).slice();
}
function activeHere(){
  if(MOD==='costos'){const sel=document.getElementById('cMonth');const k=sel&&sel.value||'';const y=+k.slice(0,4);if(y)return y;const ys=yearsHere();return ys[ys.length-1];}
  return window.lcAnio?window.lcAnio(KEY):null;
}

/* ---------- controles del encabezado ---------- */
function controls(){
  const header=document.querySelector('header');if(!header)return;
  const box=document.createElement('div');box.className='lcy noprint';
  const ys=yearsHere(),act=activeHere();
  if(MOD!=='costos'&&ys.length){
    const seg=document.createElement('div');seg.className='lcy-seg';seg.title='Año de los datos que muestra el tablero';
    seg.innerHTML='<span>Año</span>'+ys.map(y=>'<button type="button" data-y="'+y+'" class="'+(y===act?'on':'')+'">'+y+'</button>').join('');
    seg.onclick=e=>{const b=e.target.closest('button');if(!b||+b.dataset.y===act)return;window.lcSetAnio(+b.dataset.y);location.reload();};
    box.appendChild(seg);
  }
  if(COMP){
    const b=document.createElement('button');b.type='button';b.className='lcy-cmp';b.textContent='Comparativo anual';
    b.title='Compara el año activo contra otro año en el mismo periodo';
    const on=()=>localStorage.getItem(LSON)==='1'||DEMO;
    const sync=()=>{b.classList.toggle('on',on());panel.hidden=!on();if(on())render();};
    b.onclick=()=>{try{localStorage.setItem(LSON,on()?'0':'1')}catch(e){}sync();};
    box.appendChild(b);
    setTimeout(sync,0);
  }
  if(!box.children.length)return;
  const tools=MOD==='produccion'?null:header.querySelector('.htools,.picker');
  if(tools)tools.insertBefore(box,tools.firstChild);
  else{const t=header.querySelector('#toolsM');header.insertBefore(box,t||null);}
}

/* ---------- panel ---------- */
const panel=document.createElement('section');panel.className='lcc';panel.hidden=true;panel.id='lcComparativo';
function mountPanel(){const nav=document.querySelector('.navlinks');if(!nav)return document.body.prepend(panel);
  let a=nav.nextElementSibling;while(a&&a.classList&&(a.classList.contains('tvexit')||a.classList.contains('lc-corte')))a=a.nextElementSibling;
  nav.parentNode.insertBefore(panel,a||null);}
let cmpYear=null;

/* ---------- demo (datos simulados, solo en memoria) ---------- */
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0)/4294967295}
function demoFrom(ds,y){
  const sh=m=>String(y)+String(m).slice(4);
  if(MOD==='costos'){return {months:ds.months.map(m=>{const f=.86+hash(m.key)*.12;return Object.assign({},m,{key:sh(m.key),label:m.label.replace(/\d{4}/,y),lines:m.lines.map(l=>{const o=Object.assign({},l);['arriendo','administracion','energiaElectrica','gas','otros','maqEquipo','sueldos','depreciacion'].forEach(k=>o[k]=(+l[k]||0)*f);o.kilos=(+l.kilos||0)*(.8+hash(l.producto)*.35);return o})})})};}
  const d=ds.data;
  if(MOD==='produccion')return {data:Object.assign({},d,{months:d.months.map(sh),recs:d.recs.map(r=>Object.assign({},r,{k:r.k.map((v,i)=>v*(.7+hash(r.d+i)*.5))}))})};
  const cl={};for(const n in d.clients){const c=d.clients[n];if(hash(n)<.12)continue;const f=.55+hash(n+'x')*.7;cl[n]=Object.assign({},c,{a:(c.a||[]).map(([k,arr])=>[k,arr.map((v,i)=>v*f*(.8+hash(k+i)*.4))])});}
  return {data:Object.assign({},d,{months:d.months.map(sh),clients:cl})};
}

/* ---------- carga por año ---------- */
const cache={};
async function load(y){
  if(cache[y]!==undefined)return cache[y];
  let v=null;
  if(MOD==='costos'){const d=costosData();v={months:d.months.filter(m=>String(m.key).startsWith(y+'-'))};if(!v.months.length)v=null;}
  else if(window.lcGetYear){try{v=await window.lcGetYear(KEY,y)}catch(e){v=null}}
  if(MOD==='produccion'&&v&&!(v.data&&v.data.recs&&v.data.machines))v=null;
  return cache[y]=v;
}
async function pair(){
  let ys=yearsHere();const A=activeHere();
  let a=await load(A),others=ys.filter(y=>y!==A),demo=false;
  if(!others.length&&DEMO&&a){const y=A-1;const src=MOD==='costos'?costosData():a;cache[y]=MOD==='costos'?{months:demoFrom(src,y).months.filter(m=>String(m.key).startsWith(y+'-'))}:demoFrom(src,y);others=[y];demo=true;}
  if(cmpYear==null||others.indexOf(cmpYear)<0)cmpYear=others.indexOf(A-1)>=0?A-1:others[others.length-1];
  const b=cmpYear!=null?await load(cmpYear):null;
  return {A,B:cmpYear,a,b,others,demo};
}

/* ---------- agregadores ---------- */
const mnums=D=>D.months.map(m=>+String(m).slice(5,7));
function eachKg(D,filt,cb){const mn=mnums(D);for(const n in D.clients){const c=D.clients[n];if(filt&&!filt(n,c))continue;
  for(const [code,arr] of (c.a||[])){for(let i=0;i<arr.length;i++){const v=+arr[i]||0;if(v)cb(n,c,code,mn[i],v)}}}}
const catOf=(D,code)=>{const x=D.catalog&&D.catalog[code];return x&&D.cats?(D.cats[x[1]]||'OTROS'):'OTROS'};
const sedeOf=a=>String(a||'SIN SEDE').split(' - ')[0].trim()||'SIN SEDE';
function selName(id){const el=document.getElementById(id);return el?el.value.trim():''}

function aggKg(D,P,filt,dim){
  const r={tot:0,m:Array(12).fill(0),has:Array(12).fill(false),cli:new Set(),art:new Set(),cat:new Set(),meses:new Set(),by:{}};
  if(!D)return r;const d=D.data;mnums(d).forEach(m=>r.has[m-1]=true);
  eachKg(d,filt,(n,c,code,m,v)=>{r.m[m-1]+=v;if(!P.has(m))return;r.tot+=v;r.cli.add(n);r.art.add(code);const ct=catOf(d,code);r.cat.add(ct);r.meses.add(m);
    const k=dim==='sede'?sedeOf(c.ase):dim==='cat'?ct:dim==='cli'?n:null;if(k)r.by[k]=(r.by[k]||0)+v;});
  return r;
}
function aggProd(D,P){
  const r={tot:0,m:Array(12).fill(0),has:Array(12).fill(false),by:{},meta:0,n:0};if(!D)return r;const d=D.data,mn=mnums(d);
  mn.forEach(m=>r.has[m-1]=true);const nP=mn.filter(m=>P.has(m)).length;r.n=nP;
  d.recs.forEach(x=>{const mq=d.machines[x.mq],name=mq?mq.name:'SIN MÁQUINA';(x.k||[]).forEach((v,i)=>{v=+v||0;if(!v)return;const m=mn[i];r.m[m-1]+=v;if(!P.has(m))return;r.tot+=v;r.by[name]=(r.by[name]||0)+v;});});
  r.meta=(d.machines||[]).reduce((s,m)=>s+(+m.meta||0),0)*nP;return r;
}
const COMPS=['sueldos','arriendo','maqEquipo','energiaElectrica','depreciacion','administracion','otros','gas'];
const lineTot=l=>COMPS.reduce((s,k)=>s+(+l[k]||0),0);
function aggCostMonth(m){const a={total:0,kilos:0,by:{}};if(!m)return a;m.lines.forEach(l=>{const t=lineTot(l),k=+l.kilos||0;a.total+=t;a.kilos+=k;a.by[l.producto]={t,k};});a.ckg=a.kilos?a.total/a.kilos:0;return a;}

/* ---------- vista ---------- */
function delta(a,b,inv){if(!b&&!a)return '<span class="lcc-d eq">—</span>';if(!b)return '<span class="lcc-d '+(inv?'dn':'up')+'">nuevo</span>';
  const p=(a-b)/Math.abs(b)*100;const c=Math.abs(p)<.05?'eq':((p>0)!==!!inv?'up':'dn');return '<span class="lcc-d '+c+'">'+(p>0?'▲ +':p<0?'▼ ':'')+nf1(p)+'%</span>';}
function kpi(l,a,b,f,A,B,inv){return '<div><div class="l">'+esc(l)+'</div><div class="v">'+f(a)+'</div><div class="p"><span>'+B+': '+f(b)+'</span>'+delta(a,b,inv)+'</div></div>';}
function chart(sa,sb,ha,hb,A,B,f){
  const W=640,H=230,L=46,R=8,T=14,Bm=26,iw=W-L-R,ih=H-T-Bm,gw=iw/12,bw=Math.min(18,gw*.34);
  const max=Math.max(1,...sa.filter((_,i)=>ha[i]),...sb.filter((_,i)=>hb[i]));
  let s='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Comparativo mensual">';
  [0,.5,1].forEach(t=>{const y=T+ih-ih*t;s+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+y+'" y2="'+y+'" stroke="var(--line,#e3e5e9)"/><text x="'+(L-6)+'" y="'+(y+4)+'" text-anchor="end" font-size="10" font-family="IBM Plex Mono" fill="var(--txt3,#949aa1)">'+f(max*t)+'</text>';});
  for(let i=0;i<12;i++){const x=L+gw*i+gw/2;
    if(hb[i]){const h=ih*sb[i]/max;s+='<rect x="'+(x-bw-1)+'" y="'+(T+ih-h)+'" width="'+bw+'" height="'+h+'" rx="2" fill="#b9bec5"><title>'+MES[i]+' '+B+': '+f(sb[i])+'</title></rect>';}
    if(ha[i]){const h=ih*sa[i]/max;s+='<rect x="'+(x+1)+'" y="'+(T+ih-h)+'" width="'+bw+'" height="'+h+'" rx="2" fill="var(--acc,#E10600)"><title>'+MES[i]+' '+A+': '+f(sa[i])+'</title></rect>';}
    s+='<text x="'+x+'" y="'+(H-8)+'" text-anchor="middle" font-size="10.5" font-family="Oswald" fill="var(--txt2,#5a6066)">'+MES[i].toUpperCase()+'</text>';}
  return s+'</svg>';
}
function table(title,ba,bb,A,B,f,inv,n){
  const keys=[...new Set([...Object.keys(ba),...Object.keys(bb)])].sort((x,y)=>Math.max(ba[y]||0,bb[y]||0)-Math.max(ba[x]||0,bb[x]||0));
  const top=keys.slice(0,n||15);
  if(!top.length)return '<div class="lcc-st">'+esc(title)+'</div><div class="lcc-empty">Sin datos en el periodo.</div>';
  return '<div class="lcc-st">'+esc(title)+(keys.length>top.length?' · top '+top.length+' de '+keys.length:'')+'</div><table class="lcc-t"><thead><tr><th>'+(MOD==='costos'?'Producto':'Nombre')+'</th><th>'+B+'</th><th>'+A+'</th><th>Var.</th></tr></thead><tbody>'+
   top.map(k=>'<tr><td title="'+esc(k)+'">'+esc(k)+'</td><td>'+f(bb[k]||0)+'</td><td>'+f(ba[k]||0)+'</td><td>'+delta(ba[k]||0,bb[k]||0,inv)+'</td></tr>').join('')+'</tbody></table>';
}
function perLabel(P){const a=[...P].sort((x,y)=>x-y);if(!a.length)return '—';const cont=a.every((m,i)=>!i||m===a[i-1]+1);return cont?(a.length>1?MES[a[0]-1]+'–'+MES[a[a.length-1]-1]:MES[a[0]-1]):a.map(m=>MES[m-1]).join(', ');}

function head(A,B,others,demo,per){
  return '<div class="lcc-h"><h2>Comparativo anual · <b>'+A+'</b> vs '+(B||'—')+'</h2><div class="lcc-meta">'+
   (demo?'<span class="lcc-demo">Datos simulados de '+B+' · vista de prueba</span>':'')+
   (per?'<span>Mismo periodo: '+per+'</span>':'')+
   '<span><i style="background:#b9bec5"></i>'+(B||'—')+'</span><span><i style="background:var(--acc,#E10600)"></i>'+A+'</span>'+
   (others.length>1?'<label>Comparar con <select data-cy>'+others.map(y=>'<option'+(y===B?' selected':'')+'>'+y+'</option>').join('')+'</select></label>':'')+
   '</div></div>';
}
function emptyMsg(A,msg){
  panel.innerHTML='<div class="lcc-h"><h2>Comparativo anual · <b>'+(A||'')+'</b></h2></div><div class="lcc-b"><div class="lcc-empty">'+msg+'</div></div>';
}

let busy=false,again=false;
async function render(){
  if(panel.hidden)return;if(busy){again=true;return}busy=true;
  try{await draw()}catch(e){console.warn('LC comparativo',e);emptyMsg('', 'No se pudo armar el comparativo: '+esc(e&&e.message||e))}
  busy=false;if(again){again=false;render()}
}
async function draw(){
  const {A,B,a,b,others,demo}=await pair();
  const cargar=MOD==='costos'?'crea o importa los meses del otro año con el editor de meses de este tablero':MOD==='produccion'?'carga el archivo de producción del otro año con el botón de carga de este tablero':'carga el Excel de facturación del otro año con el botón <b>Cargar Excel</b>';
  if(!a)return emptyMsg(A,'No hay datos cargados para '+A+'.');
  if(!b)return emptyMsg(A,'Todavía no hay datos de otro año para comparar. Cuando llegue 2027, '+cargar+': el año se detecta de las fechas del archivo y los datos de '+A+' se conservan. <a href="?demoanio=1">Ver una vista de prueba con datos simulados</a>.');
  let html='';
  if(MOD==='costos'){
    const sel=document.getElementById('cMonth'),key=sel&&sel.value||a.months[a.months.length-1].key;
    const mA=a.months.find(m=>m.key===key)||a.months[a.months.length-1],mm=String(mA.key).slice(5,7),mB=b.months.find(m=>String(m.key).slice(5,7)===mm);
    const sa=Array(12).fill(0),sb=Array(12).fill(0),ha=Array(12).fill(false),hb=Array(12).fill(false);
    a.months.forEach(m=>{const i=+String(m.key).slice(5,7)-1;sa[i]=aggCostMonth(m).ckg;ha[i]=true});
    b.months.forEach(m=>{const i=+String(m.key).slice(5,7)-1;sb[i]=aggCostMonth(m).ckg;hb[i]=true});
    const xa=aggCostMonth(mA),xb=aggCostMonth(mB);const mes=MES[+mm-1];
    const ta={},tb={};for(const k in xa.by)ta[k]=xa.by[k].k?xa.by[k].t/xa.by[k].k:0;for(const k in xb.by)tb[k]=xb.by[k].k?xb.by[k].t/xb.by[k].k:0;
    html=head(A,B,others,demo,mes+' '+A+' vs '+mes+' '+B)+'<div class="lcc-b">'+
     (mB?'<div class="lcc-k">'+kpi('Costo por kilo · '+mes,xa.ckg,xb.ckg,ckg,A,B,true)+kpi('Costo total · '+mes,xa.total,xb.total,money,A,B,true)+kpi('Kilos producidos · '+mes,xa.kilos,xb.kilos,kg,A,B)+'</div>'
       :'<div class="lcc-empty">No hay '+mes+' '+B+' en el editor de meses. La gráfica muestra los meses que sí existen en ambos años.</div>')+
     '<div class="lcc-g"><div><div class="lcc-st">Costo por kilo mensual · $/kg</div>'+chart(sa,sb,ha,hb,A,B,v=>'$'+nf(v))+'</div><div>'+(mB?table('Costo por kilo por producto · '+mes,ta,tb,A,B,ckg,true,14):'')+'</div></div></div>';
    panel.innerHTML=html;return;
  }
  const hasA=mnums(a.data),hasB=new Set(mnums(b.data));const P=new Set(hasA.filter(m=>hasB.has(m)));
  const per=perLabel(P);
  if(MOD==='produccion'){
    const ra=aggProd(a,P),rb=aggProd(b,P);
    html=head(A,B,others,demo,per)+'<div class="lcc-b"><div class="lcc-k">'+
     kpi('Kilos producidos',ra.tot,rb.tot,kg,A,B)+kpi('Promedio mensual',ra.n?ra.tot/ra.n:0,rb.n?rb.tot/rb.n:0,kg,A,B)+
     kpi('Cumplimiento de meta',ra.meta?ra.tot/ra.meta*100:0,rb.meta?rb.tot/rb.meta*100:0,v=>nf1(v)+'%',A,B)+'</div>'+
     '<div class="lcc-g"><div><div class="lcc-st">Kilos producidos por mes</div>'+chart(ra.m,rb.m,ra.has,rb.has,A,B,kg)+'</div><div>'+table('Kilos por máquina · '+per,ra.by,rb.by,A,B,kg)+'</div></div></div>';
    panel.innerHTML=html;return;
  }
  let filt=null,dim='sede',tt='Kilos por sede',ks;
  if(MOD==='asesor'||MOD==='cliente'){
    const sel=selName(MOD==='asesor'?'aseInput':'cliInput');
    const ok=sel&&(MOD==='asesor'?Object.values(a.data.clients).some(c=>c.ase===sel):a.data.clients[sel]);
    if(!ok)return emptyMsg(A,'Elige '+(MOD==='asesor'?'un asesor':'un cliente')+' arriba para ver su comparativo '+A+' vs '+B+'.');
    filt=MOD==='asesor'?(n,c)=>c.ase===sel:(n)=>n===sel;
    dim=MOD==='asesor'?'cli':'cat';tt=MOD==='asesor'?'Kilos por cliente':'Kilos por categoría';
  }else if(MOD==='portafolio'){dim='cat';tt='Kilos por categoría';}
  const ra=aggKg(a,P,filt,dim),rb=aggKg(b,P,filt,dim);
  const cnt=n=>nf(n);
  if(MOD==='comercial')ks=[kpi('Kilos vendidos',ra.tot,rb.tot,kg,A,B),kpi('Clientes con compra',ra.cli.size,rb.cli.size,cnt,A,B),kpi('Kilos por cliente',ra.cli.size?ra.tot/ra.cli.size:0,rb.cli.size?rb.tot/rb.cli.size:0,kg,A,B),kpi('Artículos vendidos',ra.art.size,rb.art.size,cnt,A,B)];
  else if(MOD==='portafolio')ks=[kpi('Kilos vendidos',ra.tot,rb.tot,kg,A,B),kpi('Artículos vendidos',ra.art.size,rb.art.size,cnt,A,B),kpi('Categorías con venta',ra.cat.size,rb.cat.size,cnt,A,B),kpi('Clientes con compra',ra.cli.size,rb.cli.size,cnt,A,B)];
  else if(MOD==='asesor')ks=[kpi('Kilos vendidos',ra.tot,rb.tot,kg,A,B),kpi('Clientes con compra',ra.cli.size,rb.cli.size,cnt,A,B),kpi('Kilos por cliente',ra.cli.size?ra.tot/ra.cli.size:0,rb.cli.size?rb.tot/rb.cli.size:0,kg,A,B)];
  else ks=[kpi('Kilos comprados',ra.tot,rb.tot,kg,A,B),kpi('Artículos distintos',ra.art.size,rb.art.size,cnt,A,B),kpi('Meses con compra',ra.meses.size,rb.meses.size,cnt,A,B)];
  html=head(A,B,others,demo,per)+'<div class="lcc-b"><div class="lcc-k">'+ks.join('')+'</div>'+
   '<div class="lcc-g"><div><div class="lcc-st">Kilos por mes</div>'+chart(ra.m,rb.m,ra.has,rb.has,A,B,kg)+'</div><div>'+table(tt+' · '+per,ra.by,rb.by,A,B,kg)+'</div></div></div>';
  panel.innerHTML=html;
}
panel.addEventListener('change',e=>{if(e.target.matches('[data-cy]')){cmpYear=+e.target.value;render();}});

function watch(){
  const id=MOD==='asesor'?'aseInput':MOD==='cliente'?'cliInput':MOD==='costos'?'cMonth':null;if(!id)return;
  let last=null;setInterval(()=>{const el=document.getElementById(id);if(!el)return;const v=el.value;if(v!==last){last=v;render();}},600);
}
function start(){mountPanel();controls();watch();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
