/**
 * MEMORIAS DE OBRA · Servidor en Google Sheets + Drive
 * ----------------------------------------------------
 * 1. Cambia la CLAVE por una palabra secreta tuya (sin espacios).
 * 2. Implementar > Nueva implementación > Aplicación web
 *    Ejecutar como: Yo · Quién tiene acceso: Cualquier usuario
 * 3. Copia la URL que termina en /exec y pégala en la app (Ajustes > Conexión).
 */
const CLAVE = 'CAMBIA-ESTA-CLAVE';

const HOJA_MEDIDAS = 'Medidas';
const HOJA_FOTOS = 'Fotos';
const HOJA_CONFIG = 'Config';
const CARPETA_FOTOS = 'Memorias de obra - Fotos';

const COLS_MEDIDAS = ['ID', 'ITEM', 'UBICACIÓN', 'ELEMENTO', 'DIM 1', 'DIM 2', 'DIM 3', 'No. / CANT', 'DESCUENTO', 'FECHA', 'SUBCONTRATISTA', 'REGISTRÓ', 'OBSERVACIÓN', 'FOTOS', 'CREADO', 'EDITADO', 'ACTUALIZADO', 'BORRADO', 'DATOS'];
const COLS_FOTOS = ['ID', 'ARCHIVO', 'MEDIDA', 'ITEM', 'SUBIDA', 'ENLACE'];
const COLS_CONFIG = ['CLAVE', 'DATOS', 'ACTUALIZADO'];

function doGet() {
  return salida({ ok: true, app: 'memorias-obra', version: 1 });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return salida({ ok: false, error: 'Solicitud inválida' }); }
  if (!req || req.clave !== CLAVE) return salida({ ok: false, error: 'clave' });
  try {
    if (req.accion === 'pull') return salida(pull(Number(req.desde) || 0));
    if (req.accion === 'foto') return salida(leerFoto(String(req.id)));
    if (req.accion === 'ping') return salida({ ok: true, ahora: Date.now() });
    if (req.accion === 'push') {
      const lock = LockService.getScriptLock();
      lock.waitLock(30000);
      try { return salida(push(req.ops || [])); } finally { lock.releaseLock(); }
    }
    return salida({ ok: false, error: 'Acción desconocida' });
  } catch (err) {
    return salida({ ok: false, error: String(err && err.message || err) });
  }
}

function val(x) { return x === undefined || x === null ? '' : x; }

function salida(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function hoja(nombre, cols) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(nombre);
  if (!sh) {
    sh = ss.insertSheet(nombre);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#d9d9d9');
    sh.setFrozenRows(1);
  }
  return sh;
}

function indicePorId(sh) {
  const n = sh.getLastRow();
  const map = {};
  if (n < 2) return map;
  const ids = sh.getRange(2, 1, n - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) map[String(ids[i][0])] = i + 2;
  return map;
}

function carpeta() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('CARPETA_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const ss = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId());
  const padres = ss.getParents();
  const padre = padres.hasNext() ? padres.next() : DriveApp.getRootFolder();
  const f = padre.createFolder(CARPETA_FOTOS);
  props.setProperty('CARPETA_ID', f.getId());
  return f;
}

function push(ops) {
  const ahora = Date.now();
  const hecho = [];
  const shM = hoja(HOJA_MEDIDAS, COLS_MEDIDAS);
  const shF = hoja(HOJA_FOTOS, COLS_FOTOS);
  const shC = hoja(HOJA_CONFIG, COLS_CONFIG);
  const idxM = indicePorId(shM), idxF = indicePorId(shF), idxC = indicePorId(shC);
  for (const op of ops) {
    if (op.tipo === 'medida') {
      const d = op.data || {};
      const fila = [op.id, d.item || '', d.ubic || '', d.elem || '', val(d.a), val(d.b), val(d.c), val(d.n), d.desc ? 'SÍ' : '', d.fecha || '', d.subNombre || '', d.autor || '', d.obs || '', (d.fotos || []).length, d.creado ? new Date(d.creado) : '', d.editado ? new Date(d.editado) : '', ahora, op.borrado ? 'SÍ' : '', JSON.stringify(d)];
      if (idxM[op.id]) shM.getRange(idxM[op.id], 1, 1, fila.length).setValues([fila]);
      else { shM.appendRow(fila); idxM[op.id] = shM.getLastRow(); }
      hecho.push(op.k);
    } else if (op.tipo === 'config') {
      // Una celda admite 50.000 caracteres: los datos grandes se parten en varias filas
      const txt = JSON.stringify(op.data || {});
      const partes = [];
      for (let i = 0; i < txt.length; i += 45000) partes.push(txt.slice(i, i + 45000));
      if (!partes.length) partes.push('{}');
      for (let i = 0; i < 200; i++) {
        const key = i === 0 ? op.id : op.id + '::' + i;
        const r = idxC[key];
        if (i < partes.length) {
          const fila = [key, partes[i], ahora];
          if (r) shC.getRange(r, 1, 1, 3).setValues([fila]);
          else { shC.appendRow(fila); idxC[key] = shC.getLastRow(); }
        } else if (r) shC.getRange(r, 2, 1, 2).setValues([['', ahora]]);
        else if (i >= partes.length) break;
      }
      hecho.push(op.k);
    } else if (op.tipo === 'foto') {
      if (!idxF[op.id]) {
        const m = String(op.data || '').match(/^data:(image\/\w+);base64,(.+)$/);
        if (!m) { hecho.push(op.k); continue; }
        const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], (op.item || 'foto').replace(/[^\w-]/g, '_') + '_' + op.id + '.jpg');
        const file = carpeta().createFile(blob);
        shF.appendRow([op.id, file.getId(), op.medida || '', op.item || '', new Date(), file.getUrl()]);
        idxF[op.id] = shF.getLastRow();
      }
      hecho.push(op.k);
    } else if (op.tipo === 'fotoDel') {
      const r = idxF[op.id];
      if (r) {
        const fileId = shF.getRange(r, 2).getValue();
        try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {}
        shF.getRange(r, 2).setValue('');
        shF.getRange(r, 6).setValue('ELIMINADA');
      }
      hecho.push(op.k);
    }
  }
  return { ok: true, hecho: hecho, ahora: ahora };
}

function pull(desde) {
  const shM = hoja(HOJA_MEDIDAS, COLS_MEDIDAS);
  const shC = hoja(HOJA_CONFIG, COLS_CONFIG);
  const medidas = [];
  const n = shM.getLastRow();
  if (n >= 2) {
    const v = shM.getRange(2, 1, n - 1, COLS_MEDIDAS.length).getValues();
    for (const r of v) {
      const act = Number(r[16]) || 0;
      if (act <= desde) continue;
      let d = {};
      try { d = JSON.parse(r[18] || '{}'); } catch (e) {}
      medidas.push({ id: String(r[0]), borrado: r[17] === 'SÍ', data: d });
    }
  }
  const config = {};
  const trozos = {};
  const nc = shC.getLastRow();
  if (nc >= 2) {
    const v = shC.getRange(2, 1, nc - 1, 3).getValues();
    for (const r of v) {
      const k = String(r[0]); const base = k.split('::')[0]; const i = k.indexOf('::') > 0 ? Number(k.split('::')[1]) : 0;
      (trozos[base] = trozos[base] || [])[i] = String(r[1] || '');
    }
    for (const base in trozos) { try { config[base] = JSON.parse(trozos[base].join('')); } catch (e) {} }
  }
  return { ok: true, medidas: medidas, config: config, ahora: Date.now() };
}

function leerFoto(id) {
  const shF = hoja(HOJA_FOTOS, COLS_FOTOS);
  const r = indicePorId(shF)[id];
  if (!r) return { ok: false, error: 'No existe' };
  const fileId = shF.getRange(r, 2).getValue();
  if (!fileId) return { ok: false, error: 'Eliminada' };
  const blob = DriveApp.getFileById(fileId).getBlob();
  return { ok: true, data: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()) };
}

/** Ejecuta esta función una vez desde el editor para autorizar Drive y Sheets. */
function probar() {
  hoja(HOJA_MEDIDAS, COLS_MEDIDAS); hoja(HOJA_FOTOS, COLS_FOTOS); hoja(HOJA_CONFIG, COLS_CONFIG);
  carpeta();
  Logger.log('Todo listo. Ahora implementa como Aplicación web.');
}
