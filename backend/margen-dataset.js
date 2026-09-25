'use strict';

// Construye exactamente el agregado que espera panorama-margen.html,
// pero usando las filas que ya fueron leídas desde Supabase.
// No consulta SAP ni modifica la tabla.

const SERV = /ARRIEND|FLETE|TRANSPORT|CHATARR|MUESTRA|INTERES|ESTIBA|BASCUL|SERVICIO|\bCORTE\b|OTROS/;
const SERVD = /SERVICIO|CHATARR|ESTIBA|FLETE|ARRIEND|BASCUL|TRANSPORT|INTERES/;
const ANTIC = /ANTICIPO/;
const UNI = /PINTUR|SOLDADUR|CEMENT|RETAL|BLOQUELON/;

function nodo() { return { kg: 0, val: 0, cost: 0, vl: 0, m: {} }; }
function acum(o, mes, kg, val, cost, vl) {
  o.kg += kg; o.val += val; o.cost += cost; o.vl += vl;
  const x = o.m[mes] || (o.m[mes] = { kg: 0, val: 0, cost: 0, vl: 0 });
  x.kg += kg; x.val += val; x.cost += cost; x.vl += vl;
}
function num(v) {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function mesDe(v) {
  const s = String(v || '').trim();
  const m = s.match(/^(\d{4})-(\d{1,2})/);
  return m ? `${m[1]}-${String(m[2]).padStart(2, '0')}` : null;
}

function crearAcumuladorMargen() {
  return {
    meses: {}, art: {}, cli: {}, ase: {}, sede: {}, grupo: {}, alm: {}, fact: {}, disp: {},
    meta: { ase: {}, sede: {}, grupo: {} },
    serv: nodo(), antic: nodo(), rev: nodo(), revList: {}, nocost: nodo(), nocostList: {},
    tot: { kg: 0, val: 0, cost: 0, vl: 0 },
    filas: 0, sinCosto: 0, sinFecha: 0
  };
}

function acumularFilaMargen(R, r) {
  const mes = mesDe(r.fecha_factura);
  if (!mes) { R.sinFecha++; return; }

  const kg = num(r.kilos), val = num(r.valor_total_articulo), ck = num(r.costo_kilo), vk = num(r.valor_kilo);
  const cod = String(r.codigo_articulo || '').trim();
  const grp = String(r.grupo || '').trim() || 'SIN GRUPO';
  const desc = String(r.articulo || cod).trim();
  const llave = (grp + ' ' + cod).toUpperCase();
  const dsc = desc.toUpperCase();
  if (!cod && !val) return;

  const pu = num(r.peso_unitario), porUnidad = UNI.test(grp);
  const cost = porUnidad ? (pu > 0 ? ck * (kg / pu) : 0) : kg * ck;
  const vl = kg * vk;
  R.meses[mes] = (R.meses[mes] || 0) + 1;
  R.filas++;

  const nfac = String(r.numero_factura || '').trim();
  if (nfac) {
    const F = R.fact[nfac] || (R.fact[nfac] = {
      cli: String(r.cliente || '').trim(), ase: String(r.asesor || '').trim(),
      sede: String(r.sede || '').trim(), plazo: String(r.plazo || '').trim(), mes,
      total: 0, ant: 0, pagado: 0, mora: 0, paga: true
    });
    F.total += val;
    if (ANTIC.test(llave) || ANTIC.test(dsc)) F.ant += val;
    F.pagado = Math.max(F.pagado, num(r.valor_pagado));
    F.mora = Math.max(F.mora, num(r.dias_mora));
    if (String(r.factura_paga_total || '').trim().toUpperCase() !== 'SI') F.paga = false;
  }

  const esAnt = ANTIC.test(llave) || ANTIC.test(dsc);
  const esServ = !esAnt && (SERV.test(llave) || SERVD.test(dsc));
  const sinCK = !esServ && ck <= 0;
  const pkg = kg > 0 ? val / kg : 0;
  let raro = false, motivo = '';
  if (!esServ && !sinCK && kg > 0 && pkg > 0 && !porUnidad && ck > pkg * 3) {
    raro = true;
    motivo = (pu > 1 && ck / pu <= pkg * 1.6) ? 'posible costo por unidad' : 'precio o kilos dudosos';
  }
  if (porUnidad && pu <= 0) { raro = true; motivo = 'sin peso unitario para convertir'; }
  if (porUnidad && kg <= 0) { raro = true; motivo = 'sin kilos en la fila'; }

  if (esAnt) {
    acum(R.antic, mes, kg, val, 0, 0);
  } else if (esServ) {
    acum(R.serv, mes, kg, val, cost, vl);
  } else if (sinCK) {
    if (kg <= 0 && val > 0) {
      R.sinCosto++; acum(R.rev, mes, kg, val, 0, vl);
      const W = R.revList[cod] || (R.revList[cod] = { d: desc, g: grp, kg: 0, val: 0, cost: 0, ck: 0, pu, n: 0, mot: 'sin kilos ni costo' });
      W.kg += kg; W.val += val; W.n++; return;
    }
    R.sinCosto++; acum(R.nocost, mes, kg, val, 0, vl);
    const N = R.nocostList[cod] || (R.nocostList[cod] = { d: desc, g: grp, kg: 0, val: 0, n: 0 });
    N.kg += kg; N.val += val; N.n++;
  } else if (raro) {
    acum(R.rev, mes, kg, val, cost, vl);
    const V = R.revList[cod] || (R.revList[cod] = { d: desc, g: grp, kg: 0, val: 0, cost: 0, ck, pu, n: 0, mot: motivo });
    V.kg += kg; V.val += val; V.cost += cost; V.n++;
  } else {
    R.tot.kg += kg; R.tot.val += val; R.tot.cost += cost; R.tot.vl += vl;
    const cli = String(r.cliente || '—').trim(), ase = String(r.asesor || '—').trim(), sede = String(r.sede || '—').trim();
    const A = R.art[cod] || (R.art[cod] = Object.assign(nodo(), { d: String(r.articulo || cod).trim(), g: grp }));
    acum(A, mes, kg, val, cost, vl);
    const K = R.cli[cli] || (R.cli[cli] = Object.assign(nodo(), { nit: String(r.nit || '').trim(), ciu: String(r.ciudad || '').trim(), ase, sede, plazo: String(r.plazo || '').trim() }));
    acum(K, mes, kg, val, cost, vl);
    acum(R.ase[ase] || (R.ase[ase] = Object.assign(nodo(), { sede })), mes, kg, val, cost, vl);
    acum(R.sede[sede] || (R.sede[sede] = nodo()), mes, kg, val, cost, vl);
    acum(R.grupo[grp] || (R.grupo[grp] = nodo()), mes, kg, val, cost, vl);
    const alm = String(r.nombre_almacen || '—').trim();
    acum(R.alm[alm] || (R.alm[alm] = nodo()), mes, kg, val, cost, vl);
    if (kg > 0) {
      const D = R.disp[cod] || (R.disp[cod] = { d: A.d, g: grp, a: {} });
      const x = D.a[ase] || (D.a[ase] = { kg: 0, val: 0 }); x.kg += kg; x.val += val;
    }
    if (num(r.meta_anual_asesor)) R.meta.ase[ase] = num(r.meta_anual_asesor);
    if (num(r.meta_anual_sede)) R.meta.sede[sede] = num(r.meta_anual_sede);
    if (num(r.meta_anual_grupo)) R.meta.grupo[grp] = num(r.meta_anual_grupo);
  }
}

function finalizarDatasetMargen(R) {
  R.mesesArr = Object.keys(R.meses).sort();
  return R;
}

module.exports = { crearAcumuladorMargen, acumularFilaMargen, finalizarDatasetMargen };
