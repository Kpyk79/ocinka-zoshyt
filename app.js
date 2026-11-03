'use strict';
/* Зошит курсанта: вхід за особистим токеном з QR-коду, дані через RPC-функції Supabase.
   У браузері показується лише екран встановлення; повний зошит працює в встановленому застосунку. */
const SB_URL = 'https://scdgemjqvsucvteyrvks.supabase.co';
const SB_KEY = 'sb_publishable_yCT4VLmKhAWHujKEUc9wSQ_R1JOdjC2';
const LS_TOKEN = 'ocinka.token';
const LS_NOTE = 'ocinka.note';
const LS_DIRTY = 'ocinka.noteDirty';
const LS_CACHE = 'ocinka.cache';
const LS_SEEN = 'ocinka.seenMsg';
const LS_CADET = 'ocinka.cadetId';
const MAX_FILE = 2.5 * 1024 * 1024;

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* приватний режим */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const $app = document.getElementById('app');
const $toast = document.getElementById('toast');
const standalone = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches
  || navigator.standalone === true || /[?&]app=1/.test(location.search);
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const state = {
  token: null, data: null, raw: '', mode: 'online', // online | offline | gone | error
  tab: 'attendance', open: null, drafts: {}, loading: false, error: '',
  compose: { text: '', file: null, sending: false }, images: {}, installed: false, hint: null,
};
let deferredPrompt = null;

const ICONS = {
  attendance: 'M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z',
  tasks: 'M3 13h2v-2H3zm0 4h2v-2H3zm0-8h2V7H3zm4 4h14v-2H7zm0 4h14v-2H7zM7 7v2h14V7z',
  materials: 'M20 2H4a2 2 0 00-2 2v18l4-4h14a2 2 0 002-2V4a2 2 0 00-2-2zM6 9h12v2H6zm8 5H6v-2h8zm4-6H6V6h12z',
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
function fmtTime(iso) {
  return new Date(iso).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function fmtSize(b) { return b >= 1048576 ? `${(b / 1048576).toFixed(1).replace('.', ',')} МБ` : `${Math.max(1, Math.round(b / 1024))} КБ`; }
function safeUrl(u) { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } }
function linkify(text) {
  const out = []; let last = 0;
  for (const m of text.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    const url = safeUrl(m[0]);
    if (!url) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: m[0] }));
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

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
    if (/only for today|only be marked/.test(m)) throw new Error('Відмітити присутність можна лише сьогодні.');
    if (/file too large/.test(m)) throw new Error('Файл завеликий.');
    if (/limit reached/.test(m)) throw new Error('Ліміт повідомлень вичерпано.');
    throw new Error(m || `Помилка сервера (${r.status})`);
  }
  return r.json();
}

/* ---------- токен і кеш ---------- */
function readToken() {
  const m = location.hash.match(/t=([A-Za-z0-9]{16,})/);
  if (m) {
    if (store.get(LS_TOKEN) !== m[1]) store.del(LS_CACHE);
    store.set(LS_TOKEN, m[1]);
    // У браузері (iPhone) хеш потрібен, щоб «На екран Додому» запам'ятала посилання з токеном.
    if (standalone) history.replaceState(null, '', location.pathname + location.search);
  }
  return store.get(LS_TOKEN);
}
function saveCache(raw) { store.set(LS_CACHE, raw); }
function readCache() { try { return JSON.parse(store.get(LS_CACHE) || 'null'); } catch { return null; } }
function forgetNotebook() {
  [LS_TOKEN, LS_NOTE, LS_DIRTY, LS_CACHE, LS_SEEN, LS_CADET].forEach(store.del);
  state.token = null; state.data = null; state.mode = 'online'; state.drafts = {};
  render();
}

/* ---------- дані ---------- */
async function load(silent) {
  if (!state.token) return render();
  if (!silent) { state.loading = true; render(); }
  let changed = true;
  try {
    const d = await rpc('nb_get', { p_token: state.token });
    if (!d) {
      state.mode = 'gone'; state.data = readCache(); state.raw = ''; state.error = '';
    } else {
      const raw = JSON.stringify(d);
      changed = raw !== state.raw;
      state.raw = raw; state.data = d; state.mode = 'online'; state.error = '';
      saveCache(raw);
      if (store.get(LS_CADET) && store.get(LS_CADET) !== d.cadet.id) { store.del(LS_NOTE); store.del(LS_DIRTY); store.del(LS_SEEN); }
      store.set(LS_CADET, d.cadet.id);
      if (store.get(LS_DIRTY) === '1') syncNote();
    }
  } catch (e) {
    if (!state.data) state.data = readCache();
    if (state.data) { state.mode = 'offline'; state.error = ''; } else { state.mode = 'error'; state.error = e.message; }
  }
  state.loading = false;
  if (silent && !changed) return;
  if (!standalone && state.data && state.mode === 'online') prepareInstall(state.data.cadet);
  render();
}

/* ---------- екран встановлення ---------- */
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });
window.addEventListener('appinstalled', () => { state.installed = true; deferredPrompt = null; render(); });

let installPrepared = false;
function prepareInstall(c) {
  if (installPrepared) return;
  installPrepared = true;
  const short = (c.full_name || '').trim().split(/\s+/)[0] || 'Зошит';
  document.title = c.full_name;
  if (isIOS) {
    // iOS бере ім'я й адресу (з токеном у хеші) зі сторінки, а не з маніфесту.
    document.head.append(h('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' }),
      h('meta', { name: 'apple-mobile-web-app-title', content: short }),
      h('meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'default' }));
  } else if (c.pub_id) {
    // Особистий маніфест (ім'я курсанта) віддає сервер за публічним id, не за токеном.
    document.head.append(h('link', { rel: 'manifest', href: `${SB_URL}/rest/v1/rpc/nb_manifest?p_pub=${encodeURIComponent(c.pub_id)}&apikey=${SB_KEY}` }));
  }
}
async function install() {
  if (isIOS) { state.hint = 'ios'; return render(); }
  if (deferredPrompt) {
    deferredPrompt.prompt();
    let outcome = ''; try { outcome = (await deferredPrompt.userChoice).outcome; } catch { /* ignore */ }
    deferredPrompt = null;
    if (outcome === 'accepted') state.installed = true;
    return render();
  }
  state.hint = 'generic'; render();
}
function viewLanding() {
  const c = state.data.cadet;
  const hint = state.hint === 'ios'
    ? h('div', { class: 'card hint' },
      h('strong', { text: 'Як встановити на iPhone' }),
      h('ol', null,
        h('li', { text: 'Відкрийте цю сторінку в Safari.' }),
        h('li', { text: 'Натисніть «Поділитися» (квадрат зі стрілкою внизу).' }),
        h('li', { text: 'Оберіть «На екран «Додому»».' }),
        h('li', { text: 'Натисніть «Додати» і відкрийте зошит з головного екрана.' })))
    : state.hint === 'generic'
      ? h('div', { class: 'card hint' },
        h('strong', { text: 'Встановлення вручну' }),
        h('ol', null,
          h('li', { text: 'Відкрийте меню браузера (три крапки).' }),
          h('li', { text: 'Оберіть «Установити застосунок» або «Додати на головний екран».' })),
        h('p', { class: 'muted', text: 'Якщо зошит уже встановлено, просто відкрийте його на головному екрані.' }))
      : null;
  return h('div', { class: 'center' },
    h('img', { class: 'logo', src: 'icon-192.png', alt: '' }),
    h('h1', { text: c.full_name }),
    h('p', { class: 'muted', text: c.rank || 'Курсант' }),
    state.installed
      ? h('p', { class: 'ok', text: 'Додаток встановлено. Відкрийте його на головному екрані телефона.' })
      : h('button', { class: 'big pri', onclick: install, text: 'Встановити додаток' }),
    hint);
}

/* ---------- екрани ---------- */
function centerMsg(title, text, extra) {
  return h('div', { class: 'center' }, h('h1', { text: title }), h('p', { text }), extra || null);
}
function render() {
  const active = document.activeElement;
  const activeId = active && active.id ? active.id : null;
  const selStart = activeId && active.selectionStart != null ? active.selectionStart : null;
  const selEnd = activeId && active.selectionEnd != null ? active.selectionEnd : null;
  $app.replaceChildren();
  build();
  if (activeId) {
    const el = document.getElementById(activeId);
    if (el) { el.focus({ preventScroll: true }); if (selStart != null && el.setSelectionRange) try { el.setSelectionRange(selStart, selEnd); } catch { /* ignore */ } }
  }
}
function build() {
  if (!state.token) {
    $app.append(centerMsg('Зошит курсанта', 'Відскануйте особистий QR-код, який дав інструктор.',
      h('p', { class: 'muted', text: 'Якщо код не працює, попросіть інструктора створити новий.' })));
    return;
  }
  if (state.mode === 'error' && !state.data) {
    $app.append(h('div', { class: 'center' }, h('p', { class: 'err', text: state.error }), h('button', { class: 'pri', onclick: () => load(), text: 'Спробувати ще' })));
    return;
  }
  if (!standalone) {
    if (state.mode === 'gone' || (!state.data)) {
      $app.append(state.mode === 'gone'
        ? centerMsg('Посилання не діє', 'Цей зошит більше не підключений до навчальної групи. Попросіть інструктора новий QR-код.')
        : h('div', { class: 'center' }, h('p', { class: 'muted', text: 'Завантаження…' })));
      return;
    }
    $app.append(viewLanding());
    return;
  }
  if (!state.data) {
    $app.append(state.mode === 'gone'
      ? centerMsg('Зошит відключено', 'Цей зошит більше не підключений до навчальної групи.')
      : h('div', { class: 'center' }, h('p', { class: 'muted', text: 'Завантаження…' })));
    return;
  }
  const c = state.data.cadet, gone = state.mode === 'gone';
  const tabs = gone ? TABS.filter(([id]) => id !== 'attendance') : TABS;
  if (!tabs.some(([id]) => id === state.tab)) state.tab = tabs[0][0];
  const unread = unreadCount();
  $app.append(
    h('header', { class: 'top' },
      h('div', { class: 'who' }, h('h1', { text: c.full_name }), h('small', { text: c.rank || 'Курсант' })),
      gone ? null : h('button', { class: 'ghost', 'aria-label': 'Оновити', onclick: () => load(), text: state.loading ? '…' : 'Оновити' })),
    gone ? h('div', { class: 'banner bad' },
      h('strong', { text: 'Зошит відключено від навчальної групи' }),
      h('span', { text: 'Нові дані не надходять. Ваші нотатки, завдання й повідомлення лишаються на цьому телефоні.' }),
      h('button', { onclick: () => { if (confirm('Видалити зошит з цього пристрою разом з нотатками?')) forgetNotebook(); }, text: 'Видалити зошит з пристрою' }))
      : state.mode === 'offline' ? h('div', { class: 'banner' }, h('span', { text: 'Немає звʼязку. Показано збережені дані.' })) : null,
    h('main', null, state.error ? h('p', { class: 'err', text: state.error }) : null, ({
      attendance: viewAttendance, tasks: viewTasks, materials: viewMessages, notes: viewNotes,
    })[state.tab]()),
    h('nav', { class: 'tabs' }, tabs.map(([id, label]) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', ICONS[id]); svg.append(p);
      const badge = id === 'materials' && unread > 0 && state.tab !== 'materials' ? h('span', { class: 'badge', text: String(unread) }) : null;
      return h('button', { 'aria-current': state.tab === id ? 'page' : null, onclick: () => { state.tab = id; render(); if (id === 'materials') scrollEnd(); else window.scrollTo(0, 0); } }, svg, label, badge);
    })));
  if (state.tab === 'materials') markSeen();
}

/* ---------- присутність ---------- */
function viewAttendance() {
  const { days, today, attendance } = state.data;
  if (!days.length) return h('p', { class: 'empty', text: 'Інструктор ще не вказав дні навчань.' });
  const offline = state.mode !== 'online';
  return days.map((day, i) => {
    const isToday = day === today, past = day < today, present = attendance[day] === true;
    const status = present ? h('span', { class: 'pill ok', text: 'Присутній' })
      : past ? h('span', { class: 'pill bad', text: 'Не відмічено' })
        : h('span', { class: 'pill', text: isToday ? 'Чекає відмітки' : 'Ще не настав' });
    return h('section', { class: 'card' },
      h('div', { class: 'row' }, h('strong', { text: `День ${i + 1} • ${fmtDay(day)}` }), status),
      isToday ? h('button', {
        class: present ? 'big' : 'big pri', disabled: offline,
        onclick: () => mark(day, !present),
        text: present ? 'Зняти відмітку' : 'Я на занятті',
      }) : null);
  });
}
async function mark(day, present) {
  try {
    await rpc('nb_mark_attendance', { p_token: state.token, p_day: day, p_present: present });
    state.data.attendance[day] = present; state.raw = ''; render();
    toast(present ? 'Присутність відмічено' : 'Відмітку знято');
  } catch (e) { toast(e.message === 'INVALID_TOKEN' ? 'Зошит відключено від групи' : e.message); }
}

/* ---------- повідомлення й матеріали ---------- */
function newestFromInstructor() {
  const list = (state.data.messages || []).filter((m) => m.sender === 'instructor');
  return list.length ? list[list.length - 1].created_at : '';
}
function unreadCount() {
  const seen = store.get(LS_SEEN) || '';
  return (state.data.messages || []).filter((m) => m.sender === 'instructor' && m.created_at > seen).length;
}
function markSeen() {
  const newest = newestFromInstructor();
  if (newest && newest > (store.get(LS_SEEN) || '')) store.set(LS_SEEN, newest);
}
function scrollEnd() { setTimeout(() => window.scrollTo(0, document.body.scrollHeight), 30); }

function viewMessages() {
  const list = state.data.messages || [];
  const online = state.mode === 'online';
  const out = [];
  if (!list.length) out.push(h('p', { class: 'empty', text: 'Повідомлень поки немає.' }));
  for (const m of list) out.push(bubble(m));
  if (online) out.push(composer());
  else if (state.mode === 'gone') out.push(h('p', { class: 'muted center-text', text: 'Листування закрито: зошит відключено від групи.' }));
  return h('div', { class: 'thread' }, out);
}
function bubble(m) {
  const mine = m.sender === 'cadet';
  const file = m.file_name ? fileRow(m) : null;
  return h('article', { class: mine ? 'msg me' : 'msg' },
    h('div', { class: 'meta' },
      h('strong', { text: mine ? 'Ви' : 'Інструктор' }),
      !mine ? h('span', { class: 'pill', text: m.personal ? 'особисто вам' : 'усім' }) : null,
      h('span', { class: 'muted', text: fmtTime(m.created_at) })),
    m.body ? h('div', { class: 'body' }, linkify(m.body)) : null,
    file);
}
function fileRow(m) {
  const img = state.images[m.id];
  const isImage = /^image\//.test(m.file_mime || '');
  return h('div', { class: 'file' },
    img ? h('img', { src: img, alt: m.file_name }) : null,
    h('div', { class: 'row' },
      h('span', { class: 'fname', text: `${m.file_name} • ${fmtSize(m.file_size || 0)}` }),
      state.mode === 'online' ? h('button', { onclick: () => openFile(m, isImage), text: isImage && !img ? 'Показати' : 'Завантажити' }) : null));
}
async function fetchFile(m) {
  const r = await rpc('nb_message_file', { p_token: state.token, p_id: m.id });
  if (!r) throw new Error('Файл недоступний');
  return r;
}
async function openFile(m, isImage) {
  try {
    const r = await fetchFile(m);
    const mime = r.mime || 'application/octet-stream';
    if (isImage && !state.images[m.id]) { state.images[m.id] = `data:${mime};base64,${r.data}`; return render(); }
    const bytes = Uint8Array.from(atob(r.data), (ch) => ch.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const a = h('a', { href: url, download: r.name || 'file' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) { toast(e.message || 'Не вдалося відкрити файл'); }
}
function composer() {
  const c = state.compose;
  const canSend = () => !c.sending && (c.text.trim() !== '' || !!c.file);
  const send = h('button', { class: 'pri', disabled: !canSend(), onclick: sendMessage, text: c.sending ? 'Надсилання…' : 'Надіслати' });
  const ta = h('textarea', { id: 'msgbox', 'aria-label': 'Повідомлення інструктору', placeholder: 'Напишіть інструктору…', rows: 2, oninput: (e) => { c.text = e.target.value; send.disabled = !canSend(); } });
  ta.value = c.text;
  const picker = h('input', { type: 'file', hidden: true, onchange: async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (f) await attach(f);
  } });
  return h('section', { class: 'composer card' },
    c.file ? h('div', { class: 'row chip' },
      h('span', { class: 'fname', text: `${c.file.name} • ${fmtSize(c.file.size)}` }),
      h('button', { class: 'ghost', 'aria-label': 'Прибрати файл', onclick: () => { c.file = null; render(); }, text: '×' })) : null,
    ta, picker,
    h('div', { class: 'row' },
      h('button', { onclick: () => picker.click(), disabled: c.sending, text: 'Додати файл' }),
      send));
}
async function attach(f) {
  try {
    if (/^image\//.test(f.type)) {
      const url = await compress(f);
      const b64 = url.slice(url.indexOf(',') + 1);
      state.compose.file = { name: f.name.replace(/\.[^.]+$/, '') + '.jpg', mime: 'image/jpeg', data: b64, size: Math.floor(b64.length * 3 / 4) };
    } else {
      if (f.size > MAX_FILE) return toast('Файл завеликий (до 2,5 МБ)');
      const b64 = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result).split(',')[1] || '');
        fr.onerror = rej; fr.readAsDataURL(f);
      });
      state.compose.file = { name: f.name, mime: f.type || 'application/octet-stream', data: b64, size: f.size };
    }
    render();
  } catch { toast('Не вдалося обробити файл'); }
}
async function sendMessage() {
  const c = state.compose;
  c.sending = true; render();
  try {
    await rpc('nb_send_message', {
      p_token: state.token, p_body: c.text.trim(),
      p_file_name: c.file ? c.file.name : null, p_file_mime: c.file ? c.file.mime : null, p_file_data: c.file ? c.file.data : null,
    });
    c.text = ''; c.file = null; c.sending = false;
    await load(true);
    render(); scrollEnd();
  } catch (e) {
    c.sending = false; render();
    toast(e.message === 'INVALID_TOKEN' ? 'Зошит відключено від групи' : e.message);
  }
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
  if (state.mode !== 'online') {
    return h('article', { class: 'card' }, head, t.answer ? h('div', { class: 'body muted', text: `Ваша відповідь: ${t.answer}` }) : null);
  }
  if (!open) {
    return h('article', { class: 'card' }, head,
      h('button', { onclick: () => openTask(t), text: t.done ? 'Переглянути відповідь' : 'Виконати' }));
  }
  const photosReady = d.photos !== null;
  const ta = h('textarea', { id: `ans-${t.id}`, 'aria-label': 'Ваша відповідь', placeholder: 'Напишіть відповідь або додайте фото рукописного тексту', oninput: (e) => { d.answer = e.target.value; } });
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
    t.answer = d.answer; t.done = done; t.photo_count = d.photos.length; d.done = done; state.raw = '';
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
let noteTimer;
async function syncNote() {
  const text = store.get(LS_NOTE);
  if (text == null) return;
  try {
    await rpc('nb_save_note', { p_token: state.token, p_body: text });
    if (store.get(LS_NOTE) === text) store.del(LS_DIRTY);
    if (state.data) state.data.note = text;
    return true;
  } catch { return false; }
}
function viewNotes() {
  const online = state.mode === 'online';
  const local = store.get(LS_NOTE), dirty = store.get(LS_DIRTY) === '1';
  const server = state.data.note || '';
  const ta = h('textarea', { id: 'notebox', 'aria-label': 'Мої нотатки', placeholder: 'Ваші особисті нотатки. Їх бачите лише ви.', style: 'min-height:50vh' });
  ta.value = online ? (dirty && local != null ? local : server) : (local != null ? local : server);
  const status = h('span', { class: 'muted', text: online ? (dirty ? 'Не збережено' : 'Збережено') : 'Зберігається на цьому телефоні' });
  ta.addEventListener('input', () => {
    store.set(LS_NOTE, ta.value);
    if (!online) { status.textContent = 'Зберігається на цьому телефоні'; return; }
    store.set(LS_DIRTY, '1'); status.textContent = 'Збереження…';
    clearTimeout(noteTimer);
    noteTimer = setTimeout(async () => {
      status.textContent = (await syncNote()) ? 'Збережено' : 'Не збережено (немає звʼязку), чернетка на цьому пристрої';
    }, 900);
  });
  return h('section', { class: 'card' }, ta, status);
}

/* ---------- старт ---------- */
state.token = readToken();
render();
load();
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.data && state.tab !== 'notes') load(true); });
setInterval(() => {
  if (document.hidden || !state.token || state.tab === 'notes' || state.compose.sending) return;
  if (standalone && state.mode !== 'gone') load(true);
}, 15000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
