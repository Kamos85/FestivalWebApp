'use strict';

const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const FONT_WEIGHT = 900;
const LINE_SPACING = 1.1;          // fit mode: baseline-to-baseline distance, in font sizes
const FIT_MARGIN = 0.03;           // fit mode: margin around the text, as a fraction of the screen
const SCROLL_SPEED = 1.0;          // scroll mode: screen heights per second (at 100% letter width)
const SCROLL_GAP = 1 / 3;          // scroll mode: gap between repeats, as a fraction of the screen width
const MAX_BLINK_HZ = 3;            // full on/off cycles per second; keep at or below 3 for photosensitivity
const DOUBLE_TAP_MS = 350;
const STORAGE_KEY = 'festival-sign-settings';

const $ = (id) => document.getElementById(id);
const setupEl = $('setup');
const displayEl = $('display');
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
const hintEl = $('hint');
const inputs = { text: $('text'), fit: $('fit'), fg: $('fg'), bg: $('bg'), blink: $('blink'), width: $('width') };
const blinkValueEl = $('blink-value');
const widthValueEl = $('width-value');
const showBtn = $('show');
const previewEl = $('preview');
const previewTextEl = $('preview-text');

// ---------- Settings ----------

function readSettings() {
  return {
    text: inputs.text.value.trim(),
    fit: inputs.fit.checked,
    fg: inputs.fg.value,
    bg: inputs.bg.value,
    blink: Math.min(Number(inputs.blink.value) || 0, MAX_BLINK_HZ),
    width: Number(inputs.width.value) || 100,
  };
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return;
    if (typeof saved.text === 'string') inputs.text.value = saved.text;
    if (typeof saved.fit === 'boolean') inputs.fit.checked = saved.fit;
    if (typeof saved.fg === 'string') inputs.fg.value = saved.fg;
    if (typeof saved.bg === 'string') inputs.bg.value = saved.bg;
    if (typeof saved.blink === 'number') inputs.blink.value = saved.blink;
    if (typeof saved.width === 'number') inputs.width.value = saved.width;
  } catch { /* storage unavailable or corrupt: keep defaults */ }
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(readSettings()));
  } catch { /* storage unavailable: settings just won't persist */ }
}

function updateSetupUi() {
  const s = readSettings();
  previewTextEl.textContent = s.text || 'Preview';
  previewTextEl.style.transform = `scaleX(${s.width / 100})`;
  previewEl.style.color = s.fg;
  previewEl.style.background = s.bg;
  widthValueEl.textContent = `${s.width}%`;
  blinkValueEl.textContent = s.blink ? `${s.blink} Hz` : 'Off';
  showBtn.disabled = !s.text;
}

// ---------- Layout ----------

const font = (size) => `${FONT_WEIGHT} ${size}px ${FONT_FAMILY}`;

// Horizontal squeeze of the letters (1 = normal width). Set from the settings when the display opens.
let stretch = 1;

// Ink extents of a string at a given size (what is actually painted, not the em box),
// with horizontal values already squeezed by `stretch`.
function measureInk(text, size) {
  ctx.font = font(size);
  const m = ctx.measureText(text);
  return {
    left: m.actualBoundingBoxLeft * stretch,
    width: (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) * stretch,
    ascent: m.actualBoundingBoxAscent,
    descent: m.actualBoundingBoxDescent,
  };
}

// Greedy word wrap. Returns null if a single word is wider than maxWidth.
function wrap(words, size, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measureInk(candidate, size).width <= maxWidth) {
      line = candidate;
    } else {
      if (measureInk(word, size).width > maxWidth) return null;
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
}

// Fit mode: largest size where the wrapped text fits the screen.
function layoutFit(text, W, H) {
  const words = text.split(/\s+/);
  const maxW = W * (1 - 2 * FIT_MARGIN);
  const maxH = H * (1 - 2 * FIT_MARGIN);

  const tryFit = (size) => {
    const lines = wrap(words, size, maxW);
    if (!lines) return null;
    const ink = measureInk(text, size);
    const height = (lines.length - 1) * size * LINE_SPACING + ink.ascent + ink.descent;
    return height <= maxH ? { size, lines, ascent: ink.ascent, height } : null;
  };

  let lo = 1, hi = H * 2, best = tryFit(lo);
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const result = tryFit(mid);
    if (result) { best = result; lo = mid; } else { hi = mid; }
  }
  return { mode: 'fit', ...best };
}

// Scroll mode: ink of the text spans exactly the full screen height.
function layoutScroll(text, W, H) {
  const ref = measureInk(text, 100);
  const inkHeight = ref.ascent + ref.descent || 100;
  const size = (100 * H) / inkHeight;
  const ink = measureInk(text, size);
  return {
    mode: 'scroll',
    size,
    baseline: ink.ascent,
    left: ink.left,
    width: ink.width,
    scrolls: ink.width > W,
  };
}

// ---------- Display ----------

let settings = null;
let layout = null;
let screenW = 0, screenH = 0;
let scrollX = 0;
let lastFrame = 0;
let startTime = 0;
let inverted = false;
let rafId = 0;

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  screenW = displayEl.clientWidth;
  screenH = displayEl.clientHeight;
  canvas.width = Math.round(screenW * dpr);
  canvas.height = Math.round(screenH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  layout = settings.fit
    ? layoutFit(settings.text, screenW, screenH)
    : layoutScroll(settings.text, screenW, screenH);
  scrollX = 0;
  draw();
}

// Draw text squeezed horizontally; x is the on-screen position of the text origin.
function drawText(text, x, y) {
  ctx.save();
  ctx.scale(stretch, 1);
  ctx.fillText(text, x / stretch, y);
  ctx.restore();
}

function draw() {
  ctx.fillStyle = inverted ? settings.fg : settings.bg;
  ctx.fillRect(0, 0, screenW, screenH);
  ctx.fillStyle = inverted ? settings.bg : settings.fg;
  ctx.font = font(layout.size);
  ctx.textBaseline = 'alphabetic';

  if (layout.mode === 'fit') {
    let y = (screenH - layout.height) / 2 + layout.ascent;
    for (const line of layout.lines) {
      const ink = measureInk(line, layout.size);
      drawText(line, (screenW - ink.width) / 2 + ink.left, y);
      y += layout.size * LINE_SPACING;
    }
  } else if (!layout.scrolls) {
    drawText(settings.text, (screenW - layout.width) / 2 + layout.left, layout.baseline);
  } else {
    // Draw enough copies to cover the screen while scrolling.
    const period = layout.width + screenW * SCROLL_GAP;
    for (let x = scrollX; x < screenW; x += period) {
      drawText(settings.text, x + layout.left, layout.baseline);
    }
  }
}

function frame(now) {
  const dt = lastFrame ? (now - lastFrame) / 1000 : 0;
  lastFrame = now;
  if (!startTime) startTime = now;
  let changed = false;

  if (layout.mode === 'scroll' && layout.scrolls) {
    const period = layout.width + screenW * SCROLL_GAP;
    // Scale speed with letter width so the same number of letters pass per second.
    scrollX -= SCROLL_SPEED * screenH * stretch * dt;
    if (scrollX <= -period) scrollX += period;
    changed = true;
  }

  // Colors swap twice per cycle: one cycle is "normal" then "inverted".
  const nowInverted = settings.blink > 0 &&
    Math.floor(((now - startTime) / 1000) * settings.blink * 2) % 2 === 1;
  if (nowInverted !== inverted) { inverted = nowInverted; changed = true; }

  if (changed) draw();
  rafId = requestAnimationFrame(frame);
}

// ---------- Screen wake lock, fullscreen, orientation ----------

let wakeLock = null;

async function requestWakeLock() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch { /* not supported or denied: screen may dim */ }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !displayEl.hidden) requestWakeLock();
});

async function enterFullscreen() {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
  } catch { /* not allowed: installed app already runs fullscreen */ }
  try {
    await screen.orientation?.lock('landscape');
  } catch { /* not supported (e.g. desktop) */ }
}

function exitFullscreen() {
  try { screen.orientation?.unlock(); } catch { /* ignore */ }
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

// ---------- Screen switching ----------

let hintTimer = 0;

function showDisplay() {
  settings = readSettings();
  if (!settings.text) return;
  saveSettings();

  setupEl.hidden = true;
  displayEl.hidden = false;
  history.pushState({ display: true }, '');

  enterFullscreen();
  requestWakeLock();
  inverted = false;
  stretch = settings.width / 100;
  resizeCanvas();

  lastFrame = 0;
  startTime = 0;
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(frame);

  hintEl.classList.remove('hidden');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hintEl.classList.add('hidden'), 2500);
}

function hideDisplay() {
  if (displayEl.hidden) return;
  cancelAnimationFrame(rafId);
  displayEl.hidden = true;
  setupEl.hidden = false;
  exitFullscreen();
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

// Leaving the display always goes through history, so the Android back button works too.
function leaveDisplay() {
  if (history.state?.display) history.back();
  else hideDisplay();
}

window.addEventListener('popstate', hideDisplay);

let lastTap = 0;
canvas.addEventListener('pointerup', (e) => {
  if (e.timeStamp - lastTap < DOUBLE_TAP_MS) {
    lastTap = 0;
    leaveDisplay();
  } else {
    lastTap = e.timeStamp;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !displayEl.hidden) leaveDisplay();
});

window.addEventListener('resize', () => {
  if (!displayEl.hidden) resizeCanvas();
});

// ---------- Init ----------

loadSettings();
updateSetupUi();
for (const el of Object.values(inputs)) {
  el.addEventListener('input', () => { updateSetupUi(); saveSettings(); });
}
inputs.text.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') showDisplay();
});
showBtn.addEventListener('click', showDisplay);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
