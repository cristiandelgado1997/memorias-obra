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
  for (const s of edif.espacios) {
    const o = M[s.id]; const r = resumenEspacio(s, o);
    const x0 = s.x0, y0 = s.y0, w = r.W, h = r.H;
    const estado = o ? (o.revisar.length ? 'revisar' : 'medido') : 'vacio';
    out.push({ grupo: s.nombre, tipo: 'piso', estado, c: [x0 + w / 2, -0.03, y0 + h / 2], d: [w, 0.06, h], rot: 0 });
    for (const el of elementosDe(s.id)) {
      const [a, b, c, d2] = rectElemento(el, w, h); const al = num(el.alto) || 0.9;
      out.push({ grupo: s.nombre + ' ' + el.nombre, tipo: 'elemento', c: [x0 + (a + c) / 2, al / 2, y0 + (b + d2) / 2], d: [c - a, al, d2 - b], rot: 0 });
    }
    // inicio y dirección de cada muro (posición medida desde la izquierda, mirando desde dentro)
    const def = { 1: [x0 + w, y0, -1, 0, 0, 1], 2: [x0 + w, y0 + h, 0, -1, -1, 0], 3: [x0, y0 + h, 1, 0, 0, -1], 4: [x0, y0, 0, 1, 1, 0] };
    for (let k = 1; k <= 4; k++) {
      const [sx, sy, dx, dy, nx, ny] = def[k];
      const L = k === 1 || k === 3 ? w : h;
      const Hm = (o && (o.muros[k].alto || o.alto)) || null; const H = Hm || 2.4;
      const vanos = ((o && o.muros[k].vanos) || []).map((v, i) => {
        const pos = v.pos != null ? v.pos : (L - v.ancho) / 2 + i * 0.15;
        const sill = antepecho(v).z;
        return { u0: Math.max(0, pos), u1: Math.min(L, pos + v.ancho), z0: sill, z1: Math.min(H, sill + v.alto) };
      }).sort((a, b) => a.u0 - b.u0);
      const piezas = []; let u = 0;
      for (const v of vanos) {
        if (v.u0 > u) piezas.push([u, v.u0, 0, H]);
        if (v.z0 > 0) piezas.push([v.u0, v.u1, 0, v.z0]);
        if (v.z1 < H) piezas.push([v.u0, v.u1, v.z1, H]);
        u = Math.max(u, v.u1);
      }
      if (u < L) piezas.push([u, L, 0, H]);
      const rot = Math.atan2(dy, dx);
      for (const [a, b, z0, z1] of piezas) {
        if (b - a < 0.01 || z1 - z0 < 0.01) continue;
        const um = (a + b) / 2;
        out.push({ grupo: s.nombre, tipo: 'muro', supuesto: !Hm, c: [sx + dx * um + nx * ESPESOR / 2, (z0 + z1) / 2, sy + dy * um + ny * ESPESOR / 2], d: [b - a, z1 - z0, ESPESOR], rot });
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
  const bs = cajas3D(edif); let v = 1; const L = ['# Memorias de Obra · ' + edif.nombre, '# Unidades: metros. Eje Y hacia arriba.'];
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
  const bs = cajas3D(edif); const L = ['0', 'SECTION', '2', 'ENTITIES'];
  for (const b of bs) {
    const P8 = esquinas(b); const capa = b.tipo === 'piso' ? 'PISOS' : b.tipo === 'elemento' ? 'ELEMENTOS' : 'MUROS';
    for (const f of CARAS) {
      L.push('0', '3DFACE', '8', capa);
      f.forEach((i, j) => { const [x, y, z] = P8[i]; L.push(String(10 + j), x.toFixed(3), String(20 + j), z.toFixed(3), String(30 + j), y.toFixed(3)); });
    }
  }
  L.push('0', 'ENDSEC', '0', 'EOF');
  return new Blob([L.join('\r\n')], { type: 'application/dxf' });
}

async function abrir3D(edifId) {
  const edif = edifBy(edifId); if (!edif) return;
  const host = document.createElement('div'); host.className = 'sheet'; host.style.zIndex = 65; host.style.paddingBottom = '0';
  document.body.appendChild(host);
  host.innerHTML = `<div class="bar gut dark"><button class="iconbtn" type="button" id="v3Back" aria-label="Cerrar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 6l12 12M18 6L6 18"/></svg></button><h2><span class="eyebrow" style="display:block">Modelo 3D</span>${esc(edif.nombre)}</h2></div>
    <div id="v3Box" style="position:relative;height:calc(100% - 190px);min-height:320px;background:#e9edf1;touch-action:none"><div class="hint" style="padding:20px">Cargando el modelo…</div></div>
    <div class="content gut" style="padding-block:10px">
      <div class="leyenda"><span><i class="sw medido"></i>Medido</span><span><i class="sw revisar"></i>No cuadra</span><span><i class="sw vacio"></i>Sin medir / alto supuesto 2,40</span></div>
      <div class="actions"><button class="btn" type="button" id="v3Obj">Descargar .obj</button><button class="btn" type="button" id="v3Dxf">Descargar .dxf (AutoCAD)</button></div>
    </div>`;
  let vivo = true;
  $('#v3Back', host).addEventListener('click', () => { vivo = false; host.remove(); });
  $('#v3Obj', host).addEventListener('click', () => ofrecerArchivo(exportarOBJ(edif), `MODELO_${edif.nombre.replace(/[^\wÑñ-]+/g, '_')}.obj`, 'Modelo 3D', 'Formato OBJ: lo abren SketchUp, Blender, Revit (con complemento) y la mayoría de programas 3D. Unidades en metros.'));
  $('#v3Dxf', host).addEventListener('click', () => ofrecerArchivo(exportarDXF(edif), `MODELO_${edif.nombre.replace(/[^\wÑñ-]+/g, '_')}.dxf`, 'Modelo 3D', 'Formato DXF con caras 3D en las capas MUROS y PISOS: lo abren AutoCAD, ArchiCAD, Revit y SketchUp. Unidades en metros.'));
  try { await cargarScript('three.min.js', 'THREE'); } catch (e) { $('#v3Box', host).innerHTML = `<div class="note bad" style="margin:16px">${esc(e.message)}</div>`; return; }
  const THREE = window.THREE; const box = $('#v3Box', host); box.innerHTML = '';
  const W = () => box.clientWidth, H = () => box.clientHeight;
  const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.setSize(W(), H());
  box.appendChild(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xe9edf1);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa7b4, 0.85));
  const sol = new THREE.DirectionalLight(0xffffff, 0.55); sol.position.set(-20, 40, 25); scene.add(sol);
  const mats = {
    medido: new THREE.MeshLambertMaterial({ color: 0x9ec3f0 }), revisar: new THREE.MeshLambertMaterial({ color: 0xf6c38b }), vacio: new THREE.MeshLambertMaterial({ color: 0xd9dee4 }),
    muro: new THREE.MeshLambertMaterial({ color: 0xf4f6f8 }), elemento: new THREE.MeshLambertMaterial({ color: 0xc89b6d }), supuesto: new THREE.MeshLambertMaterial({ color: 0xc7ccd2, transparent: true, opacity: 0.55 }),
  };
  const bs = cajas3D(edif);
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, maxY = 0;
  const bordes = new THREE.LineBasicMaterial({ color: 0x5b6774 });
  for (const b of bs) {
    const geo = new THREE.BoxGeometry(b.d[0], b.d[1], b.d[2]);
    const mesh = new THREE.Mesh(geo, b.tipo === 'piso' ? mats[b.estado] : b.tipo === 'elemento' ? mats.elemento : (b.supuesto ? mats.supuesto : mats.muro));
    mesh.position.set(b.c[0], b.c[1], -b.c[2]); mesh.rotation.y = b.rot;
    scene.add(mesh);
    if (b.tipo !== 'piso') { const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), bordes); e.position.copy(mesh.position); e.rotation.copy(mesh.rotation); scene.add(e); }
    minX = Math.min(minX, b.c[0]); maxX = Math.max(maxX, b.c[0]); minZ = Math.min(minZ, -b.c[2]); maxZ = Math.max(maxZ, -b.c[2]); maxY = Math.max(maxY, b.c[1] * 2);
  }
  const centro = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  const tam = Math.max(maxX - minX, maxZ - minZ, 4);
  const cam = new THREE.PerspectiveCamera(45, W() / H(), 0.1, 2000);
  const orb = { th: -0.9, ph: 0.95, r: tam * 1.25 };
  const ubicar = () => { cam.position.set(centro.x + orb.r * Math.sin(orb.ph) * Math.cos(orb.th), orb.r * Math.cos(orb.ph), centro.z + orb.r * Math.sin(orb.ph) * Math.sin(orb.th)); cam.lookAt(centro); renderer.render(scene, cam); };
  ubicar();
  // girar con el dedo o el mouse; acercar con la rueda o pellizcando
  const toques = new Map(); let dist0 = 0;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); toques.set(e.pointerId, [e.clientX, e.clientY]); if (toques.size === 2) { const [a, b] = [...toques.values()]; dist0 = Math.hypot(a[0] - b[0], a[1] - b[1]); } });
  el.addEventListener('pointermove', (e) => {
    if (!toques.has(e.pointerId)) return;
    const prev = toques.get(e.pointerId); toques.set(e.pointerId, [e.clientX, e.clientY]);
    if (toques.size === 1) { orb.th += (e.clientX - prev[0]) * 0.008; orb.ph = Math.min(1.5, Math.max(0.12, orb.ph - (e.clientY - prev[1]) * 0.008)); }
    else if (toques.size === 2) { const [a, b] = [...toques.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (dist0) orb.r = Math.min(tam * 4, Math.max(2, orb.r * dist0 / d)); dist0 = d; }
    ubicar();
  });
  const soltar = (e) => { toques.delete(e.pointerId); dist0 = 0; };
  el.addEventListener('pointerup', soltar); el.addEventListener('pointercancel', soltar);
  el.addEventListener('wheel', (e) => { e.preventDefault(); orb.r = Math.min(tam * 4, Math.max(2, orb.r * (e.deltaY > 0 ? 1.1 : 0.9))); ubicar(); }, { passive: false });
  const ajustar = () => { if (!vivo) return; renderer.setSize(W(), H()); cam.aspect = W() / H(); cam.updateProjectionMatrix(); ubicar(); };
  addEventListener('resize', ajustar);
}
