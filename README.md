# La Campana — Dashboard SAP

Proyecto web con frontend estático y backend Node.js/Express. Los datos de los dashboards se consultan desde SAP OData y se procesan en memoria; PostgreSQL no se utiliza para almacenar los datos de SAP.

## Estructura

- `backend/` — API Node.js/Express y conexión con SAP.
- `frontend/` — dashboards HTML.
- `backend/dataset.js` — construcción incremental del dataset.
- `frontend/sap-helper.js` — actualización desde SAP y carga de Excel.

## Cambios de estabilidad incluidos

- Caché de SAP limitada a **un solo rango** para evitar acumular datasets grandes en RAM.
- Detalle crudo limitado por defecto a **2.000 filas**.
- No se crea una copia adicional de las filas al ordenar `/facturacion`.
- Las descargas de rangos distintos se serializan para evitar dos datasets pesados construyéndose simultáneamente.
- Se conserva la deduplicación de solicitudes del mismo rango.
- El dataset y las agrupaciones se construyen incrementalmente por página de SAP.

## Variables de Render

Copiar `backend/.env.example` como referencia y configurar las variables en Render. **No subir `.env` ni contraseñas reales a GitHub.**

Variables mínimas de autenticación:

- `AUTH_SECRET`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

Variables SAP:

- `SAP_SERVICE_URL`
- `SAP_SYSTEM_HOST`
- `SAP_USER`
- `SAP_PASS`
- `SAP_TLS_REJECT_UNAUTHORIZED`

Rendimiento:

- `SAP_PAGE_SIZE=5000`
- `SAP_MAX_FILAS_CRUDAS=2000`
- `SAP_MAX_CONCURRENCIA=10`
- `SAP_MAX_REINTENTOS=2`
- `SAP_ESPERA_REINTENTO_MS=1500`

## Render

### Si usas Docker

Configura como servicio Docker apuntando a `backend/Dockerfile`.

### Si usas Node

Root Directory: `backend`

Build Command:

```text
npm install
```

Start Command:

```text
npm start
```

Render proporciona automáticamente `PORT`.

## Frontend

El frontend actual apunta por defecto a:

`https://prueba-d9ro.onrender.com/api`

Si la URL de Render cambia, actualiza `frontend/auth-guard.js`, `frontend/sap-helper.js` y `frontend/usuarios.html`, o define `window.LC_API_BASE` antes de cargar esos scripts.

## Nota de seguridad TLS

Si `SAP_TLS_REJECT_UNAUTHORIZED=false`, Node no verifica el certificado TLS de SAP. Esto es útil para un SAP interno con certificado autofirmado durante pruebas, pero debe corregirse para producción mediante un certificado/CA válido y `SAP_TLS_REJECT_UNAUTHORIZED=true`.


Actualización de dashboards: se incorporaron los HTML autónomos V2.0 para los módulos existentes y se añadieron Panorama de Margen y Surtidos Sedes, manteniendo la autenticación y el puente de actualización SAP.
