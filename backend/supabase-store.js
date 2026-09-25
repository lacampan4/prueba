const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('Faltan SUPABASE_URL y SUPABASE_SECRET_KEY en las variables de entorno.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function ordenarObjeto(value) {
  if (Array.isArray(value)) return value.map(ordenarObjeto);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = ordenarObjeto(value[key]);
      return out;
    }, {});
  }
  return value;
}

function hashRegistro(row) {
  const canonical = JSON.stringify(ordenarObjeto(row));
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function parseSAPDate(value) {
  if (!value) return null;
  const text = String(value);
  const match = text.match(/\/Date\((\d+)(?:[+-]\d+)?\)\//);
  if (match) return new Date(Number(match[1])).toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text.slice(0, 10);
  return null;
}

function iterarFechas(inicio, fin) {
  const fechas = [];
  let cursor = new Date(`${inicio}T00:00:00Z`);
  const ultimo = new Date(`${fin}T00:00:00Z`);
  while (cursor <= ultimo) {
    fechas.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return fechas;
}

async function obtenerDiasCubiertos(inicio, fin) {
  const cubiertos = new Set();
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('sap_cobertura')
      .select('fecha')
      .eq('estado', 'completado')
      .gte('fecha', inicio)
      .lte('fecha', fin)
      .order('fecha', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    for (const row of data || []) cubiertos.add(row.fecha);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return cubiertos;
}

function construirRangosFaltantes(inicio, fin, cubiertos) {
  const rangos = [];
  let rangoInicio = null;
  let anterior = null;
  for (const fecha of iterarFechas(inicio, fin)) {
    const falta = !cubiertos.has(fecha);
    if (falta && !rangoInicio) rangoInicio = fecha;
    if (!falta && rangoInicio) {
      rangos.push({ inicio: rangoInicio, fin: anterior });
      rangoInicio = null;
    }
    anterior = fecha;
  }
  if (rangoInicio) rangos.push({ inicio: rangoInicio, fin: anterior });
  return rangos;
}

async function guardarRegistrosSAP(rows, inicio, fin) {
  if (!rows.length) return 0;
  const ahora = new Date().toISOString();
  const payload = rows.map(row => ({
    registro_hash: hashRegistro(row),
    sap_id: row.ID == null ? null : String(row.ID),
    fecha_factura: parseSAPDate(row.Fecha_Factura),
    datos_sap: row,
    primera_consulta_inicio: inicio,
    primera_consulta_fin: fin,
    guardado_en: ahora
  }));

  const batchSize = 50;
  let guardados = 0;
  for (let i = 0; i < payload.length; i += batchSize) {
    const lote = payload.slice(i, i + batchSize);
    const { error } = await supabase
      .from('sap_registros')
      .upsert(lote, { onConflict: 'registro_hash', ignoreDuplicates: true });
    if (error) {
      const detalle = new Error(`Error guardando lote SAP (${i + 1}-${i + lote.length}): ${error.message}`);
      detalle.cause = error;
      throw detalle;
    }
    guardados += lote.length;
  }
  return guardados;
}

async function marcarCobertura(inicio, fin, registros) {
  const ahora = new Date().toISOString();
  const payload = iterarFechas(inicio, fin).map(fecha => ({
    fecha,
    estado: 'completado',
    registros,
    completado_en: ahora
  }));
  const batchSize = 500;
  for (let i = 0; i < payload.length; i += batchSize) {
    const { error } = await supabase
      .from('sap_cobertura')
      .upsert(payload.slice(i, i + batchSize), { onConflict: 'fecha' });
    if (error) throw error;
  }
}

async function obtenerTotal(inicio, fin) {
  const { count, error } = await supabase
    .from('sap_registros')
    .select('registro_hash', { count: 'exact', head: true })
    .gte('fecha_factura', inicio)
    .lte('fecha_factura', fin);
  if (error) throw error;
  return count || 0;
}

async function obtenerPagina(inicio, fin, limit, cursor = null) {
  // Paginación por cursor en vez de OFFSET + COUNT EXACT.
  // COUNT EXACT sobre cientos de miles de filas era el principal motivo
  // de las esperas largas al reconstruir el dashboard desde Supabase.
  let query = supabase
    .from('sap_registros')
    .select('registro_hash,sap_id,fecha_factura,datos_sap')
    .gte('fecha_factura', inicio)
    .lte('fecha_factura', fin)
    .order('fecha_factura', { ascending: false })
    .order('registro_hash', { ascending: false })
    .limit(limit);

  if (cursor && cursor.fecha_factura && cursor.registro_hash) {
    const fecha = cursor.fecha_factura;
    const hash = cursor.registro_hash;
    query = query.or(`fecha_factura.lt.${fecha},and(fecha_factura.eq.${fecha},registro_hash.lt.${hash})`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return { data: data || [] };
}

async function recorrerRegistros(inicio, fin, onRows) {
  // 2.000 filas por petición: reduce los viajes HTTP sin crear respuestas
  // gigantes. La paginación por cursor evita que Supabase tenga que recorrer
  // de nuevo todas las filas anteriores mediante OFFSET.
  const pageSize = 2000;
  let cursor = null;
  let total = 0;

  while (true) {
    const page = await obtenerPagina(inicio, fin, pageSize, cursor);
    if (!page.data.length) break;

    await onRows(page.data.map(row => row.datos_sap), total, null);
    total += page.data.length;

    if (page.data.length < pageSize) break;
    const last = page.data[page.data.length - 1];
    cursor = {
      fecha_factura: last.fecha_factura,
      registro_hash: last.registro_hash
    };
  }

  return total;
}

async function estadoRango(inicio, fin) {
  const cubiertos = await obtenerDiasCubiertos(inicio, fin);
  const totalDias = iterarFechas(inicio, fin).length;
  return { cubiertos: cubiertos.size, totalDias, completo: cubiertos.size === totalDias };
}

module.exports = {
  supabase,
  obtenerDiasCubiertos,
  construirRangosFaltantes,
  guardarRegistrosSAP,
  marcarCobertura,
  obtenerPagina,
  obtenerTotal,
  recorrerRegistros,
  estadoRango,
  hashRegistro
};
