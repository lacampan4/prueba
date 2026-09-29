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
