/* Construcción del dataset comercial en el servidor.
   Evita descargar toda la tabla facturacion al navegador y procesarla allí. */
'use strict';

function ymDeFecha(v) {
  if (!v) return null;
  // fecha_factura llega como 'YYYY-MM-DD' o ISO ('YYYY-MM-DDTHH:mm:ss.sssZ').
  const s = String(v);
  return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : null;
}

function sucOf(ase) {
  if (!ase) return '(Sin asignar)';
  const m = ase.match(/^\s*([^-]+?)\s*-\s*\S/);
  let s = null;
  if (m) s = m[1].trim();
  else if (ase.trim().startsWith('-')) return '(Sin asignar)';
  else s = '(Otros)';
  if (/^MOSTRADOR\s*P\b/i.test(s)) return 'PALOQUEMAO';
  return s;
}

function modoValores(cnt) {
  // Para cada clave, el valor más frecuente visto (robusto ante datos
  // erróneos en filas sueltas) — igual que hace el importador de Excel.
  const out = {};
  for (const k in cnt) {
    let best = 0, bestCount = -1;
    const mc = cnt[k];
    for (const v in mc) {
      if (mc[v] > bestCount) { bestCount = mc[v]; best = +v; }
    }
    out[k] = best;
  }
  return out;
}

// ============================================================
// ACUMULADOR INCREMENTAL
// ============================================================
// Permite construir el dataset agregado fila por fila (o página por
// página) según van llegando desde SAP, en vez de esperar a tener las
// ~200.000 filas crudas juntas en un arreglo antes de procesarlas.
// Memoria usada ≈ proporcional a #clientes/#asesores/#artículos
// distintos (cientos), no al número de líneas de factura (cientos de
// miles).

function crearAcumulador() {
  const cats = [];
  const catIdx = {};
  const catalog = {};
  const CLI = {};
  const metaCnt = {}, metaSedeCnt = {}, metaGrupoCnt = {};
  const aseKgM = {}; // asesor -> ym -> kg (por factura, no por cartera asignada)
  const rentGM = {}; // grupo -> {rev:{ym}, cost:{ym}, kg:{ym}}
  const aseRevM = {}, aseCostM = {};
  const fact = {}; // numero_factura -> {cli, dias, total, pag, paga}
  const allYM = new Set();

  return { cats, catIdx, catalog, CLI, metaCnt, metaSedeCnt, metaGrupoCnt, aseKgM, rentGM, aseRevM, aseCostM, fact, allYM };
}

function acumularFila(acc, r) {
  const { cats, catIdx, catalog, CLI, metaCnt, metaSedeCnt, metaGrupoCnt, aseKgM, rentGM, aseRevM, aseCostM, fact, allYM } = acc;

  const gi = (name) => {
    name = (name || '').toString().trim() || '(s/g)';
    if (!(name in catIdx)) { catIdx[name] = cats.length; cats.push(name); }
    return catIdx[name];
  };

  const getCli = (name) => {
    name = (name || '').toString().trim();
    if (!name) return null;
    if (!CLI[name]) {
      CLI[name] = {
        nit: '', ciu: '', dep: '', ase: '', plazo: '',
        cc: 0, cu: 0, am: {}, regKg: {}, rev: 0, cost: 0, rgByG: {}
      };
    }
    return CLI[name];
  };

  {
    const name = (r.cliente || '').toString().trim();
    if (!name) return;
    const c = getCli(name);

    if (!c.nit && r.nit) c.nit = String(r.nit).trim();
    if (!c.ciu && r.ciudad) c.ciu = String(r.ciudad).trim();
    if (!c.dep && r.departamento) c.dep = String(r.departamento).trim();
    if (!c.ase && r.asesor) c.ase = String(r.asesor).trim();
    if (!c.plazo && r.plazo) c.plazo = String(r.plazo).trim();

    const ase = (r.asesor || '').toString().trim() || c.ase;
    if (ase) {
      const mv = Number(r.meta_anual_asesor) || 0;
      if (mv > 0) { const mc = metaCnt[ase] || (metaCnt[ase] = {}); mc[mv] = (mc[mv] || 0) + 1; }
      const su = sucOf(ase);
      const mvs = Number(r.meta_anual_sede) || 0;
      if (mvs > 0) { const mc = metaSedeCnt[su] || (metaSedeCnt[su] = {}); mc[mvs] = (mc[mvs] || 0) + 1; }
    }
    const grpNombre = (r.grupo || '(s/g)').toString().trim() || '(s/g)';
    const mvg = Number(r.meta_anual_grupo) || 0;
    if (mvg > 0) { const mc = metaGrupoCnt[grpNombre] || (metaGrupoCnt[grpNombre] = {}); mc[mvg] = (mc[mvg] || 0) + 1; }

    const cc = Number(r.cupo_credito) || 0;
    if (cc > c.cc) c.cc = cc;
    const cu = Number(r.cupo_usado) || 0;
    if (cu > c.cu) c.cu = cu;

    const cod = (r.codigo_articulo || '').toString().trim();
    const ym = ymDeFecha(r.fecha_factura);
    if (cod && ym) {
      allYM.add(ym);
      const gidx = gi(grpNombre);
      if (!catalog[cod]) catalog[cod] = [(r.articulo || cod).toString().trim(), gidx];
      const pu = Number(r.peso_unitario) || 0;
      if (pu && catalog[cod][2] == null) catalog[cod][2] = pu;

      const kk = Number(r.kilos) || 0;
      const am = c.am[cod] || (c.am[cod] = {});
      am[ym] = (am[ym] || 0) + kk;

      const vk = Number(r.valor_kilo) || 0;
      const ck = Number(r.costo_kilo) || 0;
      // Usar el valor total de la línea SAP para ventas cuando existe.
      // Conservamos valor/kg × kg como respaldo.
      const rev = Number(r.valor_total_articulo) || (vk * kk);
      const cost = ck * kk;
      if (rev || cost) {
        c.rev += rev; c.cost += cost;
        const rgg = c.rgByG[gidx] || (c.rgByG[gidx] = { rev: 0, cost: 0 });
        rgg.rev += rev; rgg.cost += cost;
        const gm = rentGM[grpNombre] || (rentGM[grpNombre] = { rev: {}, cost: {}, kg: {} });
        gm.rev[ym] = (gm.rev[ym] || 0) + rev;
        gm.cost[ym] = (gm.cost[ym] || 0) + cost;
        gm.kg[ym] = (gm.kg[ym] || 0) + kk;
        if (ase) {
          (aseRevM[ase] || (aseRevM[ase] = {}))[ym] = (aseRevM[ase][ym] || 0) + rev;
          (aseCostM[ase] || (aseCostM[ase] = {}))[ym] = (aseCostM[ase][ym] || 0) + cost;
        }
      }

      if (ase) {
        const k = Number(r.kilos) || 0;
        if (k) (aseKgM[ase] || (aseKgM[ase] = {}))[ym] = (aseKgM[ase][ym] || 0) + k;
      }
    }

    const numF = (r.numero_factura || '').toString().trim();
    if (numF) {
      const f = fact[numF] || (fact[numF] = { cli: name, dias: 0, total: 0, pag: 0, paga: '' });
      f.dias = Math.max(f.dias, Number(r.dias_mora) || 0);
      f.total += Number(r.valor_total_articulo) || 0;
      f.pag = Math.max(f.pag, Number(r.valor_pagado) || 0);
      const p = (r.factura_paga_total || '').toString().trim().toUpperCase();
      if (p) f.paga = p;
    }
  }
}

function finalizarDataset(acc) {
  const { cats, catalog, CLI, metaCnt, metaSedeCnt, metaGrupoCnt, aseKgM, rentGM, aseRevM, aseCostM, fact, allYM } = acc;

  const MONTHS = [...allYM].sort();

  const clients = {};
  for (const name in CLI) {
    const c = CLI[name];
    const a = [];
    let kg = 0;
    for (const cod in c.am) {
      const s = MONTHS.map((ym) => Math.round(c.am[cod][ym] || 0));
      const t = s.reduce((x, y) => x + y, 0);
      if (t > 0) { a.push([cod, s]); kg += t; }
    }
    if (!a.length && c.cc <= 0) continue;
    clients[name] = {
      nit: c.nit, ciu: c.ciu, dep: c.dep, ase: c.ase, plazo: c.plazo,
      cc: c.cc, cu: c.cu, kg, a, mora: [],
      rev: Math.round(c.rev || 0), cost: Math.round(c.cost || 0),
      rg: Object.entries(c.rgByG || {}).map(([g, o]) => [+g, Math.round(o.rev), Math.round(o.cost)])
    };
  }

  for (const nf in fact) {
    const f = fact[nf];
    if (f.dias > 0 && f.paga !== 'SI') {
      const pend = Math.max(0, Math.round(f.total - f.pag));
      if (pend > 0 && clients[f.cli]) clients[f.cli].mora.push([nf, Math.round(f.dias), pend]);
    }
  }

  const metaAse = modoValores(metaCnt);
  const metaSede = modoValores(metaSedeCnt);
  const metaGrupo = modoValores(metaGrupoCnt);

  const aseKg = {}, aseKgMons = {};
  for (const a in aseKgM) {
    const ser = MONTHS.map((ym) => Math.round(aseKgM[a][ym] || 0));
    const t = ser.reduce((s, v) => s + v, 0);
    if (t > 0) { aseKg[a] = t; aseKgMons[a] = ser; }
  }

  const hasRent = Object.keys(rentGM).length > 0;
  const rentGrupoMon = {};
  for (const g in rentGM) {
    const gm = rentGM[g];
    rentGrupoMon[g] = {
      rev: MONTHS.map((ym) => Math.round(gm.rev[ym] || 0)),
      cost: MONTHS.map((ym) => Math.round(gm.cost[ym] || 0)),
      kg: MONTHS.map((ym) => Math.round(gm.kg[ym] || 0))
    };
  }
  const aseRev = {}, aseCost = {};
  for (const a in aseRevM) {
    let t = 0; MONTHS.forEach((ym) => t += aseRevM[a][ym] || 0);
    if (t) aseRev[a] = Math.round(t);
  }
  for (const a in aseCostM) {
    let t = 0; MONTHS.forEach((ym) => t += aseCostM[a][ym] || 0);
    if (t) aseCost[a] = Math.round(t);
  }

  const DATA = {
    months: MONTHS, cats, catalog, clients,
    ntop: Object.keys(clients).length, pct: 100, volshare: 100,
    metaAse, metaSede, metaGrupo, aseKg, aseKgMons,
    hasRent, rentGrupoMon, aseRev, aseCost
  };

  // No traemos stock/inventario desde SAP (la tabla facturacion no lo
  // tiene), así que INV queda vacío: las secciones que dependen de stock
  // simplemente no muestran datos, en vez de romper la página.
  return { DATA, INV: {} };
}

// Compatibilidad: sigue existiendo por si algo llama con un arreglo ya
// completo en memoria (p.ej. pruebas locales), pero el camino usado en
// producción por app.js es crearAcumulador()/acumularFila()/finalizarDataset()
// alimentado página por página, sin materializar el arreglo completo.
function buildDatasetFromFacturacion(rows) {
  const acc = crearAcumulador();
  for (const r of rows) acumularFila(acc, r);
  return finalizarDataset(acc);
}

module.exports = buildDatasetFromFacturacion;
module.exports.crearAcumulador = crearAcumulador;
module.exports.acumularFila = acumularFila;
module.exports.finalizarDataset = finalizarDataset;
