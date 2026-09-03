require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const https = require('https');
const buildDatasetFromFacturacion = require('./dataset');
const { crearAcumulador, acumularFila, finalizarDataset } = buildDatasetFromFacturacion;

// Cuántas filas crudas (mapeadas de SAP) mantenemos como máximo en RAM
// por rango, solo para que /facturacion pueda mostrar/paginar el detalle
// línea por línea. El dataset agregado (el que usan los 7 dashboards) YA
// NO depende de este límite: se construye incrementalmente, página por
// página, sin necesitar el arreglo completo de filas crudas.
const MAX_FILAS_CRUDAS_CACHE = parseInt(process.env.SAP_MAX_FILAS_CRUDAS, 10) || 20000;

// Las 5 agrupaciones que usan los dashboards de "Hoja de Ruta 6". Se
// calculan incrementalmente (igual que el dataset) mientras se pagina
// SAP, para que estos endpoints también reflejen el rango completo sin
// depender del arreglo de filas crudas (que está acotado).
const DEFINICIONES_AGRUPADORES = {
  'hoja-asesor': ['asesor'],
  'hoja-cliente': ['cliente', 'nit', 'ciudad'],
  'labor-comercial': ['sede', 'asesor'],
  'portafolio-cartera': ['grupo', 'codigo_articulo', 'articulo'],
  'planeacion-nogales': ['sede', 'nombre_almacen', 'grupo']
};

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// CONFIGURACIÓN SAP
// ============================================================
// SAP es la ÚNICA fuente de datos. Ya no hay Neon/PostgreSQL: en vez de
// sincronizar filas hacia una base de datos, este backend consulta SAP
// directamente en cada request y guarda el resultado en memoria (RAM del
// proceso de Render) durante un rato, para no golpear SAP en cada clic.
// Si Render reinicia el proceso, ese caché en memoria se vacía y todo se
// vuelve a traer de SAP — no se pierde nada permanente porque nunca hubo
// nada guardado de forma permanente: SAP sigue teniendo todos los datos.

const DEFAULT_SAP_URL =
  'https://170.239.154.46:4300/api_campana26/facturacion.xsodata/Facturacion';

let SAP_BASE_URL =
  process.env.SAP_SERVICE_URL ||
  process.env.SAP_BASE_URL ||
  DEFAULT_SAP_URL;

// ------------------------------------------------------------
// Evitar URL mal formada por variables de Render.
// Si accidentalmente quedó algo como:
//
// https://IP:4300/https://IP:4300/api...
//
// se corrige automáticamente.
// ------------------------------------------------------------
function normalizarSAPUrl(url) {
  if (!url) return DEFAULT_SAP_URL;

  let resultado = String(url).trim();

  const segundaUrl = resultado.indexOf('https://', 8);
  if (segundaUrl !== -1) resultado = resultado.substring(segundaUrl);

  const terceraUrl = resultado.indexOf('http://', 8);
  if (terceraUrl !== -1) resultado = resultado.substring(terceraUrl);

  return resultado;
}

SAP_BASE_URL = normalizarSAPUrl(SAP_BASE_URL);

const SAP_HOST = process.env.SAP_SYSTEM_HOST || 'NDB.n00.CAMPANADB02';
const SAP_USER = process.env.SAP_USER || '';
const SAP_PASS = process.env.SAP_PASS || '';

const SAP_PAGE_SIZE = parseInt(process.env.SAP_PAGE_SIZE || '5000', 10);

// Cuántos minutos se conserva en memoria un rango ya consultado a SAP
// antes de volver a pedirlo. Se puede ajustar con la variable de entorno
// SAP_CACHE_MINUTOS en Render (0 desactiva el caché por completo).
const SAP_CACHE_MINUTOS = parseFloat(process.env.SAP_CACHE_MINUTOS || '30');

// Cuántos rangos de fechas distintos se guardan en memoria a la vez.
// Al superar este número, se descarta el rango usado hace más tiempo.
const MAX_RANGOS_EN_CACHE = 6;

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '10mb' }));

// ============================================================
// CACHÉ EN MEMORIA (reemplaza a Neon/PostgreSQL)
// ============================================================
// Cada entrada: clave "inicio|fin" -> { filas, dataset, creadoEn }
// - filas: filas crudas ya mapeadas desde SAP (mismo formato que antes
//   guardaba la tabla facturacion de Postgres).
// - dataset: el dataset agregado (buildDatasetFromFacturacion), calculado
//   perezosamente la primera vez que se pide /dataset para ese rango.
const filasCache = new Map();

// Evita pedirle a SAP el mismo rango dos veces en paralelo (por ejemplo,
// si /dataset y /facturacion llegan casi al tiempo para el mismo rango).
const descargasEnCurso = new Map();

function claveRango(inicio, fin) {
  return `${inicio}|${fin}`;
}

function obtenerEntradaCache(inicio, fin) {
  const key = claveRango(inicio, fin);
  const entry = filasCache.get(key);
  if (!entry) return null;

  if (SAP_CACHE_MINUTOS > 0) {
    const edadMin = (Date.now() - entry.creadoEn) / 60000;
    if (edadMin > SAP_CACHE_MINUTOS) {
      filasCache.delete(key);
      return null;
    }
  } else if (SAP_CACHE_MINUTOS <= 0) {
    return null;
  }

  return entry;
}

function guardarFilasEnCache(inicio, fin, resultado) {
  const key = claveRango(inicio, fin);
  if (filasCache.has(key)) filasCache.delete(key);
  filasCache.set(key, {
    filas: resultado.filas,
    dataset: resultado.dataset,
    agrupados: resultado.agrupados,
    totalRegistros: resultado.totalRegistros,
    filasCrudasTruncadas: resultado.filasCrudasTruncadas,
    creadoEn: Date.now()
  });
  while (filasCache.size > MAX_RANGOS_EN_CACHE) {
    filasCache.delete(filasCache.keys().next().value);
  }
}

// ============================================================
// ESTADO GLOBAL DE SINCRONIZACIÓN (para el botón "Actualizar desde SAP")
// ============================================================

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

// ============================================================
// INFORMACIÓN DE ARRANQUE
// ============================================================

console.log('===========================================');
console.log('BACKEND LA CAMPANA (sin base de datos, SAP en vivo)');
console.log('===========================================');
console.log('SAP:', SAP_BASE_URL);
console.log('SAP HOST:', SAP_HOST);
console.log('SAP PAGE SIZE:', SAP_PAGE_SIZE);
console.log('CACHÉ EN MEMORIA (minutos):', SAP_CACHE_MINUTOS);
console.log('SAP USER CONFIGURADO:', Boolean(SAP_USER));
console.log('SAP PASSWORD CONFIGURADA:', Boolean(SAP_PASS));
console.log('===========================================');

// ============================================================
// UTILIDADES
// ============================================================

function parseSAPDate(value) {
  if (!value) return null;

  if (value instanceof Date) return value.toISOString().slice(0, 10);

  const text = String(value);

  // SAP OData: /Date(1787788800000)/
  const match = text.match(/\/Date\((\d+)(?:[+-]\d+)?\)\//);
  if (match) {
    const timestamp = Number(match[1]);
    if (!Number.isNaN(timestamp)) {
      return new Date(timestamp).toISOString().slice(0, 10);
    }
  }

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  // ISO
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text.slice(0, 10);

  return null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = parseInt(value, 10);
  return Number.isFinite(number) ? number : null;
}

function actualizarActividad() {
  syncState.ultimaActividad = new Date().toISOString();
}

function validarFecha(fecha) {
  return /^\d{4}-\d{2}-\d{2}$/.test(fecha);
}

// ============================================================
// RUTA PRINCIPAL
// ============================================================

app.get('/', (req, res) => {
  res.json({
    ok: true,
    servicio: 'Backend La Campana',
    mensaje: 'Servidor funcionando correctamente (SAP en vivo, sin base de datos)',
    rutas: {
      health: '/health',
      syncSAP: '/sync-sap?inicio=YYYY-MM-DD&fin=YYYY-MM-DD',
      syncStatus: '/sync-status',
      dataset: '/dataset?fecha_inicio=YYYY-MM-DD&fecha_fin=YYYY-MM-DD',
      facturacion: '/facturacion',
      hojaAsesor: '/dashboards/hoja-asesor',
      hojaCliente: '/dashboards/hoja-cliente',
      laborComercial: '/dashboards/labor-comercial',
      portafolioCartera: '/dashboards/portafolio-cartera',
      planeacionNogales: '/dashboards/planeacion-nogales'
    }
  });
});

// ============================================================
// HEALTH
// ============================================================

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    estado: 'ok',
    fuenteDatos: 'SAP (en vivo, sin base de datos)',
    cache: {
      rangosGuardados: filasCache.size,
      minutosDeVida: SAP_CACHE_MINUTOS
    },
    sincronizacion: {
      ejecutando: syncState.ejecutando,
      estado: syncState.estado,
      paginaActual: syncState.paginaActual,
      paginasProcesadas: syncState.paginasProcesadas,
      registrosSAP: syncState.registrosSAP,
      registrosProcesados: syncState.registrosProcesados
    },
    fecha: new Date().toISOString()
  });
});

// ============================================================
// ESTADO DE SINCRONIZACIÓN
// ============================================================

app.get('/sync-status', (req, res) => {
  res.json({
    ok: true,
    sincronizacion: {
      ejecutando: syncState.ejecutando,
      estado: syncState.estado,
      inicio: syncState.inicio,
      fin: syncState.fin,
      paginaActual: syncState.paginaActual,
      skipActual: syncState.skipActual,
      paginasProcesadas: syncState.paginasProcesadas,
      paginaSize: SAP_PAGE_SIZE,
      registrosSAP: syncState.registrosSAP,
      registrosProcesados: syncState.registrosProcesados,
      iniciadoEn: syncState.iniciadoEn,
      terminadoEn: syncState.terminadoEn,
      ultimaActividad: syncState.ultimaActividad,
      error: syncState.error
    }
  });
});

// ============================================================
// CONSULTAR SAP - UNA PÁGINA
// ============================================================

async function consultarSAPPagina(inicio, fin, skip, top) {
  // Usamos un rango semiabierto [inicio, fin+1 día) para no perder
  // registros del último día cuando SAP guarda la fecha como datetime.
  const finExclusivo = new Date(`${fin}T00:00:00Z`);
  finExclusivo.setUTCDate(finExclusivo.getUTCDate() + 1);
  const finOData = finExclusivo.toISOString().slice(0, 10);

  const filter =
    `Fecha_Factura ge datetime'${inicio}' and ` +
    `Fecha_Factura lt datetime'${finOData}'`;

  console.log(`Consultando SAP: ${inicio} → ${fin} | skip=${skip} | top=${top}`);
  actualizarActividad();

  try {
    const response = await axios.get(SAP_BASE_URL, {
      params: { $filter: filter, $format: 'json', $top: top, $skip: skip },
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      timeout: 120000,
      headers: { Accept: 'application/json', Host: SAP_HOST },
      auth: SAP_USER && SAP_PASS ? { username: SAP_USER, password: SAP_PASS } : undefined
    });

    console.log(`✓ SAP respondió HTTP ${response.status}`);
    actualizarActividad();

    return response.data;
  } catch (error) {
    const status = error.response?.status || null;
    let detalle = error.response?.data || error.message;

    if (typeof detalle !== 'string') {
      try {
        detalle = JSON.stringify(detalle);
      } catch {
        detalle = String(detalle);
      }
    }

    const nuevoError = new Error(`SAP respondió con error${status ? ` HTTP ${status}` : ''}`);
    nuevoError.status = status;
    nuevoError.detalle = detalle;
    throw nuevoError;
  }
}

// ============================================================
// MAPEAR REGISTRO SAP
// ============================================================

function mapSAPRecord(row) {
  return {
    sap_id: row.ID || null,
    cliente: row.Cliente || null,
    nit: row.Nit !== null && row.Nit !== undefined ? String(row.Nit) : null,
    ciudad: row.Ciudad || null,
    departamento: row.Departamento || null,
    ciiu: row.CIIU || null,
    numero_factura:
      row.Numero_Factura !== null && row.Numero_Factura !== undefined
        ? String(row.Numero_Factura)
        : null,
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

// ============================================================
// DESCARGAR UN RANGO COMPLETO DESDE SAP (paginando por mes)
// ============================================================
// Reemplaza a la vieja "ejecutarSincronizacion": en vez de guardar cada
// lote en Postgres, va acumulando las filas mapeadas en un arreglo en
// memoria y las devuelve al terminar. Si actualizarEstado=true, además
// va reportando el progreso en syncState (lo usa /sync-sap para que el
// botón del frontend muestre "sincronizando X/Y").

// Mantiene una ventana acotada (por defecto 20.000) con las filas crudas
// MÁS RECIENTES vistas hasta ahora, sin dejar crecer el arreglo sin
// límite. Como SAP se recorre mes por mes en orden cronológico, esto
// aproxima bien "las filas más recientes" que es lo que necesita
// /facturacion (ordena por fecha descendente). Se poda cada cierto
// número de inserciones en vez de en cada una, para que el costo de
// recortar el arreglo no se pague en cada fila.
function agregarFilaCruda(buffer, r, cap) {
  buffer.push(r);
  if (buffer.length > cap + Math.ceil(cap * 0.2)) {
    buffer.splice(0, buffer.length - cap);
  }
}

async function descargarRangoDesdeSAP(inicio, fin, actualizarEstado) {
  // Ya NO se acumulan las ~200.000 filas crudas en un arreglo antes de
  // agregarlas: el dataset comercial se va construyendo fila por fila a
  // medida que llega cada página de SAP (acumularFila). El uso de
  // memoria queda proporcional al número de clientes/asesores/artículos
  // distintos (cientos), no al número de líneas de factura (cientos de
  // miles). Solo se conserva, aparte, una ventana acotada de filas
  // crudas (MAX_FILAS_CRUDAS_CACHE) para que /facturacion pueda seguir
  // mostrando/paginando el detalle línea por línea.
  const acc = crearAcumulador();
  const filas = [];
  let totalRegistros = 0;

  const agrupadores = {};
  for (const nombre in DEFINICIONES_AGRUPADORES) {
    agrupadores[nombre] = crearAgrupador(DEFINICIONES_AGRUPADORES[nombre]);
  }

  // SAP puede tener límites prácticos para consultas muy grandes.
  // Dividimos automáticamente cualquier rango en meses y paginamos cada
  // mes hasta terminar. Así funcionan rangos de días, meses, 2 años, 3
  // años o más sin depender de un único request gigante.
  const partes = [];
  let cursor = new Date(`${inicio}T00:00:00Z`);
  const ultimo = new Date(`${fin}T00:00:00Z`);

  while (cursor <= ultimo) {
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth();
    const inicioParte = cursor.toISOString().slice(0, 10);
    const ultimoDia = new Date(Date.UTC(y, m + 1, 0));
    const finParteDate = ultimoDia < ultimo ? ultimoDia : ultimo;
    const finParte = finParteDate.toISOString().slice(0, 10);
    partes.push({ inicio: inicioParte, fin: finParte });
    cursor = new Date(Date.UTC(y, m + 1, 1));
  }

  let paginaGlobal = 0;

  for (const parte of partes) {
    let skip = 0;
    let paginaMes = 0;

    while (true) {
      paginaMes++;
      paginaGlobal++;

      if (actualizarEstado) {
        syncState.paginaActual = paginaGlobal;
        syncState.skipActual = skip;
        actualizarActividad();
      }

      console.log('===========================================');
      console.log(`Consultando SAP ${parte.inicio} → ${parte.fin} | página ${paginaMes} | skip ${skip} | top ${SAP_PAGE_SIZE}`);

      const data = await consultarSAPPagina(parte.inicio, parte.fin, skip, SAP_PAGE_SIZE);
      const resultados = data?.d?.results || [];
      const cantidad = resultados.length;
      console.log(`SAP devolvió ${cantidad} registros`);

      if (cantidad === 0) break;

      const registros = resultados.map(mapSAPRecord).filter(r => r.sap_id);

      // Agregar esta página al dataset comercial YA, y soltarla: no se
      // guarda un arreglo con las filas crudas completas del rango.
      for (const r of registros) {
        acumularFila(acc, r);
        agregarFilaCruda(filas, r, MAX_FILAS_CRUDAS_CACHE);
        for (const nombre in agrupadores) agregarFilaAgrupador(agrupadores[nombre], r);
      }
      totalRegistros += registros.length;

      if (actualizarEstado) {
        syncState.registrosSAP += cantidad;
        syncState.registrosProcesados += registros.length;
        syncState.paginasProcesadas = paginaGlobal;
        actualizarActividad();
      }

      console.log(`✓ ${parte.inicio} → ${parte.fin}: página ${paginaMes} procesada`);
      console.log(`✓ Total agregado hasta ahora: ${totalRegistros} (filas crudas en ventana: ${filas.length}${totalRegistros > MAX_FILAS_CRUDAS_CACHE ? ', recortada' : ''})`);

      if (cantidad < SAP_PAGE_SIZE) break;
      skip += SAP_PAGE_SIZE;
    }
  }

  // Recorte final por si quedó por encima del cap tras la última página.
  if (filas.length > MAX_FILAS_CRUDAS_CACHE) filas.splice(0, filas.length - MAX_FILAS_CRUDAS_CACHE);

  const dataset = finalizarDataset(acc);
  const filasCrudasTruncadas = totalRegistros > MAX_FILAS_CRUDAS_CACHE;

  const agrupados = {};
  for (const nombre in agrupadores) agrupados[nombre] = finalizarAgrupador(agrupadores[nombre]);

  return { filas, dataset, agrupados, totalRegistros, filasCrudasTruncadas };
}

// ============================================================
// OBTENER FILAS (caché en memoria o SAP en vivo)
// ============================================================
// Punto de entrada único que usan /dataset, /facturacion y todos los
// /dashboards/*. Si el rango ya está en caché y no ha caducado, no
// vuelve a tocar SAP. Si dos requests piden el mismo rango al mismo
// tiempo, comparten la misma descarga en vez de duplicarla.

function iniciarDescarga(inicio, fin, opciones) {
  const key = claveRango(inicio, fin);

  if (descargasEnCurso.has(key)) {
    return descargasEnCurso.get(key);
  }

  const promesa = descargarRangoDesdeSAP(inicio, fin, opciones && opciones.actualizarEstado)
    .then(resultado => {
      guardarFilasEnCache(inicio, fin, resultado);
      return resultado;
    })
    .finally(() => descargasEnCurso.delete(key));

  descargasEnCurso.set(key, promesa);
  return promesa;
}

async function obtenerFilas(inicio, fin, { forzar = false } = {}) {
  if (!forzar) {
    const entry = obtenerEntradaCache(inicio, fin);
    if (entry) return { filas: entry.filas, totalRegistros: entry.totalRegistros, filasCrudasTruncadas: entry.filasCrudasTruncadas, deCache: true };
  }

  const resultado = await iniciarDescarga(inicio, fin);
  return { filas: resultado.filas, totalRegistros: resultado.totalRegistros, filasCrudasTruncadas: resultado.filasCrudasTruncadas, deCache: false };
}

async function obtenerDataset(inicio, fin, opciones) {
  // El dataset agregado ya viene calculado desde descargarRangoDesdeSAP
  // (se construyó incrementalmente mientras se paginaba SAP), así que
  // aquí ya no se vuelve a recorrer ningún arreglo grande para agregarlo.
  if (!(opciones && opciones.forzar)) {
    const entry = obtenerEntradaCache(inicio, fin);
    if (entry) return { dataset: entry.dataset, filas: entry.filas, totalRegistros: entry.totalRegistros, deCache: true };
  }

  const resultado = await iniciarDescarga(inicio, fin);
  return { dataset: resultado.dataset, filas: resultado.filas, totalRegistros: resultado.totalRegistros, deCache: false };
}

// Usado por los 5 dashboards de "Hoja de Ruta 6": devuelve la agrupación
// ya calculada durante la descarga (agrupados[nombre]), sin volver a
// recorrer ningún arreglo de filas crudas.
async function obtenerAgrupado(inicio, fin, nombre, { forzar = false } = {}) {
  if (!forzar) {
    const entry = obtenerEntradaCache(inicio, fin);
    if (entry) return { grupos: entry.agrupados[nombre], deCache: true };
  }

  const resultado = await iniciarDescarga(inicio, fin);
  return { grupos: resultado.agrupados[nombre], deCache: false };
}

// ============================================================
// AGREGACIÓN EN MEMORIA (reemplaza los GROUP BY que hacía Postgres)
// ============================================================

function crearAgrupador(camposClave, filtro) {
  return { camposClave, filtro, grupos: new Map() };
}

function agregarFilaAgrupador(agrupador, r) {
  const { camposClave, filtro, grupos } = agrupador;
  if (filtro && !filtro(r)) return;

  const claveVals = camposClave.map(c => (r[c] === undefined ? null : r[c]));
  if (!claveVals[0]) return; // el primer campo de la clave es obligatorio (igual que "X IS NOT NULL" en SQL)

  const claveStr = claveVals.join('\u0001');
  let g = grupos.get(claveStr);

  if (!g) {
    g = { _lineas: 0, _facturas: new Set(), _monto: 0, _pagado: 0, _kilos: 0, _pagadas: 0, _maxDiasMora: 0, _ultimaFactura: null };
    camposClave.forEach((c, i) => { g[c] = claveVals[i]; });
    grupos.set(claveStr, g);
  }

  g._lineas++;
  if (r.numero_factura) g._facturas.add(r.numero_factura);
  g._monto += Number(r.valor_total_articulo) || 0;
  g._pagado += Number(r.valor_pagado) || 0;
  g._kilos += Number(r.kilos) || 0;
  if ((r.factura_paga_total || '').toString().toUpperCase() === 'SI') g._pagadas++;

  const dm = Number(r.dias_mora) || 0;
  if (dm > g._maxDiasMora) g._maxDiasMora = dm;

  if (r.fecha_factura && (!g._ultimaFactura || r.fecha_factura > g._ultimaFactura)) {
    g._ultimaFactura = r.fecha_factura;
  }
}

function finalizarAgrupador(agrupador) {
  return [...agrupador.grupos.values()];
}

// Compatibilidad: agrupa un arreglo ya completo en memoria (no se usa en
// el camino de descarga de SAP, que ahora agrupa incrementalmente).
function agruparFacturacion(filas, camposClave, filtro) {
  const agrupador = crearAgrupador(camposClave, filtro);
  for (const r of filas) agregarFilaAgrupador(agrupador, r);
  return finalizarAgrupador(agrupador);
}

// ============================================================
// SYNC-SAP (precalienta el caché en memoria — ya NO escribe en ninguna
// base de datos; solo deja las filas listas en RAM para que /dataset y
// /facturacion respondan al instante después)
// ============================================================

app.get('/sync-sap', async (req, res) => {
  const inicio = req.query.inicio || '2026-08-01';
  const fin = req.query.fin || '2026-08-27';
  const forzar = req.query.forzar === '1' || req.query.forzar === 'true';

  if (!validarFecha(inicio) || !validarFecha(fin)) {
    return res.status(400).json({
      ok: false,
      error: 'Las fechas deben tener formato YYYY-MM-DD',
      ejemplo: '/sync-sap?inicio=2026-08-01&fin=2026-08-27'
    });
  }

  if (inicio > fin) {
    return res.status(400).json({ ok: false, error: 'La fecha inicio no puede ser mayor que la fecha fin' });
  }

  // Si este mismo rango ya está fresco en memoria, no volvemos a golpear SAP.
  if (!forzar) {
    const entry = obtenerEntradaCache(inicio, fin);
    if (entry) {
      return res.status(200).json({
        ok: true,
        yaSincronizado: true,
        mensaje: `Este rango ya se consultó hace poco (${entry.totalRegistros} registros agregados${entry.filasCrudasTruncadas ? `, detalle crudo limitado a las últimas ${MAX_FILAS_CRUDAS_CACHE}` : ''}, guardados en memoria de Render). No se volvió a consultar SAP.`,
        sincronizadoEn: new Date(entry.creadoEn).toISOString(),
        registros: entry.totalRegistros,
        fechas: { inicio, fin },
        forzarConsulta: `/sync-sap?inicio=${inicio}&fin=${fin}&forzar=1`
      });
    }
  }

  if (syncState.ejecutando) {
    return res.status(409).json({
      ok: false,
      mensaje: 'Ya existe una sincronización SAP en ejecución',
      sincronizacion: {
        estado: syncState.estado,
        inicio: syncState.inicio,
        fin: syncState.fin,
        paginaActual: syncState.paginaActual,
        paginasProcesadas: syncState.paginasProcesadas,
        registrosSAP: syncState.registrosSAP,
        registrosProcesados: syncState.registrosProcesados
      },
      consultarEstado: '/sync-status'
    });
  }

  syncState.ejecutando = true;
  syncState.estado = 'procesando';
  syncState.inicio = inicio;
  syncState.fin = fin;
  syncState.paginaActual = 0;
  syncState.skipActual = 0;
  syncState.paginasProcesadas = 0;
  syncState.registrosSAP = 0;
  syncState.registrosProcesados = 0;
  syncState.iniciadoEn = new Date().toISOString();
  syncState.terminadoEn = null;
  syncState.error = null;
  actualizarActividad();

  console.log('===========================================');
  console.log('SYNC SAP INICIADA EN SEGUNDO PLANO');
  console.log(`${inicio} → ${fin}`);
  console.log('===========================================');

  iniciarDescarga(inicio, fin, { actualizarEstado: true })
    .then(resultado => {
      syncState.ejecutando = false;
      syncState.estado = 'completado';
      syncState.terminadoEn = new Date().toISOString();
      actualizarActividad();

      console.log('===========================================');
      console.log('✓ CONSULTA SAP COMPLETADA');
      console.log(`✓ Registros agregados: ${resultado.totalRegistros} (detalle crudo en memoria: ${resultado.filas.length}${resultado.filasCrudasTruncadas ? ', truncado' : ''})`);
      console.log('===========================================');
    })
    .catch(error => {
      console.error('===========================================');
      console.error('✗ ERROR CONSULTANDO SAP');
      console.error(error);
      console.error('===========================================');

      syncState.ejecutando = false;
      syncState.estado = 'error';
      syncState.error = {
        mensaje: error.message,
        detalle: error.detalle || null,
        httpStatusSAP: error.status || null
      };
      syncState.terminadoEn = new Date().toISOString();
      actualizarActividad();
    });

  return res.status(202).json({
    ok: true,
    mensaje: 'Consulta a SAP iniciada en segundo plano',
    fechas: { inicio, fin },
    paginaSize: SAP_PAGE_SIZE,
    estado: 'procesando',
    consultarEstado: '/sync-status'
  });
});

// ============================================================
// DATASET COMERCIAL PREAGREGADO
// ============================================================

app.get('/dataset', async (req, res) => {
  const fecha_inicio = req.query.fecha_inicio || '2026-08-01';
  const fecha_fin = req.query.fecha_fin || '2026-08-27';

  if (!validarFecha(fecha_inicio) || !validarFecha(fecha_fin)) {
    return res.status(400).json({ ok: false, error: 'Las fechas deben tener formato YYYY-MM-DD' });
  }

  if (fecha_inicio > fecha_fin) {
    return res.status(400).json({ ok: false, error: 'La fecha inicio no puede ser mayor que la fecha fin' });
  }

  try {
    const { dataset, totalRegistros, deCache } = await obtenerDataset(fecha_inicio, fecha_fin);

    return res.json({
      ok: true,
      cached: deCache,
      data: dataset.DATA,
      inv: dataset.INV,
      fechas: { inicio: fecha_inicio, fin: fecha_fin },
      filasProcesadas: totalRegistros
    });
  } catch (error) {
    console.error('Error en /dataset:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// ============================================================
// FACTURACIÓN (filas crudas, paginadas)
// ============================================================

app.get('/facturacion', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 1000);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const fecha_inicio = req.query.fecha_inicio || '2026-08-01';
  const fecha_fin = req.query.fecha_fin || '2026-08-27';

  if (!validarFecha(fecha_inicio) || !validarFecha(fecha_fin)) {
    return res.status(400).json({ ok: false, error: 'Las fechas deben tener formato YYYY-MM-DD' });
  }

  try {
    const { filas, totalRegistros, filasCrudasTruncadas } = await obtenerFilas(fecha_inicio, fecha_fin);

    const ordenadas = [...filas].sort((a, b) => {
      const fa = a.fecha_factura || '';
      const fb = b.fecha_factura || '';
      if (fa !== fb) return fb.localeCompare(fa);
      return String(b.sap_id || '').localeCompare(String(a.sap_id || ''));
    });

    const pagina = ordenadas.slice(offset, offset + limit);

    res.json({
      ok: true,
      data: pagina,
      total: totalRegistros,
      // Si el rango tiene más registros que MAX_FILAS_CRUDAS_CACHE, el
      // detalle línea por línea solo cubre las filas más recientes vistas
      // (los dashboards agregados en /dataset SÍ cubren el rango completo).
      detalleTruncado: Boolean(filasCrudasTruncadas),
      detalleDisponible: filas.length,
      limit,
      offset,
      fechas: { inicio: fecha_inicio, fin: fecha_fin }
    });
  } catch (error) {
    console.error('Error en /facturacion:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============================================================
// HOJA DE ASESOR
// ============================================================

app.get('/dashboards/hoja-asesor', async (req, res) => {
  const inicio = req.query.inicio || '2026-08-01';
  const fin = req.query.fin || '2026-08-27';

  try {
    const { grupos } = await obtenerAgrupado(inicio, fin, 'hoja-asesor');

    const data = grupos
      .map(g => ({
        asesor: g.asesor,
        total_lineas: g._lineas,
        total_facturas: g._facturas.size,
        total_monto: Math.round(g._monto * 100) / 100,
        total_pagado: Math.round(g._pagado * 100) / 100,
        total_kilos: Math.round(g._kilos * 10000) / 10000,
        promedio_valor_kilo: g._kilos > 0 ? Math.round((g._monto / g._kilos) * 10000) / 10000 : 0,
        lineas_pagadas: g._pagadas
      }))
      .sort((a, b) => b.total_monto - a.total_monto);

    res.json({ ok: true, data, fechas: { inicio, fin } });
  } catch (error) {
    console.error('Error en hoja-asesor:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============================================================
// HOJA DE CLIENTE
// ============================================================

app.get('/dashboards/hoja-cliente', async (req, res) => {
  const inicio = req.query.inicio || '2026-08-01';
  const fin = req.query.fin || '2026-08-27';

  try {
    const { grupos } = await obtenerAgrupado(inicio, fin, 'hoja-cliente');

    const data = grupos
      .map(g => ({
        cliente: g.cliente,
        nit: g.nit,
        ciudad: g.ciudad,
        total_lineas: g._lineas,
        total_facturas: g._facturas.size,
        total_monto: Math.round(g._monto * 100) / 100,
        total_pagado: Math.round(g._pagado * 100) / 100,
        total_kilos: Math.round(g._kilos * 10000) / 10000,
        ultima_factura: g._ultimaFactura,
        lineas_pagadas: g._pagadas,
        max_dias_mora: g._maxDiasMora
      }))
      .sort((a, b) => b.total_monto - a.total_monto)
      .slice(0, 100);

    res.json({ ok: true, data, fechas: { inicio, fin } });
  } catch (error) {
    console.error('Error en hoja-cliente:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============================================================
// LABOR COMERCIAL
// ============================================================

app.get('/dashboards/labor-comercial', async (req, res) => {
  const inicio = req.query.inicio || '2026-08-01';
  const fin = req.query.fin || '2026-08-27';

  try {
    const { grupos } = await obtenerAgrupado(inicio, fin, 'labor-comercial');

    const data = grupos
      .map(g => ({
        sede: g.sede,
        asesor: g.asesor,
        total_lineas: g._lineas,
        total_facturas: g._facturas.size,
        total_monto: Math.round(g._monto * 100) / 100,
        total_pagado: Math.round(g._pagado * 100) / 100,
        total_kilos: Math.round(g._kilos * 10000) / 10000
      }))
      .sort((a, b) => b.total_monto - a.total_monto);

    res.json({
      ok: true,
      data,
      fechas: { inicio, fin },
      camposSAP: ['Sede', 'Asesor', 'Numero_Factura', 'Valor_Total_Articulo', 'Valor_Pagado', 'Kilos'],
      nota: 'El endpoint SAP consultado no entrega actualmente un campo denominado Labor_Comercial. El resultado se construye con Sede y Asesor.'
    });
  } catch (error) {
    console.error('Error en labor-comercial:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============================================================
// PORTAFOLIO Y CARTERA
// ============================================================

app.get('/dashboards/portafolio-cartera', async (req, res) => {
  const inicio = req.query.inicio || '2026-08-01';
  const fin = req.query.fin || '2026-08-27';

  try {
    const { grupos } = await obtenerAgrupado(inicio, fin, 'portafolio-cartera');

    const data = grupos
      .map(g => ({
        grupo: g.grupo,
        codigo_articulo: g.codigo_articulo,
        articulo: g.articulo,
        total_lineas: g._lineas,
        total_facturas: g._facturas.size,
        total_monto: Math.round(g._monto * 100) / 100,
        total_pagado: Math.round(g._pagado * 100) / 100,
        total_kilos: Math.round(g._kilos * 10000) / 10000,
        promedio_valor_kilo: g._kilos > 0 ? Math.round((g._monto / g._kilos) * 10000) / 10000 : 0
      }))
      .sort((a, b) => b.total_monto - a.total_monto);

    res.json({
      ok: true,
      data,
      fechas: { inicio, fin },
      camposSAP: ['Grupo', 'Codigo_Articulo', 'Articulo', 'Valor_Total_Articulo', 'Valor_Pagado', 'Kilos', 'Valor_Kilo'],
      nota: 'El endpoint SAP consultado no entrega actualmente campos denominados Portafolio o Cartera. El resultado se construye con Grupo, Artículo y valores de facturación.'
    });
  } catch (error) {
    console.error('Error en portafolio-cartera:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============================================================
// PLANEACIÓN NOGALES
// ============================================================

app.get('/dashboards/planeacion-nogales', async (req, res) => {
  const inicio = req.query.inicio || '2026-08-01';
  const fin = req.query.fin || '2026-08-27';

  try {
    const { grupos } = await obtenerAgrupado(inicio, fin, 'planeacion-nogales');

    const data = grupos
      .map(g => ({
        sede: g.sede,
        nombre_almacen: g.nombre_almacen,
        grupo: g.grupo,
        total_lineas: g._lineas,
        total_facturas: g._facturas.size,
        total_monto: Math.round(g._monto * 100) / 100,
        total_pagado: Math.round(g._pagado * 100) / 100,
        total_kilos: Math.round(g._kilos * 10000) / 10000
      }))
      .sort((a, b) => b.total_monto - a.total_monto);

    res.json({
      ok: true,
      data,
      fechas: { inicio, fin },
      camposSAP: ['Sede', 'Nombre_Almacen', 'Grupo', 'Numero_Factura', 'Valor_Total_Articulo', 'Valor_Pagado', 'Kilos'],
      nota: 'El endpoint SAP consultado no entrega actualmente un campo denominado Planeacion. El resultado se construye con Sede, Nombre_Almacen y Grupo.'
    });
  } catch (error) {
    console.error('Error en planeacion-nogales:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============================================================
// 404
// ============================================================

app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Ruta no encontrada', ruta: req.originalUrl });
});

// ============================================================
// MANEJO DE ERRORES GENERALES
// ============================================================

app.use((error, req, res, next) => {
  console.error('ERROR GENERAL:', error);
  if (res.headersSent) return next(error);
  res.status(500).json({ ok: false, error: 'Error interno del servidor', detalle: error.message });
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================
// Ya no hay initDB() ni conexión a Postgres que esperar: el servidor
// arranca de inmediato y cada request consulta SAP (o el caché en
// memoria) bajo demanda.

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✓ Server running on port ${PORT}`);
  console.log('✓ GET /');
  console.log('✓ GET /health');
  console.log('✓ GET /sync-sap');
  console.log('✓ GET /sync-status');
  console.log('✓ GET /dataset');
  console.log('✓ GET /facturacion');
  console.log('✓ GET /dashboards/hoja-asesor');
  console.log('✓ GET /dashboards/hoja-cliente');
  console.log('✓ GET /dashboards/labor-comercial');
  console.log('✓ GET /dashboards/portafolio-cartera');
  console.log('✓ GET /dashboards/planeacion-nogales');
});

module.exports = app;
