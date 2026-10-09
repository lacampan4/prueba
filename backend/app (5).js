require('dotenv').config();

const express = require('express');
const cors = require('cors');
const zlib = require('zlib');
const { promisify } = require('util');
const gzipAsync = promisify(zlib.gzip);
const axios = require('axios');
const https = require('https');
const crypto = require('crypto');
const buildDatasetFromFacturacion = require('./dataset');
const { crearAcumulador, acumularFila, finalizarDataset } = buildDatasetFromFacturacion;
const { crearAcumuladorMargen, acumularFilaMargen, finalizarDatasetMargen } = require('./margen-dataset');
const { crearAcumuladorSurtidos, acumularFilaSurtidos, finalizarDatasetSurtidos } = require('./surtidos-dataset');


// ============================================================
// CONFIGURACIÓN SAP
// ============================================================
// SAP sigue siendo la única fuente de datos del dashboard.
// Los usuarios, roles,
// permisos y autenticación.
//
// Se restaura la configuración de conexión SAP del proyecto
// que funcionaba antes de agregar usuarios.
const DEFAULT_SAP_URL =
  'https://170.239.154.46:4300/api_campana26/facturacion.xsodata/Facturacion';

let SAP_BASE_URL =
  process.env.SAP_SERVICE_URL ||
  process.env.SAP_BASE_URL ||
  DEFAULT_SAP_URL;

function normalizarSAPUrl(url) {
  if (!url) return DEFAULT_SAP_URL;

  let resultado = String(url).trim();

  const segundaUrl = resultado.indexOf('https://', 8);
  if (segundaUrl !== -1) resultado = resultado.substring(segundaUrl);

  const terceraUrl = resultado.indexOf('http://', 8);
  if (terceraUrl !== -1) resultado = resultado.substring(terceraUrl);

  return resultado;
}

SAP_BASE_URL = normalizarSAPUrl(SAP_BASE_URL);

// API SAP EXCLUSIVA PARA EL DASHBOARD DE PRODUCCIÓN.
// IMPORTANTE: esta variable es independiente de SAP_SERVICE_URL/SAP_BASE_URL,
// que siguen apuntando al servicio Facturacion usado por los demás dashboards.
const DEFAULT_PRODUCCION_SAP_URL =
  'https://170.239.154.46:4300/api_campana26/produccion.xsodata/Produccion';

let SAP_PRODUCCION_URL =
  process.env.SAP_PRODUCCION_URL ||
  DEFAULT_PRODUCCION_SAP_URL;

function normalizarProduccionSAPUrl(url) {
  if (!url) return DEFAULT_PRODUCCION_SAP_URL;
  let resultado = String(url).trim();
  const segundaUrl = resultado.indexOf('https://', 8);
  if (segundaUrl !== -1) resultado = resultado.substring(segundaUrl);
  const terceraUrl = resultado.indexOf('http://', 8);
  if (terceraUrl !== -1) resultado = resultado.substring(terceraUrl);
  return resultado;
}

SAP_PRODUCCION_URL = normalizarProduccionSAPUrl(SAP_PRODUCCION_URL);

const SAP_PRODUCCION_HOST =
  process.env.SAP_PRODUCCION_HOST || 'NDB.n00.CAMPANADB02';

const SAP_PRODUCCION_USER = process.env.SAP_PRODUCCION_USER || process.env.SAP_USER || '';
const SAP_PRODUCCION_PASS = process.env.SAP_PRODUCCION_PASS || process.env.SAP_PASS || '';

// API SAP EXCLUSIVA PARA EL BOTÓN "Cargar inventario" de Surtidos Sedes.
// Variables de Render: SAP_INVENTARIO_URL y SAP_INVENTARIO_HOST (opcionales:
// SAP_INVENTARIO_USER / SAP_INVENTARIO_PASS; si no existen se usan SAP_USER / SAP_PASS).
const DEFAULT_INVENTARIO_SAP_URL =
  'https://170.239.154.46:4300/api_campana26/inventario.xsodata/Inventario';

function normalizarInventarioSAPUrl(url) {
  let resultado = String(url || '').trim();
  if (!resultado) return DEFAULT_INVENTARIO_SAP_URL;
  const segundaUrl = resultado.indexOf('https://', 8);
  if (segundaUrl !== -1) resultado = resultado.substring(segundaUrl);
  const terceraUrl = resultado.indexOf('http://', 8);
  if (terceraUrl !== -1) resultado = resultado.substring(terceraUrl);
  // Se pega tal cual la URL con "?$format=json": los parámetros se agregan aparte.
  const q = resultado.indexOf('?');
  if (q !== -1) resultado = resultado.substring(0, q);
  return resultado;
}

const SAP_INVENTARIO_URL = normalizarInventarioSAPUrl(process.env.SAP_INVENTARIO_URL);
const SAP_INVENTARIO_HOST =
  String(process.env.SAP_INVENTARIO_HOST || '').trim() || 'NDB.n00.CAMPANADB02';
const SAP_INVENTARIO_USER = process.env.SAP_INVENTARIO_USER || process.env.SAP_USER || '';
const SAP_INVENTARIO_PASS = process.env.SAP_INVENTARIO_PASS || process.env.SAP_PASS || '';


// El proyecto original usaba SAP_SYSTEM_HOST.
// No se toma SAP_HOST, que actualmente está configurado con espacios.
const SAP_HOST = process.env.SAP_SYSTEM_HOST || 'NDB.n00.CAMPANADB02';
const SAP_USER = process.env.SAP_USER || '';
const SAP_PASS = process.env.SAP_PASS || '';

// Por defecto se sigue sin validar el certificado TLS de SAP (comportamiento
// histórico de este proyecto, típico de un SAP on-prem con certificado
// autofirmado). Esto es inseguro: expone la conexión (incluidas las
// credenciales SAP_USER/SAP_PASS) a un posible ataque man-in-the-middle.
// Se puede endurecer sin tocar código poniendo SAP_TLS_REJECT_UNAUTHORIZED=true
// en las variables de entorno una vez se confirme que SAP presenta un
// certificado válido (o se configure el CA correcto).
const SAP_TLS_REJECT_UNAUTHORIZED =
  String(process.env.SAP_TLS_REJECT_UNAUTHORIZED || 'false').toLowerCase() === 'true';
if (!SAP_TLS_REJECT_UNAUTHORIZED) {
  console.warn('⚠ ADVERTENCIA DE SEGURIDAD: la verificación del certificado TLS de SAP está DESACTIVADA (SAP_TLS_REJECT_UNAUTHORIZED=false). La conexión es vulnerable a man-in-the-middle. Actívala en producción en cuanto sea posible.');
}

const SAP_PAGE_SIZE = parseInt(process.env.SAP_PAGE_SIZE || '5000', 10);
// Los dashboards que forman parte de "Hoja de Ruta 6" usan el mismo flujo SAP directo.
// Cinco de ellos además tienen agrupaciones específicas en backend. Se
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
// CORS: el frontend está publicado en Vercel. Se acepta la URL actual
// y también una lista configurable en CORS_ORIGIN (separada por comas).
// No usamos credenciales/cookies; la sesión viaja por Bearer token.
const CORS_ORIGINS = Array.from(new Set([
  'https://campanaproyecto.vercel.app',
  'http://localhost:3000',
  'http://localhost:5500',
  ...String(process.env.CORS_ORIGIN || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
]));

function origenCORSPermitido(origin) {
  if (!origin) return true;
  if (CORS_ORIGINS.includes('*') || CORS_ORIGINS.includes(origin)) return true;
  // Permite previews de Vercel del mismo proyecto sin abrir CORS a cualquier sitio.
  try {
    const u = new URL(origin);
    if (u.protocol === 'https:' && u.hostname.endsWith('.vercel.app')) return true;
  } catch (_) {}
  return false;
}

// Cabeceras explícitas antes de cualquier ruta. Esto hace que el preflight
// OPTIONS siga funcionando incluso si el middleware cors cambia o una ruta
// posterior devuelve un error.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origenCORSPermitido(origin)) {
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cache-Control');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(origenCORSPermitido(origin) ? 204 : 403);
  next();
});

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || origenCORSPermitido(origin)) return callback(null, true);
    return callback(new Error(`Origen CORS no permitido: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control'],
  optionsSuccessStatus: 204
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
// Los usuarios se guardan en users.json (sin base de datos) para autenticación,
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
  'panorama-produccion','panorama-comercial','hoja-asesor','hoja-ruta-cliente','panorama-portafolio','planeacion-nogales','costos-produccion','panorama-margen','surtidos-sedes','cartera','usuarios'
];
const PERMISOS_POR_ROL = {
  admin: PAGINAS_PERMITIDAS,
  gerencia: PAGINAS_PERMITIDAS.filter(p => p !== 'usuarios'),
  comercio: ['panorama-comercial','hoja-asesor','hoja-ruta-cliente','panorama-portafolio','panorama-margen','surtidos-sedes'],
  produccion: ['panorama-produccion','planeacion-nogales','costos-produccion','surtidos-sedes']
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

// ============================================================
// SESIÓN ÚNICA POR USUARIO + AVISO EN TIEMPO REAL (SSE)
// ============================================================
// Cada usuario solo puede tener una sesión activa a la vez. Al iniciar
// sesión se guarda un id de sesión (sid) nuevo; cualquier token viejo
// deja de ser válido. Además, si el dispositivo viejo tiene abierta una
// conexión en tiempo real (SSE), se le avisa DE INMEDIATO (sin esperar
// a que pregunte por polling) para que la alerta "otro dispositivo
// inició sesión" salga al instante, sin necesidad de ninguna acción.
const sesionesActivas = new Map(); // username -> sid
const conexionesSSE = new Map(); // sid -> Set<res>

function registrarConexionSSE(sid, res) {
  if (!conexionesSSE.has(sid)) conexionesSSE.set(sid, new Set());
  conexionesSSE.get(sid).add(res);
}
function quitarConexionSSE(sid, res) {
  const set = conexionesSSE.get(sid);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) conexionesSSE.delete(sid);
}
function avisarOtroDispositivo(sidViejo) {
  const set = conexionesSSE.get(sidViejo);
  if (!set) return;
  const payload = JSON.stringify({ ok: false, message: 'Otro dispositivo inició sesión con este usuario.', sesionExpirada: true, otroDispositivo: true });
  for (const res of set) {
    try { res.write(`event: otroDispositivo\ndata: ${payload}\n\n`); res.end(); } catch (e) {}
  }
  conexionesSSE.delete(sidViejo);
}

function crearTokenAuth(usuario){
  const usernameKey = String(usuario.username).trim().toLowerCase();
  const sidViejo = sesionesActivas.get(usernameKey);
  const sessionId = cryptoAuth.randomUUID();
  sesionesActivas.set(usernameKey, sessionId);
  if (sidViejo && sidViejo !== sessionId) avisarOtroDispositivo(sidViejo);
  const payload = {
    sub: usuario.username,
    sid: sessionId,
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
  const payload=payloadAuth(req);
  if(!payload) return res.status(401).json({ok:false,message:'Sesión no válida o expirada.',sesionExpirada:true});
  const username=String(payload.sub||'').trim().toLowerCase();
  const activa=sesionesActivas.get(username);
  // Solo se expulsa por "otro dispositivo" cuando SÍ hay una sesión distinta
  // registrada como activa (es decir, alguien más inició sesión de verdad).
  // Si simplemente no hay ninguna sesión registrada (por ejemplo, Railway
  // reinició/duerme el servidor por falta de tráfico y el Map en memoria se
  // vació), el token sigue siendo válido y no venció: se re-registra esta
  // sesión como la activa en vez de expulsar al usuario sin motivo real.
  if(activa && activa !== payload.sid){
    return res.status(401).json({ok:false,message:'Otro dispositivo inició sesión con este usuario.',sesionExpirada:true,otroDispositivo:true});
  }
  if(!activa) sesionesActivas.set(username, payload.sid);
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
    let esAdminEnv=false;

    // Compatibilidad con el administrador anterior basado en variables de entorno.
    // Esta ruta SOLO se activa cuando no existe un usuario con ese username en la
    // base de datos; no debe usarse como comodín para cuentas reales sin hash.
    if(!usuario && ADMIN_USERNAME && ADMIN_PASSWORD && username===ADMIN_USERNAME.toLowerCase() && password===ADMIN_PASSWORD){
      usuario={username:ADMIN_USERNAME,nombre:'Administrador',rol:ADMIN_ROLE,permisos:PAGINAS_PERMITIDAS,activo:true};
      esAdminEnv=true;
    }
    if(!usuario || usuario.activo === false || (!esAdminEnv && !passwordCorrecta(password,usuario.password_hash)))
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
    // existe en users.json. Debe poder validar la misma sesión que creó /auth/login.
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

// Cierre de sesión explícito (usado, entre otras cosas, por el cierre
// automático por inactividad en el navegador). Libera el registro de
// sesión activa para que no quede "colgado" y cierra su conexión SSE, si
// la tenía abierta, sin disparar el aviso de "otro dispositivo".
app.post('/auth/logout', requiereAuth, (req, res) => {
  const username = String(req.usuarioAuth.sub || '').trim().toLowerCase();
  const sid = req.usuarioAuth.sid;
  if (sesionesActivas.get(username) === sid) sesionesActivas.delete(username);
  const set = conexionesSSE.get(sid);
  if (set) { for (const conexion of set) { try { conexion.end(); } catch (e) {} } conexionesSSE.delete(sid); }
  res.json({ ok: true });
});

// ============================================================
// AVISO EN TIEMPO REAL (SSE) — "otro dispositivo inició sesión"
// ============================================================
// EventSource del navegador no permite mandar headers personalizados,
// así que aquí el token viaja por query string en vez de por
// Authorization. Mientras la sesión siga siendo la activa, se mantiene
// la conexión abierta esperando el aviso; si al conectar ya no es la
// activa, se avisa de una vez.
app.get('/auth/sesion-stream', (req, res) => {
  const payload = verificarTokenAuth(String(req.query.token || ''));
  if (!payload) { res.status(401).end(); return; }
  const username = String(payload.sub || '').trim().toLowerCase();
  const activa = sesionesActivas.get(username);
  const payloadAviso = JSON.stringify({ ok: false, message: 'Otro dispositivo inició sesión con este usuario.', sesionExpirada: true, otroDispositivo: true });

  // Misma lógica que requiereAuth: solo es "otro dispositivo" si hay una
  // sesión distinta activa de verdad. Si no hay ninguna registrada (Map en
  // memoria vacío tras un reinicio/sleep de Railway), se re-registra esta
  // conexión como la activa en vez de avisar una expulsión falsa.
  if (activa && activa !== payload.sid) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    res.write(`event: otroDispositivo\ndata: ${payloadAviso}\n\n`);
    return res.end();
  }
  if (!activa) sesionesActivas.set(username, payload.sid);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(':ok\n\n');
  registrarConexionSSE(payload.sid, res);

  const latido = setInterval(() => { try { res.write(':latido\n\n'); } catch (e) {} }, 20000);
  req.on('close', () => { clearInterval(latido); quitarConexionSSE(payload.sid, res); });
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
// DATOS SAP EN MEMORIA
// ============================================================
// SAP es la única fuente de datos. El resultado de una consulta puede
// mantenerse temporalmente en memoria del proceso para que varias vistas
// del mismo servidor no repitan inmediatamente la misma consulta.
// No se escribe ningún registro SAP en ninguna base de datos.


// Cache en memoria del dataset ya procesado. Los registros crudos siguen
// vienen directo de SAP; este cache solo evita volver a consultar SAP cuando
// otro usuario abre el mismo rango poco después (SAP_CACHE_MINUTOS).
const datasetCache = new Map();
const DATASET_CACHE_MAX = 1;

// Estado temporal de la construcción del dataset desde SAP. Permite que
// el navegador vea el avance real mientras /dataset sigue procesando los
// registros, sin tener que esperar a que termine la respuesta JSON.
const datasetBuilds = new Map();
const DATASET_BUILD_TTL_MS = 10 * 60 * 1000;

function claveDatasetBuild(inicio, fin) {
  return `${inicio}|${fin}`;
}

function iniciarEstadoDataset(inicio, fin) {
  const key = claveDatasetBuild(inicio, fin);
  const existente = datasetBuilds.get(key);
  if (existente && existente.estado === 'procesando') return existente;

  const ahora = Date.now();
  const estado = {
    estado: 'preparando',
    inicio,
    fin,
    etapa: 'preparando',
    totalRegistros: 0,
    registrosLeidos: 0,
    registrosProcesados: 0,
    iniciadoEn: ahora,
    iniciadoLecturaEn: null,
    ultimaActividad: ahora,
    terminadoEn: null,
    error: null
  };
  datasetBuilds.set(key, estado);
  return estado;
}

function actualizarEstadoDataset(inicio, fin, cambios) {
  const estado = datasetBuilds.get(claveDatasetBuild(inicio, fin));
  if (!estado) return null;
  Object.assign(estado, cambios, { ultimaActividad: Date.now() });
  return estado;
}

function finalizarEstadoDataset(inicio, fin, cambios = {}) {
  const key = claveDatasetBuild(inicio, fin);
  const estado = datasetBuilds.get(key);
  if (!estado) return;
  Object.assign(estado, cambios, {
    estado: cambios.estado || 'completado',
    etapa: cambios.etapa || 'completado',
    terminadoEn: Date.now(),
    ultimaActividad: Date.now()
  });
  setTimeout(() => {
    const actual = datasetBuilds.get(key);
    if (actual === estado && Date.now() - actual.terminadoEn >= DATASET_BUILD_TTL_MS) {
      datasetBuilds.delete(key);
    }
  }, DATASET_BUILD_TTL_MS + 1000);
}

function obtenerDatasetCache(clave) {
  const hit = datasetCache.get(clave);
  if (!hit) return null;
  // Refrescamos la posición para implementar un LRU sencillo.
  datasetCache.delete(clave);
  datasetCache.set(clave, hit);
  return hit;
}

function guardarDatasetCache(clave, valor) {
  datasetCache.delete(clave);
  datasetCache.set(clave, valor);
  while (datasetCache.size > DATASET_CACHE_MAX) {
    datasetCache.delete(datasetCache.keys().next().value);
  }
}

function invalidarDatasetCache() {
  datasetCache.clear();
}

function claveRango(inicio, fin) {
  return `${inicio}|${fin}`;
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
console.log('BACKEND LA CAMPANA (SAP directo, sin base de datos para los datos de SAP)');
console.log('===========================================');
console.log('SAP:', SAP_BASE_URL);
console.log('SAP HOST:', SAP_HOST);
console.log('SAP PAGE SIZE:', SAP_PAGE_SIZE);
console.log('DATOS SAP: consulta directa, procesamiento en memoria');
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

// Igual que en el manejador de errores general: en producción no se
// devuelve error.message (puede incluir detalles internos de SAP,
// rutas de archivos, etc.) directamente al cliente.
function mensajeError(error) {
  return process.env.NODE_ENV === 'production' ? 'Error interno del servidor' : error.message;
}

// ============================================================
// RUTA PRINCIPAL
// ============================================================

app.get('/', (req, res) => {
  res.json({
    ok: true,
    servicio: 'Backend La Campana',
    mensaje: 'Servidor funcionando correctamente (SAP directo, sin base de datos para los datos de SAP)',
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
    fuenteDatos: 'SAP directo (memoria)',
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

async function ejecutarDiagnosticoSAP() {
  const fin = new Date().toISOString().slice(0, 10);
  const inicio = fin.slice(0, 8) + '01';
  try {
    const d = await consultarSAPPagina(inicio, fin, 0, 1);
    const total = d && d.d && d.d.__count !== undefined ? Number(d.d.__count) : null;
    console.log(`✓ DIAGNÓSTICO SAP OK (${inicio} → ${fin}). Registros del rango: ${total === null ? 'n/d' : total}`);
    return { ok: true, inicio, fin, registros: total };
  } catch (error) {
    console.error('✗ DIAGNÓSTICO SAP FALLÓ:', error.message);
    return { ok: false, inicio, fin, error: error.message };
  }
}

app.get('/diagnostico-sap', requiereAuth, requiereAdmin, async (req, res) => {
  const r = await ejecutarDiagnosticoSAP();
  res.status(r.ok ? 200 : 502).json({ ...r, mensaje: r.ok ? 'Diagnóstico SAP correcto.' : 'SAP no respondió. Revisa los Logs de Render.' });
});

// ============================================================
// ESTADO DE SINCRONIZACIÓN
// ============================================================

app.get('/sync-status', requiereAuth, (req, res) => {
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
      resumenMeses: syncState.resumenMeses || null,
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


// ============================================================
// DIAGNOSTICO TEMPORAL DE CONEXION TLS CON SAP
// No imprime usuario, contraseña ni configuración de BD.
// ============================================================
// ============================================================
// LIMITADOR DE CONCURRENCIA + REINTENTOS PARA SAP
// ============================================================
// Problema real observado: si dos usuarios consultan rangos de fechas
// DISTINTOS casi al mismo tiempo (p. ej. uno pide jul-ago y otro pide
// may-sep), iniciarDescarga() solo evita duplicar el MISMO rango, pero
// deja que ambas descargas golpeen el servicio SAP (OData on-prem) al
// mismo tiempo. Ese servicio on-prem no tolera bien demasiadas
// peticiones concurrentes: alguna se queda "cargando" y termina
// fallando con "no se pudo consultar los datos".
//
// En vez de forzar TODO a una sola llamada a la vez (lo que penaliza a
// varios usuarios trabajando juntos), se permite un pequeño número de
// llamadas simultáneas a SAP (SAP_MAX_CONCURRENCIA, por defecto 2) y,
// si una llamada falla, se reintenta automáticamente un par de veces
// antes de devolver el error al usuario. Así varios usuarios pueden
// consultar rangos distintos "al mismo tiempo" sin que una colisión
// puntual con SAP se traduzca en un error visible.
const SAP_MAX_CONCURRENCIA = Math.max(1, parseInt(process.env.SAP_MAX_CONCURRENCIA, 10) || 2);
const SAP_MAX_REINTENTOS = Math.max(0, parseInt(process.env.SAP_MAX_REINTENTOS, 10) || 2);
const SAP_ESPERA_REINTENTO_MS = Math.max(0, parseInt(process.env.SAP_ESPERA_REINTENTO_MS, 10) || 1500);

let sapEnCurso = 0;
const colaEsperaSAP = [];

function liberarTurnoSAP() {
  sapEnCurso--;
  const siguiente = colaEsperaSAP.shift();
  if (siguiente) siguiente();
}

function tomarTurnoSAP() {
  if (sapEnCurso < SAP_MAX_CONCURRENCIA) {
    sapEnCurso++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    colaEsperaSAP.push(() => {
      sapEnCurso++;
      resolve();
    });
  });
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function consultarSAPPagina(inicio, fin, skip, top) {
  await tomarTurnoSAP();
  try {
    let intento = 0;
    while (true) {
      try {
        return await consultarSAPPaginaInterna(inicio, fin, skip, top);
      } catch (error) {
        intento++;
        if (intento > SAP_MAX_REINTENTOS) throw error;
        console.warn(`⚠ Falló consulta SAP (${inicio}→${fin}, skip=${skip}). Reintento ${intento}/${SAP_MAX_REINTENTOS} en ${SAP_ESPERA_REINTENTO_MS}ms. Motivo: ${error.message}`);
        await esperar(SAP_ESPERA_REINTENTO_MS);
      }
    }
  } finally {
    liberarTurnoSAP();
  }
}

const SAP_HTTPS_AGENT = new https.Agent({
  rejectUnauthorized: SAP_TLS_REJECT_UNAUTHORIZED,
  keepAlive: true,
  maxSockets: 8
});


// Agente independiente para el servicio OData de Producción.
const SAP_PRODUCCION_HTTPS_AGENT = new https.Agent({
  rejectUnauthorized: SAP_TLS_REJECT_UNAUTHORIZED,
  keepAlive: true,
  maxSockets: 8
});

// Agente independiente para el servicio OData de Inventario.
const SAP_INVENTARIO_HTTPS_AGENT = new https.Agent({
  rejectUnauthorized: SAP_TLS_REJECT_UNAUTHORIZED,
  keepAlive: true,
  maxSockets: 4
});

// Trae UNA página del servicio Inventario (sin filtro de fecha: es el stock actual).
// Con $skip/$top la paginación solo es confiable si el orden es estable, por eso
// se acepta $orderby. Cada página se reintenta ante fallos transitorios (red, 5xx)
// para no devolver un inventario incompleto.
async function consultarInventarioSAPPagina(skip, top, orderby) {
  const params = {
    $format: 'json',
    $top: top,
    $skip: skip,
    $inlinecount: 'allpages'
  };
  if (orderby) params.$orderby = orderby;
  const MAX_INTENTOS = 3;
  let ultimoError = null;
  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    try {
      const response = await axios.get(SAP_INVENTARIO_URL, {
        params,
        httpsAgent: SAP_INVENTARIO_HTTPS_AGENT,
        timeout: 600000,
        headers: { Accept: 'application/json', Host: SAP_INVENTARIO_HOST },
        auth: SAP_INVENTARIO_USER && SAP_INVENTARIO_PASS
          ? { username: SAP_INVENTARIO_USER, password: SAP_INVENTARIO_PASS }
          : undefined
      });
      return response.data;
    } catch (error) {
      const status = error.response?.status || null;
      let detalle = error.response?.data || error.message;
      if (typeof detalle !== 'string') {
        try { detalle = JSON.stringify(detalle); } catch (_) { detalle = String(detalle); }
      }
      const e = new Error(`SAP Inventario respondió con HTTP ${status || 'desconocido'}: ${String(detalle).slice(0, 500)}`);
      e.status = status;
      e.detalleSAP = String(detalle).slice(0, 800);
      ultimoError = e;
      // Errores 4xx (salvo 408/429) no mejoran reintentando.
      const columnaInvalida = /\[260\]|invalid column/i.test(String(detalle));
      const transitorio = !columnaInvalida && (!status || status >= 500 || status === 408 || status === 429);
      if (!transitorio || intento === MAX_INTENTOS) break;
      await new Promise(r => setTimeout(r, 1000 * intento));
    }
  }
  throw ultimoError;
}

// ---- Normalización de filas de inventario -------------------------------
// No conocemos de antemano los nombres de columna del servicio Inventario,
// así que se buscan por alias (sin tildes, mayúsculas ni separadores). El
// resultado tiene EXACTAMENTE la forma que el tablero ya usa al leer el
// Excel de existencias: {codigo, descripcion, codAlm, almacen, stock, pesoUnit, pesoInv}.
function normClave(k) {
  return String(k == null ? '' : k)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '');
}
const ALIAS_INVENTARIO = {
  codigo:      ['codigodearticulo', 'codigoarticulo', 'itemcode', 'codarticulo', 'codigo', 'articulo_codigo'],
  descripcion: ['descripcion', 'descripcionarticulo', 'nombrearticulo', 'itemname', 'nombredearticulo', 'articulo'],
  codAlm:      ['codigodealmacen', 'codigoalmacen', 'whscode', 'codalmacen', 'codigobodega', 'codbodega'],
  almacen:     ['nombredealmacen', 'nombrealmacen', 'whsname', 'almacen', 'bodega', 'nombrebodega'],
  stock:       ['stockactual', 'stock', 'existencia', 'existencias', 'onhand', 'cantidad', 'enstock'],
  pesoUnit:    ['pesodeventas', 'pesounitario', 'pesodeventa', 'pesoventas', 'salesweight', 'peso'],
  pesoInv:     ['pesototalinventario', 'pesoinventario', 'pesototal', 'kilosinventario', 'kginventario']
};

function detectarColumnasInventario(fila) {
  const claves = Object.keys(fila || {}).filter(k => k !== '__metadata');
  const porNorm = {};
  claves.forEach(k => { if (!(normClave(k) in porNorm)) porNorm[normClave(k)] = k; });
  const mapa = {};
  for (const campo of Object.keys(ALIAS_INVENTARIO)) {
    for (const alias of ALIAS_INVENTARIO[campo]) {
      if (porNorm[normClave(alias)]) { mapa[campo] = porNorm[normClave(alias)]; break; }
    }
  }
  return { mapa, claves };
}

function numeroSAP(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let t = String(v).trim().replace(/\s/g, '');
  if (!t) return 0;
  // Soporta "1234.56", "1234,56", "1,234.56" y "1.234,56" (antes los dos últimos daban 0).
  const c = t.lastIndexOf(','), p = t.lastIndexOf('.');
  if (c > -1 && p > -1) {
    t = c > p ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (c > -1) {
    t = (t.match(/,/g).length > 1) ? t.replace(/,/g, '') : t.replace(',', '.');
  } else if ((t.match(/\./g) || []).length > 1) {
    t = t.replace(/\./g, '');
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

function normalizarFilaInventario(fila, mapa) {
  const t = (campo) => {
    const k = mapa[campo];
    return k ? String(fila[k] == null ? '' : fila[k]).trim() : '';
  };
  const codigo = t('codigo');
  if (!codigo) return null;
  const stock = mapa.stock ? numeroSAP(fila[mapa.stock]) : 0;
  const pesoUnit = mapa.pesoUnit ? numeroSAP(fila[mapa.pesoUnit]) : 0;
  let pesoInv = mapa.pesoInv ? numeroSAP(fila[mapa.pesoInv]) : 0;
  if (!pesoInv) pesoInv = stock * pesoUnit;
  return {
    codigo,
    descripcion: t('descripcion'),
    codAlm: t('codAlm'),
    almacen: t('almacen') || '(sin almacén)',
    stock,
    pesoUnit,
    pesoInv
  };
}

async function consultarProduccionSAPPagina(inicio, fin, skip, top) {
  // Consulta Producción en SAP usando el rango seleccionado.
  // Rango semiabierto [inicio, fin+1 día) para incluir todo el último día.
  const finExclusivo = new Date(`${fin}T00:00:00Z`);
  finExclusivo.setUTCDate(finExclusivo.getUTCDate() + 1);
  const finOData = finExclusivo.toISOString().slice(0, 10);

  const filter =
    `Fecha ge datetime'${inicio}T00:00:00' and ` +
    `Fecha lt datetime'${finOData}T00:00:00'`;

  const params = {
    $format: 'json',
    $filter: filter,
    $top: top,
    $skip: skip,
    $inlinecount: 'allpages'
  };

  const inicioConsulta = Date.now();
  console.log(`[SAP PRODUCCIÓN] → CONSULTA | rango=${inicio}→${fin} | skip=${skip} | top=${top}`);
  console.log(`[SAP PRODUCCIÓN] → Filtro OData: ${filter}`);

  try {
    const response = await axios.get(SAP_PRODUCCION_URL, {
      params,
      httpsAgent: SAP_PRODUCCION_HTTPS_AGENT,
      timeout: 600000,
      headers: {
        Accept: 'application/json',
        Host: SAP_PRODUCCION_HOST
      },
      auth: SAP_PRODUCCION_USER && SAP_PRODUCCION_PASS
        ? { username: SAP_PRODUCCION_USER, password: SAP_PRODUCCION_PASS }
        : undefined
    });

    const resultados = Array.isArray(response.data?.d?.results) ? response.data.d.results.length : 0;
    const totalSAP = Number(response.data?.d?.__count);
    console.log(`[SAP PRODUCCIÓN] ✓ RESPUESTA | HTTP=${response.status} | recibidos=${resultados} | totalSAP=${Number.isFinite(totalSAP) ? totalSAP : 'n/d'} | tiempo=${Date.now() - inicioConsulta}ms`);
    return response.data;
  } catch (error) {
    const status = error.response?.status || null;
    let detalle = error.response?.data || error.message;
    if (typeof detalle !== 'string') {
      try { detalle = JSON.stringify(detalle); } catch (_) { detalle = String(detalle); }
    }
    const e = new Error(`SAP Producción respondió con HTTP ${status || 'desconocido'}: ${detalle}`);
    e.status = status;
    e.detalle = detalle;
    throw e;
  }
}

async function consultarSAPPaginaInterna(inicio, fin, skip, top) {
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
      httpsAgent: SAP_HTTPS_AGENT,
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
// CONSTRUCCIÓN DEL RANGO DIRECTO DESDE SAP (sin base de datos)
// ============================================================
// SAP -> páginas -> acumuladores en memoria -> dataset. Nada se guarda en
// ninguna base de datos: una sola pasada por SAP alimenta a la vez el dataset
// comercial, Margen, Surtidos y las 5 agrupaciones de Hoja de Ruta 6.
// Las páginas de cada mes se piden en paralelo (SAP_PARALELO_PAGINAS) y se
// verifica que lo recibido coincida con el total (__count) que informa SAP.

const SAP_PARALELO_PAGINAS = Math.max(1, parseInt(process.env.SAP_PARALELO_PAGINAS, 10) || 2);
const SAP_MAX_FILAS_CRUDAS = Math.max(0, parseInt(process.env.SAP_MAX_FILAS_CRUDAS, 10) || 2000);
const SAP_CACHE_MINUTOS = Math.max(0, parseInt(process.env.SAP_CACHE_MINUTOS, 10) || 30);

// Mantiene una ventana acotada con las filas crudas MÁS RECIENTES (para
// /facturacion) sin dejar crecer el arreglo sin límite.
function agregarFilaCruda(buffer, r, cap) {
  buffer.push(r);
  if (buffer.length > cap + Math.ceil(cap * 0.2)) {
    buffer.splice(0, buffer.length - cap);
  }
}

function partesMensuales(inicio, fin) {
  const partes = [];
  let cursor = new Date(`${inicio}T00:00:00Z`);
  const ultimo = new Date(`${fin}T00:00:00Z`);
  while (cursor <= ultimo) {
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth();
    const ultimoDia = new Date(Date.UTC(y, m + 1, 0));
    const finParte = ultimoDia < ultimo ? ultimoDia : ultimo;
    partes.push({ inicio: cursor.toISOString().slice(0, 10), fin: finParte.toISOString().slice(0, 10) });
    cursor = new Date(Date.UTC(y, m + 1, 1));
  }
  return partes;
}

async function construirDesdeSAP(inicio, fin, opciones = {}) {
  const actualizarSync = !!opciones.actualizarEstado;
  iniciarEstadoDataset(inicio, fin);
  actualizarEstadoDataset(inicio, fin, {
    estado: 'procesando', etapa: 'consultando_sap', error: null,
    iniciadoLecturaEn: Date.now(), totalRegistros: 0, registrosLeidos: 0,
    registrosProcesados: 0, paginaActual: 0, paginasLeidas: 0
  });

  try {
    const acc = crearAcumulador();
    const margenAcc = crearAcumuladorMargen();
    const surtidosAcc = crearAcumuladorSurtidos();
    const agrupadores = {};
    for (const nombre of Object.keys(DEFINICIONES_AGRUPADORES)) {
      agrupadores[nombre] = crearAgrupador(DEFINICIONES_AGRUPADORES[nombre]);
    }
    const crudas = [];
    const resumenMeses = {};
    const partes = partesMensuales(inicio, fin);

    let totalAcumulado = 0;   // filas útiles acumuladas (con ID)
    let recibidasTotal = 0;   // filas recibidas de SAP
    let sinId = 0;
    let paginaGlobal = 0;
    let totalEsperado = 0;

    // Conteo previo por mes para mostrar un porcentaje real desde el inicio.
    const conteos = await Promise.all(partes.map(async (p) => {
      try {
        const d = await consultarSAPPagina(p.inicio, p.fin, 0, 1);
        const c = Number(d?.d?.__count);
        return Number.isFinite(c) ? c : null;
      } catch (e) { return null; }
    }));
    totalEsperado = conteos.reduce((a, c) => a + (c || 0), 0);
    if (actualizarSync) syncState.registrosTotal = totalEsperado;
    actualizarEstadoDataset(inicio, fin, { totalRegistros: totalEsperado });

    const progreso = () => {
      if (actualizarSync) {
        syncState.paginaActual = paginaGlobal;
        syncState.paginasProcesadas = paginaGlobal;
        syncState.registrosSAP = recibidasTotal;
        syncState.registrosProcesados = recibidasTotal;
        actualizarActividad();
      }
      actualizarEstadoDataset(inicio, fin, {
        registrosLeidos: recibidasTotal, registrosProcesados: totalAcumulado,
        paginaActual: paginaGlobal, paginasLeidas: paginaGlobal
      });
    };

    for (let i = 0; i < partes.length; i++) {
      const parte = partes[i];
      const ym = parte.inicio.slice(0, 7);
      const res = resumenMeses[ym] = { filasSAP: null, filasRecibidas: 0, filasSinID: 0, kilos: 0 };

      const procesar = (results) => {
        for (const raw of results) {
          const r = mapSAPRecord(raw);
          res.filasRecibidas++;
          recibidasTotal++;
          if (!r.sap_id) { res.filasSinID++; sinId++; continue; }
          acumularFila(acc, r);
          acumularFilaMargen(margenAcc, r);
          acumularFilaSurtidos(surtidosAcc, r);
          for (const nombre in agrupadores) agregarFilaAgrupador(agrupadores[nombre], r);
          if (SAP_MAX_FILAS_CRUDAS > 0) agregarFilaCruda(crudas, r, SAP_MAX_FILAS_CRUDAS);
          res.kilos += Number(r.kilos) || 0;
          totalAcumulado++;
        }
      };

      console.log(`Consultando SAP ${parte.inicio} → ${parte.fin}`);
      paginaGlobal++;
      const primera = await consultarSAPPagina(parte.inicio, parte.fin, 0, SAP_PAGE_SIZE);
      const filas1 = primera?.d?.results || [];
      const countSAP = Number(primera?.d?.__count);
      const conocido = Number.isFinite(countSAP);
      res.filasSAP = conocido ? countSAP : null;
      if (conocido && conteos[i] === null) {
        totalEsperado += countSAP;
        if (actualizarSync) syncState.registrosTotal = totalEsperado;
        actualizarEstadoDataset(inicio, fin, { totalRegistros: totalEsperado });
      }
      procesar(filas1);
      progreso();

      if (filas1.length > 0) {
        // SAP puede devolver menos filas que $top (tope propio del servicio):
        // se avanza por lo realmente recibido, no por SAP_PAGE_SIZE.
        const paso = filas1.length;
        if (conocido) {
          const saltos = [];
          for (let sk = paso; sk < countSAP; sk += paso) saltos.push(sk);
          for (let k = 0; k < saltos.length; k += SAP_PARALELO_PAGINAS) {
            const lote = saltos.slice(k, k + SAP_PARALELO_PAGINAS);
            const paginas = await Promise.all(lote.map(sk => consultarSAPPagina(parte.inicio, parte.fin, sk, SAP_PAGE_SIZE)));
            for (const p of paginas) {
              paginaGlobal++;
              procesar(p?.d?.results || []);
            }
            progreso();
          }
        } else {
          let sk = paso;
          while (true) {
            paginaGlobal++;
            const p = await consultarSAPPagina(parte.inicio, parte.fin, sk, SAP_PAGE_SIZE);
            const filas = p?.d?.results || [];
            if (!filas.length) break;
            procesar(filas);
            sk += filas.length;
            progreso();
          }
        }
      }

      if (conocido && res.filasRecibidas < countSAP) {
        throw new Error(`Consulta incompleta ${parte.inicio} → ${parte.fin}: SAP informa ${countSAP} registros y solo se recibieron ${res.filasRecibidas}.`);
      }
      res.kilos = Math.round(res.kilos);
      console.log(`✓ ${ym}: ${res.filasRecibidas} filas${conocido ? ` de ${countSAP}` : ''} · ${res.kilos} kg`);
    }

    const dataset = finalizarDataset(acc);
    const margen = finalizarDatasetMargen(margenAcc);
    const surtidos = finalizarDatasetSurtidos(surtidosAcc);
    const agrupados = {};
    for (const nombre in agrupadores) agrupados[nombre] = finalizarAgrupador(agrupadores[nombre]);

    finalizarEstadoDataset(inicio, fin, {
      estado: 'completado', etapa: 'completado', totalRegistros: totalEsperado || recibidasTotal,
      registrosLeidos: recibidasTotal, registrosProcesados: totalAcumulado
    });

    return {
      dataset, margen, surtidos, agrupados,
      filasCrudas: crudas, totalRegistros: totalAcumulado, filasSinID: sinId,
      resumenMeses, rango: { inicio, fin }, construidoEn: Date.now(), deCache: false
    };
  } catch (error) {
    finalizarEstadoDataset(inicio, fin, { estado: 'error', etapa: 'error', error: error.message });
    throw error;
  }
}

let colaConstruccion = Promise.resolve();
const construccionesEnCurso = new Map();

function cacheVigente(clave) {
  const hit = obtenerDatasetCache(clave);
  if (!hit) return null;
  if (Date.now() - hit.construidoEn > SAP_CACHE_MINUTOS * 60000) {
    datasetCache.delete(clave);
    return null;
  }
  return hit;
}

// Devuelve el resultado construido para el rango: de la caché en memoria si
// es reciente (y no se fuerza), o consultando SAP. Rangos distintos se
// construyen de a uno para no saturar SAP ni la memoria de Render; el mismo
// rango pedido dos veces comparte una sola consulta.
function obtenerConstruccion(inicio, fin, opciones = {}) {
  const clave = claveRango(inicio, fin);
  if (!opciones.forzar) {
    const hit = cacheVigente(clave);
    if (hit) return Promise.resolve({ ...hit, deCache: true });
  }
  if (construccionesEnCurso.has(clave)) return construccionesEnCurso.get(clave);

  const turno = colaConstruccion.catch(() => {}).then(() => {
    // Libera el resultado anterior ANTES de construir el nuevo: tener dos
    // datasets completos en RAM a la vez agotaba el heap en Render.
    datasetCache.clear();
    return construirDesdeSAP(inicio, fin, opciones);
  });
  colaConstruccion = turno;
  const promesa = turno
    .then((resultado) => { guardarDatasetCache(clave, resultado); return resultado; })
    .finally(() => construccionesEnCurso.delete(clave));
  construccionesEnCurso.set(clave, promesa);
  return promesa;
}

async function obtenerAgrupado(inicio, fin, nombre) {
  const r = await obtenerConstruccion(inicio, fin);
  return { grupos: r.agrupados[nombre] || [], deCache: r.deCache, totalRegistros: r.totalRegistros };
}

// ============================================================
// AGREGACIÓN EN MEMORIA (reemplaza los GROUP BY que hacía base de datos)
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
  if (r.numero_factura) {
    const nf = Number(r.numero_factura);
    g._facturas.add(Number.isSafeInteger(nf) ? nf : r.numero_factura);
  }
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
  // Los Set de facturas solo sirven para contar: se reemplazan por su tamaño
  // para liberar la memoria (los endpoints solo leen _facturas.size).
  const out = [];
  for (const g of agrupador.grupos.values()) {
    g._facturas = { size: g._facturas.size };
    out.push(g);
  }
  agrupador.grupos.clear();
  return out;
}

// Compatibilidad: agrupa un arreglo ya completo en memoria (no se usa en
// el camino de descarga de SAP, que ahora agrupa incrementalmente).
function agruparFacturacion(filas, camposClave, filtro) {
  const agrupador = crearAgrupador(camposClave, filtro);
  for (const r of filas) agregarFilaAgrupador(agrupador, r);
  return finalizarAgrupador(agrupador);
}

// ============================================================
// SYNC-SAP: consulta SAP en segundo plano y deja el resultado en la
// caché en memoria. No usa ninguna base de datos. El navegador consulta
// /sync-status para ver el avance y luego pide /dataset (respuesta inmediata).
// ============================================================

app.get('/sync-sap', requiereAuth, async (req, res) => {
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

  if (!forzar) {
    const hit = cacheVigente(claveRango(inicio, fin));
    if (hit) {
      return res.status(200).json({
        ok: true,
        yaSincronizado: true,
        mensaje: `Este rango se consultó a SAP hace menos de ${SAP_CACHE_MINUTOS} min y está en memoria.`,
        fechas: { inicio, fin },
        registros: hit.totalRegistros,
        construidoEn: new Date(hit.construidoEn).toISOString()
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
  syncState.resumenMeses = null;
  syncState.iniciadoEn = new Date().toISOString();
  syncState.terminadoEn = null;
  syncState.error = null;
  actualizarActividad();

  console.log('===========================================');
  console.log(`SYNC SAP INICIADA EN SEGUNDO PLANO: ${inicio} → ${fin}`);
  console.log('===========================================');

  obtenerConstruccion(inicio, fin, { actualizarEstado: true, forzar: true })
    .then(resultado => {
      syncState.ejecutando = false;
      syncState.estado = 'completado';
      syncState.resumenMeses = resultado.resumenMeses;
      syncState.terminadoEn = new Date().toISOString();
      actualizarActividad();
      console.log(`✓ CONSULTA SAP COMPLETADA: ${resultado.totalRegistros} registros`);
    })
    .catch(error => {
      console.error('✗ ERROR CONSULTANDO SAP', error);
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

app.get('/dataset-status', requiereAuth, (req, res) => {
  const fecha_inicio = req.query.fecha_inicio || '';
  const fecha_fin = req.query.fecha_fin || '';

  if (!validarFecha(fecha_inicio) || !validarFecha(fecha_fin) || fecha_inicio > fecha_fin) {
    return res.status(400).json({ ok: false, error: 'Rango de fechas inválido' });
  }

  const estado = datasetBuilds.get(claveDatasetBuild(fecha_inicio, fecha_fin));
  if (!estado) {
    return res.json({
      ok: true,
      encontrado: false,
      estado: { inicio: fecha_inicio, fin: fecha_fin, estado: 'idle', etapa: 'idle' }
    });
  }

  return res.json({
    ok: true,
    encontrado: true,
    estado: { ...estado }
  });
});

// Serializa un valor a JSON escribiendo por partes en un stream (con
// contrapresión) para no armar un string gigante en memoria. Los objetos se
// recorren clave por clave hasta `prof` niveles; el resto se serializa normal.
async function escribirJSONPorPartes(stream, valor, prof) {
  let buffer = '';
  const volcar = async () => {
    if (!buffer) return;
    const trozo = buffer;
    buffer = '';
    if (!stream.write(trozo)) await new Promise((resolve) => stream.once('drain', resolve));
  };
  const escribir = async (texto) => {
    buffer += texto;
    if (buffer.length >= 65536) await volcar();
  };
  const recorrer = async (v, nivel) => {
    const esObjeto = v && typeof v === 'object' && !Array.isArray(v) && typeof v.toJSON !== 'function';
    if (!esObjeto || nivel <= 0) {
      await escribir(JSON.stringify(v) ?? 'null');
      return;
    }
    await escribir('{');
    let primero = true;
    for (const k of Object.keys(v)) {
      const val = v[k];
      if (val === undefined || typeof val === 'function' || typeof val === 'symbol') continue;
      await escribir((primero ? '' : ',') + JSON.stringify(k) + ':');
      primero = false;
      await recorrer(val, nivel - 1);
    }
    await escribir('}');
  };
  await recorrer(valor, prof);
  await volcar();
}

app.get('/dataset', requiereAuth, async (req, res) => {
  const fecha_inicio = req.query.fecha_inicio || '2026-08-01';
  const fecha_fin = req.query.fecha_fin || '2026-08-27';

  if (!validarFecha(fecha_inicio) || !validarFecha(fecha_fin)) {
    return res.status(400).json({ ok: false, error: 'Las fechas deben tener formato YYYY-MM-DD' });
  }

  if (fecha_inicio > fecha_fin) {
    return res.status(400).json({ ok: false, error: 'La fecha inicio no puede ser mayor que la fecha fin' });
  }

  try {
    const r = await obtenerConstruccion(fecha_inicio, fecha_fin);

    // La respuesta puede pesar decenas de MB. Antes se hacía JSON.stringify de
    // TODO el payload y luego gzip del string completo: tres copias en RAM a la
    // vez, que con el heap de 384 MB tumbaba el proceso (Render respondía
    // 502/503 a /dataset y a /dataset-status). Ahora se serializa por partes y
    // se comprime en streaming, así que el pico de memoria es pequeño.
    res.vary('Accept-Encoding');
    res.set({ 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
    const usaGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
    const destino = usaGzip ? zlib.createGzip({ level: 5 }) : res;
    if (usaGzip) {
      res.set('Content-Encoding', 'gzip');
      destino.pipe(res);
    }
    try {
      await escribirJSONPorPartes(destino, {
        ok: true,
        cached: r.deCache,
        data: r.dataset.DATA,
        inv: r.dataset.INV,
        margen: r.margen,
        surtidos: r.surtidos,
        fechas: { inicio: fecha_inicio, fin: fecha_fin },
        filasProcesadas: r.totalRegistros,
        resumenMeses: r.resumenMeses
      }, 3);
      return new Promise((resolve) => { res.once('finish', resolve); destino.end(); });
    } catch (errorStream) {
      console.error('Error enviando /dataset por streaming:', errorStream);
      res.destroy(errorStream);
      return;
    }
  } catch (error) {
    console.error('Error en /dataset:', error);
    return res.status(500).json({ ok: false, error: mensajeError(error) });
  }
});

// ============================================================
// FACTURACIÓN (filas crudas, paginadas)
// ============================================================

// ============================================================
// PRODUCCIÓN — SAP OData EXCLUSIVO
// ============================================================
// Esta ruta NO usa SAP_BASE_URL ni el servicio Facturacion.
// Solo consulta SAP_PRODUCCION_URL (produccion.xsodata/Produccion).
// El frontend de panorama-produccion.html es el único que debe usarla.
app.get('/produccion-sap', requiereAuth, async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 1000, 1), 5000);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const fecha_inicio = req.query.fecha_inicio || '';
  const fecha_fin = req.query.fecha_fin || '';

  if (!validarFecha(fecha_inicio) || !validarFecha(fecha_fin) || fecha_inicio > fecha_fin) {
    return res.status(400).json({ ok: false, error: 'Las fechas deben tener formato YYYY-MM-DD y formar un rango válido.' });
  }

  const idConsulta = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const inicioRuta = Date.now();
  console.log(`[PRODUCCIÓN API] ${idConsulta} INICIO | rango=${fecha_inicio}→${fecha_fin} | offset=${offset} | limit=${limit}`);

  try {
    const body = await consultarProduccionSAPPagina(fecha_inicio, fecha_fin, offset, limit);
    const data = Array.isArray(body?.d?.results) ? body.d.results : [];
    const count = Number(body?.d?.__count);

    console.log(`[PRODUCCIÓN API] ${idConsulta} OK | registros=${data.length} | totalSAP=${Number.isFinite(count) ? count : 'n/d'} | duración=${Date.now() - inicioRuta}ms`);

    res.json({
      ok: true,
      data,
      total: Number.isFinite(count) ? count : null,
      limit,
      offset,
      fechas: { inicio: fecha_inicio, fin: fecha_fin },
      fuente: 'SAP Produccion',
      endpoint: SAP_PRODUCCION_URL
    });
  } catch (error) {
    console.error(`[PRODUCCIÓN API] ${idConsulta} ERROR | HTTP=${error.status || 'n/d'} | duración=${Date.now() - inicioRuta}ms | ${error.message}`);
    console.error('Error en /produccion-sap:', error);
    res.status(error.status && error.status >= 400 ? error.status : 502).json({
      ok: false,
      error: mensajeError(error),
      servicio: 'Produccion',
      endpoint: SAP_PRODUCCION_URL
    });
  }
});


// ============================================================
// CARTERA — SAP OData (botón "Actualizar desde SAP" del Dashboard de Cartera)
// ============================================================
// Servicio: cartera.xsodata/Cartera, filtrado por Fecha_Factura. Variables de entorno opcionales:
// SAP_CARTERA_URL, SAP_CARTERA_HOST, SAP_CARTERA_USER / SAP_CARTERA_PASS (si no existen se usan SAP_USER / SAP_PASS).
const SAP_CARTERA_URL =
  String(process.env.SAP_CARTERA_URL || '').trim() ||
  'https://170.239.154.46:4300/api_campana26/cartera.xsodata/Cartera';
const SAP_CARTERA_HOST = String(process.env.SAP_CARTERA_HOST || '').trim() || 'NDB.n00.CAMPANADB02';
const SAP_CARTERA_USER = process.env.SAP_CARTERA_USER || process.env.SAP_USER || '';
const SAP_CARTERA_PASS = process.env.SAP_CARTERA_PASS || process.env.SAP_PASS || '';
const SAP_CARTERA_HTTPS_AGENT = new https.Agent({
  rejectUnauthorized: SAP_TLS_REJECT_UNAUTHORIZED,
  keepAlive: true,
  maxSockets: 4
});

async function consultarCarteraSAPPagina(inicio, fin, skip, top) {
  // Mismo formato exacto de la URL que funciona en SAP:
  //   Fecha_Factura ge datetime'2026-10-01' and Fecha_Factura le datetime'2026-10-31'
  // (sin hora; con hora SAP respondía "Expected the expression of query option '$filter' to evaluate to the type 'Edm.Boolean'").
  const filter = `Fecha_Factura ge datetime'${inicio}' and Fecha_Factura le datetime'${fin}'`;

  // La query se arma a mano con %20 (axios codifica los espacios como '+', que SAP no interpreta como espacio).
  const query =
    `$filter=${encodeURIComponent(filter)}` +
    `&$format=json&$top=${top}&$skip=${skip}&$inlinecount=allpages`;
  const url = `${SAP_CARTERA_URL}?${query}`;

  try {
    const response = await axios.get(url, {
      httpsAgent: SAP_CARTERA_HTTPS_AGENT,
      timeout: 600000,
      headers: { Accept: 'application/json', Host: SAP_CARTERA_HOST },
      auth: SAP_CARTERA_USER && SAP_CARTERA_PASS
        ? { username: SAP_CARTERA_USER, password: SAP_CARTERA_PASS }
        : undefined
    });
    return response.data;
  } catch (error) {
    const status = error.response?.status || null;
    let detalle = error.response?.data || error.message;
    if (typeof detalle !== 'string') {
      try { detalle = JSON.stringify(detalle); } catch (_) { detalle = String(detalle); }
    }
    const e = new Error(`SAP Cartera respondió con HTTP ${status || 'desconocido'}: ${detalle}`);
    e.status = status;
    throw e;
  }
}

app.get('/cartera-sap', requiereAuth, async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 1000, 1), 5000);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const fecha_inicio = req.query.fecha_inicio || '';
  const fecha_fin = req.query.fecha_fin || '';

  if (!validarFecha(fecha_inicio) || !validarFecha(fecha_fin) || fecha_inicio > fecha_fin) {
    return res.status(400).json({ ok: false, error: 'Las fechas deben tener formato YYYY-MM-DD y formar un rango válido.' });
  }

  try {
    const body = await consultarCarteraSAPPagina(fecha_inicio, fecha_fin, offset, limit);
    const data = Array.isArray(body?.d?.results) ? body.d.results : [];
    const count = Number(body?.d?.__count);
    res.json({
      ok: true,
      data,
      total: Number.isFinite(count) ? count : null,
      limit,
      offset,
      fechas: { inicio: fecha_inicio, fin: fecha_fin },
      fuente: 'SAP Cartera'
    });
  } catch (error) {
    console.error('Error en /cartera-sap:', error.message);
    res.status(error.status && error.status >= 400 ? error.status : 502).json({
      ok: false,
      error: mensajeError(error),
      servicio: 'Cartera'
    });
  }
});

// ============================================================
// INVENTARIO — SAP OData (botón "Cargar inventario" de Surtidos Sedes)
// ============================================================
// Solo consulta SAP_INVENTARIO_URL (inventario.xsodata/Inventario).
// ?debug=1 devuelve las primeras filas crudas y las columnas detectadas,
// útil para confirmar los nombres de columna del servicio.
app.get('/inventario', requiereAuth, async (req, res) => {
  const idConsulta = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const inicioRuta = Date.now();
  const PAGINA = 5000;
  const MAX_PAGINAS = 400;
  const debug = String(req.query.debug || '') === '1';
  console.log(`[INVENTARIO API] ${idConsulta} INICIO | debug=${debug} | url=${SAP_INVENTARIO_URL}`);

  try {
    // 1) Sondeo de 1 fila: detecta columnas y el total real que SAP declara.
    const sondeo = await consultarInventarioSAPPagina(0, debug ? 5 : 1);
    const primeras = Array.isArray(sondeo?.d?.results) ? sondeo.d.results : [];
    let total = Number(sondeo?.d?.__count);
    total = Number.isFinite(total) ? total : null;

    if (!primeras.length) {
      if (debug) return res.json({ ok: true, debug: true, columnas: [], detectado: {}, muestra: [], total, endpoint: SAP_INVENTARIO_URL });
      return res.json({ ok: true, rows: [], total: 0, descartadas: 0, totalSAP: total, columnas: [], detectado: {}, sinAlmacen: true, fuente: 'SAP Inventario', ts: Date.now() });
    }

    const { mapa, claves } = detectarColumnasInventario(primeras[0]);
    const muestra = primeras.slice(0, 3).map(r => { const c = { ...r }; delete c.__metadata; return c; });
    if (debug) {
      return res.json({ ok: true, debug: true, columnas: claves, detectado: mapa, muestra, total, endpoint: SAP_INVENTARIO_URL });
    }
    if (!mapa.codigo) {
      const e = new Error('No encontré la columna del código de artículo en el servicio Inventario. Columnas recibidas: ' + claves.join(', '));
      e.status = 422;
      throw e;
    }

    // 2) Orden estable: sin $orderby, $skip/$top puede repetir u omitir filas entre páginas.
    //    Se intenta ordenar por TODAS las columnas (claves primero, valores que cambian
    //    como el stock al final, solo para desempatar). Si SAP lo rechaza (p. ej. "[260]
    //    invalid column name" en una columna calculada) se usa solo código + almacén.
    const claveSet = [mapa.codigo, mapa.codAlm, mapa.almacen].filter((k, i, arr) => k && arr.indexOf(k) === i);
    const mutables = [mapa.stock, mapa.pesoInv].filter(Boolean);
    const resto = claves.filter(k => !claveSet.includes(k) && !mutables.includes(k));
    const completo = [...claveSet, ...resto, ...mutables].filter((k, i, arr) => arr.indexOf(k) === i);
    // Clave única de fila (columna "ID"): ordenar solo por ella da un orden total, sin empates,
    // y además permite comprobar que no haya filas repetidas ni perdidas entre páginas.
    const idKey = claves.find(k => normClave(k) === 'id') || null;
    const candidatos = [];
    if (idKey) candidatos.push([idKey]);
    if (completo.length > claveSet.length) candidatos.push(completo);
    candidatos.push(claveSet);

    let orderby = null;
    let ordenado = false;
    for (const cand of candidatos) {
      const ob = cand.map(k => `${k} asc`).join(',');
      try {
        await consultarInventarioSAPPagina(0, 1, ob);
        orderby = ob; ordenado = true;
        break;
      } catch (err) {
        // SAP responde HTTP 500 con "[260] invalid column name" cuando una columna no se puede ordenar.
        const columnaInvalida = /\[260\]|invalid column/i.test(`${err.detalleSAP || ''} ${err.message || ''}`);
        if (columnaInvalida || (err.status && err.status >= 400 && err.status < 500)) {
          console.warn(`[INVENTARIO API] ${idConsulta} SAP rechazó $orderby='${ob}': ${err.message}`);
          continue;
        }
        throw err;
      }
    }
    if (!ordenado) console.warn(`[INVENTARIO API] ${idConsulta} ⚠ se pagina SIN orden estable: pueden repetirse u omitirse filas.`);

    // Lee todas las páginas y verifica que lo recibido coincida con el total de SAP.
    const leerTodo = async () => {
      const filas = [];
      const idsVistos = idKey ? new Set() : null;
      let descartadas = 0, stockDescartado = 0, recibidas = 0, skip = 0;
      for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
        const body = await consultarInventarioSAPPagina(skip, PAGINA, orderby);
        const resultados = Array.isArray(body?.d?.results) ? body.d.results : [];
        const count = Number(body?.d?.__count);
        if (Number.isFinite(count)) total = count;

        for (const r of resultados) {
          if (idsVistos) idsVistos.add(String(r[idKey]));
          const f = normalizarFilaInventario(r, mapa);
          if (f) filas.push(f);
          else { descartadas++; stockDescartado += mapa.stock ? numeroSAP(r[mapa.stock]) : 0; }
        }
        recibidas += resultados.length;
        skip += resultados.length; // avanza por lo REALMENTE recibido (SAP puede limitar el tamaño de página)
        console.log(`[INVENTARIO API] ${idConsulta} pág ${pagina + 1} | recibidos=${resultados.length} | acumulado=${recibidas} | totalSAP=${total ?? 'n/d'}`);

        if (resultados.length === 0) break;                 // página vacía: no hay más
        if (total != null && recibidas >= total) break;     // ya llegó al total declarado
        if (pagina === MAX_PAGINAS - 1) {
          const e = new Error(`Se alcanzó el máximo de ${MAX_PAGINAS} páginas sin completar el inventario (recibidas ${recibidas}).`);
          e.status = 502;
          throw e;
        }
      }
      // Verificación: no se entrega un inventario incompleto como si estuviera completo.
      if (total != null && recibidas !== total) {
        const e = new Error(`Inventario incompleto: SAP declara ${total} filas y se recibieron ${recibidas}.`);
        e.status = 502;
        throw e;
      }
      // Si hay columna ID, todas las filas deben ser distintas: si hay repetidas, la paginación
      // se desplazó y alguna fila se leyó dos veces (y otra quedó sin leer aunque el conteo cuadre).
      if (idsVistos && idsVistos.size !== recibidas) {
        const e = new Error(`Lectura inconsistente: ${recibidas} filas recibidas pero solo ${idsVistos.size} con ID distinto.`);
        e.status = 502;
        e.inestable = true;
        throw e;
      }
      return { filas, descartadas, stockDescartado: Math.round(stockDescartado * 100) / 100, recibidas };
    };

    // El inventario es "en vivo": si el total cambió mientras se leía, las páginas pudieron
    // desplazarse. Se vuelve a consultar el total al final y, si cambió, se relee (máx. 3 intentos).
    let lectura = null;
    let errorInestable = null;
    for (let intento = 1; intento <= 3 && !lectura; intento++) {
      let intentoLectura;
      try {
        intentoLectura = await leerTodo();
      } catch (errLectura) {
        if (errLectura && errLectura.inestable) {
          errorInestable = errLectura;
          console.warn(`[INVENTARIO API] ${idConsulta} ${errLectura.message} Reintento ${intento}/3.`);
          continue;
        }
        throw errLectura;
      }
      const cierre = await consultarInventarioSAPPagina(0, 1, orderby);
      const totalFinal = Number(cierre?.d?.__count);
      if (!Number.isFinite(totalFinal) || totalFinal === intentoLectura.recibidas) {
        lectura = intentoLectura;
      } else {
        console.warn(`[INVENTARIO API] ${idConsulta} el inventario cambió durante la lectura (leídas=${intentoLectura.recibidas}, total ahora=${totalFinal}). Reintento ${intento}/3.`);
        total = totalFinal;
      }
    }
    if (!lectura) {
      if (errorInestable) throw errorInestable;
      const e = new Error('Inventario incompleto: cambió en SAP durante la lectura y no se logró una lectura consistente. Intenta de nuevo.');
      e.status = 502;
      throw e;
    }
    const { filas, descartadas, stockDescartado, recibidas } = lectura;

    console.log(`[INVENTARIO API] ${idConsulta} OK | filasSAP=${recibidas} | utiles=${filas.length} | sinCodigo=${descartadas} | ordenado=${ordenado} | duración=${Date.now() - inicioRuta}ms`);
    res.json({
      ok: true,
      rows: filas,
      total: filas.length,
      totalSAP: total,
      recibidas,
      descartadas,
      stockDescartado,
      ordenado,
      columnas: claves,
      detectado: mapa || {},
      sinAlmacen: !(mapa && (mapa.almacen || mapa.codAlm)),
      fuente: 'SAP Inventario',
      ts: Date.now()
    });
  } catch (error) {
    console.error(`[INVENTARIO API] ${idConsulta} ERROR | HTTP=${error.status || 'n/d'} | duración=${Date.now() - inicioRuta}ms | ${error.message}`);
    res.status(error.status && error.status >= 400 ? error.status : 502).json({
      ok: false,
      error: error.status === 422 || /incompleto|máximo de/.test(error.message)
        ? error.message
        : `No se pudo consultar SAP Inventario (HTTP ${error.status || 'sin respuesta'}). Revisa SAP_INVENTARIO_URL / SAP_INVENTARIO_HOST en Render y los logs del servicio.`,
      servicio: 'Inventario',
      detalle: error.detalleSAP || error.message
    });
  }
});

app.get('/facturacion', requiereAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 1000);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const fecha_inicio = req.query.fecha_inicio || '2026-08-01';
  const fecha_fin = req.query.fecha_fin || '2026-08-27';

  if (!validarFecha(fecha_inicio) || !validarFecha(fecha_fin)) {
    return res.status(400).json({ ok: false, error: 'Las fechas deben tener formato YYYY-MM-DD' });
  }

  try {
    const r = await obtenerConstruccion(fecha_inicio, fecha_fin);
    // Filas crudas más recientes primero, acotadas a SAP_MAX_FILAS_CRUDAS.
    const n = r.filasCrudas.length;
    const fin = n - offset;
    const ini = Math.max(0, fin - limit);
    const pagina = fin > 0 ? r.filasCrudas.slice(ini, fin).reverse() : [];

    res.json({
      ok: true,
      data: pagina,
      total: n,
      totalRegistrosRango: r.totalRegistros,
      detalleTruncado: r.totalRegistros > n,
      detalleDisponible: n,
      limit,
      offset,
      fechas: { inicio: fecha_inicio, fin: fecha_fin }
    });
  } catch (error) {
    console.error('Error en /facturacion:', error);
    res.status(500).json({ ok: false, error: mensajeError(error) });
  }
});

// ============================================================
// HOJA DE ASESOR
// ============================================================

app.get('/dashboards/hoja-asesor', requiereAuth, async (req, res) => {
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
    res.status(500).json({ ok: false, error: mensajeError(error) });
  }
});

// ============================================================
// HOJA DE CLIENTE
// ============================================================

app.get('/dashboards/hoja-cliente', requiereAuth, async (req, res) => {
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
    res.status(500).json({ ok: false, error: mensajeError(error) });
  }
});

// ============================================================
// LABOR COMERCIAL
// ============================================================

app.get('/dashboards/labor-comercial', requiereAuth, async (req, res) => {
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
    res.status(500).json({ ok: false, error: mensajeError(error) });
  }
});

// ============================================================
// PORTAFOLIO Y CARTERA
// ============================================================

app.get('/dashboards/portafolio-cartera', requiereAuth, async (req, res) => {
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
    res.status(500).json({ ok: false, error: mensajeError(error) });
  }
});

// ============================================================
// PLANEACIÓN NOGALES
// ============================================================

app.get('/dashboards/planeacion-nogales', requiereAuth, async (req, res) => {
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
    res.status(500).json({ ok: false, error: mensajeError(error) });
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
  // El detalle completo del error (rutas internas, mensajes de SAP/base de datos,
  // etc.) solo se expone al cliente en desarrollo, para no filtrar
  // información interna a quien esté sondeando la API en producción.
  const detalle = process.env.NODE_ENV === 'production' ? undefined : error.message;
  res.status(500).json({ ok: false, error: 'Error interno del servidor', detalle });
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================
// Los datos SAP no se guardan en ninguna base de datos. Los usuarios/permisos se leen desde users.json.

async function iniciarServidor(){
  try {
    await initUserDB({
      seedFile: require('path').join(__dirname, 'users.json')
    });
  } catch (error) {
    console.error('✗ No se pudo inicializar users.json:', error.message);
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
  console.log('✓ GET /cartera-sap');
  console.log('✓ GET /dashboards/hoja-asesor');
  console.log('✓ GET /dashboards/hoja-cliente');
  console.log('✓ GET /dashboards/labor-comercial');
  console.log('✓ GET /dashboards/portafolio-cartera');
    console.log('✓ GET /dashboards/planeacion-nogales');
  });
}

iniciarServidor();

module.exports = app;


