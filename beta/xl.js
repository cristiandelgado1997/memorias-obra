/* ===== Generador de Excel: memorias + anexo (balance / acta / corte) ===== */
const TIPOS = {
  AREA:  { nom: 'Área (largo × ancho)',            f: ['LARGO / ALTO', 'ANCHO', null, 'No. ELEM.'] },
  VOL:   { nom: 'Volumen (largo × ancho × alto)',  f: ['LARGO', 'ANCHO', 'ALTO / PROF.', 'No. ELEM.'] },
  LIN:   { nom: 'Lineal (largo × cantidad)',       f: ['LARGO', null, null, 'No. ELEM.'] },
  ACERO: { nom: 'Acero (long. × peso × barras)',   f: ['LONG. BARRA', 'PESO kg/m', 'BARRA', 'No. BARRAS'] },
  UND:   { nom: 'Unidades (conteo)',               f: [null, null, null, 'CANTIDAD'] },
};
const BARRAS = { '#2': 0.25, '#3': 0.56, '#4': 0.994, '#5': 1.552, '#6': 2.235, '#7': 3.042, '#8': 3.973 };
function tipoPorUnidad(und) {
  const u = String(und || '').toUpperCase();
  if (u === 'M2') return 'AREA'; if (u === 'M3') return 'VOL'; if (u === 'ML') return 'LIN';
  if (u === 'KG') return 'ACERO'; return 'UND';
}
const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const num = (v) => { const x = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(x) ? x : 0; };
function calcMedida(tipo, m) {
  const a = num(m.a), b = num(m.b), c = num(m.c), n = m.n === '' || m.n == null ? 1 : num(m.n);
  let v;
  switch (tipo) {
    case 'AREA': v = a * b * n; break;
    case 'VOL': v = a * b * c * n; break;
    case 'LIN': v = a * n; break;
    case 'ACERO': v = a * b * n; break;
    default: v = n;
  }
  return r2(v) * (m.desc ? -1 : 1);
}
function formulaFila(tipo, r) {
  switch (tipo) {
    case 'AREA': return `ROUND(E${r}*F${r}*H${r},2)`;
    case 'VOL': return `ROUND(E${r}*F${r}*G${r}*H${r},2)`;
    case 'LIN': return `ROUND(E${r}*H${r},2)`;
    case 'ACERO': return `ROUND(E${r}*F${r}*H${r},2)`;
    default: return `H${r}`;
  }
}

function buildWorkbook(ExcelJS, ctx) {
  const P = ctx.proyecto;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Memorias de Obra';
  wb.created = new Date();
  const thin = { style: 'thin' };
  const BOX = { top: thin, left: thin, bottom: thin, right: thin };
  const F9 = { name: 'Calibri', size: 9 };
  const F9B = { name: 'Calibri', size: 9, bold: true };
  const GRIS = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
  const AMAR = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
  const QF = '#,##0.00';
  const MF = '"$" #,##0.00';
  const etiquetaDoc = ctx.mode === 'balance' ? 'BALANCE' : ctx.mode === 'acta' ? `ACTA PARCIAL No. ${ctx.actaNo || ''}` : `CORTE No. ${ctx.actaNo || ''}`;
  const fechaDoc = ctx.hasta || new Date().toISOString().slice(0, 10);

  const items = ctx.rows.filter((x) => x.t === 'i');
  const porItem = {};
  for (const m of ctx.medidas) (porItem[m.item] = porItem[m.item] || []).push(m);
  const conMedidas = items.filter((it) => porItem[it.cod] && porItem[it.cod].length);

  const cell = (ws, addr, value, opt = {}) => {
    const c = ws.getCell(addr);
    c.value = value;
    c.font = opt.font || F9;
    c.alignment = Object.assign({ vertical: 'middle', wrapText: true }, opt.align || {});
    if (opt.border !== false) c.border = BOX;
    if (opt.fill) c.fill = opt.fill;
    if (opt.fmt) c.numFmt = opt.fmt;
    return c;
  };
  const boxRange = (ws, r1, c1, r2_, c2) => {
    for (let r = r1; r <= r2_; r++) for (let c = c1; c <= c2; c++) ws.getCell(r, c).border = BOX;
  };
  const altoTexto = (txt, anchoChars, base = 12) => Math.max(base, Math.ceil(String(txt || '').length / anchoChars) * 11.5 + 4);

  /* ---------- Hoja resumen (primera) ---------- */
  const nombreResumen = ctx.mode === 'balance' ? 'ANEXO No. 1' : ctx.mode === 'acta' ? 'ACTA' : 'CORTE';
  const R = wb.addWorksheet(nombreResumen, {
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    views: [{ state: 'frozen', ySplit: 0 }],
  });

  /* ---------- Memorias ---------- */
  const totalCell = {}; // cod -> "'1,1,2'!I5"
  const usados = new Set([nombreResumen]);
  const nombreHoja = (cod) => {
    let n = String(cod).replace(/[\\\/\?\*\[\]:]/g, '-').slice(0, 31);
    let k = 2; const base = n;
    while (usados.has(n)) n = (base.slice(0, 28) + '(' + k++ + ')');
    usados.add(n); return n;
  };

  for (const it of conMedidas) {
    const tipo = (ctx.tipos && ctx.tipos[it.cod]) || tipoPorUnidad(it.und);
    const T = TIPOS[tipo];
    const sn = nombreHoja(it.cod);
    const ws = wb.addWorksheet(sn, {
      pageSetup: { orientation: 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    });
    ws.columns = [{ width: 2 }, { width: 20 }, { width: 14 }, { width: 14 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 9 }, { width: 10 }, { width: 12 }];
    ws.mergeCells('B2:J3');
    cell(ws, 'B2', P.objeto, { font: F9B, align: { horizontal: 'center' } });
    ws.getRow(2).height = 18; ws.getRow(3).height = 18;
    ws.mergeCells('D4:F4'); ws.mergeCells('G4:H4'); ws.mergeCells('D5:F5'); ws.mergeCells('G5:H5');
    cell(ws, 'B4', 'Item No.', { font: F9B, align: { horizontal: 'center' }, fill: GRIS });
    cell(ws, 'C4', 'Unidad', { font: F9B, align: { horizontal: 'center' }, fill: GRIS });
    cell(ws, 'D4', 'Descripción del Item', { font: F9B, align: { horizontal: 'center' }, fill: GRIS });
    cell(ws, 'G4', ctx.mode === 'balance' ? 'BALANCE' : ctx.mode === 'acta' ? 'Acta Parcial No' : 'Corte No', { font: F9B, align: { horizontal: 'center' }, fill: GRIS });
    cell(ws, 'I4', 'Fecha', { font: F9B, align: { horizontal: 'center' }, fill: GRIS });
    cell(ws, 'J4', 'CANT TOTAL', { font: F9B, align: { horizontal: 'center' }, fill: GRIS });
    cell(ws, 'B5', it.cod, { align: { horizontal: 'center' } });
    cell(ws, 'C5', it.und, { align: { horizontal: 'center' } });
    cell(ws, 'D5', it.desc, { font: { name: 'Calibri', size: 7 }, align: { horizontal: 'justify' } });
    cell(ws, 'G5', ctx.mode === 'balance' ? '' : (ctx.actaNo || ''), { font: F9B, align: { horizontal: 'center' } });
    cell(ws, 'I5', fechaDoc, { align: { horizontal: 'center' } });
    ws.getRow(5).height = Math.min(160, altoTexto(it.desc, 52, 30) * 0.8);
    if (ctx.mode === 'corte') {
      ws.mergeCells('B6:J6');
      cell(ws, 'B6', 'SUBCONTRATISTA: ' + (ctx.subNombre || ''), { font: F9B });
    }
    // encabezado de tabla
    const h = 7;
    ws.mergeCells(`C${h}:D${h}`);
    const heads = ['UBICACIÓN', 'ELEMENTO', null, T.f[0] || '', T.f[1] || '', T.f[2] || '', T.f[3] || '', 'FECHA', 'TOTAL ' + it.und];
    heads.forEach((t, i) => { if (t !== null) cell(ws, ws.getCell(h, i + 2).address, t, { font: F9B, align: { horizontal: 'center' }, fill: GRIS }); });
    ws.getCell(h, 4).border = BOX; ws.getCell(h, 4).fill = GRIS;
    ws.getRow(h).height = 24;

    // agrupar por ubicación
    const grupos = new Map();
    const ms = porItem[it.cod].slice().sort((x, y) => (x.ubic || '').localeCompare(y.ubic || '') || (x.fecha || '').localeCompare(y.fecha || '') || (x.creado || 0) - (y.creado || 0));
    for (const m of ms) { const k = (m.ubic || 'SIN UBICACIÓN').toUpperCase(); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(m); }
    let r = h + 1;
    const subtotales = [];
    for (const [ubic, lista] of grupos) {
      const r0 = r;
      for (const m of lista) {
        ws.mergeCells(`C${r}:D${r}`);
        cell(ws, `B${r}`, ubic, { align: { horizontal: 'left' } });
        cell(ws, `C${r}`, (m.elem || '') + (m.desc ? ' (DESCUENTO)' : ''), { align: { horizontal: 'left' }, font: m.desc ? { name: 'Calibri', size: 9, color: { argb: 'FFC00000' } } : F9 });
        ws.getCell(`D${r}`).border = BOX;
        const vals = [m.a, m.b, m.c, m.n];
        ['E', 'F', 'G', 'H'].forEach((col, i) => {
          if (!T.f[i]) { cell(ws, `${col}${r}`, null); return; }
          let v = vals[i];
          if (tipo === 'ACERO' && i === 2) { cell(ws, `${col}${r}`, v || '', { align: { horizontal: 'center' } }); return; }
          if (i === 3 && (v === '' || v == null)) v = 1;
          cell(ws, `${col}${r}`, v === '' || v == null ? null : num(v), { fmt: i === 3 ? '0.##' : (tipo === 'ACERO' && i === 1 ? '0.000' : QF), align: { horizontal: 'right' } });
        });
        cell(ws, `I${r}`, m.fecha || '', { align: { horizontal: 'center' } });
        const f = (m.desc ? '-' : '') + formulaFila(tipo, r);
        cell(ws, `J${r}`, { formula: f, result: calcMedida(tipo, m) }, { fmt: QF, align: { horizontal: 'right' } });
        r++;
      }
      ws.mergeCells(`B${r}:I${r}`);
      cell(ws, `B${r}`, 'SUBTOTAL ' + ubic, { font: F9B, align: { horizontal: 'right' }, fill: AMAR });
      boxRange(ws, r, 2, r, 9);
      const st = lista.reduce((s, m) => s + calcMedida(tipo, m), 0);
      cell(ws, `J${r}`, { formula: `SUM(J${r0}:J${r - 1})`, result: r2(st) }, { font: F9B, fmt: QF, fill: AMAR });
      subtotales.push({ r, v: st });
      r++;
    }
    ws.mergeCells(`B${r}:I${r}`);
    cell(ws, `B${r}`, 'TOTAL', { font: F9B, align: { horizontal: 'right' }, fill: GRIS });
    boxRange(ws, r, 2, r, 9);
    const tot = r2(subtotales.reduce((s, x) => s + x.v, 0));
    cell(ws, `J${r}`, { formula: subtotales.map((x) => 'J' + x.r).join('+'), result: tot }, { font: F9B, fmt: QF, fill: GRIS });
    cell(ws, 'J5', { formula: `J${r}`, result: tot }, { font: { name: 'Calibri', size: 11, bold: true }, fmt: QF, align: { horizontal: 'center' } });
    totalCell[it.cod] = { ref: `'${sn}'!J5`, v: tot };
    r += 2;

    // registro fotográfico
    const fotos = [];
    for (const m of ms) for (const fid of (m.fotos || [])) if (ctx.fotos && ctx.fotos[fid]) fotos.push({ m, b64: ctx.fotos[fid] });
    if (fotos.length) {
      ws.mergeCells(`B${r}:J${r}`);
      cell(ws, `B${r}`, 'REGISTRO FOTOGRÁFICO', { font: F9B, align: { horizontal: 'center' }, fill: GRIS });
      r++;
      for (let i = 0; i < fotos.length; i += 2) {
        for (let rr = r; rr < r + 12; rr++) ws.getRow(rr).height = 15;
        [0, 1].forEach((k) => {
          const ft = fotos[i + k]; if (!ft) return;
          const id = wb.addImage({ base64: ft.b64, extension: 'jpeg' });
          ws.addImage(id, { tl: { col: k === 0 ? 1.1 : 5.6, row: r - 1 + 0.15 }, ext: { width: 270, height: 200 }, editAs: 'oneCell' });
          const capR = r + 12;
          const c1 = k === 0 ? 'B' : 'G', c2 = k === 0 ? 'E' : 'J';
          ws.mergeCells(`${c1}${capR}:${c2}${capR}`);
          cell(ws, `${c1}${capR}`, `${(ft.m.ubic || '').toUpperCase()} · ${ft.m.elem || ''} · ${ft.m.fecha || ''}`, { font: { name: 'Calibri', size: 8, italic: true }, align: { horizontal: 'center' }, border: false });
        });
        r += 14;
      }
    }
    r += 2;
    ws.mergeCells(`B${r}:D${r}`); ws.mergeCells(`G${r}:J${r}`);
    cell(ws, `B${r}`, 'ELABORÓ: ' + (P.elaboro || ''), { font: F9B, border: false });
    cell(ws, `G${r}`, 'REVISÓ: ' + (P.reviso || ''), { font: F9B, border: false });
    ws.getCell(`B${r}`).border = { top: thin }; ws.getCell(`G${r}`).border = { top: thin };
  }

  /* ---------- Llenar la hoja resumen ---------- */
  R.columns = ctx.mode === 'corte'
    ? [{ width: 5 }, { width: 9 }, { width: 60 }, { width: 6 }, { width: 12 }, { width: 15 }, { width: 18 }]
    : ctx.mode === 'acta'
      ? [{ width: 5 }, { width: 9 }, { width: 50 }, { width: 6 }, { width: 11 }, { width: 14 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 16 }, { width: 16 }, { width: 8 }]
      : [{ width: 5 }, { width: 9 }, { width: 46 }, { width: 6 }, { width: 10 }, { width: 14 }, { width: 16 }, { width: 11 }, { width: 10 }, { width: 10 }, { width: 11 }, { width: 14 }, { width: 16 }];
  const nCols = R.columns.length;
  const L = (i) => String.fromCharCode(64 + i);
  const last = L(nCols);
  let rr = 1;
  const filaInfo = (k, v) => {
    R.mergeCells(`A${rr}:B${rr}`); R.mergeCells(`C${rr}:${last}${rr}`);
    cell(R, `A${rr}`, k, { font: F9B, fill: GRIS }); cell(R, `C${rr}`, v);
    boxRange(R, rr, 1, rr, nCols);
    R.getRow(rr).height = altoTexto(v, 120, 14);
    rr++;
  };
  R.mergeCells(`A${rr}:${last}${rr}`);
  cell(R, `A${rr}`, (ctx.mode === 'balance' ? 'ANEXO No. 1 · BALANCE DE CANTIDADES' : ctx.mode === 'acta' ? `ACTA PARCIAL DE OBRA No. ${ctx.actaNo || ''}` : `CORTE DE OBRA SUBCONTRATISTA No. ${ctx.actaNo || ''}`), { font: { name: 'Calibri', size: 12, bold: true }, align: { horizontal: 'center' } });
  boxRange(R, rr, 1, rr, nCols); R.getRow(rr).height = 22; rr++;
  if (P.contrato) filaInfo('CONTRATO', P.contrato);
  filaInfo('OBJETO', P.objeto);
  filaInfo('CONTRATISTA', P.contratista);
  if (ctx.mode === 'corte') filaInfo('SUBCONTRATISTA', ctx.subNombre || '');
  else filaInfo('SUPERVISOR', P.supervisor);
  filaInfo('PERIODO', (ctx.desde ? ctx.desde + ' a ' : 'Hasta ') + fechaDoc);
  rr++;

  const hdrs = ctx.mode === 'corte'
    ? ['No.', 'ITEM', 'DESCRIPCIÓN', 'UND', 'CANTIDAD', 'VALOR UNITARIO', 'VALOR TOTAL']
    : ctx.mode === 'acta'
      ? ['No.', 'ITEM', 'DESCRIPCIÓN', 'UND', 'CANT. CONTRATO', 'VALOR UNITARIO', 'CANT. ACTAS ANTERIORES', 'CANT. ESTA ACTA', 'CANT. ACUMULADA', 'VALOR ESTA ACTA', 'VALOR ACUMULADO', '% EJEC.']
      : ['No.', 'ITEM', 'DESCRIPCIÓN', 'UND', 'CANT', 'VALOR UNITARIO', 'VALOR TOTAL', 'CANTIDADES REPLANTEADAS', 'MAYORES (+)', 'MENORES (-)', 'CANTIDADES', 'VALOR UNITARIO', 'VALOR TOTAL'];
  if (ctx.mode === 'balance') {
    R.mergeCells(`A${rr}:G${rr}`); cell(R, `A${rr}`, 'CONDICIONES CONTRACTUALES', { font: F9B, align: { horizontal: 'center' }, fill: GRIS });
    R.mergeCells(`H${rr}:J${rr}`); cell(R, `H${rr}`, 'CANTIDADES MAYORES (+) Y MENORES (-)', { font: F9B, align: { horizontal: 'center' }, fill: GRIS });
    R.mergeCells(`K${rr}:M${rr}`); cell(R, `K${rr}`, 'CANTIDADES ACTUALIZADAS', { font: F9B, align: { horizontal: 'center' }, fill: GRIS });
    boxRange(R, rr, 1, rr, nCols); rr++;
  }
  hdrs.forEach((t, i) => cell(R, `${L(i + 1)}${rr}`, t, { font: F9B, align: { horizontal: 'center' }, fill: GRIS }));
  R.getRow(rr).height = 30;
  const hdrRow = rr;
  rr++;

  const valCols = ctx.mode === 'corte' ? ['G'] : ctx.mode === 'acta' ? ['J', 'K'] : ['G', 'M'];
  const chapterSubs = []; // row numbers of subtotals
  let capStart = null, capTitulo = null, capVals = {};
  const totalesNum = {}; valCols.forEach((c) => (totalesNum[c] = 0));
  const cerrarCap = () => {
    if (capStart == null) return;
    if (rr > capStart) {
      const lab = 'SUBTOTAL ' + (capTitulo || '');
      if (ctx.mode === 'balance') {
        R.mergeCells(`A${rr}:F${rr}`); R.mergeCells(`H${rr}:L${rr}`);
        cell(R, `H${rr}`, lab, { font: F9B, align: { horizontal: 'right' }, fill: AMAR });
      } else R.mergeCells(`A${rr}:${ctx.mode === 'acta' ? 'I' : 'F'}${rr}`);
      cell(R, `A${rr}`, lab, { font: F9B, align: { horizontal: 'right' }, fill: AMAR });
      boxRange(R, rr, 1, rr, nCols);
      for (const c of valCols) {
        cell(R, `${c}${rr}`, { formula: `SUM(${c}${capStart}:${c}${rr - 1})`, result: r2(capVals[c] || 0) }, { font: F9B, fmt: MF, fill: AMAR });
      }
      if (ctx.mode === 'acta') R.getCell(`L${rr}`).fill = AMAR;
      chapterSubs.push(rr);
      rr++;
    }
    capStart = null; capVals = {};
  };

  const incluir = (it) => ctx.mode !== 'corte' || (totalCell[it.cod]);
  for (const x of ctx.rows) {
    if (x.t === 'h') {
      const lvl = (x.num || '').split('.').length;
      if (x.num && (lvl === 2 || lvl === 1)) cerrarCap();
      if (ctx.mode === 'corte') { if (x.num && lvl === 2) { capTitulo = x.txt; } continue; }
      R.mergeCells(`C${rr}:${last}${rr}`);
      cell(R, `A${rr}`, x.num || '', { font: F9B, fill: x.num && lvl === 1 ? GRIS : undefined, align: { horizontal: 'center' } });
      cell(R, `B${rr}`, '', { fill: x.num && lvl === 1 ? GRIS : undefined });
      cell(R, `C${rr}`, x.txt, { font: F9B, fill: x.num && lvl === 1 ? GRIS : undefined });
      boxRange(R, rr, 1, rr, nCols);
      if (x.num && lvl === 2) capTitulo = x.txt;
      rr++;
      continue;
    }
    if (!incluir(x)) continue;
    if (capStart == null) capStart = rr;
    const t = totalCell[x.cod];
    const q = t ? t.v : 0;
    const qRef = t ? { formula: t.ref, result: q } : 0;
    cell(R, `A${rr}`, x.no ?? '', { align: { horizontal: 'center' } });
    cell(R, `B${rr}`, x.cod, { align: { horizontal: 'center' } });
    cell(R, `C${rr}`, x.desc, { font: { name: 'Calibri', size: 7 }, align: { horizontal: 'justify' } });
    cell(R, `D${rr}`, x.und, { align: { horizontal: 'center' } });
    R.getRow(rr).height = Math.min(140, altoTexto(x.desc, 62, 14) * 0.75);
    if (ctx.mode === 'balance') {
      cell(R, `E${rr}`, x.cant, { fmt: QF });
      cell(R, `F${rr}`, x.vu, { fmt: MF });
      const g = Math.ceil(x.cant * x.vu * 100) / 100;
      cell(R, `G${rr}`, { formula: `ROUNDUP(E${rr}*F${rr},2)`, result: g }, { fmt: MF });
      cell(R, `H${rr}`, qRef, { fmt: QF, fill: t ? AMAR : undefined });
      cell(R, `I${rr}`, { formula: `IF(H${rr}>E${rr},H${rr}-E${rr},0)`, result: Math.max(q - x.cant, 0) }, { fmt: QF });
      cell(R, `J${rr}`, { formula: `IF(H${rr}<E${rr},H${rr}-E${rr},0)`, result: Math.min(q - x.cant, 0) }, { fmt: QF });
      cell(R, `K${rr}`, { formula: `H${rr}`, result: q }, { fmt: QF });
      cell(R, `L${rr}`, { formula: `F${rr}`, result: x.vu }, { fmt: MF });
      const m = Math.ceil(q * x.vu * 100) / 100;
      cell(R, `M${rr}`, { formula: `ROUNDUP(K${rr}*L${rr},2)`, result: m }, { fmt: MF });
      capVals.G = (capVals.G || 0) + g; capVals.M = (capVals.M || 0) + m; totalesNum.G += g; totalesNum.M += m;
    } else if (ctx.mode === 'acta') {
      const ant = r2((ctx.anteriores && ctx.anteriores[x.cod]) || 0);
      cell(R, `E${rr}`, x.cant, { fmt: QF });
      cell(R, `F${rr}`, x.vu, { fmt: MF });
      cell(R, `G${rr}`, ant, { fmt: QF });
      cell(R, `H${rr}`, qRef, { fmt: QF, fill: t ? AMAR : undefined });
      cell(R, `I${rr}`, { formula: `G${rr}+H${rr}`, result: r2(ant + q) }, { fmt: QF });
      const j = Math.round(q * x.vu * 100) / 100, k = Math.round((ant + q) * x.vu * 100) / 100;
      cell(R, `J${rr}`, { formula: `ROUND(H${rr}*F${rr},2)`, result: j }, { fmt: MF });
      cell(R, `K${rr}`, { formula: `ROUND(I${rr}*F${rr},2)`, result: k }, { fmt: MF });
      cell(R, `L${rr}`, { formula: `IF(E${rr}=0,0,I${rr}/E${rr})`, result: x.cant ? (ant + q) / x.cant : 0 }, { fmt: '0.0%' });
      capVals.J = (capVals.J || 0) + j; capVals.K = (capVals.K || 0) + k; totalesNum.J += j; totalesNum.K += k;
    } else {
      const vu = num(ctx.subPrecios && ctx.subPrecios[x.cod]);
      cell(R, `E${rr}`, qRef, { fmt: QF, fill: AMAR });
      cell(R, `F${rr}`, vu, { fmt: MF });
      const g = Math.round(q * vu * 100) / 100;
      cell(R, `G${rr}`, { formula: `ROUND(E${rr}*F${rr},2)`, result: g }, { fmt: MF });
      capVals.G = (capVals.G || 0) + g; totalesNum.G += g;
    }
    rr++;
  }
  cerrarCap();

  // Totales
  const filaTotal = (label, vals, opt = {}) => {
    const span = ctx.mode === 'acta' ? 9 : ctx.mode === 'corte' ? 6 : 6;
    if (ctx.mode === 'balance') {
      R.mergeCells(`A${rr}:E${rr}`); cell(R, `A${rr}`, label, { font: F9B, align: { horizontal: 'right' }, fill: opt.fill });
      cell(R, `F${rr}`, opt.pct ?? '', { fmt: '0.0%', fill: opt.fill });
      R.mergeCells(`H${rr}:K${rr}`); cell(R, `H${rr}`, label, { font: F9B, align: { horizontal: 'right' }, fill: opt.fill });
      cell(R, `L${rr}`, opt.pct ?? '', { fmt: '0.0%', fill: opt.fill });
    } else {
      R.mergeCells(`A${rr}:${L(span - (ctx.mode === 'acta' ? 1 : 0))}${rr}`);
      cell(R, `A${rr}`, label, { font: F9B, align: { horizontal: 'right' }, fill: opt.fill });
      if (ctx.mode === 'acta') cell(R, `I${rr}`, opt.pct ?? '', { fmt: '0.0%', fill: opt.fill });
    }
    boxRange(R, rr, 1, rr, nCols);
    valCols.forEach((c, i) => cell(R, `${c}${rr}`, vals[i], { font: F9B, fmt: MF, fill: opt.fill }));
    return rr++;
  };
  const sumSubs = (c) => chapterSubs.length ? chapterSubs.map((r) => c + r).join('+') : '0';
  const cd = filaTotal(ctx.mode === 'corte' ? 'TOTAL CORTE' : 'SUBTOTAL COSTO DIRECTO', valCols.map((c) => ({ formula: sumSubs(c), result: r2(totalesNum[c]) })), { fill: GRIS });
  if (ctx.mode !== 'corte') {
    const pctCol = ctx.mode === 'balance' ? 'F' : 'I';
    const aiu = [['ADMINISTRACIÓN', P.admin], ['IMPREVISTOS', P.imprev], ['UTILIDAD', P.util]];
    const filas = {};
    for (const [lab, pct] of aiu) {
      const r = rr;
      filas[lab] = r;
      filaTotal(lab, valCols.map((c) => ({ formula: `ROUND(${c}${cd}*${pctCol}${r},2)`, result: r2(totalesNum[c] * pct) })), { pct });
      if (ctx.mode === 'balance') R.getCell(`M${r}`).value = { formula: `ROUND(M${cd}*L${r},2)`, result: r2(totalesNum.M * pct) };
    }
    const ru = filas['UTILIDAD'];
    const ri = rr;
    filaTotal('IVA SOBRE UTILIDAD', valCols.map((c) => ({ formula: `ROUND(${c}${ru}*${pctCol}${ri},2)`, result: r2(totalesNum[c] * P.util * P.iva) })), { pct: P.iva });
    if (ctx.mode === 'balance') R.getCell(`M${ri}`).value = { formula: `ROUND(M${ru}*L${ri},2)`, result: r2(totalesNum.M * P.util * P.iva) };
    const fa = filas['ADMINISTRACIÓN'];
    const aiuV = (c) => r2(totalesNum[c] * P.admin) + r2(totalesNum[c] * P.imprev) + r2(totalesNum[c] * P.util) + r2(totalesNum[c] * P.util * P.iva);
    const sa = filaTotal('SUBTOTAL AIU', valCols.map((c) => ({ formula: `SUM(${c}${fa}:${c}${ri})`, result: r2(aiuV(c)) })), {});
    filaTotal('TOTAL OBRA', valCols.map((c) => ({ formula: `${c}${cd}+${c}${sa}`, result: r2(totalesNum[c] + aiuV(c)) })), { fill: GRIS });
  }
  rr += 3;
  R.mergeCells(`A${rr}:C${rr}`);
  cell(R, `A${rr}`, ctx.mode === 'corte' ? 'CONTRATISTA: ' + (P.contratista || '') : 'CONTRATISTA: ' + (P.contratista || ''), { font: F9B, border: false });
  R.getCell(`A${rr}`).border = { top: thin };
  const c2 = ctx.mode === 'corte' ? 'E' : 'H';
  R.mergeCells(`${c2}${rr}:${last}${rr}`);
  cell(R, `${c2}${rr}`, ctx.mode === 'corte' ? 'SUBCONTRATISTA: ' + (ctx.subNombre || '') : (P.supervisor || 'SUPERVISOR'), { font: F9B, border: false });
  R.getCell(`${c2}${rr}`).border = { top: thin };
  R.views = [{ state: 'frozen', ySplit: hdrRow }];
  return wb;
}

