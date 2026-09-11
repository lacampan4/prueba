require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const https = require('https');
const crypto = require('crypto');
const buildDatasetFromFacturacion = require('./dataset');
const { crearAcumulador, acumularFila, finalizarDataset } = buildDatasetFromFacturacion;

// Cuántas filas crudas (mapeadas de SAP) mantenemos como máximo en RAM
// por rango, solo para que /facturacion pueda mostrar/paginar el detalle
// línea por línea. El dataset agregado (el que usan los 7 dashboards) YA
// NO depende de este límite: se construye incrementalmente, página por
// página, sin necesitar el arreglo completo de filas crudas.
const MAX_FILAS_CRUDAS_CACHE = parseInt(process.env.SAP_MAX_FILAS_CRUDAS, 10) || 20000;

// Configuración de conexión a SAP (deben definirse como variables de
// entorno en Render: SAP_BASE_URL, SAP_HOST, SAP_USER, SAP_PASS, etc.)
const SAP_BASE_URL = process.env.SAP_BASE_URL || '';
const SAP_HOST = process.env.SAP_HOST || '';
const SAP_USER = process.env.SAP_USER || '';
const SAP_PASS = process.env.SAP_PASS || '';
const SAP_PAGE_SIZE = parseInt(process.env.SAP_PAGE_SIZE, 10) || 1000;
const SAP_CACHE_MINUTOS = parseInt(process.env.SAP_CACHE_MINUTOS, 10) || 0;

// Las 5 agrupaciones que usan los dashboards de "Hoja de Ruta 6". Se
// calculan incrementalmente (igual que el dataset) mientras se pagina
// SAP, para que estos endpoints también reflejen el rango completo sin
// depender del arreglo de filas crudas (que está acotado).
const DEFINICIONES_AGRUPADORES = {
  'hoja-asesor': ['asesor'],
  'hoja-cliente': ['cliente', 'nit', 'ciudad'],
  'labor-comercial': ['sede', 'asesor'],
  'portafolio-cartera': ['grupo', 'codigo_articulo', 'articulo'],
  'planeacion-nogales': ['sede', 'nombre_almacen', 'grupo']
};

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware HTTP básico: JSON para req.body y CORS para el frontend en Vercel.
// También aceptamos /api/* para que coincida con las rutas que consume el frontend.
app.use(express.json({ limit: '2mb' }));
app.use(cors({
  origin: ['https://campanaproyecto.vercel.app'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// El frontend actualmente puede llamar directamente a Render usando /api/*.
// Quitamos ese prefijo antes de que Express evalúe las rutas, de modo que
// /api/auth/login sea atendido por la ruta existente /auth/login.
app.use((req, res, next) => {
  if (req.url === '/api' || req.url.startsWith('/api/')) {
    req.url = req.url.slice(4) || '/';
  }
  next();
});

// ============================================================
// AUTENTICACIÓN DEL DASHBOARD — SOLO USUARIOS/PERMISOS
// ============================================================
// La base de datos PostgreSQL se usa exclusivamente para autenticación,
// usuarios, roles y permisos. SAP y todos sus endpoints siguen siendo
// independientes y no usan esta base de datos.
const { initUserDB, getUserByUsername, getUsers, createUser, updateUser, deleteUser } = require('./user-db');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const AUTH_SECRET = process.env.AUTH_SECRET || '';
const ADMIN_ROLE = process.env.ADMIN_ROLE || 'admin';
const AUTH_TOKEN_TTL_SECONDS = Number(process.env.AUTH_TOKEN_TTL_SECONDS || 28800);
const cryptoAuth = require('crypto');

const PAGINAS_PERMITIDAS = [
  'panorama-produccion','panorama-comercial','hoja-asesor','hoja-despacho','hoja-ruta-cliente','hoja-sede',
  'panorama-produccion-diaria','panorama-portafolio','planeacion-nogales','costos-produccion','analisis-inventario','panorama-compras','usuarios'
];
const PERMISOS_POR_ROL = {
  admin: PAGINAS_PERMITIDAS,
  gerencia: PAGINAS_PERMITIDAS.filter(p => p !== 'usuarios'),
  comercio: ['panorama-comercial','hoja-asesor','hoja-ruta-cliente','hoja-sede','panorama-portafolio','panorama-compras'],
  produccion: ['panorama-produccion','hoja-despacho','hoja-sede','panorama-produccion-diaria','planeacion-nogales','costos-produccion','analisis-inventario']
};

function hashPassword(password, saltHex){
  const salt = saltHex || cryptoAuth.randomBytes(16).toString('hex');
  const hash = cryptoAuth.scryptSync(String(password), Buffer.from(salt,'hex'), 64, { N:16384, r:8, p:1 }).toString('hex');
  return salt+':'+hash;
}
function passwordCorrecta(password, stored){
  if(!stored || !stored.includes(':')) return false;
  const [salt, expected] = stored.split(':');
  const actual = hashPassword(password, salt).split(':')[1];
  return expected.length === actual.length && cryptoAuth.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}
function permisosDeUsuario(usuario){
  if(usuario.rol === 'admin') return PAGINAS_PERMITIDAS.slice();
  if(Array.isArray(usuario.permisos)) return usuario.permisos.filter(p => PAGINAS_PERMITIDAS.includes(p));
  return (PERMISOS_POR_ROL[usuario.rol] || []).slice();
}
function crearTokenAuth(usuario){
  const payload = {
    sub: usuario.username,
    nombre: usuario.nombre,
    rol: usuario.rol,
    permisos: permisosDeUsuario(usuario),
    exp: Math.floor(Date.now()/1000)+AUTH_TOKEN_TTL_SECONDS
  };
  const body=Buffer.from(JSON.stringify(payload)).toString('base64url');
  const firma=cryptoAuth.createHmac('sha256',AUTH_SECRET).update(body).digest('base64url');
  return body+'.'+firma;
}
function verificarTokenAuth(token){
  if(!token || !AUTH_SECRET) return null;
  const partes=String(token).split('.'); if(partes.length!==2) return null;
  const [body,firma]=partes;
  const esperada=cryptoAuth.createHmac('sha256',AUTH_SECRET).update(body).digest('base64url');
  const a=Buffer.from(firma), b=Buffer.from(esperada);
  if(a.length!==b.length || !cryptoAuth.timingSafeEqual(a,b)) return null;
  try { const payload=JSON.parse(Buffer.from(body,'base64url').toString('utf8')); if(!payload.exp || payload.exp < Math.floor(Date.now()/1000)) return null; return payload; }
  catch { return null; }
}
function payloadAuth(req){
  const header=String(req.headers.authorization||'');
  return verificarTokenAuth(header.startsWith('Bearer ')?header.slice(7):'');
}
function requiereAuth(req,res,next){
  const payload=payloadAuth(req); if(!payload) return res.status(401).json({ok:false,message:'Sesión no válida o expirada.'});
  req.usuarioAuth=payload; next();
}
function requiereAdmin(req,res,next){
  if(req.usuarioAuth?.rol !== ADMIN_ROLE) return res.status(403).json({ok:false,message:'Solo un administrador puede realizar esta acción.'});
  next();
}
function usuarioPublico(u){
  return {id:u.id,username:u.username,nombre:u.nombre,rol:u.rol,permisos:permisosDeUsuario(u),activo:u.activo!==false};
}

// ============================================================
// AUTH
// ============================================================
app.post('/auth/login',async (req,res)=>{
  try {
    if(!AUTH_SECRET) return res.status(503).json({ok:false,message:'La autenticación no está configurada. Configure AUTH_SECRET en el servidor.'});
    const username=String(req.body?.username||'').trim().toLowerCase();
    const password=String(req.body?.password||'');
    let usuario=await getUserByUsername(username);

    // Compatibilidad con el administrador anterior basado en variables de entorno.
    if(!usuario && ADMIN_USERNAME && ADMIN_PASSWORD && username===ADMIN_USERNAME.toLowerCase() && password===ADMIN_PASSWORD){
      usuario={username:ADMIN_USERNAME,nombre:'Administrador',rol:ADMIN_ROLE,permisos:PAGINAS_PERMITIDAS,activo:true};
    }
    if(!usuario || usuario.activo === false || (!usuario.password_hash ? password!==ADMIN_PASSWORD : !passwordCorrecta(password,usuario.password_hash)))
      return res.status(401).json({ok:false,message:'Usuario o contraseña incorrectos.'});

    const permisos=permisosDeUsuario(usuario);
    return res.json({ok:true,token:crearTokenAuth({...usuario,permisos}),usuario:usuarioPublico({...usuario,permisos})});
  } catch (error) {
    console.error('Error en login:', error);
    return res.status(500).json({ok:false,message:'No se pudo consultar la base de datos de usuarios.'});
  }
});

app.get('/auth/me',requiereAuth,async (req,res)=>{
  try {
    const username=String(req.usuarioAuth.sub||'').trim().toLowerCase();
    const u=await getUserByUsername(username);

    // El administrador configurado por variables de entorno no necesariamente
    // existe en PostgreSQL. Debe poder validar la misma sesión que creó /auth/login.
    const esAdminEnv = !u && ADMIN_USERNAME && ADMIN_PASSWORD &&
      username === String(ADMIN_USERNAME).trim().toLowerCase() &&
      req.usuarioAuth.rol === ADMIN_ROLE;

    if(!u && !esAdminEnv) {
      return res.status(401).json({ok:false,message:'Usuario desactivado o no encontrado.'});
    }
    if(u && u.activo === false) {
      return res.status(401).json({ok:false,message:'El usuario está desactivado.'});
    }

    return res.json({ok:true,usuario:{
      username:req.usuarioAuth.sub,
      nombre:req.usuarioAuth.nombre,
      rol:req.usuarioAuth.rol,
      permisos:req.usuarioAuth.permisos||[]
    }});
  } catch (error) {
    console.error('Error en auth/me:', error);
    return res.status(500).json({ok:false,message:'No se pudo consultar la base de datos de usuarios.'});
  }
});

app.get('/auth/roles',requiereAuth,(req,res)=>res.json({ok:true,roles:Object.keys(PERMISOS_POR_ROL),paginas:PAGINAS_PERMITIDAS,permisosPorRol:PERMISOS_POR_ROL}));

app.get('/auth/users',requiereAuth,requiereAdmin,async (req,res)=>{
  try {
    const usuarios=await getUsers();
    res.json({ok:true,usuarios:usuarios.map(usuarioPublico)});
  } catch (error) {
    console.error('Error listando usuarios:', error);
    res.status(500).json({ok:false,message:'No se pudieron cargar los usuarios.'});
  }
});

app.post('/auth/users',requiereAuth,requiereAdmin,async (req,res)=>{
  try {
    const {nombre,username,password,rol,permisos,activo}=req.body||{};
    const un=String(username||'').trim().toLowerCase();
    if(!nombre || !un || !password) return res.status(400).json({ok:false,message:'Nombre, usuario y contraseña son obligatorios.'});
    if(!/^[a-z0-9._-]{3,40}$/.test(un)) return res.status(400).json({ok:false,message:'El usuario solo puede contener letras, números, punto, guion y guion bajo.'});
    if(String(password).length<6) return res.status(400).json({ok:false,message:'La contraseña debe tener al menos 6 caracteres.'});
    if(!PERMISOS_POR_ROL[rol]) return res.status(400).json({ok:false,message:'Rol no válido.'});
    const existente=await getUserByUsername(un);
    if(existente) return res.status(409).json({ok:false,message:'Ese usuario ya existe.'});
    const permitidos=Array.isArray(permisos)?permisos.filter(p=>PAGINAS_PERMITIDAS.includes(p)):PERMISOS_POR_ROL[rol];
    const nuevo=await createUser({
      nombre:String(nombre).trim(), username:un, rol,
      password_hash:hashPassword(password),
      permisos:rol==='admin'?PAGINAS_PERMITIDAS:permitidos,
      activo:activo!==false
    });
    res.status(201).json({ok:true,usuario:usuarioPublico(nuevo)});
  } catch (error) {
    console.error('Error creando usuario:', error);
    res.status(500).json({ok:false,message:'No se pudo crear el usuario.'});
  }
});

app.put('/auth/users/:id',requiereAuth,requiereAdmin,async (req,res)=>{
  try {
    const usuarios=await getUsers();
    const actual=usuarios.find(x=>String(x.id)===String(req.params.id));
    if(!actual) return res.status(404).json({ok:false,message:'Usuario no encontrado.'});

    const {nombre,username,password,rol,permisos,activo}=req.body||{};
    const cambios={};
    if(nombre!==undefined) cambios.nombre=String(nombre).trim();
    if(username!==undefined){
      const un=String(username).trim().toLowerCase();
      if(usuarios.some(x=>String(x.id)!==String(actual.id) && x.username===un)) return res.status(409).json({ok:false,message:'Ese usuario ya existe.'});
      cambios.username=un;
    }
    if(rol!==undefined){ if(!PERMISOS_POR_ROL[rol]) return res.status(400).json({ok:false,message:'Rol no válido.'}); cambios.rol=rol; }
    if(password){ if(String(password).length<6) return res.status(400).json({ok:false,message:'La contraseña debe tener al menos 6 caracteres.'}); cambios.password_hash=hashPassword(password); }
    if(Array.isArray(permisos)) cambios.permisos=permisos.filter(p=>PAGINAS_PERMITIDAS.includes(p));
    if((cambios.rol || actual.rol)==='admin') cambios.permisos=PAGINAS_PERMITIDAS.slice();
    if(activo!==undefined) cambios.activo=Boolean(activo);

    const actualizado=await updateUser(actual.id,cambios);
    res.json({ok:true,usuario:usuarioPublico(actualizado)});
  } catch (error) {
    console.error('Error actualizando usuario:', error);
    res.status(500).json({ok:false,message:'No se pudo actualizar el usuario.'});
  }
});

app.delete('/auth/users/:id',requiereAuth,requiereAdmin,async (req,res)=>{
  try {
    const usuarios=await getUsers();
    const u=usuarios.find(x=>String(x.id)===String(req.params.id));
    if(!u) return res.status(404).json({ok:false,message:'Usuario no encontrado.'});
    if(u.username===req.usuarioAuth.sub) return res.status(400).json({ok:false,message:'No puedes eliminar el usuario con el que estás conectado.'});
    await deleteUser(u.id);
    res.json({ok:true});
  } catch (error) {
    console.error('Error eliminando usuario:', error);
    res.status(500).json({ok:false,message:'No se pudo eliminar el usuario.'});
  }
});

// ============================================================
// CACHÉ DE SAP (sin base de datos)
// ============================================================
// Cada entrada: clave "inicio|fin" -> { filas, dataset, creadoEn }
// - filas: filas crudas ya mapeadas desde SAP (mismo formato que antes
//   guardaba la tabla facturacion de Postgres).
// - dataset: el dataset agregado (buildDatasetFromFacturacion), calculado
//   perezosamente la primera vez que se pide /dataset para ese rango.
const filasCache = new Map();

// Evita pedirle a SAP el mismo rango dos veces en paralelo (por ejemplo,
// si /dataset y /facturacion llegan casi al tiempo para el mismo rango).
const descargasEnCurso = new Map();

function claveRango(inicio, fin) {
  return `${inicio}|${fin}`;
}

function obtenerEntradaCache(inicio, fin) {
  const key = claveRango(inicio, fin);
  const entry = filasCache.get(key);
  if (!entry) return null;

  if (SAP_CACHE_MINUTOS > 0) {
    const edadMin = (Date.now() - entry.creadoEn) / 60000;
    if (edadMin > SAP_CACHE_MINUTOS) {
      filasCache.delete(key);
      return null;
    }
  } else if (SAP_CACHE_MINUTOS <= 0) {
    return null;
  }

  return entry;
}

function guardarFilasEnCache(inicio, fin, resultado) {
  const key = claveRango(inicio, fin);
  if (filasCache.has(key)) filasCache.delete(key);
  filasCache.set(key, {
    filas: resultado.filas,
    dataset: resultado.dataset,
    agrupados: resultado.agrupados,
    totalRegistros: resultado.totalRegistros,
    filasCrudasTruncadas: resultado.filasCrudasTruncadas,
    creadoEn: Date.now()
  });
  while (filasCache.size > MAX_RANGOS_EN_CACHE) {
    filasCache.delete(filasCache.keys().next().value);
  }
}

// ============================================================
// ESTADO GLOBAL DE SINCRONIZACIÓN (para el botón "Actualizar desde SAP")
// ============================================================

const syncState = {
  ejecutando: false,
  estado: 'idle',
  inicio: null,
  fin: null,
  paginaActual: 0,
  skipActual: 0,
  paginasProcesadas: 0,
  registrosSAP: 0,
  registrosProcesados: 0,
  registrosTotal: 0,
  iniciadoEn: null,
  terminadoEn: null,
  error: null,
  ultimaActividad: null
};

// ============================================================
// INFORMACIÓN DE ARRANQUE
// ============================================================

console.log('===========================================');
console.log('BACKEND LA CAMPANA (sin base de datos, SAP en vivo)');
console.log('===========================================');
console.log('SAP:', SAP_BASE_URL);
console.log('SAP HOST:', SAP_HOST);
console.log('SAP PAGE SIZE:', SAP_PAGE_SIZE);
console.log('CACHÉ DE SAP (minutos):', SAP_CACHE_MINUTOS);
console.log('SAP USER CONFIGURADO:', Boolean(SAP_USER));
console.log('SAP PASSWORD CONFIGURADA:', Boolean(SAP_PASS));
console.log('AUTH CONFIGURADA:', Boolean(ADMIN_USERNAME && ADMIN_PASSWORD && AUTH_SECRET));
console.log('===========================================');

// ============================================================
// UTILIDADES
// ============================================================

function parseSAPDate(value) {
  if (!value) return null;

  if (value instanceof Date) return value.toISOString().slice(0, 10);

  const text = String(value);

  // SAP OData: /Date(1787788800000)/
  const match = text.match(/\/Date\((\d+)(?:[+-]\d+)?\)\//);
  if (match) {
    const timestamp = Number(match[1]);
    if (!Number.isNaN(timestamp)) {
      return new Date(timestamp).toISOString().slice(0, 10);
    }
  }

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  // ISO
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text.slice(0, 10);

  return null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = parseInt(value, 10);
  return Number.isFinite(number) ? number : null;
}

function actualizarActividad() {
  syncState.ultimaActividad = new Date().toISOString();
}

function validarFecha(fecha) {
  return /^\d{4}-\d{2}-\d{2}$/.test(fecha);
}

// ============================================================
// RUTA PRINCIPAL
// ============================================================

app.get('/', (req, res) => {
  res.json({
    ok: true,
    servicio: 'Backend La Campana',
    mensaje: 'Servidor funcionando correctamente (SAP en vivo, sin base de datos)',
    rutas: {
      health: '/health',
      syncSAP: '/sync-sap?inicio=YYYY-MM-DD&fin=YYYY-MM-DD',
      syncStatus: '/sync-status',
      dataset: '/dataset?fecha_inicio=YYYY-MM-DD&fecha_fin=YYYY-MM-DD',
      facturacion: '/facturacion',
      hojaAsesor: '/dashboards/hoja-asesor',
      hojaCliente: '/dashboards/hoja-cliente',
      laborComercial: '/dashboards/labor-comercial',
      portafolioCartera: '/dashboards/portafolio-cartera',
      planeacionNogales: '/dashboards/planeacion-nogales'
    }
  });
});

// ============================================================
// HEALTH
// ============================================================

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    estado: 'ok',
    fuenteDatos: 'SAP (en vivo, sin base de datos)',
    cache: {
      rangosGuardados: filasCache.size,
      minutosDeVida: SAP_CACHE_MINUTOS
    },
    sincronizacion: {
      ejecutando: syncState.ejecutando,
      estado: syncState.estado,
      paginaActual: syncState.paginaActual,
      paginasProcesadas: syncState.paginasProcesadas,
      registrosSAP: syncState.registrosSAP,
      registrosProcesados: syncState.registrosProcesados
    },
    fecha: new Date().toISOString()
  });
});

// ============================================================
// ESTADO DE SINCRONIZACIÓN
// ============================================================

app.get('/sync-status', (req, res) => {
  res.json({
    ok: true,
    sincronizacion: {
      ejecutando: syncState.ejecutando,
      estado: syncState.estado,
      inicio: syncState.inicio,
      fin: syncState.fin,
      paginaActual: syncState.paginaActual,
      skipActual: syncState.skipActual,
      paginasProcesadas: syncState.paginasProcesadas,
      paginaSize: SAP_PAGE_SIZE,
      registrosSAP: syncState.registrosSAP,
      registrosProcesados: syncState.registrosProcesados,
      registrosTotal: syncState.registrosTotal,
      iniciadoEn: syncState.iniciadoEn,
      terminadoEn: syncState.terminadoEn,
      ultimaActividad: syncState.ultimaActividad,
      error: syncState.error
    }
  });
});

// ============================================================
// CONSULTAR SAP - UNA PÁGINA
// ============================================================

async function consultarSAPPagina(inicio, fin, skip, top) {
  // Usamos un rango semiabierto [inicio, fin+1 día) para no perder
  // registros del último día cuando SAP guarda la fecha como datetime.
  const finExclusivo = new Date(`${fin}T00:00:00Z`);
  finExclusivo.setUTCDate(finExclusivo.getUTCDate() + 1);
  const finOData = finExclusivo.toISOString().slice(0, 10);

  const filter =
    `Fecha_Factura ge datetime'${inicio}' and ` +
    `Fecha_Factura lt datetime'${finOData}'`;

  console.log(`Consultando SAP: ${inicio} → ${fin} | skip=${skip} | top=${top}`);
  actualizarActividad();

  try {
    const response = await axios.get(SAP_BASE_URL, {
      params: { $filter: filter, $format: 'json', $top: top, $skip: skip, $inlinecount: 'allpages' },
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      timeout: 600000,
      headers: { Accept: 'application/json', Host: SAP_HOST },
      auth: SAP_USER && SAP_PASS ? { username: SAP_USER, password: SAP_PASS } : undefined
    });

    console.log(`✓ SAP respondió HTTP ${response.status}`);
    actualizarActividad();

    return response.data;
  } catch (error) {
    const status = error.response?.status || null;
    let detalle = error.response?.data || error.message;

    if (typeof detalle !== 'string') {
      try {
        detalle = JSON.stringify(detalle);
      } catch {
        detalle = String(detalle);
      }
    }

    const nuevoError = new Error(`SAP respondió con error${status ? ` HTTP ${status}` : ''}`);
    nuevoError.status = status;
    nuevoError.detalle = detalle;
    throw nuevoError;
  }
}

// ============================================================
// MAPEAR REGISTRO SAP
// ============================================================

function mapSAPRecord(row) {
  return {
    sap_id: row.ID || null,
    cliente: row.Cliente || null,
    nit: row.Nit !== null && row.Nit !== undefined ? String(row.Nit) : null,
    ciudad: row.Ciudad || null,
    departamento: row.Departamento || null,
    ciiu: row.CIIU || null,
    numero_factura:
      row.Numero_Factura !== null && row.Numero_Factura !== undefined
        ? String(row.Numero_Factura)
        : null,
    fecha_factura: parseSAPDate(row.Fecha_Factura),
    plazo: row.Plazo || null,
    cupo_credito: toNumber(row.Cupo_Credito),
    cupo_usado: toNumber(row.Cupo_Usado),
    asesor: row.Asesor || null,
    meta_anual_asesor: toNumber(row.Meta_Anual_Asesor),
    sede: row.Sede || null,
    meta_anual_sede: toNumber(row.Meta_Anual_Sede),
    nombre_almacen: row.Nombre_Almacen || null,
    codigo_articulo: row.Codigo_Articulo || null,
    articulo: row.Articulo || null,
    grupo: row.Grupo || null,
    meta_anual_grupo: toNumber(row.Meta_Anual_Grupo),
    factura_paga_total: row.Factura_Paga_Total || null,
    valor_pagado: toNumber(row.Valor_Pagado),
    valor_total_articulo: toNumber(row.Valor_Total_Articulo),
    dias_mora: toInteger(row.Dias_Mora),
    kilos: toNumber(row.Kilos),
    valor_kilo: toNumber(row.Valor_Kilo),
    costo_kilo: toNumber(row.Costo_Kilo),
    peso_unitario: toNumber(row.Peso_Unitario)
  };
}

// ============================================================
// DESCARGAR UN RANGO COMPLETO DESDE SAP (paginando por mes)
// ============================================================
// Reemplaza a la vieja "ejecutarSincronizacion": en vez de guardar cada
// lote en Postgres, va acumulando las filas mapeadas en un arreglo en
// memoria y las devuelve al terminar. Si actualizarEstado=true, además
// va reportando el progreso en syncState (lo usa /sync-sap para que el
// botón del frontend muestre "sincronizando X/Y").

// Mantiene una ventana acotada (por defecto 20.000) con las filas crudas
// MÁS RECIENTES vistas hasta ahora, sin dejar crecer el arreglo sin
// límite. Como SAP se recorre mes por mes en orden cronológico, esto
// aproxima bien "las filas más recientes" que es lo que necesita
// /facturacion (ordena por fecha descendente). Se poda cada cierto
// número de inserciones en vez de en cada una, para que el costo de
// recortar el arreglo no se pague en cada fila.
function agregarFilaCruda(buffer, r, cap) {
  buffer.push(r);
  if (buffer.length > cap + Math.ceil(cap * 0.2)) {
    buffer.splice(0, buffer.length - cap);
  }
}

async function descargarRangoDesdeSAP(inicio, fin, actualizarEstado) {
  // Ya NO se acumulan las ~200.000 filas crudas en un arreglo antes de
  // agregarlas: el dataset comercial se va construyendo fila por fila a
  // medida que llega cada página de SAP (acumularFila). El uso de
  // memoria queda proporcional al número de clientes/asesores/artículos
  // distintos (cientos), no al número de líneas de factura (cientos de
  // miles). Solo se conserva, aparte, una ventana acotada de filas
  // crudas (MAX_FILAS_CRUDAS_CACHE) para que /facturacion pueda seguir
  // mostrando/paginando el detalle línea por línea.
  const acc = crearAcumulador();
  const filas = [];
  let totalRegistros = 0;

  const agrupadores = {};
  for (const nombre in DEFINICIONES_AGRUPADORES) {
    agrupadores[nombre] = crearAgrupador(DEFINICIONES_AGRUPADORES[nombre]);
  }

  // SAP puede tener límites prácticos para consultas muy grandes.
  // Dividimos automáticamente cualquier rango en meses y paginamos cada
  // mes hasta terminar. Así funcionan rangos de días, meses, 2 años, 3
  // años o más sin depender de un único request gigante.
  const partes = [];
  let cursor = new Date(`${inicio}T00:00:00Z`);
  const ultimo = new Date(`${fin}T00:00:00Z`);

  while (cursor <= ultimo) {
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth();
    const inicioParte = cursor.toISOString().slice(0, 10);
    const ultimoDia = new Date(Date.UTC(y, m + 1, 0));
    const finParteDate = ultimoDia < ultimo ? ultimoDia : ultimo;
    const finParte = finParteDate.toISOString().slice(0, 10);
    partes.push({ inicio: inicioParte, fin: finParte });
    cursor = new Date(Date.UTC(y, m + 1, 1));
  }

  let paginaGlobal = 0;

  for (const parte of partes) {
    let skip = 0;
    let paginaMes = 0;

    while (true) {
      paginaMes++;
      paginaGlobal++;

      if (actualizarEstado) {
        syncState.paginaActual = paginaGlobal;
        syncState.skipActual = skip;
        actualizarActividad();
      }

      console.log('===========================================');
      console.log(`Consultando SAP ${parte.inicio} → ${parte.fin} | página ${paginaMes} | skip ${skip} | top ${SAP_PAGE_SIZE}`);

      const data = await consultarSAPPagina(parte.inicio, parte.fin, skip, SAP_PAGE_SIZE);
      const resultados = data?.d?.results || [];
      const cantidad = resultados.length;

      // OData v2 puede devolver __count con $inlinecount=allpages.
      // Solo se toma una vez por cada mes para construir un total estimado
      // exacto del rango completo antes de terminar la paginación.
      if (actualizarEstado && paginaMes === 1) {
        const countMes = Number(data?.d?.__count);
        if (Number.isFinite(countMes) && countMes >= 0) {
          syncState.registrosTotal += countMes;
        }
      }

      console.log(`SAP devolvió ${cantidad} registros${Number.isFinite(Number(data?.d?.__count)) ? ` de ${data.d.__count} en este mes` : ''}`);

      if (cantidad === 0) break;

      const registros = resultados.map(mapSAPRecord).filter(r => r.sap_id);

      // Agregar esta página al dataset comercial YA, y soltarla: no se
      // guarda un arreglo con las filas crudas completas del rango.
      for (const r of registros) {
        acumularFila(acc, r);
        agregarFilaCruda(filas, r, MAX_FILAS_CRUDAS_CACHE);
        for (const nombre in agrupadores) agregarFilaAgrupador(agrupadores[nombre], r);
      }
      totalRegistros += registros.length;

      if (actualizarEstado) {
        syncState.registrosSAP += cantidad;
        syncState.registrosProcesados += registros.length;
        syncState.paginasProcesadas = paginaGlobal;
        actualizarActividad();
      }

      console.log(`✓ ${parte.inicio} → ${parte.fin}: página ${paginaMes} procesada`);
      console.log(`✓ Total agregado hasta ahora: ${totalRegistros} (filas crudas en ventana: ${filas.length}${totalRegistros > MAX_FILAS_CRUDAS_CACHE ? ', recortada' : ''})`);

      if (cantidad < SAP_PAGE_SIZE) break;
      skip += SAP_PAGE_SIZE;
    }
  }

  // Recorte final por si quedó por encima del cap tras la última página.
  if (filas.length > MAX_FILAS_CRUDAS_CACHE) filas.splice(0, filas.length - MAX_FILAS_CRUDAS_CACHE);

  const dataset = finalizarDataset(acc);
  const filasCrudasTruncadas = totalRegistros > MAX_FILAS_CRUDAS_CACHE;

  const agrupados = {};
  for (const nombre in agrupadores) agrupados[nombre] = finalizarAgrupador(agrupadores[nombre]);

  return { filas, dataset, agrupados, totalRegistros, filasCrudasTruncadas };
}

// ============================================================
// OBTENER FILAS (caché de SAP o SAP en vivo)
// ============================================================
// Punto de entrada único que usan /dataset, /facturacion y todos los
// /dashboards/*. Si el rango ya está en caché y no ha caducado, no
// vuelve a tocar SAP. Si dos requests piden el mismo rango al mismo
// tiempo, comparten la misma descarga en vez de duplicarla.

function iniciarDescarga(inicio, fin, opciones) {
  const key = claveRango(inicio, fin);

  if (descargasEnCurso.has(key)) {
    return descargasEnCurso.get(key);
  }

  const promesa = descargarRangoDesdeSAP(inicio, fin, opciones && opciones.actualizarEstado)
    .then(resultado => {
      guardarFilasEnCache(inicio, fin, resultado);
      return resultado;
    })
    .finally(() => descargasEnCurso.delete(key));

  descargasEnCurso.set(key, promesa);
  return promesa;
}

async function obtenerFilas(inicio, fin, { forzar = false } = {}) {
  if (!forzar) {
    const entry = obtenerEntradaCache(inicio, fin);
    if (entry) return { filas: entry.filas, totalRegistros: entry.totalRegistros, filasCrudasTruncadas: entry.filasCrudasTruncadas, deCache: true };
  }

  const resultado = await iniciarDescarga(inicio, fin);
  return { filas: resultado.filas, totalRegistros: resultado.totalRegistros, filasCrudasTruncadas: resultado.filasCrudasTruncadas, deCache: false };
}

async function obtenerDataset(inicio, fin, opciones) {
  // El dataset agregado ya viene calculado desde descargarRangoDesdeSAP
  // (se construyó incrementalmente mientras se paginaba SAP), así que
  // aquí ya no se vuelve a recorrer ningún arreglo grande para agregarlo.
  if (!(opciones && opciones.forzar)) {
    const entry = obtenerEntradaCache(inicio, fin);
    if (entry) return { dataset: entry.dataset, filas: entry.filas, totalRegistros: entry.totalRegistros, deCache: true };
  }

  const resultado = await iniciarDescarga(inicio, fin);
  return { dataset: resultado.dataset, filas: resultado.filas, totalRegistros: resultado.totalRegistros, deCache: false };
}

// Usado por los 5 dashboards de "Hoja de Ruta 6": devuelve la agrupación
// ya calculada durante la descarga (agrupados[nombre]), sin volver a
// recorrer ningún arreglo de filas crudas.
async function obtenerAgrupado(inicio, fin, nombre, { forzar = false } = {}) {
  if (!forzar) {
    const entry = obtenerEntradaCache(inicio, fin);
    if (entry) return { grupos: entry.agrupados[nombre], deCache: true };
  }

  const resultado = await iniciarDescarga(inicio, fin);
  return { grupos: resultado.agrupados[nombre], deCache: false };
}

// ============================================================
// AGREGACIÓN EN MEMORIA (reemplaza los GROUP BY que hacía Postgres)
// ============================================================

function crearAgrupador(camposClave, filtro) {
  return { camposClave, filtro, grupos: new Map() };
}

function agregarFilaAgrupador(agrupador, r) {
  const { camposClave, filtro, grupos } = agrupador;
  if (filtro && !filtro(r)) return;

  const claveVals = camposClave.map(c => (r[c] === undefined ? null : r[c]));
  if (!claveVals[0]) return; // el primer campo de la clave es obligatorio (igual que "X IS NOT NULL" en SQL)

  const claveStr = claveVals.join('\u0001');
  let g = grupos.get(claveStr);

  if (!g) {
    g = { _lineas: 0, _facturas: new Set(), _monto: 0, _pagado: 0, _kilos: 0, _pagadas: 0, _maxDiasMora: 0, _ultimaFactura: null };
    camposClave.forEach((c, i) => { g[c] = claveVals[i]; });
    grupos.set(claveStr, g);
  }

  g._lineas++;
  if (r.numero_factura) g._facturas.add(r.numero_factura);
  g._monto += Number(r.valor_total_articulo) || 0;
  g._pagado += Number(r.valor_pagado) || 0;
  g._kilos += Number(r.kilos) || 0;
  if ((r.factura_paga_total || '').toString().toUpperCase() === 'SI') g._pagadas++;

  const dm = Number(r.dias_mora) || 0;
  if (dm > g._maxDiasMora) g._maxDiasMora = dm;

  if (r.fecha_factura && (!g._ultimaFactura || r.fecha_factura > g._ultimaFactura)) {
    g._ultimaFactura = r.fecha_factura;
  }
}

function finalizarAgrupador(agrupador) {
  return [...agrupador.grupos.values()];
}

// Compatibilidad: agrupa un arreglo ya completo en memoria (no se usa en
// el camino de descarga de SAP, que ahora agrupa incrementalmente).
function agruparFacturacion(filas, camposClave, filtro) {
  const agrupador = crearAgrupador(camposClave, filtro);
  for (const r of filas) agregarFilaAgrupador(agrupador, r);
  return finalizarAgrupador(agrupador);
}

// ============================================================
// SYNC-SAP (precalienta el caché de SAP — ya NO escribe en ninguna
// base de datos; solo deja las filas listas en RAM para que /dataset y
// /facturacion respondan al instante después)
// ============================================================

app.get('/sync-sap', async (req, res) => {
  const inicio = req.query.inicio || '2026-08-01';
  const fin = req.query.fin || '2026-08-27';
  const forzar = req.query.forzar === '1' || req.query.forzar === 'true';

  if (!validarFecha(inicio) || !validarFecha(fin)) {
    return res.status(400).json({
      ok: false,
      error: 'Las fechas deben tener formato YYYY-MM-DD',
      ejemplo: '/sync-sap?inicio=2026-08-01&fin=2026-08-27'
    });
  }

  if (inicio > fin) {
    return res.status(400).json({ ok: false, error: 'La fecha inicio no puede ser mayor que la fecha fin' });
  }

  // Si este mismo rango ya está fresco en memoria, no volvemos a golpear SAP.
  if (!forzar) {
    const entry = obtenerEntradaCache(inicio, fin);
    if (entry) {
      return res.status(200).json({
        ok: true,
        yaSincronizado: true,
        mensaje: `Este rango ya se consultó hace poco (${entry.totalRegistros} registros agregados${entry.filasCrudasTruncadas ? `, detalle crudo limitado a las últimas ${MAX_FILAS_CRUDAS_CACHE}` : ''}, guardados en el caché de SAP de Render). No se volvió a consultar SAP.`,
        sincronizadoEn: new Date(entry.creadoEn).toISOString(),
        registros: entry.totalRegistros,
        fechas: { inicio, fin },
        forzarConsulta: `/sync-sap?inicio=${inicio}&fin=${fin}&forzar=1`
      });
    }
  }

  if (syncState.ejecutando) {
    return res.status(409).json({
      ok: false,
      mensaje: 'Ya existe una sincronización SAP en ejecución',
      sincronizacion: {
        estado: syncState.estado,
        inicio: syncState.inicio,
        fin: syncState.fin,
        paginaActual: syncState.paginaActual,
        paginasProcesadas: syncState.paginasProcesadas,
        registrosSAP: syncState.registrosSAP,
        registrosProcesados: syncState.registrosProcesados
      },
      consultarEstado: '/sync-status'
    });
  }

  syncState.ejecutando = true;
  syncState.estado = 'procesando';
  syncState.inicio = inicio;
  syncState.fin = fin;
  syncState.paginaActual = 0;
  syncState.skipActual = 0;
  syncState.paginasProcesadas = 0;
  syncState.registrosSAP = 0;
  syncState.registrosProcesados = 0;
  syncState.registrosTotal = 0;
  syncState.iniciadoEn = new Date().toISOString();
  syncState.terminadoEn = null;
  syncState.error = null;
  actualizarActividad();

  console.log('===========================================');
  console.log('SYNC SAP INICIADA EN SEGUNDO PLANO');
  console.log(`${inicio} → ${fin}`);
  console.log('===========================================');

  iniciarDescarga(inicio, fin, { actualizarEstado: true })
    .then(resultado => {
      syncState.ejecutando = false;
      syncState.estado = 'completado';
      syncState.terminadoEn = new Date().toISOString();
      actualizarActividad();

      console.log('===========================================');
      console.log('✓ CONSULTA SAP COMPLETADA');
      console.log(`✓ Registros agregados: ${resultado.totalRegistros} (detalle crudo en memoria: ${resultado.filas.length}${resultado.filasCrudasTruncadas ? ', truncado' : ''})`);
      console.log('===========================================');
    })
    .catch(error => {
      console.error('===========================================');
      console.error('✗ ERROR CONSULTANDO SAP');
      console.error(error);
      console.error('===========================================');

      syncState.ejecutando = false;
      syncState.estado = 'error';
      syncState.error = {
        mensaje: error.message,
        detalle: error.detalle || null,
        httpStatusSAP: error.status || null
      };
      syncState.terminadoEn = new Date().toISOString();
      actualizarActividad();
    });

  return res.status(202).json({
    ok: true,
    mensaje: 'Consulta a SAP iniciada en segundo plano',
    fechas: { inicio, fin },
    paginaSize: SAP_PAGE_SIZE,
    estado: 'procesando',
    consultarEstado: '/sync-status'
  });
});

// ============================================================
// DATASET COMERCIAL PREAGREGADO
// ============================================================

app.get('/dataset', async (req, res) => {
  const fecha_inicio = req.query.fecha_inicio || '2026-08-01';
  const fecha_fin = req.query.fecha_fin || '2026-08-27';

  if (!validarFecha(fecha_inicio) || !validarFecha(fecha_fin)) {
    return res.status(400).json({ ok: false, error: 'Las fechas deben tener formato YYYY-MM-DD' });
  }

  if (fecha_inicio > fecha_fin) {
    return res.status(400).json({ ok: false, error: 'La fecha inicio no puede ser mayor que la fecha fin' });
  }

  try {
    const { dataset, totalRegistros, deCache } = await obtenerDataset(fecha_inicio, fecha_fin);

    return res.json({
      ok: true,
      cached: deCache,
      data: dataset.DATA,
      inv: dataset.INV,
      fechas: { inicio: fecha_inicio, fin: fecha_fin },
      filasProcesadas: totalRegistros
    });
  } catch (error) {
    console.error('Error en /dataset:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// ============================================================
// FACTURACIÓN (filas crudas, paginadas)
// ============================================================

app.get('/facturacion', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 1000);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const fecha_inicio = req.query.fecha_inicio || '2026-08-01';
  const fecha_fin = req.query.fecha_fin || '2026-08-27';

  if (!validarFecha(fecha_inicio) || !validarFecha(fecha_fin)) {
    return res.status(400).json({ ok: false, error: 'Las fechas deben tener formato YYYY-MM-DD' });
  }

  try {
    const { filas, totalRegistros, filasCrudasTruncadas } = await obtenerFilas(fecha_inicio, fecha_fin);

    const ordenadas = [...filas].sort((a, b) => {
      const fa = a.fecha_factura || '';
      const fb = b.fecha_factura || '';
      if (fa !== fb) return fb.localeCompare(fa);
      return String(b.sap_id || '').localeCompare(String(a.sap_id || ''));
    });

    const pagina = ordenadas.slice(offset, offset + limit);

    res.json({
      ok: true,
      data: pagina,
      total: totalRegistros,
      // Si el rango tiene más registros que MAX_FILAS_CRUDAS_CACHE, el
      // detalle línea por línea solo cubre las filas más recientes vistas
      // (los dashboards agregados en /dataset SÍ cubren el rango completo).
      detalleTruncado: Boolean(filasCrudasTruncadas),
      detalleDisponible: filas.length,
      limit,
      offset,
      fechas: { inicio: fecha_inicio, fin: fecha_fin }
    });
  } catch (error) {
    console.error('Error en /facturacion:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============================================================
// HOJA DE ASESOR
// ============================================================

app.get('/dashboards/hoja-asesor', async (req, res) => {
  const inicio = req.query.inicio || '2026-08-01';
  const fin = req.query.fin || '2026-08-27';

  try {
    const { grupos } = await obtenerAgrupado(inicio, fin, 'hoja-asesor');

    const data = grupos
      .map(g => ({
        asesor: g.asesor,
        total_lineas: g._lineas,
        total_facturas: g._facturas.size,
        total_monto: Math.round(g._monto * 100) / 100,
        total_pagado: Math.round(g._pagado * 100) / 100,
        total_kilos: Math.round(g._kilos * 10000) / 10000,
        promedio_valor_kilo: g._kilos > 0 ? Math.round((g._monto / g._kilos) * 10000) / 10000 : 0,
        lineas_pagadas: g._pagadas
      }))
      .sort((a, b) => b.total_monto - a.total_monto);

    res.json({ ok: true, data, fechas: { inicio, fin } });
  } catch (error) {
    console.error('Error en hoja-asesor:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============================================================
// HOJA DE CLIENTE
// ============================================================

app.get('/dashboards/hoja-cliente', async (req, res) => {
  const inicio = req.query.inicio || '2026-08-01';
  const fin = req.query.fin || '2026-08-27';

  try {
    const { grupos } = await obtenerAgrupado(inicio, fin, 'hoja-cliente');

    const data = grupos
      .map(g => ({
        cliente: g.cliente,
        nit: g.nit,
        ciudad: g.ciudad,
        total_lineas: g._lineas,
        total_facturas: g._facturas.size,
        total_monto: Math.round(g._monto * 100) / 100,
        total_pagado: Math.round(g._pagado * 100) / 100,
        total_kilos: Math.round(g._kilos * 10000) / 10000,
        ultima_factura: g._ultimaFactura,
        lineas_pagadas: g._pagadas,
        max_dias_mora: g._maxDiasMora
      }))
      .sort((a, b) => b.total_monto - a.total_monto)
      .slice(0, 100);

    res.json({ ok: true, data, fechas: { inicio, fin } });
  } catch (error) {
    console.error('Error en hoja-cliente:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============================================================
// LABOR COMERCIAL
// ============================================================

app.get('/dashboards/labor-comercial', async (req, res) => {
  const inicio = req.query.inicio || '2026-08-01';
  const fin = req.query.fin || '2026-08-27';

  try {
    const { grupos } = await obtenerAgrupado(inicio, fin, 'labor-comercial');

    const data = grupos
      .map(g => ({
        sede: g.sede,
        asesor: g.asesor,
        total_lineas: g._lineas,
        total_facturas: g._facturas.size,
        total_monto: Math.round(g._monto * 100) / 100,
        total_pagado: Math.round(g._pagado * 100) / 100,
        total_kilos: Math.round(g._kilos * 10000) / 10000
      }))
      .sort((a, b) => b.total_monto - a.total_monto);

    res.json({
      ok: true,
      data,
      fechas: { inicio, fin },
      camposSAP: ['Sede', 'Asesor', 'Numero_Factura', 'Valor_Total_Articulo', 'Valor_Pagado', 'Kilos'],
      nota: 'El endpoint SAP consultado no entrega actualmente un campo denominado Labor_Comercial. El resultado se construye con Sede y Asesor.'
    });
  } catch (error) {
    console.error('Error en labor-comercial:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============================================================
// PORTAFOLIO Y CARTERA
// ============================================================

app.get('/dashboards/portafolio-cartera', async (req, res) => {
  const inicio = req.query.inicio || '2026-08-01';
  const fin = req.query.fin || '2026-08-27';

  try {
    const { grupos } = await obtenerAgrupado(inicio, fin, 'portafolio-cartera');

    const data = grupos
      .map(g => ({
        grupo: g.grupo,
        codigo_articulo: g.codigo_articulo,
        articulo: g.articulo,
        total_lineas: g._lineas,
        total_facturas: g._facturas.size,
        total_monto: Math.round(g._monto * 100) / 100,
        total_pagado: Math.round(g._pagado * 100) / 100,
        total_kilos: Math.round(g._kilos * 10000) / 10000,
        promedio_valor_kilo: g._kilos > 0 ? Math.round((g._monto / g._kilos) * 10000) / 10000 : 0
      }))
      .sort((a, b) => b.total_monto - a.total_monto);

    res.json({
      ok: true,
      data,
      fechas: { inicio, fin },
      camposSAP: ['Grupo', 'Codigo_Articulo', 'Articulo', 'Valor_Total_Articulo', 'Valor_Pagado', 'Kilos', 'Valor_Kilo'],
      nota: 'El endpoint SAP consultado no entrega actualmente campos denominados Portafolio o Cartera. El resultado se construye con Grupo, Artículo y valores de facturación.'
    });
  } catch (error) {
    console.error('Error en portafolio-cartera:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============================================================
// PLANEACIÓN NOGALES
// ============================================================

app.get('/dashboards/planeacion-nogales', async (req, res) => {
  const inicio = req.query.inicio || '2026-08-01';
  const fin = req.query.fin || '2026-08-27';

  try {
    const { grupos } = await obtenerAgrupado(inicio, fin, 'planeacion-nogales');

    const data = grupos
      .map(g => ({
        sede: g.sede,
        nombre_almacen: g.nombre_almacen,
        grupo: g.grupo,
        total_lineas: g._lineas,
        total_facturas: g._facturas.size,
        total_monto: Math.round(g._monto * 100) / 100,
        total_pagado: Math.round(g._pagado * 100) / 100,
        total_kilos: Math.round(g._kilos * 10000) / 10000
      }))
      .sort((a, b) => b.total_monto - a.total_monto);

    res.json({
      ok: true,
      data,
      fechas: { inicio, fin },
      camposSAP: ['Sede', 'Nombre_Almacen', 'Grupo', 'Numero_Factura', 'Valor_Total_Articulo', 'Valor_Pagado', 'Kilos'],
      nota: 'El endpoint SAP consultado no entrega actualmente un campo denominado Planeacion. El resultado se construye con Sede, Nombre_Almacen y Grupo.'
    });
  } catch (error) {
    console.error('Error en planeacion-nogales:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============================================================
// 404
// ============================================================

app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Ruta no encontrada', ruta: req.originalUrl });
});

// ============================================================
// MANEJO DE ERRORES GENERALES
// ============================================================

app.use((error, req, res, next) => {
  console.error('ERROR GENERAL:', error);
  if (res.headersSent) return next(error);
  res.status(500).json({ ok: false, error: 'Error interno del servidor', detalle: error.message });
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================
// La única conexión persistente es para usuarios/permisos. SAP continúa
// funcionando de forma independiente y no usa PostgreSQL.

async function iniciarServidor(){
  try {
    await initUserDB({
      seedFile: require('path').join(__dirname, 'users.json'),
      hashPassword
    });
    console.log('✓ Base de datos de usuarios lista');
  } catch (error) {
    console.error('✗ No se pudo inicializar la base de datos de usuarios:', error.message);
    process.exit(1);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✓ Server running on port ${PORT}`);
  console.log('✓ GET /');
  console.log('✓ GET /health');
  console.log('✓ GET /sync-sap');
  console.log('✓ GET /sync-status');
  console.log('✓ GET /dataset');
  console.log('✓ GET /facturacion');
  console.log('✓ GET /dashboards/hoja-asesor');
  console.log('✓ GET /dashboards/hoja-cliente');
  console.log('✓ GET /dashboards/labor-comercial');
  console.log('✓ GET /dashboards/portafolio-cartera');
    console.log('✓ GET /dashboards/planeacion-nogales');
  });
}

iniciarServidor();

module.exports = app;
