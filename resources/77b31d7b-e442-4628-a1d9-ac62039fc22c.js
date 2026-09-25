/* Panorama de Margen · La Campana V2.0
   Lee el export REC (una fila por línea de factura) y agrega en memoria:
   margen = Valor Total Articulo − (Kilos × Costo Kilo)
   El archivo nunca sale del navegador: se parsea aquí y se guarda el agregado. */
(function(){
'use strict';
const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
const nf=n=>new Intl.NumberFormat('es-CO',{maximumFractionDigits:0}).format(n||0);
const nf1=n=>new Intl.NumberFormat('es-CO',{maximumFractionDigits:1}).format(n||0);
const cop=n=>{const a=Math.abs(n||0);if(a>=1e9)return '$'+nf1(n/1e9)+' mil M';if(a>=1e6)return '$'+nf1(n/1e6)+' M';return '$'+nf(n)};
const copx=n=>'$'+nf(n);
const kgs=n=>Math.abs(n)>=1e6?nf1(n/1e6)+' M':nf(n);
const pct=n=>nf1((n||0)*100)+'%';
const plu=(n,s,p)=>nf(n)+' '+(Math.abs(n)===1?s:p);
const MES=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const mesLbl=k=>{const p=String(k).split('-');return MES[(+p[1])-1]+' '+p[0].slice(2)};
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* conceptos que no son venta de acero. Se evalúan contra grupo + código, y contra la
   descripción con un patrón más estricto para no capturar acero que diga "CORTE". */
const SERV=/ARRIEND|FLETE|TRANSPORT|CHATARR|MUESTRA|INTERES|ESTIBA|BASCUL|SERVICIO|\bCORTE\b|OTROS/;
const SERVD=/SERVICIO|CHATARR|ESTIBA|FLETE|ARRIEND|BASCUL|TRANSPORT|INTERES/;
const ANTIC=/ANTICIPO/;
/* grupos donde Costo Kilo es en realidad costo por UNIDAD: se convierte con Peso Unitario */
const UNI=/PINTUR|SOLDADUR|CEMENT|RETAL|BLOQUELON/;
const IVA=0.19;
let S=null, MESSEL='__all', TAB='resumen', Q='';

/* ---------- lectura del Excel ---------- */
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
function idx(head,names){const H=head.map(norm);for(const n of names){const i=H.indexOf(norm(n));if(i>=0)return i}
 for(const n of names){const t=norm(n);const i=H.findIndex(h=>h.indexOf(t)>=0);if(i>=0)return i}return -1}
const num=v=>{if(v==null||v==='')return 0;if(typeof v==='number')return v;
 const s=String(v).replace(/\s/g,'').replace(/\$/g,'');
 if(s.indexOf(',')>=0&&s.indexOf('.')>=0)return parseFloat(s.replace(/,/g,''))||0;
 if(/,\d{1,2}$/.test(s))return parseFloat(s.replace(/\./g,'').replace(',','.'))||0;
 return parseFloat(s.replace(/,/g,''))||0};
function mesDe(v){
 if(typeof v==='number'&&v>20000&&v<80000){const d=new Date(Date.UTC(1899,11,30+Math.floor(v)));
  return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0');}
 if(v instanceof Date)return v.getFullYear()+'-'+String(v.getMonth()+1).padStart(2,'0');
 const s=String(v||'').trim();let m=s.match(/^(\d{4})[-/](\d{1,2})/);if(m)return m[1]+'-'+m[2].padStart(2,'0');
 m=s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);if(m)return m[3]+'-'+m[2].padStart(2,'0');
 return null;
}
function nodo(){return {kg:0,val:0,cost:0,vl:0,m:{}}}
function acum(o,mes,kg,val,cost,vl){o.kg+=kg;o.val+=val;o.cost+=cost;o.vl+=vl;
 const x=o.m[mes]||(o.m[mes]={kg:0,val:0,cost:0,vl:0});x.kg+=kg;x.val+=val;x.cost+=cost;x.vl+=vl}

function agregar(rows,onProg){
 const head=rows[0]||[];
 const C={cli:idx(head,['Cliente']),nit:idx(head,['Nit']),ciu:idx(head,['Ciudad']),
  fac:idx(head,['Numero de Factura','Factura']),fec:idx(head,['Fecha de Factura','Fecha']),
  plazo:idx(head,['Plazo']),cc:idx(head,['Cupo de Credito']),cu:idx(head,['Cupo Usado']),
  ase:idx(head,['Asesor']),mAse:idx(head,['Meta Anual Asesor']),sede:idx(head,['Sede']),mSede:idx(head,['Meta Anual Sede']),
  alm:idx(head,['Nombre Almacen']),cod:idx(head,['Codigo de Articulo']),art:idx(head,['Articulo']),
  grp:idx(head,['Grupo']),mGrp:idx(head,['Meta Anual Grupo']),
  paga:idx(head,['Factura Paga Total']),pagado:idx(head,['Valor Pagado']),
  val:idx(head,['Valor Total Articulo']),mora:idx(head,['Dias de Mora']),
  kg:idx(head,['Kilos']),vk:idx(head,['Valor Kilo']),ck:idx(head,['Costo Kilo']),pu:idx(head,['Peso Unitario'])};
 const falta=['cli','fec','cod','val','kg','ck'].filter(k=>C[k]<0);
 if(falta.length)throw new Error('No encontré las columnas: '+falta.join(', '));

 const R={meses:{},art:{},cli:{},ase:{},sede:{},grupo:{},alm:{},fact:{},disp:{},
  meta:{ase:{},sede:{},grupo:{}},serv:{kg:0,val:0,cost:0,vl:0,m:{}},antic:nodo(),rev:nodo(),revList:{},nocost:nodo(),nocostList:{},
  tot:{kg:0,val:0,cost:0,vl:0},filas:0,sinCosto:0,sinFecha:0};
 for(let i=1;i<rows.length;i++){
  const r=rows[i];if(!r||r.length<3)continue;
  const mes=mesDe(r[C.fec]);if(!mes){R.sinFecha++;continue}
  const kg=num(r[C.kg]), val=num(r[C.val]), ck=num(r[C.ck]), vk=num(r[C.vk]);
  const cod=String(r[C.cod]||'').trim(), grp=String(r[C.grp]||'').trim()||'SIN GRUPO';
  const desc=String(r[C.art]||cod).trim(), llave=(grp+' '+cod).toUpperCase(), dsc=desc.toUpperCase();
  if(!cod&&!val)continue;
  const pu=C.pu>=0?num(r[C.pu]):0, porUnidad=UNI.test(grp);
  /* costo por unidad × unidades (kilos ÷ peso unitario) en los grupos que lo usan */
  const cost=porUnidad?(pu>0?ck*(kg/pu):0):kg*ck, vl=kg*vk;
  R.meses[mes]=(R.meses[mes]||0)+1;R.filas++;
  /* La factura se registra antes de cualquier clasificación: el saldo es lo facturado,
     incluidos los anticipos (el Valor Pagado del export corresponde a ese total con IVA).
     Los anticipos se guardan aparte para poder decir cuánto del saldo son. */
  const nfac=String(r[C.fac]||'').trim();
  if(nfac){const F=R.fact[nfac]||(R.fact[nfac]={cli:String(r[C.cli]||'').trim(),ase:String(r[C.ase]||'').trim(),sede:String(r[C.sede]||'').trim(),plazo:String(r[C.plazo]||'').trim(),mes:mes,total:0,ant:0,pagado:0,mora:0,paga:true});
   F.total+=val;if(ANTIC.test(llave)||ANTIC.test(dsc))F.ant+=val;
   F.pagado=Math.max(F.pagado,num(r[C.pagado]));F.mora=Math.max(F.mora,num(r[C.mora]));
   if(String(r[C.paga]||'').trim().toUpperCase()!=='SI')F.paga=false;}
  const esAnt=ANTIC.test(llave)||ANTIC.test(dsc);
  const esServ=!esAnt&&(SERV.test(llave)||SERVD.test(dsc));
  /* grupo de producto que llega sin Costo Kilo: no es un servicio, es acero sin costear */
  const sinCK=!esServ&&ck<=0;
  /* Costo Kilo que supera 3 veces el precio por kilo no es un costo por kilo:
     en láminas y cubiertas viene por unidad (el export trae Peso Unitario de 8–11 kg).
     Esas filas van a un bucket de revisión, no al margen. */
  const pkg=kg>0?val/kg:0;
  /* La conversión por unidad se aplica SOLO a los grupos enumerados. Fuera de ellos,
     un costo/kg más de 3 veces el precio/kg no se toca: la fila va a revisión con su
     motivo, porque puede ser costo por unidad o precio/kilos mal capturados. */
  let raro=false, motivo='', costF=cost;
  if(!esServ&&!sinCK&&kg>0&&pkg>0&&!porUnidad&&ck>pkg*3){
   raro=true; motivo=(pu>1&&ck/pu<=pkg*1.6)?'posible costo por unidad':'precio o kilos dudosos';
  }
  if(porUnidad&&pu<=0)  {raro=true;motivo='sin peso unitario para convertir'}
  if(porUnidad&&kg<=0)  {raro=true;motivo='sin kilos en la fila'}
  if(esAnt){acum(R.antic,mes,kg,val,0,0);}
  else if(esServ){acum(R.serv,mes,kg,val,cost,vl);}
  else if(sinCK){
   if(kg<=0&&val>0){R.sinCosto++;acum(R.rev,mes,kg,val,0,vl);
    const W=R.revList[cod]||(R.revList[cod]={d:desc,g:grp,kg:0,val:0,cost:0,ck:0,pu:pu,n:0,mot:'sin kilos ni costo'});
    W.kg+=kg;W.val+=val;W.n++;continue;}
   R.sinCosto++;acum(R.nocost,mes,kg,val,0,vl);
   const N=R.nocostList[cod]||(R.nocostList[cod]={d:desc,g:grp,kg:0,val:0,n:0});
   N.kg+=kg;N.val+=val;N.n++;
  }
  else if(raro){
   acum(R.rev,mes,kg,val,cost,vl);
   const V=R.revList[cod]||(R.revList[cod]={d:String(r[C.art]||cod).trim(),g:grp,kg:0,val:0,cost:0,ck:ck,pu:pu,n:0,mot:motivo});
   V.kg+=kg;V.val+=val;V.cost+=cost;V.n++;
  }
  else{
   R.tot.kg+=kg;R.tot.val+=val;R.tot.cost+=costF;R.tot.vl+=vl;
   const cli=String(r[C.cli]||'—').trim(), ase=String(r[C.ase]||'—').trim(), sede=String(r[C.sede]||'—').trim();
   const A=R.art[cod]||(R.art[cod]=Object.assign(nodo(),{d:String(r[C.art]||cod).trim(),g:grp}));
   acum(A,mes,kg,val,costF,vl);
   const K=R.cli[cli]||(R.cli[cli]=Object.assign(nodo(),{nit:String(r[C.nit]||'').trim(),ciu:String(r[C.ciu]||'').trim(),ase:ase,sede:sede,plazo:String(r[C.plazo]||'').trim()}));
   acum(K,mes,kg,val,costF,vl);
   acum(R.ase[ase]||(R.ase[ase]=Object.assign(nodo(),{sede:sede})),mes,kg,val,costF,vl);
   acum(R.sede[sede]||(R.sede[sede]=nodo()),mes,kg,val,costF,vl);
   acum(R.grupo[grp]||(R.grupo[grp]=nodo()),mes,kg,val,costF,vl);
   const alm=String(r[C.alm]||'—').trim();
   acum(R.alm[alm]||(R.alm[alm]=nodo()),mes,kg,val,costF,vl);
   if(kg>0){const D=R.disp[cod]||(R.disp[cod]={d:A.d,g:grp,a:{}});
    const x=D.a[ase]||(D.a[ase]={kg:0,val:0});x.kg+=kg;x.val+=val;}
   if(C.mAse>=0&&num(r[C.mAse]))R.meta.ase[ase]=num(r[C.mAse]);
   if(C.mSede>=0&&num(r[C.mSede]))R.meta.sede[sede]=num(r[C.mSede]);
   if(C.mGrp>=0&&num(r[C.mGrp]))R.meta.grupo[grp]=num(r[C.mGrp]);
  }
  if(onProg&&i%20000===0)onProg(i,rows.length);
 }
 R.mesesArr=Object.keys(R.meses).sort();
 window.LC_MARGEN_META={meses:R.mesesArr,filas:R.filas};
 return R;
}

/* ---------- métricas ---------- */
const sel=o=>{if(MESSEL==='__all')return o;const x=o.m&&o.m[MESSEL];return x||{kg:0,val:0,cost:0,vl:0}};
const mg=o=>{const v=sel(o);return {kg:v.kg,val:v.val,cost:v.cost,vl:v.vl,m:v.val-v.cost,p:v.val?(v.val-v.cost)/v.val:0,pi:v.kg?v.val/v.kg:0,dsc:v.vl?1-v.val/v.vl:0}};
function lista(obj,extra){return Object.keys(obj).map(k=>Object.assign({k:k},mg(obj[k]),extra?extra(obj[k],k):null)).filter(x=>x.kg||x.val)}

/* ---------- render ---------- */
function kpi(l,v,d,cls){return '<div class="kpi"><div class="accent'+(cls?' '+cls:'')+'"></div><div class="l">'+l+'</div><div class="v">'+v+'</div><div class="d">'+d+'</div></div>'}
function bars(series,fmt){
 const max=Math.max.apply(null,series.map(s=>Math.abs(s.v)).concat([1]));
 return '<div class="mbars">'+series.map(s=>'<div class="mb"><div class="mbv">'+fmt(s.v)+'</div><div class="mbt"><i style="height:'+Math.max(2,Math.abs(s.v)/max*100)+'%'+(s.v<0?';background:var(--red)':'')+'"></i></div><div class="mbl">'+s.l+'</div></div>').join('')+'</div>'}
function tabla(cols,rows){
 return '<div class="tscroll"><table><thead><tr>'+cols.map(c=>'<th'+(c.n?' class="num"':'')+'>'+c.t+'</th>').join('')+'</tr></thead><tbody>'+
 rows.map(r=>'<tr>'+r.map((c,i)=>'<td'+(cols[i].n?' class="num"':'')+'>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'}
const pill=p=>'<span class="pill '+(p<0?'bad':(p<0.15?'warn':'ok'))+'">'+pct(p)+'</span>';

function nivel(obj,titulo,hint,nombreCol,extraCol){
 let L=lista(obj);
 if(Q)L=L.filter(x=>{const n=obj[x.k]||{};
  return (x.k+' '+(n.d||'')+' '+(n.g||'')+' '+(n.ase||'')+' '+(n.sede||'')+' '+(n.nit||'')+' '+(n.ciu||'')).toLowerCase().indexOf(Q)>=0});
 L.sort((a,b)=>b.m-a.m);
 const cols=[{t:nombreCol}].concat(extraCol?[{t:extraCol.t}]:[],
  [{t:'Kilos',n:1},{t:'Ingreso',n:1},{t:'Costo',n:1},{t:'Margen $',n:1},{t:'Margen %',n:1},{t:'$/kg',n:1},{t:'Dscto.',n:1}]);
 const rows=L.slice(0,300).map(x=>{
  const base=['<div class="nm">'+esc(x.k)+'</div>'];
  if(extraCol)base.push('<span class="sm">'+esc(extraCol.get(obj[x.k],x.k))+'</span>');
  return base.concat([nf(x.kg),copx(x.val),copx(x.cost),copx(x.m),pill(x.p),copx(x.pi),x.dsc?pct(x.dsc):'—']);
 });
 return '<div class="panel"><div class="phead"><h2>'+titulo+'</h2><span class="hint">'+hint+' · '+L.length+' registros</span></div>'+tabla(cols,rows)+'</div>'
}

function resumen(){
 const T=mg(S.tot.m?S.tot:{m:{},kg:S.tot.kg,val:S.tot.val,cost:S.tot.cost,vl:S.tot.vl});
 /* totales por mes a partir de grupos */
 const porMes={};S.mesesArr.forEach(k=>porMes[k]={kg:0,val:0,cost:0,vl:0});
 Object.keys(S.grupo).forEach(g=>{const n=S.grupo[g];Object.keys(n.m).forEach(k=>{const a=porMes[k],b=n.m[k];if(!a)return;a.kg+=b.kg;a.val+=b.val;a.cost+=b.cost;a.vl+=b.vl})});
 const cur=MESSEL==='__all'?{kg:S.tot.kg,val:S.tot.val,cost:S.tot.cost,vl:S.tot.vl}:(porMes[MESSEL]||{kg:0,val:0,cost:0,vl:0});
 const m=cur.val-cur.cost, p=cur.val?m/cur.val:0, pi=cur.kg?cur.val/cur.kg:0, dsc=cur.vl?1-cur.val/cur.vl:0;
 const servV=MESSEL==='__all'?S.serv.val:((S.serv.m[MESSEL]||{}).val||0);
 const ncV=MESSEL==='__all'?S.nocost.val:((S.nocost.m[MESSEL]||{}).val||0);
 const antV=MESSEL==='__all'?S.antic.val:((S.antic.m[MESSEL]||{}).val||0);
 const facturado=cur.val+servV+ncV, pNc=facturado?ncV/facturado:0;

 /* bajo costo */
 const bajo=lista(S.art).filter(x=>x.m<0).sort((a,b)=>a.m-b.m);
 const bajoTot=bajo.reduce((a,x)=>a+x.m,0);

 /* dispersión de precio por artículo entre asesores */
 const disp=Object.keys(S.disp).map(cod=>{
  const D=S.disp[cod], ps=Object.keys(D.a).map(a=>({a:a,p:D.a[a].kg?D.a[a].val/D.a[a].kg:0,kg:D.a[a].kg})).filter(x=>x.p>0&&x.kg>=50);
  if(ps.length<3)return null;
  ps.sort((x,y)=>y.p-x.p);
  const hi=ps[0], lo=ps[ps.length-1], kg=ps.reduce((a,x)=>a+x.kg,0);
  return {cod:cod,d:D.d,g:D.g,hi:hi,lo:lo,br:hi.p?(hi.p-lo.p)/hi.p:0,kg:kg,n:ps.length,
   perd:(hi.p-lo.p)*ps.filter(x=>x!==hi).reduce((a,x)=>a+x.kg,0)};
 }).filter(Boolean).sort((a,b)=>b.perd-a.perd);

 /* cartera: el valor facturado lleva IVA del 19%; el saldo es ese total menos Valor Pagado */
 const F=Object.keys(S.fact).map(k=>Object.assign({},S.fact[k])).map(f=>Object.assign(f,{pend:Math.max(0,f.total*(1+IVA)-f.pagado)}))
  .filter(f=>f.pend>1||!f.paga||f.mora>0);
 const conMora=F.filter(f=>f.mora>0);
 const facMora=conMora.reduce((a,f)=>a+f.pend,0);

 const kpis=[
  kpi('Ingreso con costo conocido',cop(cur.val),(MESSEL==='__all'?plu(S.mesesArr.length,'mes','meses'):mesLbl(MESSEL))+' · sin IVA · '+(ncV?'excluye '+pct(pNc)+' sin costo declarado':'todo el ingreso tiene costo')),
  kpi('Costo de venta',cop(cur.cost),'Costo Kilo × Kilos · por unidad en pinturas, soldaduras, cemento, retal y bloquelón'),
  kpi('Margen bruto',cop(m),'sobre '+kgs(cur.kg)+' kg facturados'),
  kpi('Margen %',pct(p),'precio implícito '+copx(pi)+'/kg'),
  kpi('Descuento efectivo',pct(dsc),'valor facturado vs. Valor Kilo de lista'),
  kpi('Cartera vencida',cop(facMora),plu(conMora.length,'factura','facturas')+' en mora · saldo total '+cop(F.reduce((a,f)=>a+f.pend,0)))
 ].join('');

 const serieM=S.mesesArr.map(k=>({l:mesLbl(k),v:porMes[k].val-porMes[k].cost}));
 const serieP=S.mesesArr.map(k=>({l:mesLbl(k),v:porMes[k].val?(porMes[k].val-porMes[k].cost)/porMes[k].val*100:0}));

 const grup=lista(S.grupo).sort((a,b)=>b.m-a.m);
 const top=grup.slice(0,8), bot=grup.slice(-8).reverse();

 return '<div class="kpis">'+kpis+'</div>'+
 '<div class="grid2">'+
  '<div class="panel"><div class="phead"><h2>Margen bruto por mes</h2><span class="hint">pesos</span></div><div class="pbody">'+bars(serieM,cop)+'</div></div>'+
  '<div class="panel"><div class="phead"><h2>Margen % por mes</h2><span class="hint">sobre ingreso</span></div><div class="pbody">'+bars(serieP,v=>nf1(v)+'%')+'</div></div>'+
 '</div>'+
 (bajo.length?'<div class="panel warnpanel"><div class="phead"><h2>Artículos vendidos bajo costo</h2><span class="hint">'+bajo.length+' artículos · '+cop(bajoTot)+' de margen negativo</span></div>'+
  tabla([{t:'Artículo'},{t:'Grupo'},{t:'Kilos',n:1},{t:'Ingreso',n:1},{t:'Costo',n:1},{t:'Margen $',n:1},{t:'Margen %',n:1}],
   bajo.slice(0,15).map(x=>['<div class="nm">'+esc(S.art[x.k].d)+'</div><div class="sm">'+esc(x.k)+'</div>','<span class="sm">'+esc(S.art[x.k].g)+'</span>',nf(x.kg),copx(x.val),copx(x.cost),copx(x.m),pill(x.p)]))+
  '</div>':'')+
 (function(){
   const L=Object.keys(S.nocostList).map(k=>Object.assign({k:k},S.nocostList[k])).sort((a,b)=>b.val-a.val);
   if(!L.length)return '';
   const G={};L.forEach(x=>{const g=G[x.g]||(G[x.g]={val:0,kg:0,n:0});g.val+=x.val;g.kg+=x.kg;g.n+=x.n});
   const GL=Object.keys(G).map(k=>Object.assign({k:k},G[k])).sort((a,b)=>b.val-a.val);
   return '<div class="panel warnpanel"><div class="phead"><h2>Ventas sin costo declarado</h2><span class="hint">'+cop(L.reduce((a,x)=>a+x.val,0))+' · '+pct(pNc)+' del ingreso facturado</span></div>'+
   '<div class="foot-note" style="border-top:none">Acero facturado cuyo <b>Costo Kilo</b> llega vacío en el origen. No entra al margen porque no hay con qué calcularlo. Los servicios y los anticipos ya salieron por su propia vía: esto es material vendido sin costeo cargado. Mientras esas filas sigan sin costo, el margen del tablero se calcula sobre '+cop(cur.val)+' de los '+cop(facturado)+' facturados.</div>'+
   '<div class="grid2" style="padding:0 17px 15px">'+
    '<div>'+tabla([{t:'Grupo'},{t:'Filas',n:1},{t:'Kilos',n:1},{t:'Ingreso',n:1}],GL.slice(0,8).map(x=>['<div class="nm">'+esc(x.k)+'</div>',nf(x.n),nf(x.kg),copx(x.val)]))+'</div>'+
    '<div>'+tabla([{t:'Artículo'},{t:'Ingreso',n:1}],L.slice(0,8).map(x=>['<div class="nm">'+esc(x.d)+'</div><div class="sm">'+esc(x.k)+'</div>',copx(x.val)]))+'</div>'+
   '</div></div>';
  })()+
 (function(){const L=Object.keys(S.revList).map(k=>Object.assign({k:k},S.revList[k])).sort((a,b)=>b.cost-a.cost);
   if(!L.length)return '';
   return '<div class="panel warnpanel"><div class="phead"><h2>Filas por revisar · costo o precio inconsistente</h2><span class="hint">'+plu(L.length,'artículo','artículos')+' · '+cop(L.reduce((a,x)=>a+x.cost,0))+' de costo declarado, fuera del margen</span></div>'+
   tabla([{t:'Artículo'},{t:'Motivo'},{t:'Costo/kg del export',n:1},{t:'Precio/kg',n:1},{t:'Peso unitario',n:1},{t:'Kilos',n:1}],
    L.slice(0,12).map(x=>['<div class="nm">'+esc(x.d)+'</div><div class="sm">'+esc(x.k)+' · '+esc(x.g)+'</div>','<span class="pill '+(x.mot==='precio o kilos dudosos'?'bad':'warn')+'">'+esc(x.mot||'—')+'</span>',copx(x.ck),copx(x.kg?x.val/x.kg:0),x.pu?nf1(x.pu)+' kg':'—',nf(x.kg)]))+
   '<div class="foot-note">La conversión por peso unitario se aplica automáticamente en pinturas, soldaduras, cemento, retal y bloquelón. Estas filas quedan fuera del margen sin tocarlas: en unas el costo parece venir por unidad en un grupo que no está en esa lista; en otras el precio por kilo está muy por debajo de lo normal, que es un problema de captura, no de costo. Ninguna se corrige sola.</div></div>';
  })()+
 '<div class="panel"><div class="phead"><h2>Dispersión de precio · mismo artículo, distinto asesor</h2><span class="hint">artículos con 3+ asesores y 50+ kg cada uno</span></div>'+
  tabla([{t:'Artículo'},{t:'Precio más alto'},{t:'Precio más bajo'},{t:'Brecha',n:1},{t:'Kilos',n:1},{t:'Ingreso no capturado',n:1}],
   disp.slice(0,15).map(x=>['<div class="nm">'+esc(x.d)+'</div><div class="sm">'+esc(x.cod)+' · '+x.n+' asesores</div>',
    '<div class="nm sm2">'+copx(x.hi.p)+'</div><div class="sm">'+esc(x.hi.a)+'</div>',
    '<div class="nm sm2">'+copx(x.lo.p)+'</div><div class="sm">'+esc(x.lo.a)+'</div>',
    '<span class="pill '+(x.br>0.15?'bad':(x.br>0.07?'warn':'mut'))+'">'+pct(x.br)+'</span>',nf(x.kg),copx(x.perd)]))+
  '<div class="foot-note">La última columna es lo que habría entrado si todos los kilos se hubieran vendido al precio más alto observado en el periodo. No es una meta: es el techo de la negociación que ya ocurrió.</div></div>'+
 '<div class="grid2">'+
  '<div class="panel"><div class="phead"><h2>Grupos que más aportan</h2></div>'+tabla([{t:'Grupo'},{t:'Margen $',n:1},{t:'Margen %',n:1}],top.map(x=>['<div class="nm">'+esc(x.k)+'</div>',copx(x.m),pill(x.p)]))+'</div>'+
  '<div class="panel"><div class="phead"><h2>Grupos que menos aportan</h2></div>'+tabla([{t:'Grupo'},{t:'Margen $',n:1},{t:'Margen %',n:1}],bot.map(x=>['<div class="nm">'+esc(x.k)+'</div>',copx(x.m),pill(x.p)]))+'</div>'+
 '</div>'+
 ((servV||antV)?'<div class="foot-note pad">'+
  (servV?'Servicios y conceptos que no son venta de acero (fletes, arriendos, báscula, servicio de corte, chatarra, estibas, intereses) se excluyen del margen y suman '+cop(servV)+' de ingreso aparte. ':'')+
  (antV?'Los anticipos de cliente ('+cop(antV)+') no entran al ingreso ni al margen porque no son venta del periodo, pero sí forman parte de lo facturado y por eso cuentan en el saldo de cartera.':'')+
  '</div>':'');
}

function cartera(){
 const F=Object.keys(S.fact).map(k=>Object.assign({n:k},S.fact[k])).map(f=>Object.assign(f,{tot:f.total*(1+IVA),pend:Math.max(0,f.total*(1+IVA)-f.pagado)}));
 const ab=F.filter(f=>f.pend>1||!f.paga||f.mora>0);
 const buckets=[{t:'Sin mora',a:0,b:0},{t:'1–30 días',a:1,b:30},{t:'31–60 días',a:31,b:60},{t:'61–90 días',a:61,b:90},{t:'Más de 90 días',a:91,b:1e9}];
 const bs=buckets.map(b=>{const arr=ab.filter(f=>f.mora>=b.a&&f.mora<=b.b);return {t:b.t,n:arr.length,v:arr.reduce((a,f)=>a+f.pend,0)}});
 const conMora=ab.filter(f=>f.mora>0);
 const pend=ab.reduce((a,f)=>a+f.pend,0);
 const porAse={};conMora.forEach(f=>{const a=porAse[f.ase]||(porAse[f.ase]={v:0,n:0,d:0});a.v+=f.pend;a.n++;a.d=Math.max(a.d,f.mora)});
 const AS=Object.keys(porAse).map(k=>Object.assign({k:k},porAse[k])).sort((a,b)=>b.v-a.v);
 const top=conMora.slice().sort((a,b)=>b.pend-a.pend).slice(0,20);
 const antAb=ab.filter(f=>f.ant>0), antPend=antAb.reduce((a,f)=>a+f.pend,0);
 const porPlazo={};ab.forEach(f=>{const p=f.plazo||'—';const a=porPlazo[p]||(porPlazo[p]={v:0,n:0,m:0});a.v+=f.pend;a.n++;a.m=Math.max(a.m,f.mora)});
 const PL=Object.keys(porPlazo).map(k=>Object.assign({k:k},porPlazo[k])).sort((a,b)=>b.v-a.v);
 return '<div class="kpis">'+[
   kpi('Saldo pendiente',cop(pend),plu(ab.length,'factura abierta','facturas abiertas')+' de '+nf(F.length)),
   kpi('Vencido',cop(conMora.reduce((a,f)=>a+f.pend,0)),plu(conMora.length,'factura','facturas')+' con mora'),
   kpi('Más de 90 días',cop(bs[4].v),plu(bs[4].n,'factura','facturas')),
   kpi('Mora máxima',nf(ab.reduce((a,f)=>Math.max(a,f.mora),0))+' <small>días</small>','la factura más antigua sin pagar'),
   kpi('Saldo con anticipos',cop(antPend),plu(antAb.length,'factura incluye','facturas incluyen')+' líneas de anticipo de cliente')
 ].join('')+'</div>'+
 '<div class="panel"><div class="phead"><h2>Antigüedad de la cartera</h2><span class="hint">saldo pendiente por rango de mora</span></div><div class="pbody">'+
  bars(bs.map(b=>({l:b.t.replace(' días',''),v:b.v})),cop)+
  '<div class="foot-note">Saldo = valor facturado con IVA (19% sobre el Valor Total Articulo) − Valor Pagado. La mora es la del campo Dias de Mora del export.'+
  (function(){const si=ab.filter(f=>f.paga),v=si.reduce((a,f)=>a+f.pend,0);
   return si.length?'<br><b>Reserva:</b> '+plu(si.length,'de estas facturas viene','de estas facturas vienen')+' marcadas como <b>Factura Paga Total = SI</b> en el origen y aportan '+cop(v)+' del saldo. O el Valor Pagado quedó incompleto, o la marca de pago total no está actualizada: conviene verificarlo antes de cobrar sobre esta cifra.':''})()+
  '</div></div></div>'+
 '<div class="grid2">'+
  '<div class="panel"><div class="phead"><h2>Cartera vencida por asesor</h2><span class="hint">quien vendió, cobra</span></div>'+
   tabla([{t:'Asesor'},{t:'Facturas',n:1},{t:'Vencido',n:1},{t:'Mora máx.',n:1}],AS.slice(0,15).map(x=>['<div class="nm">'+esc(x.k)+'</div>',nf(x.n),copx(x.v),nf(x.d)+' d']))+'</div>'+
  '<div class="panel"><div class="phead"><h2>Saldo por condición de pago</h2><span class="hint">plazo pactado</span></div>'+
   tabla([{t:'Plazo'},{t:'Facturas',n:1},{t:'Saldo',n:1},{t:'Mora máx.',n:1}],PL.slice(0,12).map(x=>['<div class="nm">'+esc(x.k)+'</div>',nf(x.n),copx(x.v),nf(x.m)+' d']))+'</div>'+
 '</div>'+
 '<div class="panel"><div class="phead"><h2>Facturas vencidas más grandes</h2></div>'+
   tabla([{t:'Factura'},{t:'Cliente'},{t:'Facturado con IVA',n:1},{t:'Saldo',n:1},{t:'Mora',n:1}],top.map(f=>['<span class="sm">'+esc(f.n)+'</span>','<div class="nm">'+esc(f.cli)+'</div><div class="sm">'+esc(f.sede)+' · '+esc(f.plazo)+'</div>',copx(f.tot),copx(f.pend),'<span class="pill '+(f.mora>90?'bad':(f.mora>30?'warn':'mut'))+'">'+nf(f.mora)+' d</span>']))+'</div>';
}

function render(){
 if(!S){$('#body').innerHTML='';return}
 const sels=$('#fMes');
 if(sels&&!sels.dataset.done){sels.innerHTML='<option value="__all">Todos los meses</option>'+S.mesesArr.map(k=>'<option value="'+k+'">'+mesLbl(k)+'</option>').join('');sels.dataset.done='1';sels.value=MESSEL}
 $$('.tabs a').forEach(a=>a.classList.toggle('on',a.dataset.tab===TAB));
 const box=$('#body');
 if(TAB==='resumen')box.innerHTML=resumen();
 else if(TAB==='articulos')box.innerHTML=nivel(S.art,'Margen por artículo','ordenado por margen $','Artículo',{t:'Grupo',get:(n)=>n.g});
 else if(TAB==='grupos')box.innerHTML=nivel(S.grupo,'Margen por grupo de producto','ordenado por margen $','Grupo');
 else if(TAB==='clientes')box.innerHTML=nivel(S.cli,'Margen por cliente','ordenado por margen $','Cliente',{t:'Asesor',get:(n)=>n.ase});
 else if(TAB==='asesores')box.innerHTML=nivel(S.ase,'Margen por asesor','ordenado por margen $','Asesor',{t:'Sede',get:(n)=>n.sede});
 else if(TAB==='sedes')box.innerHTML=nivel(S.sede,'Margen por sede','ordenado por margen $','Sede')+
   nivel(S.alm,'Margen por almacén de despacho','de dónde salió el material','Almacén');
 else if(TAB==='cartera')box.innerHTML=cartera();
 const fq=$('#fQ');if(fq&&fq.parentNode)fq.parentNode.style.display=(TAB==='resumen'||TAB==='cartera')?'none':'flex';
 const sub=$('#subt');
 if(sub&&S.mesesArr.length)sub.textContent='La Campana · margen y cartera · '+mesLbl(S.mesesArr[0])+'–'+mesLbl(S.mesesArr[S.mesesArr.length-1])+' · '+nf(S.filas)+' líneas de factura';
}

/* ---------- importador ---------- */
function estado(txt,cls){const e=$('#impState');if(e){e.textContent=txt;e.className='impstate'+(cls?' '+cls:'')}}
async function leer(file){
 estado('Leyendo '+file.name+'… ('+nf(file.size/1048576)+' MB)');
 const buf=await file.arrayBuffer();
 estado('Parseando la hoja…');
 const wb=XLSX.read(new Uint8Array(buf),{type:'array',cellDates:true,cellStyles:false,sheetStubs:false});
 const ws=wb.Sheets[wb.SheetNames[0]];
 const rows=XLSX.utils.sheet_to_json(ws,{header:1,blankrows:false,raw:true});
 estado('Agregando '+nf(rows.length-1)+' líneas…');
 const R=agregar(rows,(i,n)=>estado('Agregando '+nf(i)+' de '+nf(n)+' líneas…'));
 S=R;
 try{await lcSet('margen',R);estado('Listo · '+nf(R.filas)+' líneas · '+R.mesesArr.length+(R.mesesArr.length===1?' mes':' meses')+' · guardado en este navegador','ok')}
 catch(e){estado('Agregado listo, pero no se pudo guardar: '+e.message,'warn')}
 MESSEL='__all';render();
 if(window.LCSetCorte&&R.mesesArr.length)window.LCSetCorte(mesLbl(R.mesesArr[R.mesesArr.length-1]),
   (R.mesesArr.length>1?mesLbl(R.mesesArr[0])+' – ':'')+mesLbl(R.mesesArr[R.mesesArr.length-1]),
   'export REC cargado en este navegador · '+nf(R.filas)+' líneas');
 const m=$('#impModal');if(m)m.style.display='none';
}

function bind(){
 $('#fMes').onchange=function(){MESSEL=this.value;render()};
 const q=$('#fQ');if(q)q.oninput=function(){Q=this.value.trim().toLowerCase();render()};
 $$('.tabs a').forEach(a=>a.onclick=function(e){e.preventDefault();TAB=a.dataset.tab;Q='';const q2=$('#fQ');if(q2)q2.value='';render()});
 /* Con la carga unificada montada, esta página no parsea nada por su cuenta: un solo
    archivo tiene que alimentar el dataset comercial y el margen a la vez. */
 const UNIF=window.LCIMPORT===true;
 const open=UNIF?(()=>{location.href='Panorama Comercial.html?importar=1'}):(()=>{$('#impModal').style.display='flex'});
 $('#btnImp').onclick=open;$('#impClose').onclick=()=>{$('#impModal').style.display='none'};
 const inp=$('#impFile'), drop=$('#impDrop');
 if(!UNIF){
  drop.onclick=()=>inp.click();
  inp.onchange=e=>{if(e.target.files[0])leer(e.target.files[0])};
  ['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('over')}));
  ['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('over')}));
  drop.addEventListener('drop',e=>{if(e.dataTransfer.files[0])leer(e.dataTransfer.files[0])});
 }else{drop.onclick=open;drop.innerHTML='La carga es única: <b>haz clic para ir a Panorama Comercial</b> y sube el archivo una sola vez.'}
 $('#impReset').onclick=async function(){if(!confirm('¿Borrar el margen cargado en este navegador?'))return;
  try{await lcDel('margen')}catch(e){}S=null;location.reload()};
}

window.LCMargenSet=async function(data){
  if(!data||!data.filas)return false;
  S=data;
  window.LC_MARGEN_META={meses:data.mesesArr||Object.keys(data.meses||{}).sort(),filas:data.filas};
  try{if(typeof lcSet==='function')await lcSet('margen',data);}catch(e){console.warn('[MARGEN] no se pudo guardar el agregado:',e);}
  try{render();}catch(e){console.error('[MARGEN] error refrescando:',e);}
  return true;
};
window.LCMargenAgregar=function(rows){return agregar(rows)};
window.LCBootMargen=async function(){
 bind();
 try{const d=await lcGet('margen');if(d&&d.filas){S=d;window.LC_MARGEN_META={meses:d.mesesArr,filas:d.filas};render();
  if(window.LCSetCorte&&d.mesesArr&&d.mesesArr.length)window.LCSetCorte(mesLbl(d.mesesArr[d.mesesArr.length-1]),(d.mesesArr.length>1?mesLbl(d.mesesArr[0])+' – ':'')+mesLbl(d.mesesArr[d.mesesArr.length-1]),'export REC cargado en este navegador · '+nf(d.filas)+' líneas');estado('Cargado de este navegador · '+nf(d.filas)+' líneas','ok');return}}catch(e){}
 $('#body').innerHTML='<div class="empty"><h2>Carga el export REC para ver el margen</h2>'+
  '<p>Una fila por línea de factura, con <b>Kilos</b>, <b>Valor Total Articulo</b> y <b>Costo Kilo</b>. El archivo se procesa aquí mismo: no se sube a ningún servidor.</p>'+
  '<p class="sm">Es el mismo archivo del panorama comercial: se carga una sola vez y alimenta los dos.</p>'+
  '<button class="btn" id="emptyBtn">Cargar Excel</button></div>';
 const b=$('#emptyBtn');if(b)b.onclick=()=>{if(window.LCIMPORT===true)location.href='Panorama Comercial.html?importar=1';else $('#impModal').style.display='flex'};
};
})();
