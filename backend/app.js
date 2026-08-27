// app.js - Servidor Express con endpoints para dashboards
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ====================
// Inicializar DB (crear tablas si no existen)
// ====================
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS facturacion (
        id SERIAL PRIMARY KEY,
        doc_entry VARCHAR(50) UNIQUE,
        fecha_factura DATE,
        cliente VARCHAR(255),
        monto DECIMAL(15,2),
        asesor VARCHAR(255),
        labor_comercial VARCHAR(255),
        portafolio VARCHAR(255),
        cartera VARCHAR(255),
        planeacion VARCHAR(255),
        hoja_ruta VARCHAR(50),
        raw_data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_fecha ON facturacion(fecha_factura);
      CREATE INDEX IF NOT EXISTS idx_hoja_ruta ON facturacion(hoja_ruta);
      CREATE INDEX IF NOT EXISTS idx_asesor ON facturacion(asesor);
    `);
    console.log('✓ DB initialized');
  } catch (err) {
    console.error('Error initializing DB:', err);
  }
}

// ====================
// Endpoints
// ====================

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Ingestar datos (POST desde poller o webhooks)
app.post('/ingest', async (req, res) => {
  const { facturacion_data } = req.body;

  if (!Array.isArray(facturacion_data) || facturacion_data.length === 0) {
    return res.status(400).json({ error: 'facturacion_data must be a non-empty array' });
  }

  try {
    // Batch insert con UPSERT
    const placeholders = facturacion_data
      .map((_, i) => {
        const offset = i * 11;
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11})`;
      })
      .join(',');

    const values = facturacion_data.flatMap(row => [
      row.DocEntry || row.doc_entry,
      row.Fecha_Factura || row.fecha_factura,
      row.CardName || row.cliente,
      parseFloat(row.DocTotal || row.monto || 0),
      row.Asesor || row.asesor || null,
      row.Labor_Comercial || row.labor_comercial || null,
      row.Portafolio || row.portafolio || null,
      row.Cartera || row.cartera || null,
      row.Planeacion || row.planeacion || null,
      '6', // hoja_ruta por defecto
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
    console.log(`✓ Ingested ${result.rowCount} records`);
    res.json({ message: 'ok', count: result.rowCount });
  } catch (err) {
    console.error('Error on /ingest:', err);
    res.status(500).json({ error: err.message });
  }
});

// Dashboard: Hoja de Asesor
app.get('/dashboards/hoja-asesor', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        asesor,
        COUNT(*) as total_facturas,
        SUM(monto) as total_monto,
        AVG(monto) as promedio_monto
      FROM facturacion
      WHERE hoja_ruta = '6' AND asesor IS NOT NULL
      GROUP BY asesor
      ORDER BY total_monto DESC;
    `);
    res.json({ data: result.rows });
  } catch (err) {
    console.error('Error on hoja-asesor:', err);
    res.status(500).json({ error: err.message });
  }
});

// Dashboard: Hoja de Cliente
app.get('/dashboards/hoja-cliente', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        cliente,
        COUNT(*) as total_facturas,
        SUM(monto) as total_monto,
        MAX(fecha_factura) as ultima_factura
      FROM facturacion
      WHERE hoja_ruta = '6' AND cliente IS NOT NULL
      GROUP BY cliente
      ORDER BY total_monto DESC
      LIMIT 100;
    `);
    res.json({ data: result.rows });
  } catch (err) {
    console.error('Error on hoja-cliente:', err);
    res.status(500).json({ error: err.message });
  }
});

// Dashboard: Labor Comercial
app.get('/dashboards/labor-comercial', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        labor_comercial,
        COUNT(*) as total_facturas,
        SUM(monto) as total_monto
      FROM facturacion
      WHERE hoja_ruta = '6' AND labor_comercial IS NOT NULL
      GROUP BY labor_comercial
      ORDER BY total_monto DESC;
    `);
    res.json({ data: result.rows });
  } catch (err) {
    console.error('Error on labor-comercial:', err);
    res.status(500).json({ error: err.message });
  }
});

// Dashboard: Portafolio y Cartera
app.get('/dashboards/portafolio-cartera', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        portafolio,
        cartera,
        COUNT(*) as total_facturas,
        SUM(monto) as total_monto
      FROM facturacion
      WHERE hoja_ruta = '6' AND portafolio IS NOT NULL
      GROUP BY portafolio, cartera
      ORDER BY total_monto DESC;
    `);
    res.json({ data: result.rows });
  } catch (err) {
    console.error('Error on portafolio-cartera:', err);
    res.status(500).json({ error: err.message });
  }
});

// Dashboard: Planeacion Nogales
app.get('/dashboards/planeacion-nogales', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        planeacion,
        COUNT(*) as total_facturas,
        SUM(monto) as total_monto
      FROM facturacion
      WHERE hoja_ruta = '6' AND planeacion IS NOT NULL
      GROUP BY planeacion
      ORDER BY total_monto DESC;
    `);
    res.json({ data: result.rows });
  } catch (err) {
    console.error('Error on planeacion-nogales:', err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint genérico: obtener todas las facturas (con paginación)
app.get('/facturacion', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 1000);
  const offset = parseInt(req.query.offset) || 0;
  const fecha_inicio = req.query.fecha_inicio || '2026-08-01';
  const fecha_fin = req.query.fecha_fin || '2026-08-25';

  try {
    const result = await pool.query(`
      SELECT * FROM facturacion
      WHERE fecha_factura BETWEEN $1::DATE AND $2::DATE
      ORDER BY fecha_factura DESC
      LIMIT $3 OFFSET $4;
    `, [fecha_inicio, fecha_fin, limit, offset]);

    const countResult = await pool.query(`
      SELECT COUNT(*) FROM facturacion
      WHERE fecha_factura BETWEEN $1::DATE AND $2::DATE;
    `, [fecha_inicio, fecha_fin]);

    res.json({
      data: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit,
      offset
    });
  } catch (err) {
    console.error('Error on /facturacion:', err);
    res.status(500).json({ error: err.message });
  }
});

// ====================
// Start server
// ====================
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`✓ Server running on port ${PORT}`);
    console.log(`✓ Health: http://localhost:${PORT}/health`);
  });
}).catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

module.exports = app;
