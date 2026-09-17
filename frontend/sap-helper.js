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

  // Antes el valor por defecto era 'https://prueba-d9ro.onrender.com' (una
  // URL vieja de pruebas). El backend real de este proyecto, según
  // frontend/vercel.json, es prueba-k6t5.onrender.com — y ninguna
  // página definía window.LC_API_BASE para corregirlo, así que todos los
  // dashboards estaban intentando hablar con el backend equivocado.
  const API_BASE = (window.LC_API_BASE || 'https://prueba-d9ro.onrender.com/api').replace(/\/$/, '');

  // Rango por defecto la primera vez que alguien usa el navegador:
  // últimos 30 días. Después de eso, se respeta lo último que el usuario
  // haya elegido (persistido en localStorage).
  const DEFAULT_RANGE_DAYS = 30;
  const LS_INICIO = 'LC_SAP_RANGE_INICIO';
  const LS_FIN = 'LC_SAP_RANGE_FIN';
  // Los datos obtenidos desde SAP se conservan en el almacenamiento local
  // del navegador. Esta marca permite saber cuándo fueron actualizados por
  // última vez y mantenerlos disponibles durante al menos 7 días.
  const SAP_DATOS_VIGENCIA_DIAS = 7;
  const LS_SAP_ULTIMA_ACTUALIZACION = 'LC_SAP_ULTIMA_ACTUALIZACION';

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

  // Progreso integrado DENTRO del botón. La barra ocupa una franja en la
  // parte inferior del propio botón y el texto/contador queda encima.
  function ensureProgressIndicator(button) {
    if (!button) return null;
    let fill = button.querySelector('.lc-sap-progress-fill');
    let track = button.querySelector('.lc-sap-progress-track');
    let label = button.querySelector('.lc-sap-progress-label');
    if (fill && track && label) return { fill, track, label };

    button.style.position = button.style.position || 'relative';
    button.style.overflow = 'hidden';

    track = document.createElement('span');
    track.className = 'lc-sap-progress-track';
    track.style.position = 'absolute';
    track.style.left = '5px';
    track.style.right = '5px';
    track.style.bottom = '4px';
    track.style.height = '4px';
    track.style.borderRadius = '999px';
    track.style.background = 'rgba(255,255,255,.28)';
    track.style.overflow = 'hidden';
    track.style.zIndex = '1';
    track.style.pointerEvents = 'none';

    fill = document.createElement('span');
    fill.className = 'lc-sap-progress-fill';
    fill.style.display = 'block';
    fill.style.width = '0%';
    fill.style.height = '100%';
    fill.style.borderRadius = '999px';
    fill.style.background = '#fff';
    fill.style.transition = 'width .25s ease';
    track.appendChild(fill);

    label = document.createElement('span');
    label.className = 'lc-sap-progress-label';
    label.style.position = 'relative';
    label.style.zIndex = '2';
    label.style.display = 'inline-block';
    label.style.width = '100%';
    label.style.textAlign = 'center';
    label.style.whiteSpace = 'nowrap';
    label.style.pointerEvents = 'none';

    // Guardamos el contenido original para restaurarlo al terminar.
    if (!button.dataset.sapOriginalHTML) {
      button.dataset.sapOriginalHTML = button.innerHTML;
      button.dataset.sapOriginalText = button.textContent.trim();
    }

    // El contenido actual se reemplaza solo durante la sincronización.
    button.innerHTML = '';
    button.appendChild(label);
    button.appendChild(track);
    return { fill, track, label };
  }

  function hideProgressIndicator(button) {
    if (!button) return;
    const progress = button.querySelector('.lc-sap-progress-track');
    if (progress) progress.remove();
    button.dataset.sapProgressActive = '0';
  }

  function setProgressIndicator(button, percent, processed, total, active = true, indeterminate = false) {
    if (!button) return;
    const parts = ensureProgressIndicator(button);
    if (!parts) return;
    const pct = Math.max(0, Math.min(100, Number(percent) || 0));

    parts.track.style.display = active ? 'block' : 'none';
    if (indeterminate) {
      parts.fill.style.width = '35%';
      parts.fill.style.animation = 'lcSapProgressIndeterminate 1.1s ease-in-out infinite';
    } else {
      parts.fill.style.animation = 'none';
      parts.fill.style.width = pct + '%';
    }

    parts.label.textContent = indeterminate
      ? `SAP: ${Number(processed || 0).toLocaleString('es-CO')} registros…`
      : `SAP: ${Number(processed || 0).toLocaleString('es-CO')}/${Number(total || 0).toLocaleString('es-CO')} (${pct.toFixed(0)}%)`;
  }

  function setButton(button, text, disabled) {
    if (!button) return;
    button.dataset.sapOriginalHTML ||= button.innerHTML;
    button.dataset.sapOriginalText ||= button.textContent.trim();

    // Mientras siga siendo un estado de SAP, actualizamos solo el texto
    // central y conservamos la barra dentro del botón. Cuando llega un
    // mensaje final (✓ / error / texto normal), restauramos el botón original.
    if (button.dataset.sapProgressActive === '1' && /^SAP\s*:/i.test(text)) {
      const label = button.querySelector('.lc-sap-progress-label');
      if (label) label.textContent = text;
      button.disabled = !!disabled;
      return;
    }

    if (button.dataset.sapProgressActive === '1') {
      button.dataset.sapProgressActive = '0';
      const originalHTML = button.dataset.sapOriginalHTML;
      if (originalHTML) button.innerHTML = originalHTML;
      else button.innerHTML = text;
    } else {
      button.innerHTML = text;
    }
    button.disabled = !!disabled;
  }

  function setButtonProgress(button, text, percent, processed, total) {
    if (!button) return;
    button.dataset.sapOriginalHTML ||= button.innerHTML;
    button.dataset.sapOriginalText ||= button.textContent.trim();
    button.dataset.sapProgressActive = '1';
    button.disabled = true;
    setProgressIndicator(button, percent, processed, total, true, Number(total) <= 0);
    const parts = ensureProgressIndicator(button);
    if (parts && Number(total) > 0) {
      parts.label.textContent = text;
    }
  }

  // Estilo de la animación para el estado en el que SAP todavía no ha
  // entregado el total mediante __count.
  if (!document.getElementById('lcSapProgressStyle')) {
    const style = document.createElement('style');
    style.id = 'lcSapProgressStyle';
    style.textContent = '@keyframes lcSapProgressIndeterminate{0%{transform:translateX(-160%)}50%{transform:translateX(80%)}100%{transform:translateX(300%)}}';
    document.head.appendChild(style);
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
  // Reintentos automáticos + aviso NO bloqueante (reemplaza a alert())
  // ------------------------------------------------------------
  // Antes, un solo corte de red (o una respuesta que se quedaba "colgada"
  // sin nunca resolver ni fallar) hacía perder el resultado ya calculado
  // en Render. Dos cosas distintas pueden pasar y había que cubrir las
  // dos:
  //   1) El fetch FALLA (offline, DNS, conexión cerrada) -> se reintenta.
  //   2) El fetch NUNCA responde (se queda "colgado" sin error ni éxito,
  //      algo común en redes inestables / Render reiniciando) -> como
  //      fetch() no tiene timeout propio, antes esto se quedaba esperando
  //      indefinidamente y se sentía como "se desconectó". Ahora cada
  //      intento tiene un límite de tiempo (AbortController): si se pasa,
  //      se aborta y se cuenta como un intento fallido más, que se
  //      reintenta igual que un error de red.
  // Además se aumentó bastante la cantidad de reintentos y el tiempo
  // total que se les da (ver comentarios en cada llamada más abajo).
  const REINTENTO_ESPERA_BASE_MS = 2500;
  const REINTENTO_ESPERA_MAX_MS = 20000; // tope de espera entre reintentos: 20s

  async function fetchConTimeout(url, opciones, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...opciones, signal: controller.signal });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error('Tiempo de espera agotado consultando el servidor (' + Math.round(timeoutMs / 1000) + 's).');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // Reintenta cualquier función async: red caída, timeout (ver arriba) o
  // error 5xx del servidor (los 4xx, como fechas mal formadas, NO se
  // reintentan porque son errores reales que no se arreglan solos).
  // Mismo nombre de sesión que usa frontend/auth-guard.js. Los endpoints de
  // SAP (/sync-sap, /sync-status, /dataset, /facturacion) quedaron
  // protegidos con requiereAuth al agregar el sistema de usuarios, pero
  // este archivo nunca mandaba el token — por eso el backend respondía 401
  // (por sesión inválida, no por SAP) y el botón mostraba engañosamente
  // "SAP respondió con HTTP 401".
  const AUTH_TOKEN_KEY = 'panorama_access_token';
  function conAuthHeader(opciones) {
    let token = null;
    try { token = sessionStorage.getItem(AUTH_TOKEN_KEY); } catch (_) {}
    if (!token) return opciones;
    const headers = Object.assign({}, (opciones && opciones.headers) || {}, { Authorization: 'Bearer ' + token });
    return Object.assign({}, opciones, { headers });
  }

  async function fetchConReintentos(url, opciones, { maxIntentos = 40, timeoutMs = 25000, onReintento } = {}) {
    opciones = conAuthHeader(opciones);
    let intento = 0;
    while (true) {
      intento++;
      try {
        const response = await fetchConTimeout(url, opciones, timeoutMs);
        if (!response.ok && response.status >= 500 && intento < maxIntentos) {
          throw new Error('El servidor respondió ' + response.status + ' (temporal, se reintenta).');
        }
        return response;
      } catch (err) {
        if (intento >= maxIntentos) throw err;
        if (onReintento) onReintento(intento, maxIntentos, err);
        const espera = Math.min(REINTENTO_ESPERA_BASE_MS * intento, REINTENTO_ESPERA_MAX_MS);
        await new Promise(resolve => setTimeout(resolve, espera));
      }
    }
  }

  // Da una duración legible ("~3 min", "~1.5 h") a partir de segundos.
  function formatDuracion(segundos) {
    if (!Number.isFinite(segundos) || segundos <= 0) return 'menos de 1 min';
    if (segundos < 60) return 'menos de 1 min';
    const minutos = segundos / 60;
    if (minutos < 90) return `~${Math.max(1, Math.round(minutos))} min`;
    return `~${(minutos / 60).toFixed(1)} h`;
  }

  // Banner de aviso/tiempo estimado, junto al botón. A diferencia del
  // texto del botón (que es angosto y se corta), este banner tiene
  // espacio de sobra, así que aquí es donde se muestra el tiempo
  // estimado de forma clara y legible. Se actualiza in-place y
  // desaparece solo: nunca interrumpe al usuario ni exige un clic en
  // "Aceptar" (no es un alert()).
  function avisoSap(button, mensaje, tipo) {
    if (!button || !button.parentNode) return;
    let el = document.getElementById('lcSapAviso');
    if (!el) {
      el = document.createElement('div');
      el.id = 'lcSapAviso';
      el.style.marginTop = '6px';
      el.style.fontSize = '13px';
      el.style.fontWeight = '500';
      el.style.lineHeight = '1.45';
      el.style.maxWidth = '420px';
      button.parentNode.insertBefore(el, button.nextSibling);
    }
    el.style.color = tipo === 'error' ? '#c0392b' : (tipo === 'ok' ? '#1f8a5b' : 'var(--muted, #445)');
    el.textContent = mensaje;
    clearTimeout(el._lcSapAvisoTimer);
    if (tipo !== 'sticky') {
      el._lcSapAvisoTimer = setTimeout(() => { el.textContent = ''; }, 8000);
    }
  }

  // ------------------------------------------------------------
  // Llamadas al backend
  // ------------------------------------------------------------

  async function getStatus(jobId) {
    // Cada botón consulta el estado de SU jobId. Esto evita que el
    // progreso de otro usuario aparezca como "ya está sincronizando".
    // /sync-status es una consulta liviana. Si tarda más de 15s algo
    // anda mal con esa consulta puntual (no con SAP, que sigue corriendo
    // aparte en Render), así que se aborta y se reintenta rápido.
    const url = API_BASE + '/sync-status' + (jobId ? '?jobId=' + encodeURIComponent(jobId) : '');
    const response = await fetchConReintentos(url, { cache: 'no-store' }, { maxIntentos: 20, timeoutMs: 15000 });
    if (!response.ok) throw new Error('No se pudo consultar el estado de SAP (' + response.status + ').');
    return response.json();
  }

  async function startSync(inicio, fin) {
    const url = API_BASE + '/sync-sap?inicio=' + encodeURIComponent(inicio) + '&fin=' + encodeURIComponent(fin);
    const response = await fetchConReintentos(url, { method: 'GET', cache: 'no-store' }, { maxIntentos: 15, timeoutMs: 20000 });
    const body = await response.json().catch(() => ({}));

    if (response.status === 409) {
      return { alreadyRunning: true, body };
    }
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error(body.message || body.error || body.mensaje || 'Sesión no válida o expirada. Vuelve a iniciar sesión.');
      }
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

      // Rangos largos pueden tardar en traer cada página: se le da un
      // timeout amplio por intento y muchos reintentos antes de rendirse.
      const response = await fetchConReintentos(url, { cache: 'no-store' }, { maxIntentos: 80, timeoutMs: 40000 });
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

  async function refreshDataCache(inicio, fin, button) {
    try {
      const page = currentPageFile();
      let filas = [];

      if (PAGES_QUE_USAN_DATASET.has(page) && window.lcSet) {
        // IMPORTANTE: el dataset ya se construye en Render. Antes el navegador
        // descargaba toda /facturacion en páginas de 1000 filas y luego hacía
        // todo el procesamiento en Chrome. Eso provocaba la espera larga que
        // se veía después de que SAP terminaba.
        //
        // Este es justo el paso que antes se "desconectaba" al terminar de
        // sincronizar: un solo fetch, sin reintentos. Si la red fallaba una
        // sola vez aquí, se perdía todo el resultado ya calculado en Render.
        // Ahora usamos fetchConReintentos: si falla, reintenta solo durante
        // varios minutos (mostrando el intento en el botón, sin alert) antes
        // de rendirse.
        const url = API_BASE +
          '/dataset?fecha_inicio=' + encodeURIComponent(inicio) +
          '&fecha_fin=' + encodeURIComponent(fin);
        const response = await fetchConReintentos(url, { cache: 'no-store' }, {
          // Este es EL paso crítico que se venía "desconectando". Se le
          // da bastante margen: 45s por intento (por si el payload es
          // grande y tarda en transferirse) y hasta 150 reintentos con
          // espera creciente (tope 20s entre uno y otro) => en el peor
          // caso sigue reintentando solo, en silencio, durante cerca de
          // 45-50 minutos antes de mostrar un error real.
          maxIntentos: 150,
          timeoutMs: 45000,
          onReintento: (intento, maxIntentos) => {
            if (button) setButton(button, `SAP: cargando datos… (reintentando ${intento}/${maxIntentos})`, true);
            if (button) avisoSap(button, 'Se cortó la conexión un momento mientras se cargaban los datos. Reintentando automáticamente cada pocos segundos; no hace falta volver a darle al botón ni recargar la página.', 'sticky');
          }
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.data) {
          throw new Error(body.error || 'No se pudo cargar el dataset comercial.');
        }

        await window.lcSet('dataset', {
          data: body.data,
          inv: body.inv || {},
          sapGuardadoEn: Date.now(),
          sapVigenciaDias: SAP_DATOS_VIGENCIA_DIAS,
          sapRango: { inicio, fin }
        });
        try {
          localStorage.setItem(LS_SAP_ULTIMA_ACTUALIZACION, String(Date.now()));
        } catch (_) {}

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
        try {
          localStorage.setItem(LS_SAP_ULTIMA_ACTUALIZACION, String(Date.now()));
        } catch (_) {}
      }

      if (button) avisoSap(button, '', 'ok'); // limpia el aviso de "reintentando" si quedó visible
      window.dispatchEvent(new CustomEvent('lc:sap-updated', { detail: filas }));
    } catch (error) {
      // No ocultar errores: si falla la consulta a SAP, no debemos dejar
      // en pantalla silenciosamente el dataset viejo de IndexedDB.
      console.error('[SAP] Error cargando el rango desde /facturacion:', error);
      throw error;
    }
  }

  // IMPORTANTE: la consulta SAP puede tardar muchos minutos. El endpoint
  // /sync-sap inicia el trabajo en segundo plano en Render, por lo que el
  // navegador NO debe usar un timeout corto para decidir que SAP falló.
  // Los fallos temporales al consultar /sync-status se reintentan.
  const POLL_INTERVAL_MS = 2000;
  // Antes 60 (~2 min). Como getStatus() ya reintenta 20 veces por su
  // cuenta con timeout propio, esto es una segunda capa de tolerancia
  // por encima de esa: entre las dos, un corte de red tiene que durar
  // MUCHO (bastante más de 10-15 min seguidos) para llegar a fallar.
  const MAX_CONSECUTIVE_POLL_FAILURES = 200;
  const MAX_MS_SIN_PROGRESO = 90 * 60 * 1000; // 90 min sin avance real => posible atasco

  // Estimado "a ciegas" mientras todavía no hay suficiente avance real
  // medido para calcular una velocidad confiable (ver más abajo). Es un
  // rango conservador basado en el tamaño típico de una página de SAP;
  // se reemplaza por el estimado real apenas hay datos suficientes.
  const ESTIMADO_REGISTROS_POR_SEG_MIN = 30;
  const ESTIMADO_REGISTROS_POR_SEG_MAX = 150;

  async function waitForCompletion(button, inicio, fin, jobId) {
    let consecutiveFailures = 0;
    let lastProgressKey = null;
    let lastProgressAt = Date.now();
    const inicioEspera = Date.now();

    while (true) {
      let status;
      try {
        status = await getStatus(jobId);
        consecutiveFailures = 0;
      } catch (err) {
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
          // Ojo: esto NO significa que la sincronización en Render haya
          // fallado, solo que el navegador no logra consultar el estado.
          // Render puede seguir trabajando igual.
          throw new Error(
            'No se pudo consultar el estado de la sincronización tras varios intentos ' +
            '(posible problema de red). La sincronización puede seguir corriendo en el ' +
            'servidor; espera un momento y vuelve a intentar el botón. Detalle: ' + err.message
          );
        }
        setButton(button, 'SAP: reconectando (' + consecutiveFailures + '/' + MAX_CONSECUTIVE_POLL_FAILURES + ')…', true);
        avisoSap(button, 'Problema temporal de conexión consultando el avance. Reintentando solo, la sincronización en el servidor sigue corriendo aunque esto tarde en reconectar.', 'sticky');
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        continue;
      }

      const info = status.sincronizacion || status;
      const processed = Number(info.registrosProcesados || 0);
      const total = Number(info.registrosTotal || 0);
      const page = Number(info.paginaActual || 0);

      if (info.ejecutando) {
        const progressKey = processed + ':' + page;
        if (progressKey !== lastProgressKey) {
          lastProgressKey = progressKey;
          lastProgressAt = Date.now();
        } else if (Date.now() - lastProgressAt > MAX_MS_SIN_PROGRESO) {
          throw new Error(
            'La sincronización SAP no muestra avance desde hace varios minutos. ' +
            'Revisa /sync-status en Render para confirmar si sigue corriendo.'
          );
        }

        // Tiempo estimado restante. Con avance real medido (procesados y
        // tiempo transcurrido) se calcula la velocidad de verdad; si aún
        // no hay suficiente muestra, se muestra un rango estimado en vez
        // de dejarlo en blanco, para que siempre haya una referencia de
        // cuánto puede tardar.
        const elapsedS = (Date.now() - inicioEspera) / 1000;
        const rateReal = elapsedS >= 5 && processed > 0 ? processed / elapsedS : 0;

        let pct = 0;
        let etaTxt = '';
        let avisoTxt;
        if (total > 0) {
          pct = Math.min(100, (processed / total) * 100);
          const restantes = Math.max(0, total - processed);
          if (rateReal > 0) {
            etaTxt = `~${formatDuracion(restantes / rateReal)} restantes`;
            avisoTxt = `Sincronizando con SAP: ${processed.toLocaleString('es-CO')} de ${total.toLocaleString('es-CO')} registros (${pct.toFixed(0)}%). Tiempo estimado restante: ${formatDuracion(restantes / rateReal)}. No cierres ni recargues la página.`;
          } else {
            const minEst = restantes / ESTIMADO_REGISTROS_POR_SEG_MAX;
            const maxEst = restantes / ESTIMADO_REGISTROS_POR_SEG_MIN;
            etaTxt = `calculando tiempo…`;
            avisoTxt = `Sincronizando con SAP: ${processed.toLocaleString('es-CO')} de ${total.toLocaleString('es-CO')} registros (${pct.toFixed(0)}%). Estimado inicial: entre ${formatDuracion(minEst)} y ${formatDuracion(maxEst)} (se ajustará con el avance real). No cierres ni recargues la página.`;
          }
          setButtonProgress(button, `SAP: ${processed.toLocaleString('es-CO')}/${total.toLocaleString('es-CO')} (${pct.toFixed(0)}%) · ${etaTxt}`, pct, processed, total);
        } else {
          // Mientras SAP no entregue __count mostramos páginas procesadas
          // y un estimado muy aproximado según el tamaño típico de página.
          setButtonProgress(button, `SAP: procesando ${processed.toLocaleString('es-CO')} registros · pág. ${page}`, 0, processed, total);
          avisoTxt = `Sincronizando con SAP: ${processed.toLocaleString('es-CO')} registros procesados hasta ahora (pág. ${page}). Aún no se conoce el total exacto del rango, así que todavía no hay un tiempo estimado preciso; puede tardar desde unos minutos hasta varias horas según el volumen. No cierres ni recargues la página.`;
        }
        avisoSap(button, avisoTxt, 'sticky');

        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        continue;
      }

      if (info.estado === 'error') {
        const errorMsg = info.error?.mensaje || info.error || status.error || 'La sincronización SAP terminó con error.';
        throw new Error(errorMsg);
      }

      setProgressIndicator(button, 100, processed, Math.max(total, processed), true, false);
      setButton(button, 'SAP: cargando datos…', true);
      // Nota informativa (no bloqueante, no es alert): si los datos ya
      // quedaron listos en Render esto toma segundos; si el servidor tiene
      // que recalcularlos puede tardar varios minutos con rangos grandes.
      avisoSap(button, 'Cargando los datos ya sincronizados… normalmente toma unos segundos; con rangos grandes puede tardar unos minutos. No cierres ni recargues la página.', 'sticky');
      await refreshDataCache(inicio, fin, button);
      return status;
    }
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
        avisoSap(button, 'Trayendo los datos guardados… normalmente toma solo unos segundos.', 'sticky');
        await refreshDataCache(inicio, fin, button);
        avisoSap(button, '', 'ok');
        setButton(button, '✓ Datos ya estaban al día', true);
        setTimeout(() => {
          window.location.reload();
        }, 900);
        return;
      }

      if (started.alreadyRunning) {
        setButton(button, 'SAP: ya está sincronizando…', true);
      }
      if (!started.yaSincronizado && !started.jobId) {
        throw new Error('El servidor no devolvió el identificador de esta consulta SAP.');
      }
      // Aviso inicial de cuánto se puede demorar. La consulta a SAP se
      // hace por meses y puede tardar bastante en rangos largos; el
      // tiempo real (con estimado que se ajusta solo) se ve en el botón
      // en cuanto haya suficiente avance para calcularlo.
      avisoSap(
        button,
        'Consultando SAP para el rango elegido. Esto puede tardar desde menos de un minuto (rangos cortos) hasta varios minutos u horas en rangos muy largos. Puedes seguir usando el navegador; no hace falta quedarte mirando el botón.',
        'sticky'
      );
      await waitForCompletion(button, inicio, fin, started.jobId);
      avisoSap(button, '', 'ok');
      setButton(button, '✓ SAP actualizado', true);
      const finalStatus = await getStatus(started.jobId);
      const finalInfo = finalStatus.sincronizacion || finalStatus;
      setProgressIndicator(button, 100, Number(finalInfo.registrosProcesados || 0), Math.max(Number(finalInfo.registrosTotal || 0), Number(finalInfo.registrosProcesados || 0)), true, false);
      setTimeout(() => {
        // Recargar permite que los módulos vuelvan a inicializarse con el último estado.
        window.location.reload();
      }, 900);
    } catch (error) {
      // IMPORTANTE: ya no usamos alert(). Un alert() bloquea el hilo del
      // navegador y, peor, si la sincronización en Render sigue corriendo
      // en segundo plano, el usuario terminaba cerrando el alert y
      // perdiendo de vista que en realidad solo hubo un corte temporal de
      // red (fetchConReintentos ya intentó reconectar varios minutos antes
      // de llegar aquí, así que si cayó en este catch es porque de verdad
      // no se pudo continuar).
      console.error('[SAP]', error);
      avisoSap(button, '✕ No se pudo actualizar desde SAP: ' + error.message + ' Puedes volver a darle al botón para reintentar.', 'error');
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

  async function importExcelFile(file, resultEl, closeModal) {
    const page = currentPageFile();
    const datasetPage = PAGES_QUE_USAN_DATASET.has(page);
    if (!file) return;
    try {
      if (resultEl) resultEl.innerHTML = '<span style="color:#1f8a5b">Leyendo y procesando el Excel…</span>';
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
        resultEl.innerHTML = `<span style="color:#1f8a5b"><b>${file.name.replace(/[<>]/g,'')}</b><br>${parsed.rows.length.toLocaleString('es-CO')} filas procesadas · ${meses} mes${meses===1?'':'es'} detectado${meses===1?'':'s'}.<br>Actualizando el dashboard…</span>`;
      }
      if (closeModal) setTimeout(closeModal, 700);
      setTimeout(() => window.location.reload(), 850);
    } catch (e) {
      console.error('[EXCEL]', e);
      if (resultEl) resultEl.innerHTML = `<span style="color:#c00">✕ ${String(e.message || e).replace(/[<>]/g,'')}</span>`;
    }
  }

  // ------------------------------------------------------------
  // DISEÑO MEJORADO DE LOS IMPORTADORES DE EXCEL
  // ------------------------------------------------------------
  // Mantiene la lógica existente y solo mejora la presentación:
  // formatos admitidos, formato recomendado, instrucciones claras y
  // una zona de carga más visible sin recargar el modal.
  function enhanceExcelUploadUI() {
    const page = currentPageFile();
    const labels = {
      'planeacion-nogales.html':'Planeación Nogales',
      'panorama-produccion.html':'Panorama de Producción',
      'panorama-produccion-diaria.html':'Panorama de Producción Diaria',
      'panorama-comercial.html':'Panorama Comercial',
      'panorama-portafolio.html':'Panorama Portafolio',
      'hoja-asesor.html':'Hoja de Asesor',
      'hoja-ruta-cliente.html':'Hoja de Ruta Cliente',
      'hoja-sede.html':'Hoja de Sede',
      'hoja-despacho.html':'Hoja de Despacho',
      'costos-produccion.html':'Costos de Producción'
    };
    const label = labels[page];
    const modal = document.getElementById('lcExcelModal');
    if (!modal || !label) return;
    const title = document.getElementById('lcExcelTitle');
    const desc = document.getElementById('lcExcelDesc');
    if (title) title.textContent = 'Cargar Excel · ' + label;
    if (desc) desc.textContent = 'Selecciona el Excel de ' + label + '. El archivo se leerá en el navegador y reemplazará los datos actuales del tablero.';
  }

  function initExcelBridge() {
    // Solo intervenimos en el modal genérico que actualmente decía
    // "Listo para procesar". Si una página tiene un importador propio
    // (por ejemplo xlsModal), no lo tocamos.
    const modal = document.getElementById('lcExcelModal');
    const input = document.getElementById('lcExcelInput');
    const drop = document.getElementById('lcExcelDrop');
    const result = document.getElementById('lcExcelResult');
    const button = document.getElementById('excelBtn');
    if (!modal || !input || !drop || !button) return;
    if (document.getElementById('xlsModal') || document.getElementById('xlsInput')) return;
    if (modal.dataset.excelBridgeReady === '1') return;
    modal.dataset.excelBridgeReady = '1';

    const open = () => { modal.style.display = 'flex'; };
    const close = () => { modal.style.display = 'none'; };
    button.addEventListener('click', open);
    const x = document.getElementById('lcExcelClose');
    if (x) x.addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => {
      e.preventDefault(); drop.classList.remove('over');
      if (e.dataTransfer.files[0]) importExcelFile(e.dataTransfer.files[0], result, close);
    });
    input.addEventListener('change', () => {
      if (input.files[0]) importExcelFile(input.files[0], result, close);
    });
  }

  function init() {
    const button = getButton();
    if (!button) return;
    button.title = 'Consultar los datos de SAP para el rango de fechas elegido';
    buildRangePicker(button);
    button.addEventListener('click', updateFromSap);
    enhanceExcelUploadUI();
    initExcelBridge();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
