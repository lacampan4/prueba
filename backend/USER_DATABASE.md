# Base de datos de usuarios

Esta base de datos se usa **exclusivamente** para autenticación, usuarios, roles y permisos.
La lógica de SAP y sus endpoints no usan PostgreSQL.

## Render

1. Crear un **Render Postgres** en la misma región que el backend.
2. En el servicio del backend, agregar:
   - `DATABASE_URL` = **Internal Database URL** de ese Postgres.
   - `DATABASE_SSL=false` si se usa la URL interna.
3. Mantener `AUTH_SECRET` configurado.
4. Hacer deploy del backend.

Al arrancar, `user-db.js` crea automáticamente la tabla `usuarios_dashboard`.
Si la tabla está vacía, importa los usuarios existentes desde `users.json` una sola vez.

Después de la primera migración, los usuarios nuevos, cambios y eliminaciones se guardan en PostgreSQL.
`users.json` queda únicamente como respaldo/semilla para una instalación nueva.

## Esquema

La tabla contiene solamente:
- `id`
- `username`
- `nombre`
- `password_hash`
- `rol`
- `permisos`
- `activo`
- fechas de creación/actualización

No se crean tablas para SAP ni se guarda información de facturación en esta base de datos.
