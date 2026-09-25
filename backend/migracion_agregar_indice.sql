-- ============================================================
-- MIGRACIÓN: agrega el índice compuesto que necesita /dataset.
-- Este script NO borra tablas ni datos, es seguro correrlo en
-- producción sobre la base ya existente.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_sap_registros_fecha_hash
  ON public.sap_registros (fecha_factura DESC, registro_hash DESC);

-- Opcional pero recomendado justo después de crear el índice, para que
-- el planificador de Postgres tenga estadísticas frescas de la tabla:
ANALYZE public.sap_registros;
