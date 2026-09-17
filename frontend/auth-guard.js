// === PARCHE DE AUTENTICACIÓN (SAP) — se carga antes que cualquier dashboard ===
// Los endpoints del backend (/sync-sap, /sync-status, /facturacion,
// /dataset, /dashboards/*) quedaron protegidos con requiereAuth al
// agregar el sistema de usuarios. Los dashboards publicados llamaban a
// fetch() sin el token de sesión: el backend respondía 401 (sesión
// inválida) y el mensaje lo mostraba como si el 401 viniera de SAP.
// Aquí interceptamos fetch()
// para adjuntar siempre 'Authorization: Bearer <token>' y para que un
// 401 de sesión se explique como tal.
(function () {
  if (window.__lcSapAuthPatch) return;
  window.__lcSapAuthPatch = true;
  var KEY = 'panorama_access_token';
  var BASE = String(window.LC_API_BASE || 'https://prueba-d9ro.onrender.com/api').replace(/\/$/, '');
  var origFetch = window.fetch.bind(window);
  function esBackend(u) {
    var s = String(u || '');
    return s.indexOf(BASE) === 0 || s.indexOf('/api/') === 0;
  }
  function leerToken() {
    try { return sessionStorage.getItem(KEY); } catch (e) { return null; }
  }
  function error401(hayToken) {
    var msg = hayToken
      ? 'Tu sesión expiró o ya no es válida. Vuelve a iniciar sesión y reintenta la sincronización.'
      : 'No hay una sesión activa en este navegador. Inicia sesión de nuevo.';
    return new Response(
      JSON.stringify({ ok: false, error: msg, mensaje: msg, message: msg, sesionExpirada: true, otroDispositivo: true }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }
  window.fetch = function (input, init) {
    var url = (typeof input === 'string') ? input : (input && input.url) || '';
    if (!esBackend(url)) return origFetch(input, init);
    var tk = leerToken();
    var opciones = Object.assign({}, init || {});
    if (tk) {
      var previos = (init && init.headers) || (typeof input !== 'string' && input && input.headers) || {};
      var h = new Headers(previos);
      if (!h.has('Authorization')) h.set('Authorization', 'Bearer ' + tk);
      opciones.headers = h;
    }
    var p = (typeof input === 'string')
      ? origFetch(input, opciones)
      : origFetch(new Request(input, opciones));
    return p.then(function (res) {
      if (res && res.status === 401 && url.indexOf('/auth/me') === -1 && url.indexOf('/auth/login') === -1) return error401(!!tk);
      return res;
    });
  };
})();

(function(){
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
  let sesionExpulsada=false;
  function mostrarSesionExpulsada(mensaje){
    if(sesionExpulsada) return;
    sesionExpulsada=true;
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem('panorama_usuario');
    overlay.style.background='rgba(0,0,0,.48)';
    overlay.style.backdropFilter='blur(3px)';
    overlay.innerHTML='<div style="font:600 15px Inter,Arial,sans-serif;color:#222;text-align:center;max-width:440px;width:calc(100% - 40px);padding:30px;background:#fff;border-radius:18px;box-shadow:0 18px 60px rgba(0,0,0,.35)"><div style="font-size:42px;margin-bottom:12px">⚠️</div><div style="font-size:21px;margin-bottom:10px">Otro dispositivo inició sesión</div><div style="font-weight:400;line-height:1.5;margin-bottom:22px">Tu sesión fue cerrada porque este usuario inició sesión en otro dispositivo. Debes volver a iniciar sesión.</div><button id="volverLogin" style="background:#c9151e;color:#fff;border:0;border-radius:10px;padding:12px 22px;font-weight:800;cursor:pointer">VOLVER A INICIAR SESIÓN</button></div>';
    document.getElementById('volverLogin').addEventListener('click',()=>location.replace('index.html'));
    try { history.pushState({lcSesionExpulsada:true}, '', location.href); history.pushState({lcSesionExpulsada:true}, '', location.href); } catch(e) {}
  }
  window.addEventListener('popstate', function(){
    if (sesionExpulsada) { try { history.pushState({lcSesionExpulsada:true}, '', location.href); } catch(e) {} }
  });
  window.addEventListener('beforeunload', function(e){
    if (sesionExpulsada) { e.preventDefault(); e.returnValue=''; }
  });

  async function comprobarSesion(){
    if(sesionExpulsada) return;
    const token=sessionStorage.getItem(TOKEN_KEY);
    if(!token){location.replace('index.html');return;}
    try{
      const r=await fetch(API_BASE+'/auth/me',{headers:{Authorization:'Bearer '+token},cache:'no-store'});
      const d=await r.json().catch(()=>({}));
      if(!r.ok && (d.otroDispositivo || d.sesionExpirada)){ mostrarSesionExpulsada(d.message || d.mensaje || 'Otro dispositivo inició sesión con este usuario.'); }
    }catch(e){}
  }
  setInterval(comprobarSesion,1000);
  // Los navegadores frenan (throttle) los setInterval cuando la pestaña
  // está en segundo plano o minimizada, así que el aviso de "otro
  // dispositivo inició sesión" podía tardar mucho en aparecer si el
  // usuario no tenía esa pestaña activa en ese momento. Forzamos una
  // verificación inmediata apenas la pestaña vuelve a estar visible o
  // recupera el foco, para que la ventana emergente salga de una vez.
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState === 'visible') comprobarSesion();
  });
  window.addEventListener('focus', comprobarSesion);
  window.addEventListener('pageshow', function(){ comprobarSesion(); });

  async function verificar(){
    const token=sessionStorage.getItem(TOKEN_KEY);
    if(!token){location.replace('index.html');return;}
    try{
      const r=await fetch(API_BASE+'/auth/me',{headers:{Authorization:'Bearer '+token},cache:'no-store'});
      const d=await r.json().catch(()=>({}));
      if(!r.ok){
        if(d.otroDispositivo || d.sesionExpirada){
          mostrarSesionExpulsada(d.message || d.mensaje || 'Otro dispositivo inició sesión con este usuario.');
          return;
        }
        sessionStorage.removeItem(TOKEN_KEY);location.replace('index.html');return;
      }
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
