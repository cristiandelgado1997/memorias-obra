/* ===== Lee el presupuesto desde el Excel del contrato (hoja ANEXO / PRESUPUESTO) ===== */
function valorCelda(c) {
  let v = c && c.value;
  if (v && typeof v === 'object') {
    if ('result' in v) v = v.result;
    else if (v.richText) v = v.richText.map((t) => t.text).join('');
    else if (v.text) v = v.text;
    else if (v instanceof Date) v = v.toISOString().slice(0, 10);
  }
  return v === undefined ? null : v;
}
const limpiar = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const esCodigo = (s) => /^(\d+([.,]\d+){1,3}|NP[-\s]?\d+)$/i.test(limpiar(s));

function leerPresupuesto(wb) {
  // 1. Elegir la hoja: la que tenga encabezados de ítem + descripción + valor unitario
  const candidatas = wb.worksheets.slice().sort((a, b) => {
    const pa = /anexo|presupuesto/i.test(a.name) ? 0 : 1, pb = /anexo|presupuesto/i.test(b.name) ? 0 : 1;
    return pa - pb;
  });
  for (const ws of candidatas) {
    const r = intentarHoja(ws);
    if (r && r.items >= 3) return r;
  }
  throw new Error('No encontré una hoja con columnas de ítem, descripción, unidad, cantidad y valor unitario.');
}

function intentarHoja(ws) {
  let hdr = null;
  const maxR = Math.min(ws.rowCount, 60);
  for (let r = 1; r <= maxR && !hdr; r++) {
    const row = ws.getRow(r);
    const cols = {};
    row.eachCell({ includeEmpty: false }, (c, col) => {
      const t = limpiar(valorCelda(c)).toUpperCase();
      if (!t) return;
      if (cols.item == null && /^(ITEM|ÍTEM)/.test(t)) cols.item = col;
      else if (cols.desc == null && /DESCRIP/.test(t)) cols.desc = col;
      else if (cols.und == null && /^(UND|UNID)/.test(t)) cols.und = col;
      else if (cols.cant == null && /^CANT/.test(t)) cols.cant = col;
      else if (cols.vu == null && /(VALOR|VR|V\/R)\.?\s*UNIT/.test(t)) cols.vu = col;
      else if (cols.no == null && /^(NO\.?|N°|Nº|#)$/.test(t)) cols.no = col;
    });
    if (cols.item && cols.desc && cols.und && cols.cant && cols.vu) hdr = { r, cols };
  }
  if (!hdr) return null;
  const C = hdr.cols;
  const filas = [];
  let items = 0;
  const colNum = C.no || (C.item > 1 ? C.item - 1 : null);
  for (let r = hdr.r + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const g = (col) => (col ? valorCelda(row.getCell(col)) : null);
    const cod = limpiar(g(C.item));
    const desc = limpiar(g(C.desc));
    const a = limpiar(g(colNum));
    if (/^(SUBTOTAL|TOTAL|ADMIN|IMPREV|UTILIDAD|IVA)/i.test(a) || /^(SUBTOTAL|TOTAL)/i.test(desc)) {
      if (/^SUBTOTAL COSTO DIRECTO|^TOTAL/i.test(a)) break;
      continue;
    }
    // celdas combinadas: el número de capítulo (1.1) se repite en la columna de ítem
    const merged = colNum && row.getCell(C.item).isMerged && row.getCell(C.item).master.address === row.getCell(colNum).address;
    if (esCodigo(cod) && desc && !merged && cod !== a) {
      filas.push({ t: 'i', no: a || null, cod: cod.replace(/\s/g, ''), desc, und: limpiar(g(C.und)).toUpperCase(), cant: Number(g(C.cant)) || 0, vu: Number(g(C.vu)) || 0 });
      items++;
    } else if (desc || a) {
      const num = /^\d+(\.\d+)?$/.test(a) && desc ? a : '';
      const txt = desc || a;
      if (txt && !/^\d+(\.\d+)?$/.test(txt)) filas.push({ t: 'h', num, txt });
    }
  }
  // quitar títulos sueltos al final
  while (filas.length && filas[filas.length - 1].t === 'h') filas.pop();

  // 2. Datos del contrato y AIU, si aparecen en la hoja
  const proyecto = {};
  const buscarJunto = (re) => {
    for (let r = 1; r <= Math.min(hdr.r, 30); r++) {
      const row = ws.getRow(r);
      for (let c = 1; c <= ws.columnCount; c++) {
        const t = limpiar(valorCelda(row.getCell(c)));
        if (re.test(t)) {
          const resto = t.replace(re, '').replace(/^[:\s]+/, '');
          if (resto.length > 2) return resto;
          for (let k = c + 1; k <= c + 8; k++) { const v = limpiar(valorCelda(row.getCell(k))); if (v && !re.test(v) && v !== t && !/:\s*$/.test(v)) return v; }
        }
      }
    }
    return '';
  };
  proyecto.objeto = buscarJunto(/^OBJETO\s*:?/i);
  proyecto.contratista = buscarJunto(/^CONTRATISTA\s*:?/i);
  proyecto.supervisor = buscarJunto(/^(SUPERVISOR|INTERVENTOR)\w*\s*:?/i);
  proyecto.contrato = buscarJunto(/^CONTRATO\s*(No\.?)?\s*:?/i);
  for (let r = hdr.r + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const t = limpiar(valorCelda(row.getCell(1))).toUpperCase();
    const k = /^ADMIN/.test(t) ? 'admin' : /^IMPREV/.test(t) ? 'imprev' : /^UTILIDAD/.test(t) ? 'util' : /^IVA/.test(t) ? 'iva' : null;
    if (!k || proyecto[k] != null) continue;
    for (let c = 2; c <= ws.columnCount; c++) { const v = valorCelda(row.getCell(c)); if (typeof v === 'number' && v > 0 && v < 1) { proyecto[k] = v; break; } }
  }
  Object.keys(proyecto).forEach((k) => (proyecto[k] === '' || proyecto[k] == null) && delete proyecto[k]);
  return { hoja: ws.name, filas, items, proyecto };
}
