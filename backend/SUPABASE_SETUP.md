# Supabase: historial permanente de SAP

## Variables de Render

Agrega estas variables al servicio backend de Render:

- `SUPABASE_URL` = Project URL de Supabase
- `SUPABASE_SECRET_KEY` = Secret key de Supabase (solo backend)

No poner ninguna de estas variables en el frontend.

## Crear las tablas

En Supabase -> SQL Editor -> New query, ejecutar:

`supabase-schema.sql`

El script elimina/recrea únicamente:

- `sap_registros`
- `sap_cobertura`

No toca la base de datos de usuarios.

## Estructura

### sap_registros

- `registro_hash`: identificador técnico único del registro completo.
- `sap_id`: ID entregado por SAP, si existe.
- `fecha_factura`: fecha extraída de `Fecha_Factura` para poder buscar por rango.
- `datos_sap`: JSONB con el registro COMPLETO que devolvió SAP.
- `primera_consulta_inicio`: inicio del rango en el que se recibió.
- `primera_consulta_fin`: fin del rango en el que se recibió.
- `guardado_en`: fecha/hora de almacenamiento.

### sap_cobertura

Una fila por cada día que fue consultado y completado correctamente.

- `fecha`: día cubierto.
- `estado`: siempre `completado`.
- `registros`: cantidad recibida de SAP durante la consulta que cubrió ese día.
- `completado_en`: fecha/hora de finalización.

## Regla de consulta

1. El backend recibe un rango.
2. Busca qué días del rango ya están en `sap_cobertura`.
3. Solo consulta a SAP los días que faltan.
4. Cada registro recibido se guarda completo en `sap_registros.datos_sap`.
5. Solo después de terminar correctamente toda la paginación se marca el período como cubierto.
6. Un día cubierto no vuelve a consultarse automáticamente.
7. No existe código de borrado de historial.

Los endpoints de dashboards siguen entregando solamente los campos que cada dashboard necesita, pero la base conserva el registro SAP completo.

## Si /dataset falla con "statement timeout" (código 57014)

Esto pasa cuando el rango de fechas pedido (por ejemplo, varios años) tiene
tantas filas que alguna consulta a Postgres tarda más que el límite de
tiempo configurado. El backend ya:

- Pagina por cursor (no por OFFSET), así que leer la página 2000 no es más
  lento que leer la página 1.
- Usa conteo **estimado** en vez de exacto para no tener que recorrer todas
  las filas solo para saber cuántas hay.
- Reintenta automáticamente con páginas más chicas si una sola página se
  atasca.

Si aun así el error persiste con rangos muy grandes (varios años), confirma
en Supabase -> SQL Editor:

```sql
-- 1) Confirmar que el índice compuesto existe (migracion_agregar_indice.sql)
SELECT indexname FROM pg_indexes WHERE tablename = 'sap_registros';

-- 2) Estadísticas frescas para el planificador
ANALYZE public.sap_registros;

-- 3) Opcional: subir el statement_timeout para el rol que usa el backend
--    (ajusta el nombre del rol y el tiempo según tu plan de Supabase).
ALTER ROLE service_role SET statement_timeout = '120s';
```
