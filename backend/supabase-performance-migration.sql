-- MIGRACIÓN DE RENDIMIENTO: no borra ningún dato.
-- Ejecutar una sola vez en Supabase SQL Editor sobre la base existente.

DROP INDEX IF EXISTS public.idx_sap_registros_datos_sap;

CREATE INDEX IF NOT EXISTS idx_sap_registros_fecha_hash
    ON public.sap_registros (fecha_factura DESC, registro_hash DESC);

CREATE INDEX IF NOT EXISTS idx_sap_cobertura_fecha_estado
    ON public.sap_cobertura (fecha, estado);
