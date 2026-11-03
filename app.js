'use strict';
/* Зошит курсанта: вхід за особистим токеном з QR-коду, дані через RPC-функції Supabase. */
const SB_URL = 'https://scdgemjqvsucvteyrvks.supabase.co';
const SB_KEY = 'sb_publishable_yCT4VLmKhAWHujKEUc9wSQ_R1JOdjC2';
const LS_TOKEN = 'ocinka.token';
const LS_NOTE = 'ocinka.noteDraft';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* приватний режим */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const $app = document.getElementById('app');
const $toast = document.getElementById('toast');
const state = { token: null, data: null, tab: 'attendance', open: null, drafts: {}, photoCache: {}, loading: false, error: '' };

const ICONS = {
  attendance: 'M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z',
  tasks: 'M3 13h2v-2H3zm0 4h2v-2H3zm0-8h2V7H3zm4 4h14v-2H7zm0 4h14v-2H7zM7 7v2h14V7z',
  materials: 'M4 4h12l4 4v12H4zm11 1.5V9h3.5zM7 12h10v-1.5H7zm0 3h10v-1.5H7zm0 3h6v-1.5H7z',
  notes: 'M3 17.3V21h3.7L17.8 9.9l-3.7-3.7zM20.7 7a1 1 0 000-1.4l-2.3-2.3a1 1 0 00-1.4 0l-1.8 1.8 3.7 3.7z',
};
const TABS = [['attendance', 'Присутність'], ['tasks', 'Завдання'], ['materials', 'Матеріали'], ['notes', 'Нотатки']];

/* ---------- утиліти ---------- */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}
function toast(msg) {
  $toast.textContent = msg; $toast.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { $toast.hidden = true; }, 2600);
}
function fmtDay(iso) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', weekday: 'short' });
}
function safeUrl(u) { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } }

async function rpc(fn, args) {
  let r;
  try {
    r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
  } catch { throw new Error('Немає звʼязку з сервером. Перевірте інтернет.'); }
  if (!r.ok) {
    let m = ''; try { m = (await r.json()).message || ''; } catch { /* ignore */ }
    if (/invalid token/.test(m)) throw new Error('INVALID_TOKEN');
    if (/only for today/.test(m)) throw new Error('Відмітити присутність можна лише сьогодні.');
    throw new Error(m || `Помилка сервера (${r.status})`);
  }
  return r.json();
}

/* ---------- токен ---------- */
function readToken() {
  const m = location.hash.match(/t=([A-Za-z0-9]{16,})/);
  if (m) { store.set(LS_TOKEN, m[1]); history.replaceState(null, '', location.pathname + location.search); }
  return store.get(LS_TOKEN);
}

/* ---------- дані ---------- */
async function load(silent) {
  if (!state.token) return render();
  if (!silent) { state.loading = true; render(); }
  try {
    state.data = await rpc('nb_get', { p_token: state.token });
    state.error = state.data ? '' : 'INVALID_TOKEN';
  } catch (e) {
    state.error = e.message;
  }
  state.loading = false;
  render();
}

/* ---------- екрани ---------- */
function render() {
  $app.replaceChildren();
  if (!state.token || state.error === 'INVALID_TOKEN') {
    $app.append(h('div', { class: 'center' },
      h('h1', { text: 'Зошит курсанта' }),
      h('p', { text: state.error === 'INVALID_TOKEN' ? 'Це посилання більше не діє.' : 'Відскануйте особистий QR-код, який дав інструктор.' }),
      h('p', { class: 'muted', text: 'Якщо код не працює, попросіть інструктора створити новий.' })));
    return;
  }
  if (!state.data) {
    $app.append(h('div', { class: 'center' },
      state.error ? [h('p', { class: 'err', text: state.error }), h('button', { class: 'pri', onclick: () => load(), text: 'Спробувати ще' })]
        : h('p', { class: 'muted', text: 'Завантаження…' })));
    return;
  }
  const c = state.data.cadet;
  $app.append(
    h('header', { class: 'top' },
      h('div', { class: 'who' }, h('h1', { text: c.full_name }), h('small', { text: c.rank || 'Курсант' })),
      h('button', { class: 'ghost', 'aria-label': 'Оновити', onclick: () => load(), text: state.loading ? '…' : 'Оновити' })),
    h('main', null, state.error ? h('p', { class: 'err', text: state.error }) : null, ({
      attendance: viewAttendance, tasks: viewTasks, materials: viewMaterials, notes: viewNotes,
    })[state.tab]()),
    h('nav', { class: 'tabs' }, TABS.map(([id, label]) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', ICONS[id]); svg.append(p);
      return h('button', { 'aria-current': state.tab === id ? 'page' : null, onclick: () => { state.tab = id; render(); window.scrollTo(0, 0); } }, svg, label);
    })));
}

function viewAttendance() {
  const { days, today, attendance } = state.data;
  if (!days.length) return h('p', { class: 'empty', text: 'Інструктор ще не вказав дні навчань.' });
  return days.map((day, i) => {
    const isToday = day === today, past = day < today, present = attendance[day] === true;
    const status = present ? h('span', { class: 'pill ok', text: 'Присутній' })
      : past ? h('span', { class: 'pill bad', text: 'Не відмічено' })
        : h('span', { class: 'pill', text: isToday ? 'Чекає відмітки' : 'Ще не настав' });
    return h('section', { class: 'card' },
      h('div', { class: 'row' }, h('strong', { text: `День ${i + 1} • ${fmtDay(day)}` }), status),
      isToday ? h('button', {
        class: present ? 'big' : 'big pri',
        onclick: () => mark(day, !present),
        text: present ? 'Зняти відмітку' : 'Я на занятті',
      }) : null);
  });
}
async function mark(day, present) {
  try {
    await rpc('nb_mark_attendance', { p_token: state.token, p_day: day, p_present: present });
    state.data.attendance[day] = present; render();
    toast(present ? 'Присутність відмічено' : 'Відмітку знято');
  } catch (e) { toast(e.message === 'INVALID_TOKEN' ? 'Посилання більше не діє' : e.message); }
}

function viewMaterials() {
  const list = state.data.materials;
  if (!list.length) return h('p', { class: 'empty', text: 'Матеріалів поки немає.' });
  return list.map((m) => {
    const url = m.link ? safeUrl(m.link) : null;
    return h('article', { class: 'card' },
      h('div', { class: 'row' }, h('strong', { text: m.title }), m.personal ? h('span', { class: 'pill warn', text: 'Особисто вам' }) : null),
      m.body ? h('div', { class: 'body', text: m.body }) : null,
      url ? h('a', { class: 'btn pri', href: url, target: '_blank', rel: 'noopener noreferrer', text: 'Відкрити посилання' }) : null,
      h('span', { class: 'muted', text: new Date(m.created_at).toLocaleDateString('uk-UA') }));
  });
}

/* ---------- завдання ---------- */
function draftFor(t) {
  if (!state.drafts[t.id]) state.drafts[t.id] = { answer: t.answer, photos: null, done: t.done, saving: false };
  return state.drafts[t.id];
}
function viewTasks() {
  const tasks = state.data.tasks;
  if (!tasks.length) return h('p', { class: 'empty', text: 'Завдань поки немає.' });
  const days = [...new Set(tasks.map((t) => t.day))];
  const out = [];
  for (const day of days) {
    out.push(h('h2', { text: fmtDay(day) }));
    for (const t of tasks.filter((x) => x.day === day)) out.push(taskCard(t));
  }
  return out;
}
function taskCard(t) {
  const d = draftFor(t), open = state.open === t.id;
  const badge = t.done ? h('span', { class: 'pill ok', text: 'Виконано' }) : h('span', { class: 'pill', text: 'Не виконано' });
  const head = h('div', { class: 'row' }, h('div', { class: 'body', text: t.text }), badge);
  if (!open) {
    return h('article', { class: 'card' }, head,
      h('button', { onclick: () => openTask(t), text: t.done ? 'Переглянути відповідь' : 'Виконати' }));
  }
  const photosReady = d.photos !== null;
  const ta = h('textarea', { 'aria-label': 'Ваша відповідь', placeholder: 'Напишіть відповідь або додайте фото рукописного тексту', oninput: (e) => { d.answer = e.target.value; } });
  ta.value = d.answer;
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (d.photos.length >= 3) return toast('Можна додати не більше 3 фото');
    try { d.photos.push(await compress(f)); render(); } catch { toast('Не вдалося обробити фото'); }
  } });
  return h('article', { class: 'card' }, head, ta,
    photosReady ? h('div', { class: 'photos' }, d.photos.map((src, i) => h('figure', null,
      h('img', { src, alt: `Фото ${i + 1}` }),
      h('button', { 'aria-label': 'Видалити фото', onclick: () => { d.photos.splice(i, 1); render(); }, text: '×' })))) : h('p', { class: 'muted', text: 'Завантаження фото…' }),
    file,
    h('button', { disabled: !photosReady || d.photos.length >= 3, onclick: () => file.click(), text: 'Додати фото' }),
    h('div', { class: 'row' },
      h('button', { class: 'ghost', onclick: () => { state.open = null; render(); }, text: 'Згорнути' }),
      h('button', { class: 'pri', disabled: !photosReady || d.saving, onclick: () => save(t, d, true), text: d.saving ? 'Збереження…' : 'Здати' })),
    h('button', { disabled: !photosReady || d.saving, onclick: () => save(t, d, false), text: 'Зберегти чернетку' }));
}
async function openTask(t) {
  state.open = t.id; const d = draftFor(t); render();
  if (d.photos !== null) return;
  if (!t.photo_count) { d.photos = []; return render(); }
  try { d.photos = (await rpc('nb_task_photos', { p_token: state.token, p_task: t.id })) || []; } catch { d.photos = []; toast('Не вдалося завантажити фото'); }
  render();
}
async function save(t, d, done) {
  d.saving = true; render();
  try {
    await rpc('nb_submit', { p_token: state.token, p_task: t.id, p_answer: d.answer, p_photos: d.photos, p_done: done });
    t.answer = d.answer; t.done = done; t.photo_count = d.photos.length; d.done = done;
    if (done) state.open = null;
    toast(done ? 'Завдання здано' : 'Чернетку збережено');
  } catch (e) { toast(e.message); }
  d.saving = false; render();
}
async function compress(file) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  let q = 0.72, url;
  do { url = c.toDataURL('image/jpeg', q); q -= 0.1; } while (url.length > 650000 && q > 0.3);
  if (url.length > 690000) throw new Error('big');
  return url;
}

/* ---------- нотатки ---------- */
function viewNotes() {
  const draft = store.get(LS_NOTE);
  const ta = h('textarea', { 'aria-label': 'Мої нотатки', placeholder: 'Ваші особисті нотатки. Їх бачите лише ви.', style: 'min-height:50vh' });
  ta.value = draft != null ? draft : state.data.note;
  const status = h('span', { class: 'muted', text: draft != null && draft !== state.data.note ? 'Не збережено' : 'Збережено' });
  let timer;
  ta.addEventListener('input', () => {
    store.set(LS_NOTE, ta.value); status.textContent = 'Збереження…';
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        await rpc('nb_save_note', { p_token: state.token, p_body: ta.value });
        state.data.note = ta.value; store.del(LS_NOTE); status.textContent = 'Збережено';
      } catch { status.textContent = 'Не збережено (немає звʼязку), чернетка на цьому пристрої'; }
    }, 900);
  });
  return h('section', { class: 'card' }, ta, status);
}

/* ---------- старт ---------- */
state.token = readToken();
render();
load();
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.data && state.tab !== 'notes') load(true); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
