-- ============================================================
-- LA CAMPANA / HISTORIAL SAP EN SUPABASE
-- ============================================================
-- IMPORTANTE:
-- Este script SOLO elimina/recrea las tablas del historial SAP.
-- NO toca la base de datos de usuarios.
--
-- Regla del sistema:
-- 1. Todo registro recibido de SAP se guarda completo en datos_sap (jsonb).
-- 2. Un día marcado como completado NO vuelve a consultarse a SAP.
-- 3. Los registros históricos NO se borran.
-- ============================================================

DROP TABLE IF EXISTS public.sap_cobertura CASCADE;
DROP TABLE IF EXISTS public.sap_registros CASCADE;

CREATE TABLE public.sap_registros (
  registro_hash text PRIMARY KEY,
  sap_id text,
  fecha_factura date,
  datos_sap jsonb NOT NULL,
  primera_consulta_inicio date NOT NULL,
  primera_consulta_fin date NOT NULL,
  guardado_en timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sap_registros_fecha
  ON public.sap_registros (fecha_factura);

CREATE INDEX idx_sap_registros_sap_id
  ON public.sap_registros (sap_id);

CREATE INDEX idx_sap_registros_datos_sap
  ON public.sap_registros USING gin (datos_sap);

CREATE TABLE public.sap_cobertura (
  fecha date PRIMARY KEY,
  estado text NOT NULL DEFAULT 'completado',
  registros integer NOT NULL DEFAULT 0,
  completado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sap_cobertura_estado_chk CHECK (estado = 'completado')
);

CREATE INDEX idx_sap_cobertura_estado_fecha
  ON public.sap_cobertura (estado, fecha);

ALTER TABLE public.sap_registros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sap_cobertura ENABLE ROW LEVEL SECURITY;

-- No se crean políticas públicas. El backend usa SUPABASE_SECRET_KEY,
-- que permite al servidor acceder a estas tablas sin exponerlas al frontend.
