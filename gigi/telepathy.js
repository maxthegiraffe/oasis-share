// Copy of the oasis repo's src/lib/gigiLive/telepathy.js (keep the copies the same: oasis, grateful.gg/gigi, neckandneck).
// Gigi speaks telepathically (Max, 2026-11-05 on /ai/bootcamp7; everywhere since 2026-11-09: "she is still talking with
// lips instead of telepathically ... redo gigi everywhere"). Her lips aren't modelled yet, so her mouth never moves: her
// listening loop plays on, the light between her eyebrows glows with her voice, and its colour follows the essence of each
// sentence, one of the seven stones up her neck. One module for every page that shows her: grateful.gg/gigi and
// app.grateful.gg/gigi (GigiTalk) since 2026-11-18; the Bootcamp bubble, /ai/setup and /withgigi wait on feat/gigi-telepathy.
//
// The light is one element over her video. A page tells this module what she is doing:
//   voice(fn)   her voice is live; fn() returns its loudness, 0 to 1 (null: she is gone, the light goes out)
//   say(text)   she said this: the colour moves through its sentences at about the pace she speaks them
//   hush()      stop the colour beats (an interruption, the end of a call)
// and attachEye(el, video?) keeps the element glowing (and, given her video, on her brow at any size or crop).

// A point of the video frame -> the video box, for its object-fit and object-position (popmouth.js's displayMap, without
// pulling the mouth code into every page): [x, y, scale].
function onBox(W, H, vw, vh, fit, pos, fx, fy) {
  let sx = W / vw;
  let sy = H / vh;
  if (fit === 'contain' || fit === 'cover') { sx = sy = fit === 'contain' ? Math.min(sx, sy) : Math.max(sx, sy); }
  const t = String(pos || '50% 50%').trim().split(/\s+/);
  const one = (str, free) => {
    if (str === 'left' || str === 'top') return 0;
    if (str === 'right' || str === 'bottom') return free;
    const v = parseFloat(str);
    if (!Number.isFinite(v)) return free / 2;
    return /%$/.test(str) ? (free * v) / 100 : v;
  };
  const ox = one(t[0], W - vw * sx);
  const oy = one(t[1] === undefined ? t[0] : t[1], H - vh * sy);
  return [ox + fx * vw * sx, oy + fy * vh * sy, sx];
}

// What she says once, where she first speaks with her face on screen (as the Bootcamp agent's first line).
export const TELEPATHIC_LINE = "My lips aren't quite modeled yet, so for now I'm speaking to you telepathically.";

// Her brow in every video of her (all 720 x 720, one framing: /withgigi/gigi/idle-alpha.*, grateful.gg/gigi/gigi.mp4,
// grateful.gg/media/gigi-live/idle.mp4): the light's centre and width as fractions of the frame (the Bootcamp page's).
export const BROW = { x: 0.433, y: 0.207, w: 0.048 };

const CHARS_PER_SECOND = 14;

export const ESSENCES = {
  heart: { color: '#2fd36b', re: /\b(hi|hello|welcome|glad|love\w*|care|grateful|gratitude|together|community|group|giraffes?|friends?|help\w*|support\w*)\b/gi },
  ground: { color: '#ff3b30', re: /\b(where|venice|sawubona|location|address|saturday|sunday|november|12 ?pm|6 ?pm|laptop|refund|guarantee|safe|price|checkout|seat|reserve|body|breath\w*|ground\w*)\b/gi },
  spark: { color: '#ff8a1f', re: /\b(creat\w*|fun|play|joy\w*|enjoy\w*|excit\w*|imagin\w*|content|posts?|reels?|newsletters?|design\w*)\b/gi },
  power: { color: '#ffd21f', re: /\b(build\w*|run\w*|agents?|automat\w*|business|hours?|money|results?|confiden\w*|power\w*|work\w*|saves?|deploy\w*)\b/gi },
  truth: { color: '#1fb6ff', re: /\b(questions?|answer\w*|ask\w*|tell\w*|text\w*|call\w*|talk\w*|email\w*|speak\w*|honest\w*|clear\w*|say\w*)\b/gi },
  insight: { color: '#5b5bff', re: /\b(learn\w*|teach\w*|benza|course|school|understand\w*|know\w*|claude|instructor|telepath\w*|mind|brain|think\w*|lips)\b/gi },
  wonder: { color: '#d14dff', re: /\b(become\w*|transform\w*|possib\w*|dream\w*|vision\w*|future|master|sensei|wizard|superhero|wisdom|purpose|magic\w*|wonder\w*)\b/gi },
};

export function essenceOf(sentence) {
  let best = 'heart';
  let top = 0;
  Object.entries(ESSENCES).forEach(([key, { re }]) => {
    const n = (String(sentence).match(re) || []).length;
    if (n > top) { top = n; best = key; }
  });
  return best;
}

// One timer per sentence, at about the pace she speaks it; returns a cancel.
export function followEssence(text, onEssence) {
  const timers = [];
  let at = 0;
  (String(text).match(/[^.!?]+[.!?]*/g) || [String(text)]).forEach((s) => {
    timers.push(setTimeout(() => onEssence(essenceOf(s)), at));
    at += (s.length / CHARS_PER_SECOND) * 1000;
  });
  return () => timers.forEach(clearTimeout);
}

const st = { level: null, essence: 'heart', cancel: null };
if (typeof window !== 'undefined') window.gigiTelepathy = st;   // (for a look in the console)

export function voice(fn) {
  st.level = typeof fn === 'function' ? fn : null;
  if (!st.level) hush();
}
export function say(text) {
  if (!text || !String(text).trim()) return;
  st.cancel?.();
  st.cancel = followEssence(text, (e) => { st.essence = e; });
}
export function hush() {
  st.cancel?.();
  st.cancel = null;
}
// Set the colour outright (a practice with no words to read, such as her breathing tracks).
export function tint(key) {
  hush();
  if (ESSENCES[key]) st.essence = key;
}
export const essenceNow = () => st.essence;

// Once a visit: the first time she speaks with her face on screen, she says why her lips don't move.
const SAID_KEY = 'gigi_telepathic_said';
export function telepathicIntro() {
  try {
    if (sessionStorage.getItem(SAID_KEY) === '1') return '';
    sessionStorage.setItem(SAID_KEY, '1');
  } catch { /* private mode: she says it each time */ }
  return TELEPATHIC_LINE;
}

// Keeps `el` glowing with her voice: --lv (0 to 1, smoothed), --eye (the colour) and the `on` class. Given her video,
// it also keeps the light on her brow wherever the video is drawn (object-fit and object-position included).
export function attachEye(el, video = null) {
  const win = el.ownerDocument.defaultView || window;   // the /ai/setup floating window has its own frame clock
  let raf = 0;
  let smooth = 0;
  let shown = '';
  let key = '';
  // Measured from the boxes on screen, so a translate or scale on the video counts (app.grateful.gg/gigi centres hers with
  // one, Neck and Neck zooms its tile). The light's own host must not be transformed.
  const place = () => {
    const v = video;
    const host = el.offsetParent || el.parentElement;
    if (!v || !host || !v.videoWidth || !v.offsetWidth) return;
    const vr = v.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    const id = `${vr.left - hr.left},${vr.top - hr.top},${vr.width}x${vr.height}|${v.offsetWidth}x${v.offsetHeight}|${v.videoWidth}x${v.videoHeight}`;
    if (id === key) return;
    key = id;
    const cs = win.getComputedStyle(v);
    const [x, y, k] = onBox(v.offsetWidth, v.offsetHeight, v.videoWidth, v.videoHeight, cs.objectFit || 'fill', cs.objectPosition, BROW.x, BROW.y);
    const sx = vr.width / v.offsetWidth;
    const sy = vr.height / v.offsetHeight;
    Object.assign(el.style, { left: `${vr.left - hr.left - host.clientLeft + x * sx}px`, top: `${vr.top - hr.top - host.clientTop + y * sy}px`, width: `${BROW.w * v.videoWidth * k * sx}px` });
  };
  const tick = () => {
    let lv = 0;
    try { lv = st.level ? Math.max(0, Math.min(1, (st.level() || 0) * 2.4)) : 0; } catch { lv = 0; }
    smooth += (lv - smooth) * 0.28;
    el.style.setProperty('--lv', smooth.toFixed(3));
    const color = ESSENCES[st.essence].color;
    if (color !== shown) { shown = color; el.style.setProperty('--eye', color); }
    el.classList.toggle('on', !!st.level);
    place();
    raf = win.requestAnimationFrame(tick);
  };
  tick();
  return () => { win.cancelAnimationFrame(raf); el.style.setProperty('--lv', '0'); el.classList.remove('on'); };
}

// Her light. Without a video to follow, give the element its own left/top/width (BROW of its square box). A transform is
// added for the glow's swell, so the element is centred on its left/top.
export const EYE_CSS = `
@property --eye{syntax:'<color>';inherits:true;initial-value:#2fd36b}
.gigi-eye{position:absolute;aspect-ratio:1;transform:translate(-50%,-50%) scale(calc(1 + var(--lv,0) * .4));border-radius:50%;background:radial-gradient(circle,#fff 0 16%,var(--eye) 44%,transparent 74%);opacity:0;transition:--eye .6s ease,opacity .4s ease;pointer-events:none;z-index:1}
.gigi-eye.on{opacity:1;filter:drop-shadow(0 0 calc(3px + var(--lv,0) * 9px) var(--eye)) drop-shadow(0 0 calc(9px + var(--lv,0) * 22px) var(--eye))}
.gigi-eye.square{left:${BROW.x * 100}%;top:${BROW.y * 100}%;width:${BROW.w * 100}%}
@media (prefers-reduced-motion:reduce){.gigi-eye{transition:none}}
`;
