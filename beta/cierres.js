/* ================= Balance / obra ejecutada · cierres de actas y cortes · versiones del balance ================= */
'use strict';
// Cada medida es de BALANCE (lo que el proyecto va a tener) o de OBRA EJECUTADA (lo que ya está hecho).
// Las medidas sin marca (anteriores a esta versión) cuentan como obra ejecutada.
const destDe = (m) => (m && m.dest === 'balance' ? 'balance' : 'obra');
const DEST_TXT = { balance: 'Balance', obra: 'Obra ejecutada' };

/* ---------- Totales por ítem ---------- */
function totalesDest(dest, hasta) {
  const t = {};
  for (const m of vivas()) if (destDe(m) === dest && (!hasta || (m.fecha || '') <= hasta)) t[m.item] = (t[m.item] || 0) + calcMedida(tipoDe(m.item), m);
  return t;
}
// referencia para saber si un ítem se pasó: el balance si ya tiene medidas de balance; si no, la cantidad del contrato
function referenciaItem(cod, totBal) {
  const it = itemBy(cod) || {}; const b = totBal[cod];
  return b != null ? { q: b, de: 'balance' } : { q: num(it.cant), de: 'contrato' };
}
function excedidos() {
  const tb = totalesDest('balance'), te = totalesDest('obra'); const out = new Set();
  for (const cod of Object.keys(te)) { const r = referenciaItem(cod, tb); if (te[cod] > r.q + 0.005) out.add(cod); }
  return out;
}

/* ---------- Cierres ---------- */
const cierres = () => (S.cfg.cierres && S.cfg.cierres.lista) || [];
const cierresDe = (tipo, sub) => cierres().filter((c) => c.tipo === tipo && (tipo !== 'corte' || c.sub === sub)).sort((a, b) => a.no - b.no);
const valMed = (m) => ({ item: m.item, ubic: m.ubic || '', elem: m.elem || '', a: m.a ?? '', b: m.b ?? '', c: m.c ?? '', n: m.n ?? '', desc: !!m.desc, fecha: m.fecha || '', sub: m.sub || '' });
const claveVal = (v) => JSON.stringify([v.item, String(v.a ?? ''), String(v.b ?? ''), String(v.c ?? ''), String(v.n ?? ''), !!v.desc]);
// último valor cobrado de cada medida en actas (o cortes de un sub) ya cerrados
function snapActual(tipo, sub, hastaNo) {
  const s = {}; for (const c of cierresDe(tipo, sub)) { if (hastaNo != null && c.no >= hastaNo) break; Object.assign(s, c.snap || {}); } return s;
}
// cierre más reciente (acta o corte) que ya cobró esta medida
function bloqueoDe(m) {
  if (!m) return null; let r = null;
  for (const c of cierres()) if ((c.tipo === 'acta' || c.tipo === 'corte') && c.snap && c.snap[m.id] && (!r || (c.fecha || '') >= (r.fecha || ''))) r = c;
  return r;
}
const nombreCierre = (c) => (c.tipo === 'acta' ? 'Acta ' : c.tipo === 'corte' ? 'Corte ' : 'Balance v') + c.no + (c.tipo === 'corte' ? ' · ' + ((S.cfg.subs.find((s) => s.id === c.sub) || {}).nombre || 'sub') : '');
const diaSiguiente = (f) => { if (!f) return ''; const d = new Date(f + 'T12:00:00'); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); };

// lo que entra en la próxima acta (o corte): medidas nuevas de obra ejecutada y correcciones de medidas ya cobradas
function pendientesCierre(tipo, sub, hasta) {
  const snap = snapActual(tipo, sub); const nuevas = [], ajustes = [];
  for (const m of Object.values(S.medidas)) {
    const prev = snap[m.id];
    if (!prev) {
      if (m.borrado || destDe(m) !== 'obra') continue;
      if (tipo === 'corte' && m.sub !== sub) continue;
      if (hasta && (m.fecha || '') > hasta) continue;
      nuevas.push(m); continue;
    }
    if (prev.borrado) continue;
    const sigue = !m.borrado && destDe(m) === 'obra' && (tipo !== 'corte' || m.sub === sub);
    const act = sigue ? valMed(m) : null;
    if (!act || claveVal(act) !== claveVal(prev)) ajustes.push({ id: m.id, prev, act });
  }
  return { nuevas, ajustes, snap };
}
// filas para el Excel: las nuevas tal cual; cada corrección anula lo cobrado antes y registra el valor corregido
function filasCierre(nuevas, ajustes, etiqueta) {
  const out = nuevas.slice();
  for (const a of ajustes) {
    const base = S.medidas[a.id] || {};
    out.push(Object.assign({}, base, a.prev, { id: a.id + '-anula', desc: !a.prev.desc, fotos: [], elem: 'ANULA ' + (a.prev.elem || 'medida') + ' (' + etiqueta + ')', obs: 'Corrección de una medida ya cobrada' }));
    if (a.act) out.push(Object.assign({}, base, a.act, { id: a.id + '-corr', elem: (a.act.elem || 'medida') + ' (CORREGIDA)', obs: ((base.historial || []).slice(-1)[0] || {}).motivo || base.obs || '' }));
  }
  return out;
}
function sumaSnap(snap) { const t = {}; for (const v of Object.values(snap)) if (!v.borrado) t[v.item] = (t[v.item] || 0) + calcMedida(tipoDe(v.item), v); return t; }

async function cerrarCierre(tipo, sub, hasta) {
  const prev = cierresDe(tipo, sub); const no = prev.length ? prev[prev.length - 1].no + 1 : 1;
  const { nuevas, ajustes } = pendientesCierre(tipo, sub, hasta);
  const snap = {}; for (const m of nuevas) snap[m.id] = valMed(m); for (const a of ajustes) snap[a.id] = a.act || { item: a.prev.item, borrado: true };
  const etiqueta = (tipo === 'acta' ? 'ACTA ' : 'CORTE ') + (prev.length ? prev[prev.length - 1].no : '');
  const filas = filasCierre(nuevas, ajustes, etiqueta); const tot = {};
  for (const m of filas) tot[m.item] = r2((tot[m.item] || 0) + calcMedida(tipoDe(m.item), m));
  const c = { id: uidGen(), tipo, sub: sub || '', no, desde: prev.length ? diaSiguiente(prev[prev.length - 1].hasta) : '', hasta: hasta || hoy(), fecha: hoy(), autor: S.nombre || '', snap, ajustes: ajustes.map((a) => ({ id: a.id, prev: a.prev })), totales: tot, creado: Date.now() };
  await guardarConfig('cierres', { lista: cierres().concat(c) });
  return c;
}
// para volver a descargar un acta o corte ya cerrado, tal como se cerró
function datosDeCierre(c) {
  const nuevas = [], ajustes = []; const aj = new Map((c.ajustes || []).map((a) => [a.id, a.prev]));
  for (const [id, v] of Object.entries(c.snap || {})) {
    const base = S.medidas[id] || {};
    if (aj.has(id)) ajustes.push({ id, prev: aj.get(id), act: v.borrado ? null : v });
    else nuevas.push(Object.assign({}, base, v, { id }));
  }
  const ant = cierresDe(c.tipo, c.sub).filter((x) => x.no < c.no); const etiqueta = (c.tipo === 'acta' ? 'ACTA ' : 'CORTE ') + (ant.length ? ant[ant.length - 1].no : '');
  return { medidas: filasCierre(nuevas, ajustes, etiqueta), anteriores: sumaSnap(snapActual(c.tipo, c.sub, c.no)) };
}

/* ---------- Versiones del balance ---------- */
async function guardarVersionBalance(hasta) {
  const prev = cierresDe('balance'); const no = prev.length ? prev[prev.length - 1].no + 1 : 1;
  const tot = totalesDest('balance', hasta); Object.keys(tot).forEach((k) => { tot[k] = r2(tot[k]); });
  const n = vivas().filter((m) => destDe(m) === 'balance' && (!hasta || (m.fecha || '') <= hasta)).length;
  const c = { id: uidGen(), tipo: 'balance', no, hasta: hasta || hoy(), fecha: hoy(), autor: S.nombre || '', totales: tot, medidas: n, creado: Date.now() };
  await guardarConfig('cierres', { lista: cierres().concat(c) });
  return c;
}
function tablaVersiones() {
  const vs = cierresDe('balance'); const act = totalesDest('balance');
  const cods = items().map((x) => x.cod).filter((cod) => vs.some((v) => v.totales[cod]) || act[cod]);
  const vu = (cod) => num((itemBy(cod) || {}).vu);
  const valor = (t) => Object.entries(t).reduce((s, [cod, q]) => s + q * vu(cod), 0);
  const filas = cods.map((cod) => { const qs = vs.map((v) => v.totales[cod] || 0); const a = r2(act[cod] || 0); const ult = qs.length ? qs[qs.length - 1] : 0; return { cod, qs, a, cambio: r2(a - ult) }; });
  return `<div class="scroll"><table class="table"><thead><tr><th>Ítem</th>${vs.map((v) => `<th>v${v.no}<div class="hint">${esc(v.fecha)}</div></th>`).join('')}<th>Actual</th><th>Cambio</th></tr></thead><tbody>
    ${filas.map((f) => `<tr><td><b class="num">${esc(f.cod)}</b> <span class="hint">${esc((itemBy(f.cod) || {}).und || '')}</span></td>${f.qs.map((q) => `<td class="num">${fmt(q)}</td>`).join('')}<td class="num"><b>${fmt(f.a)}</b></td><td class="num" style="color:${f.cambio ? 'var(--warn)' : 'var(--muted)'}">${f.cambio > 0 ? '+' : ''}${fmt(f.cambio)}</td></tr>`).join('') || `<tr><td colspan="${vs.length + 3}" class="hint">Sin medidas de balance todavía.</td></tr>`}
    <tr><td><b>Valor costo directo</b></td>${vs.map((v) => `<td class="num">$${fmt(valor(v.totales), 0)}</td>`).join('')}<td class="num"><b>$${fmt(valor(act), 0)}</b></td><td></td></tr>
  </tbody></table></div>`;
}

/* ---------- Director: PIN para cerrar y corregir ---------- */
async function hashPin(p) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('memorias-obra:' + p));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const hayPin = () => !!(S.cfg.director && S.cfg.director.h);
function pedirDirector(motivo) {
  if (S.esDirector) return Promise.resolve(true);
  return new Promise((res) => {
    const crear = !hayPin();
    const host = document.createElement('div'); host.className = 'sheet'; host.style.zIndex = 80;
    host.innerHTML = `<div class="bar gut dark"><button class="iconbtn" type="button" id="pdX" aria-label="Cerrar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 6l12 12M18 6L6 18"/></svg></button><h2>${crear ? 'Crear PIN del director' : 'PIN del director'}</h2></div>
      <form class="content gut" id="pdF" novalidate>
        <div class="hint">${esc(motivo || '')}</div>
        ${crear ? '<div class="note">Todavía no hay PIN. El que escribas aquí será el del director para toda la obra: solo quien lo sepa puede cerrar actas y cortes, guardar versiones del balance y corregir medidas ya cobradas.</div>' : ''}
        <label class="f">PIN (4 a 8 números)<input class="n" id="pdPin" type="password" inputmode="numeric" autocomplete="off" maxlength="8"></label>
        ${crear ? '<label class="f">Repite el PIN<input class="n" id="pdPin2" type="password" inputmode="numeric" autocomplete="off" maxlength="8"></label>' : ''}
        <div class="actions"><button class="btn pri" type="submit">${crear ? 'Crear PIN' : 'Entrar'}</button></div>
      </form>`;
    document.body.appendChild(host);
    const fin = (ok) => { host.remove(); res(ok); };
    $('#pdX', host).addEventListener('click', () => fin(false));
    $('#pdF', host).addEventListener('submit', async (e) => {
      e.preventDefault(); const p = $('#pdPin', host).value.trim();
      if (!/^\d{4,8}$/.test(p)) { toast('El PIN debe tener de 4 a 8 números.'); return; }
      if (crear) {
        if (p !== $('#pdPin2', host).value.trim()) { toast('Los dos PIN no coinciden.'); return; }
        await guardarConfig('director', { h: await hashPin(p), por: S.nombre || '', fecha: hoy() });
        S.esDirector = true; toast('PIN creado. Modo director activo en este celular.'); fin(true); return;
      }
      if (await hashPin(p) === S.cfg.director.h) { S.esDirector = true; toast('Modo director activo hasta cerrar la app.'); fin(true); }
      else toast('PIN incorrecto.');
    });
    setTimeout(() => { const i = $('#pdPin', host); if (i) i.focus(); }, 60);
  });
}
