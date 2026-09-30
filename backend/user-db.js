// Capa de usuarios del dashboard.
//
// - Si existe DATABASE_URL (Supabase/PostgreSQL): los usuarios viven en la tabla
//   `dashboard_usuarios`. Se crea sola si no existe y, si está vacía, se llena
//   con los usuarios de users.json (mismos ids y mismos hashes de contraseña).
// - Si NO existe DATABASE_URL: se usa users.json (modo local/pruebas).
// - Si DATABASE_URL existe pero la base no responde: los usuarios se leen de
//   users.json en SOLO LECTURA (para poder iniciar sesión) y NO se permite
//   crear/editar/borrar, para no perder cambios en un archivo que Render
//   reinicia en cada deploy. Se reintenta la conexión cada 30 segundos.
//
// Esta capa solo maneja usuarios. No toca nada de SAP.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TABLA = 'dashboard_usuarios';
let USERS_FILE = null;
let pool = null;            // null => sin conexión a la base
let dbConfigurada = false;  // true si existe DATABASE_URL
let ultimoIntento = 0;

function errorSoloLectura() {
  const err = new Error('La base de datos de usuarios no está disponible. Cambios bloqueados para no perder datos.');
  err.code = 'DB_NO_DISPONIBLE';
  return err;
}

// ---------- Utilidades ----------
function normalizarUsuario(username) {
  return String(username || '').trim().toLowerCase();
}

function errorUsuarioExiste() {
  const err = new Error('El usuario ya existe.');
  err.code = 'USER_EXISTS';
  return err;
}

// ---------- Modo JSON (respaldo) ----------
function readJsonUsers() {
  try {
    const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}

function writeJsonUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

// ---------- Modo base de datos ----------
function filaAUsuario(r) {
  return {
    id: r.id,
    username: r.username,
    nombre: r.nombre,
    rol: r.rol,
    password_hash: r.password_hash,
    permisos: Array.isArray(r.permisos) ? r.permisos : [],
    activo: r.activo !== false
  };
}

const COLUMNAS = 'id, username, nombre, rol, password_hash, permisos, activo';

async function crearTablaYSembrar() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLA} (
      id            text PRIMARY KEY,
      username      text NOT NULL UNIQUE CHECK (username = lower(username)),
      nombre        text NOT NULL,
      rol           text NOT NULL,
      password_hash text NOT NULL,
      permisos      jsonb NOT NULL DEFAULT '[]'::jsonb,
      activo        boolean NOT NULL DEFAULT true,
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now()
    )`);
  // Los hashes no deben ser legibles desde la API pública de Supabase.
  await pool.query(`ALTER TABLE ${TABLA} ENABLE ROW LEVEL SECURITY`);

  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${TABLA}`);
  if (rows[0].n > 0) return rows[0].n;

  const semilla = readJsonUsers();
  for (const u of semilla) {
    await pool.query(
      `INSERT INTO ${TABLA} (${COLUMNAS}) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
       ON CONFLICT (username) DO NOTHING`,
      [
        u.id || crypto.randomBytes(8).toString('hex'),
        normalizarUsuario(u.username),
        u.nombre || u.username,
        u.rol,
        u.password_hash,
        JSON.stringify(Array.isArray(u.permisos) ? u.permisos : []),
        u.activo !== false
      ]
    );
  }
  return semilla.length;
}

// ---------- Inicio / conexión ----------
async function conectarDB() {
  ultimoIntento = Date.now();
  const { Pool } = require('pg');
  const nuevoPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });
  nuevoPool.on('error', e => console.error('pg pool error:', e.message));
  pool = nuevoPool;
  try {
    const n = await crearTablaYSembrar();
    console.log(`✓ Usuarios: Supabase/PostgreSQL (${TABLA}, ${n} usuarios)`);
  } catch (error) {
    pool = null;
    try { await nuevoPool.end(); } catch (_) {}
    throw error;
  }
}

async function initUserDB({ seedFile } = {}) {
  USERS_FILE = seedFile || path.join(__dirname, 'users.json');
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]', 'utf8');

  if (!process.env.DATABASE_URL) {
    console.log('✓ Usuarios: users.json (DATABASE_URL no configurada)');
    return;
  }

  dbConfigurada = true;
  try {
    await conectarDB();
  } catch (error) {
    console.error('⚠ No se pudo conectar a la base de usuarios:', error.message);
    console.error('⚠ Usuarios en SOLO LECTURA (desde users.json). No se permiten cambios hasta que la base responda.');
  }
}

// Devuelve 'db' | 'json' | 'solo-lectura'. Reintenta la conexión si se cayó.
async function modo() {
  if (!dbConfigurada) return 'json';
  if (!pool && Date.now() - ultimoIntento > 30000) {
    try { await conectarDB(); } catch (e) { console.error('⚠ Reintento de conexión a usuarios falló:', e.message); }
  }
  return pool ? 'db' : 'solo-lectura';
}

// ---------- API pública (misma firma que antes) ----------
async function getUserByUsername(username) {
  const un = normalizarUsuario(username);
  if ((await modo()) !== 'db') {
    return readJsonUsers().find(
      u => normalizarUsuario(u.username) === un && u.activo !== false
    ) || null;
  }
  const { rows } = await pool.query(
    `SELECT ${COLUMNAS} FROM ${TABLA} WHERE username = $1 AND activo IS NOT FALSE`,
    [un]
  );
  return rows[0] ? filaAUsuario(rows[0]) : null;
}

async function getUsers() {
  if ((await modo()) !== 'db') return readJsonUsers();
  const { rows } = await pool.query(
    `SELECT ${COLUMNAS} FROM ${TABLA} ORDER BY created_at, username`
  );
  return rows.map(filaAUsuario);
}

async function createUser(u) {
  const username = normalizarUsuario(u.username);
  const m = await modo();
  if (m === 'solo-lectura') throw errorSoloLectura();

  if (m === 'json') {
    const users = readJsonUsers();
    if (users.some(x => normalizarUsuario(x.username) === username)) throw errorUsuarioExiste();
    const nuevo = {
      id: u.id || crypto.randomBytes(8).toString('hex'),
      ...u,
      username,
      activo: u.activo !== false
    };
    users.push(nuevo);
    writeJsonUsers(users);
    return nuevo;
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO ${TABLA} (${COLUMNAS}) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
       RETURNING ${COLUMNAS}`,
      [
        u.id || crypto.randomBytes(8).toString('hex'),
        username,
        u.nombre,
        u.rol,
        u.password_hash,
        JSON.stringify(Array.isArray(u.permisos) ? u.permisos : []),
        u.activo !== false
      ]
    );
    return filaAUsuario(rows[0]);
  } catch (e) {
    if (e.code === '23505') throw errorUsuarioExiste();
    throw e;
  }
}

async function updateUser(id, changes) {
  const m = await modo();
  if (m === 'solo-lectura') throw errorSoloLectura();
  if (m === 'json') {
    const users = readJsonUsers();
    const i = users.findIndex(u => String(u.id) === String(id));
    if (i < 0) return null;
    const actualizado = { ...users[i], ...changes };
    if (Object.prototype.hasOwnProperty.call(changes, 'username')) {
      actualizado.username = normalizarUsuario(changes.username);
    }
    const duplicado = users.some(
      (u, idx) => idx !== i && normalizarUsuario(u.username) === normalizarUsuario(actualizado.username)
    );
    if (duplicado) throw errorUsuarioExiste();
    users[i] = actualizado;
    writeJsonUsers(users);
    return actualizado;
  }

  const sets = [];
  const vals = [];
  const add = (col, val, cast = '') => { vals.push(val); sets.push(`${col} = $${vals.length}${cast}`); };
  if (changes.nombre !== undefined) add('nombre', changes.nombre);
  if (changes.username !== undefined) add('username', normalizarUsuario(changes.username));
  if (changes.rol !== undefined) add('rol', changes.rol);
  if (changes.password_hash !== undefined) add('password_hash', changes.password_hash);
  if (changes.permisos !== undefined) add('permisos', JSON.stringify(changes.permisos || []), '::jsonb');
  if (changes.activo !== undefined) add('activo', Boolean(changes.activo));

  try {
    if (!sets.length) {
      const { rows } = await pool.query(`SELECT ${COLUMNAS} FROM ${TABLA} WHERE id = $1`, [String(id)]);
      return rows[0] ? filaAUsuario(rows[0]) : null;
    }
    sets.push('updated_at = now()');
    vals.push(String(id));
    const { rows } = await pool.query(
      `UPDATE ${TABLA} SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING ${COLUMNAS}`,
      vals
    );
    return rows[0] ? filaAUsuario(rows[0]) : null;
  } catch (e) {
    if (e.code === '23505') throw errorUsuarioExiste();
    throw e;
  }
}

async function deleteUser(id) {
  const m = await modo();
  if (m === 'solo-lectura') throw errorSoloLectura();
  if (m === 'json') {
    writeJsonUsers(readJsonUsers().filter(u => String(u.id) !== String(id)));
    return;
  }
  await pool.query(`DELETE FROM ${TABLA} WHERE id = $1`, [String(id)]);
}

module.exports = {
  initUserDB,
  getUserByUsername,
  getUsers,
  createUser,
  updateUser,
  deleteUser
};
