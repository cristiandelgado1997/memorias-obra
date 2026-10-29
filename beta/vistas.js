/* ================= Planos en PDF y modelo 3D ================= */
'use strict';
const _libs = {};
function cargarScript(src, global) {
  if (window[global]) return Promise.resolve();
  return _libs[src] || (_libs[src] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => { delete _libs[src]; rej(new Error('No se pudo cargar ' + src)); }; document.head.appendChild(s); }));
}

/* ---------- Datos calculados por espacio ---------- */
function resumenEspacio(s, o) {
  const P = dimsPlano(s);
  const w = (o && largoObra(o, s, 1)) ?? null, h = (o && largoObra(o, s, 2)) ?? null;
  const W = w ?? P.w, H = h ?? P.h;
  let muros = 0, conAlto = 0;
  for (let k = 1; k <= 4; k++) {
    const L = (o && largoObra(o, s, k)) ?? largoMuro(s, k); const A = o && (o.muros[k].alto || o.alto);
    if (A) { conAlto++; muros += L * A - ((o.muros[k].vanos || []).reduce((t, v) => t + v.ancho * v.alto, 0)); }
  }
  return { P, w, h, W, H, piso: W * H, muros: conAlto ? muros : null, alto: o ? o.alto : null, verificado: w != null && h != null };
}

/* ---------- SVG → imagen (para el PDF) ---------- */
const COLORES_EXP = { '--ink': '#15202b', '--panel': '#ffffff', '--accent': '#1d6fd8', '--warn': '#a35d00', '--amber': '#ffb020', '--hatch': '#f1f4f7', '--muted': '#5b6774' };
const CSS_EXP = 'rect.elem{fill:#e9dcc8;stroke:#8a5a2b;stroke-width:.04}.ln-w{stroke:#15202b;stroke-width:.07}.ln-v{stroke:#d04a3a;stroke-width:.035}.ln-m{stroke:#5b6774;stroke-width:.018;opacity:.45}rect.esp{fill:none;stroke:none}rect.esp.medido{fill:rgba(29,111,216,.26);stroke:#1d6fd8;stroke-width:.09}rect.esp.revisar{fill:rgba(240,140,0,.34);stroke:#c26a00;stroke-width:.09}rect.esp.vacio{fill:rgba(138,150,163,.10);stroke:#8a96a3;stroke-width:.05}rect.esp.sel{stroke:#ffb020;stroke-width:.32}text{font-family:Arial,Helvetica,sans-serif}text.lbl{text-anchor:middle;dominant-baseline:middle;font-weight:700;fill:#15202b}text.cota{text-anchor:middle;dominant-baseline:middle;font-weight:700}text.badge{text-anchor:middle;dominant-baseline:central;font-weight:700}text.area{text-anchor:middle;dominant-baseline:middle;font-weight:700;fill:#15202b}line.hit{display:none}';
function svgAImagen(svg, px) {
  let s = svg.replace(/var\((--[\w-]+)\)/g, (m, v) => COLORES_EXP[v] || '#000');
  const vb = /viewBox="([^"]+)"/.exec(s)[1].trim().split(/\s+/).map(Number);
  const W = px, H = Math.max(1, Math.round(px * vb[3] / vb[2]));
  s = s.replace(/<svg /, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" `).replace(/(<svg[^>]*>)/, `$1<style>${CSS_EXP}</style>`);
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.drawImage(img, 0, 0, W, H); res({ data: c.toDataURL('image/jpeg', 0.9), w: W, h: H }); };
    img.onerror = () => rej(new Error('No se pudo dibujar una vista'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
  });
}

/* ---------- Ofrecer un archivo generado ---------- */
function ofrecerArchivo(blob, nombre, titulo, detalle) {
  const file = new File([blob], nombre, { type: blob.type || 'application/octet-stream' });
  const url = URL.createObjectURL(file);
  const host = document.createElement('div'); host.className = 'sheet'; host.style.zIndex = 70;
  document.body.appendChild(host);
  const puede = navigator.canShare && navigator.canShare({ files: [file] });
  host.innerHTML = `<div class="bar gut dark"><button class="iconbtn" type="button" id="ofBack" aria-label="Cerrar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 6l12 12M18 6L6 18"/></svg></button><h2>${esc(titulo)}</h2></div>
    <div class="content gut"><div class="card" style="display:flex;flex-direction:column;gap:10px"><b>${esc(nombre)}</b><div class="hint">${esc(detalle || '')}</div>
    <div class="actions"><a class="btn pri" href="${url}" download="${esc(nombre)}" style="text-align:center;text-decoration:none">Descargar</a>${puede ? '<button class="btn" type="button" id="ofShare">Compartir</button>' : ''}</div></div></div>`;
  $('#ofBack', host).addEventListener('click', () => { host.remove(); URL.revokeObjectURL(url); });
  const sh = $('#ofShare', host); if (sh) sh.addEventListener('click', async () => { try { await navigator.share({ files: [file], title: nombre }); } catch (e) {} });
}

/* ---------- PDF: planta general, espacios con sus muros, plano por ítem ---------- */
async function exportarPlanosPDF(edifId) {
  const edif = edifBy(edifId); if (!edif) return;
  toast('Generando el PDF…');
  await cargarScript('jspdf.umd.min.js', 'jspdf');
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const Wp = 297, Hp = 210, m = 12;
  const p = P(); const M = modelo(); const st = estadoEspacios(M);
  const fecha = new Date().toLocaleDateString('es-CO');
  let pag = 0;
  const cabecera = (titulo) => {
    if (pag++) pdf.addPage();
    pdf.setFillColor(16, 22, 29); pdf.rect(0, 0, Wp, 16, 'F');
    pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12);
    pdf.text(titulo, m, 10.5);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8);
    pdf.text(`${edif.nombre} · ${p.contratista || ''} · ${fecha}`, Wp - m, 10.5, { align: 'right' });
    pdf.setTextColor(21, 32, 43);
    pdf.setFontSize(7); pdf.setTextColor(91, 103, 116);
    pdf.text('Cotas en metros, con medidas de obra. * medida del plano sin verificar · ~ posición o altura de vano aproximada · naranja: no cuadra con el plano.', m, Hp - 6);
    pdf.text(`Hoja ${pag}`, Wp - m, Hp - 6, { align: 'right' });
    pdf.setTextColor(21, 32, 43);
  };
  const imagen = async (svg, x, y, w, h) => {
    const img = await svgAImagen(svg, Math.round(Math.min(1600, Math.max(700, w * 9))));
    const k = Math.min(w / img.w, h / img.h); const iw = img.w * k, ih = img.h * k;
    pdf.addImage(img.data, 'JPEG', x + (w - iw) / 2, y + (h - ih) / 2, iw, ih, undefined, 'FAST');
  };
  const tabla = (x, y, cols, filas, anchos, fs = 7.5) => {
    pdf.setFontSize(fs); let yy = y;
    pdf.setFont('helvetica', 'bold'); pdf.setFillColor(233, 237, 241); pdf.rect(x, yy - 3.6, anchos.reduce((a, b) => a + b, 0), 5.2, 'F');
    let xx = x; cols.forEach((c, i) => { pdf.text(c, xx + 1, yy); xx += anchos[i]; }); yy += 5;
    pdf.setFont('helvetica', 'normal');
    for (const f of filas) {
      xx = x; f.forEach((c, i) => { const t = pdf.splitTextToSize(String(c), anchos[i] - 2)[0]; pdf.text(t, xx + 1, yy); xx += anchos[i]; });
      pdf.setDrawColor(213, 219, 226); pdf.line(x, yy + 1.4, x + anchos.reduce((a, b) => a + b, 0), yy + 1.4); yy += 4.8;
    }
    return yy;
  };
  // 1. Planta general + cuadro de áreas
  cabecera('PLANTA GENERAL ACOTADA');
  await imagen(svgPlano(edif, { estado: st }), m, 20, 150, Hp - 32);
  const filas = edif.espacios.map((s) => {
    const r = resumenEspacio(s, M[s.id]);
    return [s.nombre, `${fmt(r.P.w)} × ${fmt(r.P.h)}`, r.verificado ? `${fmt(r.W)} × ${fmt(r.H)}` : '—', r.alto ? fmt(r.alto) : '—', fmt(r.piso) + (r.verificado ? '' : '*'), r.muros != null ? fmt(r.muros) : '—'];
  });
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.text('Cuadro de áreas', 170, 24);
  tabla(170, 31, ['Espacio', 'Plano', 'Obra', 'Alto', 'Piso m²', 'Muros m²'], filas, [42, 18, 18, 10, 14, 13], 6.8);
  // 2. Cada espacio: planta acotada y vistas de los 4 muros
  for (const s of edif.espacios) {
    const o = M[s.id]; const r = resumenEspacio(s, o);
    cabecera(`ESPACIO · ${s.nombre}`);
    pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.text('Planta acotada', m, 23);
    await imagen(svgEspacio(s, o), m, 25, 120, 120);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8);
    const info = [`Plano: ${fmt(r.P.w)} × ${fmt(r.P.h)} m`, `Obra: ${r.verificado ? fmt(r.W) + ' × ' + fmt(r.H) + ' m' : 'sin medir'}`, `Alto: ${r.alto ? fmt(r.alto) + ' m' : 'sin medir'}`, `Piso: ${fmt(r.piso)} m²${r.verificado ? '' : ' (plano)'}`, `Muros netos: ${r.muros != null ? fmt(r.muros) + ' m²' : '—'}`];
    info.forEach((t, i) => pdf.text(t, m, 152 + i * 5));
    if (o && o.revisar.length) { pdf.setTextColor(163, 93, 0); pdf.text('No cuadra con el plano: ' + o.revisar.join('; '), m, 180, { maxWidth: 120 }); pdf.setTextColor(21, 32, 43); }
    for (let k = 1; k <= 4; k++) {
      const col = (k - 1) % 2, fil = Math.floor((k - 1) / 2);
      const x = 140 + col * 75, y = 22 + fil * 88;
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5);
      const v = vecino(edif, s, k);
      pdf.text(`Muro ${k}${v ? ' · colinda con ' + (v === 'exterior' ? 'el exterior' : corto(v)) : ''}`, x, y + 1);
      await imagen(svgMuro(s, o, k), x, y + 3, 72, 78);
    }
  }
  // 3. Plano por ítem
  const porItem = {};
  for (const mm of vivas()) { if (!mm.esp) continue; const ref = espBy(mm.esp); if (!ref || ref.edif.id !== edif.id) continue; ((porItem[mm.item] = porItem[mm.item] || {})[mm.esp] = (porItem[mm.item][mm.esp] || 0) + calcMedida(tipoDe(mm.item), mm)); }
  for (const cod of Object.keys(porItem).sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))) {
    const it = itemBy(cod) || { desc: '', und: '' };
    cabecera(`PLANO POR ÍTEM · ${cod}`);
    pdf.setFontSize(7.5); pdf.setFont('helvetica', 'normal'); pdf.text(pdf.splitTextToSize(it.desc, 120).slice(0, 4), 170, 24);
    await imagen(svgPlano(edif, { estado: estadoEspacios(M, cod) }), m, 20, 150, Hp - 32);
    const f = Object.entries(porItem[cod]).map(([id, q]) => [espBy(id).esp.nombre, fmt(q) + ' ' + it.und]);
    const tot = Object.values(porItem[cod]).reduce((a, b) => a + b, 0);
    const yy = tabla(170, 46, ['Espacio', 'Cantidad'], f, [75, 30]);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.text(`Total en el plano: ${fmt(tot)} ${it.und}`, 170, yy + 4);
  }
  const nombre = `PLANOS_${edif.nombre.replace(/[^\wÑñ-]+/g, '_')}_${hoy()}.pdf`;
  ofrecerArchivo(pdf.output('blob'), nombre, 'Planos en PDF', `${pag} hojas: planta general con cuadro de áreas, una hoja por espacio con su planta acotada y las vistas de los 4 muros, y un plano por cada ítem medido.`);
}

/* ---------- Modelo 3D: muros con alturas y vanos medidos ---------- */
const ESPESOR = 0.1;
function cajas3D(edif) {
  const M = modelo(); const out = [];
  const EXT = 0.15;      // espesor de muro exterior
  const MAXGAP = 0.6;    // entre dos espacios, un hueco menor que esto es un muro (compartido)
  const esExterior = (s) => /PLACA|AND[EÉ]N|PATIO|EXTERIOR|TERRAZA|PARQUEADERO/i.test(s.nombre || '');
  // 1. espacios con sus medidas de obra y vanos en coordenadas absolutas del plano
  const G = edif.espacios.map((s) => {
    const o = M[s.id]; const r = resumenEspacio(s, o);
    const g = { s, o, x0: s.x0, y0: s.y0, x1: s.x0 + r.W, y1: s.y0 + r.H, w: r.W, h: r.H, ext: esExterior(s), muros: {} };
    for (let k = 1; k <= 4; k++) {
      const L = k === 1 || k === 3 ? g.w : g.h;
      const Hm = (o && (o.muros[k].alto || o.alto)) || null;
      const vanos = ((o && o.muros[k].vanos) || []).map((v, i) => {
        const pos = v.pos != null ? v.pos : (L - v.ancho) / 2 + i * 0.15;
        const u0 = Math.max(0, pos), u1 = Math.min(L, pos + v.ancho);
        const ap = antepecho(v); const z0 = ap.z, z1 = ap.z + v.alto;
        const puerta = z0 === 0 && (v.tipo === 'puerta' || (!v.tipo && v.alto >= 1.8));
        const a0 = k === 1 ? g.x1 - u1 : k === 2 ? g.y1 - u1 : k === 3 ? g.x0 + u0 : g.y0 + u0;
        return { a0, a1: a0 + (u1 - u0), z0, z1, puerta };
      });
      g.muros[k] = { Hm, H: Hm || 2.4, vanos };
    }
    return g;
  });
  const R = G.filter((g) => !g.ext);
  // 2. rejilla no uniforme a partir de todas las caras, espesores y bordes de vanos
  const xs = new Set(), ys = new Set();
  for (const g of R) {
    for (const v of [g.x0, g.x1, g.x0 - EXT, g.x1 + EXT]) xs.add(+v.toFixed(4));
    for (const v of [g.y0, g.y1, g.y0 - EXT, g.y1 + EXT]) ys.add(+v.toFixed(4));
    for (const k of [1, 3]) for (const v of g.muros[k].vanos) { xs.add(+v.a0.toFixed(4)); xs.add(+v.a1.toFixed(4)); }
    for (const k of [2, 4]) for (const v of g.muros[k].vanos) { ys.add(+v.a0.toFixed(4)); ys.add(+v.a1.toFixed(4)); }
  }
  // líneas a medio camino de cada hueco entre espacios, para repartir alturas
  const X = [...xs].sort((a, b) => a - b), Y = [...ys].sort((a, b) => a - b);
  const dist = (g, x, y) => Math.max(g.x0 - x, 0, x - g.x1, g.y0 - y, 0, y - g.y1);
  const lado = (g, x, y) => { const dx = Math.max(g.x0 - x, x - g.x1), dy = Math.max(g.y0 - y, y - g.y1); if (dy >= dx) return y < g.y0 ? 1 : 3; return x > g.x1 ? 2 : 4; };
  const dentro = (g, x, y) => x > g.x0 + 1e-6 && x < g.x1 - 1e-6 && y > g.y0 + 1e-6 && y < g.y1 - 1e-6;
  const celdas = [];
  for (let j = 0; j < Y.length - 1; j++) {
    const fila = [];
    for (let i = 0; i < X.length - 1; i++) {
      const cx = (X[i] + X[i + 1]) / 2, cy = (Y[j] + Y[j + 1]) / 2;
      if (X[i + 1] - X[i] < 1e-4 || Y[j + 1] - Y[j] < 1e-4 || R.some((g) => dentro(g, cx, cy))) { fila.push(null); continue; }
      const ds = R.map((g) => [dist(g, cx, cy), g]).sort((a, b) => a[0] - b[0]);
      if (!ds.length) { fila.push(null); continue; }
      const [d1, g1] = ds[0]; const d2 = ds[1] ? ds[1][0] : Infinity;
      const compartido = d1 + d2 <= MAXGAP + 1e-6;
      if (!(d1 <= EXT + 1e-6 || compartido)) { fila.push(null); continue; }
      const junto = [[g1, lado(g1, cx, cy)]]; if (compartido && ds[1]) junto.push([ds[1][1], lado(ds[1][1], cx, cy)]);
      const H = Math.max(...junto.map(([g, k]) => g.muros[k].H)); const medido = junto.some(([g, k]) => g.muros[k].Hm);
      // tramos macizos en altura, restando los vanos que atraviesan esta celda
      let macizo = [[0, H]];
      for (const [g, k] of junto) {
        const sobreCara = k === 1 || k === 3 ? cx > g.x0 && cx < g.x1 : cy > g.y0 && cy < g.y1; if (!sobreCara) continue;
        const a = k === 1 || k === 3 ? cx : cy;
        for (const v of g.muros[k].vanos) if (a > v.a0 && a < v.a1) {
          macizo = macizo.flatMap(([z0, z1]) => { const r = []; if (v.z0 > z0) r.push([z0, Math.min(z1, v.z0)]); if (v.z1 < z1) r.push([Math.max(z0, v.z1), z1]); return r.filter(([p, q]) => q - p > 0.005); });
        }
      }
      const clave = JSON.stringify([macizo.map(([p, q]) => [+p.toFixed(3), +q.toFixed(3)]), medido, junto.map(([g, k]) => g.s.id + k)]);
      fila.push({ clave, macizo, medido, junto });
    }
    celdas.push(fila);
  }
  // 3. unir celdas iguales en rectángulos grandes (menos cajas, sin traslapos)
  const usado = celdas.map((f) => f.map(() => false));
  for (let j = 0; j < celdas.length; j++) for (let i = 0; i < celdas[j].length; i++) {
    const c = celdas[j][i]; if (!c || usado[j][i]) continue;
    let i2 = i; while (i2 + 1 < celdas[j].length && celdas[j][i2 + 1] && !usado[j][i2 + 1] && celdas[j][i2 + 1].clave === c.clave) i2++;
    let j2 = j;
    for (;;) { const fj = celdas[j2 + 1]; if (!fj) break; let ok = true; for (let ii = i; ii <= i2; ii++) if (!fj[ii] || usado[j2 + 1][ii] || fj[ii].clave !== c.clave) { ok = false; break; } if (!ok) break; j2++; }
    for (let jj = j; jj <= j2; jj++) for (let ii = i; ii <= i2; ii++) usado[jj][ii] = true;
    const xa = X[i], xb = X[i2 + 1], ya = Y[j], yb = Y[j2 + 1];
    const [ga, ka] = c.junto[0], b2 = c.junto[1];
    for (const [z0, z1] of c.macizo) out.push({ grupo: ga.s.nombre, tipo: 'muro', esp: ga.s.id, k: ka, espB: b2 ? b2[0].s.id : null, kB: b2 ? b2[1] : null, supuesto: !c.medido, c: [(xa + xb) / 2, (z0 + z1) / 2, (ya + yb) / 2], d: [xb - xa, z1 - z0, yb - ya], rot: 0 });
  }
  // 4. pisos, placas aéreas, elementos y carpintería
  const vistos = new Set();
  for (const g of G) {
    const { s, o, x0, y0, w, h } = g;
    const estado = o ? (o.revisar.length ? 'revisar' : 'medido') : 'vacio';
    if (g.ext) {
      const vec = R.filter((q) => dist(q, (g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2) < Math.max(w, h));
      const Hs = (o && o.alto) || Math.max(2.4, ...vec.map((q) => Math.max(...[1, 2, 3, 4].map((k) => q.muros[k].H))));
      out.push({ grupo: s.nombre, tipo: 'placa', estado, esp: s.id, nombre: s.nombre, c: [x0 + w / 2, Hs + 0.06, y0 + h / 2], d: [w, 0.12, h], rot: 0 });
      continue;
    }
    out.push({ grupo: s.nombre, tipo: 'piso', estado, esp: s.id, nombre: s.nombre, c: [x0 + w / 2, -0.03, y0 + h / 2], d: [w, 0.06, h], rot: 0 });
    const Hc = (o && o.alto) || 2.4;
    out.push({ grupo: s.nombre, tipo: 'cielo', esp: s.id, oculto: true, c: [x0 + w / 2, Hc + 0.01, y0 + h / 2], d: [w, 0.02, h], rot: 0 });
    for (const el of elementosDe(s.id)) {
      const [a, b, c, d2] = rectElemento(el, w, h); const al = num(el.alto) || 0.9;
      out.push({ grupo: s.nombre + ' ' + el.nombre, tipo: 'elemento', esp: s.id, c: [x0 + (a + c) / 2, al / 2, y0 + (b + d2) / 2], d: [c - a, al, d2 - b], rot: 0 });
    }
    for (let k = 1; k <= 4; k++) {
      const horiz = k === 1 || k === 3;
      // espesor del muro en esa cara: hasta el espacio vecino más cercano, o el exterior
      let t = EXT;
      for (const q of R) { if (q === g) continue; const d = k === 1 ? g.y0 - q.y1 : k === 2 ? q.x0 - g.x1 : k === 3 ? q.y0 - g.y1 : g.x0 - q.x1; const sol = horiz ? Math.min(g.x1, q.x1) - Math.max(g.x0, q.x0) : Math.min(g.y1, q.y1) - Math.max(g.y0, q.y0); if (sol > 0.3 && d > -0.05 && d < MAXGAP) t = Math.min(t === EXT ? Infinity : t, Math.max(0.08, d)); }
      if (!isFinite(t)) t = EXT;
      const fijo = k === 1 ? y0 - t / 2 : k === 2 ? g.x1 + t / 2 : k === 3 ? g.y1 + t / 2 : x0 - t / 2;
      const H = g.muros[k].H; const fm = 0.05, gm = t + 0.02;
      const cajaC = (a0, a1, z0, z1, grosor, tipo) => { if (a1 - a0 < 0.005 || z1 - z0 < 0.005) return; const am = (a0 + a1) / 2; out.push({ grupo: s.nombre, tipo, esp: s.id, k, c: horiz ? [am, (z0 + z1) / 2, fijo] : [fijo, (z0 + z1) / 2, am], d: [a1 - a0, z1 - z0, grosor], rot: horiz ? 0 : Math.PI / 2 }); };
      for (const v of g.muros[k].vanos) {
        const clave = [horiz ? 'h' : 'v', fijo.toFixed(2), v.a0.toFixed(2), v.a1.toFixed(2), v.z0.toFixed(2)].join('|'); if (vistos.has(clave)) continue; vistos.add(clave);
        const z1 = Math.min(H, v.z1);
        cajaC(v.a0, v.a0 + fm, v.z0, z1, gm, 'marco'); cajaC(v.a1 - fm, v.a1, v.z0, z1, gm, 'marco'); cajaC(v.a0, v.a1, z1 - fm, z1, gm, 'marco');
        if (v.puerta) cajaC(v.a0 + fm, v.a1 - fm, 0, z1 - fm, 0.04, 'hoja');
        else { cajaC(v.a0, v.a1, v.z0, v.z0 + fm, gm, 'marco'); cajaC((v.a0 + v.a1) / 2 - 0.02, (v.a0 + v.a1) / 2 + 0.02, v.z0, z1, 0.05, 'marco'); cajaC(v.a0 + fm, v.a1 - fm, v.z0 + fm, z1 - fm, 0.012, 'vidrio'); }
      }
    }
  }
  return out;
}
function esquinas(b) {
  const [cx, cy, cz] = b.c, [lx, ly, lz] = b.d.map((v) => v / 2); const c = Math.cos(b.rot), s = Math.sin(b.rot);
  const pts = [];
  for (const [a, e, f] of [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]) {
    const u = a * lx, v = e * ly, w = f * lz; // u: a lo largo del muro, w: espesor
    pts.push([cx + u * c - w * s, cy + v, cz + u * s + w * c]); // plano: x, alto, y
  }
  return pts;
}
const CARAS = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
function exportarOBJ(edif) {
  const bs = cajas3D(edif).filter((b) => !b.oculto); let v = 1; const L = ['# Memorias de Obra · ' + edif.nombre, '# Unidades: metros. Eje Y hacia arriba.'];
  let g = '';
  for (const b of bs) {
    const nombreG = (b.grupo + '_' + b.tipo).replace(/[^\wÑñ]+/g, '_');
    if (nombreG !== g) { L.push('g ' + nombreG); g = nombreG; }
    for (const [x, y, z] of esquinas(b)) L.push(`v ${x.toFixed(3)} ${y.toFixed(3)} ${(-z).toFixed(3)}`);
    for (const f of CARAS) L.push('f ' + f.map((i) => i + v).join(' '));
    v += 8;
  }
  return new Blob([L.join('\n')], { type: 'text/plain' });
}
function exportarDXF(edif) {
  const bs = cajas3D(edif).filter((b) => !b.oculto); const L = ['0', 'SECTION', '2', 'ENTITIES'];
  for (const b of bs) {
    const P8 = esquinas(b); const capa = { piso: 'PISOS', placa: 'PLACAS', elemento: 'ELEMENTOS', marco: 'CARPINTERIA', hoja: 'CARPINTERIA', vidrio: 'VIDRIOS' }[b.tipo] || 'MUROS';
    for (const f of CARAS) {
      L.push('0', '3DFACE', '8', capa);
      f.forEach((i, j) => { const [x, y, z] = P8[i]; L.push(String(10 + j), x.toFixed(3), String(20 + j), z.toFixed(3), String(30 + j), y.toFixed(3)); });
    }
  }
  L.push('0', 'ENDSEC', '0', 'EOF');
  return new Blob([L.join('\r\n')], { type: 'application/dxf' });
}

/* ---------- Texturas dibujadas en la app (funcionan sin señal) ---------- */
function texturaCanvas(tipo) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const ruido = (n, a, b, col) => { for (let i = 0; i < n; i++) { g.fillStyle = col(); g.fillRect(Math.random() * 256, Math.random() * 256, a + Math.random() * b, a + Math.random() * b); } };
  if (tipo === 'ceramica') {
    g.fillStyle = '#eef0f1'; g.fillRect(0, 0, 256, 256); ruido(500, 1, 2, () => `rgba(120,130,140,${Math.random() * 0.06})`);
    g.strokeStyle = '#b9c0c6'; g.lineWidth = 3; for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, 256); g.stroke(); g.beginPath(); g.moveTo(0, i * 64); g.lineTo(256, i * 64); g.stroke(); }
  } else if (tipo === 'granito') {
    g.fillStyle = '#d8d0c3'; g.fillRect(0, 0, 256, 256);
    ruido(2500, 1, 2, () => ['rgba(90,80,70,.5)', 'rgba(255,255,255,.6)', 'rgba(150,135,120,.5)', 'rgba(40,40,40,.35)'][Math.floor(Math.random() * 4)]);
    g.strokeStyle = 'rgba(120,110,100,.45)'; g.lineWidth = 2; for (let i = 0; i <= 2; i++) { g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, 256); g.stroke(); g.beginPath(); g.moveTo(0, i * 128); g.lineTo(256, i * 128); g.stroke(); }
  } else if (tipo === 'concreto') {
    g.fillStyle = '#b8b6b1'; g.fillRect(0, 0, 256, 256); ruido(3000, 1, 3, () => `rgba(${Math.random() < 0.5 ? '80,80,80' : '230,230,230'},${Math.random() * 0.25})`);
  } else if (tipo === 'madera') {
    g.fillStyle = '#9a6a3c'; g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 3) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '60,35,15' : '190,140,90'},${0.08 + Math.random() * 0.12})`; g.fillRect(0, y, 256, 1 + Math.random() * 2); }
  } else if (tipo === 'pintura') {
    g.fillStyle = '#f3f0ea'; g.fillRect(0, 0, 256, 256); ruido(1800, 1, 1, () => `rgba(150,140,130,${Math.random() * 0.06})`);
  } else if (tipo === 'terreno') {
    g.fillStyle = '#a9b28f'; g.fillRect(0, 0, 256, 256); ruido(4000, 1, 3, () => `rgba(${Math.random() < 0.5 ? '90,110,70' : '170,160,120'},${Math.random() * 0.35})`);
  }
  return c;
}
const tipoPiso = (nombre) => /PLACA|ANDÉN|ANDEN|EXTERIOR|PATIO/i.test(nombre) ? 'concreto' : /BAÑO|DUCHA|INODORO|LAVAMANO|SANITARIO|COCINA/i.test(nombre) ? 'ceramica' : 'granito';

async function abrir3D(edifId) {
  const edif = edifBy(edifId); if (!edif) return;
  const host = document.createElement('div'); host.className = 'sheet'; host.style.zIndex = 65; host.style.paddingBottom = '0'; host.style.overflow = 'hidden';
  document.body.appendChild(host);
  // ítems con medidas ligadas a espacios de esta edificación
  const meds = vivas().filter((m) => m.esp && espBy(m.esp) && espBy(m.esp).edif.id === edif.id);
  const itemsCon = [...new Set(meds.map((m) => m.item))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  host.innerHTML = `<div class="bar gut dark"><button class="iconbtn" type="button" id="v3Back" aria-label="Cerrar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 6l12 12M18 6L6 18"/></svg></button><h2><span class="eyebrow" style="display:block">Modelo 3D</span>${esc(edif.nombre)}</h2></div>
    <div class="gut" style="padding-block:8px;background:var(--head);display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <label class="f" style="flex:1;min-width:200px;color:var(--head-mut)"><span>Ver</span><select id="v3Modo"><option value="real">Acabados (vista real)</option><option value="estado">Estado de medición</option>${itemsCon.map((c) => `<option value="it:${esc(c)}">Avance del ítem ${esc(c)} · ${esc(((itemBy(c) || {}).desc || '').slice(0, 38))}</option>`).join('')}</select></label>
      <label class="toggle" style="padding:8px 10px;background:var(--head-2);color:var(--head-ink);border-color:var(--head-2)"><input type="checkbox" id="v3Nom" checked> Nombres</label>
    </div>
    <div id="v3Box" style="position:relative;height:calc(100% - 300px);min-height:300px;background:#dfe7ef;touch-action:none"><div class="hint" style="padding:20px">Cargando el modelo…</div></div>
    <div class="content gut" style="padding-block:10px;gap:10px">
      <div id="v3Ley" class="leyenda"></div>
      <div class="actions"><button class="btn" type="button" id="v3Obj">Descargar .obj</button><button class="btn" type="button" id="v3Dxf">Descargar .dxf (AutoCAD)</button></div>
    </div>`;
  let vivo = true;
  $('#v3Back', host).addEventListener('click', () => { vivo = false; host.remove(); });
  const nomArch = edif.nombre.replace(/[^\wÑñ-]+/g, '_');
  $('#v3Obj', host).addEventListener('click', () => ofrecerArchivo(exportarOBJ(edif), `MODELO_${nomArch}.obj`, 'Modelo 3D', 'Formato OBJ: lo abren SketchUp, Blender, Revit (con complemento) y la mayoría de programas 3D. Unidades en metros.'));
  $('#v3Dxf', host).addEventListener('click', () => ofrecerArchivo(exportarDXF(edif), `MODELO_${nomArch}.dxf`, 'Modelo 3D', 'DXF con caras 3D en capas MUROS, PISOS, CARPINTERIA, VIDRIOS y ELEMENTOS: lo abren AutoCAD, ArchiCAD, Revit y SketchUp. Unidades en metros.'));
  try { await cargarScript('three.min.js', 'THREE'); } catch (e) { $('#v3Box', host).innerHTML = `<div class="note bad" style="margin:16px">${esc(e.message)}</div>`; return; }
  const THREE = window.THREE; const box = $('#v3Box', host); box.innerHTML = '';
  const W = () => box.clientWidth, H = () => box.clientHeight;
  const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.setSize(W(), H());
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
  box.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  // cielo degradado
  { const c = document.createElement('canvas'); c.width = 2; c.height = 256; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#9fc3e6'); gr.addColorStop(1, '#eef3f7'); g.fillStyle = gr; g.fillRect(0, 0, 2, 256); const tx = new THREE.CanvasTexture(c); tx.encoding = THREE.sRGBEncoding; scene.background = tx; }
  scene.add(new THREE.HemisphereLight(0xe3edf7, 0x8a8f7a, 0.65));
  const bs = cajas3D(edif);
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const b of bs) { minX = Math.min(minX, b.c[0] - b.d[0] / 2); maxX = Math.max(maxX, b.c[0] + b.d[0] / 2); minZ = Math.min(minZ, -b.c[2] - b.d[2] / 2); maxZ = Math.max(maxZ, -b.c[2] + b.d[2] / 2); }
  const centro = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  const tam = Math.max(maxX - minX, maxZ - minZ, 4);
  const sol = new THREE.DirectionalLight(0xfff4e5, 1.05); sol.position.set(centro.x - tam * 0.6, tam * 1.2, centro.z + tam * 0.8); sol.target.position.copy(centro);
  sol.castShadow = true; sol.shadow.mapSize.set(2048, 2048); const sc = sol.shadow.camera; sc.left = sc.bottom = -tam * 0.8; sc.right = sc.top = tam * 0.8; sc.near = 0.5; sc.far = tam * 4; sol.shadow.bias = -0.0005;
  scene.add(sol); scene.add(sol.target);
  const tex = (tipo, rx, ry) => { const t = new THREE.CanvasTexture(texturaCanvas(tipo)); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return t; };
  const std = (o) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.85, metalness: 0 }, o));
  // terreno
  const suelo = new THREE.Mesh(new THREE.PlaneGeometry(tam * 4, tam * 4), std({ map: tex('terreno', tam / 3, tam / 3), roughness: 1 }));
  suelo.rotation.x = -Math.PI / 2; suelo.position.set(centro.x, -0.065, centro.z); suelo.receiveShadow = true; scene.add(suelo);
  const M = {
    muro: std({ map: tex('pintura', 1, 1), color: 0xffffff }), supuesto: std({ color: 0xd4dbe3 }), placa: std({ map: tex('concreto', 2, 2), color: 0xffffff }),
    marco: std({ color: 0x3b4148, metalness: 0.5, roughness: 0.4 }), hoja: std({ map: tex('madera', 1, 2) }),
    vidrio: new THREE.MeshPhysicalMaterial({ color: 0xa9cfe8, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.1 }),
    elemento: std({ map: tex('madera', 1, 1), color: 0xe7c9a4 }),
    medido: std({ color: 0x8fb9ec }), revisar: std({ color: 0xf3b571 }), vacio: std({ color: 0xd3d8dd }),
    hecho: std({ color: 0x2f7fe0 }), falta: std({ color: 0xe6e9ec, transparent: true, opacity: 0.75 }), cieloHecho: std({ color: 0x2f7fe0, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
  };
  const mallas = []; const bordes = new THREE.LineBasicMaterial({ color: 0x6b7480, transparent: true, opacity: 0.6 });
  for (const b of bs) {
    const geo = new THREE.BoxGeometry(b.d[0], b.d[1], b.d[2]);
    let mat;
    if (b.tipo === 'piso') { const tp = tipoPiso(b.nombre || ''); const lado = tp === 'ceramica' ? 1.2 : tp === 'granito' ? 1.6 : 3; mat = std({ map: tex(tp, b.d[0] / lado, b.d[2] / lado), roughness: tp === 'ceramica' ? 0.35 : 0.6 }); b.matReal = mat; }
    else mat = M[b.tipo] || M.muro;
    if (b.tipo === 'muro' && b.supuesto) mat = M.supuesto;
    if (b.tipo === 'placa') mat = M.placa;
    const mesh = new THREE.Mesh(geo, mat); mesh.position.set(b.c[0], b.c[1], -b.c[2]); mesh.rotation.y = b.rot;
    mesh.castShadow = b.tipo !== 'vidrio' && b.tipo !== 'cielo'; mesh.receiveShadow = true; mesh.visible = !b.oculto;
    mesh.userData = b; b.matBase = mat; scene.add(mesh); mallas.push(mesh);
    if (b.tipo === 'muro' || b.tipo === 'elemento') { const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), bordes); mesh.add(e); }
  }
  // nombres de los espacios
  const rotulos = [];
  for (const b of bs.filter((x) => x.tipo === 'piso' || x.tipo === 'placa')) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128; const g = c.getContext('2d');
    g.fillStyle = 'rgba(16,22,29,.82)'; const r = 20; g.beginPath(); g.moveTo(r, 0); g.arcTo(512, 0, 512, 128, r); g.arcTo(512, 128, 0, 128, r); g.arcTo(0, 128, 0, 0, r); g.arcTo(0, 0, 512, 0, r); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 44px Arial'; g.textAlign = 'center'; g.fillText(corto(b.nombre).slice(0, 20), 256, 58);
    g.fillStyle = '#ffb020'; g.font = '34px Arial'; g.fillText(`${fmt(b.d[0] * b.d[2])} m²`, 256, 104);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false }));
    const esc = Math.max(1.6, Math.min(4.5, Math.sqrt(b.d[0] * b.d[2]) / 2.2)); sp.scale.set(esc, esc / 4, 1);
    sp.position.set(b.c[0], b.tipo === 'placa' ? b.c[1] + 0.7 : 3.1, -b.c[2]); sp.renderOrder = 10; scene.add(sp); rotulos.push(sp);
  }
  const cam = new THREE.PerspectiveCamera(42, W() / H(), 0.1, 3000);
  const orb = { th: -0.9, ph: 0.85, r: tam * 0.8 };
  const ubicar = () => { cam.position.set(centro.x + orb.r * Math.sin(orb.ph) * Math.cos(orb.th), orb.r * Math.cos(orb.ph), centro.z + orb.r * Math.sin(orb.ph) * Math.sin(orb.th)); cam.lookAt(centro); renderer.render(scene, cam); };
  // modos de vista
  const leyenda = $('#v3Ley', host);
  const aplicarModo = (modo) => {
    let hechos = null, total = 0, und = '';
    if (modo.startsWith('it:')) {
      const cod = modo.slice(3); hechos = new Set(); und = (itemBy(cod) || {}).und || '';
      for (const m of meds.filter((x) => x.item === cod)) {
        total += calcMedida(tipoDe(cod), m);
        const mm = /^m([1-4])$/.exec(m.parte || '');
        if (mm && !m.desc) hechos.add(m.esp + '|' + mm[1]);
        else if (m.parte === 'piso') hechos.add(m.esp + '|piso');
        else if (m.parte === 'cielo') hechos.add(m.esp + '|cielo');
        else if (!m.desc) hechos.add(m.esp + '|todo');
      }
    }
    const Mo = modelo();
    for (const mesh of mallas) {
      const b = mesh.userData;
      if (b.tipo === 'cielo') { mesh.visible = !!(hechos && hechos.has(b.esp + '|cielo')); mesh.material = M.cieloHecho; continue; }
      if (modo === 'real') { mesh.material = b.matBase; continue; }
      if (modo === 'estado') { if (b.tipo === 'piso') { const o = Mo[b.esp]; mesh.material = o ? (o.revisar.length ? M.revisar : M.medido) : M.vacio; } else mesh.material = b.matBase; continue; }
      const todo = hechos.has(b.esp + '|todo');
      const todoB = b.espB && hechos.has(b.espB + '|todo');
      if (b.tipo === 'muro') mesh.material = hechos.has(b.esp + '|' + b.k) || (b.espB && hechos.has(b.espB + '|' + b.kB)) || todo || todoB ? M.hecho : M.falta;
      else if (b.tipo === 'piso') mesh.material = hechos.has(b.esp + '|piso') || todo ? M.hecho : M.vacio;
      else mesh.material = b.matBase;
    }
    leyenda.innerHTML = modo === 'real' ? '<span>Pisos: cerámica en baños, granito en alojamientos, concreto en placas · muros sin alto medido en gris azulado (2,40 m supuesto) · placas aéreas en concreto a la altura de los muros</span>'
      : modo === 'estado' ? '<span><i class="sw medido"></i>Medido</span><span><i class="sw revisar"></i>No cuadra con el plano</span><span><i class="sw vacio"></i>Sin medir</span>'
      : `<span><i class="sw" style="background:#2f7fe0;border-color:#2f7fe0"></i>Ya medido en este ítem</span><span><i class="sw vacio"></i>Falta</span><span><b class="num">${fmt(total)} ${esc(und)}</b> ligados al plano</span>`;
    ubicar();
  };
  $('#v3Modo', host).addEventListener('change', (e) => aplicarModo(e.target.value));
  $('#v3Nom', host).addEventListener('change', (e) => { rotulos.forEach((s) => (s.visible = e.target.checked)); ubicar(); });
  aplicarModo('real');
  // Controles: 1 dedo gira · 2 dedos desplazan y acercan · mouse: izquierdo gira, derecho (o Ctrl) desplaza, rueda acerca
  const toques = new Map(); let dist0 = 0, medio0 = null, botonDer = false;
  const el = renderer.domElement;
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  const desplazar = (dx, dy) => {
    const k = orb.r * 0.0016;
    const fx = -Math.sin(orb.th), fz = Math.cos(orb.th); // eje lateral de la cámara
    const ax = Math.cos(orb.th), az = Math.sin(orb.th);   // hacia la cámara, en el plano
    centro.x += (-dx * fx + dy * ax) * k * -1; centro.z += (-dx * fz + dy * az) * k * -1;
  };
  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId); toques.set(e.pointerId, [e.clientX, e.clientY]);
    botonDer = e.button === 2 || e.ctrlKey || e.shiftKey;
    if (toques.size === 2) { const [a, b] = [...toques.values()]; dist0 = Math.hypot(a[0] - b[0], a[1] - b[1]); medio0 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
  });
  el.addEventListener('pointermove', (e) => {
    if (!toques.has(e.pointerId)) return;
    const prev = toques.get(e.pointerId); toques.set(e.pointerId, [e.clientX, e.clientY]);
    if (toques.size === 1 && botonDer) desplazar(e.clientX - prev[0], e.clientY - prev[1]);
    else if (toques.size === 1) { orb.th += (e.clientX - prev[0]) * 0.008; orb.ph = Math.min(1.5, Math.max(0.12, orb.ph - (e.clientY - prev[1]) * 0.008)); }
    else if (toques.size === 2) {
      const [a, b] = [...toques.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (dist0) orb.r = Math.min(tam * 4, Math.max(1.5, orb.r * dist0 / d));
      if (medio0) desplazar(m[0] - medio0[0], m[1] - medio0[1]);
      dist0 = d; medio0 = m;
    }
    ubicar();
  });
  const soltar = (e) => { toques.delete(e.pointerId); dist0 = 0; medio0 = null; if (!toques.size) botonDer = false; };
  el.addEventListener('pointerup', soltar); el.addEventListener('pointercancel', soltar);
  el.addEventListener('wheel', (e) => { e.preventDefault(); orb.r = Math.min(tam * 4, Math.max(1.5, orb.r * (e.deltaY > 0 ? 1.1 : 0.9))); ubicar(); }, { passive: false });
  // doble toque sobre un espacio: acercarse a él
  const ray = new THREE.Raycaster(); let ultimoToque = 0;
  el.addEventListener('pointerup', (e) => {
    const ahora = Date.now(); if (ahora - ultimoToque > 320) { ultimoToque = ahora; return; } ultimoToque = 0;
    const r = el.getBoundingClientRect(); ray.setFromCamera({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }, cam);
    const hit = ray.intersectObjects(mallas.filter((m) => m.visible && m.userData.tipo === 'piso'))[0];
    if (hit) { const b = hit.object.userData; centro.set(b.c[0], 0, -b.c[2]); orb.r = Math.max(4, Math.sqrt(b.d[0] * b.d[2]) * 1.6); ubicar(); toast(b.nombre); }
  });
  // botones flotantes
  const inicial = { x: centro.x, z: centro.z, th: orb.th, ph: orb.ph, r: orb.r };
  const bot = document.createElement('div'); bot.className = 'v3-botones';
  bot.innerHTML = `<button type="button" data-a="mas" aria-label="Acercar">+</button><button type="button" data-a="menos" aria-label="Alejar">−</button><button type="button" data-a="planta" aria-label="Ver desde arriba">⬒</button><button type="button" data-a="inicio" aria-label="Volver a la vista inicial">⟲</button>`;
  box.appendChild(bot);
  bot.addEventListener('click', (e) => {
    const a = e.target.closest('button'); if (!a) return;
    if (a.dataset.a === 'mas') orb.r = Math.max(1.5, orb.r * 0.8);
    if (a.dataset.a === 'menos') orb.r = Math.min(tam * 4, orb.r * 1.25);
    if (a.dataset.a === 'planta') { orb.ph = 0.12; }
    if (a.dataset.a === 'inicio') { centro.x = inicial.x; centro.z = inicial.z; orb.th = inicial.th; orb.ph = inicial.ph; orb.r = inicial.r; }
    ubicar();
  });
  const ayuda = document.createElement('div'); ayuda.className = 'v3-ayuda';
  ayuda.textContent = matchMedia('(pointer: coarse)').matches ? '1 dedo: girar · 2 dedos: mover y acercar · doble toque en un espacio: ir a él' : 'Clic izquierdo: girar · clic derecho o Ctrl: mover · rueda: acercar · doble clic en un espacio: ir a él';
  box.appendChild(ayuda); setTimeout(() => { ayuda.style.opacity = '0'; }, 6000);
  const ajustar = () => { if (!vivo) return; renderer.setSize(W(), H()); cam.aspect = W() / H(); cam.updateProjectionMatrix(); ubicar(); };
  addEventListener('resize', ajustar);
}
