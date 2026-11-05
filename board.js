/* Дошка заняття: інструктор малює поверх скріншота в застосунку «Оцінка», курсант бачить позначки наживо.
   Наживо: Supabase Realtime (Broadcast) на каналі board:<кімната>. Запасний шлях: знімок штрихів у базі,
   який зошит перечитує кожні кілька секунд, тож дошка працює й тоді, коли живий канал недоступний.
   Малювання дзеркалить BoardRender.kt у застосунку (нормовані координати 0..1). Користується глобальними
   state, rpc, h, toast, standalone, SB_URL, SB_KEY, render з app.js. */
const SB_REALTIME_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
const board = {
  active: false, id: null, room: null, rev: -1, img: null, strokes: new Map(), undone: new Set(),
  live: false, channel: null, client: null, view: null, autoFor: null, polling: false, endTimer: null,
};

function loadSupabaseJs() {
  if (window.supabase) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = SB_REALTIME_JS; s.onload = res; s.onerror = rej;
    document.head.append(s);
  });
}

/* ---------- опитування й приєднання ---------- */
async function pollBoard() {
  if (!state.token || state.mode !== 'online' || board.polling || !standalone) return;
  board.polling = true;
  try {
    const b = await rpc('nb_board', { p_token: state.token });
    if (!b) { if (board.active) boardEnded(); return; }
    if (board.id !== b.id) await boardJoin(b); else boardSync(b);
  } catch { /* немає зв'язку: спробуємо за кілька секунд */ }
  finally { board.polling = false; }
}

function loadSnapshot(list) {
  board.strokes = new Map();
  for (const s of list || []) if (s && s.id && !board.undone.has(s.id)) board.strokes.set(s.id, s);
}

async function boardJoin(b) {
  boardLeave();
  board.id = b.id; board.room = b.room; board.rev = b.rev; board.undone = new Set();
  loadSnapshot(b.strokes);
  const im = await rpc('nb_board_image', { p_token: state.token, p_id: b.id });
  if (!im) return;
  board.img = `data:${im.mime || 'image/jpeg'};base64,${im.data}`;
  board.active = true;
  boardConnect(b.room);
  render();
  if (board.autoFor !== b.id) { board.autoFor = b.id; openBoard(); buzz(30); }
}

/* Без живого каналу беремо штрихи зі знімка в базі (він оновлюється приблизно раз на 1,5 с). */
function boardSync(b) {
  if (board.live || b.rev === board.rev) return;
  board.rev = b.rev;
  loadSnapshot(b.strokes);
  boardDraw();
}

function boardLeave() {
  clearTimeout(board.endTimer);
  if (board.channel && board.client) { try { board.client.removeChannel(board.channel); } catch { /* ignore */ } }
  board.channel = null; board.live = false;
}

function boardEnded() {
  const wasOpen = !!board.view;
  board.active = false; board.id = null;
  boardLeave();
  if (wasOpen) {
    boardStatus('Заняття завершено');
    board.endTimer = setTimeout(closeBoard, 2500);
  }
  toast('Заняття завершено');
  render();
}

/* ---------- живий канал ---------- */
/* Приватний канал: слухати може будь-який зошит із кімнатою, надсилати лише інструктор (правила RLS у supabase/board.sql).
   Приватні канали потребують JWT, тому тут використовується класичний публічний anon-ключ (він призначений для клієнтів). */
const SB_RT_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjZGdlbWpxdnN1Y3Z0ZXlydmtzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM2ODkyMTksImV4cCI6MjEwOTI2NTIxOX0.8AgzhPM3jg6mrFaOtlP8VvxLxVo5yOlkyjLWn8_8kGs';
async function boardConnect(room) {
  try { await loadSupabaseJs(); } catch { return; }
  if (!board.client) {
    board.client = window.supabase.createClient(SB_URL, SB_RT_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  }
  const ch = board.client.channel('board:' + room, { config: { private: true, broadcast: { self: false } } });
  ch.on('broadcast', { event: 'b' }, (m) => boardApply(m && m.payload));
  ch.subscribe((status) => {
    if (board.channel !== ch) return;
    board.live = status === 'SUBSCRIBED';
    boardStatus();
  });
  board.channel = ch;
}

function boardApply(m) {
  if (!m) return;
  if (m.t === 's' && m.s && m.s.id) {
    if (board.undone.has(m.s.id)) return;
    const old = board.strokes.get(m.s.id);
    if (!old || (m.s.p || []).length >= (old.p || []).length) board.strokes.set(m.s.id, m.s);
  } else if (m.t === 'u') { board.undone.add(m.id); board.strokes.delete(m.id); }
  else if (m.t === 'x') { board.strokes.clear(); }
  else if (m.t === 'e') { boardEnded(); return; }
  boardDraw();
}

/* ---------- малювання (дзеркало BoardRender.kt) ---------- */
function boardDrawStroke(g, s, W, H) {
  const p = s.p || [], lw = Math.max(1, (s.w || 0.005) * W), col = s.c || '#ff3b30';
  g.strokeStyle = col; g.fillStyle = col; g.lineWidth = lw;
  if (s.k === 'pen') {
    if (p.length >= 4) {
      g.beginPath(); g.moveTo(p[0] * W, p[1] * H);
      for (let i = 2; i + 1 < p.length; i += 2) g.lineTo(p[i] * W, p[i + 1] * H);
      g.stroke();
    } else if (p.length >= 2) { g.beginPath(); g.arc(p[0] * W, p[1] * H, lw / 2, 0, Math.PI * 2); g.fill(); }
  } else if (s.k === 'arrow' && p.length >= 4) {
    const x1 = p[0] * W, y1 = p[1] * H, x2 = p[2] * W, y2 = p[3] * H;
    if (Math.abs(x2 - x1) < 1 && Math.abs(y2 - y1) < 1) return;
    const a = Math.atan2(y2 - y1, x2 - x1), hd = Math.max(lw * 5, 14);
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2);
    [0.5, -0.5].forEach((d) => { g.moveTo(x2, y2); g.lineTo(x2 - hd * Math.cos(a + d), y2 - hd * Math.sin(a + d)); });
    g.stroke();
  } else if (s.k === 'circle' && p.length >= 4) {
    const l = Math.min(p[0], p[2]) * W, t = Math.min(p[1], p[3]) * H, rw = Math.abs(p[2] - p[0]) * W, rh = Math.abs(p[3] - p[1]) * H;
    if (rw > 1 || rh > 1) { g.beginPath(); g.ellipse(l + rw / 2, t + rh / 2, rw / 2, rh / 2, 0, 0, Math.PI * 2); g.stroke(); }
  } else if (s.k === 'text' && p.length >= 2 && s.t) {
    const size = Math.max(10, (s.s || 0.045) * W);
    const n = parseInt(col.replace('#', ''), 16) || 0;
    const light = (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 150;
    g.font = `bold ${size}px Roboto, "Segoe UI", sans-serif`; g.textBaseline = 'alphabetic';
    String(s.t).split('\n').forEach((line, i) => {
      const y = p[1] * H + size + i * size * 1.15;
      g.lineWidth = size * 0.16; g.strokeStyle = light ? '#000' : '#fff'; g.strokeText(line, p[0] * W, y);
      g.fillStyle = col; g.fillText(line, p[0] * W, y);
    });
  }
}

function boardDraw() {
  const v = board.view;
  if (!v) return;
  const r = v.img.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const W = Math.max(1, Math.round(r.width)), H = Math.max(1, Math.round(r.height));
  if (v.canvas.width !== Math.round(W * dpr) || v.canvas.height !== Math.round(H * dpr)) { v.canvas.width = Math.round(W * dpr); v.canvas.height = Math.round(H * dpr); }
  const g = v.canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const s of board.strokes.values()) boardDrawStroke(g, s, W, H);
}

/* ---------- екран дошки ---------- */
function boardStatus(text) {
  if (!board.view) return;
  board.view.status.textContent = text || (board.live ? 'наживо' : 'оновлюється кожні кілька секунд');
}

/* Поки відкрита дошка, екран не гасне (система знімає блокування, коли сторінка згортається, тож беремо його знову). */
let boardWake = null;
async function boardKeepAwake() {
  try {
    if (!('wakeLock' in navigator) || boardWake || !board.view || document.hidden) return;
    boardWake = await navigator.wakeLock.request('screen');
    boardWake.addEventListener('release', () => { boardWake = null; });
  } catch { /* не підтримується або відмовлено */ }
}
function boardRelease() {
  try { if (boardWake) boardWake.release(); } catch { /* ignore */ }
  boardWake = null;
}

function openBoard() {
  if (board.view || !board.active || !board.img) return;
  const img = h('img', { alt: 'Дошка заняття', draggable: 'false' });
  const canvas = h('canvas', { class: 'board-cv', 'aria-hidden': 'true' });
  const status = h('span', { class: 'board-status' });
  const wrap = h('div', { class: 'board-wrap' }, img, canvas);
  const root = h('div', { class: 'board', role: 'dialog', 'aria-label': 'Дошка заняття' },
    h('div', { class: 'board-top' },
      h('strong', { text: 'Заняття' }), h('span', { class: 'board-live', text: '● наживо' }), status,
      h('button', { class: 'board-x', 'aria-label': 'Закрити дошку', onclick: closeBoard, text: '×' })),
    h('div', { class: 'board-stage' }, wrap));
  document.body.append(root);
  board.view = { root, img, canvas, status, ro: null };
  img.onload = boardDraw;
  img.src = board.img;
  if (window.ResizeObserver) { board.view.ro = new ResizeObserver(boardDraw); board.view.ro.observe(wrap); }
  window.addEventListener('resize', boardDraw);
  boardStatus();
  boardKeepAwake();
  render();
}

function closeBoard() {
  const v = board.view;
  if (!v) return;
  clearTimeout(board.endTimer);
  if (v.ro) v.ro.disconnect();
  window.removeEventListener('resize', boardDraw);
  v.root.remove(); board.view = null;
  boardRelease();
  render();
}

/* Банер в зошиті: заняття триває, але дошку закрито (можна відкрити знову). */
function boardBar() {
  if (!board.active || board.view) return null;
  return h('div', { class: 'banner board-bar' },
    h('strong', { text: 'Йде заняття' }), h('span', { text: 'Інструктор показує дошку з позначками.' }),
    h('button', { class: 'pri', onclick: openBoard, text: 'Відкрити дошку' }));
}

function initBoard() {
  setInterval(() => { if (!document.hidden) pollBoard(); }, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { pollBoard(); boardKeepAwake(); } });
  pollBoard();
}
