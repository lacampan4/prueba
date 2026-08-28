```javascript
// app.js
// Backend Express - SAP XSODATA + PostgreSQL + Dashboards
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const pool = require('./db');

const app = express();

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*'
}));

app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;

// ============================================================
// CONFIGURACIÓN SAP
// ============================================================

const SAP_BASE_URL =
  process.env.SAP_BASE_URL ||
  'https://170.239.154.46:4300/api_campana26/facturacion.xsodata/Facturacion';

const SAP_PAGE_SIZE = parseInt(process.env.SAP_PAGE_SIZE || '500', 10);

// ============================================================
// UTILIDADES
// ============================================================

// Convierte:
//
// /Date(1786320000000)/
//
// a:
//
// 2026-08-09
//
// PostgreSQL acepta también el formato ISO completo,
// pero guardaremos solamente la fecha.
function parseSAPDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  const text = String(value);

  const match = text.match(/\/Date\((\d+)(?:[+-]\d+)?\)\//);

  if (match) {
    const timestamp = Number(match[1]);

    if (!Number.isNaN(timestamp)) {
      return new Date(timestamp).toISOString().slice(0, 10);
    }
  }

  // Si SAP llegara a entregar directamente YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  return null;
}

function toNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

// ============================================================
// INICIALIZAR BASE DE DATOS
// ============================================================

async function initDB() {
  try {
    // Tabla principal con la estructura REAL de SAP
    await pool.query(`
      CREATE TABLE IF NOT EXISTS facturacion (
        id SERIAL PRIMARY KEY,

        sap_id VARCHAR(100) UNIQUE NOT NULL,

        cliente TEXT,
        nit VARCHAR(50),
        ciudad TEXT,
        departamento TEXT,
        ciiu TEXT,

        numero_factura VARCHAR(100),
        fecha_factura DATE,

        plazo TEXT,
        cupo_credito NUMERIC(18,2),
        cupo_usado NUMERIC(18,2),

        asesor TEXT,
        meta_anual_asesor NUMERIC(18,2),

        sede TEXT,
        meta_anual_sede NUMERIC(18,2),

        nombre_almacen TEXT,

        codigo_articulo TEXT,
        articulo TEXT,
        grupo TEXT,
        meta_anual_grupo NUMERIC(18,2),

        factura_paga_total TEXT,
        valor_pagado NUMERIC(18,2),
        valor_total_articulo NUMERIC(18,2),

        dias_mora INTEGER,

        kilos NUMERIC(18,4),
        valor_kilo NUMERIC(18,4),
        costo_kilo NUMERIC(18,10),
        peso_unitario NUMERIC(18,4),

        raw_data JSONB,

        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Índices
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_facturacion_fecha
      ON facturacion(fecha_factura);

      CREATE INDEX IF NOT EXISTS idx_facturacion_asesor
      ON facturacion(asesor);

      CREATE INDEX IF NOT EXISTS idx_facturacion_cliente
      ON facturacion(cliente);

      CREATE INDEX IF NOT EXISTS idx_facturacion_sede
      ON facturacion(sede);

      CREATE INDEX IF NOT EXISTS idx_facturacion_grupo
      ON facturacion(grupo);

      CREATE INDEX IF NOT EXISTS idx_facturacion_numero_factura
      ON facturacion(numero_factura);
    `);

    console.log('✓ DB initialized');
  } catch (err) {
    console.error('Error initializing DB:', err);

    // No detenemos el servidor.
    // Render puede levantar el servicio aunque exista
    // un problema puntual de inicialización.
  }
}

// ============================================================
// HEALTH CHECK
// ============================================================

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');

    res.json({
      estado: 'ok',
      baseDatos: 'conectada',
      marca_de_tiempo: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({
      estado: 'error',
      baseDatos: 'desconectada',
      error: err.message,
      marca_de_tiempo: new Date().toISOString()
    });
  }
});

// ============================================================
// CONSULTAR UNA PÁGINA DE SAP
// ============================================================

async function consultarSAPPagina(inicio, fin, skip, top) {
  const filter =
    `Fecha_Factura ge datetime'${inicio}' and ` +
    `Fecha_Factura le datetime'${fin}'`;

  try {
    const response = await axios.get(SAP_BASE_URL, {
      params: {
        $filter: filter,
        $format: 'json',
        $top: top,
        $skip: skip
      },

      // SAP está detrás de HTTPS y puede utilizar
      // un certificado interno/no público.
      // rejectUnauthorized:false permite la conexión
      // desde Render si el certificado no es reconocido.
      httpsAgent: new (require('https').Agent)({
        rejectUnauthorized: false
      }),

      timeout: 120000,

      headers: {
        Accept: 'application/json'
      }
    });

    return response.data;
  } catch (err) {
    const status = err.response?.status || null;

    const detalle =
      err.response?.data ||
      err.message;

    const error = new Error(
      `SAP respondió con error${status ? ` HTTP ${status}` : ''}`
    );

    error.status = status;
    error.detalle = detalle;

    throw error;
  }
}

// ============================================================
// MAPEAR REGISTRO SAP
// ============================================================

function mapSAPRecord(row) {
  return {
    sap_id: row.ID || null,

    cliente: row.Cliente || null,
    nit: row.Nit || null,
    ciudad: row.Ciudad || null,
    departamento: row.Departamento || null,
    ciiu: row.CIIU || null,

    numero_factura:
      row.Numero_Factura !== null &&
      row.Numero_Factura !== undefined
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
    valor_total_articulo: toNumber(row.Valor_Total_Articulo),file:///C:/Users/Administrador.EQUIPO290/Downloads/dasboard-lacampana-main%20(14).zip

    dias_mora:
      row.Dias_Mora !== null &&
      row.Dias_Mora !== undefined
        ? parseInt(row.Dias_Mora, 10)
        : null,

    kilos: toNumber(row.Kilos),
    valor_kilo: toNumber(row.Valor_Kilo),
    costo_kilo: toNumber(row.Costo_Kilo),
    peso_unitario: toNumber(row.Peso_Unitario),

    raw_data: row
  };
}

// ============================================================
// GUARDAR REGISTROS EN POSTGRESQL
// ============================================================

async function guardarRegistros(registros) {
  if (!registros.length) {
    return 0;
  }

  const client = await pool.connect();

  let guardados = 0;

  try {
    await client.query('BEGIN');

    const query = `
      INSERT INTO facturacion (
        sap_id,
        cliente,
        nit,
        ciudad,
        departamento,
        ciiu,
        numero_factura,
        fecha_factura,
        plazo,
        cupo_credito,
        cupo_usado,
        asesor,
        meta_anual_asesor,
        sede,
        meta_anual_sede,
        nombre_almacen,
        codigo_articulo,
        articulo,
        grupo,
        meta_anual_grupo,
        factura_paga_total,
        valor_pagado,
        valor_total_articulo,
        dias_mora,
        kilos,
        valor_kilo,
        costo_kilo,
        peso_unitario,
        raw_data,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,
        CURRENT_TIMESTAMP
      )

      ON CONFLICT (sap_id)
      DO UPDATE SET
        cliente = EXCLUDED.cliente,
        nit = EXCLUDED.nit,
        ciudad = EXCLUDED.ciudad,
        departamento = EXCLUDED.departamento,
        ciiu = EXCLUDED.ciiu,
        numero_factura = EXCLUDED.numero_factura,
        fecha_factura = EXCLUDED.fecha_factura,
        plazo = EXCLUDED.plazo,
        cupo_credito = EXCLUDED.cupo_credito,
        cupo_usado = EXCLUDED.cupo_usado,
        asesor = EXCLUDED.asesor,
        meta_anual_asesor = EXCLUDED.meta_anual_asesor,
        sede = EXCLUDED.sede,
        meta_anual_sede = EXCLUDED.meta_anual_sede,
        nombre_almacen = EXCLUDED.nombre_almacen,
        codigo_articulo = EXCLUDED.codigo_articulo,
        articulo = EXCLUDED.articulo,
        grupo = EXCLUDED.grupo,
        meta_anual_grupo = EXCLUDED.meta_anual_grupo,
        factura_paga_total = EXCLUDED.factura_paga_total,
        valor_pagado = EXCLUDED.valor_pagado,
        valor_total_articulo = EXCLUDED.valor_total_articulo,
        dias_mora = EXCLUDED.dias_mora,
        kilos = EXCLUDED.kilos,
        valor_kilo = EXCLUDED.valor_kilo,
        costo_kilo = EXCLUDED.costo_kilo,
        peso_unitario = EXCLUDED.peso_unitario,
        raw_data = EXCLUDED.raw_data,
        updated_at = CURRENT_TIMESTAMP
    `;

    for (const registro of registros) {
      if (!registro.sap_id) {
        continue;
      }

      const values = [
        registro.sap_id,
        registro.cliente,
        registro.nit,
        registro.ciudad,
        registro.departamento,
        registro.ciiu,
        registro.numero_factura,
        registro.fecha_factura,
        registro.plazo,
        registro.cupo_credito,
        registro.cupo_usado,
        registro.asesor,
        registro.meta_anual_asesor,
        registro.sede,
        registro.meta_anual_sede,
        registro.nombre_almacen,
        registro.codigo_articulo,
        registro.articulo,
        registro.grupo,
        registro.meta_anual_grupo,
        registro.factura_paga_total,
        registro.valor_pagado,
        registro.valor_total_articulo,
        registro.dias_mora,
        registro.kilos,
        registro.valor_kilo,
        registro.costo_kilo,
        registro.peso_unitario,
        JSON.stringify(registro.raw_data)
      ];

      await client.query(query, values);

      guardados++;
    }

    await client.query('COMMIT');

    return guardados;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ============================================================
// SINCRONIZAR SAP
// ============================================================

app.get('/sync-sap', async (req, res) => {
  const inicio = req.query.inicio || '2026-08-01';
  const fin = req.query.fin || '2026-08-27';

  // Validación básica de fechas
  const fechaRegex = /^\d{4}-\d{2}-\d{2}$/;

  if (!fechaRegex.test(inicio) || !fechaRegex.test(fin)) {
    return res.status(400).json({
      ok: false,
      error: 'Las fechas deben tener formato YYYY-MM-DD',
      ejemplo: '/sync-sap?inicio=2026-08-01&fin=2026-08-27'
    });
  }

  if (inicio > fin) {
    return res.status(400).json({
      ok: false,
      error: 'La fecha inicio no puede ser mayor que la fecha fin'
    });
  }

  const inicioProceso = Date.now();

  let skip = 0;
  let pagina = 0;

  let totalSAP = 0;
  let totalGuardados = 0;
  let totalPaginas = 0;

  try {
    console.log(
      `\n===========================================`
    );

    console.log(
      `SYNC SAP ${inicio} → ${fin}`
    );

    console.log(
      `===========================================`
    );

    while (true) {
      pagina++;

      console.log(
        `Consultando SAP - página ${pagina} - skip ${skip} - top ${SAP_PAGE_SIZE}`
      );

      const data = await consultarSAPPagina(
        inicio,
        fin,
        skip,
        SAP_PAGE_SIZE
      );

      const resultados =
        data?.d?.results || [];

      const cantidad = resultados.length;

      console.log(
        `SAP devolvió ${cantidad} registros`
      );

      if (cantidad === 0) {
        break;
      }

      totalSAP += cantidad;

      const registros = resultados
        .map(mapSAPRecord)
        .filter(registro => registro.sap_id);

      const guardados =
        await guardarRegistros(registros);

      totalGuardados += guardados;

      totalPaginas = pagina;

      // Si devolvió menos registros que el tamaño
      // solicitado, llegamos al final.
      if (cantidad < SAP_PAGE_SIZE) {
        break;
      }

      skip += SAP_PAGE_SIZE;
    }

    const tiempoMs = Date.now() - inicioProceso;

    console.log(
      `✓ Sincronización terminada`
    );

    console.log(
      `✓ Registros SAP: ${totalSAP}`
    );

    console.log(
      `✓ Registros procesados: ${totalGuardados}`
    );

    console.log(
      `✓ Páginas: ${totalPaginas}`
    );

    console.log(
      `✓ Tiempo: ${tiempoMs} ms`
    );

    res.json({
      ok: true,
      mensaje: 'Sincronización SAP completada',

      fechas: {
        inicio,
        fin
      },

      registrosSAP: totalSAP,
      registrosProcesados: totalGuardados,
      paginas: totalPaginas,

      paginaSize: SAP_PAGE_SIZE,

      tiempoMs
    });

  } catch (err) {
    console.error(
      'Error sincronizando SAP:',
      err
    );

    res.status(500).json({
      ok: false,
      error: 'Error al consultar o sincronizar SAP',
      detalle: err.detalle || err.message,
      httpStatusSAP: err.status || null,

      fechas: {
        inicio,
        fin
      },

      paginasProcesadas: totalPaginas,
      registrosSAP: totalSAP,
      registrosProcesados: totalGuardados
    });
  }
});

// ============================================================
// OBTENER FACTURACIÓN
// ============================================================

app.get('/facturacion', async (req, res) => {
  const limit = Math.min(
    parseInt(req.query.limit) || 50,
    1000
  );

  const offset =
    parseInt(req.query.offset) || 0;

  const fecha_inicio =
    req.query.fecha_inicio || '2026-08-01';

  const fecha_fin =
    req.query.fecha_fin || '2026-08-27';

  try {
    const result = await pool.query(`
      SELECT *
      FROM facturacion
      WHERE fecha_factura BETWEEN $1::DATE AND $2::DATE
      ORDER BY fecha_factura DESC, id DESC
      LIMIT $3 OFFSET $4;
    `, [
      fecha_inicio,
      fecha_fin,
      limit,
      offset
    ]);

    const countResult = await pool.query(`
      SELECT COUNT(*)::INTEGER AS total
      FROM facturacion
      WHERE fecha_factura BETWEEN $1::DATE AND $2::DATE;
    `, [
      fecha_inicio,
      fecha_fin
    ]);

    res.json({
      data: result.rows,
      total: countResult.rows[0].total,
      limit,
      offset,

      fechas: {
        inicio: fecha_inicio,
        fin: fecha_fin
      }
    });

  } catch (err) {
    console.error(
      'Error on /facturacion:',
      err
    );

    res.status(500).json({
      error: err.message
    });
  }
});

// ============================================================
// DASHBOARD - HOJA DE ASESOR
// ============================================================

app.get(
  '/dashboards/hoja-asesor',
  async (req, res) => {

    const inicio =
      req.query.inicio || '2026-08-01';

    const fin =
      req.query.fin || '2026-08-27';

    try {
      const result = await pool.query(`
        SELECT
          asesor,

          COUNT(*)::INTEGER AS total_lineas,

          COUNT(DISTINCT numero_factura)::INTEGER
            AS total_facturas,

          COALESCE(
            SUM(valor_total_articulo),
            0
          ) AS total_monto,

          COALESCE(
            SUM(kilos),
            0
          ) AS total_kilos,

          CASE
            WHEN SUM(kilos) > 0
            THEN SUM(valor_total_articulo) / SUM(kilos)
            ELSE 0
          END AS promedio_valor_kilo

        FROM facturacion

        WHERE fecha_factura
          BETWEEN $1::DATE AND $2::DATE

          AND asesor IS NOT NULL

        GROUP BY asesor

        ORDER BY total_monto DESC;
      `, [inicio, fin]);

      res.json({
        data: result.rows,
        fechas: {
          inicio,
          fin
        }
      });

    } catch (err) {
      console.error(
        'Error on hoja-asesor:',
        err
      );

      res.status(500).json({
        error: err.message
      });
    }
  }
);

// ============================================================
// DASHBOARD - HOJA DE CLIENTE
// ============================================================

app.get(
  '/dashboards/hoja-cliente',
  async (req, res) => {

    const inicio =
      req.query.inicio || '2026-08-01';

    const fin =
      req.query.fin || '2026-08-27';

    try {
      const result = await pool.query(`
        SELECT
          cliente,
          nit,

          COUNT(*)::INTEGER AS total_lineas,

          COUNT(DISTINCT numero_factura)::INTEGER
            AS total_facturas,

          COALESCE(
            SUM(valor_total_articulo),
            0
          ) AS total_monto,

          COALESCE(
            SUM(kilos),
            0
          ) AS total_kilos,

          MAX(fecha_factura)
            AS ultima_factura

        FROM facturacion

        WHERE fecha_factura
          BETWEEN $1::DATE AND $2::DATE

          AND cliente IS NOT NULL

        GROUP BY cliente, nit

        ORDER BY total_monto DESC

        LIMIT 100;
      `, [inicio, fin]);

      res.json({
        data: result.rows,
        fechas: {
          inicio,
          fin
        }
      });

    } catch (err) {
      console.error(
        'Error on hoja-cliente:',
        err
      );

      res.status(500).json({
        error: err.message
      });
    }
  }
);

// ============================================================
// DASHBOARD - LABOR COMERCIAL
// ============================================================
//
// SAP no trae actualmente un campo llamado
// Labor_Comercial.
//
// Por eso este endpoint devuelve información
// agrupada por asesor/sede hasta que definamos
// de dónde sale exactamente Labor Comercial.
//

app.get(
  '/dashboards/labor-comercial',
  async (req, res) => {

    const inicio =
      req.query.inicio || '2026-08-01';

    const fin =
      req.query.fin || '2026-08-27';

    try {
      const result = await pool.query(`
        SELECT
          sede,

          COUNT(*)::INTEGER AS total_lineas,

          COUNT(DISTINCT numero_factura)::INTEGER
            AS total_facturas,

          COALESCE(
            SUM(valor_total_articulo),
            0
          ) AS total_monto,

          COALESCE(
            SUM(kilos),
            0
          ) AS total_kilos

        FROM facturacion

        WHERE fecha_factura
          BETWEEN $1::DATE AND $2::DATE

          AND sede IS NOT NULL

        GROUP BY sede

        ORDER BY total_monto DESC;
      `, [inicio, fin]);

      res.json({
        data: result.rows,
        fechas: {
          inicio,
          fin
        },

        nota:
          'SAP actualmente no entrega un campo Labor_Comercial en el endpoint consultado.'
      });

    } catch (err) {
      console.error(
        'Error on labor-comercial:',
        err
      );

      res.status(500).json({
        error: err.message
      });
    }
  }
);

// ============================================================
// DASHBOARD - PORTAFOLIO Y CARTERA
// ============================================================
//
// SAP tampoco trae actualmente campos llamados
// Portafolio o Cartera.
//
// Aquí agrupamos por Grupo de artículo como
// información disponible en SAP.
//

app.get(
  '/dashboards/portafolio-cartera',
  async (req, res) => {

    const inicio =
      req.query.inicio || '2026-08-01';

    const fin =
      req.query.fin || '2026-08-27';

    try {
      const result = await pool.query(`
        SELECT
          grupo,

          COUNT(*)::INTEGER AS total_lineas,

          COUNT(DISTINCT numero_factura)::INTEGER
            AS total_facturas,

          COALESCE(
            SUM(valor_total_articulo),
            0
          ) AS total_monto,

          COALESCE(
            SUM(kilos),
            0
          ) AS total_kilos

        FROM facturacion

        WHERE fecha_factura
          BETWEEN $1::DATE AND $2::DATE

          AND grupo IS NOT NULL

        GROUP BY grupo

        ORDER BY total_monto DESC;
      `, [inicio, fin]);

      res.json({
        data: result.rows,
        fechas: {
          inicio,
          fin
        },

        nota:
          'SAP actualmente no entrega campos Portafolio/Cartera en el endpoint consultado.'
      });

    } catch (err) {
      console.error(
        'Error on portafolio-cartera:',
        err
      );

      res.status(500).json({
        error: err.message
      });
    }
  }
);

// ============================================================
// DASHBOARD - PLANEACIÓN NOGALES
// ============================================================
//
// SAP no entrega un campo Planeacion en la respuesta
// que nos mostraste.
//
// Por ahora agrupamos por sede.
//

app.get(
  '/dashboards/planeacion-nogales',
  async (req, res) => {

    const inicio =
      req.query.inicio || '2026-08-01';

    const fin =
      req.query.fin || '2026-08-27';

    try {
      const result = await pool.query(`
        SELECT
          sede,

          COUNT(*)::INTEGER AS total_lineas,

          COUNT(DISTINCT numero_factura)::INTEGER
            AS total_facturas,

          COALESCE(
            SUM(valor_total_articulo),
            0
          ) AS total_monto,

          COALESCE(
            SUM(kilos),
            0
          ) AS total_kilos

        FROM facturacion

        WHERE fecha_factura
          BETWEEN $1::DATE AND $2::DATE

          AND sede IS NOT NULL

        GROUP BY sede

        ORDER BY total_monto DESC;
      `, [inicio, fin]);

      res.json({
        data: result.rows,
        fechas: {
          inicio,
          fin
        },

        nota:
          'SAP actualmente no entrega un campo Planeacion en el endpoint consultado.'
      });

    } catch (err) {
      console.error(
        'Error on planeacion-nogales:',
        err
      );

      res.status(500).json({
        error: err.message
      });
    }
  }
);

// ============================================================
// ERROR 404
// ============================================================

app.use((req, res) => {
  res.status(404).json({
    error: 'Ruta no encontrada',
    ruta: req.originalUrl
  });
});

// ============================================================
// MANEJO GENERAL DE ERRORES
// ============================================================

app.use((err, req, res, next) => {
  console.error(
    'Error general:',
    err
  );

  res.status(500).json({
    error: 'Error interno del servidor',
    detalle: err.message
  });
});

// ============================================================
// ARRANCAR SERVIDOR
// ============================================================

async function startServer() {
  await initDB();

  app.listen(PORT, () => {
    console.log(
      `✓ Server running on port ${PORT}`
    );

    console.log(
      `✓ Health: http://localhost:${PORT}/health`
    );

    console.log(
      `✓ SAP Sync: /sync-sap?inicio=YYYY-MM-DD&fin=YYYY-MM-DD`
    );
  });
}

startServer().catch(err => {
  console.error(
    'Failed to start server:',
    err
  );

  process.exit(1);
});

module.exports = app;
```
