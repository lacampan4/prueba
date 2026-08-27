# SAP-Neon Backend Integration

Backend Node.js/Express que hace polling a la API OData de SAP, guarda datos en Neon (Postgres), y expone endpoints REST para 5 dashboards principales.

## 📋 Archivos

- `app.js` - Servidor Express con endpoints REST
- `poller.js` - Worker que hace polling a SAP cada 5 minutos
- `db.js` - Conexión a Neon
- `Dockerfile` - Para deploy en Render (Docker)
- `package.json` - Dependencias
- `.env.example` - Plantilla de variables

## 🚀 Setup Rápido

### 1. Copiar archivos al repo

```bash
# En tu repo GitHub
cp app.js poller.js db.js Dockerfile package.json .env.example .
```

### 2. Instalar dependencias (local)

```bash
npm install
```

### 3. Configurar .env (local para testing)

```bash
cp .env.example .env
# Editar .env con tus valores
```

### 4. Test local

```bash
# Terminal 1 - Servidor
npm start

# Terminal 2 - Poller (polling manual)
npm run poll
```

Visitar: `http://localhost:3000/health`

### 5. Deploy en Render

1. Push repo a GitHub
2. Conectar repo a Render (Web Service, Docker)
3. En Settings → Environment, añadir variables (desde tu screenshot):
   ```
   SAP_API_BASE = https://170.239.154.46:4300
   SAP_ODATA_PATH = /api_campana26/facturacion.xsodata/Facturacion
   SAP_USERNAME = B1ADMIN
   SAP_PASSWORD = <tu_password>
   SAP_HOST_HEADER = NDB.n00.CAMPANADB02:4300
   POLL_INTERVAL_SECONDS = 300
   START_POLLING_NOW = false
   DATABASE_URL = postgres://...
   ```
4. Deploy
5. Crear Scheduled Job para polling:
   - Command: `npm run poll`
   - Cron: `*/5 * * * *` (cada 5 minutos)
   - Usar mismas Environment vars (START_POLLING_NOW = true aquí)

## 📡 Endpoints API

### Health Check
```bash
GET /health
```

### Ingestar datos (POST)
```bash
POST /ingest
Body: { "facturacion_data": [ { DocEntry, Fecha_Factura, CardName, ... }, ... ] }
```

### Dashboards

#### 1. Hoja de Asesor
```bash
GET /dashboards/hoja-asesor
Response: [ { asesor, total_facturas, total_monto, promedio_monto }, ... ]
```

#### 2. Hoja de Cliente
```bash
GET /dashboards/hoja-cliente
Response: [ { cliente, total_facturas, total_monto, ultima_factura }, ... ]
```

#### 3. Labor Comercial
```bash
GET /dashboards/labor-comercial
Response: [ { labor_comercial, total_facturas, total_monto }, ... ]
```

#### 4. Portafolio y Cartera
```bash
GET /dashboards/portafolio-cartera
Response: [ { portafolio, cartera, total_facturas, total_monto }, ... ]
```

#### 5. Planeacion Nogales
```bash
GET /dashboards/planeacion-nogales
Response: [ { planeacion, total_facturas, total_monto }, ... ]
```

### General Facturacion
```bash
GET /facturacion?fecha_inicio=2026-08-01&fecha_fin=2026-08-25&limit=50&offset=0
Response: { data: [...], total: N, limit, offset }
```

## 🔄 Flujo de datos

1. **Poller** (cada 5 min): Fetch a SAP OData → Batch insert en Neon
2. **Front-end**: GET /dashboards/* → JSON → Render en HTML
3. **Updates**: Refresh automático cada 5 min (o manual con botón)

## 🛡️ Seguridad

- ✅ No subir `.env` al repo (usar `.env.example` + Environment vars en Render)
- ✅ Credenciales SAP/Neon guardadas en Render (no en código)
- ✅ CORS configurado desde `COR_ORIGIN`
- ✅ SSL en Neon habilitado

## 📊 Tablas en Neon

### facturacion
```sql
CREATE TABLE facturacion (
  id SERIAL PRIMARY KEY,
  doc_entry VARCHAR(50) UNIQUE,
  fecha_factura DATE,
  cliente VARCHAR(255),
  monto DECIMAL(15,2),
  asesor VARCHAR(255),
  labor_comercial VARCHAR(255),
  portafolio VARCHAR(255),
  cartera VARCHAR(255),
  planeacion VARCHAR(255),
  hoja_ruta VARCHAR(50),
  raw_data JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## 🐛 Troubleshooting

| Problema | Solución |
|----------|----------|
| Error 401 en SAP | Verificar SAP_USERNAME, SAP_PASSWORD, SAP_HOST_HEADER |
| DB connection failed | Verificar DATABASE_URL, firewall en Neon |
| No data after polling | Revisar logs en Render, aumentar POLL_INTERVAL_SECONDS |
| Frontend slow | Usar paginación (?limit=50&offset=0), índices creados automáticamente |

## 📝 Ejemplo HTML Front-end

```html
<div id="hoja-asesor"></div>

<script>
async function loadAsesores() {
  const res = await fetch('https://tu-backend-render.app/dashboards/hoja-asesor');
  const { data } = await res.json();
  
  const html = data.map(row => `
    <tr>
      <td>${row.asesor}</td>
      <td>${row.total_facturas}</td>
      <td>$${row.total_monto?.toFixed(2)}</td>
    </tr>
  `).join('');
  
  document.getElementById('hoja-asesor').innerHTML = html;
}

loadAsesores();
setInterval(loadAsesores, 300000); // Refresh cada 5 min
</script>
```

---

**Preguntas?** Revisar logs en Render Dashboard → Logs
