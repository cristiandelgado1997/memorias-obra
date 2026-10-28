/* ================= Plano que aprende de las medidas ================= */
'use strict';
const TOL = 0.05; // diferencia (m) desde la cual una medida "no cuadra" con el plano

const edificaciones = () => (S.cfg.planos && S.cfg.planos.lista) || [];
const edifBy = (id) => edificaciones().find((e) => e.id === id);
function espBy(id) { for (const e of edificaciones()) { const s = e.espacios.find((x) => x.id === id); if (s) return { edif: e, esp: s }; } return null; }
const dimsPlano = (s) => ({ w: r2(s.x1 - s.x0), h: r2(s.y1 - s.y0) });
const largoMuro = (s, n) => (n === 1 || n === 3 ? dimsPlano(s).w : dimsPlano(s).h);
const PARTES = [['piso', 'Piso'], ['cielo', 'Cielo'], ['m1', 'Muro 1'], ['m2', 'Muro 2'], ['m3', 'Muro 3'], ['m4', 'Muro 4'], ['otro', 'Otro']];
const nombreParte = (p) => (PARTES.find((x) => x[0] === p) || [p, ''])[1];

/* ---------- Modelo: lo que las medidas dicen de cada espacio ---------- */
function modelo() {
  const M = {};
  const ms = vivas().filter((m) => m.esp).sort((a, b) => (a.editado || a.creado || 0) - (b.editado || b.creado || 0));
  const vanosPorItem = {}; // esp|muro -> item -> [vanos]
  for (const m of ms) {
    const ref = espBy(m.esp); if (!ref) continue;
    const s = ref.esp; const P = dimsPlano(s);
    const o = M[m.esp] || (M[m.esp] = { largo: null, ancho: null, muros: { 1: {}, 2: {}, 3: {}, 4: {} }, items: new Set(), n: 0, revisar: [] });
    o.items.add(m.item); o.n++;
    const tipo = tipoDe(m.item); const a = num(m.a), b = num(m.b);
    if ((m.parte === 'piso' || m.parte === 'cielo') && !m.desc && (tipo === 'AREA' || tipo === 'VOL') && a && b) {
      // ordenar largo/ancho como en el plano
      const d1 = Math.abs(a - P.w) + Math.abs(b - P.h), d2 = Math.abs(b - P.w) + Math.abs(a - P.h);
      o.largo = d1 <= d2 ? a : b; o.ancho = d1 <= d2 ? b : a;
    }
    const mm = /^m([1-4])$/.exec(m.parte || '');
    if (mm) {
      const k = Number(mm[1]);
      if (m.desc) {
        const key = m.esp + '|' + k;
        ((vanosPorItem[key] = vanosPorItem[key] || {})[m.item] = vanosPorItem[key][m.item] || []).push({ ancho: a, alto: b, pos: m.vanoPos === '' || m.vanoPos == null ? null : num(m.vanoPos) });
      } else {
        if (a && (tipo === 'AREA' || tipo === 'LIN')) o.muros[k].len = a;
        if (b && tipo === 'AREA') o.muros[k].alto = b;
      }
    }
  }
  // vanos: por tamaño, la mayor cantidad registrada en un mismo ítem (evita contarlos doble entre estuco y pintura)
  for (const [key, porItem] of Object.entries(vanosPorItem)) {
    const [esp, k] = key.split('|'); const cuenta = {};
    for (const lista of Object.values(porItem)) {
      const c = {};
      for (const v of lista) { const kk = [r2(v.ancho), r2(v.alto), v.pos == null ? '' : r2(v.pos)].join('|'); c[kk] = (c[kk] || 0) + 1; }
      for (const [kk, n] of Object.entries(c)) cuenta[kk] = Math.max(cuenta[kk] || 0, n);
    }
    const vanos = [];
    for (const [kk, n] of Object.entries(cuenta)) { const [an, al, po] = kk.split('|'); for (let i = 0; i < n; i++) vanos.push({ ancho: Number(an), alto: Number(al), pos: po === '' ? null : Number(po) }); }
    M[esp].muros[k].vanos = vanos;
  }
  // diferencias con el plano
  for (const [id, o] of Object.entries(M)) {
    const s = espBy(id).esp; const P = dimsPlano(s);
    if (o.largo != null && Math.abs(o.largo - P.w) > TOL) o.revisar.push(`Largo ${fmt(o.largo)} (plano ${fmt(P.w)})`);
    if (o.ancho != null && Math.abs(o.ancho - P.h) > TOL) o.revisar.push(`Ancho ${fmt(o.ancho)} (plano ${fmt(P.h)})`);
    for (let k = 1; k <= 4; k++) { const L = o.muros[k].len; if (L != null && Math.abs(L - largoMuro(s, k)) > TOL) o.revisar.push(`Muro ${k}: ${fmt(L)} (plano ${fmt(largoMuro(s, k))})`); }
    const altos = [1, 2, 3, 4].map((k) => o.muros[k].alto).filter((x) => x);
    o.alto = altos.length ? Math.max(...altos) : null;
  }
  return M;
}
// Medida "real" de un muro: la del propio muro, la del opuesto, o la del piso
function largoObra(o, s, k) {
  if (!o) return null;
  const opu = { 1: 3, 2: 4, 3: 1, 4: 2 }[k];
  return o.muros[k].len ?? o.muros[opu].len ?? (k === 1 || k === 3 ? o.largo : o.ancho) ?? null;
}

/* ---------- Dibujo de la planta (SVG) ---------- */
function svgPlano(edif, opt = {}) {
  const W = edif.ancho, H = edif.alto;
  const Y = (y) => r2(H - y);
  const L = edif.lineas || {};
  const linea = (arr, cls) => arr.map((s) => `<line x1="${s[0]}" y1="${Y(s[1])}" x2="${s[2]}" y2="${Y(s[3])}" class="${cls}"/>`).join('');
  const est = opt.estado || {};
  let rects = '';
  for (const s of edif.espacios) {
    const st = est[s.id] || 'vacio';
    const sel = opt.sel === s.id;
    rects += `<rect data-esp="${s.id}" x="${s.x0}" y="${Y(s.y1)}" width="${r2(s.x1 - s.x0)}" height="${r2(s.y1 - s.y0)}" class="esp ${st}${sel ? ' sel' : ''}"><title>${esc(s.nombre)}</title></rect>`;
  }
  let labels = '';
  if (opt.etiquetas !== false) for (const s of edif.espacios) {
    const w = s.x1 - s.x0, h = s.y1 - s.y0; if (w < 2.2 && h < 2.2) continue;
    const fs = Math.min(0.75, Math.max(0.42, Math.min(w, h) / 6));
    const rot = h > w * 1.6 && w < 4 ? ` transform="rotate(-90 ${r2((s.x0 + s.x1) / 2)} ${Y((s.y0 + s.y1) / 2)})"` : '';
    labels += `<text x="${r2((s.x0 + s.x1) / 2)}" y="${Y((s.y0 + s.y1) / 2)}" font-size="${r2(fs)}" class="lbl"${rot}>${esc(s.nombre.replace('BAÑO GENERAL ', 'B. ').replace('ALOJAMIENTO ', 'ALOJ. '))}</text>`;
  }
  return `<svg class="plano" viewBox="-0.6 -0.6 ${r2(W + 1.2)} ${r2(H + 1.2)}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Planta de ${esc(edif.nombre)}">
    <g class="fondo">${linea(L.mueble || [], 'ln-m')}${linea(L.vano || [], 'ln-v')}${linea(L.muro || [], 'ln-w')}</g>
    <g>${rects}</g><g>${labels}</g></svg>`;
}

/* ---------- Planta acotada de un espacio ---------- */
function svgEspacio(s, o, opt = {}) {
  const P = dimsPlano(s);
  const w = (o && (largoObra(o, s, 1))) || P.w, h = (o && (largoObra(o, s, 2))) || P.h;
  const pad = Math.max(w, h) * 0.22 + 0.6;
  const Y = (y) => r2(h - y);
  const cota = (x1, y1, x2, y2, txt, dif, lado) => {
    const col = dif ? 'var(--warn)' : 'var(--accent)';
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2; const vert = x1 === x2;
    return `<line x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}" stroke="${col}" stroke-width="${r2(Math.max(w, h) / 300)}"/>
      <text x="${r2(mx + (vert ? lado * pad * 0.28 : 0))}" y="${r2(my + (vert ? 0 : lado * pad * 0.3))}" font-size="${r2(Math.max(w, h) / 16)}" fill="${col}" class="cota" ${vert ? `transform="rotate(-90 ${r2(mx + lado * pad * 0.28)} ${r2(my)})"` : ''}>${txt}</text>`;
  };
  const sw = r2(Math.max(w, h) / 45);
  let g = `<rect x="0" y="0" width="${r2(w)}" height="${r2(h)}" fill="var(--hatch)" stroke="var(--ink)" stroke-width="${sw}"/>`;
  // vanos sobre los muros
  for (let k = 1; k <= 4; k++) {
    const vs = (o && o.muros[k].vanos) || []; const Lm = k === 1 || k === 3 ? w : h;
    vs.forEach((v, i) => {
      const pos = v.pos != null ? v.pos : (Lm - v.ancho) / 2 + i * 0.15;
      let x1, y1, x2, y2;
      // posición medida desde la esquina izquierda, mirando el muro desde dentro del espacio
      if (k === 1) { x1 = w - pos; x2 = w - pos - v.ancho; y1 = y2 = h; }
      if (k === 2) { x1 = x2 = w; y1 = pos; y2 = pos + v.ancho; }
      if (k === 3) { x1 = pos; x2 = pos + v.ancho; y1 = y2 = 0; }
      if (k === 4) { x1 = x2 = 0; y1 = h - pos; y2 = h - pos - v.ancho; }
      g += `<line x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}" stroke="var(--panel)" stroke-width="${r2(sw * 1.4)}"/><line x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}" stroke="var(--warn)" stroke-width="${r2(sw / 3)}" stroke-dasharray="${r2(sw)} ${r2(sw / 2)}"/>`;
    });
  }
  const d1 = o && largoObra(o, s, 1) != null && Math.abs(largoObra(o, s, 1) - P.w) > TOL;
  const d2 = o && largoObra(o, s, 2) != null && Math.abs(largoObra(o, s, 2) - P.h) > TOL;
  const t1 = o && largoObra(o, s, 1) != null ? fmt(largoObra(o, s, 1)) : fmt(P.w) + '*';
  const t2 = o && largoObra(o, s, 2) != null ? fmt(largoObra(o, s, 2)) : fmt(P.h) + '*';
  g += cota(0, h + pad * 0.45, w, h + pad * 0.45, t1, d1, 1);
  g += cota(w + pad * 0.45, 0, w + pad * 0.45, h, t2, d2, 1);
  const fs = r2(Math.max(w, h) / 14);
  const badge = (x, y, k) => `<circle cx="${r2(x)}" cy="${r2(y)}" r="${r2(fs * 0.8)}" fill="${opt.muroSel === k ? 'var(--amber)' : 'var(--accent)'}"/><text x="${r2(x)}" y="${r2(y)}" font-size="${r2(fs * 0.8)}" class="badge" fill="${opt.muroSel === k ? '#10161d' : '#fff'}">M${k}</text>`;
  g += badge(w / 2, h - fs * 1.2, 1) + badge(w - fs * 1.2, h / 2, 2) + badge(w / 2, fs * 1.2, 3) + badge(fs * 1.2, h / 2, 4);
  g += `<text x="${r2(w / 2)}" y="${r2(h / 2)}" font-size="${fs}" class="area">${fmt(w * h)} m²</text>`;
  return `<svg class="planta" viewBox="${r2(-pad * 0.35)} ${r2(-pad * 0.35)} ${r2(w + pad * 1.15)} ${r2(h + pad * 1.15)}" role="img" aria-label="Planta acotada de ${esc(s.nombre)}">${g}</svg>`;
}

/* ---------- Vista (alzado) de un muro ---------- */
function svgMuro(s, o, k) {
  const L = largoObra(o, s, k) ?? largoMuro(s, k);
  const H = (o && (o.muros[k].alto || o.alto)) || null;
  const h = H || 2.4;
  const pad = Math.max(L, h) * 0.16 + 0.4;
  const fs = r2(Math.max(L, 3) / 18);
  const sw = r2(Math.max(L, 3) / 160);
  let g = `<rect x="0" y="0" width="${r2(L)}" height="${r2(h)}" fill="var(--hatch)" stroke="var(--ink)" stroke-width="${sw}" ${H ? '' : 'stroke-dasharray="0.15 0.1"'}/>`;
  const vs = (o && o.muros[k].vanos) || [];
  vs.forEach((v, i) => {
    const x = v.pos != null ? v.pos : (L - v.ancho) / 2 + i * 0.15;
    const top = h - v.alto;
    g += `<rect x="${r2(x)}" y="${r2(top)}" width="${r2(v.ancho)}" height="${r2(v.alto)}" fill="var(--panel)" stroke="var(--warn)" stroke-width="${sw}" ${v.pos == null ? 'stroke-dasharray="0.12 0.08"' : ''}/>
      <text x="${r2(x + v.ancho / 2)}" y="${r2(top - fs * 0.5)}" font-size="${r2(fs * 0.8)}" class="cota" fill="var(--warn)">${fmt(v.ancho)} × ${fmt(v.alto)}${v.pos == null ? ' ~' : ''}</text>`;
  });
  g += `<line x1="0" y1="${r2(h + pad * 0.45)}" x2="${r2(L)}" y2="${r2(h + pad * 0.45)}" stroke="var(--accent)" stroke-width="${sw}"/><text x="${r2(L / 2)}" y="${r2(h + pad * 0.85)}" font-size="${fs}" class="cota" fill="var(--accent)">${fmt(L)}</text>`;
  g += `<line x1="${r2(L + pad * 0.35)}" y1="0" x2="${r2(L + pad * 0.35)}" y2="${r2(h)}" stroke="var(--accent)" stroke-width="${sw}"/><text x="${r2(L + pad * 0.7)}" y="${r2(h / 2)}" font-size="${fs}" class="cota" fill="var(--accent)" transform="rotate(-90 ${r2(L + pad * 0.7)} ${r2(h / 2)})">${H ? fmt(H) : 'alto ?'}</text>`;
  const neto = L * (H || 0) - vs.reduce((t, v) => t + v.ancho * v.alto, 0);
  if (H) g += `<text x="${r2(L * 0.72)}" y="${r2(h / 2)}" font-size="${fs}" class="area">${fmt(neto)} m²</text>`;
  return `<svg class="alzado" viewBox="${r2(-pad * 0.3)} ${r2(-pad * 0.6)} ${r2(L + pad * 1.3)} ${r2(h + pad * 1.6)}" role="img" aria-label="Vista del muro ${k}">${g}</svg>`;
}

/* ---------- Pestaña Plano ---------- */
const PL = { edif: null, sel: null };
function estadoEspacios(M, item) {
  const st = {};
  for (const [id, o] of Object.entries(M)) {
    if (item) { if (o.items.has(item)) st[id] = 'medido'; continue; }
    st[id] = o.revisar.length ? 'revisar' : 'medido';
  }
  return st;
}
function renderPlano(main) {
  const lista = edificaciones();
  if (!lista.length) {
    main.innerHTML = `<div class="empty"><b>Aún no hay planos cargados.</b><br><br>En <b>Ajustes → Planos</b> carga el archivo del plano (.json) que te preparé a partir del DWG del arquitecto.</div>`;
    return;
  }
  if (!PL.edif || !edifBy(PL.edif)) PL.edif = lista[0].id;
  const edif = edifBy(PL.edif);
  const M = modelo();
  const st = estadoEspacios(M);
  const total = edif.espacios.length, med = edif.espacios.filter((s) => st[s.id]).length, rev = edif.espacios.filter((s) => st[s.id] === 'revisar').length;
  const sel = PL.sel && edif.espacios.find((s) => s.id === PL.sel);
  const o = sel && M[sel.id];
  main.innerHTML = `<div class="content" style="padding:0">
    ${lista.length > 1 ? `<label class="f">Edificación<select id="plEdif">${lista.map((e) => `<option value="${esc(e.id)}" ${e.id === PL.edif ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}</select></label>` : ''}
    <div class="plano-head"><div><div class="eyebrow">Planta</div><b>${esc(edif.nombre)}</b></div><span class="num kpi">${med}/${total}</span></div>
    <div class="plano-wrap" id="plWrap">${svgPlano(edif, { estado: st, sel: PL.sel })}</div>
    <div class="leyenda"><span><i class="sw medido"></i>Medido</span><span><i class="sw revisar"></i>No cuadra${rev ? ` (${rev})` : ''}</span><span><i class="sw vacio"></i>Sin medir</span></div>
    ${sel ? fichaEspacio(sel, o) : '<div class="hint" style="text-align:center">Toca un espacio para ver lo que se ha medido.</div>'}
  </div>`;
  const se = $('#plEdif', main); if (se) se.addEventListener('change', () => { PL.edif = se.value; PL.sel = null; render(); });
  $('#plWrap', main).addEventListener('click', (e) => { const r = e.target.closest('[data-esp]'); if (r) { PL.sel = r.dataset.esp; render(); } });
  const ab = $('#abrirEsp', main); if (ab) ab.addEventListener('click', () => abrirEspacio(sel.id));
}
function fichaEspacio(s, o) {
  const P = dimsPlano(s);
  const items = o ? [...o.items] : [];
  return `<div class="ficha">
    <div class="eyebrow" style="color:var(--amber)">Seleccionado</div>
    <b style="font-size:19px">${esc(s.nombre)}</b>
    <div class="grid3" style="gap:8px">
      <div class="stat"><span>Plano</span><b class="num">${fmt(P.w)} × ${fmt(P.h)}</b></div>
      <div class="stat"><span>Obra</span><b class="num">${o && (largoObra(o, s, 1) || largoObra(o, s, 2)) ? `${largoObra(o, s, 1) != null ? fmt(largoObra(o, s, 1)) : '?'} × ${largoObra(o, s, 2) != null ? fmt(largoObra(o, s, 2)) : '?'}` : '—'}</b></div>
      <div class="stat"><span>Alto</span><b class="num">${o && o.alto ? fmt(o.alto) : '—'}</b></div>
    </div>
    ${o && o.revisar.length ? `<div class="note">${o.revisar.map(esc).join('<br>')}</div>` : ''}
    <div class="hint" style="color:#c9d4df">${items.length ? `${o.n} medidas en ${items.length} ítems: ${items.map(esc).join(', ')}` : 'Sin medidas todavía.'}</div>
    <button class="btn pri" type="button" id="abrirEsp">Ver espacio y muros</button>
  </div>`;
}

/* ---------- Hoja: espacio con planta acotada y vistas de muros ---------- */
function abrirEspacio(espId) {
  const prev = S.sheetRender;
  const host = document.createElement('div'); host.className = 'sheet'; host.style.zIndex = 48;
  $('#layer').appendChild(host);
  const pintar = () => {
    const ref = espBy(espId); if (!ref) { host.remove(); return; }
    const s = ref.esp; const M = modelo(); const o = M[espId];
    const ms = vivas().filter((m) => m.esp === espId).sort((a, b) => (a.item || '').localeCompare(b.item || '', 'es', { numeric: true }));
    const porItem = {}; ms.forEach((m) => (porItem[m.item] = porItem[m.item] || []).push(m));
    host.innerHTML = `<div class="bar gut dark"><button class="iconbtn" type="button" id="eBack" aria-label="Volver"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 5l-7 7 7 7"/></svg></button><h2><span class="eyebrow" style="display:block">${esc(ref.edif.nombre)}</span>${esc(s.nombre)}</h2>${o && o.alto ? `<span class="chip dark">Alto ${fmt(o.alto)} m</span>` : ''}</div>
    <div class="content gut">
      <div class="card fig">${svgEspacio(s, o)}<div class="hint">Cotas con medidas de obra. Las que llevan * son del plano (aún sin medir). Naranja: no cuadra con el plano.</div></div>
      ${o && o.revisar.length ? `<div class="note">${o.revisar.map(esc).join('<br>')}</div>` : ''}
      <div class="eyebrow">Vistas de los muros</div>
      <div class="muros">${[1, 2, 3, 4].map((k) => `<div class="card fig"><div class="mtit"><span class="badge-m">M${k}</span>${(o && o.muros[k].vanos && o.muros[k].vanos.length) ? `${o.muros[k].vanos.length} vano(s)` : 'sin vanos'}</div>${svgMuro(s, o, k)}</div>`).join('')}</div>
      <div class="eyebrow">Medidas en este espacio</div>
      ${ms.length ? Object.entries(porItem).map(([cod, l]) => `<div class="card"><b class="num">${esc(cod)}</b> <span class="hint">${esc(((itemBy(cod) || {}).desc || '').slice(0, 70))}…</span>${l.map((m) => `<div class="grp"><span>${esc(nombreParte(m.parte) || m.elem || '')}${m.desc ? ' · descuento' : ''}</span><b class="num">${fmt(calcMedida(tipoDe(cod), m))}</b></div>`).join('')}</div>`).join('') : '<div class="empty">Aún no hay medidas ligadas a este espacio. Se ligan al elegir el espacio en el plano cuando registras una medida.</div>'}
    </div>`;
    $('#eBack', host).addEventListener('click', () => { host.remove(); S.sheetRender = prev; render(); });
  };
  S.sheetRender = () => { if (prev) prev(); pintar(); };
  pintar();
}

/* ---------- Selector de espacio sobre el plano (para la medida) ---------- */
function elegirEnPlano(actual, cb, item) {
  const lista = edificaciones(); if (!lista.length) { toast('Primero carga un plano en Ajustes → Planos.'); return; }
  let edifId = (actual && espBy(actual) && espBy(actual).edif.id) || PL.edif || lista[0].id;
  const host = document.createElement('div'); host.className = 'sheet'; host.style.zIndex = 60;
  document.body.appendChild(host);
  const pintar = () => {
    const edif = edifBy(edifId);
    const st = item ? estadoEspacios(modelo(), item) : {};
    host.innerHTML = `<div class="bar gut dark"><button class="iconbtn" type="button" id="pkBack" aria-label="Cerrar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 6l12 12M18 6L6 18"/></svg></button><h2>Toca el espacio</h2></div>
      <div class="content gut">
        ${lista.length > 1 ? `<label class="f">Edificación<select id="pkEdif">${lista.map((e) => `<option value="${esc(e.id)}" ${e.id === edifId ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}</select></label>` : ''}
        <div class="plano-wrap tall" id="pkWrap">${svgPlano(edif, { estado: st, sel: actual })}</div>
        ${item ? '<div class="leyenda"><span><i class="sw medido"></i>Ya tiene medidas de este ítem</span></div>' : ''}
        <button class="btn" type="button" id="pkNone">Sin espacio del plano</button>
      </div>`;
    $('#pkBack', host).addEventListener('click', () => host.remove());
    $('#pkNone', host).addEventListener('click', () => { host.remove(); cb(null); });
    const se = $('#pkEdif', host); if (se) se.addEventListener('change', () => { edifId = se.value; pintar(); });
    $('#pkWrap', host).addEventListener('click', (e) => { const r = e.target.closest('[data-esp]'); if (r) { host.remove(); cb(r.dataset.esp); } });
  };
  pintar();
}

/* ---------- Plano del ítem (en la ficha del ítem) ---------- */
function planoDelItem(cod) {
  const lista = edificaciones(); if (!lista.length) return '';
  const M = modelo(); const st = estadoEspacios(M, cod);
  const conEsp = lista.filter((e) => e.espacios.some((s) => st[s.id]));
  const e = conEsp[0] || lista[0];
  const n = e.espacios.filter((s) => st[s.id]).length;
  return `<div class="card"><div class="mtit" style="justify-content:space-between"><span class="eyebrow">Dónde se ha medido · ${esc(e.nombre)}</span><span class="num">${n}/${e.espacios.length}</span></div>
    <div class="plano-wrap mini" data-item-plano>${svgPlano(e, { estado: st, etiquetas: true })}</div></div>`;
}
