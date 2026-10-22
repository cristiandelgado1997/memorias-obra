/* ================= Memorias de Obra · app sin conexión ================= */
'use strict';
const VERSION = '1.0.0';
const DEF_UBIC = ['ALOJAMIENTO GENERAL', 'BAÑO GENERAL', 'CUBIERTA', 'FACHADA', 'TANQUE ELEVADO'];

/* ---------- Almacenamiento local (IndexedDB) ---------- */
const DB = (() => {
  let p = null;
  const open = () => p || (p = new Promise((res, rej) => {
    const r = indexedDB.open('memorias-obra', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('medidas', { keyPath: 'id' });
      d.createObjectStore('fotos');
      d.createObjectStore('outbox', { keyPath: 'k', autoIncrement: true });
      d.createObjectStore('kv');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const run = async (store, mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode); const st = t.objectStore(store);
      let out; const r = fn(st); if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  };
  return {
    get: (s, k) => run(s, 'readonly', (st) => st.get(k)),
    all: (s) => run(s, 'readonly', (st) => st.getAll()),
    put: (s, v, k) => run(s, 'readwrite', (st) => (k === undefined ? st.put(v) : st.put(v, k))),
    del: (s, k) => run(s, 'readwrite', (st) => st.delete(k)),
  };
})();

/* ---------- Estado ---------- */
const S = {
  medidas: {}, cfg: { proyecto: {}, subs: [], ubic: [], tipos: {}, extras: [], presupuesto: null },
  outbox: [], conn: { url: '', clave: '' }, nombre: '', ultimoPull: 0,
  tab: 'items', q: '', syncing: false, syncErr: '', online: navigator.onLine, ultimaSync: 0,
};
const hoy = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fmt = (x, d = 2) => (Math.round(x * 100) / 100).toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uidGen = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const $ = (s, el = document) => el.querySelector(s);
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

const defProyecto = { contrato: '', objeto: '', contratista: '', supervisor: '', elaboro: '', reviso: '', admin: 0, imprev: 0, util: 0, iva: 0.19 };
const P = () => Object.assign({}, defProyecto, S.cfg.proyecto || {});
const filasBase = () => (S.cfg.presupuesto && S.cfg.presupuesto.filas) || [];
const allRows = () => S.cfg.extras.length ? filasBase().concat([{ t: 'h', num: 'NP', txt: 'ÍTEMS NO PREVISTOS' }], S.cfg.extras.map((x) => Object.assign({ t: 'i' }, x))) : filasBase();
const items = () => allRows().filter((x) => x.t === 'i');
const itemBy = (cod) => items().find((x) => x.cod === cod);
const tipoDe = (cod) => S.cfg.tipos[cod] || tipoPorUnidad((itemBy(cod) || {}).und);
const pendientes = () => new Set(S.outbox.filter((o) => o.tipo === 'medida').map((o) => o.id));
const vivas = () => Object.values(S.medidas).filter((m) => !m.borrado);

/* ---------- Escritura local + cola ---------- */
async function encolar(op) {
  // Para config, solo cuenta el último cambio
  if (op.tipo === 'config' || op.tipo === 'medida') {
    const viejos = S.outbox.filter((o) => o.tipo === op.tipo && o.id === op.id);
    for (const v of viejos) await DB.del('outbox', v.k);
    S.outbox = S.outbox.filter((o) => !viejos.includes(o));
  }
  const k = await DB.put('outbox', op);
  op.k = k; S.outbox.push(op);
  programarSync(1500);
}
async function guardarMedida(m, borrar) {
  const d = Object.assign({}, m);
  if (borrar) d.borrado = true;
  S.medidas[d.id] = d;
  await DB.put('medidas', d);
  const sub = S.cfg.subs.find((s) => s.id === d.sub);
  const data = Object.assign({}, d, { subNombre: sub ? sub.nombre : '' });
  delete data.thumbs; delete data.borrado;
  await encolar({ tipo: 'medida', id: d.id, data, borrado: !!borrar });
}
async function guardarConfig(clave, valor) {
  S.cfg[clave] = valor;
  await DB.put('kv', S.cfg, 'cfg');
  await encolar({ tipo: 'config', id: clave, data: { v: valor } });
  render();
}
async function guardarFoto(fid, data, medida, item) {
  await DB.put('fotos', data, fid);
  await encolar({ tipo: 'foto', id: fid, medida, item });
}

/* ---------- Sincronización con Google ---------- */
let tSync = null;
function programarSync(ms) { clearTimeout(tSync); tSync = setTimeout(sync, ms); }
async function llamar(body, ms = 45000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(S.conn.url, { method: 'POST', body: JSON.stringify(Object.assign({ clave: S.conn.clave }, body)), signal: ctl.signal, redirect: 'follow' });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error === 'clave' ? 'La clave de conexión no coincide con la del servidor.' : (j.error || 'Error del servidor'));
    return j;
  } finally { clearTimeout(t); }
}
async function sync() {
  clearTimeout(tSync);
  if (S.syncing || !S.conn.url) { pintarSync(); return; }
  if (!navigator.onLine) { S.online = false; pintarSync(); programarSync(30000); return; }
  S.syncing = true; pintarSync();
  try {
    // 1. Subir cola: datos en lotes, fotos de a una
    while (S.outbox.length) {
      const lote = [];
      const foto = S.outbox.find((o) => o.tipo === 'foto');
      const datos = S.outbox.filter((o) => o.tipo !== 'foto').slice(0, 40);
      if (datos.length) lote.push(...datos);
      else if (foto) {
        const data = await DB.get('fotos', foto.id);
        lote.push(Object.assign({}, foto, { data: data || '' }));
      }
      const r = await llamar({ accion: 'push', ops: lote }, foto && !datos.length ? 90000 : 45000);
      const hechos = new Set(r.hecho);
      for (const o of lote) if (hechos.has(o.k)) await DB.del('outbox', o.k);
      S.outbox = S.outbox.filter((o) => !hechos.has(o.k));
      pintarSync();
    }
    // 2. Bajar cambios de los demás
    const r = await llamar({ accion: 'pull', desde: S.ultimoPull });
    const pend = pendientes();
    for (const m of r.medidas) {
      if (pend.has(m.id)) continue;
      const loc = S.medidas[m.id] || {};
      const d = Object.assign({}, m.data, { id: m.id, borrado: m.borrado, thumbs: loc.thumbs || {} });
      S.medidas[m.id] = d; await DB.put('medidas', d);
    }
    const pendCfg = new Set(S.outbox.filter((o) => o.tipo === 'config').map((o) => o.id));
    for (const [k, v] of Object.entries(r.config || {})) if (!pendCfg.has(k) && v && 'v' in v) S.cfg[k] = v.v;
    await DB.put('kv', S.cfg, 'cfg');
    S.ultimoPull = r.ahora; await DB.put('kv', S.ultimoPull, 'ultimoPull');
    S.syncErr = ''; S.online = true; S.ultimaSync = Date.now();
    renderRemoto();
  } catch (e) {
    S.syncErr = e && e.name === 'AbortError' ? 'La conexión está muy lenta; se reintentará.' : (e instanceof TypeError ? 'Sin señal; se reintentará.' : String(e.message || e));
    if (e instanceof TypeError || (e && e.name === 'AbortError')) S.online = false;
  } finally {
    S.syncing = false; pintarSync();
    programarSync(S.outbox.length ? 30000 : 90000);
  }
}
addEventListener('online', () => { S.online = true; sync(); });
addEventListener('offline', () => { S.online = false; pintarSync(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });

function pintarSync() {
  const el = $('#sync'); if (!el) return;
  const n = S.outbox.length;
  el.className = 'pill';
  if (!S.conn.url) { el.classList.add('off'); el.textContent = n ? `${n} en el celular` : 'Sin servidor'; return; }
  if (S.syncing) { el.classList.add('wait'); el.textContent = n ? `Subiendo ${n}…` : 'Actualizando…'; return; }
  if (!S.online || !navigator.onLine) { el.classList.add('wait'); el.textContent = n ? `Sin señal · ${n} por subir` : 'Sin señal'; return; }
  if (S.syncErr) { el.classList.add('off'); el.textContent = 'Error'; return; }
  if (n) { el.classList.add('wait'); el.textContent = `${n} por subir`; return; }
  el.textContent = 'Sincronizado';
}

/* ---------- Fotos ---------- */
function leerImagen(file) {
  return new Promise((res, rej) => { const img = new Image(); const url = URL.createObjectURL(file); img.onload = () => { URL.revokeObjectURL(url); res(img); }; img.onerror = rej; img.src = url; });
}
function aJpeg(img, max, q, sello) {
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, c.width, c.height);
  if (sello) {
    const fs = Math.max(14, Math.round(c.width / 40));
    g.font = `600 ${fs}px Arial, sans-serif`;
    const h = fs * 1.6 * sello.length + fs * 0.6;
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, c.height - h, c.width, h);
    g.fillStyle = '#fff';
    sello.forEach((t, i) => g.fillText(t, fs * 0.6, c.height - h + fs * 1.4 + i * fs * 1.6));
  }
  return c.toDataURL('image/jpeg', q);
}
async function procesarFoto(file, sello) {
  const img = await leerImagen(file);
  let max = 1280, q = 0.62, data = aJpeg(img, max, q, sello);
  while (data.length > 300000 && max > 600) { max -= 160; q = Math.max(0.45, q - 0.04); data = aJpeg(img, max, q, sello); }
  return { data, thumb: aJpeg(img, 160, 0.5) };
}
async function fotoCompleta(fid) {
  const local = await DB.get('fotos', fid);
  if (local) return local;
  if (!S.conn.url || !navigator.onLine) return null;
  try { const r = await llamar({ accion: 'foto', id: fid }, 60000); await DB.put('fotos', r.data, fid); return r.data; } catch (e) { return null; }
}

/* ---------- Librería de Excel (se carga cuando se necesita) ---------- */
let pExcel = null;
function cargarExcel() {
  if (window.ExcelJS) return Promise.resolve();
  return pExcel || (pExcel = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'exceljs.min.js'; s.onload = res; s.onerror = () => { pExcel = null; rej(new Error('No se pudo cargar el generador de Excel')); }; document.head.appendChild(s); }));
}

/* ================= Render ================= */
document.querySelectorAll('nav.tabs button').forEach((b) => b.addEventListener('click', () => {
  S.tab = b.dataset.tab; document.querySelectorAll('nav.tabs button').forEach((x) => x.setAttribute('aria-current', x === b)); render(); scrollTo(0, 0);
}));
function renderRemoto() {
  const ae = document.activeElement;
  const escribiendo = ae && $('#main').contains(ae) && /INPUT|TEXTAREA|SELECT/.test(ae.tagName) && ae.id !== 'q';
  if (S.tab === 'ajustes' || escribiendo) { if (S.sheetRender) S.sheetRender(); pintarSync(); return; }
  render();
}
function render() {
  const main = $('#main');
  const p = P();
  $('#hdrSub').textContent = p.contratista || 'Memorias de obra';
  $('#hdrTitle').textContent = S.nombre ? 'Hola, ' + S.nombre.split(' ')[0] : 'Memorias de cálculo';
  if (S.tab === 'items') renderItems(main);
  else if (S.tab === 'regs') renderRegs(main);
  else if (S.tab === 'export') renderExport(main);
  else renderAjustes(main);
  if (S.sheetRender) S.sheetRender();
  pintarSync();
}

function totalesPorItem() {
  const t = {};
  for (const m of vivas()) t[m.item] = (t[m.item] || 0) + calcMedida(tipoDe(m.item), m);
  return t;
}

function renderItems(main) {
  if (!filasBase().length) {
    main.innerHTML = `<div class="empty"><b>Aún no hay presupuesto cargado.</b><br><br>${S.conn.url ? 'Si alguien ya lo cargó, toca <b>Sincronizar</b> en Ajustes cuando tengas señal.' : 'Primero conecta la app con el servidor en <b>Ajustes</b>.'}<br>El director lo carga una sola vez desde Ajustes → <b>Presupuesto</b>, eligiendo el Excel del contrato.</div>`;
    return;
  }
  const tot = totalesPorItem();
  const q = S.q.trim().toLowerCase();
  if (!$('#q', main)) {
    main.innerHTML = `<input class="search" id="q" type="search" placeholder="Buscar ítem: 2,1,5 · estuco · tubería…" autocomplete="off"><div id="itemsList"></div>`;
    $('#q', main).value = S.q;
    $('#q', main).addEventListener('input', (e) => { S.q = e.target.value; renderItems(main); });
  }
  let h = '', pend = [], n = 0;
  for (const x of allRows()) {
    if (x.t === 'h') {
      const lvl = (x.num || '').split('.').length;
      if (x.num && lvl === 1) pend = [];
      pend.push(`<div class="cap ${x.num && lvl === 1 ? 'l1' : ''}">${x.num ? `<span class="num">${esc(x.num)}</span>` : ''}<span>${esc(x.txt)}</span></div>`);
      continue;
    }
    if (q && !(x.cod.toLowerCase().includes(q) || x.desc.toLowerCase().includes(q))) continue;
    h += pend.join(''); pend = []; n++;
    const t = tot[x.cod] || 0; const pct = x.cant ? t / x.cant : 0;
    h += `<button class="it" type="button" data-cod="${esc(x.cod)}">
      <div><div class="cod">${esc(x.cod)}</div><div class="und">${esc(x.und)}</div></div>
      <div class="d">${esc(x.desc)}</div>
      <div class="bar"><span class="track"><i class="${pct > 1 ? 'over' : ''}" style="width:${Math.min(100, pct * 100).toFixed(1)}%"></i></span><span class="num">${fmt(t)} / ${fmt(x.cant)}</span></div>
    </button>`;
  }
  if (!n) h = `<div class="empty" style="margin-top:14px">Ningún ítem coincide con “${esc(S.q)}”.</div>`;
  const L = $('#itemsList', main); L.className = 'list'; L.innerHTML = h;
  L.querySelectorAll('.it').forEach((b) => b.addEventListener('click', () => abrirItem(b.dataset.cod)));
}

function filaMedida(m, conItem, pend) {
  const tipo = tipoDe(m.item); const v = calcMedida(tipo, m); const it = itemBy(m.item) || {};
  const T = TIPOS[tipo]; const dims = [];
  ['a', 'b', 'c', 'n'].forEach((k, i) => { if (T.f[i] && m[k] !== '' && m[k] != null) dims.push(`${T.f[i].split(' ')[0].toLowerCase()} ${m[k]}`); });
  const sub = m.sub ? (S.cfg.subs.find((s) => s.id === m.sub) || {}).nombre : '';
  const thumbs = Object.values(m.thumbs || {});
  const nf = (m.fotos || []).length;
  return `<button class="med" type="button" data-id="${esc(m.id)}">
    <div class="t">${conItem ? `<span class="num">${esc(m.item)}</span> · ` : ''}${esc(m.elem || 'Sin elemento')} ${m.desc ? '<span class="tag desc">Descuento</span>' : ''} ${pend.has(m.id) ? '<span class="tag">Sin subir</span>' : ''}</div>
    <div class="v ${v < 0 ? 'neg' : ''}">${fmt(v)} <small>${esc(it.und || '')}</small></div>
    <div class="m"><span>${esc((m.ubic || '').toUpperCase())}</span><span class="num">${esc(dims.join(' · '))}</span><span>${esc(m.fecha || '')}</span>${sub ? `<span>Sub: ${esc(sub)}</span>` : ''}${m.autor ? `<span>${esc(m.autor)}</span>` : ''}${nf && !thumbs.length ? `<span>📷 ${nf}</span>` : ''}</div>
    ${thumbs.length ? `<div class="thumbs">${thumbs.slice(0, 5).map((t) => `<img src="${t}" alt="">`).join('')}</div>` : ''}
  </button>`;
}

function renderRegs(main) {
  const ms = vivas().sort((a, b) => (b.editado || b.creado || 0) - (a.editado || a.creado || 0));
  if (!ms.length) { main.innerHTML = `<div class="empty">Aún no hay medidas registradas.<br>Abre un ítem en <b>Ítems</b> y toca <b>Agregar medida</b>.</div>`; return; }
  const pend = pendientes();
  main.innerHTML = `<div class="hint" style="margin-bottom:10px">${ms.length} medidas registradas, las más recientes primero.</div><div class="list">${ms.slice(0, 200).map((m) => filaMedida(m, true, pend)).join('')}</div>`;
  main.querySelectorAll('.med').forEach((b) => b.addEventListener('click', () => { const m = S.medidas[b.dataset.id]; abrirMedida(m.item, m); }));
}

/* ---------- Hoja: ítem ---------- */
function cerrarHoja() { $('#layer').innerHTML = ''; S.sheetRender = null; render(); }
function abrirItem(cod) {
  S.sheetRender = () => pintarItem(cod);
  $('#layer').innerHTML = `<div class="sheet" id="sheetItem"></div><button class="fab" type="button" id="fabAdd"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>Agregar medida</button>`;
  $('#fabAdd').addEventListener('click', () => abrirMedida(cod, null));
  pintarItem(cod);
}
function pintarItem(cod) {
  const el = $('#sheetItem'); if (!el) return;
  const it = itemBy(cod); if (!it) { cerrarHoja(); return; }
  const tipo = tipoDe(cod);
  const ms = vivas().filter((m) => m.item === cod).sort((a, b) => (a.ubic || '').localeCompare(b.ubic || '') || (b.creado || 0) - (a.creado || 0));
  const tot = ms.reduce((s, m) => s + calcMedida(tipo, m), 0);
  const grupos = {}; ms.forEach((m) => { const k = (m.ubic || 'SIN UBICACIÓN').toUpperCase(); grupos[k] = (grupos[k] || 0) + calcMedida(tipo, m); });
  const dif = tot - it.cant;
  const pend = pendientes();
  const scroll = el.scrollTop;
  el.innerHTML = `<div class="bar gut"><button class="iconbtn" type="button" id="back" aria-label="Volver"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 5l-7 7 7 7"/></svg></button><h2><span class="num">${esc(cod)}</span> · ${esc(it.und)}</h2></div>
  <div class="content gut">
    <div class="card">
      <details><summary>Descripción del ítem</summary><p class="desc">${esc(it.desc)}</p></details>
      <div class="stats" style="margin-top:12px">
        <div class="stat"><b>${fmt(tot)}</b><span>Medido</span></div>
        <div class="stat"><b>${fmt(it.cant)}</b><span>Contrato</span></div>
        <div class="stat"><b style="color:${dif > 0 ? 'var(--warn)' : 'var(--ink)'}">${dif > 0 ? '+' : ''}${fmt(dif)}</b><span>${dif > 0 ? 'Mayor cant.' : 'Por ejecutar'}</span></div>
      </div>
    </div>
    <label class="f">Forma de medir este ítem
      <select id="tipoSel">${Object.entries(TIPOS).map(([k, t]) => `<option value="${k}" ${k === tipo ? 'selected' : ''}>${t.nom}</option>`).join('')}</select>
    </label>
    ${Object.keys(grupos).length ? `<div class="card">${Object.entries(grupos).map(([k, v]) => `<div class="grp"><span>${esc(k)}</span><b class="num">${fmt(v)}</b></div>`).join('')}</div>` : ''}
    ${ms.length ? `<div class="list">${ms.map((m) => filaMedida(m, false, pend)).join('')}</div>` : `<div class="empty">Sin medidas todavía. Toca <b>Agregar medida</b> para registrar la primera.</div>`}
  </div>`;
  el.scrollTop = scroll;
  $('#back', el).addEventListener('click', cerrarHoja);
  $('#tipoSel', el).addEventListener('change', (e) => guardarConfig('tipos', Object.assign({}, S.cfg.tipos, { [cod]: e.target.value })));
  el.querySelectorAll('.med').forEach((b) => b.addEventListener('click', () => abrirMedida(cod, S.medidas[b.dataset.id])));
}

/* ---------- Hoja: medida ---------- */
function abrirMedida(cod, m) {
  const it = itemBy(cod); const tipo = tipoDe(cod); const T = TIPOS[tipo];
  const nuevo = !m;
  const last = S.ultima || {};
  const d = m ? JSON.parse(JSON.stringify(m)) : { id: uidGen(), item: cod, ubic: last.ubic || '', elem: '', a: '', b: '', c: '', n: '', desc: false, fecha: last.fecha || hoy(), sub: last.sub || '', obs: '', fotos: [], thumbs: {} };
  d.thumbs = d.thumbs || {}; d.fotos = d.fotos || [];
  const nuevasFotos = {}; const quitadas = [];
  const prevSheet = S.sheetRender;
  const host = document.createElement('div'); host.className = 'sheet'; host.style.zIndex = 50;
  $('#layer').appendChild(host);
  const fab = $('#fabAdd'); if (fab) fab.hidden = true;
  const ubics = [...new Set([...S.cfg.ubic, ...vivas().map((x) => (x.ubic || '').toUpperCase()), ...DEF_UBIC].filter(Boolean))];
  const campo = (k, i) => {
    if (!T.f[i]) return '';
    if (tipo === 'ACERO' && k === 'c') return `<label class="f">Barra<select id="f_c"><option value="">—</option>${Object.keys(BARRAS).map((b) => `<option ${d.c === b ? 'selected' : ''}>${b}</option>`).join('')}</select></label>`;
    const suf = k === 'n' ? '' : (tipo === 'ACERO' && k === 'b') ? '' : ' (m)';
    return `<label class="f">${esc(T.f[i].charAt(0) + T.f[i].slice(1).toLowerCase())}${suf}<input class="n" id="f_${k}" inputmode="decimal" placeholder="${k === 'n' ? '1' : '0.00'}" value="${esc(d[k] ?? '')}"></label>`;
  };
  host.innerHTML = `<div class="bar gut"><button class="iconbtn" type="button" id="mBack" aria-label="Cerrar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 6l12 12M18 6L6 18"/></svg></button><h2>${nuevo ? 'Nueva medida' : 'Editar medida'} · <span class="num">${esc(cod)}</span></h2></div>
  <form class="content gut" id="mForm" novalidate>
    <div class="hint">${esc(it.desc.slice(0, 120))}${it.desc.length > 120 ? '…' : ''}</div>
    <label class="f">Ubicación<input id="f_ubic" list="dlUbic" autocomplete="off" placeholder="Ej. ALOJAMIENTO PRETAC" value="${esc(d.ubic)}"></label>
    <datalist id="dlUbic">${ubics.map((u) => `<option value="${esc(u)}">`).join('')}</datalist>
    <label class="f">Elemento / eje / referencia<input id="f_elem" autocomplete="off" placeholder="${tipo === 'ACERO' ? 'Ej. Zapata parrilla inferior' : tipo === 'UND' ? 'Ej. Luminarias' : 'Ej. Muro eje 2'}" value="${esc(d.elem)}"></label>
    <div class="grid2">${campo('a', 0)}${campo('b', 1)}${campo('c', 2)}${campo('n', 3)}</div>
    <label class="toggle"><input type="checkbox" id="f_desc" ${d.desc ? 'checked' : ''}> Es un descuento (vano, puerta, ventana)</label>
    <div class="result" id="res"><span>Resultado</span><b>0.00 ${esc(it.und)}</b></div>
    <div class="grid2">
      <label class="f">Fecha<input type="date" id="f_fecha" value="${esc(d.fecha)}"></label>
      <label class="f">Subcontratista<select id="f_sub"><option value="">Ninguno</option>${S.cfg.subs.map((s) => `<option value="${esc(s.id)}" ${d.sub === s.id ? 'selected' : ''}>${esc(s.nombre)}</option>`).join('')}</select></label>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px"><span style="font-size:13px;font-weight:600;color:var(--muted)">Fotos de soporte</span>
      <div class="photos" id="phs"></div>
      <input type="file" id="f_foto" accept="image/*" multiple hidden>
    </div>
    <label class="f">Observación<textarea id="f_obs" rows="2" placeholder="Opcional">${esc(d.obs)}</textarea></label>
    <div class="actions">
      ${nuevo ? '<button class="btn" type="button" id="saveMore">Guardar y otra</button>' : '<button class="btn danger" type="button" id="del">Eliminar</button>'}
      <button class="btn pri" type="submit">Guardar</button>
    </div>
    <div id="delConfirm"></div>
  </form>`;
  const leer = () => {
    ['ubic', 'elem', 'a', 'b', 'c', 'n', 'fecha', 'sub', 'obs'].forEach((k) => { const e = $('#f_' + k, host); if (e) d[k] = e.value; });
    d.ubic = (d.ubic || '').trim().toUpperCase(); d.desc = $('#f_desc', host).checked;
    ['a', 'b', 'n'].forEach((k) => { if (typeof d[k] === 'string') d[k] = d[k].replace(',', '.').trim(); });
    if (tipo !== 'ACERO' && typeof d.c === 'string') d.c = d.c.replace(',', '.').trim();
  };
  const recalcular = () => {
    leer(); const v = calcMedida(tipo, d);
    const r = $('#res', host); r.classList.toggle('neg', v < 0); r.querySelector('b').textContent = fmt(v) + ' ' + it.und;
  };
  const pintarFotos = () => {
    const ph = $('#phs', host);
    const sinThumb = d.fotos.filter((f) => !d.thumbs[f]);
    ph.innerHTML = Object.entries(d.thumbs).map(([fid, t]) => `<div class="ph"><img src="${t}" alt="Foto" data-fid="${fid}"><button type="button" class="x" data-fid="${fid}" aria-label="Quitar foto">×</button></div>`).join('') +
      sinThumb.map((fid) => `<div class="ph"><button type="button" class="addph" data-ver="${fid}">Ver foto</button><button type="button" class="x" data-fid="${fid}" aria-label="Quitar foto">×</button></div>`).join('') +
      `<button type="button" class="addph" id="addph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>Tomar foto</button>`;
    $('#addph', host).addEventListener('click', () => $('#f_foto', host).click());
    ph.querySelectorAll('.x').forEach((b) => b.addEventListener('click', () => { const f = b.dataset.fid; delete d.thumbs[f]; d.fotos = d.fotos.filter((x) => x !== f); if (nuevasFotos[f]) delete nuevasFotos[f]; else quitadas.push(f); pintarFotos(); }));
    const ver = async (f) => { const src = nuevasFotos[f] || await fotoCompleta(f); if (src) verFoto(src); else toast('La foto aún no está en este celular. Ábrela cuando tengas señal.'); };
    ph.querySelectorAll('img').forEach((im) => im.addEventListener('click', () => ver(im.dataset.fid)));
    ph.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', () => ver(b.dataset.ver)));
  };
  pintarFotos();
  $('#f_foto', host).addEventListener('change', async (e) => {
    leer();
    const sello = [`${cod} · ${d.ubic || ''} · ${d.elem || ''}`.slice(0, 70), `${new Date().toLocaleString('es-CO')} · ${S.nombre || ''}`];
    for (const file of e.target.files) {
      try { const r = await procesarFoto(file, sello); const fid = uidGen(); nuevasFotos[fid] = r.data; d.thumbs[fid] = r.thumb; d.fotos.push(fid); } catch (err) { toast('No se pudo leer esa imagen.'); }
    }
    e.target.value = ''; pintarFotos();
  });
  host.querySelectorAll('input,select').forEach((e) => e.addEventListener('input', recalcular));
  const cb = $('#f_c', host);
  if (cb) cb.addEventListener('change', () => { if (BARRAS[cb.value]) $('#f_b', host).value = BARRAS[cb.value]; recalcular(); });
  recalcular();
  const cerrar = () => { host.remove(); const f = $('#fabAdd'); if (f) f.hidden = false; S.sheetRender = prevSheet; render(); };
  $('#mBack', host).addEventListener('click', cerrar);
  const guardar = async (seguir) => {
    leer();
    if (!d.ubic) { toast('Escribe la ubicación.'); $('#f_ubic', host).focus(); return; }
    const v = calcMedida(tipo, d);
    if (v === 0) { toast('Faltan medidas: el resultado es 0.'); return; }
    const raras = ['a', 'b', 'c'].filter((k) => tipo !== 'ACERO' && Number(d[k]) > 150);
    if (raras.length && !host.dataset.okRaro) { host.dataset.okRaro = '1'; toast('Hay una medida mayor a 150 m. Revisa la coma; si está bien, toca Guardar otra vez.'); return; }
    for (const [fid, data] of Object.entries(nuevasFotos)) await guardarFoto(fid, data, d.id, cod);
    for (const fid of quitadas) await encolar({ tipo: 'fotoDel', id: fid });
    const body = { id: d.id, item: cod, ubic: d.ubic, elem: (d.elem || '').trim(), a: d.a, b: d.b, c: d.c, n: d.n, desc: d.desc, fecha: d.fecha || hoy(), sub: d.sub || '', obs: (d.obs || '').trim(), fotos: d.fotos, thumbs: d.thumbs, autor: d.autor || S.nombre || '', creado: d.creado || Date.now(), editado: Date.now(), editadoPor: S.nombre || '' };
    await guardarMedida(body, false);
    S.ultima = { ubic: d.ubic, fecha: d.fecha, sub: d.sub };
    toast(navigator.onLine && S.conn.url ? 'Medida guardada' : 'Guardada en el celular · se subirá con señal');
    cerrar();
    if (seguir) abrirMedida(cod, null);
  };
  $('#mForm', host).addEventListener('submit', (e) => { e.preventDefault(); guardar(false); });
  const sm = $('#saveMore', host); if (sm) sm.addEventListener('click', () => guardar(true));
  const del = $('#del', host);
  if (del) del.addEventListener('click', () => {
    $('#delConfirm', host).innerHTML = `<div class="note bad" style="display:flex;gap:10px;align-items:center;justify-content:space-between">¿Eliminar esta medida y sus fotos? <button type="button" class="btn danger" id="delYes">Sí, eliminar</button></div>`;
    $('#delYes', host).addEventListener('click', async () => {
      for (const f of d.fotos) await encolar({ tipo: 'fotoDel', id: f });
      await guardarMedida(Object.assign({}, m, { editado: Date.now(), editadoPor: S.nombre || '' }), true);
      toast('Medida eliminada'); cerrar();
    });
  });
  setTimeout(() => { if (nuevo) { const f = $(d.ubic ? '#f_elem' : '#f_ubic', host); if (f) f.focus(); } }, 60);
}
function verFoto(src) {
  const v = document.createElement('div'); v.className = 'viewer'; v.innerHTML = `<img src="${src}" alt="Foto de soporte">`;
  v.addEventListener('click', () => v.remove()); document.body.appendChild(v);
}
let toastT;
function toast(t) { let el = $('.toast'); if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); } el.textContent = t; clearTimeout(toastT); toastT = setTimeout(() => el.remove(), 3200); }

/* ---------- Entregar archivos ---------- */
async function entregarArchivo(blob, nombre) {
  const file = new File([blob], nombre, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  return { file, url: URL.createObjectURL(file) };
}

/* ---------- Exportar ---------- */
const EX = { mode: 'balance', desde: '', hasta: hoy(), actaNo: 1, sub: '', fotos: true, busy: false, msg: '', archivo: null };
function medidasExport() {
  return vivas().filter((m) => (!EX.hasta || (m.fecha || '') <= EX.hasta) && (EX.mode === 'balance' || !EX.desde || (m.fecha || '') >= EX.desde) && (EX.mode !== 'corte' || m.sub === EX.sub));
}
function renderExport(main) {
  const subs = S.cfg.subs;
  if (EX.mode === 'corte' && !subs.find((s) => s.id === EX.sub) && subs[0]) EX.sub = subs[0].id;
  const ms = medidasExport();
  const itemsCon = [...new Set(ms.map((m) => m.item))];
  const sub = subs.find((s) => s.id === EX.sub);
  let precios = '';
  if (EX.mode === 'corte' && sub && itemsCon.length) {
    precios = `<div class="card"><div style="font-weight:700;margin-bottom:6px">Precios pactados con ${esc(sub.nombre)}</div><div class="hint">Se guardan para los próximos cortes.</div><div class="scroll"><table class="table"><thead><tr><th>Ítem</th><th>Cant.</th><th>Valor unitario</th></tr></thead><tbody>${itemsCon.map((cod) => { const it = itemBy(cod) || {}; const q = ms.filter((m) => m.item === cod).reduce((s, m) => s + calcMedida(tipoDe(cod), m), 0); return `<tr><td><b class="num">${esc(cod)}</b><div class="hint">${esc((it.desc || '').slice(0, 60))}…</div></td><td class="num">${fmt(q)} ${esc(it.und || '')}</td><td><input inputmode="decimal" data-cod="${esc(cod)}" value="${esc((sub.precios || {})[cod] ?? '')}" placeholder="0"></td></tr>`; }).join('')}</tbody></table></div></div>`;
  }
  const faltan = EX.fotos ? ms.flatMap((m) => m.fotos || []).length : 0;
  main.innerHTML = `<div class="content" style="padding:0">
    <div class="seg" role="group" aria-label="Tipo de documento">
      ${[['balance', 'Balance'], ['acta', 'Acta parcial'], ['corte', 'Corte sub.']].map(([k, t]) => `<button type="button" data-m="${k}" aria-pressed="${EX.mode === k}">${t}</button>`).join('')}
    </div>
    <div class="hint">${EX.mode === 'balance' ? 'Anexo No. 1 con cantidades replanteadas, mayores y menores cantidades y AIU, más una memoria por ítem con todo lo medido hasta la fecha.' : EX.mode === 'acta' ? 'Acta con cantidades anteriores, de este periodo y acumuladas. Las memorias incluyen solo lo medido en el periodo.' : 'Corte para un subcontratista: solo sus medidas del periodo, con los precios pactados con él.'}</div>
    <div class="card" style="display:flex;flex-direction:column;gap:12px">
      ${EX.mode === 'corte' ? (subs.length ? `<label class="f">Subcontratista<select id="exSub">${subs.map((s) => `<option value="${esc(s.id)}" ${s.id === EX.sub ? 'selected' : ''}>${esc(s.nombre)}</option>`).join('')}</select></label>` : `<div class="note">Primero agrega tus subcontratistas en <b>Ajustes</b>.</div>`) : ''}
      ${EX.mode !== 'balance' ? `<div class="grid3"><label class="f">No.<input class="n" id="exNo" inputmode="numeric" value="${esc(EX.actaNo)}"></label><label class="f">Desde<input type="date" id="exDesde" value="${esc(EX.desde)}"></label><label class="f">Hasta<input type="date" id="exHasta" value="${esc(EX.hasta)}"></label></div>` : `<label class="f">Medidas hasta<input type="date" id="exHasta" value="${esc(EX.hasta)}"></label>`}
      <label class="toggle"><input type="checkbox" id="exFotos" ${EX.fotos ? 'checked' : ''} style="accent-color:var(--accent)"> Incluir fotos en las memorias</label>
      <div class="hint"><b class="num">${ms.length}</b> medidas en <b class="num">${itemsCon.length}</b> ítems entran en este documento${faltan ? ` · ${faltan} fotos (las de otros celulares se descargan, necesita señal)` : ''}.</div>
    </div>
    ${precios}
    <button class="btn pri" type="button" id="exGo" ${EX.busy || !ms.length || (EX.mode === 'corte' && !sub) ? 'disabled' : ''}>${EX.busy ? 'Generando…' : 'Generar Excel'}</button>
    ${EX.archivo ? `<div class="card" style="display:flex;flex-direction:column;gap:10px"><b>${esc(EX.archivo.file.name)}</b><div class="actions"><a class="btn pri" href="${EX.archivo.url}" download="${esc(EX.archivo.file.name)}" style="text-align:center;text-decoration:none">Descargar</a>${navigator.canShare && navigator.canShare({ files: [EX.archivo.file] }) ? '<button class="btn" type="button" id="exShare">Compartir</button>' : ''}</div></div>` : ''}
    ${EX.msg ? `<div class="note ${EX.msgKind || ''}">${esc(EX.msg)}</div>` : ''}
  </div>`;
  main.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => { EX.mode = b.dataset.m; EX.msg = ''; EX.archivo = null; render(); }));
  const bind = (id, k) => { const e = $('#' + id, main); if (e) e.addEventListener('change', () => { EX[k] = e.type === 'checkbox' ? e.checked : e.value; EX.archivo = null; render(); }); };
  bind('exSub', 'sub'); bind('exNo', 'actaNo'); bind('exDesde', 'desde'); bind('exHasta', 'hasta'); bind('exFotos', 'fotos');
  main.querySelectorAll('input[data-cod]').forEach((inp) => inp.addEventListener('change', () => {
    guardarConfig('subs', S.cfg.subs.map((s) => s.id === EX.sub ? Object.assign({}, s, { precios: Object.assign({}, s.precios, { [inp.dataset.cod]: num(inp.value) }) }) : s));
  }));
  $('#exGo', main).addEventListener('click', exportar);
  const sh = $('#exShare', main);
  if (sh) sh.addEventListener('click', async () => { try { await navigator.share({ files: [EX.archivo.file], title: EX.archivo.file.name }); } catch (e) {} });
}
async function exportar() {
  EX.busy = true; EX.msg = ''; EX.archivo = null; render();
  try {
    await cargarExcel();
    const ms = medidasExport();
    const fotos = {}; let sinFoto = 0;
    if (EX.fotos) {
      const ids = ms.flatMap((m) => m.fotos || []);
      let i = 0;
      const worker = async () => { while (i < ids.length) { const f = ids[i++]; const dd = await fotoCompleta(f); if (dd) fotos[f] = dd; else sinFoto++; } };
      await Promise.all([worker(), worker(), worker()]);
    }
    const anteriores = {};
    if (EX.mode === 'acta' && EX.desde) for (const m of vivas()) if ((m.fecha || '') < EX.desde) anteriores[m.item] = (anteriores[m.item] || 0) + calcMedida(tipoDe(m.item), m);
    const sub = S.cfg.subs.find((s) => s.id === EX.sub);
    const wb = buildWorkbook(ExcelJS, { mode: EX.mode, proyecto: P(), rows: allRows(), medidas: ms, fotos, tipos: Object.fromEntries(items().map((x) => [x.cod, tipoDe(x.cod)])), actaNo: EX.actaNo, desde: EX.desde, hasta: EX.hasta, anteriores, subNombre: sub ? sub.nombre : '', subPrecios: sub ? sub.precios : {} });
    const buf = await wb.xlsx.writeBuffer();
    const nombre = (EX.mode === 'balance' ? 'BALANCE' : EX.mode === 'acta' ? 'ACTA_' + EX.actaNo : 'CORTE_' + EX.actaNo + '_' + (sub ? sub.nombre : '')).replace(/[^\wÑñ-]+/g, '_') + '_' + (EX.hasta || hoy()) + '.xlsx';
    EX.archivo = await entregarArchivo(new Blob([buf]), nombre);
    EX.msg = sinFoto ? `Listo. ${sinFoto} fotos no se pudieron traer (sin señal); genera de nuevo con señal para incluirlas.` : 'Listo. Descárgalo o compártelo por WhatsApp o correo.';
    EX.msgKind = sinFoto ? '' : 'ok';
  } catch (e) { EX.msg = 'Error al generar el Excel: ' + (e && e.message || e); EX.msgKind = 'bad'; }
  EX.busy = false; render();
}

/* ---------- Ajustes ---------- */
function enlaceInvitacion() {
  const cfg = btoa(unescape(encodeURIComponent(JSON.stringify({ u: S.conn.url, k: S.conn.clave }))));
  return location.origin + location.pathname.replace(/index\.html$/, '') + '#conectar=' + cfg;
}
function renderAjustes(main) {
  const p = P();
  const n = vivas().length;
  main.innerHTML = `<div class="content" style="padding:0">
    <div class="card" style="display:flex;flex-direction:column;gap:10px">
      <div style="font-weight:700">Conexión con Google Drive</div>
      ${S.conn.url ? `<div class="note ${S.syncErr ? 'bad' : 'ok'}">${S.syncErr ? esc(S.syncErr) : S.ultimaSync ? 'Conectado. Última sincronización: ' + new Date(S.ultimaSync).toLocaleTimeString('es-CO') : 'Conectado.'}</div>` : '<div class="note">Sin conexión configurada: lo que registres queda solo en este celular.</div>'}
      <label class="f">Tu nombre<input id="c_nombre" value="${esc(S.nombre)}" placeholder="Ej. Juan Pérez · Inspector"></label>
      <label class="f">Dirección del servidor<input id="c_url" value="${esc(S.conn.url)}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"></label>
      <label class="f">Clave<input id="c_clave" value="${esc(S.conn.clave)}" autocomplete="off"></label>
      <div class="actions"><button class="btn pri" type="button" id="c_save">Guardar conexión</button><button class="btn" type="button" id="c_sync" ${S.conn.url ? '' : 'disabled'}>Sincronizar ahora</button></div>
      ${S.conn.url ? `<div class="hint">Enlace para tu personal: lo abren una vez y la app queda conectada.</div><div class="inline"><input id="c_link" readonly value="${esc(enlaceInvitacion())}"><button class="btn" type="button" id="c_copy">Copiar</button></div>` : ''}
    </div>
    <div class="card" style="display:flex;flex-direction:column;gap:10px">
      <div style="font-weight:700">Presupuesto del contrato</div>
      <div class="hint">${filasBase().length ? `${items().length} ítems cargados${S.cfg.presupuesto.hoja ? ' desde la hoja “' + esc(S.cfg.presupuesto.hoja) + '”' : ''}.` : 'Aún no hay presupuesto.'} Elige el Excel del contrato: la app busca la hoja con ítem, descripción, unidad, cantidad y valor unitario. Mejor hacerlo desde un computador.</div>
      <input type="file" id="pres_file" accept=".xlsx,.xlsm" hidden>
      <button class="btn" type="button" id="pres_btn">${filasBase().length ? 'Reemplazar presupuesto' : 'Cargar presupuesto desde Excel'}</button>
      <div id="pres_msg"></div>
    </div>
    <div class="card" style="display:flex;flex-direction:column;gap:10px">
      <div style="font-weight:700">Datos del proyecto (encabezados del Excel)</div>
      <label class="f">Contrato No.<input id="p_contrato" value="${esc(p.contrato)}" placeholder="Ej. 123-2026"></label>
      <label class="f">Objeto<textarea id="p_objeto" rows="3">${esc(p.objeto)}</textarea></label>
      <label class="f">Contratista<input id="p_contratista" value="${esc(p.contratista)}"></label>
      <label class="f">Supervisor / interventor<input id="p_supervisor" value="${esc(p.supervisor)}"></label>
      <div class="grid2"><label class="f">Elaboró<input id="p_elaboro" value="${esc(p.elaboro)}"></label><label class="f">Revisó<input id="p_reviso" value="${esc(p.reviso)}"></label></div>
      <div class="grid2"><label class="f">Administración %<input class="n" id="p_admin" inputmode="decimal" value="${esc(r2(p.admin * 100))}"></label><label class="f">Imprevistos %<input class="n" id="p_imprev" inputmode="decimal" value="${esc(r2(p.imprev * 100))}"></label><label class="f">Utilidad %<input class="n" id="p_util" inputmode="decimal" value="${esc(r2(p.util * 100))}"></label><label class="f">IVA s/ utilidad %<input class="n" id="p_iva" inputmode="decimal" value="${esc(r2(p.iva * 100))}"></label></div>
      <button class="btn pri" type="button" id="p_save">Guardar datos</button>
    </div>
    <div class="card" style="display:flex;flex-direction:column;gap:10px">
      <div style="font-weight:700">Subcontratistas</div>
      <div class="chips">${S.cfg.subs.map((s) => `<span class="chip">${esc(s.nombre)}<button type="button" data-del-sub="${esc(s.id)}" aria-label="Quitar ${esc(s.nombre)}">×</button></span>`).join('') || '<span class="hint">Aún no hay subcontratistas.</span>'}</div>
      <div class="inline"><input id="subNew" placeholder="Nombre del subcontratista"><button class="btn" type="button" id="subAdd">Agregar</button></div>
    </div>
    <div class="card" style="display:flex;flex-direction:column;gap:10px">
      <div style="font-weight:700">Ubicaciones frecuentes</div>
      <div class="chips">${S.cfg.ubic.map((u) => `<span class="chip">${esc(u)}<button type="button" data-del-ubic="${esc(u)}" aria-label="Quitar">×</button></span>`).join('') || '<span class="hint">Se sugieren también las que ya se usaron.</span>'}</div>
      <div class="inline"><input id="ubicNew" placeholder="Ej. ALOJAMIENTO CHARLIE PISO 2"><button class="btn" type="button" id="ubicAdd">Agregar</button></div>
    </div>
    <div class="card" style="display:flex;flex-direction:column;gap:10px">
      <div style="font-weight:700">Ítem no previsto (NP)</div>
      <div class="grid2"><label class="f">Código<input id="np_cod" placeholder="NP-12"></label><label class="f">Unidad<select id="np_und">${['M2', 'M3', 'ML', 'KG', 'UND', 'GL'].map((u) => `<option>${u}</option>`).join('')}</select></label></div>
      <label class="f">Descripción<textarea id="np_desc" rows="2"></textarea></label>
      <div class="grid2"><label class="f">Cantidad aprobada<input class="n" id="np_cant" inputmode="decimal" placeholder="0"></label><label class="f">Valor unitario<input class="n" id="np_vu" inputmode="decimal" placeholder="0"></label></div>
      <button class="btn" type="button" id="npAdd">Agregar ítem</button>
      ${S.cfg.extras.length ? `<div class="chips">${S.cfg.extras.map((x) => `<span class="chip"><b class="num">${esc(x.cod)}</b><button type="button" data-del-np="${esc(x.cod)}" aria-label="Quitar">×</button></span>`).join('')}</div>` : ''}
    </div>
    <div class="hint">${n} medidas · ${S.outbox.length} cambios por subir · versión ${VERSION}</div>
  </div>`;
  const v = (k) => $('#' + k, main).value.trim();
  $('#c_save', main).addEventListener('click', async () => {
    S.nombre = v('c_nombre'); await DB.put('kv', S.nombre, 'nombre');
    const url = v('c_url'), clave = v('c_clave');
    if (url && !/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) { toast('La dirección debe empezar por https://script.google.com/'); return; }
    const cambio = url !== S.conn.url;
    S.conn = { url, clave }; await DB.put('kv', S.conn, 'conn');
    if (cambio) { S.ultimoPull = 0; await DB.put('kv', 0, 'ultimoPull'); }
    toast('Conexión guardada'); render(); sync();
  });
  $('#c_sync', main).addEventListener('click', () => { sync(); toast('Sincronizando…'); });
  const cp = $('#c_copy', main);
  if (cp) cp.addEventListener('click', async () => {
    const link = enlaceInvitacion();
    try { if (navigator.share) await navigator.share({ title: 'Memorias de obra', text: 'Abre este enlace para conectar la app de memorias de obra:', url: link }); else { await navigator.clipboard.writeText(link); toast('Enlace copiado'); } }
    catch (e) { $('#c_link', main).select(); }
  });
  $('#pres_btn', main).addEventListener('click', () => $('#pres_file', main).click());
  $('#pres_file', main).addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const msg = $('#pres_msg', main); msg.innerHTML = '<div class="note">Leyendo el Excel… puede tardar un poco si tiene muchas hojas.</div>';
    try {
      await cargarExcel();
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await f.arrayBuffer());
      const r = leerPresupuesto(wb);
      const total = r.filas.filter((x) => x.t === 'i').reduce((s, x) => s + x.cant * x.vu, 0);
      msg.innerHTML = `<div class="note ok">Encontré <b>${r.items}</b> ítems en la hoja “${esc(r.hoja)}”. Costo directo: <b>$ ${Math.round(total).toLocaleString('es-CO')}</b>.</div><div class="actions" style="margin-top:8px"><button class="btn pri" type="button" id="pres_ok">Usar este presupuesto</button></div>`;
      $('#pres_ok', main).addEventListener('click', async () => {
        await guardarConfig('presupuesto', { hoja: r.hoja, filas: r.filas, cargado: Date.now() });
        const pr = Object.assign({}, S.cfg.proyecto || {});
        for (const [k, val] of Object.entries(r.proyecto)) if (!pr[k]) pr[k] = val;
        await guardarConfig('proyecto', pr);
        toast('Presupuesto cargado');
      });
    } catch (err) { msg.innerHTML = `<div class="note bad">${esc(err.message || err)}</div>`; }
    e.target.value = '';
  });
  $('#p_save', main).addEventListener('click', () => {
    guardarConfig('proyecto', { contrato: v('p_contrato'), objeto: v('p_objeto'), contratista: v('p_contratista'), supervisor: v('p_supervisor'), elaboro: v('p_elaboro'), reviso: v('p_reviso'), admin: num(v('p_admin')) / 100, imprev: num(v('p_imprev')) / 100, util: num(v('p_util')) / 100, iva: num(v('p_iva')) / 100 });
    toast('Datos guardados');
  });
  $('#subAdd', main).addEventListener('click', () => { const nm = v('subNew'); if (nm) guardarConfig('subs', S.cfg.subs.concat({ id: uidGen(), nombre: nm, precios: {} })); });
  main.querySelectorAll('[data-del-sub]').forEach((b) => b.addEventListener('click', () => guardarConfig('subs', S.cfg.subs.filter((s) => s.id !== b.dataset.delSub))));
  $('#ubicAdd', main).addEventListener('click', () => { const u = v('ubicNew').toUpperCase(); if (u) guardarConfig('ubic', [...new Set(S.cfg.ubic.concat(u))]); });
  main.querySelectorAll('[data-del-ubic]').forEach((b) => b.addEventListener('click', () => guardarConfig('ubic', S.cfg.ubic.filter((u) => u !== b.dataset.delUbic))));
  $('#npAdd', main).addEventListener('click', () => {
    const cod = v('np_cod').toUpperCase(); const desc = v('np_desc');
    if (!cod || !desc) { toast('Escribe código y descripción.'); return; }
    if (itemBy(cod)) { toast('Ese código ya existe.'); return; }
    guardarConfig('extras', S.cfg.extras.concat({ no: 'NP', cod, desc: desc.toUpperCase(), und: $('#np_und', main).value, cant: num(v('np_cant')), vu: num(v('np_vu')) }));
    toast('Ítem agregado al final de la lista');
  });
  main.querySelectorAll('[data-del-np]').forEach((b) => b.addEventListener('click', () => guardarConfig('extras', S.cfg.extras.filter((x) => x.cod !== b.dataset.delNp))));
}

/* ---------- Primer uso ---------- */
function pantallaBienvenida() {
  const host = document.createElement('div'); host.className = 'sheet'; host.style.zIndex = 55;
  host.innerHTML = `<div class="content gut" style="padding-top:28px">
    <h2 style="margin:0;font-size:24px">Memorias de obra</h2>
    <p class="hint" style="font-size:15px">Registra las medidas de campo con fotos, aunque no haya señal. Todo se sube a Google Drive cuando vuelve la conexión.</p>
    ${S.conn.url ? '<div class="note ok">Esta app ya quedó conectada con el servidor de la obra.</div>' : ''}
    <label class="f">¿Cómo te llamas?<input id="w_nombre" autocomplete="name" placeholder="Ej. Juan Pérez"></label>
    <button class="btn pri" type="button" id="w_ok">Empezar</button>
  </div>`;
  document.body.appendChild(host);
  $('#w_ok', host).addEventListener('click', async () => {
    const nm = $('#w_nombre', host).value.trim(); if (!nm) { toast('Escribe tu nombre.'); return; }
    S.nombre = nm; await DB.put('kv', nm, 'nombre'); host.remove(); render(); sync();
  });
}

/* ---------- Arranque ---------- */
(async function init() {
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
  const [ms, cfg, conn, nombre, up, ob] = await Promise.all([DB.all('medidas'), DB.get('kv', 'cfg'), DB.get('kv', 'conn'), DB.get('kv', 'nombre'), DB.get('kv', 'ultimoPull'), DB.all('outbox')]);
  for (const m of ms || []) S.medidas[m.id] = m;
  if (cfg) Object.assign(S.cfg, cfg);
  if (conn) S.conn = conn;
  S.nombre = nombre || ''; S.ultimoPull = up || 0; S.outbox = ob || [];
  // Enlace de invitación: #conectar=...
  const m = location.hash.match(/conectar=([^&]+)/);
  if (m) {
    try {
      const c = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(m[1])))));
      if (c.u) { S.conn = { url: c.u, clave: c.k || '' }; await DB.put('kv', S.conn, 'conn'); S.ultimoPull = 0; await DB.put('kv', 0, 'ultimoPull'); }
    } catch (e) {}
    history.replaceState(null, '', location.pathname);
  }
  render();
  if (!S.nombre) pantallaBienvenida();
  sync();
})();

/* ---------- Actualizaciones de la app ---------- */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const avisar = (w) => {
      const b = document.createElement('div'); b.className = 'update';
      b.innerHTML = '<span>Hay una versión nueva de la app.</span><button type="button" class="btn pri">Actualizar</button>';
      b.querySelector('button').addEventListener('click', () => { w.postMessage('activar'); });
      document.body.appendChild(b);
    };
    if (reg.waiting && navigator.serviceWorker.controller) avisar(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) avisar(w); });
    });
    setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
  }).catch(() => {});
  let recargado = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!recargado) { recargado = true; location.reload(); } });
}
