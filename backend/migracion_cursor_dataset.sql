-- ============================================================
-- MIGRACIÓN: cursor estable para lecturas largas de /dataset
-- ============================================================
-- NO borra datos. Se ejecuta una sola vez sobre la tabla existente.
-- Convierte (fecha_factura, registro_hash) en una sola clave ordenable
-- para que Supabase pueda continuar la lectura sin el OR que provocaba
-- statement timeout alrededor de las páginas altas.

ALTER TABLE public.sap_registros
  ADD COLUMN IF NOT EXISTS cursor_key text;

UPDATE public.sap_registros
SET cursor_key = to_char(fecha_factura, 'YYYYMMDD') || registro_hash
WHERE cursor_key IS NULL
  AND fecha_factura IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sap_registros_cursor_key
  ON public.sap_registros (cursor_key DESC);

ANALYZE public.sap_registros;
