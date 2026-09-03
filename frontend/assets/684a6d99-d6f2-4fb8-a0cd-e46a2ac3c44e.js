/* Datos DEMO · Hoja de Despacho · La Campana — se reemplazan al importar facturas reales de SAP */
window.DESPACHO_DEMO=(function(){
'use strict';
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const R=mulberry32(20260710);
const ri=(a,b)=>a+Math.floor(R()*(b-a+1));
const pick=arr=>arr[Math.floor(R()*arr.length)];

const FLOTA=[
  {placa:'SXK 419',desc:'Chevrolet NPR · 4.5 t'},
  {placa:'THQ 728',desc:'Chevrolet NQR · 5.5 t'},
  {placa:'WLM 305',desc:'Hino FC · 6.5 t'},
  {placa:'JDR 612',desc:'Foton BJ · 3.5 t'},
  {placa:'GQT 940',desc:'Turbo JAC · 4.0 t'}
];
const ASESORES=[
  {n:'CARLOS MEJÍA',e:'carlos.mejia@lacampana.co'},
  {n:'LUISA PACHECO',e:'luisa.pacheco@lacampana.co'},
  {n:'JORGE ARIZA',e:'jorge.ariza@lacampana.co'},
  {n:'DIANA OROZCO',e:'diana.orozco@lacampana.co'},
  {n:'MARIO QUINTERO',e:'mario.quintero@lacampana.co'},
  {n:'PAOLA GUERRA',e:'paola.guerra@lacampana.co'}
];
const CLIENTES=[
  {n:'FERRETERÍA EL CONSTRUCTOR SAS',dir:'Cl 44 # 19-23, Valledupar'},
  {n:'DISTRIACEROS DEL CESAR',dir:'Av. Salguero # 31-70, Valledupar'},
  {n:'HIERROS Y TECHOS BOSCONIA',dir:'Cra 18 # 12-05, Bosconia'},
  {n:'CONSTRUCCIONES AGUACHICA LTDA',dir:'Cl 5 # 11-48, Aguachica'},
  {n:'FERREMATERIALES CODAZZI',dir:'Cra 16 # 9-31, Agustín Codazzi'},
  {n:'METALURGICA LA PAZ',dir:'Cl 7 # 5-20, La Paz'},
  {n:'INVERSIONES ACEROMAX',dir:'Trv 20 # 6A-14, Valledupar'},
  {n:'TECHOS DEL VALLE SAS',dir:'Cl 16C # 41-88, Valledupar'},
  {n:'FERRETERÍA LA ECONOMÍA',dir:'Cra 9 # 16-60, Valledupar'},
  {n:'OBRAS CIVILES DEL NORTE',dir:'Km 3 vía La Paz, Valledupar'},
  {n:'AGROFERRETERA EL PROGRESO',dir:'Cl 13 # 14-27, Bosconia'},
  {n:'CUBIERTAS Y ESTRUCTURAS JR',dir:'Cra 22 # 18B-53, Valledupar'},
  {n:'CONSTRUALIADOS SAS',dir:'Cl 30 # 6-12, Aguachica'},
  {n:'FERRETODO CODAZZI',dir:'Cl 10 # 15-08, Agustín Codazzi'}
];
const ARTS=[
  {cod:'GAL1.10UP12192440',d:'LAMINA GALVANIZADA ESP 1.10 UN 1219X2440',g:'GALVANIZADA',kgUn:26,maxU:60},
  {cod:'GAL0.55UP12192440',d:'LAMINA GALVANIZADA ESP 0.55 UN 1219X2440',g:'GALVANIZADA',kgUn:13,maxU:90},
  {cod:'LAC3.00UP12006000',d:'LAMINA HOT ROLLED ESP 3.00 UN 1200X6000 A36',g:'HOT ROLLED',kgUn:170,maxU:14},
  {cod:'LAC12.0UP12002400',d:'LAMINA HOT ROLLED ESP 12.0 UN 1200X2400 A36',g:'HOT ROLLED',kgUn:271,maxU:8},
  {cod:'LAF0.85UP12192440',d:'LAMINA COLD ROLLED ESP 0.85 UN 1219X2440',g:'COLD ROLLED',kgUn:20,maxU:50},
  {cod:'LAF1.10UP12192440',d:'LAMINA COLD ROLLED ESP 1.10 UN 1219X2440',g:'COLD ROLLED',kgUn:26,maxU:40},
  {cod:'CTR0.25UP10706000R3001',d:'CUBIERTA TRAPEZOIDAL ESP 0.25 UN 1070X6000 ROJA',g:'CUBIERTA TRAPEZOIDAL',kgUn:13,maxU:80},
  {cod:'CTA0.25UP10706000R5017',d:'CUBIERTA TRAPEZOIDAL ESP 0.25 UN 1070X6000 AZUL',g:'CUBIERTA TRAPEZOIDAL',kgUn:13,maxU:80},
  {cod:'CAA0.35UP10706000R5017',d:'CUBIERTA ARQUITECTONICA ESP 0.35 UN 1070X6000 AZUL',g:'CUBIERTA ARQUITECTONICA',kgUn:18,maxU:50},
  {cod:'TEZ0.19KS08002140',d:'TEJA ZINC ESP 0.19 UN 0800X2140 SEGUNDA',g:'TEJA DE ZINC',kgUn:3.5,maxU:200},
  {cod:'PCH2.00UP1506000',d:'PERLIN EN C HOT ROLLED 150X50 ESP 2.00 UN 6.00 MT',g:'PERLIN EN C HOT ROLLED',kgUn:24,maxU:40},
  {cod:'TEC2.00UP10010060',d:'TUBERIA ESTRUCTURAL CUADRADO 100X100 ESP 2.00 UN 6 MT',g:'TUBERIA ESTRUCTURAL CUADRADO',kgUn:37,maxU:30},
  {cod:'VAR12.7UP6000G60',d:'VARILLA CORRUGADA 1/2 UN 6.00 MT GR60',g:'VARILLA',kgUn:5.9,maxU:300},
  {cod:'MES15X15.4UP6215',d:'MALLA ELECTROSOLDADA 15X15 CAL 4 UN 6.00X2.15',g:'MALLA ELECTROSOLDADA',kgUn:16,maxU:40},
  {cod:'PUN2.5UP25KG',d:'PUNTILLA 2 1/2 CAJA 25 KG',g:'PUNTILLAS',kgUn:25,maxU:20}
];

function iso(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
const HOY='2026-07-10';
const facturas=[];let seq=240981;
const d=new Date(2026,4,4), end=new Date(2026,6,10);
for(;d<=end;d.setDate(d.getDate()+1)){
  if(d.getDay()===0)continue; // domingos no hay despacho
  const fecha=iso(d);
  const n=ri(5,10);
  for(let i=0;i<n;i++){
    const cli=pick(CLIENTES), ase=pick(ASESORES);
    const nl=ri(1,4), usados={}, lineas=[];
    for(let j=0;j<nl;j++){
      const a=pick(ARTS);if(usados[a.cod])continue;usados[a.cod]=1;
      const u=ri(Math.max(1,Math.round(a.maxU*0.1)),a.maxU);
      const k=Math.round(u*a.kgUn*(0.95+R()*0.1));
      lineas.push({cod:a.cod,d:a.d,g:a.g,u:u,k:k});
    }
    let estado='pendiente',placa=null;
    if(fecha<'2026-07-09'){estado='entregada';placa=pick(FLOTA).placa;}
    else if(fecha==='2026-07-09'){const r=R();placa=pick(FLOTA).placa;estado=r<0.6?'entregada':'asignada';}
    else{const r=R();if(r<0.25){estado='asignada';placa=pick(FLOTA).placa;}}
    facturas.push({id:'F-'+(seq++),fecha:fecha,cliente:cli.n,dir:cli.dir,asesor:ase.n,correo:ase.e,estado:estado,placa:placa,lineas:lineas});
  }
}
return {demo:true,hoy:HOY,flota:FLOTA,facturas:facturas};
})();
