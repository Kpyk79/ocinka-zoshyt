/* Матеріали інструктора на пристрої: поки зошит підключений, файли з листування тихо зберігаються в IndexedDB,
   тож і після відключення від групи їх можна відкривати й завантажувати. Користується глобальними state, rpc, h, toast з app.js. */
const FILES_DB = 'ocinka-files';

function filesDb() {
  if (!filesDb.p) {
    filesDb.p = new Promise((res, rej) => {
      if (!('indexedDB' in window)) return rej(new Error('no idb'));
      const rq = indexedDB.open(FILES_DB, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('f');
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  }
  return filesDb.p;
}
async function fileTx(mode, fn) {
  const db = await filesDb();
  return new Promise((res, rej) => {
    const tx = db.transaction('f', mode);
    const r = fn(tx.objectStore('f'));
    tx.oncomplete = () => res(r && r.result);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}
const fdbGet = (id) => fileTx('readonly', (s) => s.get(id)).catch(() => null);
const fdbPut = (id, rec) => fileTx('readwrite', (s) => s.put(rec, id));
const fdbDel = (id) => fileTx('readwrite', (s) => s.delete(id)).catch(() => {});
const fdbKeys = () => fileTx('readonly', (s) => s.getAllKeys()).catch(() => []);
function fdbClear() { if (state.saved) state.saved.clear(); return fileTx('readwrite', (s) => s.clear()).catch(() => {}); }

async function filesLoadSaved() {
  state.saved = new Set(await fdbKeys());
  if (state.saved.size && state.data) render();
}

function b64Bytes(b64) { return Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)); }

/* Файл із пристрою або (якщо є зв'язок) із сервера з одночасним збереженням. */
async function getFile(m) {
  const have = await fdbGet(m.id);
  if (have) return have;
  if (state.mode !== 'online') throw new Error('Файл не збережено на цьому пристрої');
  const r = await rpc('nb_message_file', { p_token: state.token, p_id: m.id });
  if (!r) throw new Error('Файл недоступний');
  const mime = r.mime || m.file_mime || 'application/octet-stream';
  const rec = { name: r.name || m.file_name || 'file', mime, blob: new Blob([b64Bytes(r.data)], { type: mime }) };
  try { await fdbPut(m.id, rec); state.saved.add(m.id); } catch { /* сховище недоступне: працюємо без збереження */ }
  return rec;
}

let prefetching = false;
async function prefetchFiles() {
  if (prefetching || state.mode !== 'online' || !state.data) return;
  prefetching = true;
  try {
    const todo = (state.data.messages || []).filter((m) => m.file_name && m.sender !== 'cadet' && !state.saved.has(m.id));
    for (const m of todo) {
      if (state.mode !== 'online') break;
      try { await getFile(m); } catch { /* повторимо наступного разу */ }
    }
    if (todo.length && state.tab === 'materials' && !state.compose.text) render();
  } finally { prefetching = false; }
}

const savedPending = new Set();
async function loadSavedImage(m) {
  if (savedPending.has(m.id)) return;
  savedPending.add(m.id);
  const rec = await fdbGet(m.id);
  if (rec) { state.images[m.id] = URL.createObjectURL(rec.blob); render(); }
}

/* ---------- відкриття, завантаження, перегляд ---------- */
function clickLink(url, name, download) {
  const a = h('a', { href: url, rel: 'noopener', ...(download ? { download: name || 'file' } : { target: '_blank' }) });
  document.body.append(a); a.click(); a.remove();
}
async function openFile(m, isImage) {
  try {
    const rec = await getFile(m);
    const url = URL.createObjectURL(rec.blob);
    if (isImage) { state.images[m.id] = state.images[m.id] || url; showLightbox(url, rec.name); render(); }
    else { clickLink(url, rec.name, false); setTimeout(() => URL.revokeObjectURL(url), 120000); }
  } catch (e) { toast(e.message || 'Не вдалося відкрити файл'); }
}
async function downloadFile(m) {
  try {
    const rec = await getFile(m);
    const url = URL.createObjectURL(rec.blob);
    clickLink(url, rec.name, true);
    setTimeout(() => URL.revokeObjectURL(url), 120000);
    if (state.tab === 'materials') render();
  } catch (e) { toast(e.message || 'Не вдалося завантажити файл'); }
}

function showLightbox(url, name) {
  if (document.querySelector('.lightbox')) return;
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const box = h('div', { class: 'lightbox', role: 'dialog', 'aria-label': name || 'Зображення', onclick: (e) => { if (e.target === box) close(); } },
    h('img', { src: url, alt: name || '' }),
    h('button', { class: 'lightbox-x', 'aria-label': 'Закрити', onclick: close, text: '×' }));
  document.body.append(box);
  document.addEventListener('keydown', onKey);
}
