'use strict';
/* Зошит курсанта: вхід за особистим токеном з QR-коду, дані через RPC-функції Supabase.
   У браузері показується лише екран встановлення; повний зошит працює в встановленому застосунку. */
const SB_URL = 'https://scdgemjqvsucvteyrvks.supabase.co';
const SB_KEY = 'sb_publishable_yCT4VLmKhAWHujKEUc9wSQ_R1JOdjC2';
const VAPID_PUBLIC = 'BA2ZuaF9htYnJcGrC7kBrsni1gOjNfKbtkE5rEPtixLYsLSxAl_bCYxkQI2T4QLyo6T7irkH1MmDHCfEmQ-iQGA';
const LS_TOKEN = 'ocinka.token';
const LS_NOTE = 'ocinka.note';
const LS_DIRTY = 'ocinka.noteDirty';
const LS_CACHE = 'ocinka.cache';
const LS_SEEN = 'ocinka.seenMsg';
const LS_CADET = 'ocinka.cadetId';
const LS_PALETTE = 'ocinka.palette';
const LS_THEME = 'ocinka.theme';
const LS_REMIND_OFF = 'ocinka.remindOff';
const LS_REMIND_ASKED = 'ocinka.remindAsked';
const MAX_FILE = 2.5 * 1024 * 1024;
const TAB_IDS = ['attendance', 'materials', 'tasks', 'notes'];

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* приватний режим */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const $app = document.getElementById('app');
const $toast = document.getElementById('toast');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const standalone = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches
  || navigator.standalone === true || /[?&]app=1/.test(location.search);
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const state = {
  token: null, data: null, raw: '', mode: 'online', // online | offline | gone | error
  tab: 'attendance', open: null, drafts: {}, loading: false, error: '',
  compose: { text: '', file: null, sending: false }, images: {}, installed: false, hint: null,
  anim: true, sheet: false, sheetFresh: false, push: { on: false, busy: false }, justMarked: null,
  knownMsg: new Set(), msgReady: false, pushSynced: false, saved: new Set(),
};
let deferredPrompt = null;

const PALETTES = [
  ['olive', 'Олива', 130], ['sky', 'Небо', 245], ['amber', 'Бурштин', 75],
  ['rose', 'Троянда', 10], ['violet', 'Фіолет', 300], ['graphite', 'Графіт', null],
];

const ICONS = {
  attendance: 'M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z',
  materials: 'M20 2H4a2 2 0 00-2 2v18l4-4h14a2 2 0 002-2V4a2 2 0 00-2-2zM6 9h12v2H6zm8 5H6v-2h8zm4-6H6V6h12z',
  tasks: 'M3 13h2v-2H3zm0 4h2v-2H3zm0-8h2V7H3zm4 4h14v-2H7zm0 4h14v-2H7zM7 7v2h14V7z',
  notes: 'M3 17.3V21h3.7L17.8 9.9l-3.7-3.7zM20.7 7a1 1 0 000-1.4l-2.3-2.3a1 1 0 00-1.4 0l-1.8 1.8 3.7 3.7z',
  attach: 'M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 015 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 005 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6z',
  refresh: 'M17.65 6.35A7.96 7.96 0 0012 4a8 8 0 108 8h-2a6 6 0 11-1.76-4.24L13 11h7V4z',
  gear: 'M19.4 13a7.7 7.7 0 000-2l2.1-1.6a.5.5 0 00.1-.6l-2-3.5a.5.5 0 00-.6-.2l-2.5 1a7.3 7.3 0 00-1.7-1l-.4-2.6a.5.5 0 00-.5-.4h-4a.5.5 0 00-.5.4L9 5.1a7.3 7.3 0 00-1.7 1l-2.5-1a.5.5 0 00-.6.2l-2 3.5a.5.5 0 00.1.6L4.6 11a7.7 7.7 0 000 2l-2.1 1.6a.5.5 0 00-.1.6l2 3.5c.1.2.4.3.6.2l2.5-1c.5.4 1.1.7 1.7 1l.4 2.6c0 .2.2.4.5.4h4c.3 0 .5-.2.5-.4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.5 1c.2.1.5 0 .6-.2l2-3.5a.5.5 0 00-.1-.6zM12 15.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7z',
};
const TABS = [['attendance', 'Присутність'], ['materials', 'Матеріали'], ['tasks', 'Завдання'], ['notes', 'Нотатки']];

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
function svgIcon(path, cls) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  if (cls) svg.setAttribute('class', cls);
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', path); svg.append(p);
  return svg;
}
function checkMark(draw) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 28 28'); svg.setAttribute('class', draw ? 'check draw' : 'check'); svg.setAttribute('aria-hidden', 'true');
  const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); c.setAttribute('cx', '14'); c.setAttribute('cy', '14'); c.setAttribute('r', '13');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', 'M8 14.5l4 4 8-9');
  svg.append(c, p);
  return svg;
}
function toast(msg) {
  $toast.textContent = msg; $toast.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { $toast.hidden = true; }, 2600);
}
function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms || 15); } catch { /* ignore */ } }
function confetti(x, y) {
  if (reduceMotion) return;
  const box = h('div', { class: 'confetti' });
  box.style.left = `${x}px`; box.style.top = `${y}px`;
  for (let i = 0; i < 28; i++) {
    const a = Math.random() * Math.PI * 2, v = 70 + Math.random() * 130;
    const p = document.createElement('i');
    p.style.setProperty('--dx', `${Math.cos(a) * v}px`);
    p.style.setProperty('--dy', `${Math.sin(a) * v - 90}px`);
    p.style.setProperty('--r', `${Math.random() * 720 - 360}deg`);
    p.style.background = `oklch(${62 + Math.random() * 22}% .17 ${Math.floor(Math.random() * 360)})`;
    box.append(p);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 1100);
}
function fmtDay(iso) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', weekday: 'short' });
}
function fmtTime(iso) { return new Date(iso).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }); }
function dayLabel(iso) {
  const d = new Date(iso), now = new Date();
  const key = (x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  if (key(d) === key(now)) return 'Сьогодні';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (key(d) === key(y)) return 'Вчора';
  return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });
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
function nameParts(full) {
  const p = (full || '').trim().split(/\s+/).filter(Boolean);
  return { surname: p[0] || '', given: p[1] || '', initials: ((p[0] || '')[0] || '') + ((p[1] || '')[0] || '') };
}
function greeting(full) {
  const hr = new Date().getHours();
  const g = hr < 5 ? 'Доброї ночі' : hr < 12 ? 'Доброго ранку' : hr < 18 ? 'Доброго дня' : 'Добрий вечір';
  const n = nameParts(full).given;
  return n ? `${g}, ${n}!` : `${g}!`;
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

/* ---------- вигляд: палітра й тема ---------- */
function cssToHex(color) {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 1;
    const ctx = c.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  } catch { return null; }
}
function applyPrefs() {
  const root = document.documentElement;
  const pal = store.get(LS_PALETTE), theme = store.get(LS_THEME);
  if (pal && pal !== 'olive') root.dataset.palette = pal; else delete root.dataset.palette;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme; else delete root.dataset.theme;
  setTimeout(() => {
    const hex = cssToHex(getComputedStyle(root).getPropertyValue('--pri').trim());
    const meta = document.querySelector('meta[name=theme-color]');
    if (hex && meta) meta.setAttribute('content', hex);
  }, 50);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyPrefs);

/* ---------- токен і кеш ---------- */
function readToken() {
  const m = location.hash.match(/t=([A-Za-z0-9]{16,})/);
  if (m) {
    if (store.get(LS_TOKEN) !== m[1]) { store.del(LS_CACHE); fdbClear(); }
    store.set(LS_TOKEN, m[1]);
    // У браузері (iPhone) хеш потрібен, щоб «На екран Додому» запам'ятала посилання з токеном.
    if (standalone) history.replaceState(null, '', location.pathname + location.search);
  }
  return store.get(LS_TOKEN);
}
function saveCache(raw) { store.set(LS_CACHE, raw); }
function readCache() { try { return JSON.parse(store.get(LS_CACHE) || 'null'); } catch { return null; } }
function forgetNotebook() {
  [LS_TOKEN, LS_NOTE, LS_DIRTY, LS_CACHE, LS_SEEN, LS_CADET, LS_REMIND_OFF, LS_REMIND_ASKED].forEach(store.del);
  state.token = null; state.data = null; state.mode = 'online'; state.drafts = {}; state.sheet = false;
  fdbClear();
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
      if (store.get(LS_CADET) && store.get(LS_CADET) !== d.cadet.id) { store.del(LS_NOTE); store.del(LS_DIRTY); store.del(LS_SEEN); fdbClear(); }
      store.set(LS_CADET, d.cadet.id);
      if (store.get(LS_DIRTY) === '1') syncNote();
      resyncPush();
      prefetchFiles();
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
  document.title = 'Зошит';
  if (isIOS) {
    // iOS бере ім'я й адресу (з токеном у хеші) зі сторінки, а не з маніфесту.
    document.head.append(h('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' }),
      h('meta', { name: 'apple-mobile-web-app-title', content: 'Зошит' }),
      h('meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'default' }));
  } else if (c.pub_id) {
    // Маніфест віддає сервер за публічним id (не за токеном).
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

/* ---------- каркас ---------- */
function centerMsg(title, text, extra) {
  return h('div', { class: 'center' }, h('h1', { text: title }), h('p', { text }), extra || null);
}
function skeleton() {
  return h('div', { class: 'center' }, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }));
}
function render() {
  const active = document.activeElement;
  const activeId = active && active.id ? active.id : null;
  const selStart = activeId && active.selectionStart != null ? active.selectionStart : null;
  const selEnd = activeId && active.selectionEnd != null ? active.selectionEnd : null;
  $app.replaceChildren();
  $app.append(...build().filter(Boolean));
  state.anim = false; state.sheetFresh = false;
  if (activeId) {
    const el = document.getElementById(activeId);
    if (el) { el.focus({ preventScroll: true }); if (selStart != null && el.setSelectionRange) try { el.setSelectionRange(selStart, selEnd); } catch { /* ignore */ } }
  }
}
function build() {
  if (!state.token) {
    return [centerMsg('Зошит курсанта', 'Відскануйте особистий QR-код, який дав інструктор.',
      h('p', { class: 'muted', text: 'Якщо код не працює, попросіть інструктора створити новий.' }))];
  }
  if (state.mode === 'error' && !state.data) {
    return [h('div', { class: 'center' }, h('p', { class: 'err', text: state.error }), h('button', { class: 'pri', onclick: () => load(), text: 'Спробувати ще' }))];
  }
  if (!standalone) {
    if (state.mode === 'gone') return [centerMsg('Посилання не діє', 'Цей зошит більше не підключений до навчальної групи. Попросіть інструктора новий QR-код.')];
    if (!state.data) return [skeleton()];
    return [viewLanding()];
  }
  if (!state.data) {
    return [state.mode === 'gone' ? centerMsg('Зошит відключено', 'Цей зошит більше не підключений до навчальної групи.') : skeleton()];
  }
  const c = state.data.cadet, gone = state.mode === 'gone';
  const tabs = gone ? TABS.filter(([id]) => id !== 'attendance') : TABS;
  if (!tabs.some(([id]) => id === state.tab)) state.tab = tabs[0][0];
  const unread = unreadCount();
  const main = h('main', { class: state.anim ? 'enter' : null }, state.error ? h('p', { class: 'err', text: state.error }) : null, ({
    attendance: viewAttendance, tasks: viewTasks, materials: viewMessages, notes: viewNotes,
  })[state.tab]());
  [...main.children].forEach((el, i) => el.style.setProperty('--i', Math.min(i, 8)));

  const parts = [
    h('header', { class: 'top' },
      h('div', { class: 'avatar', 'aria-hidden': 'true', text: nameParts(c.full_name).initials.toUpperCase() }),
      h('div', { class: 'who' }, h('small', { class: 'hello', text: greeting(c.full_name) }), h('h1', { text: c.full_name }), h('small', { text: c.rank || 'Курсант' })),
      gone ? null : h('button', { class: state.loading ? 'icon-btn spin' : 'icon-btn', 'aria-label': 'Оновити', onclick: () => load() }, svgIcon(ICONS.refresh)),
      h('button', { class: 'icon-btn', 'aria-label': 'Налаштування', onclick: openSheet }, svgIcon(ICONS.gear))),
    gone ? h('div', { class: 'banner bad' },
      h('strong', { text: 'Зошит відключено від навчальної групи' }),
      h('span', { text: 'Нові дані не надходять. Ваші нотатки, завдання й повідомлення лишаються на цьому телефоні.' }),
      h('button', { onclick: () => { if (confirm('Видалити зошит з цього пристрою разом з нотатками?')) forgetNotebook(); }, text: 'Видалити зошит з пристрою' }))
      : state.mode === 'offline' ? h('div', { class: 'banner' }, h('span', { text: 'Немає звʼязку. Показано збережені дані.' })) : null,
    main,
    h('nav', { class: state.anim ? 'tabs anim' : 'tabs' }, tabs.map(([id, label]) => {
      const badge = id === 'materials' && unread > 0 && state.tab !== 'materials' ? h('span', { class: 'badge', text: String(unread) }) : null;
      return h('button', { 'aria-current': state.tab === id ? 'page' : null, onclick: () => goTab(id) }, svgIcon(ICONS[id]), label, badge);
    })),
    state.sheet ? sheetView() : null,
  ];
  if (state.tab === 'materials') markSeen();
  return parts;
}
function goTab(id) {
  if (state.tab === id) return;
  state.tab = id; state.anim = true; buzz(8); render();
  if (id === 'materials') scrollEnd(); else window.scrollTo(0, 0);
}

/* ---------- налаштування ---------- */
function openSheet() { state.sheet = true; state.sheetFresh = true; render(); refreshPush(); }
function closeSheet() { state.sheet = false; render(); }
function sheetView() {
  const pal = store.get(LS_PALETTE) || 'olive', theme = store.get(LS_THEME) || 'auto';
  const gone = state.mode === 'gone';
  const sheet = h('div', { class: state.sheetFresh ? 'sheet fresh' : 'sheet', role: 'dialog', 'aria-label': 'Налаштування' },
    h('div', { class: 'grip' }),
    h('div', { class: 'row' }, h('h2', { text: 'Налаштування' }), h('button', { class: 'ghost', onclick: closeSheet, text: 'Готово' })),
    h('div', null, h('strong', { text: 'Колір' }),
      h('div', { class: 'swatches', style: 'margin-top:10px' }, PALETTES.map(([id, label, hue]) => h('button', {
        class: 'swatch', 'aria-label': label, title: label, 'aria-pressed': pal === id ? 'true' : 'false',
        style: `background:oklch(55% ${hue == null ? '.02' : '.14'} ${hue == null ? 130 : hue})`,
        onclick: () => { store.set(LS_PALETTE, id); applyPrefs(); buzz(10); render(); },
      })))),
    h('div', null, h('strong', { text: 'Тема' }),
      h('div', { class: 'seg', style: 'margin-top:10px' }, [['auto', 'Авто'], ['light', 'Світла'], ['dark', 'Темна']].map(([id, label]) => h('button', {
        'aria-pressed': theme === id ? 'true' : 'false',
        onclick: () => { if (id === 'auto') store.del(LS_THEME); else store.set(LS_THEME, id); applyPrefs(); render(); },
        text: label,
      })))),
    gone ? null : reminderRow(),
    silenceRow());
  return h('div', null, h('div', { class: state.sheetFresh ? 'backdrop fresh' : 'backdrop', onclick: closeSheet }), sheet);
}
function reminderRow() {
  const p = state.push;
  let sub = 'Щодня о 20:00, якщо є невиконане домашнє завдання.';
  let disabled = p.busy;
  if (!pushSupported) {
    sub = isIOS && !standalone ? 'На iPhone працює після додавання на екран «Додому».' : 'Цей браузер не підтримує сповіщення.';
    disabled = true;
  } else if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
    sub = 'Сповіщення заблоковано в налаштуваннях телефона.'; disabled = true;
  }
  return h('div', { class: 'row' },
    h('div', null, h('strong', { text: 'Нагадування про завдання' }), h('div', { class: 'muted', text: sub })),
    h('button', { class: 'switch', role: 'switch', 'aria-label': 'Нагадування', 'aria-checked': p.on ? 'true' : 'false', disabled, onclick: toggleReminders }));
}

/* ---------- нагадування (Web Push) ---------- */
function b64ToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function currentSub() {
  if (!pushSupported) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}
async function refreshPush() {
  try { state.push.on = !!(await currentSub()) && Notification.permission === 'granted'; } catch { state.push.on = false; }
  if (state.sheet) render();
}
async function saveSub(sub) {
  const j = sub.toJSON();
  await rpc('nb_save_push', { p_token: state.token, p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
  if (store.get(LS_SILENCE_OFF) === '1') await setSilencePush(false);
}
async function subscribePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC) });
  await saveSub(sub);
}
/* Нагадування увімкнені за замовчуванням: у встановленому застосунку один раз просимо дозвіл
   (за першим дотиком, цього вимагають браузери); якщо курсант вимкнув їх сам, більше не нав'язуємо. */
async function resyncPush() {
  if (state.pushSynced || !standalone || !pushSupported || store.get(LS_REMIND_OFF) === '1') return;
  state.pushSynced = true;
  try {
    if (Notification.permission === 'granted') {
      await subscribePush();
    } else if (Notification.permission === 'default' && store.get(LS_REMIND_ASKED) !== '1') {
      document.addEventListener('click', async () => {
        if (store.get(LS_REMIND_ASKED) === '1' || store.get(LS_REMIND_OFF) === '1') return;
        store.set(LS_REMIND_ASKED, '1');
        try {
          if ((await Notification.requestPermission()) === 'granted') { await subscribePush(); state.push.on = true; toast('Нагадування про завдання увімкнено: щодня о 20:00'); }
        } catch { /* ігноруємо */ }
      }, { once: true, capture: true });
    }
  } catch { state.pushSynced = false; }
}
async function toggleReminders() {
  const p = state.push;
  p.busy = true; render();
  try {
    if (p.on) {
      const s = await currentSub();
      if (s) { try { await rpc('nb_delete_push', { p_token: state.token, p_endpoint: s.endpoint }); } catch { /* ignore */ } await s.unsubscribe(); }
      store.set(LS_REMIND_OFF, '1');
      p.on = false; toast('Нагадування вимкнено');
    } else {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Дозвіл на сповіщення не надано');
      await subscribePush();
      store.del(LS_REMIND_OFF); store.set(LS_REMIND_ASKED, '1');
      p.on = true; buzz(20); toast('Нагадування увімкнено: щодня о 20:00');
    }
  } catch (e) { toast(e.message || 'Не вдалося змінити нагадування'); }
  p.busy = false; render();
}

/* ---------- присутність ---------- */
function ringSvg(frac) {
  const C = 2 * Math.PI * 34;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 84 84'); svg.setAttribute('class', 'ring'); svg.setAttribute('aria-hidden', 'true');
  svg.style.setProperty('--c', C.toFixed(1)); svg.style.setProperty('--off', (C * (1 - frac)).toFixed(1));
  for (const cls of ['bg', 'fg']) {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('class', cls); c.setAttribute('cx', '42'); c.setAttribute('cy', '42'); c.setAttribute('r', '34');
    svg.append(c);
  }
  return svg;
}
function viewAttendance() {
  const { days, today, attendance } = state.data;
  if (!days.length) return h('p', { class: 'empty', text: 'Інструктор ще не вказав дні навчань.' });
  const offline = state.mode !== 'online';
  const elapsed = days.filter((d) => d <= today);
  const present = elapsed.filter((d) => attendance[d] === true).length;
  const frac = elapsed.length ? present / elapsed.length : 0;
  const summary = h('section', { class: 'card summary' }, ringSvg(frac),
    h('div', null,
      h('div', { class: 'big-n', text: `${present} з ${elapsed.length || days.length}` }),
      h('div', { class: 'muted', text: elapsed.length ? 'днів ви були на занятті' : 'навчання ще не почалось' })));
  const list = days.map((day, i) => {
    const isToday = day === today, past = day < today, isPresent = attendance[day] === true;
    const status = isPresent ? h('span', { class: 'pill ok', text: 'Присутній' })
      : past ? h('span', { class: 'pill bad', text: 'Не відмічено' })
        : h('span', { class: 'pill', text: isToday ? 'Чекає відмітки' : 'Ще не настав' });
    return h('section', { class: `card day${isToday ? ' today' : ''}${isPresent ? ' present' : ''}` },
      h('div', { class: 'row' },
        h('div', { class: 'row', style: 'justify-content:flex-start' }, isPresent ? checkMark(state.justMarked === day) : null, h('strong', { text: `День ${i + 1} • ${fmtDay(day)}` })),
        status),
      isToday ? h('button', {
        class: isPresent ? 'big' : 'big pri', disabled: offline,
        onclick: (e) => mark(day, !isPresent, e),
        text: isPresent ? 'Зняти відмітку' : 'Я на занятті',
      }) : null);
  });
  return [summary, ...list];
}
async function mark(day, present, ev) {
  const x = ev ? ev.clientX : innerWidth / 2, y = ev ? ev.clientY : innerHeight / 2;
  try {
    await rpc('nb_mark_attendance', { p_token: state.token, p_day: day, p_present: present });
    state.data.attendance[day] = present; state.raw = '';
    state.justMarked = present ? day : null; render();
    if (present) { confetti(x, y); buzz([20, 30, 20]); }
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
function scrollEnd() { setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' }), 40); }

function viewMessages() {
  const list = state.data.messages || [];
  const online = state.mode === 'online';
  const out = [];
  if (!list.length) out.push(h('p', { class: 'empty', text: 'Повідомлень поки немає.' }));
  let lastDay = '';
  for (const m of list) {
    const dl = dayLabel(m.created_at);
    if (dl !== lastDay) { out.push(h('div', { class: 'day-sep', text: dl })); lastDay = dl; }
    out.push(bubble(m));
    state.knownMsg.add(m.id);
  }
  state.msgReady = true;
  if (online) out.push(composer());
  else if (state.mode === 'gone') out.push(h('p', { class: 'muted center-text', text: 'Листування закрито: зошит відключено від групи. Збережені матеріали залишаються доступними.' }));
  return h('div', { class: 'thread' }, out);
}
function bubble(m) {
  const mine = m.sender === 'cadet';
  const isNew = state.msgReady && !state.knownMsg.has(m.id);
  const file = m.file_name ? fileRow(m) : null;
  return h('article', { class: `msg${mine ? ' me' : ''}${isNew ? ' new' : ''}` },
    h('div', { class: 'meta' },
      h('strong', { text: mine ? 'Ви' : 'Інструктор' }),
      !mine ? h('span', { class: 'pill', text: m.personal ? 'особисто вам' : 'усім' }) : null,
      h('span', { class: 'muted', text: fmtTime(m.created_at) })),
    m.body ? h('div', { class: 'body' }, linkify(m.body)) : null,
    file);
}
function fileRow(m) {
  const isImage = /^image\//.test(m.file_mime || '');
  const saved = state.saved.has(m.id);
  if (isImage && saved && !state.images[m.id]) loadSavedImage(m);
  const img = state.images[m.id];
  const available = saved || state.mode === 'online';
  return h('div', { class: 'file' },
    img ? h('img', { src: img, alt: m.file_name, class: 'zoomable', onclick: () => showLightbox(img, m.file_name) }) : null,
    h('span', { class: 'fname', text: `${m.file_name} • ${fmtSize(m.file_size || 0)}` }),
    available
      ? h('div', { class: 'fbtns' },
        h('button', { onclick: () => openFile(m, isImage), text: 'Відкрити' }),
        h('button', { class: 'ghost', onclick: () => downloadFile(m), text: 'Завантажити' }))
      : h('span', { class: 'muted', text: 'Файл не збережено на цьому пристрої.' }));
}
function autogrow(ta) { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`; }
const QUICK = ['Зрозумів', 'Прибув', 'Потрібна допомога', 'Дякую'];
function composer() {
  const c = state.compose;
  const canSend = () => !c.sending && (c.text.trim() !== '' || !!c.file);
  const send = h('button', { class: 'pri', disabled: !canSend(), onclick: sendMessage, text: c.sending ? 'Надсилання…' : 'Надіслати' });
  const ta = h('textarea', { id: 'msgbox', 'aria-label': 'Повідомлення інструктору', placeholder: 'Напишіть інструктору…', rows: 1, oninput: (e) => { c.text = e.target.value; send.disabled = !canSend(); autogrow(e.target); } });
  ta.value = c.text;
  queueMicrotask(() => autogrow(ta));
  const picker = h('input', { type: 'file', hidden: true, onchange: async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (f) await attach(f);
  } });
  return h('section', { class: 'composer card' },
    c.file ? h('div', { class: 'row chiprow' },
      h('span', { class: 'fname', text: `${c.file.name} • ${fmtSize(c.file.size)}` }),
      h('button', { class: 'ghost', 'aria-label': 'Прибрати файл', onclick: () => { c.file = null; render(); }, text: '×' })) : null,
    h('div', { class: 'chips' }, QUICK.map((q) => h('button', { class: 'chip', onclick: () => {
      c.text = c.text ? `${c.text} ${q}` : q; ta.value = c.text; send.disabled = !canSend(); autogrow(ta); ta.focus(); buzz(6);
    }, text: q }))),
    ta, picker,
    h('div', { class: 'row' }, h('button', { class: 'icon-btn', 'aria-label': 'Додати файл', title: 'Додати файл', onclick: () => picker.click(), disabled: c.sending }, svgIcon(ICONS.attach)), send));
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
    c.text = ''; c.file = null; c.sending = false; buzz(12);
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
  const doneN = tasks.filter((t) => t.done).length;
  const out = [h('section', { class: 'card' },
    h('div', { class: 'row' }, h('strong', { text: doneN === tasks.length ? 'Усе виконано' : 'Ваш прогрес' }), h('span', { class: 'muted', text: `${doneN} з ${tasks.length}` })),
    h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': tasks.length, 'aria-valuenow': doneN, style: `--w:${Math.round(doneN / tasks.length * 100)}%` }, h('i')))];
  const days = [...new Set(tasks.map((t) => t.day))];
  for (const day of days) {
    out.push(h('h2', { text: fmtDay(day) }));
    for (const t of tasks.filter((x) => x.day === day)) out.push(taskCard(t));
  }
  return out;
}
function taskCard(t) {
  const d = draftFor(t), open = state.open === t.id;
  const badge = t.done ? h('span', { class: 'pill ok', text: 'Виконано' }) : h('span', { class: 'pill warn', text: 'Не виконано' });
  const head = h('div', { class: 'row' }, h('div', { class: 'body task-text', text: t.text }), badge);
  const cls = `card task ${t.done ? 'done' : 'todo'}`;
  if (state.mode !== 'online') {
    return h('article', { class: cls }, head, t.answer ? h('div', { class: 'body muted', text: `Ваша відповідь: ${t.answer}` }) : null);
  }
  if (!open) {
    return h('article', { class: cls }, head,
      h('button', { class: t.done ? '' : 'pri', onclick: () => openTask(t), text: t.done ? 'Переглянути відповідь' : 'Виконати' }));
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
  return h('article', { class: cls }, head, ta,
    photosReady ? h('div', { class: 'photos' }, d.photos.map((src, i) => h('figure', null,
      h('img', { src, alt: `Фото ${i + 1}` }),
      h('button', { 'aria-label': 'Видалити фото', onclick: () => { d.photos.splice(i, 1); render(); }, text: '×' })))) : h('div', { class: 'skeleton', style: 'height:48px' }),
    file,
    h('button', { disabled: !photosReady || d.photos.length >= 3, onclick: () => file.click(), text: `Додати фото${photosReady ? ` (${d.photos.length}/3)` : ''}` }),
    h('div', { class: 'row' },
      h('button', { class: 'ghost', onclick: () => { state.open = null; render(); }, text: 'Згорнути' }),
      h('button', { class: 'pri', disabled: !photosReady || d.saving, onclick: (e) => save(t, d, true, e), text: d.saving ? 'Збереження…' : 'Здати' })),
    h('button', { disabled: !photosReady || d.saving, onclick: (e) => save(t, d, false, e), text: 'Зберегти чернетку' }));
}
async function openTask(t) {
  state.open = t.id; const d = draftFor(t); render();
  if (d.photos !== null) return;
  if (!t.photo_count) { d.photos = []; return render(); }
  try { d.photos = (await rpc('nb_task_photos', { p_token: state.token, p_task: t.id })) || []; } catch { d.photos = []; toast('Не вдалося завантажити фото'); }
  render();
}
async function save(t, d, done, ev) {
  const x = ev ? ev.clientX : innerWidth / 2, y = ev ? ev.clientY : innerHeight / 2;
  d.saving = true; render();
  try {
    await rpc('nb_submit', { p_token: state.token, p_task: t.id, p_answer: d.answer, p_photos: d.photos, p_done: done });
    t.answer = d.answer; t.done = done; t.photo_count = d.photos.length; d.done = done; state.raw = '';
    if (done) { state.open = null; confetti(x, y); buzz([20, 30, 20]); }
    toast(done ? 'Завдання здано. Так тримати!' : 'Чернетку збережено');
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
function insertAtCursor(ta, text) {
  const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? s;
  const needNl = s > 0 && ta.value[s - 1] !== '\n' && text.startsWith('\n');
  const ins = needNl ? text : text.replace(/^\n/, '');
  ta.value = ta.value.slice(0, s) + ins + ta.value.slice(e);
  const pos = s + ins.length;
  ta.focus(); ta.setSelectionRange(pos, pos);
  ta.dispatchEvent(new Event('input'));
}
function viewNotes() {
  const online = state.mode === 'online';
  const local = store.get(LS_NOTE), dirty = store.get(LS_DIRTY) === '1';
  const server = state.data.note || '';
  const ta = h('textarea', { id: 'notebox', 'aria-label': 'Мої нотатки', placeholder: 'Ваші особисті нотатки. Їх бачите лише ви.', style: 'min-height:46vh' });
  ta.value = online ? (dirty && local != null ? local : server) : (local != null ? local : server);
  const status = h('span', { class: 'muted', text: online ? (dirty ? 'Не збережено' : 'Збережено') : 'Зберігається на цьому телефоні' });
  const counter = h('span', { class: 'muted counter', text: `${ta.value.length} символів` });
  ta.addEventListener('input', () => {
    store.set(LS_NOTE, ta.value);
    counter.textContent = `${ta.value.length} символів`;
    if (!online) { status.textContent = 'Зберігається на цьому телефоні'; return; }
    store.set(LS_DIRTY, '1'); status.textContent = 'Збереження…';
    clearTimeout(noteTimer);
    noteTimer = setTimeout(async () => {
      status.textContent = (await syncNote()) ? 'Збережено' : 'Не збережено (немає звʼязку), чернетка на цьому пристрої';
    }, 900);
  });
  const stamp = () => `\n${new Date().toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} — `;
  return h('section', { class: 'card' },
    h('div', { class: 'tools' },
      h('button', { class: 'chip', onclick: () => insertAtCursor(ta, '\n☐ '), text: '☐ Пункт' }),
      h('button', { class: 'chip', onclick: () => insertAtCursor(ta, stamp()), text: 'Дата й час' }),
      h('button', { class: 'chip', onclick: async () => { try { await navigator.clipboard.writeText(ta.value); toast('Скопійовано'); } catch { toast('Не вдалося скопіювати'); } }, text: 'Копіювати' })),
    ta,
    h('div', { class: 'row' }, status, counter));
}

/* ---------- старт ---------- */
applyPrefs();
state.token = readToken();
{
  const q = new URLSearchParams(location.search).get('tab');
  if (TAB_IDS.includes(q)) state.tab = q;
}
render();
load();
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.data && state.tab !== 'notes') load(true); });
setInterval(() => {
  if (document.hidden || !state.token || state.tab === 'notes' || state.compose.sending) return;
  if (standalone && state.mode !== 'gone') load(true);
}, 15000);
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.silence) silenceFromNotification();
    else if (e.data && TAB_IDS.includes(e.data.tab)) { state.tab = e.data.tab; state.anim = true; render(); }
  });
}
initSilence();
filesLoadSaved();
