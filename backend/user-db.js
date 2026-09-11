const { Pool } = require('pg');
const fs = require('fs');

let pool = null;
let usarPostgres = false;

function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    const sslEnabled = String(process.env.DATABASE_SSL || 'false').toLowerCase() === 'true' || /sslmode=require/i.test(process.env.DATABASE_URL || '');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslEnabled ? { rejectUnauthorized: false } : false,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });
  }
  return pool;
}

async function initUserDB({ seedFile, hashPassword }) {
  const p = getPool();
  if (!p) {
    console.warn('⚠ DATABASE_URL no está configurada. Se usará users.json como respaldo local.');
    usarPostgres = false;
    return;
  }

  await p.query(`
    CREATE TABLE IF NOT EXISTS usuarios_dashboard (
      id VARCHAR(32) PRIMARY KEY,
      username VARCHAR(40) NOT NULL UNIQUE,
      nombre VARCHAR(150) NOT NULL,
      password_hash TEXT NOT NULL,
      rol VARCHAR(30) NOT NULL,
      permisos JSONB NOT NULL DEFAULT '[]'::jsonb,
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const count = await p.query('SELECT COUNT(*)::int AS total FROM usuarios_dashboard');
  if (count.rows[0].total === 0 && seedFile && fs.existsSync(seedFile)) {
    let seed = [];
    try { seed = JSON.parse(fs.readFileSync(seedFile, 'utf8')); } catch (_) { seed = []; }
    for (const u of seed) {
      if (!u.username || !u.password_hash) continue;
      await p.query(
        `INSERT INTO usuarios_dashboard (id, username, nombre, password_hash, rol, permisos, activo)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
         ON CONFLICT (username) DO NOTHING`,
        [u.id || require('crypto').randomBytes(8).toString('hex'), String(u.username).toLowerCase(), u.nombre || u.username, u.password_hash, u.rol || 'gerencia', JSON.stringify(Array.isArray(u.permisos) ? u.permisos : []), u.activo !== false]
      );
    }
    // Si el seed fue cargado, users.json no vuelve a ser necesario para producción.
    console.log(`✓ Usuarios iniciales migrados: ${seed.length}`);
  }

  usarPostgres = true;
}

function rowToUser(r) {
  if (!r) return null;
  return {
    id: r.id,
    username: r.username,
    nombre: r.nombre,
    password_hash: r.password_hash,
    rol: r.rol,
    permisos: Array.isArray(r.permisos) ? r.permisos : [],
    activo: r.activo
  };
}

function readJsonUsers() {
  const file = require('path').join(__dirname, 'users.json');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return []; }
}
function writeJsonUsers(users) {
  const file = require('path').join(__dirname, 'users.json');
  fs.writeFileSync(file, JSON.stringify(users, null, 2), 'utf8');
}

async function getUserByUsername(username) {
  const un = String(username || '').trim().toLowerCase();
  if (usarPostgres) {
    const r = await getPool().query('SELECT * FROM usuarios_dashboard WHERE username = $1 LIMIT 1', [un]);
    return rowToUser(r.rows[0]);
  }
  return readJsonUsers().find(u => String(u.username || '').toLowerCase() === un && u.activo !== false) || null;
}

async function getUsers() {
  if (usarPostgres) {
    const r = await getPool().query('SELECT * FROM usuarios_dashboard ORDER BY creado_en ASC, username ASC');
    return r.rows.map(rowToUser);
  }
  return readJsonUsers();
}

async function createUser(u) {
  if (usarPostgres) {
    const id = u.id || require('crypto').randomBytes(8).toString('hex');
    const r = await getPool().query(
      `INSERT INTO usuarios_dashboard (id, username, nombre, password_hash, rol, permisos, activo)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *`,
      [id, u.username, u.nombre, u.password_hash, u.rol, JSON.stringify(u.permisos || []), u.activo !== false]
    );
    return rowToUser(r.rows[0]);
  }
  const users = readJsonUsers();
  const nuevo = { id: u.id || require('crypto').randomBytes(8).toString('hex'), ...u };
  users.push(nuevo); writeJsonUsers(users); return nuevo;
}

async function updateUser(id, changes) {
  if (usarPostgres) {
    const allowed = ['nombre','username','password_hash','rol','permisos','activo'];
    const sets = [];
    const values = [];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(changes, key)) {
        values.push(key === 'permisos' ? JSON.stringify(changes[key]) : changes[key]);
        sets.push(`${key} = $${values.length}${key === 'permisos' ? '::jsonb' : ''}`);
      }
    }
    if (!sets.length) return (await getPool().query('SELECT * FROM usuarios_dashboard WHERE id=$1', [id])).rows.map(rowToUser)[0] || null;
    values.push(id);
    const r = await getPool().query(`UPDATE usuarios_dashboard SET ${sets.join(', ')}, actualizado_en=NOW() WHERE id=$${values.length} RETURNING *`, values);
    return rowToUser(r.rows[0]);
  }
  const users = readJsonUsers();
  const i = users.findIndex(u => String(u.id) === String(id));
  if (i < 0) return null;
  users[i] = { ...users[i], ...changes };
  writeJsonUsers(users); return users[i];
}

async function deleteUser(id) {
  if (usarPostgres) {
    await getPool().query('DELETE FROM usuarios_dashboard WHERE id=$1', [id]);
    return;
  }
  const users = readJsonUsers().filter(u => String(u.id) !== String(id));
  writeJsonUsers(users);
}

module.exports = { initUserDB, getUserByUsername, getUsers, createUser, updateUser, deleteUser };
