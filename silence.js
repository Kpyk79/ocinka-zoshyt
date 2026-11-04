/* Хвилина мовчання: щодня о 9:00 за Києвом на весь екран з таймером, дзвоном і тихим метрономом.
   Користується глобальними store, h, standalone, toast, buzz, closeSheet з app.js (викликається вже після їх створення). */
const LS_SILENCE_OFF = 'ocinka.silenceOff';
const LS_SILENCE_DAY = 'ocinka.silenceDay';
const LS_SILENCE_MUTE = 'ocinka.silenceMute';
const SILENCE_SECONDS = 60;
const silence = { el: null, timer: null, ctx: null, end: 0, left: 0, wake: null, real: true };

function kyivNow() {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date())) p[x.type] = x.value;
  return { day: `${p.year}-${p.month}-${p.day}`, h: Number(p.hour) % 24, m: Number(p.minute), s: Number(p.second) };
}

/* ---------- звук (синтезований, без файлів) ---------- */
function silenceCtx() {
  if (!silence.ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    silence.ctx = new C();
  }
  if (silence.ctx.state === 'suspended') silence.ctx.resume().catch(() => {});
  return silence.ctx;
}
function soundOn() { return store.get(LS_SILENCE_MUTE) !== '1'; }
function bell() {
  const ctx = silence.ctx; if (!ctx || !soundOn()) return;
  const t0 = ctx.currentTime + 0.02;
  [[165, 0.5, 6], [330, 0.28, 5], [495, 0.16, 3.5], [742, 0.07, 2.2]].forEach(([f, a, len]) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(a, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    o.connect(g).connect(ctx.destination); o.start(t0); o.stop(t0 + len + 0.1);
  });
}
function tickSound() {
  const ctx = silence.ctx; if (!ctx || !soundOn() || ctx.state !== 'running') return;
  const t0 = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'triangle'; o.frequency.setValueAtTime(520, t0); o.frequency.exponentialRampToValueAtTime(300, t0 + 0.07);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
  o.connect(g).connect(ctx.destination); o.start(t0); o.stop(t0 + 0.15);
}

/* ---------- екран ---------- */
const RING = 2 * Math.PI * 92;
function silenceView() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 200 200'); svg.setAttribute('class', 'hush-ring'); svg.setAttribute('aria-hidden', 'true');
  for (const cls of ['track', 'bar']) {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', '100'); c.setAttribute('cy', '100'); c.setAttribute('r', '92'); c.setAttribute('class', cls);
    if (cls === 'bar') { c.setAttribute('stroke-dasharray', String(RING)); c.setAttribute('stroke-dashoffset', '0'); }
    svg.appendChild(c);
  }
  const num = h('div', { class: 'hush-num', 'aria-live': 'off', text: String(SILENCE_SECONDS) });
  const hint = h('div', { class: 'hush-hint', hidden: true, text: 'Торкніться екрана, щоб увімкнути звук' });
  const mute = h('button', { class: 'hush-btn', 'aria-label': 'Звук', onclick: toggleSilenceSound });
  const el = h('div', { class: 'hush', role: 'alertdialog', 'aria-label': 'Хвилина мовчання' },
    h('div', { class: 'hush-body' },
      h('div', { class: 'hush-flame', 'aria-hidden': 'true' }),
      h('h1', { text: 'Хвилина мовчання' }),
      h('p', { class: 'hush-sub', text: 'Вшануймо пам’ять полеглих за Україну' }),
      h('div', { class: 'hush-clock' }, svg, num),
      hint),
    h('div', { class: 'hush-foot' }, mute, h('button', { class: 'hush-btn', onclick: () => endSilence(false), text: 'Закрити' })));
  el._num = num; el._bar = svg.querySelector('.bar'); el._hint = hint; el._mute = mute;
  paintMute(el);
  return el;
}
function paintMute(el) { el._mute.textContent = soundOn() ? 'Звук увімкнено' : 'Звук вимкнено'; }
function toggleSilenceSound() {
  if (soundOn()) store.set(LS_SILENCE_MUTE, '1'); else { store.del(LS_SILENCE_MUTE); silenceCtx(); }
  if (silence.el) paintMute(silence.el);
}

async function keepAwake() {
  try { if ('wakeLock' in navigator) silence.wake = await navigator.wakeLock.request('screen'); } catch { /* ignore */ }
}

/* real=false — перегляд з налаштувань: не рахується за сьогоднішню хвилину. */
function startSilence(seconds, real = true) {
  if (silence.el) return;
  silence.real = real;
  silence.el = silenceView();
  document.body.appendChild(silence.el);
  document.documentElement.classList.add('hush-open');
  silenceCtx();
  silence.end = Date.now() + seconds * 1000; silence.left = -1;
  keepAwake(); buzz(40);
  bell();
  setTimeout(() => { if (silence.el && silence.ctx && silence.ctx.state !== 'running' && soundOn()) silence.el._hint.hidden = false; }, 400);
  silence.el.addEventListener('pointerdown', () => {
    const c = silenceCtx();
    if (c && silence.el) { silence.el._hint.hidden = true; c.resume().catch(() => {}); }
  });
  silence.timer = setInterval(paintSilence, 200);
  paintSilence();
}
function paintSilence() {
  const el = silence.el; if (!el) return;
  const left = Math.max(0, Math.ceil((silence.end - Date.now()) / 1000));
  if (left !== silence.left) {
    silence.left = left;
    el._num.textContent = String(left);
    if (left > 0 && left < SILENCE_SECONDS) tickSound();
  }
  el._bar.setAttribute('stroke-dashoffset', String(RING * (1 - Math.max(0, (silence.end - Date.now()) / 1000) / SILENCE_SECONDS)));
  if (left === 0) endSilence(true);
}
function endSilence(natural) {
  const el = silence.el; if (!el) return;
  clearInterval(silence.timer); silence.timer = null;
  if (silence.real) store.set(LS_SILENCE_DAY, kyivNow().day);
  const close = () => {
    el.remove(); silence.el = null;
    document.documentElement.classList.remove('hush-open');
    try { if (silence.wake) silence.wake.release(); } catch { /* ignore */ }
    silence.wake = null;
  };
  if (!natural) { close(); return; }
  bell(); buzz([60, 80, 60]);
  el.classList.add('done');
  el.querySelector('h1').textContent = 'Вічна памʼять героям';
  el.querySelector('.hush-sub').textContent = 'Слава Україні!';
  setTimeout(close, 7000);
}

/* ---------- запуск о 9:00 ---------- */
function checkSilence() {
  if (!standalone || silence.el || store.get(LS_SILENCE_OFF) === '1') return;
  const n = kyivNow();
  if (n.h === 9 && n.m === 0 && store.get(LS_SILENCE_DAY) !== n.day) startSilence(SILENCE_SECONDS - n.s);
}
/* Відкрито з сповіщення (або воно прийшло в уже відкритий застосунок): починаємо повну хвилину,
   якщо з 9:00 минуло не більше 10 хвилин. */
function silenceFromNotification() {
  if (silence.el || store.get(LS_SILENCE_OFF) === '1') return;
  const n = kyivNow();
  if (n.h === 9 && n.m < 10 && store.get(LS_SILENCE_DAY) !== n.day) startSilence(SILENCE_SECONDS);
}
function initSilence() {
  const q = new URLSearchParams(location.search);
  if (q.get('silence') === 'test') startSilence(SILENCE_SECONDS, false);
  else if (q.get('silence') === '1') silenceFromNotification();
  setInterval(checkSilence, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkSilence(); });
}

/* ---------- перемикач у налаштуваннях ---------- */
async function setSilencePush(on) {
  try {
    if (!pushSupported || !state.token) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await rpc('nb_set_silence', { p_token: state.token, p_endpoint: sub.endpoint, p_on: on });
  } catch { /* спробуємо наступного разу */ }
}
function toggleSilenceSetting() {
  const off = store.get(LS_SILENCE_OFF) === '1';
  if (off) store.del(LS_SILENCE_OFF); else store.set(LS_SILENCE_OFF, '1');
  setSilencePush(off);
  render();
}
function silenceRow() {
  const on = store.get(LS_SILENCE_OFF) !== '1';
  return h('div', { class: 'row' },
    h('div', null,
      h('strong', { text: 'Хвилина мовчання' }),
      h('div', { class: 'muted', text: 'Щодня о 9:00: на весь екран, з таймером і звуком.' }),
      h('button', { class: 'chip', style: 'margin-top:8px', onclick: () => { closeSheet(); startSilence(SILENCE_SECONDS, false); }, text: 'Показати зараз' })),
    h('button', { class: 'switch', role: 'switch', 'aria-label': 'Хвилина мовчання', 'aria-checked': on ? 'true' : 'false', onclick: toggleSilenceSetting }));
}
