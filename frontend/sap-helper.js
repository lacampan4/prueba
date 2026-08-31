/* La Campana - botón "Actualizar desde SAP".
   Esta versión NO usa Neon/PostgreSQL. Render consulta SAP directamente,
   construye el dataset y lo entrega al dashboard. */
(function () {
  'use strict';

  // En Vercel se usa /api y vercel.json lo reenvía al backend de Render.
  // También puedes definir window.LC_API_BASE si necesitas otra URL.
  const API_BASE = (window.LC_API_BASE || '/api').replace(/\/$/, '');

  const DEFAULT_RANGE_DAYS = 30;
  const LS_INICIO = 'LC_SAP_RANGE_INICIO';
  const LS_FIN = 'LC_SAP_RANGE_FIN';

  const PAGES_QUE_USAN_DATASET = new Set([
    'hoja-asesor.html',
    'panorama-comercial.html',
    'panorama-portafolio.html',
    'hoja-ruta-cliente.html',
    'planeacion-nogales.html'
  ]);

  function currentPageFile() {
    const parts = (window.location.pathname || '').split('/');
    return (parts[parts.length - 1] || '').toLowerCase() || 'index.html';
  }

  function toISODate(d) {
    return d.toISOString().slice(0, 10);
  }

  function defaultRange() {
    const hoy = new Date();
    const desde = new Date(hoy);
    desde.setDate(desde.getDate() - DEFAULT_RANGE_DAYS);
    return { inicio: toISODate(desde), fin: toISODate(hoy) };
  }

  function getStoredRange() {
    try {
      const inicio = localStorage.getItem(LS_INICIO);
      const fin = localStorage.getItem(LS_FIN);
      if (inicio && fin) return { inicio, fin };
    } catch (_) {}
    return defaultRange();
  }

  function storeRange(inicio, fin) {
    try {
      localStorage.setItem(LS_INICIO, inicio);
      localStorage.setItem(LS_FIN, fin);
    } catch (_) {}
  }

  function getButton() {
    return document.getElementById('updateSapBtn');
  }

  function setButton(button, text, disabled) {
    if (!button) return;
    button.dataset.sapOriginalText ||= button.textContent.trim();
    button.textContent = text;
    button.disabled = !!disabled;
  }

  function buildRangePicker(button) {
    if (document.getElementById('sapRangeWrap')) return;

    const range = getStoredRange();
    const wrap = document.createElement('span');
    wrap.id = 'sapRangeWrap';
    wrap.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-right:8px';

    function input(id, value, title) {
      const el = document.createElement('input');
      el.type = 'date';
      el.id = id;
      el.value = value;
      el.title = title;
      el.style.cssText = 'font:inherit;padding:8px 9px;border-radius:8px;border:1px solid var(--line2,#d2d6db);background:var(--panel,#fff);color:var(--txt,#14161a)';
      return el;
    }

    const desde = input('sapRangeInicio', range.inicio, 'Fecha inicial');
    const hasta = input('sapRangeFin', range.fin, 'Fecha final');
    const sep = document.createElement('span');
    sep.textContent = '→';
    sep.style.opacity = '0.6';

    wrap.append(desde, sep, hasta);
    button.parentNode.insertBefore(wrap, button);

    const persist = () => {
      let inicio = desde.value || defaultRange().inicio;
      let fin = hasta.value || defaultRange().fin;
      if (inicio > fin) {
        [inicio, fin] = [fin, inicio];
        desde.value = inicio;
        hasta.value = fin;
      }
      storeRange(inicio, fin);
    };
    desde.addEventListener('change', persist);
    hasta.addEventListener('change', persist);
  }

  function getSelectedRange() {
    const a = document.getElementById('sapRangeInicio');
    const b = document.getElementById('sapRangeFin');
    if (a?.value && b?.value) {
      let inicio = a.value, fin = b.value;
      if (inicio > fin) [inicio, fin] = [fin, inicio];
      return { inicio, fin };
    }
    return getStoredRange();
  }

  async function getStatus() {
    const r = await fetch(API_BASE + '/sync-status', { cache: 'no-store' });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || 'No se pudo consultar el estado de SAP.');
    return body;
  }

  async function startSync(inicio, fin) {
    const url = API_BASE + '/sync-sap?inicio=' + encodeURIComponent(inicio) +
      '&fin=' + encodeURIComponent(fin);
    const r = await fetch(url, { cache: 'no-store' });
    const body = await r.json().catch(() => ({}));
    if (r.status === 409) return { alreadyRunning: true, body };
    if (!r.ok) throw new Error(body.error || body.mensaje || ('SAP respondió HTTP ' + r.status));
    return { yaSincronizado: !!body.yaSincronizado, body };
  }

  async function loadDataset(inicio, fin) {
    const url = API_BASE + '/dataset?fecha_inicio=' + encodeURIComponent(inicio) +
      '&fecha_fin=' + encodeURIComponent(fin);
    const r = await fetch(url, { cache: 'no-store' });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || 'No se pudo cargar el dataset desde SAP.');
    if (!body.data) throw new Error('SAP no devolvió un dataset válido.');

    if (window.lcSet && PAGES_QUE_USAN_DATASET.has(currentPageFile())) {
      await window.lcSet('dataset', { data: body.data, inv: body.inv || {} });
    }

    window.LC_DATA = body.data;
    window.LC_INV = body.inv || {};
    window.LC_DATA_IMPORTED = true;
    window.LC_SAP_RANGE = { inicio, fin };
    window.dispatchEvent(new CustomEvent('lc:sap-updated', {
      detail: { data: body.data, inv: body.inv || {}, fechas: { inicio, fin } }
    }));
    return body;
  }

  async function waitForCompletion(button, inicio, fin) {
    let attempts = 0;
    while (attempts++ < 600) {
      const status = await getStatus();

      if (status.ejecutando) {
        const processed = Number(status.registrosProcesados || 0);
        const total = Number(status.registrosSAP || 0);
        const page = Number(status.paginaActual || 0);
        const detail = total ? ` ${processed}/${total}` : (page ? ` pág. ${page}` : '');
        setButton(button, 'SAP: sincronizando' + detail + '…', true);
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }

      if (status.estado === 'error') {
        const e = status.error || {};
        throw new Error(e.mensaje || 'La sincronización SAP terminó con error.');
      }

      setButton(button, 'SAP: cargando dashboard…', true);
      await loadDataset(inicio, fin);
      return status;
    }
    throw new Error('La sincronización está tardando demasiado. Revisa /sync-status en Render.');
  }

  async function updateFromSap() {
    const button = getButton();
    if (!button || button.dataset.sapBusy === '1') return;

    const { inicio, fin } = getSelectedRange();
    storeRange(inicio, fin);
    button.dataset.sapBusy = '1';
    const original = button.dataset.sapOriginalText || button.textContent.trim();
    setButton(button, 'SAP: iniciando…', true);

    try {
      const started = await startSync(inicio, fin);

      if (started.yaSincronizado) {
        setButton(button, 'SAP: cargando datos…', true);
        await loadDataset(inicio, fin);
      } else {
        if (started.alreadyRunning) setButton(button, 'SAP: esperando…', true);
        await waitForCompletion(button, inicio, fin);
      }

      setButton(button, '✓ SAP actualizado', false);
      setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      console.error('[SAP]', error);
      alert('No se pudo actualizar desde SAP.\n\n' + error.message);
      setButton(button, original, false);
      button.dataset.sapBusy = '0';
    }
  }

  function init() {
    const button = getButton();
    if (!button) return;
    button.title = 'Consultar SAP directamente para el rango seleccionado';
    buildRangePicker(button);
    button.addEventListener('click', updateFromSap);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
