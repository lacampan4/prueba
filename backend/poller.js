// poller.js - Worker que hace polling a la API OData de SAP cada 5 minutos
const fetch = require('node-fetch');
const pool = require('./db');

// Config desde env
const SAP_API_BASE = process.env.SAP_API_BASE || 'https://170.239.154.46:4300';
const SAP_ODATA_PATH = process.env.SAP_ODATA_PATH || '/api_campana26/facturacion.xsodata/Facturacion';
const SAP_USERNAME = process.env.SAP_USERNAME || 'B1ADMIN';
const SAP_PASSWORD = process.env.SAP_PASSWORD || '';
const SAP_HOST_HEADER = process.env.SAP_HOST_HEADER || 'NDB.n00.CAMPANADB02:4300';
const POLL_INTERVAL_SECONDS = parseInt(process.env.POLL_INTERVAL_SECONDS) || 300;
const START_POLLING_NOW = process.env.START_POLLING_NOW === 'true';

// Retry config
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

// Helper: sleep
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper: fetch con retry y backoff exponencial
async function fetchWithRetry(url, options, retryCount = 0) {
  try {
    console.log(`[Fetch] GET ${url.split('?')[0]} (retry: ${retryCount})`);
    const response = await fetch(url, options);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (err) {
    console.error(`[Fetch Error] ${err.message}`);

    if (retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * Math.pow(2, retryCount);
      console.log(`[Retry] Waiting ${delay}ms before retry ${retryCount + 1}/${MAX_RETRIES}`);
      await sleep(delay);
      return fetchWithRetry(url, options, retryCount + 1);
    }

    throw err;
  }
}

// Construir auth basic
function getAuthHeader() {
  const credentials = `${SAP_USERNAME}:${SAP_PASSWORD}`;
  const encoded = Buffer.from(credentials).toString('base64');
  return `Basic ${encoded}`;
}

// Poll SAP API
async function pollSAP() {
  const startTime = new Date();
  console.log(`\n[${startTime.toISOString()}] Starting SAP poll...`);

  try {
    // URL OData con filtro de fechas (últimos 30 días por defecto)
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    const startISO = start.toISOString().split('T')[0];
    const endISO = end.toISOString().split('T')[0];

    const filter = `$filter=Fecha_Factura ge datetime'${startISO}' and Fecha_Factura le datetime'${endISO}'`;
    const url = `${SAP_API_BASE}${SAP_ODATA_PATH}?${filter}&$format=json`;

    const options = {
      method: 'GET',
      headers: {
        'Authorization': getAuthHeader(),
        'Host': SAP_HOST_HEADER,
        'Content-Type': 'application/json'
      }
    };

    // Fetch con retry
    const data = await fetchWithRetry(url, options);

    if (!data.d || !Array.isArray(data.d.results)) {
      console.warn('[SAP] No results or unexpected format', data);
      return;
    }

    const results = data.d.results;
    console.log(`[SAP] Fetched ${results.length} records from SAP`);

    if (results.length === 0) {
      console.log('[Poll] No new data');
      return;
    }

    // Ingestar en Neon
    const placeholders = results
      .map((_, i) => {
        const offset = i * 11;
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11})`;
      })
      .join(',');

    const values = results.flatMap(row => [
      row.DocEntry || null,
      row.Fecha_Factura ? row.Fecha_Factura.split('T')[0] : null,
      row.CardName || null,
      parseFloat(row.DocTotal || 0),
      row.Asesor || null,
      row.Labor_Comercial || null,
      row.Portafolio || null,
      row.Cartera || null,
      row.Planeacion || null,
      '6', // hoja_ruta
      JSON.stringify(row)
    ]);

    const query = `
      INSERT INTO facturacion 
      (doc_entry, fecha_factura, cliente, monto, asesor, labor_comercial, portafolio, cartera, planeacion, hoja_ruta, raw_data)
      VALUES ${placeholders}
      ON CONFLICT (doc_entry) DO UPDATE SET
        updated_at = CURRENT_TIMESTAMP,
        raw_data = EXCLUDED.raw_data
      RETURNING id;
    `;

    const result = await pool.query(query, values);
    console.log(`[DB] Inserted/updated ${result.rowCount} records in Neon`);

    const endTime = new Date();
    const duration = endTime - startTime;
    console.log(`✓ Poll completed in ${duration}ms\n`);
  } catch (err) {
    console.error('[Poll Error]', err.message);
  }
}

// ====================
// Main
// ====================
if (START_POLLING_NOW) {
  // Ejecutar ahora
  pollSAP().then(() => {
    console.log('[Poll] First poll complete');
  }).catch(err => {
    console.error('[Poll] Error:', err);
    process.exit(1);
  });
}

// Polling periódico
setInterval(() => {
  pollSAP().catch(err => {
    console.error('[Poll] Uncaught error:', err);
  });
}, POLL_INTERVAL_SECONDS * 1000);

console.log(`✓ Poller started (interval: ${POLL_INTERVAL_SECONDS}s)`);
console.log(`✓ SAP API: ${process.env.SAP_API_BASE}`);
console.log(`✓ Database: ${process.env.DATABASE_URL ? 'Neon connected' : 'DATABASE_URL not set'}`);
