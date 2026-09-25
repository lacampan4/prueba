/* La Campana - cargador de dataset sensible al rango elegido.
   El dataset visible DEBE corresponder al rango seleccionado.
   Supabase conserva el histórico; este archivo solo sincroniza la vista. */
(function(){
  'use strict';

  if (window.LC_RANGE_DATA_READY) return;

  const API_BASE = (window.LC_API_BASE || 'https://prueba-d9ro.onrender.com/api').replace(/\/$/,'');
  const LS_INICIO = 'LC_SAP_RANGE_INICIO';
  const LS_FIN = 'LC_SAP_RANGE_FIN';
  const RELOAD_KEY = 'LC_RANGE_DATA_RELOAD';

  function rangoSeleccionado(){
    try{
      const inicio = localStorage.getItem(LS_INICIO);
      const fin = localStorage.getItem(LS_FIN);
      if(/^\d{4}-\d{2}-\d{2}$/.test(inicio || '') &&
         /^\d{4}-\d{2}-\d{2}$/.test(fin || '')) {
        return {inicio, fin};
      }
    }catch(_){}
    return null;
  }

  function esperarStorage(timeoutMs){
    const inicio = Date.now();
    return new Promise((resolve,reject)=>{
      (function intento(){
        if(typeof window.lcGet === 'function' && typeof window.lcSet === 'function'){
          return resolve();
        }
        if(Date.now() - inicio >= timeoutMs){
          return reject(new Error('El almacenamiento local del dashboard no quedó disponible.'));
        }
        setTimeout(intento,25);
      })();
    });
  }

  async function fetchDataset(rango){
    const url = API_BASE +
      '/dataset?fecha_inicio=' + encodeURIComponent(rango.inicio) +
      '&fecha_fin=' + encodeURIComponent(rango.fin) +
      '&_range=' + Date.now();

    let token = null;
    try { token = sessionStorage.getItem('panorama_access_token'); } catch(_){}

    const opciones = { cache:'no-store' };
    if(token){
      opciones.headers = { Authorization:'Bearer ' + token };
    }

    const response = await fetch(url, opciones);
    const body = await response.json().catch(()=>({}));

    if(!response.ok || !body.data){
      throw new Error(
        body.error || body.mensaje ||
        ('No se pudo cargar el rango ' + rango.inicio + ' → ' + rango.fin + '.')
      );
    }
    return body;
  }

  async function cargar(){
    await esperarStorage(20000);

    const rango = rangoSeleccionado();
    let actual = null;
    try { actual = await window.lcGet('dataset'); } catch(_){}

    if(!rango){
      if(actual && actual.data){
        window.LC_DATA = actual.data;
        window.LC_INV = actual.inv || {};
        window.LC_DATA_IMPORTED = true;
      }
      return actual;
    }

    const guardado = actual && actual.sapRango;
    const coincide =
      guardado &&
      guardado.inicio === rango.inicio &&
      guardado.fin === rango.fin &&
      actual.data;

    if(coincide){
      window.LC_DATA = actual.data;
      window.LC_INV = actual.inv || {};
      window.LC_DATA_IMPORTED = true;
      window.LC_SAP_RANGE = rango;
      try { sessionStorage.removeItem(RELOAD_KEY); } catch(_){}
      return actual;
    }

    /*
      IMPORTANTE:
      El dashboard se inicializa en otro script que puede ejecutarse antes
      de que este fetch termine. Por eso NO basta con guardar el nuevo dataset:
      hay que recargar la página después de guardarlo. En la siguiente carga
      el dashboard arrancará directamente con el dataset correcto.
    */
    let marker = '';
    try { marker = sessionStorage.getItem(RELOAD_KEY) || ''; } catch(_){}

    const markerEsperado = rango.inicio + '|' + rango.fin;

    if(marker === markerEsperado){
      // Ya intentamos cargar este rango y estamos en la segunda pasada.
      // Si el dataset todavía no coincide, no hacemos un bucle infinito.
      console.warn('[RANGO SAP] El dataset guardado no coincide todavía con el rango seleccionado.', {
        seleccionado:rango,
        guardado:guardado || null
      });
      return actual;
    }

    const body = await fetchDataset(rango);

    const nuevo = {
      data: body.data,
      inv: body.inv || {},
      sapGuardadoEn: Date.now(),
      sapVigenciaDias: 36500,
      sapRango: rango
    };

    await window.lcSet('dataset', nuevo);

    window.LC_DATA = nuevo.data;
    window.LC_INV = nuevo.inv;
    window.LC_DATA_IMPORTED = true;
    window.LC_SAP_RANGE = rango;

    try { sessionStorage.setItem(RELOAD_KEY, markerEsperado); } catch(_){}

    /*
      Esperamos un instante para que IndexedDB termine de confirmar el
      cambio y luego reiniciamos el dashboard. Al volver a entrar, el
      dataset ya coincide y NO se vuelve a consultar.
    */
    setTimeout(() => window.location.reload(), 100);

    return nuevo;
  }

  window.LC_RANGE_DATA_READY = cargar().catch(function(error){
    console.error('[RANGO SAP]', error);
    window.LC_RANGE_DATA_ERROR = error;
    return null;
  });
})();
