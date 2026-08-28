require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const https = require('https');
const pool = require('./db');

const app = express();

const PORT = process.env.PORT || 3000;

// ============================================================
// CONFIGURACIÓN SAP
// ============================================================

const SAP_BASE_URL =
  process.env.SAP_SERVICE_URL ||
  process.env.SAP_BASE_URL ||
  'https://170.239.154.46:4300/api_campana26/facturacion.xsodata/Facturacion';

const SAP_HOST =
  process.env.SAP_SYSTEM_HOST ||
  'NDB.n00.CAMPANADB02';

const SAP_USER =
  process.env.SAP_USER || '';

const SAP_PASS =
  process.env.SAP_PASS || '';

const SAP_PAGE_SIZE =
  parseInt(process.env.SAP_PAGE_SIZE || '5000', 10);

const DB_BATCH_SIZE =
  parseInt(process.env.DB_BATCH_SIZE || '250', 10);

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*'
}));

app.use(express.json({
  limit: '10mb'
}));

// ============================================================
// ESTADO GLOBAL DE SINCRONIZACIÓN
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
console.log('BACKEND LA CAMPANA');
console.log('===========================================');
console.log('SAP:', SAP_BASE_URL);
console.log('SAP HOST:', SAP_HOST);
console.log('SAP PAGE SIZE:', SAP_PAGE_SIZE);
console.log('DB BATCH SIZE:', DB_BATCH_SIZE);
console.log(
  'SAP USER CONFIGURADO:',
  Boolean(SAP_USER)
);
console.log(
  'SAP PASSWORD CONFIGURADA:',
  Boolean(SAP_PASS)
);
console.log('===========================================');

// ============================================================
// UTILIDADES
// ============================================================

function parseSAPDate(value) {

  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  const text = String(value);

  // Formato SAP OData:
  // /Date(1750291200000)/
  const match = text.match(
    /\/Date\((\d+)(?:[+-]\d+)?\)\//
  );

  if (match) {

    const timestamp = Number(match[1]);

    if (!Number.isNaN(timestamp)) {

      return new Date(timestamp)
        .toISOString()
        .slice(0, 10);
    }
  }

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  // ISO completo
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    return text.slice(0, 10);
  }

  return null;
}

// ============================================================

function toNumber(value) {

  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

// ============================================================

function actualizarActividad() {
  syncState.ultimaActividad =
    new Date().toISOString();
}

// ============================================================
// BASE DE DATOS
// ============================================================

async function initDB() {

  try {

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

    console.log('✓ Base de datos inicializada');

  } catch (error) {

    console.error(
      'Error inicializando la base de datos:',
      error.message
    );

    throw error;
  }
}

// ============================================================
// RUTA PRINCIPAL
// ============================================================

app.get('/', (req, res) => {

  res.json({

    ok: true,

    servicio: 'Backend La Campana',

    mensaje:
      'Servidor funcionando correctamente',

    rutas: {

      health:
        '/health',

      syncSAP:
        '/sync-sap?inicio=YYYY-MM-DD&fin=YYYY-MM-DD',

      syncStatus:
        '/sync-status',

      facturacion:
        '/facturacion',

      hojaAsesor:
        '/dashboards/hoja-asesor',

      hojaCliente:
        '/dashboards/hoja-cliente',

      laborComercial:
        '/dashboards/labor-comercial',

      portafolioCartera:
        '/dashboards/portafolio-cartera',

      planeacionNogales:
        '/dashboards/planeacion-nogales'
    }
  });
});

// ============================================================
// HEALTH
// ============================================================

app.get('/health', async (req, res) => {

  try {

    await pool.query('SELECT 1');

    res.json({

      ok: true,

      estado: 'ok',

      baseDatos: 'conectada',

      sincronizacion: {

        ejecutando:
          syncState.ejecutando,

        estado:
          syncState.estado,

        paginaActual:
          syncState.paginaActual,

        registrosSAP:
          syncState.registrosSAP,

        registrosProcesados:
          syncState.registrosProcesados
      },

      fecha:
        new Date().toISOString()
    });

  } catch (error) {

    res.status(500).json({

      ok: false,

      estado: 'error',

      baseDatos: 'desconectada',

      error: error.message
    });
  }
});

// ============================================================
// ESTADO DE SINCRONIZACIÓN
// ============================================================

app.get('/sync-status', (req, res) => {

  res.json({

    ok: true,

    sincronizacion: {

      ejecutando:
        syncState.ejecutando,

      estado:
        syncState.estado,

      fechas: {

        inicio:
          syncState.inicio,

        fin:
          syncState.fin
      },

      paginaActual:
        syncState.paginaActual,

      skipActual:
        syncState.skipActual,

      paginasProcesadas:
        syncState.paginasProcesadas,

      paginaSize:
        SAP_PAGE_SIZE,

      registrosSAP:
        syncState.registrosSAP,

      registrosProcesados:
        syncState.registrosProcesados,

      iniciadoEn:
        syncState.iniciadoEn,

      terminadoEn:
        syncState.terminadoEn,

      ultimaActividad:
        syncState.ultimaActividad,

      error:
        syncState.error
    }
  });
});

// ============================================================
// CONSULTAR SAP - UNA PÁGINA
// ============================================================

async function consultarSAPPagina(
  inicio,
  fin,
  skip,
  top
) {

  const filter =
    `Fecha_Factura ge datetime'${inicio}' and ` +
    `Fecha_Factura le datetime'${fin}'`;

  console.log(
    `Consultando SAP: ${inicio} → ${fin} | skip=${skip} | top=${top}`
  );

  try {

    const response =
      await axios.get(
        SAP_BASE_URL,
        {

          params: {

            $filter:
              filter,

            $format:
              'json',

            $top:
              top,

            $skip:
              skip
          },

          httpsAgent:
            new https.Agent({
              rejectUnauthorized: false
            }),

          timeout:
            120000,

          headers: {

            Accept:
              'application/json',

            Host:
              SAP_HOST
          },

          auth:
            SAP_USER && SAP_PASS
              ? {
                  username:
                    SAP_USER,

                  password:
                    SAP_PASS
                }
              : undefined
        }
      );

    console.log(
      `✓ SAP respondió HTTP ${response.status}`
    );

    return response.data;

  } catch (error) {

    const status =
      error.response?.status || null;

    const detalle =
      error.response?.data ||
      error.message;

    const nuevoError =
      new Error(
        `SAP respondió con error${
          status
            ? ` HTTP ${status}`
            : ''
        }`
      );

    nuevoError.status =
      status;

    nuevoError.detalle =
      detalle;

    throw nuevoError;
  }
}

// ============================================================
// MAPEAR SAP
// ============================================================

function mapSAPRecord(row) {

  return {

    sap_id:
      row.ID || null,

    cliente:
      row.Cliente || null,

    nit:
      row.Nit || null,

    ciudad:
      row.Ciudad || null,

    departamento:
      row.Departamento || null,

    ciiu:
      row.CIIU || null,

    numero_factura:
      row.Numero_Factura !== null &&
      row.Numero_Factura !== undefined
        ? String(row.Numero_Factura)
        : null,

    fecha_factura:
      parseSAPDate(
        row.Fecha_Factura
      ),

    plazo:
      row.Plazo || null,

    cupo_credito:
      toNumber(
        row.Cupo_Credito
      ),

    cupo_usado:
      toNumber(
        row.Cupo_Usado
      ),

    asesor:
      row.Asesor || null,

    meta_anual_asesor:
      toNumber(
        row.Meta_Anual_Asesor
      ),

    sede:
      row.Sede || null,

    meta_anual_sede:
      toNumber(
        row.Meta_Anual_Sede
      ),

    nombre_almacen:
      row.Nombre_Almacen || null,

    codigo_articulo:
      row.Codigo_Articulo || null,

    articulo:
      row.Articulo || null,

    grupo:
      row.Grupo || null,

    meta_anual_grupo:
      toNumber(
        row.Meta_Anual_Grupo
      ),

    factura_paga_total:
      row.Factura_Paga_Total || null,

    valor_pagado:
      toNumber(
        row.Valor_Pagado
      ),

    valor_total_articulo:
      toNumber(
        row.Valor_Total_Articulo
      ),

    dias_mora:
      row.Dias_Mora !== null &&
      row.Dias_Mora !== undefined
        ? parseInt(
            row.Dias_Mora,
            10
          )
        : null,

    kilos:
      toNumber(
        row.Kilos
      ),

    valor_kilo:
      toNumber(
        row.Valor_Kilo
      ),

    costo_kilo:
      toNumber(
        row.Costo_Kilo
      ),

    peso_unitario:
      toNumber(
        row.Peso_Unitario
      ),

    raw_data:
      row
  };
}

// ============================================================
// GUARDAR UN LOTE
// ============================================================

async function guardarLote(
  registros
) {

  if (!registros.length) {
    return 0;
  }

  const client =
    await pool.connect();

  let guardados = 0;

  try {

    await client.query(
      'BEGIN'
    );

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

        cliente =
          EXCLUDED.cliente,

        nit =
          EXCLUDED.nit,

        ciudad =
          EXCLUDED.ciudad,

        departamento =
          EXCLUDED.departamento,

        ciiu =
          EXCLUDED.ciiu,

        numero_factura =
          EXCLUDED.numero_factura,

        fecha_factura =
          EXCLUDED.fecha_factura,

        plazo =
          EXCLUDED.plazo,

        cupo_credito =
          EXCLUDED.cupo_credito,

        cupo_usado =
          EXCLUDED.cupo_usado,

        asesor =
          EXCLUDED.asesor,

        meta_anual_asesor =
          EXCLUDED.meta_anual_asesor,

        sede =
          EXCLUDED.sede,

        meta_anual_sede =
          EXCLUDED.meta_anual_sede,

        nombre_almacen =
          EXCLUDED.nombre_almacen,

        codigo_articulo =
          EXCLUDED.codigo_articulo,

        articulo =
          EXCLUDED.articulo,

        grupo =
          EXCLUDED.grupo,

        meta_anual_grupo =
          EXCLUDED.meta_anual_grupo,

        factura_paga_total =
          EXCLUDED.factura_paga_total,

        valor_pagado =
          EXCLUDED.valor_pagado,

        valor_total_articulo =
          EXCLUDED.valor_total_articulo,

        dias_mora =
          EXCLUDED.dias_mora,

        kilos =
          EXCLUDED.kilos,

        valor_kilo =
          EXCLUDED.valor_kilo,

        costo_kilo =
          EXCLUDED.costo_kilo,

        peso_unitario =
          EXCLUDED.peso_unitario,

        raw_data =
          EXCLUDED.raw_data,

        updated_at =
          CURRENT_TIMESTAMP
    `;

    for (
      const registro
      of registros
    ) {

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

        JSON.stringify(
          registro.raw_data
        )
      ];

      await client.query(
        query,
        values
      );

      guardados++;
    }

    await client.query(
      'COMMIT'
    );

    return guardados;

  } catch (error) {

    await client.query(
      'ROLLBACK'
    );

    throw error;

  } finally {

    client.release();
  }
}

// ============================================================
// GUARDAR MUCHOS REGISTROS POR LOTES
// ============================================================

async function guardarRegistros(
  registros
) {

  let totalGuardados = 0;

  for (
    let i = 0;
    i < registros.length;
    i += DB_BATCH_SIZE
  ) {

    const lote =
      registros.slice(
        i,
        i + DB_BATCH_SIZE
      );

    const guardados =
      await guardarLote(
        lote
      );

    totalGuardados +=
      guardados;

    actualizarActividad();

    console.log(
      `✓ Lote PostgreSQL: ${guardados} registros`
    );
  }

  return totalGuardados;
}

// ============================================================
// PROCESO REAL DE SINCRONIZACIÓN
// ============================================================

async function ejecutarSincronizacion(
  inicio,
  fin
) {

  try {

    let skip = 0;

    let pagina = 0;

    while (true) {

      pagina++;

      syncState.paginaActual =
        pagina;

      syncState.skipActual =
        skip;

      actualizarActividad();

      console.log(
        '==========================================='
      );

      console.log(
        `Consultando SAP - página ${pagina} - skip ${skip} - top ${SAP_PAGE_SIZE}`
      );

      console.log(
        `Consultando SAP: ${inicio} → ${fin} | skip=${skip} | top=${SAP_PAGE_SIZE}`
      );

      const data =
        await consultarSAPPagina(
          inicio,
          fin,
          skip,
          SAP_PAGE_SIZE
        );

      const resultados =
        data?.d?.results || [];

      const cantidad =
        resultados.length;

      console.log(
        `SAP devolvió ${cantidad} registros`
      );

      if (cantidad === 0) {
        break;
      }

      syncState.registrosSAP +=
        cantidad;

      const registros =
        resultados
          .map(
            mapSAPRecord
          )
          .filter(
            registro =>
              registro.sap_id
          );

      const guardados =
        await guardarRegistros(
          registros
        );

      syncState.registrosProcesados +=
        guardados;

      syncState.paginasProcesadas =
        pagina;

      actualizarActividad();

      console.log(
        `✓ Página ${pagina} procesada`
      );

      console.log(
        `✓ Total SAP: ${syncState.registrosSAP}`
      );

      console.log(
        `✓ Total PostgreSQL: ${syncState.registrosProcesados}`
      );

      // Si SAP devuelve menos que el límite,
      // ya llegamos al final.

      if (
        cantidad < SAP_PAGE_SIZE
      ) {

        break;
      }

      skip +=
        SAP_PAGE_SIZE;
    }

    syncState.ejecutando =
      false;

    syncState.estado =
      'completado';

    syncState.terminadoEn =
      new Date().toISOString();

    actualizarActividad();

    console.log(
      '==========================================='
    );

    console.log(
      '✓ SINCRONIZACIÓN SAP COMPLETADA'
    );

    console.log(
      `✓ Registros SAP: ${syncState.registrosSAP}`
    );

    console.log(
      `✓ Registros procesados: ${syncState.registrosProcesados}`
    );

    console.log(
      `✓ Páginas: ${syncState.paginasProcesadas}`
    );

    console.log(
      '==========================================='
    );

  } catch (error) {

    console.error(
      '==========================================='
    );

    console.error(
      '✗ ERROR SINCRONIZANDO SAP'
    );

    console.error(
      error
    );

    console.error(
      '==========================================='
    );

    syncState.ejecutando =
      false;

    syncState.estado =
      'error';

    syncState.error = {

      mensaje:
        error.message,

      detalle:
        error.detalle ||
        null,

      httpStatusSAP:
        error.status ||
        null
    };

    syncState.terminadoEn =
      new Date().toISOString();

    actualizarActividad();
  }
}

// ============================================================
// INICIAR SINCRONIZACIÓN
// ============================================================

app.get(
  '/sync-sap',
  async (req, res) => {

    const inicio =
      req.query.inicio ||
      '2026-08-01';

    const fin =
      req.query.fin ||
      '2026-08-27';

    const fechaRegex =
      /^\d{4}-\d{2}-\d{2}$/;

    if (
      !fechaRegex.test(inicio) ||
      !fechaRegex.test(fin)
    ) {

      return res.status(400).json({

        ok: false,

        error:
          'Las fechas deben tener formato YYYY-MM-DD',

        ejemplo:
          '/sync-sap?inicio=2026-08-01&fin=2026-08-27'
      });
    }

    if (inicio > fin) {

      return res.status(400).json({

        ok: false,

        error:
          'La fecha inicio no puede ser mayor que la fecha fin'
      });
    }

    // ========================================================
    // BLOQUEO CONTRA SINCRONIZACIONES DUPLICADAS
    // ========================================================

    if (syncState.ejecutando) {

      return res.status(409).json({

        ok: false,

        mensaje:
          'Ya existe una sincronización SAP en ejecución',

        sincronizacion:

          {

            estado:
              syncState.estado,

            inicio:
              syncState.inicio,

            fin:
              syncState.fin,

            paginaActual:
              syncState.paginaActual,

            paginasProcesadas:
              syncState.paginasProcesadas,

            registrosSAP:
              syncState.registrosSAP,

            registrosProcesados:
              syncState.registrosProcesados
          },

        consultarEstado:
          '/sync-status'
      });
    }

    // ========================================================
    // PREPARAR NUEVA SINCRONIZACIÓN
    // ========================================================

    syncState.ejecutando =
      true;

    syncState.estado =
      'procesando';

    syncState.inicio =
      inicio;

    syncState.fin =
      fin;

    syncState.paginaActual =
      0;

    syncState.skipActual =
      0;

    syncState.paginasProcesadas =
      0;

    syncState.registrosSAP =
      0;

    syncState.registrosProcesados =
      0;

    syncState.iniciadoEn =
      new Date().toISOString();

    syncState.terminadoEn =
      null;

    syncState.error =
      null;

    actualizarActividad();

    console.log(
      '==========================================='
    );

    console.log(
      `SYNC SAP INICIADA EN SEGUNDO PLANO`
    );

    console.log(
      `${inicio} → ${fin}`
    );

    console.log(
      '==========================================='
    );

    // ========================================================
    // IMPORTANTE:
    // NO esperamos await.
    //
    // La sincronización queda trabajando
    // en segundo plano.
    // ========================================================

    ejecutarSincronizacion(
      inicio,
      fin
    ).catch(error => {

      console.error(
        'Error no controlado en sincronización:',
        error
      );
    });

    // ========================================================
    // RESPUESTA INMEDIATA
    // ========================================================

    return res.status(202).json({

      ok: true,

      mensaje:
        'Sincronización SAP iniciada en segundo plano',

      fechas: {

        inicio,
        fin
      },

      paginaSize:
        SAP_PAGE_SIZE,

      lotePostgreSQL:
        DB_BATCH_SIZE,

      estado:
        'procesando',

      consultarEstado:
        '/sync-status'
    });
  }
);

// ============================================================
// FACTURACIÓN
// ============================================================

app.get(
  '/facturacion',
  async (req, res) => {

    const limit =
      Math.min(
        parseInt(
          req.query.limit
        ) || 50,
        1000
      );

    const offset =
      parseInt(
        req.query.offset
      ) || 0;

    const fecha_inicio =
      req.query.fecha_inicio ||
      '2026-08-01';

    const fecha_fin =
      req.query.fecha_fin ||
      '2026-08-27';

    try {

      const result =
        await pool.query(
          `

          SELECT *

          FROM facturacion

          WHERE fecha_factura
            BETWEEN $1::DATE
            AND $2::DATE

          ORDER BY
            fecha_factura DESC,
            id DESC

          LIMIT $3
          OFFSET $4

          `,
          [
            fecha_inicio,
            fecha_fin,
            limit,
            offset
          ]
        );

      const countResult =
        await pool.query(
          `

          SELECT
            COUNT(*)::INTEGER AS total

          FROM facturacion

          WHERE fecha_factura
            BETWEEN $1::DATE
            AND $2::DATE

          `,
          [
            fecha_inicio,
            fecha_fin
          ]
        );

      res.json({

        data:
          result.rows,

        total:
          countResult.rows[0].total,

        limit,
        offset,

        fechas: {

          inicio:
            fecha_inicio,

          fin:
            fecha_fin
        }
      });

    } catch (error) {

      console.error(
        'Error en /facturacion:',
        error
      );

      res.status(500).json({

        ok: false,

        error:
          error.message
      });
    }
  }
);

// ============================================================
// DASHBOARD HOJA ASESOR
// ============================================================

app.get(
  '/dashboards/hoja-asesor',
  async (req, res) => {

    const inicio =
      req.query.inicio ||
      '2026-08-01';

    const fin =
      req.query.fin ||
      '2026-08-27';

    try {

      const result =
        await pool.query(
          `

          SELECT

            asesor,

            COUNT(*)::INTEGER
              AS total_lineas,

            COUNT(
              DISTINCT numero_factura
            )::INTEGER
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

              THEN
                SUM(valor_total_articulo)
                / SUM(kilos)

              ELSE 0

            END AS promedio_valor_kilo

          FROM facturacion

          WHERE fecha_factura
            BETWEEN $1::DATE
            AND $2::DATE

            AND asesor IS NOT NULL

          GROUP BY asesor

          ORDER BY total_monto DESC

          `,
          [
            inicio,
            fin
          ]
        );

      res.json({

        data:
          result.rows,

        fechas: {

          inicio,
          fin
        }
      });

    } catch (error) {

      console.error(
        'Error en hoja-asesor:',
        error
      );

      res.status(500).json({

        ok: false,

        error:
          error.message
      });
    }
  }
);

// ============================================================
// DASHBOARD HOJA CLIENTE
// ============================================================

app.get(
  '/dashboards/hoja-cliente',
  async (req, res) => {

    const inicio =
      req.query.inicio ||
      '2026-08-01';

    const fin =
      req.query.fin ||
      '2026-08-27';

    try {

      const result =
        await pool.query(
          `

          SELECT

            cliente,
            nit,

            COUNT(*)::INTEGER
              AS total_lineas,

            COUNT(
              DISTINCT numero_factura
            )::INTEGER
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
            BETWEEN $1::DATE
            AND $2::DATE

            AND cliente IS NOT NULL

          GROUP BY
            cliente,
            nit

          ORDER BY
            total_monto DESC

          LIMIT 100

          `,
          [
            inicio,
            fin
          ]
        );

      res.json({

        data:
          result.rows,

        fechas: {

          inicio,
          fin
        }
      });

    } catch (error) {

      console.error(
        'Error en hoja-cliente:',
        error
      );

      res.status(500).json({

        ok: false,

        error:
          error.message
      });
    }
  }
);

// ============================================================
// LABOR COMERCIAL
// ============================================================

app.get(
  '/dashboards/labor-comercial',
  async (req, res) => {

    const inicio =
      req.query.inicio ||
      '2026-08-01';

    const fin =
      req.query.fin ||
      '2026-08-27';

    try {

      const result =
        await pool.query(
          `

          SELECT

            sede,

            COUNT(*)::INTEGER
              AS total_lineas,

            COUNT(
              DISTINCT numero_factura
            )::INTEGER
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
            BETWEEN $1::DATE
            AND $2::DATE

            AND sede IS NOT NULL

          GROUP BY sede

          ORDER BY total_monto DESC

          `,
          [
            inicio,
            fin
          ]
        );

      res.json({

        data:
          result.rows,

        fechas: {

          inicio,
          fin
        },

        nota:
          'SAP actualmente no entrega un campo Labor_Comercial en el endpoint consultado.'
      });

    } catch (error) {

      console.error(
        'Error en labor-comercial:',
        error
      );

      res.status(500).json({

        ok: false,

        error:
          error.message
      });
    }
  }
);

// ============================================================
// PORTAFOLIO Y CARTERA
// ============================================================

app.get(
  '/dashboards/portafolio-cartera',
  async (req, res) => {

    const inicio =
      req.query.inicio ||
      '2026-08-01';

    const fin =
      req.query.fin ||
      '2026-08-27';

    try {

      const result =
        await pool.query(
          `

          SELECT

            grupo,

            COUNT(*)::INTEGER
              AS total_lineas,

            COUNT(
              DISTINCT numero_factura
            )::INTEGER
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
            BETWEEN $1::DATE
            AND $2::DATE

            AND grupo IS NOT NULL

          GROUP BY grupo

          ORDER BY total_monto DESC

          `,
          [
            inicio,
            fin
          ]
        );

      res.json({

        data:
          result.rows,

        fechas: {

          inicio,
          fin
        },

        nota:
          'SAP actualmente no entrega campos Portafolio/Cartera en el endpoint consultado.'
      });

    } catch (error) {

      console.error(
        'Error en portafolio-cartera:',
        error
      );

      res.status(500).json({

        ok: false,

        error:
          error.message
      });
    }
  }
);

// ============================================================
// PLANEACIÓN NOGALES
// ============================================================

app.get(
  '/dashboards/planeacion-nogales',
  async (req, res) => {

    const inicio =
      req.query.inicio ||
      '2026-08-01';

    const fin =
      req.query.fin ||
      '2026-08-27';

    try {

      const result =
        await pool.query(
          `

          SELECT

            sede,

            COUNT(*)::INTEGER
              AS total_lineas,

            COUNT(
              DISTINCT numero_factura
            )::INTEGER
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
            BETWEEN $1::DATE
            AND $2::DATE

            AND sede IS NOT NULL

          GROUP BY sede

          ORDER BY total_monto DESC

          `,
          [
            inicio,
            fin
          ]
        );

      res.json({

        data:
          result.rows,

        fechas: {

          inicio,
          fin
        },

        nota:
          'SAP actualmente no entrega un campo Planeacion en la respuesta consultada.'
      });

    } catch (error) {

      console.error(
        'Error en planeacion-nogales:',
        error
      );

      res.status(500).json({

        ok: false,

        error:
          error.message
      });
    }
  }
);

// ============================================================
// 404
// ============================================================

app.use(
  (req, res) => {

    res.status(404).json({

      ok: false,

      error:
        'Ruta no encontrada',

      ruta:
        req.originalUrl
    });
  }
);

// ============================================================
// INICIAR SERVIDOR
// ============================================================

async function startServer() {

  try {

    await initDB();

    app.listen(
      PORT,
      '0.0.0.0',
      () => {

        console.log(
          `✓ Server running on port ${PORT}`
        );

        console.log(
          '✓ GET /'
        );

        console.log(
          '✓ GET /health'
        );

        console.log(
          '✓ GET /sync-sap'
        );

        console.log(
          '✓ GET /sync-status'
        );

        console.log(
          '✓ GET /facturacion'
        );
      }
    );

  } catch (error) {

    console.error(
      'Error iniciando servidor:',
      error
    );

    process.exit(1);
  }
}

startServer();

module.exports = app;
