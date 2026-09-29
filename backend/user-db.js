const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let USERS_FILE = null;

function initUserDB({ seedFile }) {
  USERS_FILE = seedFile || path.join(__dirname, 'users.json');

  // El archivo JSON es la única fuente para usuarios. No se abre ninguna
  // conexión a almacenamiento persistente/almacenamiento persistente ni se crea ninguna tabla.
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, '[]', 'utf8');
  }
  console.log('✓ Usuarios: users.json (sin base de datos)');
}

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

function normalizarUsuario(username) {
  return String(username || '').trim().toLowerCase();
}

async function getUserByUsername(username) {
  const un = normalizarUsuario(username);
  return readJsonUsers().find(
    u => normalizarUsuario(u.username) === un && u.activo !== false
  ) || null;
}

async function getUsers() {
  return readJsonUsers();
}

async function createUser(u) {
  const users = readJsonUsers();
  const username = normalizarUsuario(u.username);
  if (users.some(x => normalizarUsuario(x.username) === username)) {
    const err = new Error('El usuario ya existe.');
    err.code = 'USER_EXISTS';
    throw err;
  }

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

async function updateUser(id, changes) {
  const users = readJsonUsers();
  const i = users.findIndex(u => String(u.id) === String(id));
  if (i < 0) return null;

  const actualizado = {
    ...users[i],
    ...changes
  };
  if (Object.prototype.hasOwnProperty.call(changes, 'username')) {
    actualizado.username = normalizarUsuario(changes.username);
  }

  const duplicado = users.some(
    (u, idx) => idx !== i && normalizarUsuario(u.username) === normalizarUsuario(actualizado.username)
  );
  if (duplicado) {
    const err = new Error('El usuario ya existe.');
    err.code = 'USER_EXISTS';
    throw err;
  }

  users[i] = actualizado;
  writeJsonUsers(users);
  return actualizado;
}

async function deleteUser(id) {
  const users = readJsonUsers().filter(u => String(u.id) !== String(id));
  writeJsonUsers(users);
}

module.exports = {
  initUserDB,
  getUserByUsername,
  getUsers,
  createUser,
  updateUser,
  deleteUser
};
