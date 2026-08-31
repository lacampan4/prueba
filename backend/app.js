require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const https = require('https');
const buildDatasetFromFacturacion = require('./dataset');

const app = express();
const PORT = process.env.PORT || 3000;

const DEFAULT_SAP_URL =
  'https://170.239.154.46:4300/api_campana26/facturacion.xsodata/Facturacion';

let SAP_BASE_URL =
  process.env.SAP_SERVICE_URL ||
  process.env.SAP_BASE_URL ||
  DEFAULT_SAP_URL;

function normalizarSAPUrl(url) {
  if (!url) return DEFAULT_SAP_URL;
  let resultado = String(url).trim();
  const segunda = resultado.indexOf('https://', 8);
  if (segunda !== -1) resultado = resultado.substring(segunda);
  const tercera = resultado.indexOf('http://', 8);
  if (tercera !== -1) resultado = resultado.substring(tercera);
  return resultado;
}
SAP_BASE_URL = normalizarSAPUrl(SAP_BASE_URL);

const SAP_HOST = process.env.SAP_SYSTEM_HOST || 'NDB.n00.CAMPANADB02';
const SAP_USER = process.env.SAP_USER || '';
const SAP_PASS = process.env.SAP_PASS || '';
const SAP_PAGE_SIZE = Math.max(100, parseInt(process.env.SAP_PAGE_SIZE || '5000', 10));
const SAP_TIMEOUT = Math.max(10000, parseInt(process.env.SAP_TIMEOUT_MS || '120000', 10));

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '10mb' }));

// ============================================================
// Caché SOLO en memoria de Render. No hay Neon/PostgreSQL.
// ============================================================
const datasetCache = new Map();
const DATASET_CACHE_MAX = 3;

function guardarDatasetCache(key, value) {
  if (datasetCache.has(key)) datasetCache.delete(key);
  datasetCache.set(key, value);
  while (datasetCache.size > DATASET_CACHE_MAX) {
    datasetCache.delete(datasetCache.keys().next().value);
  }
}

const syncState = {
  ejecutando: false,
  estado: 'idle',
  inicio: null,
  fin: null,
  paginaActual: 0,
  skipActual: 0,
  paginasProcesadas: 0,
  registrosSAP: 0,
  registrosProcesados: 0,
  iniciadoEn: null,
  terminadoEn: null,
  error: null,
  ultimaActividad: null
};

function actualizarActividad() {
  syncState.ultimaActividad = new Date().toISOString();
}

function validarFecha(fecha) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''));
}

function parseSAPDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  const m = text.match(/\/Date\((\d+)(?:[+-]\d+)?\)\//);
  if (m) {
    const d = new Date(Number(m[1]));
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text.slice(0, 10);
  return null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function mapSAPRecord(row) {
  return {
    sap_id: row.ID || null,
    cliente: row.Cliente || null,
    nit: row.Nit != null ? String(row.Nit) : null,
    ciudad: row.Ciudad || null,
    departamento: row.Departamento || null,
    ciiu: row.CIIU || null,
    numero_factura: row.Numero_Factura != null ? String(row.Numero_Factura) : null,
    fecha_factura: parseSAPDate(row.Fecha_Factura),
    plazo: row.Plazo || null,
    cupo_credito: toNumber(row.Cupo_Credito),
    cupo_usado: toNumber(row.Cupo_Usado),
    asesor: row.Asesor || null,
    meta_anual_asesor: toNumber(row.Meta_Anual_Asesor),
    sede: row.Sede || null,
    meta_anual_sede: toNumber(row.Meta_Anual_Sede),
    nombre_almacen: row.Nombre_Almacen || null,
    codigo_articulo: row.Codigo_Articulo || null,
    articulo: row.Articulo || null,
    grupo: row.Grupo || null,
    meta_anual_grupo: toNumber(row.Meta_Anual_Grupo),
    factura_paga_total: row.Factura_Paga_Total || null,
    valor_pagado: toNumber(row.Valor_Pagado),
    valor_total_articulo: toNumber(row.Valor_Total_Articulo),
    dias_mora: toInteger(row.Dias_Mora),
    kilos: toNumber(row.Kilos),
    valor_kilo: toNumber(row.Valor_Kilo),
    costo_kilo: toNumber(row.Costo_Kilo),
    peso_unitario: toNumber(row.Peso_Unitario)
  };
}

function partesPorMes(inicio, fin) {
  const partes = [];
  let cursor = new Date(`${inicio}T00:00:00Z`);
  const ultimo = new Date(`${fin}T00:00:00Z`);

  while (cursor <= ultimo) {
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth();
    const a = cursor.toISOString().slice(0, 10);
    const ultimoDia = new Date(Date.UTC(y, m + 1, 0));
    const b = (ultimoDia < ultimo ? ultimoDia : ultimo).toISOString().slice(0, 10);
    partes.push({ inicio: a, fin: b });
    cursor = new Date(Date.UTC(y, m + 1, 1));
  }
  return partes;
}

async function consultarSAPPagina(inicio, fin, skip, top) {
  // [inicio, fin+1) evita perder registros del último día cuando SAP usa datetime.
  const finExclusivo = new Date(`${fin}T00:00:00Z`);
  finExclusivo.setUTCDate(finExclusivo.getUTCDate() + 1);
  const finOData = finExclusivo.toISOString().slice(0, 10);

  const filter =
    `Fecha_Factura ge datetime'${inicio}' and ` +
    `Fecha_Factura lt datetime'${finOData}'`;

  actualizarActividad();

  try {
    const response = await axios.get(SAP_BASE_URL, {
      params: {
        $filter: filter,
        $format: 'json',
        $top: top,
        $skip: skip,
        // Orden estable para que la paginación no cambie entre llamadas.
        $orderby: 'Fecha_Factura asc,ID asc'
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      timeout: SAP_TIMEOUT,
      headers: {
        Accept: 'application/json',
        Host: SAP_HOST
      },
      auth: SAP_USER && SAP_PASS
        ? { username: SAP_USER, password: SAP_PASS }
        : undefined
    });

    return response.data;
  } catch (error) {
    const status = error.response?.status || null;
    let detalle = error.response?.data || error.message;
    if (typeof detalle !== 'string') {
      try { detalle = JSON.stringify(detalle); } catch { detalle = String(detalle); }
    }
    const e = new Error(`SAP respondió con error${status ? ` HTTP ${status}` : ''}`);
    e.status = status;
    e.detalle = detalle;
    throw e;
  }
}

// Consulta TODO el rango directamente desde SAP y lo convierte al dataset.
// No se escribe ninguna fila en disco ni en una base de datos.
async function cargarDatasetDesdeSAP(inicio, fin) {
  const rows = [];
  let paginaGlobal = 0;

  for (const parte of partesPorMes(inicio, fin)) {
    let skip = 0;

    while (true) {
      paginaGlobal++;
      syncState.paginaActual = paginaGlobal;
      syncState.skipActual = skip;
      actualizarActividad();

      console.log(`SAP ${parte.inicio} → ${parte.fin} | página ${paginaGlobal} | skip ${skip} | top ${SAP_PAGE_SIZE}`);

      const body = await consultarSAPPagina(parte.inicio, parte.fin, skip, SAP_PAGE_SIZE);
      const resultados = body?.d?.results || body?.value || [];

      if (!resultados.length) break;

      rows.push(...resultados.map(mapSAPRecord).filter(r => r.sap_id));
      syncState.registrosSAP += resultados.length;
      syncState.registrosProcesados = rows.length;
      syncState.paginasProcesadas = paginaGlobal;
      actualizarActividad();

      if (resultados.length < SAP_PAGE_SIZE) break;
      skip += SAP_PAGE_SIZE;
    }
  }

  const dataset = buildDatasetFromFacturacion(rows);
  guardarDatasetCache(`${inicio}|${fin}`, dataset);

  return { dataset, filas: rows.length };
}

async function ejecutarSincronizacion(inicio, fin) {
  try {
    await cargarDatasetDesdeSAP(inicio, fin);

    syncState.ejecutando = false;
    syncState.estado = 'completado';
    syncState.terminadoEn = new Date().toISOString();
    actualizarActividad();

    console.log(`✓ SAP COMPLETADO: ${syncState.registrosSAP} registros, ${syncState.paginasProcesadas} páginas`);
  } catch (error) {
    console.error('✗ ERROR SAP:', error);
    syncState.ejecutando = false;
    syncState.estado = 'error';
    syncState.error = {
      mensaje: error.message,
      detalle: error.detalle || null,
      httpStatusSAP: error.status || null
    };
    syncState.terminadoEn = new Date().toISOString();
    actualizarActividad();
  }
}

// ============================================================
// RUTAS
// ============================================================
app.get('/', (req, res) => {
  res.json({
    ok: true,
    servicio: 'Backend La Campana - SAP directo',
    baseDatos: false,
    mensaje: 'SAP es la fuente de datos. Render no usa Neon ni PostgreSQL.',
    rutas: {
      health: '/health',
      syncSAP: '/sync-sap?inicio=YYYY-MM-DD&fin=YYYY-MM-DD',
      syncStatus: '/sync-status',
      dataset: '/dataset?fecha_inicio=YYYY-MM-DD&fecha_fin=YYYY-MM-DD',
      facturacion: '/facturacion?fecha_inicio=YYYY-MM-DD&fecha_fin=YYYY-MM-DD&limit=1000&offset=0'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    estado: 'ok',
    baseDatos: false,
    sap: SAP_BASE_URL,
    sincronizacion: syncState,
    fecha: new Date().toISOString()
  });
});

app.get('/sync-status', (req, res) => {
  res.json({
    ok: true,
    ejecutando: syncState.ejecutando,
    estado: syncState.estado,
    paginaActual: syncState.paginaActual,
    registrosSAP: syncState.registrosSAP,
    registrosProcesados: syncState.registrosProcesados,
    error: syncState.error,
    sincronizacion: {
      ...syncState,
      paginaSize: SAP_PAGE_SIZE
    }
  });
});

app.get('/sync-sap', async (req, res) => {
  const inicio = req.query.inicio || '2026-08-01';
  const fin = req.query.fin || '2026-08-27';
  const forzar = req.query.forzar === '1' || req.query.forzar === 'true';

  if (!validarFecha(inicio) || !validarFecha(fin)) {
    return res.status(400).json({ ok: false, error: 'Las fechas deben tener formato YYYY-MM-DD' });
  }
  if (inicio > fin) {
    return res.status(400).json({ ok: false, error: 'La fecha inicio no puede ser mayor que la fecha fin' });
  }

  const key = `${inicio}|${fin}`;
  if (!forzar && datasetCache.has(key) && !syncState.ejecutando) {
    return res.json({
      ok: true,
      yaSincronizado: true,
      mensaje: 'El dataset de este rango ya está disponible en la memoria de Render.',
      fechas: { inicio, fin }
    });
  }

  if (syncState.ejecutando) {
    return res.status(409).json({
      ok: false,
      mensaje: 'Ya existe una sincronización SAP en ejecución',
      sincronizacion: syncState
    });
  }

  datasetCache.clear();
  Object.assign(syncState, {
    ejecutando: true,
    estado: 'procesando',
    inicio,
    fin,
    paginaActual: 0,
    skipActual: 0,
    paginasProcesadas: 0,
    registrosSAP: 0,
    registrosProcesados: 0,
    iniciadoEn: new Date().toISOString(),
    terminadoEn: null,
    error: null
  });
  actualizarActividad();

  ejecutarSincronizacion(inicio, fin);

  return res.status(202).json({
    ok: true,
    mensaje: 'Consulta SAP iniciada en segundo plano',
    fechas: { inicio, fin },
    paginaSize: SAP_PAGE_SIZE,
    estado: 'procesando',
    consultarEstado: '/sync-status'
  });
});

app.get('/dataset', async (req, res) => {
  const fecha_inicio = req.query.fecha_inicio || '2026-08-01';
  const fecha_fin = req.query.fecha_fin || '2026-08-27';

  if (!validarFecha(fecha_inicio) || !validarFecha(fecha_fin)) {
    return res.status(400).json({ ok: false, error: 'Las fechas deben tener formato YYYY-MM-DD' });
  }
  if (fecha_inicio > fecha_fin) {
    return res.status(400).json({ ok: false, error: 'La fecha inicio no puede ser mayor que la fecha fin' });
  }

  const key = `${fecha_inicio}|${fecha_fin}`;
  const cached = datasetCache.get(key);
  if (cached) {
    return res.json({ ok: true, cached: true, data: cached.DATA, inv: cached.INV || {}, fechas: { inicio: fecha_inicio, fin: fecha_fin } });
  }

  // Si el botón no se usó, /dataset también funciona por sí solo.
  // Esto hace que el dashboard pueda pedir un rango y Render consulte SAP.
  if (syncState.ejecutando) {
    return res.status(409).json({
      ok: false,
      error: 'SAP está actualizando datos. Espera a que /sync-status indique completado.',
      sincronizacion: syncState
    });
  }

  try {
    const result = await cargarDatasetDesdeSAP(fecha_inicio, fecha_fin);
    return res.json({
      ok: true,
      cached: false,
      data: result.dataset.DATA,
      inv: result.dataset.INV || {},
      fechas: { inicio: fecha_inicio, fin: fecha_fin },
      filasProcesadas: result.filas
    });
  } catch (error) {
    return res.status(error.status === 503 ? 503 : 500).json({
      ok: false,
      error: error.message,
      detalle: error.detalle || null,
      httpStatusSAP: error.status || null
    });
  }
});

// Compatibilidad con páginas que todavía consumen /facturacion.
// Se consulta directamente SAP; nunca PostgreSQL.
app.get('/facturacion', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 1000, 1), 1000);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const inicio = req.query.fecha_inicio || '2026-08-01';
  const fin = req.query.fecha_fin || '2026-08-27';

  if (!validarFecha(inicio) || !validarFecha(fin)) {
    return res.status(400).json({ ok: false, error: 'Las fechas deben tener formato YYYY-MM-DD' });
  }

  try {
    // Para compatibilidad: SAP acepta skip/top directamente.
    const body = await consultarSAPPagina(inicio, fin, offset, limit);
    const data = (body?.d?.results || body?.value || []).map(mapSAPRecord).filter(r => r.sap_id);
    return res.json({
      ok: true,
      data,
      total: null,
      limit,
      offset,
      fuente: 'SAP',
      fechas: { inicio, fin }
    });
  } catch (error) {
    return res.status(error.status === 503 ? 503 : 500).json({
      ok: false,
      error: error.message,
      detalle: error.detalle || null,
      httpStatusSAP: error.status || null
    });
  }
});

// Los endpoints antiguos de dashboard quedan como alias al dataset,
// evitando consultas a una base de datos inexistente.
for (const ruta of [
  'hoja-asesor',
  'hoja-cliente',
  'labor-comercial',
  'portafolio-cartera',
  'planeacion-nogales'
]) {
  app.get(`/dashboards/${ruta}`, async (req, res) => {
    const fecha_inicio = req.query.inicio || req.query.fecha_inicio || '2026-08-01';
    const fecha_fin = req.query.fin || req.query.fecha_fin || '2026-08-27';
    try {
      const key = `${fecha_inicio}|${fecha_fin}`;
      let dataset = datasetCache.get(key);
      if (!dataset) dataset = (await cargarDatasetDesdeSAP(fecha_inicio, fecha_fin)).dataset;
      res.json({ ok: true, data: dataset.DATA, inv: dataset.INV || {}, fechas: { inicio: fecha_inicio, fin: fecha_fin } });
    } catch (error) {
      res.status(error.status === 503 ? 503 : 500).json({
        ok: false, error: error.message, detalle: error.detalle || null
      });
    }
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log('===========================================');
  console.log('BACKEND LA CAMPANA - SIN NEON');
  console.log(`✓ Server running on port ${PORT}`);
  console.log('✓ SAP:', SAP_BASE_URL);
  console.log('✓ SAP PAGE SIZE:', SAP_PAGE_SIZE);
  console.log('✓ PostgreSQL/Neon: DESACTIVADO');
  console.log('===========================================');
});
