/* Фото в нотатках. У тексті нотатки лежить лише позначка [фото:ідентифікатор] (вона синхронізується разом із текстом),
   а саме зображення зберігається на цьому телефоні в IndexedDB (ключ np:<id>) і стискається до 1280 px.
   Користується fdbGet/fdbPut/fdbDel з files.js. */
const PHOTO_MARK = /^\[фото:([a-z0-9]+)\]$/;

/** Відокремлює позначки фото від тексту нотатки: { body, ids }. */
function splitPhotos(text) {
  const ids = [];
  const body = String(text || '').split('\n').filter((line) => {
    const m = line.match(PHOTO_MARK);
    if (m) { ids.push(m[1]); return false; }
    return true;
  }).join('\n');
  return { body, ids };
}
function joinPhotos(body, ids) {
  return ids.length ? (body ? body + '\n' : '') + ids.map((i) => `[фото:${i}]`).join('\n') : body;
}

/** Стискає фото з камери чи галереї (максимальна сторона maxSide, JPEG). */
function shrinkImage(file, maxSide, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, maxSide / Math.max(im.width, im.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(im.width * k)); c.height = Math.max(1, Math.round(im.height * k));
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('blob'))), 'image/jpeg', quality);
    };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
    im.src = url;
  });
}

const noteImgUrls = {};
async function notePhotoUrl(id) {
  if (noteImgUrls[id]) return noteImgUrls[id];
  const rec = await fdbGet('np:' + id);
  if (!rec) return null;
  noteImgUrls[id] = URL.createObjectURL(rec.blob);
  return noteImgUrls[id];
}
async function saveNotePhoto(file) {
  const blob = await shrinkImage(file, 1280, 0.8);
  const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await fdbPut('np:' + id, { name: 'foto.jpg', mime: 'image/jpeg', blob });
  return id;
}
async function deleteNotePhoto(id) {
  delete noteImgUrls[id];
  await fdbDel('np:' + id);
}
