/* La Campana - cargador de dataset sensible al rango elegido.
   Evita que un dataset viejo (por ejemplo solo junio) se muestre cuando
   el usuario seleccionó otro rango. El histórico sigue siendo permanente
   en Supabase; aquí solo se asegura que la pantalla lea el rango correcto. */
(function(){
  'use strict';
  if (window.LC_RANGE_DATA_READY) return;
  const API_BASE=(window.LC_API_BASE||'https://prueba-d9ro.onrender.com/api').replace(/\/$/,'');
  const LS_INICIO='LC_SAP_RANGE_INICIO';
  const LS_FIN='LC_SAP_RANGE_FIN';

  function rangoSeleccionado(){
    try{
      const inicio=localStorage.getItem(LS_INICIO);
      const fin=localStorage.getItem(LS_FIN);
      if(/^\d{4}-\d{2}-\d{2}$/.test(inicio||'') && /^\d{4}-\d{2}-\d{2}$/.test(fin||'')) return {inicio,fin};
    }catch(_){ }
    return null;
  }

  function esperarStorage(timeoutMs){
    const inicio=Date.now();
    return new Promise((resolve,reject)=>{
      (function intento(){
        if(typeof window.lcGet==='function' && typeof window.lcSet==='function') return resolve();
        if(Date.now()-inicio>=timeoutMs) return reject(new Error('El almacenamiento local del dashboard no quedó disponible.'));
        setTimeout(intento,25);
      })();
    });
  }

  async function cargar(){
    await esperarStorage(20000);
    const rango=rangoSeleccionado();
    let actual=null;
    try{ actual=await window.lcGet('dataset'); }catch(_){ }

    if(!rango){
      if(actual&&actual.data){
        window.LC_DATA=actual.data;
        window.LC_INV=actual.inv||{};
        window.LC_DATA_IMPORTED=true;
      }
      return actual;
    }

    const guardado=actual&&actual.sapRango;
    const coincide=guardado && guardado.inicio===rango.inicio && guardado.fin===rango.fin;
    if(coincide && actual.data){
      window.LC_DATA=actual.data;
      window.LC_INV=actual.inv||{};
      window.LC_DATA_IMPORTED=true;
      window.LC_SAP_RANGE=rango;
      return actual;
    }

    const url=API_BASE+'/dataset?fecha_inicio='+encodeURIComponent(rango.inicio)+'&fecha_fin='+encodeURIComponent(rango.fin);
    const response=await fetch(url,{cache:'no-store'});
    const body=await response.json().catch(()=>({}));
    if(!response.ok || !body.data){
      throw new Error(body.error||body.mensaje||('No se pudo cargar el rango '+rango.inicio+' → '+rango.fin+'.'));
    }

    const nuevo={
      data:body.data,
      inv:body.inv||{},
      sapGuardadoEn:Date.now(),
      sapVigenciaDias:36500,
      sapRango:rango
    };
    await window.lcSet('dataset',nuevo);
    window.LC_DATA=nuevo.data;
    window.LC_INV=nuevo.inv;
    window.LC_DATA_IMPORTED=true;
    window.LC_SAP_RANGE=rango;
    try{ window.dispatchEvent(new CustomEvent('lc:sap-updated',{detail:[]})); }catch(_){}
    return nuevo;
  }

  window.LC_RANGE_DATA_READY=cargar().catch(function(error){
    console.error('[RANGO SAP]',error);
    window.LC_RANGE_DATA_ERROR=error;
    throw error;
  });
})();
