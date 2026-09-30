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
  // Textos según la causa real del cierre de sesión. Antes el HTML del
  // aviso estaba fijo y siempre decía "otro dispositivo inició sesión",
  // sin importar el motivo real — por eso salía ese mensaje incluso
  // cuando la sesión simplemente se invalidó (p. ej. el servidor se
  // reinició) y no había ningún otro dispositivo real.
  const TEXTOS_CIERRE = {
    otroDispositivo: {
      icono: '⚠️',
      titulo: 'Otro dispositivo inició sesión',
      cuerpo: 'Tu sesión fue cerrada porque este usuario inició sesión en otro dispositivo. Debes volver a iniciar sesión.'
    },
    expirada: {
      icono: '⏳',
      titulo: 'Tu sesión ya no es válida',
      cuerpo: 'Tu sesión expiró o dejó de ser válida. Vuelve a iniciar sesión para continuar.'
    },
    inactividad: {
      icono: '💤',
      titulo: 'Sesión cerrada por inactividad',
      cuerpo: 'Cerramos tu sesión porque la página estuvo abierta sin uso durante mucho tiempo. Vuelve a iniciar sesión para continuar.'
    }
  };
  let sesionExpulsada=false;
  function mostrarSesionExpulsada(tipo, mensaje){
    if(sesionExpulsada) return;
    sesionExpulsada=true;
    detenerInactividad();
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem('panorama_usuario');
    if(sse){ try{ sse.close(); }catch(e){} }
    // El overlay pudo haber sido "removido" del documento (ver
    // overlay.remove() más abajo) tras la verificación inicial exitosa.
    // Si no lo reinsertamos aquí, este mensaje se arma en un elemento
    // que ya no está en pantalla y el usuario nunca lo ve.
    if(!document.documentElement.contains(overlay)) document.documentElement.appendChild(overlay);
    overlay.style.display='grid';
    overlay.style.background='rgba(0,0,0,.48)';
    overlay.style.backdropFilter='blur(3px)';
    const t=TEXTOS_CIERRE[tipo]||TEXTOS_CIERRE.expirada;
    const cuerpo=(tipo==='inactividad')?t.cuerpo:(mensaje||t.cuerpo);
    overlay.innerHTML='<div style="font:600 15px Inter,Arial,sans-serif;color:#222;text-align:center;max-width:440px;width:calc(100% - 40px);padding:30px;background:#fff;border-radius:18px;box-shadow:0 18px 60px rgba(0,0,0,.35)"><div style="font-size:42px;margin-bottom:12px">'+t.icono+'</div><div style="font-size:21px;margin-bottom:10px">'+t.titulo+'</div><div style="font-weight:400;line-height:1.5;margin-bottom:22px">'+cuerpo+'</div><button id="volverLogin" style="background:#c9151e;color:#fff;border:0;border-radius:10px;padding:12px 22px;font-weight:800;cursor:pointer">VOLVER A INICIAR SESIÓN</button></div>';
    document.getElementById('volverLogin').addEventListener('click',()=>location.replace('index.html'));
    try { history.pushState({lcSesionExpulsada:true}, '', location.href); history.pushState({lcSesionExpulsada:true}, '', location.href); } catch(e) {}
  }
  window.addEventListener('popstate', function(){
    if (sesionExpulsada) { try { history.pushState({lcSesionExpulsada:true}, '', location.href); } catch(e) {} }
  });
  window.addEventListener('beforeunload', function(e){
    if (sesionExpulsada) { e.preventDefault(); e.returnValue=''; }
  });

  // Conexión en tiempo real: el servidor avisa EN EL MOMENTO en que otro
  // dispositivo inicia sesión, sin depender de que este dispositivo
  // pregunte (polling). Así la alerta sale sin necesidad de tocar nada.
  let sse=null;
  function conectarSSE(token){
    if(!token || !window.EventSource) return;
    try{
      sse=new EventSource(API_BASE+'/auth/sesion-stream?token='+encodeURIComponent(token));
      sse.addEventListener('otroDispositivo', function(ev){
        let d={}; try{ d=JSON.parse(ev.data); }catch(e){}
        mostrarSesionExpulsada('otroDispositivo', d.message || d.mensaje);
        if(sse) sse.close();
      });
      sse.onerror=function(){
        // Si se corta la conexión (red, el server la reinicia, etc.) el
        // polling de comprobarSesion() sigue funcionando como respaldo
        // hasta que EventSource reconecte solo.
      };
    }catch(e){}
  }

  async function comprobarSesion(){
    if(sesionExpulsada) return;
    const token=sessionStorage.getItem(TOKEN_KEY);
    if(!token){location.replace('index.html');return;}
    try{
      const r=await fetch(API_BASE+'/auth/me',{headers:{Authorization:'Bearer '+token},cache:'no-store'});
      const d=await r.json().catch(()=>({}));
      if(!r.ok && d.otroDispositivo){ mostrarSesionExpulsada('otroDispositivo', d.message || d.mensaje); }
      else if(!r.ok && d.sesionExpirada){ mostrarSesionExpulsada('expirada', d.message || d.mensaje); }
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

  // ============================================================
  // CIERRE POR INACTIVIDAD (independiente del aviso de "otro dispositivo")
  // ============================================================
  // Si la página lleva abierta este tiempo sin ninguna interacción real
  // del usuario (mouse, teclado, toque, scroll), se cierra la sesión con
  // un mensaje propio — nunca con el de "otro dispositivo inició sesión".
  // Para ajustar el tiempo, solo hay que cambiar este número (en minutos).
  const INACTIVIDAD_LIMITE_MIN = 30;
  const INACTIVIDAD_LIMITE_MS = INACTIVIDAD_LIMITE_MIN * 60 * 1000;
  let ultimaActividad = Date.now();
  let inactividadTimer = null;
  function marcarActividad(){ ultimaActividad = Date.now(); }
  function revisarInactividad(){
    if (sesionExpulsada) return;
    if (Date.now() - ultimaActividad >= INACTIVIDAD_LIMITE_MS) cerrarPorInactividad();
  }
  function cerrarPorInactividad(){
    if (sesionExpulsada) return;
    // Avisamos al servidor para liberar la sesión de una vez (mejor
    // esfuerzo: si falla, el token simplemente seguirá viviendo hasta que
    // expire por su cuenta, sin afectar al usuario).
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (token) {
      try {
        fetch(API_BASE + '/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, keepalive: true }).catch(()=>{});
      } catch (e) {}
    }
    mostrarSesionExpulsada('inactividad');
  }
  function iniciarInactividad(){
    marcarActividad();
    const eventos = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll'];
    eventos.forEach(function(ev){ window.addEventListener(ev, marcarActividad, { passive: true }); });
    inactividadTimer = setInterval(revisarInactividad, 15000);
    // El setInterval se frena en segundo plano: al volver a primer plano
    // revisamos de una vez, para no tardar en detectar que ya se pasó el
    // límite mientras la pestaña estuvo oculta.
    document.addEventListener('visibilitychange', function(){
      if (document.visibilityState === 'visible') revisarInactividad();
    });
  }
  function detenerInactividad(){
    if (inactividadTimer) { clearInterval(inactividadTimer); inactividadTimer = null; }
  }

  async function verificar(){
    const token=sessionStorage.getItem(TOKEN_KEY);
    if(!token){location.replace('index.html');return;}
    try{
      const r=await fetch(API_BASE+'/auth/me',{headers:{Authorization:'Bearer '+token},cache:'no-store'});
      const d=await r.json().catch(()=>({}));
      if(!r.ok){
        if(d.otroDispositivo){ mostrarSesionExpulsada('otroDispositivo', d.message || d.mensaje); return; }
        if(d.sesionExpirada){ mostrarSesionExpulsada('expirada', d.message || d.mensaje); return; }
        sessionStorage.removeItem(TOKEN_KEY);location.replace('index.html');return;
      }
      const u=d.usuario||{}; sessionStorage.setItem('panorama_usuario',JSON.stringify(u));
      const permisos=Array.isArray(u.permisos)?u.permisos:[];
      if(u.rol!=='admin' && !permisos.includes(page)){
        location.replace('menu.html?acceso=denegado');return;
      }
      overlay.style.display='none';
      conectarSSE(token);
      iniciarInactividad();
      window.dispatchEvent(new CustomEvent('auth-ready',{detail:u}));
    }catch(e){overlay.innerHTML='<div style="font:700 14px Inter,Arial,sans-serif;color:#fff;text-align:center">No se pudo verificar la sesión.<br><small>Revisa la conexión e inténtalo de nuevo.</small></div>';}
  }
  verificar();
})();
