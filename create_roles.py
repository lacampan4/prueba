import os, json, re, secrets, hashlib, zipfile, shutil
from pathlib import Path

root=Path('/mnt/data/proyecto_roles/prueba-main')
backend=root/'backend'; frontend=root/'frontend'

# --- Users store with scrypt hashes ---
permissions=[
'panorama-produccion','panorama-comercial','hoja-asesor','hoja-despacho','hoja-ruta-cliente','hoja-sede',
'panorama-produccion-diaria','panorama-portafolio','planeacion-nogales','costos-produccion','analisis-inventario','panorama-compras','usuarios'
]
role_defaults={
'admin': permissions,
'gerencia': permissions[:-1],
'comercio':['panorama-comercial','hoja-asesor','hoja-ruta-cliente','hoja-sede','panorama-portafolio','panorama-compras'],
'produccion':['panorama-produccion','hoja-despacho','hoja-sede','panorama-produccion-diaria','planeacion-nogales','costos-produccion','analisis-inventario']
}
def h(password, salt=None):
    salt=salt or secrets.token_hex(16)
    digest=hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1, dklen=64)
    return salt+':'+digest.hex()

test=[
('admin1','Administrador Principal','admin'),('admin2','Administrador Prueba','admin'),
('gerencia1','Laura Gerencia','gerencia'),('gerencia2','Carlos Gerencia','gerencia'),('gerencia3','Ana Gerencia','gerencia'),
('comercio1','Juan Comercio','comercio'),('comercio2','Maria Comercio','comercio'),('comercio3','Pedro Comercio','comercio'),
('produccion1','Sofia Produccion','produccion'),('produccion2','Andres Produccion','produccion')]
users=[]
for username,name,role in test:
    users.append({'id':secrets.token_hex(8),'username':username,'nombre':name,'rol':role,'password_hash':h('Prueba123!'),'permisos':list(role_defaults[role]),'activo':True})
(backend/'users.json').write_text(json.dumps(users,ensure_ascii=False,indent=2),encoding='utf-8')

# Replace auth block from constants through /auth/me
app=(backend/'app.js').read_text(encoding='utf-8')
start=app.index("const ADMIN_USERNAME")
end=app.index("// ============================================================\n// CACHÉ DE SAP", start)
new=r'''const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const AUTH_SECRET = process.env.AUTH_SECRET || '';
const ADMIN_ROLE = process.env.ADMIN_ROLE || 'admin';
const AUTH_TOKEN_TTL_SECONDS = Number(process.env.AUTH_TOKEN_TTL_SECONDS || 28800);
const USERS_FILE = require('path').join(__dirname, 'users.json');
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

function leerUsuarios(){
  try { return JSON.parse(require('fs').readFileSync(USERS_FILE,'utf8')); }
  catch { return []; }
}
function guardarUsuarios(lista){ require('fs').writeFileSync(USERS_FILE, JSON.stringify(lista,null,2),'utf8'); }
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
  if(req.usuarioAuth?.rol !== 'admin') return res.status(403).json({ok:false,message:'Solo un administrador puede realizar esta acción.'});
  next();
}

// ============================================================
// AUTH
// ============================================================
app.post('/auth/login',(req,res)=>{
  if(!AUTH_SECRET) return res.status(503).json({ok:false,message:'La autenticación no está configurada. Configure AUTH_SECRET en el servidor.'});
  const username=String(req.body?.username||'').trim().toLowerCase();
  const password=String(req.body?.password||'');
  const usuarios=leerUsuarios();
  let usuario=usuarios.find(u=>u.username.toLowerCase()===username && u.activo!==false);
  // Compatibilidad con el administrador anterior basado en variables de entorno.
  if(!usuario && ADMIN_USERNAME && ADMIN_PASSWORD && username===ADMIN_USERNAME.toLowerCase() && password===ADMIN_PASSWORD){
    usuario={username:ADMIN_USERNAME,nombre:'Administrador',rol:'admin',permisos:PAGINAS_PERMITIDAS,activo:true};
  }
  if(!usuario || (!usuario.password_hash ? password!==ADMIN_PASSWORD : !passwordCorrecta(password,usuario.password_hash)))
    return res.status(401).json({ok:false,message:'Usuario o contraseña incorrectos.'});
  const permisos=permisosDeUsuario(usuario);
  return res.json({ok:true,token:crearTokenAuth({...usuario,permisos}),usuario:{id:usuario.id,username:usuario.username,nombre:usuario.nombre,rol:usuario.rol,permisos}});
});

app.get('/auth/me',requiereAuth,(req,res)=>{
  const u=leerUsuarios().find(x=>x.username===req.usuarioAuth.sub && x.activo!==false);
  if(!u && req.usuarioAuth.rol!=='admin') return res.status(401).json({ok:false,message:'Usuario desactivado.'});
  return res.json({ok:true,usuario:{username:req.usuarioAuth.sub,nombre:req.usuarioAuth.nombre,rol:req.usuarioAuth.rol,permisos:req.usuarioAuth.permisos||[]}});
});

app.get('/auth/roles',requiereAuth,(req,res)=>res.json({ok:true,roles:Object.keys(PERMISOS_POR_ROL),paginas:PAGINAS_PERMITIDAS,permisosPorRol:PERMISOS_POR_ROL}));

app.get('/auth/users',requiereAuth,requiereAdmin,(req,res)=>{
  res.json({ok:true,usuarios:leerUsuarios().map(u=>({id:u.id,username:u.username,nombre:u.nombre,rol:u.rol,permisos:permisosDeUsuario(u),activo:u.activo!==false}))});
});

app.post('/auth/users',requiereAuth,requiereAdmin,(req,res)=>{
  const {nombre,username,password,rol,permisos,activo}=req.body||{};
  const un=String(username||'').trim().toLowerCase();
  if(!nombre || !un || !password) return res.status(400).json({ok:false,message:'Nombre, usuario y contraseña son obligatorios.'});
  if(!/^[a-z0-9._-]{3,40}$/.test(un)) return res.status(400).json({ok:false,message:'El usuario solo puede contener letras, números, punto, guion y guion bajo.'});
  if(String(password).length<6) return res.status(400).json({ok:false,message:'La contraseña debe tener al menos 6 caracteres.'});
  if(!PERMISOS_POR_ROL[rol]) return res.status(400).json({ok:false,message:'Rol no válido.'});
  const usuarios=leerUsuarios();
  if(usuarios.some(u=>u.username.toLowerCase()===un)) return res.status(409).json({ok:false,message:'Ese usuario ya existe.'});
  const permitidos=Array.isArray(permisos)?permisos.filter(p=>PAGINAS_PERMITIDAS.includes(p)):PERMISOS_POR_ROL[rol];
  const nuevo={id:cryptoAuth.randomBytes(8).toString('hex'),nombre:String(nombre).trim(),username:un,rol,password_hash:hashPassword(password),permisos:rol==='admin'?PAGINAS_PERMITIDAS:permitidos,activo:activo!==false};
  usuarios.push(nuevo); guardarUsuarios(usuarios);
  res.status(201).json({ok:true,usuario:{id:nuevo.id,username:nuevo.username,nombre:nuevo.nombre,rol:nuevo.rol,permisos:nuevo.permisos,activo:nuevo.activo}});
});

app.put('/auth/users/:id',requiereAuth,requiereAdmin,(req,res)=>{
  const usuarios=leerUsuarios(); const u=usuarios.find(x=>x.id===req.params.id);
  if(!u) return res.status(404).json({ok:false,message:'Usuario no encontrado.'});
  const {nombre,username,password,rol,permisos,activo}=req.body||{};
  if(nombre!==undefined) u.nombre=String(nombre).trim();
  if(username!==undefined){ const un=String(username).trim().toLowerCase(); if(usuarios.some(x=>x.id!==u.id && x.username===un)) return res.status(409).json({ok:false,message:'Ese usuario ya existe.'}); u.username=un; }
  if(rol!==undefined){ if(!PERMISOS_POR_ROL[rol]) return res.status(400).json({ok:false,message:'Rol no válido.'}); u.rol=rol; }
  if(password){ if(String(password).length<6) return res.status(400).json({ok:false,message:'La contraseña debe tener al menos 6 caracteres.'}); u.password_hash=hashPassword(password); }
  if(Array.isArray(permisos)) u.permisos=permisos.filter(p=>PAGINAS_PERMITIDAS.includes(p));
  if(u.rol==='admin') u.permisos=PAGINAS_PERMITIDAS.slice();
  if(activo!==undefined) u.activo=Boolean(activo);
  guardarUsuarios(usuarios);
  res.json({ok:true,usuario:{id:u.id,username:u.username,nombre:u.nombre,rol:u.rol,permisos:permisosDeUsuario(u),activo:u.activo!==false}});
});

app.delete('/auth/users/:id',requiereAuth,requiereAdmin,(req,res)=>{
  const usuarios=leerUsuarios(); const u=usuarios.find(x=>x.id===req.params.id);
  if(!u) return res.status(404).json({ok:false,message:'Usuario no encontrado.'});
  if(u.username===req.usuarioAuth.sub) return res.status(400).json({ok:false,message:'No puedes eliminar el usuario con el que estás conectado.'});
  guardarUsuarios(usuarios.filter(x=>x.id!==u.id)); res.json({ok:true});
});

'''
app=app[:start]+new+app[end:]
(backend/'app.js').write_text(app,encoding='utf-8')

# Frontend auth guard
(frontend/'auth-guard.js').write_text(r'''(function(){
  const TOKEN_KEY='panorama_access_token';
  const API_BASE=window.API_BASE || 'https://prueba-d9ro.onrender.com/api';
  const page=(location.pathname.split('/').pop()||'index.html').toLowerCase().replace(/\.html$/,'');
  const publicPages=['index'];
  if(publicPages.includes(page)) return;
  const overlay=document.createElement('div');
  overlay.id='roleGuardOverlay';
  overlay.innerHTML='<div style="font:700 14px Inter,Arial,sans-serif;color:#fff;text-align:center"><div style="width:34px;height:34px;border:3px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:roleSpin .75s linear infinite;margin:0 auto 12px"></div>Verificando permisos...</div>';
  Object.assign(overlay.style,{position:'fixed',inset:'0',background:'#c9151e',zIndex:'2147483647',display:'grid',placeItems:'center'});
  const st=document.createElement('style');st.textContent='@keyframes roleSpin{to{transform:rotate(360deg)}}';document.head.appendChild(st);document.documentElement.appendChild(overlay);
  async function verificar(){
    const token=sessionStorage.getItem(TOKEN_KEY);
    if(!token){location.replace('index.html');return;}
    try{
      const r=await fetch(API_BASE+'/auth/me',{headers:{Authorization:'Bearer '+token},cache:'no-store'});
      const d=await r.json().catch(()=>({}));
      if(!r.ok){sessionStorage.removeItem(TOKEN_KEY);location.replace('index.html');return;}
      const u=d.usuario||{}; sessionStorage.setItem('panorama_usuario',JSON.stringify(u));
      const permisos=Array.isArray(u.permisos)?u.permisos:[];
      if(u.rol!=='admin' && !permisos.includes(page)){
        location.replace('menu.html?acceso=denegado');return;
      }
      overlay.remove();
      window.dispatchEvent(new CustomEvent('auth-ready',{detail:u}));
    }catch(e){overlay.innerHTML='<div style="font:700 14px Inter,Arial,sans-serif;color:#fff;text-align:center">No se pudo verificar la sesión.<br><small>Revisa la conexión e inténtalo de nuevo.</small></div>';}
  }
  verificar();
})();
''',encoding='utf-8')

# Add guard to all dashboard HTML except index/menu, and API me data will be available.
for p in frontend.glob('*.html'):
    txt=p.read_text(encoding='utf-8')
    if p.name not in ('index.html','menu.html') and 'auth-guard.js' not in txt:
        txt=txt.replace('</head>','<script src="auth-guard.js"></script>\n</head>',1)
        p.write_text(txt,encoding='utf-8')

# Menu: add page markers and auth management card, plus filtering script.
menu=frontend/'menu.html'; txt=menu.read_text(encoding='utf-8')
for fn in [p.stem for p in frontend.glob('*.html')]:
    txt=txt.replace(f'href="{fn}.html"',f'href="{fn}.html" data-page="{fn}"')
# Insert admin card before closing grid div after compras card
needle='''    <a class="card" href="panorama-compras.html" data-page="panorama-compras">'''
pos=txt.find(needle)
endcard=txt.find('    </a>',pos)
insert='''    <a class="card admin-only" href="usuarios.html" data-page="usuarios" style="display:none">\n      <div class="icon">♙</div><div><div style="font-size:10px;color:#7b8288;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:7px">Módulo administrativo</div>\n      <h2>USUARIOS Y PERMISOS</h2><p>Agrega personas y controla exactamente las páginas a las que pueden entrar.</p></div><div class="arrow">→</div>\n    </a>\n'''
txt=txt[:endcard+len('    </a>')]+insert+txt[endcard+len('    </a>'):]
# Replace existing verifying script with permission-aware version by append a new script just before </body>.
script=r'''<script id="roles-menu">
(function(){
const TOKEN_KEY='panorama_access_token', API_BASE='https://prueba-d9ro.onrender.com/api';
const pageNames={
'panorama-produccion':'Producción','panorama-comercial':'Labor Comercial','hoja-asesor':'Hoja de Asesor','hoja-despacho':'Hoja de Despacho','hoja-ruta-cliente':'Hoja de Cliente','hoja-sede':'Hoja de Sede','panorama-produccion-diaria':'Producción Diaria','panorama-portafolio':'Portafolio y Cartera','planeacion-nogales':'Planeación Nogales','costos-produccion':'Costos de Producción','analisis-inventario':'Análisis Inventario','panorama-compras':'Panorama de Compras','usuarios':'Usuarios y Permisos'};
async function cargar(){
 const token=sessionStorage.getItem(TOKEN_KEY); if(!token){location.replace('index.html');return;}
 try{
  const r=await fetch(API_BASE+'/auth/me',{headers:{Authorization:'Bearer '+token},cache:'no-store'}); const d=await r.json().catch(()=>({}));
  if(!r.ok){sessionStorage.removeItem(TOKEN_KEY);location.replace('index.html');return;}
  const u=d.usuario||{}, permisos=new Set(u.permisos||[]); sessionStorage.setItem('panorama_usuario',JSON.stringify(u));
  document.querySelectorAll('.card[data-page]').forEach(card=>{const p=card.dataset.page;if(u.rol==='admin'||permisos.has(p)) card.style.display='';else card.style.display='none';});
  document.querySelectorAll('.admin-only').forEach(x=>x.style.display=u.rol==='admin'?'':'none');
  const label=document.getElementById('userName'); if(label) label.textContent=u.nombre||u.username||u.rol;
  const avatar=document.getElementById('userAvatar'); if(avatar) avatar.textContent=(u.nombre||u.username||'U').charAt(0).toUpperCase();
  const role=document.querySelector('.userRole'); if(role) role.textContent=u.rol||'';
  document.getElementById('authChecking')?.remove();
  if(new URLSearchParams(location.search).get('acceso')==='denegado') alert('No tienes permiso para acceder a esa página.');
 }catch(e){console.error(e);}
}
cargar();
})();
</script>'''
txt=txt.replace('</body>',script+'\n</body>')
menu.write_text(txt,encoding='utf-8')

# Login: show username/password system already works, only make API path current and store user info.
idx=frontend/'index.html'; it=idx.read_text(encoding='utf-8')
it=it.replace("sessionStorage.setItem('panorama_access_token',data.token);","sessionStorage.setItem('panorama_access_token',data.token);\n    if(data.usuario) sessionStorage.setItem('panorama_usuario',JSON.stringify(data.usuario));")
idx.write_text(it,encoding='utf-8')

# Users admin page
usuarios='''<!DOCTYPE html>\n<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Usuarios y permisos · La Campana</title><link rel="icon" href="favicon.png"><style>*{box-sizing:border-box}body{margin:0;background:#f6f7f8;color:#171b20;font-family:Inter,Arial,sans-serif}.top{background:#c9151e;color:white;padding:18px 28px;display:flex;justify-content:space-between;align-items:center}.wrap{max-width:1200px;margin:28px auto;padding:0 20px}.panel{background:#fff;border:1px solid #e2e4e6;border-radius:14px;padding:22px;margin-bottom:20px;box-shadow:0 8px 24px #0000000b}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field label{display:block;font-size:12px;font-weight:800;margin-bottom:6px}.field input,.field select{width:100%;padding:11px;border:1px solid #d8dcdf;border-radius:8px}.perms{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}.perm{padding:9px;border:1px solid #e0e2e4;border-radius:8px;font-size:12px}.actions{display:flex;gap:8px;margin-top:15px}.btn{border:0;border-radius:8px;padding:10px 15px;font-weight:800;cursor:pointer}.primary{background:#c9151e;color:#fff}.secondary{background:#eceff1}.danger{background:#fff0f0;color:#a00}.user{border-top:1px solid #eee;padding:16px 0;display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.badge{font-size:10px;font-weight:900;text-transform:uppercase;padding:5px 8px;border-radius:999px;background:#eee}.small{font-size:12px;color:#6d747b}.denied{text-align:center;padding:60px;font-weight:800}@media(max-width:800px){.grid,.perms{grid-template-columns:1fr}.user{flex-direction:column}}</style><script src="auth-guard.js"></script></head><body><div class="top"><strong>La Campana · Usuarios y permisos</strong><button class="btn secondary" onclick="location.href='menu.html'">Volver al menú</button></div><div class="wrap"><div class="panel"><h2>Agregar usuario</h2><p class="small">Cada persona puede tener permisos diferentes aunque tenga el mismo rol.</p><form id="form"><div class="grid"><div class="field"><label>Nombre completo</label><input id="nombre" required></div><div class="field"><label>Usuario</label><input id="username" required placeholder="ej. juan.perez"></div><div class="field"><label>Contraseña</label><input id="password" type="password" required minlength="6"></div><div class="field"><label>Rol</label><select id="rol"><option value="gerencia">Gerencia</option><option value="comercio">Comercio</option><option value="produccion">Producción</option><option value="admin">Admin</option></select></div></div><h3>Permisos de páginas</h3><div class="actions"><button type="button" class="btn secondary" onclick="marcarRol()">Cargar permisos del rol</button><button type="button" class="btn secondary" onclick="marcarTodos()">Todas</button><button type="button" class="btn secondary" onclick="quitarTodos()">Ninguna</button></div><div id="perms" class="perms"></div><div class="actions"><button class="btn primary">Crear usuario</button></div></form></div><div class="panel"><h2>Usuarios existentes</h2><div id="lista">Cargando...</div></div></div><script>
const API_BASE='https://prueba-d9ro.onrender.com/api',TOKEN_KEY='panorama_access_token';let paginas=[],roles={};
function headers(){return {'Content-Type':'application/json',Authorization:'Bearer '+sessionStorage.getItem(TOKEN_KEY)}}
function pintarPermisos(selected=[]){document.getElementById('perms').innerHTML=paginas.map(p=>`<label class="perm"><input type="checkbox" value="${p}" ${selected.includes(p)?'checked':''}> ${({"panorama-produccion":"Producción","panorama-comercial":"Labor Comercial","hoja-asesor":"Hoja de Asesor","hoja-despacho":"Hoja de Despacho","hoja-ruta-cliente":"Hoja de Cliente","hoja-sede":"Hoja de Sede","panorama-produccion-diaria":"Producción Diaria","panorama-portafolio":"Portafolio y Cartera","planeacion-nogales":"Planeación Nogales","costos-produccion":"Costos de Producción","analisis-inventario":"Análisis Inventario","panorama-compras":"Panorama de Compras","usuarios":"Usuarios y Permisos"}[p]||p)}</label>`).join('')}
function seleccionados(){return [...document.querySelectorAll('#perms input:checked')].map(x=>x.value)}
function marcarRol(){pintarPermisos(roles[document.getElementById('rol').value]||[])}function marcarTodos(){pintarPermisos(paginas)}function quitarTodos(){pintarPermisos([])}
async function init(){const r=await fetch(API_BASE+'/auth/roles',{headers:headers()});if(r.status===403){document.body.innerHTML='<div class="denied">Solo un administrador puede administrar usuarios.</div>';return}const d=await r.json();paginas=d.paginas;roles=d.permisosPorRol;pintarPermisos(roles.gerencia||[]);cargar()}
document.getElementById('form').onsubmit=async e=>{e.preventDefault();const body={nombre:nombre.value,username:username.value,password:password.value,rol:rol.value,permisos:seleccionados()};const r=await fetch(API_BASE+'/auth/users',{method:'POST',headers:headers(),body:JSON.stringify(body)});const d=await r.json();if(!r.ok)return alert(d.message||'No se pudo crear');alert('Usuario creado correctamente');e.target.reset();pintarPermisos(roles.gerencia||[]);cargar()}
async function cargar(){const r=await fetch(API_BASE+'/auth/users',{headers:headers()});const d=await r.json();if(!r.ok)return;lista.innerHTML=d.usuarios.map(u=>`<div class="user"><div><strong>${esc(u.nombre)}</strong><div class="small">${esc(u.username)} · <span class="badge">${esc(u.rol)}</span> · ${u.activo?'Activo':'Inactivo'}</div><div class="small">${u.permisos.length} páginas permitidas</div></div><div class="actions"><button class="btn secondary" onclick='editar(${JSON.stringify(u)})'>Editar permisos</button><button class="btn danger" onclick="eliminar('${u.id}')">Eliminar</button></div></div>`).join('')}
function esc(s){return String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
async function editar(u){const nuevo=prompt('Permisos separados por coma.\n\n'+paginas.map(p=>`${u.permisos.includes(p)?'[X]':'[ ]'} ${p}`).join('\n')+'\n\nEscribe las páginas permitidas separadas por coma:',u.permisos.join(','));if(nuevo===null)return;const ps=nuevo.split(',').map(x=>x.trim()).filter(Boolean);const r=await fetch(API_BASE+'/auth/users/'+u.id,{method:'PUT',headers:headers(),body:JSON.stringify({permisos:ps})});const d=await r.json();if(!r.ok)alert(d.message||'Error');else cargar()}
async function eliminar(id){if(!confirm('¿Eliminar este usuario?'))return;const r=await fetch(API_BASE+'/auth/users/'+id,{method:'DELETE',headers:headers()});const d=await r.json();if(!r.ok)alert(d.message||'Error');else cargar()}
init();</script></body></html>'''
(frontend/'usuarios.html').write_text(usuarios,encoding='utf-8')

# Fix admin card insertion if duplicated? Ensure users page itself guarded.

# Zip output
out='/mnt/data/prueba-main-roles.zip'
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
    for path in root.parent.rglob('*'):
        if path.is_file(): z.write(path,path.relative_to(root.parent))
print(out)
print('users', [(u['username'],u['rol'],len(u['permisos'])) for u in users])
