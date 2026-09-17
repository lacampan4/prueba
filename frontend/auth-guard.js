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
