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

/* ---------- власна камера ----------
   Атрибут capture у вбудованих застосунках (PWA) часто ігнорується, і замість камери відкривається галерея.
   Тому знімаємо самі через getUserMedia; якщо камера недоступна, пропонуємо звичайний вибір файлу. */
function takePhoto() {
  return new Promise(async (resolve, reject) => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return reject(new Error('no camera api'));
    let facing = 'environment', stream = null;
    const video = h('video', { class: 'cam-video', playsinline: '', autoplay: '', muted: '' });
    video.muted = true;
    const stop = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; };
    const start = async () => {
      stop();
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
      video.srcObject = stream;
      await video.play();
    };
    const close = (file) => { stop(); root.remove(); resolve(file || null); };
    const shoot = () => {
      if (!video.videoWidth) return;
      const c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      c.toBlob((b) => close(b ? new File([b], 'foto.jpg', { type: 'image/jpeg' }) : null), 'image/jpeg', 0.9);
    };
    const root = h('div', { class: 'cam', role: 'dialog', 'aria-label': 'Камера' },
      video,
      h('div', { class: 'cam-bar' },
        h('button', { class: 'cam-btn', onclick: () => close(null), text: 'Скасувати' }),
        h('button', { class: 'cam-shot', 'aria-label': 'Зробити знімок', onclick: shoot }),
        h('button', { class: 'cam-btn', onclick: async () => { facing = facing === 'environment' ? 'user' : 'environment'; try { await start(); } catch { /* лишаємо як є */ } }, text: 'Інша камера' })));
    document.body.append(root);
    try { await start(); } catch (e) { stop(); root.remove(); reject(e); }
  });
}
