'use strict';

const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const FONT_WEIGHT = 900;
const LINE_SPACING = 1.1;          // fit mode: baseline-to-baseline distance, in font sizes
const FIT_MARGIN = 0.03;           // fit mode: margin around the text, as a fraction of the screen
const SCROLL_SPEED = 1.0;          // scroll mode: screen heights per second (at 100% letter width)
const SCROLL_GAP = 1 / 3;          // scroll mode: gap between repeats, as a fraction of the screen width
const MIN_BPM = 60;                // blink tempo range; colors swap on every beat
const MAX_BPM = 180;               // 180 BPM = 3 swaps per second, within photosensitivity limits
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
const previewCanvas = $('preview');
const previewCtx = previewCanvas.getContext('2d');

// ---------- Settings ----------

// Slider value to blink tempo: below MIN_BPM means off (0).
function blinkBpm(value) {
  return value >= MIN_BPM ? Math.min(value, MAX_BPM) : 0;
}

function readSettings() {
  return {
    text: inputs.text.value.trim(),
    fit: inputs.fit.checked,
    fg: inputs.fg.value,
    bg: inputs.bg.value,
    bpm: blinkBpm(Number(inputs.blink.value)),
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
    if (typeof saved.bpm === 'number') inputs.blink.value = saved.bpm || MIN_BPM - 1;
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
  drawPreview(s);
  widthValueEl.textContent = `${s.width}%`;
  blinkValueEl.textContent = s.bpm ? `${s.bpm} BPM` : 'Off';
  showBtn.disabled = !s.text;
}

// ---------- Layout ----------

const font = (size) => `${FONT_WEIGHT} ${size}px ${FONT_FAMILY}`;

// Horizontal squeeze of the letters (1 = normal width). Emoji are never squeezed.
let stretch = 1;

const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const segmenter = 'Segmenter' in Intl ? new Intl.Segmenter() : null;

// Split text into runs of emoji and non-emoji, each with its horizontal scale.
// Works per grapheme so multi-part emoji (skin tones, flags, families) stay whole.
function runs(text) {
  const graphemes = segmenter ? Array.from(segmenter.segment(text), (g) => g.segment) : Array.from(text);
  const result = [];
  for (const g of graphemes) {
    const scale = EMOJI.test(g) ? 1 : stretch;
    const last = result[result.length - 1];
    if (last && last.scale === scale) last.text += g;
    else result.push({ text: g, scale });
  }
  return result;
}

// Ink extents of a string at a given size (what is actually painted, not the em box),
// with horizontal values already squeezed.
function measureInk(text, size) {
  ctx.font = font(size);
  let x = 0, left = 0, right = 0, ascent = 0, descent = 0;
  runs(text).forEach((run, i) => {
    const m = ctx.measureText(run.text);
    if (i === 0) left = m.actualBoundingBoxLeft * run.scale;
    right = Math.max(right, x + m.actualBoundingBoxRight * run.scale);
    ascent = Math.max(ascent, m.actualBoundingBoxAscent);
    descent = Math.max(descent, m.actualBoundingBoxDescent);
    x += m.width * run.scale;
  });
  return { left, width: left + right, ascent, descent };
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

// Draw text with letters squeezed and emoji at normal width; x is the position of the text origin.
// The font must already be set on c.
function drawText(c, text, x, y) {
  for (const run of runs(text)) {
    c.save();
    c.scale(run.scale, 1);
    c.fillText(run.text, x / run.scale, y);
    c.restore();
    x += c.measureText(run.text).width * run.scale;
  }
}

// Draw a fit-mode layout centered in a W x H area.
function drawFitLines(c, fit, W, H) {
  let y = (H - fit.height) / 2 + fit.ascent;
  for (const line of fit.lines) {
    const ink = measureInk(line, fit.size);
    c.font = font(fit.size);
    drawText(c, line, (W - ink.width) / 2 + ink.left, y);
    y += fit.size * LINE_SPACING;
  }
}

function draw() {
  ctx.fillStyle = inverted ? settings.fg : settings.bg;
  ctx.fillRect(0, 0, screenW, screenH);
  ctx.fillStyle = inverted ? settings.bg : settings.fg;
  ctx.font = font(layout.size);
  ctx.textBaseline = 'alphabetic';

  if (layout.mode === 'fit') {
    drawFitLines(ctx, layout, screenW, screenH);
  } else if (!layout.scrolls) {
    drawText(ctx, settings.text, (screenW - layout.width) / 2 + layout.left, layout.baseline);
  } else {
    // Draw enough copies to cover the screen while scrolling.
    const period = layout.width + screenW * SCROLL_GAP;
    for (let x = scrollX; x < screenW; x += period) {
      drawText(ctx, settings.text, x + layout.left, layout.baseline);
    }
  }
}

// Setup screen preview: the text fitted into the preview box, drawn like the real sign.
function drawPreview(s) {
  const dpr = window.devicePixelRatio || 1;
  const W = previewCanvas.clientWidth, H = previewCanvas.clientHeight;
  if (!W || !H) return;
  previewCanvas.width = Math.round(W * dpr);
  previewCanvas.height = Math.round(H * dpr);
  previewCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  previewCtx.fillStyle = s.bg;
  previewCtx.fillRect(0, 0, W, H);
  previewCtx.fillStyle = s.fg;
  previewCtx.textBaseline = 'alphabetic';

  stretch = s.width / 100;
  const pad = 8;
  const fit = layoutFit(s.text || 'Preview', W - 2 * pad, H - 2 * pad);
  previewCtx.translate(pad, pad);
  drawFitLines(previewCtx, fit, W - 2 * pad, H - 2 * pad);
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

  // Colors swap on every beat.
  const nowInverted = settings.bpm > 0 &&
    Math.floor(((now - startTime) / 60000) * settings.bpm) % 2 === 1;
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
  updateSetupUi();  // the screen may have rotated while the sign was shown
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
  else updateSetupUi();
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
