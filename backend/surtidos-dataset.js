'use strict';

// Agregado de ventas para Surtidos Sedes a partir de las filas ya guardadas
// en Supabase. No consulta SAP y no devuelve las filas crudas al navegador.
const KNOWN_WH = ['SPALQ','SCENT','CPFAC','SIBAG','PBUEN','SCESE','SFONT','SNCEN','SRIC2','SNZIN','S7AGO','SRIC1','SSOAC','SVILL','SBARR','SMOSQ'];

function num(v) {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function ym(v) {
  const s = String(v || '').trim();
  const m = s.match(/^(\d{4})-(\d{1,2})/);
  return m ? `${m[1]}-${String(m[2]).padStart(2, '0')}` : null;
}
function norm(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }

function crearAcumuladorSurtidos() {
  return { cats: [], catIdx: {}, catalog: {}, cube: {}, sedeMeta: {}, whSede: {}, allYM: new Set(), filas: 0 };
}

function acumularFilaSurtidos(A, r) {
  const mes = ym(r.fecha_factura);
  if (!mes) return;
  const cod = String(r.codigo_articulo || '').trim();
  if (!cod) return;
  const sede = String(r.sede || '').trim() || '(Sin sede)';
  const alm = String(r.nombre_almacen || '').trim();
  const grupo = String(r.grupo || '').trim() || '(s/g)';
  const articulo = String(r.articulo || cod).trim();
  const kg = num(r.kilos);

  if (!(grupo in A.catIdx)) { A.catIdx[grupo] = A.cats.length; A.cats.push(grupo); }
  if (!A.catalog[cod]) A.catalog[cod] = [articulo, A.catIdx[grupo], num(r.peso_unitario) || 0];
  else if (!A.catalog[cod][2] && num(r.peso_unitario) > 0) A.catalog[cod][2] = num(r.peso_unitario);

  A.allYM.add(mes);
  const sm = A.sedeMeta[sede] || (A.sedeMeta[sede] = { codes: {}, kg: 0 });
  if (alm) { sm.codes[alm] = (sm.codes[alm] || 0) + 1; A.whSede[alm.toUpperCase()] = sede; }
  const c = A.cube[sede] || (A.cube[sede] = {});
  const a = c[cod] || (c[cod] = {});
  a[mes] = (a[mes] || 0) + kg;
  A.filas++;
}

function finalizarDatasetSurtidos(A) {
  const months = [...A.allYM].sort().slice(-12);
  const cube = {}, sedes = {};
  for (const sede of Object.keys(A.cube)) {
    const o = {};
    let total = 0;
    for (const cod of Object.keys(A.cube[sede])) {
      const ser = months.map(m => Math.round(A.cube[sede][cod][m] || 0));
      const t = ser.reduce((x,y)=>x+y,0);
      if (t > 0) { o[cod] = ser; total += t; }
    }
    if (Object.keys(o).length) {
      cube[sede] = o;
      const codes = A.sedeMeta[sede]?.codes || {};
      let best = '', bestN = -1;
      for (const c of Object.keys(codes)) if (codes[c] > bestN) { bestN = codes[c]; best = c; }
      sedes[sede] = { code: best, kg: total };
    }
  }
  const out = {
    months,
    cats: A.cats,
    catalog: A.catalog,
    cube,
    sedes,
    whStock: {},
    whSede: A.whSede,
    partial: false,
    ts: Date.now(),
    filas: A.filas,
    src: { src: 'supabase' }
  };

  // Detecta mes parcial con la misma idea del tablero original.
  if (months.length >= 3) {
    const totals = months.map((_,i)=>Object.values(cube).reduce((s,c)=>s+Object.values(c).reduce((a,ser)=>a+(ser[i]||0),0),0));
    const prev = totals.slice(0,-1).filter(v=>v>0).sort((a,b)=>a-b);
    const med = prev.length ? prev[Math.floor(prev.length/2)] : 0;
    if (med > 0 && totals[totals.length-1] < med*0.5) out.partial = true;
  }
  return out;
}

module.exports = { crearAcumuladorSurtidos, acumularFilaSurtidos, finalizarDatasetSurtidos };
