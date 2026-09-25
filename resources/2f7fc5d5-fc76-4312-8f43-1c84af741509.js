/* La Campana V2.0 · sello de fecha de corte · lee el periodo del dato realmente cargado */
window.LC_META={version:'V2.0',corte:'31 jul 2026',generado:'10 sep 2026',
 mods:{
  margen:{t:'Margen y cartera',f:'export REC (facturación con valor y costo por kilo)',src:'margen'},
  comercial:{t:'Labor Comercial',f:'Labor Comercial 21-07.xlsx · IPN JUNIO.xlsx',src:'lcdata'},
  portafolio:{t:'Portafolio y cartera',f:'Labor Comercial 21-07.xlsx',src:'lcdata'},
  produccion:{t:'Producción',f:'IPN JUNIO.xlsx · METAS MAQUINAS.xlsx',src:'prod'},
  costos:{t:'Costos de producción',f:'Plantilla Costos.xlsx',src:'costos'},
  nogales:{t:'Planeación Nogales',f:'demanda: Labor Comercial · stock: export de existencias',src:'nogales'},
  surtidos:{t:'Surtidos sedes',f:'export de existencias por almacén',per:'corte del archivo cargado'},
  asesor:{t:'Hoja de asesor',f:'Labor Comercial 21-07.xlsx',src:'lcdata'},
  cliente:{t:'Hoja de cliente',f:'Labor Comercial 21-07.xlsx',src:'lcdata'}
 }};
(function(){
var s=document.currentScript,mod=(s&&s.getAttribute('data-mod'))||'',m=window.LC_META.mods[mod];
var css=document.createElement('style');
css.textContent='.lc-corte{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 16px;border:1px solid var(--line,#e3e5e9);border-left:3px solid var(--acc,#E10600);background:var(--panel,#fff);border-radius:10px;padding:9px 14px;margin-bottom:14px;font-family:"IBM Plex Mono",monospace;font-size:11.5px;color:var(--txt2,#5a6066)}.lc-corte b{font-family:Oswald,sans-serif;font-weight:600;letter-spacing:.5px;text-transform:uppercase;font-size:11.5px;color:var(--txt,#14161a)}.lc-corte .v{margin-left:auto;color:var(--txt3,#949aa1)}@media print{.lc-corte{margin-bottom:10px}}';
document.head.appendChild(css);
var MES=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
function lbl(k){var p=String(k).split('-');var i=(+p[1])-1;return (MES[i]||p[1])+' '+p[0];}
/* devuelve {corte, per, fuente} del dato cargado, o null si todavía no está */
function resolve(){
 if(!m)return null;
 if(m.src==='lcdata'){
  var D=window.LC_DATA;if(!D||!D.months||!D.months.length)return null;
  var M=D.months;
  return {corte:lbl(M[M.length-1]),per:M.length>1?lbl(M[0])+' – '+lbl(M[M.length-1]):lbl(M[0]),
   fuente:window.LC_DATA_IMPORTED?'archivo importado en este navegador':m.f};
 }
 if(m.src==='nogales'){
  var G2=window.LC_NOGALES_MESES;if(!G2||!G2.length)return null;
  return {corte:lbl(G2[G2.length-1]),per:G2.length>1?lbl(G2[0])+' – '+lbl(G2[G2.length-1]):lbl(G2[0]),
   fuente:window.LC_NOGALES_LIVE?'demanda del Excel cargado en este navegador · stock: export de existencias':'demanda: nogales_data.js · stock: export de existencias'};
 }
 if(m.src==='margen'){
  var G=window.LC_MARGEN_META;if(!G||!G.meses||!G.meses.length)return null;
  var Z=G.meses;
  return {corte:lbl(Z[Z.length-1]),per:Z.length>1?lbl(Z[0])+' – '+lbl(Z[Z.length-1]):lbl(Z[0]),
   fuente:'export REC cargado en este navegador · '+new Intl.NumberFormat('es-CO').format(G.filas)+' líneas'};
 }
 if(m.src==='prod'){
  var P=window.PROD_DATA;if(!P||!P.months||!P.months.length)return null;
  var Q=P.months,ult=Q[Q.length-1],parcial=window.PROD_PARTIAL===true,ref=window.PROD_REF_MONTH;
  return {corte:parcial?lbl(ult)+' · parcial (mes cerrado: '+lbl(ref||Q[Q.length-2])+')':lbl(ult),
   per:lbl(Q[0])+' – '+lbl(ult),
   fuente:window.PROD_DATA_IMPORTED?'archivo importado en este navegador':m.f};
 }
 if(m.src==='costos'){
  var C=window.COSTOS_SEED;if(!C||!C.months||!C.months.length)return null;
  var L=C.months;
  return {corte:(L[L.length-1].label||'').toLowerCase(),per:(L[0].label||'')+' – '+(L[L.length-1].label||''),fuente:m.f};
 }
 return {corte:window.LC_META.corte,per:m.per||'',fuente:m.f};
}
function go(){
 if(!m)return;
 var nav=document.querySelector('.navlinks')||document.querySelector('header');
 if(!nav)return;
 var d=document.createElement('div');d.className='lc-corte';
 d.innerHTML='<b>Datos al —</b><span class="p">'+m.t+'</span><span class="f">fuente: '+m.f+'</span><span class="v">Panorama '+window.LC_META.version+' · armado '+window.LC_META.generado+'</span>';
 nav.parentNode.insertBefore(d,nav.nextSibling);
 function paint(r){
  d.querySelector('b').textContent='Datos al '+r.corte;
  d.querySelector('.p').textContent=m.t+(r.per?' · '+r.per:'');
  d.querySelector('.f').textContent='fuente: '+r.fuente;
 }
 /* Cuando el tablero sella a mano (p. ej. la Portada, que marca el mes parcial),
    ese sello manda: la vigilancia automática deja de repintar. */
 var manual=false;
 window.LCSetCorte=function(corte,per,fuente){manual=true;paint({corte:corte,per:per||'',fuente:fuente||m.f});};
 /* los bootstraps son asíncronos y el dataset importado llega después de la semilla:
    se vigila el dato durante 15 s y se vuelve a sellar cada vez que cambia */
 var n=0,sig='',visto=false;
 function tick(){
  if(manual){clearInterval(iv);return}
  var x=resolve();
  if(x){var s=x.corte+'|'+x.per+'|'+x.fuente;if(s!==sig){sig=s;visto=true;paint(x);}}
  if(++n>60){clearInterval(iv);if(!visto)paint({corte:window.LC_META.corte+' (sin verificar)',per:m.per||'',fuente:m.f});}
 }
 tick();
 var iv=setInterval(tick,250);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',go);else go();
})();
