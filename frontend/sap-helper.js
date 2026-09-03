/* La Campana - integración del botón "Actualizar desde SAP".
   No usa Google Drive. La sincronización se ejecuta en Render y el botón
   muestra el progreso consultando /sync-status.

   Ahora incluye un selector de rango de fechas (Desde / Hasta) que se
   inserta junto al botón en todos los dashboards. Elegir un rango más
   corto hace que tanto la sincronización con SAP como la carga de datos
   en el navegador sean más rápidas, porque se consulta/trae menos
   información. El rango elegido se recuerda por navegador (localStorage). */
(function () {
  'use strict';

  // Antes el valor por defecto era 'https://prueba-k6t5.onrender.com' (una
  // URL vieja de pruebas). El backend real de este proyecto, según
  // frontend/vercel.json, es dasboard-lacampana.onrender.com — y ninguna
  // página definía window.LC_API_BASE para corregirlo, así que todos los
  // dashboards estaban intentando hablar con el backend equivocado.
  const API_BASE = (window.LC_API_BASE || 'https://prueba-k6t5.onrender.com').replace(/\/$/, '');

  // Rango por defecto la primera vez que alguien usa el navegador:
  // últimos 30 días. Después de eso, se respeta lo último que el usuario
  // haya elegido (persistido en localStorage).
  const DEFAULT_RANGE_DAYS = 30;
  const LS_INICIO = 'LC_SAP_RANGE_INICIO';
  const LS_FIN = 'LC_SAP_RANGE_FIN';

  // Tamaño de página al traer /facturacion hacia el navegador. El backend
  // acepta hasta 1000 por llamada.
  const FETCH_PAGE_SIZE = 1000;
  // Permite rangos largos (meses, años o más) sin cortar la paginación.
  // El backend devuelve el total real y el bucle se detiene cuando offset >= total.
  const FETCH_MAX_PAGES = 100000;
  // No hay un tope artificial de páginas. El total lo informa el backend
  // y el navegador sigue paginando hasta completar exactamente el rango.
  // La sincronización SAP ya está fragmentada por meses en Render.

  // hoja-asesor.html, panorama-comercial.html y panorama-portafolio.html no
  // leen datos directamente de la API: leen un único objeto ya agregado
  // (window.LC_DATA) que guardan/leen de IndexedDB bajo la clave 'dataset'
  // (ver window.lcGet/lcSet, definidos en el script compartido de storage).
  // Antes ese 'dataset' solo lo llenaba la carga manual de Excel; el botón
  // "Actualizar desde SAP" traía los datos pero los dejaba en otra variable
  // (window.LC_SAP_DATA) que ninguna pantalla leía, así que nunca se veía
  // nada tras sincronizar. Ahora construimos aquí el mismo objeto que arma
  // el importador de Excel (mismos campos: clients, months, catalog, cats,
  // metaAse, metaSede, metaGrupo, aseKg, aseKgMons, hasRent, rentGrupoMon,
  // aseRev, aseCost) a partir de las filas crudas de /facturacion, y lo
  // guardamos en la misma clave 'dataset' para que esas 3 pantallas lo vean
  // sin más cambios.
  // Páginas que consumen el dataset estructurado generado por el
  // importador de Excel. Después de SAP se genera el mismo formato.
  const PAGES_QUE_USAN_DATASET = new Set([
    'hoja-asesor.html',
    'panorama-comercial.html',
    'panorama-portafolio.html',
    'hoja-ruta-cliente.html',
    'planeacion-nogales.html'
  ]);

  function currentPageFile() {
    const path = window.location.pathname || '';
    const parts = path.split('/');
    return (parts[parts.length - 1] || '').toLowerCase() || 'index.html';
  }

  function toISODate(date) {
    return date.toISOString().slice(0, 10);
  }

  function defaultRange() {
    const hoy = new Date();
    const desde = new Date(hoy);
    desde.setDate(desde.getDate() - DEFAULT_RANGE_DAYS);
    return { inicio: toISODate(desde), fin: toISODate(hoy) };
  }

  function getStoredRange() {
    let inicio = null;
    let fin = null;
    try {
      inicio = localStorage.getItem(LS_INICIO);
      fin = localStorage.getItem(LS_FIN);
    } catch (_) {}
    if (!inicio || !fin) {
      return defaultRange();
    }
    return { inicio, fin };
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

  // ------------------------------------------------------------
  // Selector de rango de fechas (Desde / Hasta), insertado a la
  // izquierda del botón "Actualizar desde SAP".
  // ------------------------------------------------------------

  function buildRangePicker(button) {
    if (document.getElementById('sapRangeWrap')) {
      return document.getElementById('sapRangeWrap');
    }

    const range = getStoredRange();

    const wrap = document.createElement('span');
    wrap.id = 'sapRangeWrap';
    wrap.style.display = 'inline-flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '6px';
    wrap.style.marginRight = '8px';

    const mkInput = (id, value, title) => {
      const inp = document.createElement('input');
      inp.type = 'date';
      inp.id = id;
      inp.value = value;
      inp.title = title;
      inp.style.font = 'inherit';
      inp.style.padding = '8px 9px';
      inp.style.borderRadius = '8px';
      inp.style.border = '1px solid var(--line2, #d2d6db)';
      inp.style.background = 'var(--panel, #fff)';
      inp.style.color = 'var(--txt, #14161a)';
      return inp;
    };

    const desdeInput = mkInput('sapRangeInicio', range.inicio, 'Desde qué fecha consultar/sincronizar');
    const hastaInput = mkInput('sapRangeFin', range.fin, 'Hasta qué fecha consultar/sincronizar');

    const sep = document.createElement('span');
    sep.textContent = '→';
    sep.style.opacity = '0.6';
    sep.style.fontSize = '12px';

    wrap.appendChild(desdeInput);
    wrap.appendChild(sep);
    wrap.appendChild(hastaInput);

    button.parentNode.insertBefore(wrap, button);

    const persist = () => {
      let inicio = desdeInput.value || defaultRange().inicio;
      let fin = hastaInput.value || defaultRange().fin;
      if (inicio > fin) {
        // Si el usuario invierte las fechas, las corregimos solas.
        const tmp = inicio;
        inicio = fin;
        fin = tmp;
        desdeInput.value = inicio;
        hastaInput.value = fin;
      }
      storeRange(inicio, fin);
    };

    desdeInput.addEventListener('change', persist);
    hastaInput.addEventListener('change', persist);

    return wrap;
  }

  function getSelectedRange() {
    const desdeInput = document.getElementById('sapRangeInicio');
    const hastaInput = document.getElementById('sapRangeFin');
    if (desdeInput && hastaInput && desdeInput.value && hastaInput.value) {
      let inicio = desdeInput.value;
      let fin = hastaInput.value;
      if (inicio > fin) {
        const tmp = inicio;
        inicio = fin;
        fin = tmp;
      }
      return { inicio, fin };
    }
    return getStoredRange();
  }

  // ------------------------------------------------------------
  // Llamadas al backend
  // ------------------------------------------------------------

  async function getStatus() {
    const response = await fetch(API_BASE + '/sync-status', { cache: 'no-store' });
    if (!response.ok) throw new Error('No se pudo consultar el estado de SAP (' + response.status + ').');
    return response.json();
  }

  async function startSync(inicio, fin) {
    const url = API_BASE + '/sync-sap?inicio=' + encodeURIComponent(inicio) + '&fin=' + encodeURIComponent(fin);
    const response = await fetch(url, { method: 'GET', cache: 'no-store' });
    const body = await response.json().catch(() => ({}));

    if (response.status === 409) {
      return { alreadyRunning: true, body };
    }
    if (!response.ok) {
      throw new Error(body.error || body.mensaje || ('SAP respondió con HTTP ' + response.status + '.'));
    }
    // El backend ya tenía este mismo rango en su caché en memoria (ver
    // SAP_CACHE_MINUTOS en backend/app.js): no relanzó la consulta a SAP.
    if (body.yaSincronizado) {
      return { alreadyRunning: false, yaSincronizado: true, body };
    }
    return { alreadyRunning: false, body };
  }

  // Trae TODO el rango elegido paginando /facturacion (el backend limita
  // cada llamada a 1000 filas). OJO: el endpoint espera fecha_inicio /
  // fecha_fin (no inicio/fin) — antes se mandaba mal y el rango elegido
  // por el usuario se ignoraba silenciosamente.
  async function fetchFacturacionRango(inicio, fin) {
    const filas = [];
    let offset = 0;
    let total = Infinity;

    for (let pagina = 0; pagina < FETCH_MAX_PAGES && offset < total; pagina++) {
      const url = API_BASE +
        '/facturacion?fecha_inicio=' + encodeURIComponent(inicio) +
        '&fecha_fin=' + encodeURIComponent(fin) +
        '&limit=' + FETCH_PAGE_SIZE +
        '&offset=' + offset;

      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) break;

      const body = await response.json();
      const data = body.data || [];
      total = Number(body.total || data.length);

      filas.push(...data);
      offset += data.length;

      if (data.length < FETCH_PAGE_SIZE) break; // última página
    }

    return filas;
  }

  // ------------------------------------------------------------
  // Construcción del "dataset" agregado (mismo formato que arma el
  // importador de Excel en panorama-portafolio.html: función
  // rebuildRaw/handleFile → lcSet('dataset', {data, inv})). Lo replicamos
  // aquí a partir de las filas crudas de /facturacion, que ya vienen
  // tipadas (no hace falta adivinar encabezados de Excel).
  // ------------------------------------------------------------

  function ymDeFecha(v) {
    if (!v) return null;
    // fecha_factura llega como 'YYYY-MM-DD' o ISO ('YYYY-MM-DDTHH:mm:ss.sssZ').
    const s = String(v);
    return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : null;
  }

  function sucOf(ase) {
    if (!ase) return '(Sin asignar)';
    const m = ase.match(/^\s*([^-]+?)\s*-\s*\S/);
    let s = null;
    if (m) s = m[1].trim();
    else if (ase.trim().startsWith('-')) return '(Sin asignar)';
    else s = '(Otros)';
    if (/^MOSTRADOR\s*P\b/i.test(s)) return 'PALOQUEMAO';
    return s;
  }

  function modoValores(cnt) {
    // Para cada clave, el valor más frecuente visto (robusto ante datos
    // erróneos en filas sueltas) — igual que hace el importador de Excel.
    const out = {};
    for (const k in cnt) {
      let best = 0, bestCount = -1;
      const mc = cnt[k];
      for (const v in mc) {
        if (mc[v] > bestCount) { bestCount = mc[v]; best = +v; }
      }
      out[k] = best;
    }
    return out;
  }

  function buildDatasetFromFacturacion(rows) {
    const cats = [];
    const catIdx = {};
    const gi = (name) => {
      name = (name || '').toString().trim() || '(s/g)';
      if (!(name in catIdx)) { catIdx[name] = cats.length; cats.push(name); }
      return catIdx[name];
    };

    const catalog = {};
    const CLI = {};
    const getCli = (name) => {
      name = (name || '').toString().trim();
      if (!name) return null;
      if (!CLI[name]) {
        CLI[name] = {
          nit: '', ciu: '', dep: '', ase: '', plazo: '',
          cc: 0, cu: 0, am: {}, regKg: {}, rev: 0, cost: 0, rgByG: {}
        };
      }
      return CLI[name];
    };

    const metaCnt = {}, metaSedeCnt = {}, metaGrupoCnt = {};
    const aseKgM = {}; // asesor -> ym -> kg (por factura, no por cartera asignada)
    const rentGM = {}; // grupo -> {rev:{ym}, cost:{ym}, kg:{ym}}
    const aseRevM = {}, aseCostM = {};
    const fact = {}; // numero_factura -> {cli, dias, total, pag, paga}

    const allYM = new Set();

    rows.forEach((r) => {
      const name = (r.cliente || '').toString().trim();
      if (!name) return;
      const c = getCli(name);

      if (!c.nit && r.nit) c.nit = String(r.nit).trim();
      if (!c.ciu && r.ciudad) c.ciu = String(r.ciudad).trim();
      if (!c.dep && r.departamento) c.dep = String(r.departamento).trim();
      if (!c.ase && r.asesor) c.ase = String(r.asesor).trim();
      if (!c.plazo && r.plazo) c.plazo = String(r.plazo).trim();

      const ase = (r.asesor || '').toString().trim() || c.ase;
      if (ase) {
        const mv = Number(r.meta_anual_asesor) || 0;
        if (mv > 0) { const mc = metaCnt[ase] || (metaCnt[ase] = {}); mc[mv] = (mc[mv] || 0) + 1; }
        const su = sucOf(ase);
        const mvs = Number(r.meta_anual_sede) || 0;
        if (mvs > 0) { const mc = metaSedeCnt[su] || (metaSedeCnt[su] = {}); mc[mvs] = (mc[mvs] || 0) + 1; }
      }
      const grpNombre = (r.grupo || '(s/g)').toString().trim() || '(s/g)';
      const mvg = Number(r.meta_anual_grupo) || 0;
      if (mvg > 0) { const mc = metaGrupoCnt[grpNombre] || (metaGrupoCnt[grpNombre] = {}); mc[mvg] = (mc[mvg] || 0) + 1; }

      const cc = Number(r.cupo_credito) || 0;
      if (cc > c.cc) c.cc = cc;
      const cu = Number(r.cupo_usado) || 0;
      if (cu > c.cu) c.cu = cu;

      const cod = (r.codigo_articulo || '').toString().trim();
      const ym = ymDeFecha(r.fecha_factura);
      if (cod && ym) {
        allYM.add(ym);
        const gidx = gi(grpNombre);
        if (!catalog[cod]) catalog[cod] = [(r.articulo || cod).toString().trim(), gidx];
        const pu = Number(r.peso_unitario) || 0;
        if (pu && catalog[cod][2] == null) catalog[cod][2] = pu;

        const kk = Number(r.kilos) || 0;
        const am = c.am[cod] || (c.am[cod] = {});
        am[ym] = (am[ym] || 0) + kk;

        const vk = Number(r.valor_kilo) || 0;
        const ck = Number(r.costo_kilo) || 0;
        // Usar el valor total de la línea SAP para ventas cuando existe.
        // Conservamos valor/kg × kg como respaldo.
        const rev = Number(r.valor_total_articulo) || (vk * kk);
        const cost = ck * kk;
        if (rev || cost) {
          c.rev += rev; c.cost += cost;
          const rgg = c.rgByG[gidx] || (c.rgByG[gidx] = { rev: 0, cost: 0 });
          rgg.rev += rev; rgg.cost += cost;
          const gm = rentGM[grpNombre] || (rentGM[grpNombre] = { rev: {}, cost: {}, kg: {} });
          gm.rev[ym] = (gm.rev[ym] || 0) + rev;
          gm.cost[ym] = (gm.cost[ym] || 0) + cost;
          gm.kg[ym] = (gm.kg[ym] || 0) + kk;
          if (ase) {
            (aseRevM[ase] || (aseRevM[ase] = {}))[ym] = (aseRevM[ase][ym] || 0) + rev;
            (aseCostM[ase] || (aseCostM[ase] = {}))[ym] = (aseCostM[ase][ym] || 0) + cost;
          }
        }

        if (ase) {
          const k = Number(r.kilos) || 0;
          if (k) (aseKgM[ase] || (aseKgM[ase] = {}))[ym] = (aseKgM[ase][ym] || 0) + k;
        }
      }

      const numF = (r.numero_factura || '').toString().trim();
      if (numF) {
        const f = fact[numF] || (fact[numF] = { cli: name, dias: 0, total: 0, pag: 0, paga: '' });
        f.dias = Math.max(f.dias, Number(r.dias_mora) || 0);
        f.total += Number(r.valor_total_articulo) || 0;
        f.pag = Math.max(f.pag, Number(r.valor_pagado) || 0);
        const p = (r.factura_paga_total || '').toString().trim().toUpperCase();
        if (p) f.paga = p;
      }
    });

    const MONTHS = [...allYM].sort();

    const clients = {};
    for (const name in CLI) {
      const c = CLI[name];
      const a = [];
      let kg = 0;
      for (const cod in c.am) {
        const s = MONTHS.map((ym) => Math.round(c.am[cod][ym] || 0));
        const t = s.reduce((x, y) => x + y, 0);
        if (t > 0) { a.push([cod, s]); kg += t; }
      }
      if (!a.length && c.cc <= 0) continue;
      clients[name] = {
        nit: c.nit, ciu: c.ciu, dep: c.dep, ase: c.ase, plazo: c.plazo,
        cc: c.cc, cu: c.cu, kg, a, mora: [],
        rev: Math.round(c.rev || 0), cost: Math.round(c.cost || 0),
        rg: Object.entries(c.rgByG || {}).map(([g, o]) => [+g, Math.round(o.rev), Math.round(o.cost)])
      };
    }

    for (const nf in fact) {
      const f = fact[nf];
      if (f.dias > 0 && f.paga !== 'SI') {
        const pend = Math.max(0, Math.round(f.total - f.pag));
        if (pend > 0 && clients[f.cli]) clients[f.cli].mora.push([nf, Math.round(f.dias), pend]);
      }
    }

    const metaAse = modoValores(metaCnt);
    const metaSede = modoValores(metaSedeCnt);
    const metaGrupo = modoValores(metaGrupoCnt);

    const aseKg = {}, aseKgMons = {};
    for (const a in aseKgM) {
      const ser = MONTHS.map((ym) => Math.round(aseKgM[a][ym] || 0));
      const t = ser.reduce((s, v) => s + v, 0);
      if (t > 0) { aseKg[a] = t; aseKgMons[a] = ser; }
    }

    const hasRent = Object.keys(rentGM).length > 0;
    const rentGrupoMon = {};
    for (const g in rentGM) {
      const gm = rentGM[g];
      rentGrupoMon[g] = {
        rev: MONTHS.map((ym) => Math.round(gm.rev[ym] || 0)),
        cost: MONTHS.map((ym) => Math.round(gm.cost[ym] || 0)),
        kg: MONTHS.map((ym) => Math.round(gm.kg[ym] || 0))
      };
    }
    const aseRev = {}, aseCost = {};
    for (const a in aseRevM) {
      let t = 0; MONTHS.forEach((ym) => t += aseRevM[a][ym] || 0);
      if (t) aseRev[a] = Math.round(t);
    }
    for (const a in aseCostM) {
      let t = 0; MONTHS.forEach((ym) => t += aseCostM[a][ym] || 0);
      if (t) aseCost[a] = Math.round(t);
    }

    const DATA = {
      months: MONTHS, cats, catalog, clients,
      ntop: Object.keys(clients).length, pct: 100, volshare: 100,
      metaAse, metaSede, metaGrupo, aseKg, aseKgMons,
      hasRent, rentGrupoMon, aseRev, aseCost
    };

    // No traemos stock/inventario desde SAP (la tabla facturacion no lo
    // tiene), así que INV queda vacío: las secciones que dependen de stock
    // simplemente no muestran datos, en vez de romper la página.
    return { DATA, INV: {} };
  }

  async function refreshDataCache(inicio, fin) {
    try {
      const page = currentPageFile();
      let filas = [];

      if (PAGES_QUE_USAN_DATASET.has(page) && window.lcSet) {
        // IMPORTANTE: el dataset ya se construye en Render. Antes el navegador
        // descargaba toda /facturacion en páginas de 1000 filas y luego hacía
        // todo el procesamiento en Chrome. Eso provocaba la espera larga que
        // se veía después de que SAP terminaba.
        const url = API_BASE +
          '/dataset?fecha_inicio=' + encodeURIComponent(inicio) +
          '&fecha_fin=' + encodeURIComponent(fin);
        const response = await fetch(url, { cache: 'no-store' });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.data) {
          throw new Error(body.error || 'No se pudo cargar el dataset comercial.');
        }

        await window.lcSet('dataset', {
          data: body.data,
          inv: body.inv || {}
        });

        window.LC_DATA = body.data;
        window.LC_INV = body.inv || {};
        window.LC_DATA_IMPORTED = true;
        window.LC_SAP_RANGE = { inicio, fin };
      } else {
        // Los módulos que todavía necesitan las filas crudas conservan el
        // comportamiento anterior.
        filas = await fetchFacturacionRango(inicio, fin);
        window.LC_SAP_DATA = filas;
        window.LC_SAP_DATA_IMPORTED = true;
        window.LC_SAP_RANGE = { inicio, fin };
      }

      window.dispatchEvent(new CustomEvent('lc:sap-updated', { detail: filas }));
    } catch (error) {
      // No ocultar errores: si falla la consulta a SAP, no debemos dejar
      // en pantalla silenciosamente el dataset viejo de IndexedDB.
      console.error('[SAP] Error cargando el rango desde /facturacion:', error);
      throw error;
    }
  }

  async function waitForCompletion(button, inicio, fin) {
    let attempts = 0;
    while (attempts++ < 180) {
      const status = await getStatus();
      const processed = Number(status.registrosProcesados || 0);
      const total = Number(status.registrosSAP || 0);
      const page = Number(status.paginaActual || 0);

      if (status.ejecutando) {
        const detail = total > 0 ? ' ' + processed + '/' + total : (page > 0 ? ' pág. ' + page : '');
        setButton(button, 'SAP: sincronizando' + detail + '…', true);
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }

      if (status.estado === 'error') {
        throw new Error(status.error || 'La sincronización SAP terminó con error.');
      }

      setButton(button, 'SAP: cargando datos…', true);
      await refreshDataCache(inicio, fin);
      return status;
    }
    throw new Error('La sincronización está tardando más de lo esperado. Revisa /sync-status en Render.');
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
        // Ya está en el caché en memoria del backend: no hay nada que
        // esperar, solo traer los datos y refrescar la pantalla con ellos.
        setButton(button, 'SAP: cargando datos guardados…', true);
        await refreshDataCache(inicio, fin);
        setButton(button, '✓ Datos ya estaban al día', true);
        setTimeout(() => {
          window.location.reload();
        }, 900);
        return;
      }

      if (started.alreadyRunning) {
        setButton(button, 'SAP: ya está sincronizando…', true);
      }
      await waitForCompletion(button, inicio, fin);
      setButton(button, '✓ SAP actualizado', true);
      setTimeout(() => {
        // Recargar permite que los módulos vuelvan a inicializarse con el último estado.
        window.location.reload();
      }, 900);
    } catch (error) {
      console.error('[SAP]', error);
      alert('No se pudo actualizar desde SAP.\n\n' + error.message);
      setButton(button, original, false);
      button.dataset.sapBusy = '0';
    }
  }

  // ------------------------------------------------------------
  // IMPORTACIÓN MANUAL DE EXCEL
  // ------------------------------------------------------------
  // Las páginas ya traen su botón/modal "Cargar Excel". Este puente solo
  // conecta ese control con el mismo formato de datos que usa el dashboard.
  // No crea botones nuevos.

  let xlsxPromise = null;
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (xlsxPromise) return xlsxPromise;
    xlsxPromise = new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      tag.onload = () => window.XLSX ? resolve(window.XLSX) : reject(new Error('SheetJS no quedó disponible.'));
      tag.onerror = () => reject(new Error('No se pudo cargar el lector de Excel. Revisa la conexión a internet.'));
      document.head.appendChild(tag);
    });
    return xlsxPromise;
  }

  function normalizarEncabezado(v) {
    return String(v == null ? '' : v)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function numeroExcel(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    let s = String(v).trim().replace(/\s/g, '');
    if (!s) return 0;
    // 1.234.567,89 / 1234567,89 / 1234567.89
    if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
    else if (s.includes(',')) s = s.replace(',', '.');
    const n = Number(s.replace(/[^0-9+\-.]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  function fechaExcel(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number' && window.XLSX && XLSX.SSF) {
      const d = XLSX.SSF.parse_date_code(v);
      if (d && d.y && d.m && d.d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
    }
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
    let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (m) return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
    m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0,10);
  }

  const EXCEL_ALIASES = {
    fecha_factura: ['fecha factura','fecha de factura','fecha','date'],
    numero_factura: ['numero factura','n factura','no factura','nro factura','factura'],
    cliente: ['cliente','nombre cliente','razon social','nombre del cliente'],
    nit: ['nit','documento','identificacion'],
    ciudad: ['ciudad','municipio'],
    departamento: ['departamento','depto'],
    asesor: ['asesor','nombre asesor','vendedor'],
    plazo: ['plazo','dias plazo','dias credito'],
    cupo_credito: ['cupo credito','cupo de credito','cupo'],
    cupo_usado: ['cupo usado','cupo utilizado'],
    codigo_articulo: ['codigo articulo','codigo de articulo','codigo producto','cod articulo','codigo'],
    articulo: ['articulo','descripcion articulo','producto','descripcion producto'],
    grupo: ['grupo','grupo producto','categoria'],
    peso_unitario: ['peso unitario','peso unitario kg','peso'],
    kilos: ['kilos','kg','kilogramos','cantidad kg','cantidad kilos'],
    valor_kilo: ['valor kilo','valor por kilo','precio kilo'],
    costo_kilo: ['costo kilo','costo por kilo'],
    valor_total_articulo: ['valor total articulo','valor total','total articulo','total venta','venta total'],
    valor_pagado: ['valor pagado','pagado','pago'],
    factura_paga_total: ['factura paga total','factura pagada','paga','pagada'],
    dias_mora: ['dias mora','dias de mora','mora'],
    meta_anual_asesor: ['meta anual asesor','meta asesor'],
    meta_anual_sede: ['meta anual sede','meta sede'],
    meta_anual_grupo: ['meta anual grupo','meta grupo']
  };

  function buscarColumna(headers, aliases) {
    const wanted = aliases.map(normalizarEncabezado);
    return headers.findIndex(h => wanted.includes(h));
  }

  function convertirFilasExcel(rows) {
    if (!rows.length) return [];
    const originalHeaders = Object.keys(rows[0]);
    const headers = originalHeaders.map(normalizarEncabezado);
    const indices = {};
    for (const [campo, aliases] of Object.entries(EXCEL_ALIASES)) {
      const i = buscarColumna(headers, aliases);
      if (i >= 0) indices[campo] = originalHeaders[i];
    }

    const get = (row, campo) => indices[campo] ? row[indices[campo]] : '';
    const out = rows.map(row => ({
      fecha_factura: fechaExcel(get(row,'fecha_factura')),
      numero_factura: String(get(row,'numero_factura') ?? '').trim(),
      cliente: String(get(row,'cliente') ?? '').trim(),
      nit: String(get(row,'nit') ?? '').trim(),
      ciudad: String(get(row,'ciudad') ?? '').trim(),
      departamento: String(get(row,'departamento') ?? '').trim(),
      asesor: String(get(row,'asesor') ?? '').trim(),
      plazo: String(get(row,'plazo') ?? '').trim(),
      cupo_credito: numeroExcel(get(row,'cupo_credito')),
      cupo_usado: numeroExcel(get(row,'cupo_usado')),
      codigo_articulo: String(get(row,'codigo_articulo') ?? '').trim(),
      articulo: String(get(row,'articulo') ?? '').trim(),
      grupo: String(get(row,'grupo') ?? '').trim(),
      peso_unitario: numeroExcel(get(row,'peso_unitario')),
      kilos: numeroExcel(get(row,'kilos')),
      valor_kilo: numeroExcel(get(row,'valor_kilo')),
      costo_kilo: numeroExcel(get(row,'costo_kilo')),
      valor_total_articulo: numeroExcel(get(row,'valor_total_articulo')),
      valor_pagado: numeroExcel(get(row,'valor_pagado')),
      factura_paga_total: String(get(row,'factura_paga_total') ?? '').trim(),
      dias_mora: numeroExcel(get(row,'dias_mora')),
      meta_anual_asesor: numeroExcel(get(row,'meta_anual_asesor')),
      meta_anual_sede: numeroExcel(get(row,'meta_anual_sede')),
      meta_anual_grupo: numeroExcel(get(row,'meta_anual_grupo'))
    })).filter(r => r.cliente && (r.fecha_factura || r.codigo_articulo || r.kilos));

    return { rows: out, headers: originalHeaders, mapped: Object.keys(indices) };
  }

  // Importador específico de Planeación Nogales. Esta página no usa el
  // dataset de facturación de Portafolio/Cartera: su formato es referencia
  // + descripción + grupo + meses, o referencia + fecha + kilos.
  function normNogales(v) {
    return String(v == null ? '' : v).normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  }
  function numNogales(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    let s=String(v).trim().replace(/\s/g,'');
    if (s.includes(',') && s.includes('.')) s=s.replace(/\./g,'').replace(',','.');
    else if (s.includes(',')) s=s.replace(',','.');
    const n=Number(s.replace(/[^0-9+\-.]/g,''));
    return Number.isFinite(n) ? n : 0;
  }
  function ymNogales(v) {
    if (typeof v === 'number' && window.XLSX && XLSX.SSF) {
      const d=XLSX.SSF.parse_date_code(v);
      if(d&&d.y&&d.m) return d.y+'-'+String(d.m).padStart(2,'0');
    }
    if (v instanceof Date && !isNaN(v)) return v.getFullYear()+'-'+String(v.getMonth()+1).padStart(2,'0');
    const s=String(v==null?'':v).trim();
    let m=s.match(/^(\d{4})[-\/]?(\d{1,2})(?:[-\/]\d{1,2})?/);
    if(m) return m[1]+'-'+String(m[2]).padStart(2,'0');
    m=s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
    if(m) return m[3]+'-'+String(m[2]).padStart(2,'0');
    return '';
  }
  function monthNogales(h) {
    const n=normNogales(h);
    const names={ene:1,enero:1,feb:2,febrero:2,mar:3,marzo:3,abr:4,abril:4,may:5,mayo:5,jun:6,junio:6,jul:7,julio:7,ago:8,agosto:8,sep:9,sept:9,septiembre:9,oct:10,octubre:10,nov:11,noviembre:11,dic:12,diciembre:12};
    for(const k in names) if(new RegExp('(^| )'+k+'( |$)').test(n)) return names[k];
    const m=n.match(/(?:^| )(\d{1,2})(?: |$)/);
    return m && +m[1]>=1 && +m[1]<=12 ? +m[1] : 0;
  }
  function headerMonthNogales(h) {
    const n=normNogales(h); const y=(n.match(/\b(20\d{2})\b/)||[])[1]; const mo=monthNogales(n);
    return mo ? (y || String(new Date().getFullYear()))+'-'+String(mo).padStart(2,'0') : '';
  }
  function findNogales(headers, aliases) {
    const a=aliases.map(normNogales); return headers.findIndex(h=>a.includes(h));
  }
  function buildNogales(rows) {
    if(!rows.length) return null;
    const original=Object.keys(rows[0]), headers=original.map(normNogales);
    const codeI=findNogales(headers,['codigo','codigo articulo','codigo producto','cod','referencia','referencia producto','sku']);
    const descI=findNogales(headers,['descripcion','descripcion articulo','producto','articulo','nombre producto']);
    const grpI=findNogales(headers,['grupo','grupo producto','categoria','familia']);
    const dateI=findNogales(headers,['fecha','fecha factura','mes','periodo','date']);
    const kgI=findNogales(headers,['kilos','kg','kilogramos','cantidad kg','cantidad kilos','peso vendido']);
    const monthCols=original.map((h,i)=>[headerMonthNogales(h),i]).filter(x=>x[0]);
    if(codeI<0) return null;
    const articles={}, monthSet=new Set();
    if(monthCols.length){
      rows.forEach(r=>{
        const code=String(r[original[codeI]]??'').trim(); if(!code)return;
        const desc=String(descI>=0?r[original[descI]]||code:code).trim()||code;
        const grp=String(grpI>=0?r[original[grpI]]||'(s/g)':'(s/g)').trim()||'(s/g)';
        if(!articles[code]) articles[code]={d:desc,g:grp,m:{}};
        monthCols.forEach(([ym,i])=>{ const v=numNogales(r[original[i]]); if(v!==0 || String(r[original[i]]??'')==='0'){ articles[code].m[ym]=(articles[code].m[ym]||0)+v; monthSet.add(ym); } });
      });
    } else if(dateI>=0 && kgI>=0) {
      rows.forEach(r=>{
        const code=String(r[original[codeI]]??'').trim(), date=ymNogales(r[original[dateI]]); if(!code||!date)return;
        const desc=String(descI>=0?r[original[descI]]||code:code).trim()||code;
        const grp=String(grpI>=0?r[original[grpI]]||'(s/g)':'(s/g)').trim()||'(s/g)';
        if(!articles[code]) articles[code]={d:desc,g:grp,m:{}};
        articles[code].m[date]=(articles[code].m[date]||0)+numNogales(r[original[kgI]]); monthSet.add(date);
      });
    } else return null;
    const months=[...monthSet].sort(), out={months,articles:{}};
    Object.entries(articles).forEach(([code,a])=>{const vals=months.map(m=>Math.round(a.m[m]||0)); if(vals.some(v=>v!==0)) out.articles[code]={d:a.d,g:a.g,m:vals};});
    return Object.keys(out.articles).length ? out : null;
  }
  async function importNogalesExcelFile(file, resultEl, closeModal) {
    try {
      if(!/\.(xlsx|xls|csv)$/i.test(file.name)) throw new Error('Selecciona un archivo Excel .xlsx, .xls o .csv.');
      if(resultEl) resultEl.innerHTML='⏳ Leyendo el Excel de Planeación Nogales…';
      const XLSXLib=await loadXLSX(), buffer=await file.arrayBuffer();
      const wb=XLSXLib.read(buffer,{type:'array',cellDates:true});
      if(!wb.SheetNames.length) throw new Error('El archivo no contiene hojas.');
      const raw=XLSXLib.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:'',raw:true});
      const out=buildNogales(raw); if(!out) throw new Error('No pude identificar el formato. Usa columnas de Código/Referencia + meses, o Código/Referencia + Fecha + Kilos.');
      localStorage.setItem('LC_NOGALES_EXCEL_DATA',JSON.stringify(out));
      window.LC_NOGALES=out; window.__NOGALES_EXCEL_LOADED=true;
      if(resultEl) resultEl.innerHTML=`✓ <b>${file.name.replace(/[<>]/g,'')}</b><br>${Object.keys(out.articles).length.toLocaleString('es-CO')} referencias · ${out.months.length} meses cargados.<br><span style="color:#1f8a5b">Datos de Planeación Nogales actualizados.</span>`;
      if(closeModal) setTimeout(closeModal,700);
      setTimeout(()=>window.location.reload(),850);
    } catch(e) {
      console.error('[NOGALES EXCEL]',e);
      if(resultEl) resultEl.innerHTML=`<span style="color:#c00">✕ ${String(e.message||e).replace(/[<>]/g,'')}</span>`;
    }
  }

  async function importExcelFile(file, resultEl, closeModal) {
    const page = currentPageFile();
    if(page === 'planeacion-nogales.html') return importNogalesExcelFile(file,resultEl,closeModal);
    const datasetPage = PAGES_QUE_USAN_DATASET.has(page);
    if (!file) return;
    try {
      if (resultEl) resultEl.innerHTML = '⏳ Leyendo y procesando el Excel…';
      const XLSXLib = await loadXLSX();
      const buffer = await file.arrayBuffer();
      const wb = XLSXLib.read(buffer, { type:'array', cellDates:false });
      if (!wb.SheetNames.length) throw new Error('El archivo no contiene hojas.');
      // Usamos la primera hoja. Los Excel de cada módulo pueden tener hojas
      // adicionales, pero la primera es la exportación principal.
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSXLib.utils.sheet_to_json(sheet, { defval:'', raw:true });
      if (!raw.length) throw new Error('La primera hoja está vacía.');
      const parsed = convertirFilasExcel(raw);
      if (!parsed.rows.length) throw new Error('No pude identificar filas de datos. Revisa que el Excel tenga Cliente, Fecha y datos de artículo/venta.');

      const built = buildDatasetFromFacturacion(parsed.rows);
      if (window.lcSet) {
        await window.lcSet('dataset', { data: built.DATA, inv: built.INV });
      }
      window.LC_DATA = built.DATA;
      window.LC_INV = built.INV;
      window.LC_DATA_IMPORTED = true;
      window.LC_SAP_DATA = parsed.rows;
      window.LC_SAP_DATA_IMPORTED = true;
      window.LC_EXCEL_NAME = file.name;
      window.LC_EXCEL_RANGE = {
        inicio: built.DATA.months[0] ? built.DATA.months[0] + '-01' : '',
        fin: built.DATA.months.length ? built.DATA.months[built.DATA.months.length-1] + '-31' : ''
      };

      // El evento permite a módulos que ya tienen listener refrescar sin
      // perder el estado. Después recargamos para que todos los módulos que
      // inicializan su dataset al arrancar vean el Excel nuevo.
      window.dispatchEvent(new CustomEvent('lc:excel-updated', {
        detail: { fileName:file.name, rows:parsed.rows, data:built.DATA }
      }));

      const meses = built.DATA.months.length;
      if (resultEl) {
        resultEl.innerHTML = `✓ <b>${file.name.replace(/[<>]/g,'')}</b><br>${parsed.rows.length.toLocaleString('es-CO')} filas procesadas · ${meses} mes${meses===1?'':'es'} detectado${meses===1?'':'s'}.<br><span style="color:#1f8a5b">Actualizando el dashboard…</span>`;
      }
      if (closeModal) setTimeout(closeModal, 700);
      setTimeout(() => window.location.reload(), 850);
    } catch (e) {
      console.error('[EXCEL]', e);
      if (resultEl) resultEl.innerHTML = `<span style="color:#c00">✕ ${String(e.message || e).replace(/[<>]/g,'')}</span>`;
    }
  }

  function ensureNogalesExcelModal() {
    // Planeación Nogales puede llegar a ejecutarse dentro del documento
    // reconstruido por el bundler. En ese caso el modal que está dentro del
    // template puede no quedar montado en el DOM. Lo creamos aquí de forma
    // segura, igual que un modal normal, para que el botón siempre funcione.
    if (document.getElementById('lcExcelModal')) return document.getElementById('lcExcelModal');
    const modal = document.createElement('div');
    modal.id = 'lcExcelModal';
    modal.className = 'modal noprint';
    modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:99999;align-items:center;justify-content:center;background:rgba(0,0,0,.38);padding:18px;box-sizing:border-box';
    modal.innerHTML = `
      <div class="box" style="max-width:760px;width:min(760px,92vw);background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.25)">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #ddd">
          <h3 id="lcExcelTitle" style="margin:0;font-family:Arial,sans-serif;color:#172033">Cargar Excel · Planeación Nogales</h3>
          <button id="lcExcelClose" type="button" style="border:0;background:#f1f3f6;border-radius:10px;width:38px;height:38px;font-size:24px;cursor:pointer">×</button>
        </div>
        <div style="padding:22px;font-family:Arial,sans-serif">
          <p id="lcExcelDesc" style="margin:0 0 16px;color:#666;line-height:1.55">Sube el archivo Excel para reemplazar los datos de esta página.</p>
          <div id="lcExcelDrop" style="border:2px dashed #ccd2d8;border-radius:14px;min-height:150px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;cursor:pointer;text-align:center;color:#666">
            <div style="font-size:32px">📊</div>
            <div><b>Selecciona el archivo Excel</b></div>
            <small>Haz clic aquí o arrastra un archivo .xlsx, .xls o .csv</small>
            <button type="button" id="lcExcelChoose" style="border:0;border-radius:9px;background:#e10600;color:#fff;padding:9px 18px;font-weight:700;cursor:pointer">ELEGIR ARCHIVO</button>
          </div>
          <input type="file" id="lcExcelInput" accept=".xlsx,.xls,.csv" style="display:none">
          <div id="lcExcelResult" style="margin-top:14px;font-size:13px;color:#666"></div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    return modal;
  }

  function initExcelBridge() {
    const button = document.getElementById('excelBtn');
    if (!button) return false;
    // Siempre aseguramos que exista el apartado de carga antes de enlazar el botón.
    const modal = ensureNogalesExcelModal();
    const input = document.getElementById('lcExcelInput');
    const drop = document.getElementById('lcExcelDrop');
    const result = document.getElementById('lcExcelResult');
    if (!modal || !input || !drop) return false;
    if (document.getElementById('xlsModal') || document.getElementById('xlsInput')) return true;
    if (modal.dataset.excelBridgeReady === '1') return true;
    modal.dataset.excelBridgeReady = '1';

    const open = () => { modal.style.display = 'flex'; modal.setAttribute('aria-hidden','false'); };
    const close = () => { modal.style.display = 'none'; modal.setAttribute('aria-hidden','true'); };
    button.addEventListener('click', open);
    const x = document.getElementById('lcExcelClose');
    if (x) x.addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    drop.addEventListener('click', (e) => { if (e.target && e.target.id === 'lcExcelChoose') return; input.click(); });
    const choose = document.getElementById('lcExcelChoose');
    if (choose) choose.addEventListener('click', (e) => { e.stopPropagation(); input.click(); });
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => {
      e.preventDefault(); drop.classList.remove('over');
      if (e.dataTransfer.files[0]) importExcelFile(e.dataTransfer.files[0], result, close);
    });
    input.addEventListener('change', () => {
      if (input.files[0]) importExcelFile(input.files[0], result, close);
    });
    return true;
  }

  function watchExcelBridge() {
    if (window.__LC_EXCEL_BRIDGE_WATCHING) return;
    window.__LC_EXCEL_BRIDGE_WATCHING = true;
    const tryInit = () => { if (initExcelBridge()) {
      // Keep watching because the bundler may replace the document again on navigation.
    }};
    tryInit();
    const observer = new MutationObserver(tryInit);
    observer.observe(document, {childList:true, subtree:true});
    window.setTimeout(tryInit, 100);
    window.setTimeout(tryInit, 500);
    window.setTimeout(tryInit, 1500);
  }

  function init() {
    watchExcelBridge();
    const button = getButton();
    if (!button) return;
    button.title = 'Consultar los datos de SAP para el rango de fechas elegido';
    buildRangePicker(button);
    if (!button.dataset.sapBridgeReady) {
      button.dataset.sapBridgeReady = '1';
      button.addEventListener('click', updateFromSap);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
