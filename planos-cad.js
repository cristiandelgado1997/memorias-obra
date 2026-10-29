/* ================= Planos en PDF con presentación tipo AutoCAD (vectorial) ================= */
'use strict';
const ESCALAS = [20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000];
const elegirEscala = (anchoM, altoM, anchoMm, altoMm) => ESCALAS.find((e) => anchoM * 1000 / e <= anchoMm && altoM * 1000 / e <= altoMm) || 1000;
const MAY = (s) => String(s || '').toUpperCase();
const f2 = (x) => (Math.round(x * 100) / 100).toFixed(2).replace('.', ',');

function Dibujante(pdf) {
  const lw = { gruesa: 0.5, media: 0.3, fina: 0.15, muyfina: 0.08 };
  const D = {
    pdf,
    // vista: origen en mm del papel, escala, ventana en metros (y hacia arriba)
    vista(ox, oy, escala, x0, y1) { D.ox = ox; D.oy = oy; D.k = 1000 / escala; D.x0 = x0; D.y1 = y1; },
    X: (x) => D.ox + (x - D.x0) * D.k,
    Y: (y) => D.oy + (D.y1 - y) * D.k,
    grosor(g) { pdf.setLineWidth(lw[g] || g); },
    color(c) { const v = c || [0, 0, 0]; pdf.setDrawColor(v[0], v[1], v[2]); pdf.setTextColor(v[0], v[1], v[2]); },
    linea(x1, y1, x2, y2) { pdf.line(D.X(x1), D.Y(y1), D.X(x2), D.Y(y2)); },
    lineaMm(x1, y1, x2, y2) { pdf.line(x1, y1, x2, y2); },
    rellenoM(x0, y0, x1, y1, gris) { pdf.setFillColor(gris, gris, gris); pdf.rect(D.X(x0), D.Y(y1), (x1 - x0) * D.k, (y1 - y0) * D.k, 'F'); },
    rectM(x0, y0, x1, y1) { pdf.rect(D.X(x0), D.Y(y1), (x1 - x0) * D.k, (y1 - y0) * D.k, 'S'); },
    texto(t, x, y, o = {}) {
      pdf.setFont('helvetica', o.negrita ? 'bold' : 'normal'); pdf.setFontSize(o.pt || 6.5); const s = String(t);
      if (o.ang === 90) { const w = pdf.getTextWidth(s); const off = (o.al || 'center') === 'center' ? w / 2 : 0; pdf.text(s, x, y + off, { angle: 90 }); }
      else pdf.text(s, x, y, { align: o.al || 'center' });
    },
    arcoM(cx, cy, r, a0, a1, n = 18) { let px = cx + r * Math.cos(a0), py = cy + r * Math.sin(a0); for (let i = 1; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a); D.linea(px, py, x, y); px = x; py = y; } },
    // rayado a 45° dentro de un rectángulo (en mm de papel)
    rayado(xa, ya, xb, yb, paso = 1.6) {
      const w = xb - xa, h = yb - ya;
      for (let c = -h; c < w; c += paso) {
        const p = []; // intersecciones de y = x - c dentro del rectángulo (coords locales)
        const cand = [[c, 0], [c + h, h], [0, -c], [w, w - c]];
        for (const [x, y] of cand) if (x >= -1e-6 && x <= w + 1e-6 && y >= -1e-6 && y <= h + 1e-6) p.push([x, y]);
        if (p.length >= 2) { p.sort((a, b) => a[0] - b[0]); pdf.line(xa + p[0][0], yb - p[0][1], xa + p[p.length - 1][0], yb - p[p.length - 1][1]); }
      }
    },
    // nube de revisión alrededor de un rectángulo (mm de papel)
    nube(xa, ya, xb, yb, r = 1.6) {
      const tramo = (x1, y1, x2, y2, nx, ny) => {
        const L = Math.hypot(x2 - x1, y2 - y1); const n = Math.max(1, Math.round(L / (2 * r)));
        const ux = (x2 - x1) / L, uy = (y2 - y1) / L; const rr = L / n / 2;
        for (let i = 0; i < n; i++) {
          const cx = x1 + ux * rr * (2 * i + 1), cy = y1 + uy * rr * (2 * i + 1);
          let px = cx - ux * rr, py = cy - uy * rr;
          for (let j = 1; j <= 8; j++) { const a = Math.PI * j / 8; const x = cx - Math.cos(a) * rr * ux + Math.sin(a) * rr * nx, y = cy - Math.cos(a) * rr * uy + Math.sin(a) * rr * ny; pdf.line(px, py, x, y); px = x; py = y; }
        }
      };
      tramo(xa, ya, xb, ya, 0, -1); tramo(xb, ya, xb, yb, 1, 0); tramo(xb, yb, xa, yb, 0, 1); tramo(xa, yb, xa, ya, -1, 0);
    },
    // cota arquitectónica (puntos en metros; desplazamiento en mm, + hacia afuera)
    cota(x1, y1, x2, y2, off, texto, o = {}) {
      const P1 = [D.X(x1), D.Y(y1)], P2 = [D.X(x2), D.Y(y2)];
      const horiz = Math.abs(P1[1] - P2[1]) < 0.01;
      const col = o.color || [0, 70, 160];
      pdf.setDrawColor(col[0], col[1], col[2]); pdf.setTextColor(col[0], col[1], col[2]); pdf.setLineWidth(lw.muyfina);
      if (horiz) {
        const y = P1[1] + off; const s = Math.sign(off) || 1;
        pdf.line(P1[0], P1[1] + s * 0.6, P1[0], y + s * 1.2); pdf.line(P2[0], P2[1] + s * 0.6, P2[0], y + s * 1.2);
        pdf.line(Math.min(P1[0], P2[0]) - 1, y, Math.max(P1[0], P2[0]) + 1, y);
        for (const x of [P1[0], P2[0]]) { pdf.setLineWidth(lw.media); pdf.line(x - 0.8, y + 0.8, x + 0.8, y - 0.8); pdf.setLineWidth(lw.muyfina); }
        D.texto(texto, (P1[0] + P2[0]) / 2, y - 0.8, { pt: o.pt || 6 });
      } else {
        const x = P1[0] + off; const s = Math.sign(off) || 1;
        pdf.line(P1[0] + s * 0.6, P1[1], x + s * 1.2, P1[1]); pdf.line(P2[0] + s * 0.6, P2[1], x + s * 1.2, P2[1]);
        pdf.line(x, Math.min(P1[1], P2[1]) - 1, x, Math.max(P1[1], P2[1]) + 1);
        for (const y of [P1[1], P2[1]]) { pdf.setLineWidth(lw.media); pdf.line(x - 0.8, y + 0.8, x + 0.8, y - 0.8); pdf.setLineWidth(lw.muyfina); }
        D.texto(texto, x - 0.8, (P1[1] + P2[1]) / 2, { pt: o.pt || 6, ang: 90 });
      }
      D.color();
    },
  };
  return D;
}

/* ---------- Hoja A3 con marco y cajetín ---------- */
function hojaCAD(pdf, D, datos) {
  const W = 420, H = 297;
  pdf.setDrawColor(0, 0, 0); pdf.setLineWidth(0.6); pdf.rect(10, 10, W - 20, H - 20);
  pdf.setLineWidth(0.25); pdf.rect(12, 12, W - 24, H - 24);
  // columna del cajetín
  const cx = 300; pdf.setLineWidth(0.4); pdf.line(cx, 12, cx, H - 12);
  const p = datos.p;
  // rótulo (abajo a la derecha)
  const ry = H - 12 - 92; pdf.line(cx, ry, W - 12, ry);
  const filas = [
    ['PROYECTO', MAY(p.objeto).slice(0, 150)],
    ['CONTRATO', /^\d{4}-\d{2}-\d{2}/.test(p.contrato || '') ? '—' : MAY(p.contrato || '—')],
    ['CONTRATISTA', MAY(p.contratista || '—')],
    ['SUPERVISIÓN', MAY(p.supervisor || '—')],
    ['EDIFICACIÓN', MAY(datos.edif)],
    ['CONTENIDO', MAY(datos.contenido)],
  ];
  let y = ry; const alto = [17, 7, 7, 7, 7, 10];
  filas.forEach(([k, v], i) => {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(4.8); pdf.setTextColor(90, 90, 90); pdf.text(k, cx + 2, y + 2.8);
    pdf.setTextColor(0, 0, 0); pdf.setFont('helvetica', i === 5 ? 'bold' : 'normal'); pdf.setFontSize(i === 0 ? 5.6 : i === 5 ? 8.5 : 6.5);
    pdf.text(pdf.splitTextToSize(v, W - 12 - cx - 4).slice(0, i === 0 ? 3 : 2), cx + 2, y + (i === 0 ? 5.8 : 5.6));
    y += alto[i]; pdf.setLineWidth(0.15); pdf.line(cx, y, W - 12, y);
  });
  // escala, fecha, elaboró, revisó, plano
  const c3 = (W - 12 - cx) / 3;
  const celdas = [['ESCALA', datos.escala || 'INDICADAS'], ['FECHA', datos.fecha], ['HOJA', `${datos.n} DE ${datos.total}`]];
  celdas.forEach(([k, v], i) => { const x = cx + i * c3; pdf.setFontSize(4.8); pdf.setTextColor(90, 90, 90); pdf.setFont('helvetica', 'normal'); pdf.text(k, x + 2, y + 2.8); pdf.setTextColor(0, 0, 0); pdf.setFontSize(7); pdf.text(v, x + 2, y + 7); if (i) pdf.line(x, y, x, y + 9); });
  y += 9; pdf.line(cx, y, W - 12, y);
  const c2 = (W - 12 - cx) / 2;
  [['ELABORÓ', MAY(p.elaboro || '')], ['REVISÓ', MAY(p.reviso || '')]].forEach(([k, v], i) => { const x = cx + i * c2; pdf.setFontSize(4.8); pdf.setTextColor(90, 90, 90); pdf.text(k, x + 2, y + 2.8); pdf.setTextColor(0, 0, 0); pdf.setFontSize(6.5); pdf.text(v, x + 2, y + 7); if (i) pdf.line(x, y, x, y + 10); });
  y += 10; pdf.line(cx, y, W - 12, y);
  pdf.setFontSize(4.8); pdf.setTextColor(90, 90, 90); pdf.text('PLANO No.', cx + 2, y + 3);
  pdf.setTextColor(0, 0, 0); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16); pdf.text(datos.codigo, W - 14, H - 15, { align: 'right' });
  pdf.setFont('helvetica', 'normal');
  return { areaDibujo: [16, 16, cx - 4, H - 16], columna: [cx + 3, 16, W - 15, ry - 3] };
}

function notasCAD(pdf, x, y, w) {
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5); pdf.text('NOTAS', x, y);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(5.4);
  const n = ['1. COTAS EN METROS. MEDIDAS DE OBRA REGISTRADAS EN CAMPO.', '2. * MEDIDA TOMADA DEL PLANO ARQUITECTÓNICO, SIN VERIFICAR EN OBRA.', '3. ~ POSICIÓN O ALTURA DE VANO APROXIMADA (NO MEDIDA).', '4. LAS NUBES DE REVISIÓN SEÑALAN MEDIDAS DE OBRA QUE NO CUADRAN CON EL PLANO.', '5. GENERADO POR LA APP MEMORIAS DE OBRA.'];
  let yy = y + 4; n.forEach((t) => { const l = pdf.splitTextToSize(t, w); pdf.text(l, x, yy); yy += l.length * 2.6; });
  return yy;
}

/* ---------- Planta general (líneas del DWG + rótulos de espacios) ---------- */
// centro del tramo libre más largo de un muro (para poner rótulos sin pisar puertas ni ventanas)
function centroLibre(L, tramos) {
  const t = tramos.map(([a, b]) => [Math.max(0, a), Math.min(L, b)]).sort((p, q) => p[0] - q[0]);
  let u = 0, mejor = [0, 0];
  for (const [a, b] of t) { if (a - u > mejor[1] - mejor[0]) mejor = [u, a]; u = Math.max(u, b); }
  if (L - u > mejor[1] - mejor[0]) mejor = [u, L];
  return (mejor[0] + mejor[1]) / 2;
}
function dibujarPlantaGeneral(D, edif, M, area, opt = {}) {
  const pdf = D.pdf; const [ax, ay, bx, by] = area;
  const esc = elegirEscala(edif.ancho + 3, edif.alto + 3, bx - ax - 20, by - ay - 26);
  const anchoMm = edif.ancho * 1000 / esc, altoMm = edif.alto * 1000 / esc;
  const ox = ax + (bx - ax - anchoMm) / 2, oy = ay + 10 + (by - ay - 26 - altoMm) / 2;
  D.vista(ox, oy, esc, 0, edif.alto);
  // espacios resaltados (rayado por ítem)
  for (const s of edif.espacios) {
    if (opt.resaltar && opt.resaltar.has(s.id)) { D.grosor(0.06); pdf.setDrawColor(0, 90, 200); D.rayado(D.X(s.x0), D.Y(s.y1), D.X(s.x1), D.Y(s.y0), 1.4); D.color(); }
  }
  const L = edif.lineas || {};
  pdf.setDrawColor(150, 150, 150); D.grosor('muyfina'); for (const s of L.mueble || []) D.linea(s[0], s[1], s[2], s[3]);
  pdf.setDrawColor(0, 0, 0); D.grosor('fina'); for (const s of L.vano || []) D.linea(s[0], s[1], s[2], s[3]);
  D.grosor('gruesa'); for (const s of L.muro || []) D.linea(s[0], s[1], s[2], s[3]);
  // espacios creados a mano (sin líneas del DWG)
  for (const s of edif.espacios.filter((x) => x.libre)) { D.grosor('gruesa'); D.rectM(s.x0, s.y0, s.x1, s.y1); }
  // elementos
  for (const s of edif.espacios) for (const el of elementosDe(s.id)) { const [a, b, c, d] = rectElemento(el, s.x1 - s.x0, s.y1 - s.y0); D.grosor('fina'); D.rectM(s.x0 + a, s.y0 + b, s.x0 + c, s.y0 + d); D.linea(s.x0 + a, s.y0 + b, s.x0 + c, s.y0 + d); D.linea(s.x0 + a, s.y0 + d, s.x0 + c, s.y0 + b); }
  // rótulos de espacios y nubes de revisión
  for (const s of edif.espacios) {
    const o = M[s.id]; const r = resumenEspacio(s, o);
    const cx = D.X((s.x0 + s.x1) / 2), cy = D.Y((s.y0 + s.y1) / 2);
    const wmm = (s.x1 - s.x0) * D.k, hmm = (s.y1 - s.y0) * D.k;
    const vertical = hmm > wmm * 1.8 && wmm < 18;
    const pt = Math.max(3.6, Math.min(7, Math.min(wmm, hmm) / 4.2));
    const ang = vertical ? 90 : 0;
    const dx = vertical ? 1 : 0, dy = vertical ? 0 : 1;
    D.texto(MAY(s.nombre), cx - dx * pt * 0.5, cy - dy * pt * 0.5, { pt, negrita: true, ang });
    D.texto(`A= ${f2(r.piso)} m²${r.verificado ? '' : '*'}`, cx + dx * pt * 0.25, cy + dy * pt * 0.25, { pt: pt * 0.8, ang });
    if (r.verificado) D.texto(`${f2(r.W)} x ${f2(r.H)}`, cx + dx * pt * 0.95, cy + dy * pt * 0.95, { pt: pt * 0.7, ang });
    if (o && o.revisar.length) { pdf.setDrawColor(200, 0, 0); D.grosor(0.25); D.nube(D.X(s.x0) + 0.6, D.Y(s.y1) + 0.6, D.X(s.x1) - 0.6, D.Y(s.y0) - 0.6); D.color(); }
  }
  // cotas generales
  const xs = (L.muro || []).flatMap((s) => [s[0], s[2]]), ys = (L.muro || []).flatMap((s) => [s[1], s[3]]);
  const bx0 = xs.length ? Math.min(...xs) : Math.min(...edif.espacios.map((s) => s.x0)), bx1 = xs.length ? Math.max(...xs) : Math.max(...edif.espacios.map((s) => s.x1));
  const by0 = ys.length ? Math.min(...ys) : Math.min(...edif.espacios.map((s) => s.y0)), by1 = ys.length ? Math.max(...ys) : Math.max(...edif.espacios.map((s) => s.y1));
  // cadenas exteriores: todas las caras de muro de los espacios, abajo y a la derecha (nivel 1), y total (nivel 2)
  const cadena = (vals, fijo, horiz) => {
    const v = [...new Set(vals.map((x) => +x.toFixed(2)))].sort((a, b) => a - b);
    for (let i = 0; i < v.length - 1; i++) {
      const L = v[i + 1] - v[i]; if (L < 0.005) continue; const txt = L * D.k >= 4.5 ? f2(L) : '';
      if (horiz) D.cota(v[i], fijo, v[i + 1], fijo, 4.5, txt, { pt: 4.6 }); else D.cota(fijo, v[i], fijo, v[i + 1], 4.5, txt, { pt: 4.6 });
    }
  };
  const interiores = edif.espacios.filter((s) => !/PLACA|AND[EÉ]N|PATIO|EXTERIOR/i.test(s.nombre || ''));
  cadena([bx0, bx1, ...interiores.flatMap((s) => [s.x0, s.x1])], by0, true);
  cadena([by0, by1, ...interiores.flatMap((s) => [s.y0, s.y1])], bx1, false);
  D.cota(bx0, by0, bx1, by0, 10, f2(bx1 - bx0)); D.cota(bx1, by0, bx1, by1, 10, f2(by1 - by0));
  // cotas interiores de cada espacio (medida de obra si ya se midió; naranja si no cuadra; * = sin medir); los vanos se acotan en la hoja de cada espacio
  const naranja = [200, 100, 0];
  for (const s of edif.espacios) {
    const o = M[s.id]; const r = resumenEspacio(s, o); const P0 = dimsPlano(s);
    const wmm = P0.w * D.k, hmm = P0.h * D.k; if (wmm < 16 || hmm < 16) continue; // en espacios pequeños no cabe: sus cotas van en su hoja
    const tw = r.w != null ? f2(r.w) : f2(P0.w) + '*', th = r.h != null ? f2(r.h) : f2(P0.h) + '*';
    const cw = r.w != null && Math.abs(r.w - P0.w) > TOL ? naranja : [90, 90, 90], ch = r.h != null && Math.abs(r.h - P0.h) > TOL ? naranja : [90, 90, 90];
    const yI = s.y1 - Math.min(P0.h * 0.22, 6 / D.k + 0.3), xI = s.x0 + Math.min(P0.w * 0.1, 4 / D.k);
    D.cota(s.x0, yI, s.x1, yI, 0, tw, { pt: 4.6, color: cw });
    D.cota(xI, s.y0, xI, s.y1, 0, th, { pt: 4.6, color: ch });
  }
  // título de la vista y escala gráfica
  const ty = by - 6;
  D.texto(opt.titulo || `PLANTA GENERAL · ${MAY(edif.nombre)}`, ax + (bx - ax) / 2, ty, { pt: 9, negrita: true });
  pdf.setLineWidth(0.3); pdf.line(ax + (bx - ax) / 2 - 45, ty + 1.5, ax + (bx - ax) / 2 + 45, ty + 1.5);
  D.texto(`ESCALA 1:${esc}`, ax + (bx - ax) / 2, ty + 5, { pt: 6.5 });
  escalaGrafica(pdf, ax + 4, by - 10, esc);
  return esc;
}
function escalaGrafica(pdf, x, y, esc) {
  const paso = [1, 2, 5, 10].find((m) => m * 1000 / esc >= 8) || 10; const mm = paso * 1000 / esc;
  pdf.setLineWidth(0.15); pdf.setDrawColor(0, 0, 0);
  for (let i = 0; i < 4; i++) { pdf.setFillColor(i % 2 ? 255 : 0, i % 2 ? 255 : 0, i % 2 ? 255 : 0); pdf.rect(x + i * mm, y, mm, 1.4, 'FD'); }
  pdf.setFontSize(5); pdf.setTextColor(0, 0, 0); pdf.setFont('helvetica', 'normal');
  for (let i = 0; i <= 4; i++) pdf.text(String(i * paso), x + i * mm, y + 4, { align: 'center' });
  pdf.text('m', x + 4 * mm + 3, y + 4);
}

/* ---------- Planta de un espacio (muros rellenos, vanos con simbología, cotas) ---------- */
function dibujarPlantaEspacio(D, s, o, area, edif) {
  const pdf = D.pdf; const [ax, ay, bx, by] = area;
  const r = resumenEspacio(s, o); const w = r.W, h = r.H; const e = 0.15;
  const esc = elegirEscala(w + 2.4, h + 2.4, bx - ax, by - ay - 14);
  const ox = ax + (bx - ax - (w + 2 * e) * 1000 / esc) / 2 + e * 1000 / esc, oy = ay + 8 + (by - ay - 14 - (h + 2 * e) * 1000 / esc) / 2 + e * 1000 / esc;
  D.vista(ox, oy, esc, 0, h);
  // muros: relleno gris oscuro entre cara interior y exterior, con los vanos recortados
  const vanosMuro = (k) => ((o && o.muros[k].vanos) || []).map((v, i) => { const L = k === 1 || k === 3 ? w : h; const pos = v.pos != null ? v.pos : (L - v.ancho) / 2 + i * 0.15; return { ...v, u0: pos, u1: pos + v.ancho, aprox: v.pos == null }; });
  const tramo = (k, u0, u1) => { // dibuja el relleno del muro k entre u0 y u1 (distancia desde la esquina izquierda vista desde dentro)
    if (u1 - u0 <= 0.001) return;
    if (k === 1) D.rellenoM(w - u1, -e, w - u0, 0, 60); if (k === 3) D.rellenoM(u0, h, u1, h + e, 60);
    if (k === 2) D.rellenoM(w, h - u1, w + e, h - u0, 60); if (k === 4) D.rellenoM(-e, u0, 0, u1, 60);
  };
  // esquinas
  D.rellenoM(-e, -e, 0, 0, 60); D.rellenoM(w, -e, w + e, 0, 60); D.rellenoM(-e, h, 0, h + e, 60); D.rellenoM(w, h, w + e, h + e, 60);
  for (let k = 1; k <= 4; k++) {
    const L = k === 1 || k === 3 ? w : h; const vs = vanosMuro(k).sort((a, b) => a.u0 - b.u0); let u = 0;
    for (const v of vs) { tramo(k, u, v.u0); u = Math.max(u, v.u1); } tramo(k, u, L);
    // simbología de vanos
    for (const v of vs) {
      const P = (uu, dd) => { // punto sobre el muro k a distancia uu (desde izquierda) y dd hacia dentro
        if (k === 1) return [w - uu, dd]; if (k === 2) return [w - dd, h - uu]; if (k === 3) return [uu, h - dd]; return [dd, uu];
      };
      const ap = antepecho(v); D.grosor('fina'); pdf.setDrawColor(0, 0, 0);
      const [a1, b1] = P(v.u0, 0), [a2, b2] = P(v.u1, 0), [c1, d1] = P(v.u0, -e), [c2, d2] = P(v.u1, -e);
      D.linea(a1, b1, c1, d1); D.linea(a2, b2, c2, d2); // jambas
      if (ap.z === 0 && (v.tipo === 'puerta' || (!v.tipo && v.alto >= 1.8))) {
        const [hx, hy] = P(v.u0, v.ancho); D.linea(a1, b1, hx, hy); // hoja abierta 90°
        const ang0 = Math.atan2(hy - b1, hx - a1), ang1 = Math.atan2(b2 - b1, a2 - a1);
        let d = ang1 - ang0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        pdf.setLineDashPattern([0.6, 0.6], 0); D.arcoM(a1, b1, v.ancho, ang0, ang0 + d); pdf.setLineDashPattern([], 0);
      } else { // ventana: tres líneas paralelas
        for (const t of [-e * 0.2, -e * 0.5, -e * 0.8]) { const [p1x, p1y] = P(v.u0, t), [p2x, p2y] = P(v.u1, t); D.linea(p1x, p1y, p2x, p2y); }
      }
    }
  }
  // caras de muros
  for (const [a, b, c, d] of recortes(s)) { D.rellenoM(a, b, c, d, 60); D.grosor('gruesa'); D.rectM(a, b, c, d); }
  D.grosor('gruesa'); D.rectM(0, 0, w, h); D.grosor('media'); D.rectM(-e, -e, w + e, h + e);
  // elementos (closet: rectángulo con aspa)
  for (const el of elementosDe(s.id)) { const [a, b, c, d] = rectElemento(el, w, h); D.grosor('fina'); const alto = el.desde && el.desde !== 'piso'; if (alto) pdf.setLineDashPattern([1, 0.7], 0); D.rectM(a, b, c, d); D.linea(a, b, c, d); D.linea(a, d, c, b); if (alto) pdf.setLineDashPattern([], 0); D.texto(MAY(el.nombre), D.X((a + c) / 2), D.Y((b + d) / 2) - 1.2, { pt: 5 }); D.texto(`${f2(num(el.ancho))}x${f2(num(el.fondo))}`, D.X((a + c) / 2), D.Y((b + d) / 2) + 1.4, { pt: 4.5 }); }
  // números de muro
  const etiqueta = (x, y, k) => { pdf.setLineWidth(0.15); pdf.circle(D.X(x), D.Y(y), 2.2, 'S'); D.texto('M' + k, D.X(x), D.Y(y) + 0.9, { pt: 5.5, negrita: true }); };
  const m = Math.min(w, h) * 0.12 + 0.1;
  const cl = (k) => centroLibre(k === 1 || k === 3 ? w : h, vanosMuro(k).map((v) => [v.u0 - 0.4, v.u1 + 0.4]));
  etiqueta(w - cl(1), m, 1); etiqueta(w - m, h - cl(2), 2); etiqueta(cl(3), h - m, 3); etiqueta(m, cl(4), 4);
  // cotas interiores (naranja si no cuadra) y cadena de vanos en M1/M3
  const P0 = dimsPlano(s);
  const t1 = (o && largoObra(o, s, 1) != null) ? f2(w) : f2(w) + '*', t2 = (o && largoObra(o, s, 2) != null) ? f2(h) : f2(h) + '*';
  const dif1 = o && largoObra(o, s, 1) != null && Math.abs(w - P0.w) > TOL, dif2 = o && largoObra(o, s, 2) != null && Math.abs(h - P0.h) > TOL;
  D.cota(0, -e, w, -e, 13, t1, { color: dif1 ? [200, 100, 0] : undefined }); D.cota(w + e, 0, w + e, h, 13, t2, { color: dif2 ? [200, 100, 0] : undefined });
  for (const k of [1, 2]) { // cadenas de vanos en muros 1 (abajo) y 2 (derecha)
    const vs = vanosMuro(k).sort((a, b) => a.u0 - b.u0); if (!vs.length) continue; const L = k === 1 ? w : h; let u = 0;
    const seg = (a, b, txt) => { if (k === 1) D.cota(w - b, -e, w - a, -e, 7.5, txt); else D.cota(w + e, h - b, w + e, h - a, 7.5, txt); };
    for (const v of vs) { if (v.u0 - u > 0.05) seg(u, v.u0, f2(v.u0 - u)); seg(v.u0, v.u1, f2(v.ancho) + (v.aprox ? '~' : '')); u = v.u1; }
    if (L - u > 0.05) seg(u, L, f2(L - u));
  }
  // altura de cada vano escrita junto a él
  for (let k = 1; k <= 4; k++) for (const v of vanosMuro(k)) {
    const um = (v.u0 + v.u1) / 2; const pt = k === 1 ? [w - um, 0.35] : k === 2 ? [w - 0.35, h - um] : k === 3 ? [um, h - 0.35] : [0.35, um];
    const ap = antepecho(v); D.texto(`h=${f2(v.alto)}${ap.z > 0 ? ' · ap=' + f2(ap.z) : ''}`, D.X(pt[0]), D.Y(pt[1]), { pt: 4.4, ang: k === 2 || k === 4 ? 90 : 0 });
  }
  for (const k of [3, 4]) { // cadenas de vanos en muros 3 (arriba) y 4 (izquierda)
    const vs = vanosMuro(k).sort((a, b) => a.u0 - b.u0); if (!vs.length) continue; const L = k === 3 ? w : h; let u = 0;
    for (const v of vs) {
      if (k === 3) { if (v.u0 - u > 0.05) D.cota(u, h + e, v.u0, h + e, -6, f2(v.u0 - u)); D.cota(v.u0, h + e, v.u1, h + e, -6, f2(v.ancho) + (v.aprox ? '~' : '')); }
      else { if (v.u0 - u > 0.05) D.cota(-e, u, -e, v.u0, -6, f2(v.u0 - u)); D.cota(-e, v.u0, -e, v.u1, -6, f2(v.ancho) + (v.aprox ? '~' : '')); }
      u = v.u1;
    }
    if (L - u > 0.05) { if (k === 3) D.cota(u, h + e, L, h + e, -6, f2(L - u)); else D.cota(-e, u, -e, L, -6, f2(L - u)); }
  }
  // rótulo del espacio
  const cx = D.X(w / 2), cy = D.Y(h / 2);
  D.texto(MAY(s.nombre), cx, cy - 1, { pt: 6.5, negrita: true }); D.texto(`A= ${f2(r.piso)} m²`, cx, cy + 2.2, { pt: 5.5 });
  if (r.alto) D.texto(`H= ${f2(r.alto)} m`, cx, cy + 4.8, { pt: 5.5 });
  if (o && o.revisar.length) { pdf.setDrawColor(200, 0, 0); D.grosor(0.25); D.nube(D.X(-e) - 2, D.Y(h + e) - 2, D.X(w + e) + 2, D.Y(-e) + 2, 2); D.color(); }
  const ty = by - 3;
  D.texto(`PLANTA · ${MAY(s.nombre)}`, ax + (bx - ax) / 2, ty - 3, { pt: 7.5, negrita: true }); pdf.setLineWidth(0.25); pdf.line(ax + 10, ty - 1.8, bx - 10, ty - 1.8);
  D.texto(`ESCALA 1:${esc}`, ax + (bx - ax) / 2, ty + 1.2, { pt: 5.5 });
  return esc;
}

/* ---------- Alzado de un muro ---------- */
function dibujarAlzado(D, s, o, k, area, edif) {
  const pdf = D.pdf; const [ax, ay, bx, by] = area;
  const L = (o && largoObra(o, s, k)) ?? largoMuro(s, k); const Hm = o && (o.muros[k].alto || o.alto); const H = Hm || 2.4;
  const esc = elegirEscala(L + 1.6, H + 1.4, bx - ax - 6, by - ay - 16);
  const ox = ax + (bx - ax - L * 1000 / esc) / 2, oy = ay + 6 + (by - ay - 16 - H * 1000 / esc) / 2;
  D.vista(ox, oy, esc, 0, H);
  pdf.setDrawColor(0, 0, 0);
  if (!Hm) pdf.setLineDashPattern([1, 0.8], 0);
  D.grosor('media'); D.rectM(0, 0, L, H); pdf.setLineDashPattern([], 0);
  D.grosor(0.7); D.linea(-0.3, 0, L + 0.3, 0); // piso
  const vs = ((o && o.muros[k].vanos) || []).map((v, i) => ({ ...v, x: v.pos != null ? v.pos : (L - v.ancho) / 2 + i * 0.15 }));
  for (const v of vs) {
    const ap = antepecho(v); const z0 = ap.z, z1 = Math.min(H, ap.z + v.alto);
    pdf.setFillColor(255, 255, 255); pdf.rect(D.X(v.x), D.Y(z1), v.ancho * D.k, (z1 - z0) * D.k, 'F');
    D.grosor('fina'); if (v.pos == null || ap.estimado) pdf.setLineDashPattern([0.8, 0.6], 0); D.rectM(v.x, z0, v.x + v.ancho, z1); pdf.setLineDashPattern([], 0);
    if (z0 === 0 && (v.tipo === 'puerta' || (!v.tipo && v.alto >= 1.8))) { D.grosor('muyfina'); D.linea(v.x, z1, v.x + v.ancho, z1 / 2); D.linea(v.x + v.ancho, z1 / 2, v.x, 0); }
    else { D.grosor('muyfina'); D.linea(v.x + v.ancho / 2, z0, v.x + v.ancho / 2, z1); D.linea(v.x, (z0 + z1) / 2, v.x + v.ancho, (z0 + z1) / 2); }
    D.cota(v.x, z1, v.x + v.ancho, z1, -3.5, f2(v.ancho) + (v.pos == null ? '~' : ''), { pt: 5 });
    D.cota(v.x + v.ancho, z0, v.x + v.ancho, z1, 3.5, f2(v.alto), { pt: 5 });
    if (z0 > 0) D.cota(v.x, 0, v.x, z0, -3.5, f2(z0) + (ap.estimado ? '~' : ''), { pt: 5 });
  }
  for (const el of elementosDe(s.id).filter((x) => Number(x.muro) === k)) { const [z0, al] = alturaElemento(el, H); const xa = num(el.pos), xb = xa + num(el.ancho); D.grosor('fina'); D.rectM(xa, z0, xb, al); D.linea(xa, z0, xb, al); D.linea(xa, al, xb, z0); D.texto(MAY(el.nombre), D.X((xa + xb) / 2), D.Y(al) - 1, { pt: 4.8 }); if (z0 > 0.01) D.cota(xa, 0, xa, z0, -3.5, f2(z0), { pt: 5 }); }
  D.cota(0, 0, L, 0, 7, f2(L) + ((o && largoObra(o, s, k) != null) ? '' : '*'));
  D.cota(L, 0, L, H, 6, Hm ? f2(H) : 'H?');
  if (Hm) { const neto = L * H - vs.reduce((t, v) => t + v.ancho * v.alto, 0); D.texto(`ÁREA NETA ${f2(neto)} m²`, D.X(centroLibre(L, vs.map((v) => [v.x - 0.3, v.x + v.ancho + 0.3]))), D.Y(H / 2), { pt: 5.5 }); }
  const v = vecino(edif, s, k);
  D.texto(`ALZADO MURO ${k}${v ? ' · COLINDA CON ' + MAY(v) : ''}`, ax + (bx - ax) / 2, by - 6, { pt: 6.5, negrita: true });
  D.texto(`ESCALA 1:${esc}`, ax + (bx - ax) / 2, by - 2.5, { pt: 5 });
}

/* ---------- Documento completo ---------- */
async function exportarPlanosCAD(edifId) {
  const edif = edifBy(edifId); if (!edif) return;
  toast('Dibujando los planos…');
  await cargarScript('jspdf.umd.min.js', 'jspdf');
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3', compress: true });
  const D = Dibujante(pdf); const p = P(); const M = modelo();
  const fecha = new Date().toLocaleDateString('es-CO');
  const porItem = {};
  for (const mm of vivas()) { if (!mm.esp) continue; const ref = espBy(mm.esp); if (!ref || ref.edif.id !== edif.id) continue; ((porItem[mm.item] = porItem[mm.item] || {})[mm.esp] = (porItem[mm.item][mm.esp] || 0) + calcMedida(tipoDe(mm.item), mm)); }
  const itemsCod = Object.keys(porItem).sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  const total = 1 + edif.espacios.length + itemsCod.length; let n = 0;
  const nueva = (contenido, prefijo, escala) => { if (n++) pdf.addPage('a3', 'landscape'); return hojaCAD(pdf, D, { p, edif: edif.nombre, contenido, fecha, n, total, codigo: `${prefijo}-${String(n).padStart(2, '0')}`, escala }); };
  // A-01 planta general + cuadro de áreas
  let H = nueva('PLANTA GENERAL Y CUADRO DE ÁREAS', 'A');
  dibujarPlantaGeneral(D, edif, M, H.areaDibujo);
  { const [x, y, x2] = H.columna; pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7); pdf.text('CUADRO DE ÁREAS', x, y + 4);
    const cols = [['ESPACIO', 40], ['OBRA (m)', 21], ['H', 9], ['PISO m²', 15], ['MUROS m²', 15]];
    let yy = y + 9; pdf.setFontSize(5); let xx = x; cols.forEach(([c, w]) => { pdf.text(c, xx, yy); xx += w; }); pdf.setLineWidth(0.15); pdf.line(x, yy + 1, x2, yy + 1); yy += 4;
    pdf.setFont('helvetica', 'normal');
    let tp = 0, tm = 0;
    for (const s of edif.espacios) { const r = resumenEspacio(s, M[s.id]); tp += r.piso; tm += r.muros || 0; const fila = [MAY(corto(s.nombre)).slice(0, 26), r.verificado ? `${f2(r.W)}x${f2(r.H)}` : `${f2(r.P.w)}x${f2(r.P.h)}*`, r.alto ? f2(r.alto) : '—', f2(r.piso), r.muros != null ? f2(r.muros) : '—']; xx = x; fila.forEach((c, i) => { pdf.text(c, xx, yy); xx += cols[i][1]; }); pdf.setDrawColor(200, 200, 200); pdf.line(x, yy + 1, x2, yy + 1); pdf.setDrawColor(0, 0, 0); yy += 3.6; }
    pdf.setFont('helvetica', 'bold'); pdf.text('TOTAL', x, yy + 1); pdf.text(f2(tp), x + 70, yy + 1); pdf.text(tm ? f2(tm) : '—', x + 85, yy + 1);
    yy = notasCAD(pdf, x, yy + 9, x2 - x);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5); pdf.text('CONVENCIONES', x, yy + 4); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(5.4);
    pdf.setFillColor(60, 60, 60); pdf.rect(x, yy + 6.5, 6, 2, 'F'); pdf.text('MURO', x + 8, yy + 8.2);
    pdf.setDrawColor(200, 0, 0); pdf.setLineWidth(0.25); D.nube(x, yy + 11, x + 6, yy + 14, 0.9); pdf.setDrawColor(0, 0, 0); pdf.text('MEDIDA POR REVISAR', x + 8, yy + 13.2);
    pdf.setLineWidth(0.1); pdf.rect(x, yy + 16, 6, 3); pdf.line(x, yy + 16, x + 6, yy + 19); pdf.line(x, yy + 19, x + 6, yy + 16); pdf.text('ELEMENTO (CLOSET, MESÓN…)', x + 8, yy + 18.4);
  }
  // A-02… una hoja por espacio: planta + 4 alzados
  for (const s of edif.espacios) {
    const o = M[s.id];
    H = nueva(`PLANTA Y ALZADOS · ${s.nombre}`, 'A');
    const [ax, ay, bx, by] = H.areaDibujo; const mid = ax + (bx - ax) * 0.42;
    dibujarPlantaEspacio(D, s, o, [ax, ay, mid - 3, by], edif);
    pdf.setLineWidth(0.1); pdf.setDrawColor(170, 170, 170); pdf.line(mid, ay + 4, mid, by - 4); pdf.setDrawColor(0, 0, 0);
    const cw = (bx - mid) / 2, ch = (by - ay) / 2;
    for (let k = 1; k <= 4; k++) { const c = (k - 1) % 2, f = Math.floor((k - 1) / 2); dibujarAlzado(D, s, o, k, [mid + c * cw + 2, ay + f * ch, mid + (c + 1) * cw - 2, ay + (f + 1) * ch], edif); }
    const [x, y, x2] = H.columna; const r = resumenEspacio(s, o);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7); pdf.text('DATOS DEL ESPACIO', x, y + 4); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(5.8);
    const datos = [['PLANO', `${f2(r.P.w)} x ${f2(r.P.h)} m`], ['OBRA', r.verificado ? `${f2(r.W)} x ${f2(r.H)} m` : 'SIN MEDIR'], ['ALTO', r.alto ? f2(r.alto) + ' m' : 'SIN MEDIR'], ['PISO', f2(r.piso) + ' m²'], ['MUROS NETOS', r.muros != null ? f2(r.muros) + ' m²' : '—'], ['VANOS', String([1, 2, 3, 4].reduce((t, k) => t + ((o && o.muros[k].vanos) || []).length, 0))], ['ELEMENTOS', String(elementosDe(s.id).length)]];
    let yy = y + 9; datos.forEach(([k, v]) => { pdf.text(k, x, yy); pdf.text(v, x2, yy, { align: 'right' }); pdf.setDrawColor(210, 210, 210); pdf.line(x, yy + 1, x2, yy + 1); pdf.setDrawColor(0, 0, 0); yy += 4; });
    if (o && o.revisar.length) { pdf.setTextColor(200, 0, 0); pdf.text(pdf.splitTextToSize('POR REVISAR: ' + o.revisar.join('; ').toUpperCase(), x2 - x), x, yy + 3); pdf.setTextColor(0, 0, 0); yy += 10; }
    const its = Object.entries(porItem).filter(([, e]) => e[s.id]).map(([c, e]) => [c, e[s.id]]);
    if (its.length) { pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5); pdf.text('ÍTEMS MEDIDOS EN EL ESPACIO', x, yy + 5); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(5.6); yy += 9; its.forEach(([c, q]) => { pdf.text(c, x, yy); pdf.text(`${f2(q)} ${(itemBy(c) || {}).und || ''}`, x2, yy, { align: 'right' }); yy += 3.6; }); }
    notasCAD(pdf, x, yy + 8, x2 - x);
  }
  // Q-… plano por ítem
  for (const cod of itemsCod) {
    const it = itemBy(cod) || { desc: '', und: '' };
    H = nueva(`PLANO DE CANTIDADES · ÍTEM ${cod}`, 'Q');
    dibujarPlantaGeneral(D, edif, M, H.areaDibujo, { resaltar: new Set(Object.keys(porItem[cod])), titulo: `ÍTEM ${cod} · ZONAS MEDIDAS` });
    const [x, y, x2] = H.columna;
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7); pdf.text(`ÍTEM ${cod}`, x, y + 4); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(5.2);
    const desc = pdf.splitTextToSize(MAY(it.desc), x2 - x).slice(0, 9); pdf.text(desc, x, y + 8);
    let yy = y + 10 + desc.length * 2.3; pdf.setFont('helvetica', 'bold'); pdf.setFontSize(5.6); pdf.text('ESPACIO', x, yy); pdf.text(`CANTIDAD (${it.und})`, x2, yy, { align: 'right' }); pdf.line(x, yy + 1, x2, yy + 1); yy += 4; pdf.setFont('helvetica', 'normal');
    let tot = 0;
    for (const [id, q] of Object.entries(porItem[cod])) { tot += q; pdf.text(MAY(corto(espBy(id).esp.nombre)), x, yy); pdf.text(f2(q), x2, yy, { align: 'right' }); yy += 3.6; }
    pdf.setFont('helvetica', 'bold'); pdf.line(x, yy - 2, x2, yy - 2); pdf.text('TOTAL', x, yy + 1); pdf.text(`${f2(tot)} ${it.und}`, x2, yy + 1, { align: 'right' });
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(5.4);
    pdf.setDrawColor(0, 90, 200); pdf.setLineWidth(0.06); D.rayado(x, yy + 6, x + 8, yy + 10, 1); pdf.setDrawColor(0, 0, 0); pdf.rect(x, yy + 6, 8, 4); pdf.text('ZONA CON MEDIDAS DEL ÍTEM', x + 10, yy + 9);
    notasCAD(pdf, x, yy + 18, x2 - x);
  }
  const nombre = `PLANOS_${edif.nombre.replace(/[^\wÑñ-]+/g, '_')}_${hoy()}.pdf`;
  ofrecerArchivo(pdf.output('blob'), nombre, 'Planos en PDF', `${total} planos A3 estilo AutoCAD: planta general con cuadro de áreas, planta y alzados de cada espacio, y un plano de cantidades por ítem medido.`);
}
