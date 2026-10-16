import { Room, RoomEvent, Track, ParticipantKind } from 'https://cdn.jsdelivr.net/npm/livekit-client@2.22.3/+esm';
import { GigiAvatar } from './avatar.js?v=7ec4bd57f7';
import { Hide, seedOf } from './hide.js?v=5e3b8abe0c';
import { Pacer } from './pacer.js?v=10ed3b6f67';

const FN = 'https://axysrawypndwfzruqkdh.supabase.co/functions/v1/neck-room';
const MODE_LABEL = { gratitude: 'Gratitude', breath: 'Breath', both: 'Breath + Gratitude' };
const PATTERN_LABEL = { coherence: 'Coherence', box: 'Box', '478': '4-7-8' };
// Seats in the 3x3 grid as [row, col], filled in this order around the center square.
const LAYOUT = {
  solo: [[1, 1]],                                                      // 1-on-1: you beside the practice
  pair: [[1, 1], [1, 3]],                                              // two people: either side of the center
  cross: [[2, 1], [2, 3], [1, 2], [3, 2]],                             // 3-4: a cross
  ring: [[2, 1], [2, 3], [1, 2], [3, 2], [1, 1], [1, 3], [3, 1], [3, 3]], // 5-8: the full Brady Bunch
};

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const identity = store.get('nn-id') || (() => { const id = 'g-' + crypto.randomUUID(); store.set('nn-id', id); return id; })();
const firstName = (n) => (n || '').trim().split(/\s+/)[0] || 'friend';

let code = new URLSearchParams(location.search).get('r') || '';
let room = null, audioCtx = null, gigiId = null, mode = 'gratitude', size = 2, pattern = 'coherence', rounds = 5;
let st = {}, shownTurn = '', lastClip = '', micBlocked = false, autoMuted = false, isCreator = false;
let pacer = null, centerHide = null, ticker = null;
const hides = new Map();       // seat key -> Hide
const avatar = new GigiAvatar($('gigiVideo'));
window.gigi = avatar;          // prototype: handy for poking at her from the console

// ---------------------------------------------------------------- views
function show(id) { for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== id; }

function badge(el) {
  if (el.querySelector('video')) return;
  const v = document.createElement('video');
  Object.assign(v, { src: 'gigi/clips/idle.mp4?v=2f6b62584c', poster: 'gigi/base.webp', muted: true, loop: true, playsInline: true, autoplay: true });
  v.setAttribute('playsinline', '');
  v.style.cssText = 'width:100%;height:100%;object-fit:cover;object-position:50% 18%;transform:scale(1.35);transform-origin:50% 22%';
  el.appendChild(v);
  v.play().catch(() => {});
}

async function call(body) {
  const res = await fetch(FN, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ...data };
}

function fail(el, msg) { el.hidden = false; el.textContent = msg; }

async function unlockAudio() {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  await audioCtx.resume().catch(() => {});
}

function showStart() {
  show('start');
  badge($('heroGigi'));
  $('startName').value = store.get('nn-name') || '';
  const syncOpts = () => { $('breathOpts').hidden = new FormData($('startForm')).get('mode') === 'gratitude'; };
  for (const r of document.querySelectorAll('input[name=mode]')) r.onchange = syncOpts;
  syncOpts();
  $('startForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target), name = String(f.get('name') || '').trim();
    if (!name) return;
    store.set('nn-name', name);
    $('startBtn').disabled = true;
    $('startError').hidden = true;
    await unlockAudio();
    const r = await call({ action: 'create', name, identity, mode: f.get('mode'), size: Number(f.get('size')),
      pattern: f.get('pattern'), rounds: Number(f.get('rounds')) });
    if (!r.token) {
      $('startBtn').disabled = false;
      return fail($('startError'), r.error === 'limit' ? "You've started a lot of rooms today. Try again tomorrow."
        : r.error === 'busy' ? 'Every room is in use right now. Try again in a few minutes.' : 'Could not start a room. Try again.');
    }
    code = r.room;
    isCreator = true;
    history.replaceState(null, '', `?r=${code}`);
    enter(r, name).catch((err) => { console.error(err); $('startBtn').disabled = false; fail($('startError'), 'Could not connect. Try again.'); });
  };
}

async function showJoin() {
  show('join');
  badge($('joinGigi'));
  $('joinName').value = store.get('nn-name') || '';
  const info = await call({ action: 'info', room: code });
  if (!info.live) {
    $('joinLede').textContent = 'This room has ended.';
    $('joinFacts').textContent = '';
    $('joinName').closest('label').hidden = $('joinBtn').hidden = true;
    return;
  }
  $('joinLede').textContent = `You're invited to a ${MODE_LABEL[info.mode] || 'practice'} room.`;
  const breathy = info.mode !== 'gratitude' && info.pattern ? ` ${PATTERN_LABEL[info.pattern]} breath, ${info.rounds} rounds.` : '';
  $('joinFacts').textContent = info.count >= info.size ? 'This room is full.' : `${info.count} of ${info.size} here so far.${breathy}`;
  $('joinForm').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('joinName').value.trim();
    if (!name) return;
    store.set('nn-name', name);
    $('joinBtn').disabled = true;
    $('joinError').hidden = true;
    await unlockAudio();
    const r = await call({ action: 'join', room: code, name, identity });
    if (!r.token) {
      $('joinBtn').disabled = false;
      return fail($('joinError'), r.error === 'full' ? 'This room is full.' : r.error === 'ended' ? 'This room has ended.' : 'Could not join. Try again.');
    }
    enter(r, name).catch((err) => { console.error(err); $('joinBtn').disabled = false; fail($('joinError'), 'Could not connect. Try again.'); });
  };
}

function showEnd(text) {
  if (!$('end').hidden) return;
  if (room && room.state !== 'disconnected') room.disconnect();
  show('end');
  badge($('endGigi'));
  $('endText').textContent = text || ({ breath: 'You breathed together.', both: 'You breathed and shared together.' }[mode]
    || 'You climbed the ladder of gratitude together.');
}

// ---------------------------------------------------------------- the room
async function enter(r, name) {
  mode = r.mode || 'gratitude';
  size = Number(r.size) || 2;
  pattern = r.pattern || 'coherence';
  rounds = Number(r.rounds) || 5;
  room = new Room({ adaptiveStream: true, dynacast: true,
    audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  room
    .on(RoomEvent.ParticipantConnected, render)
    .on(RoomEvent.ParticipantDisconnected, (p) => { if (p.identity === gigiId) { gigiId = null; avatar.detach(); } render(); })
    .on(RoomEvent.TrackSubscribed, onTrack)
    .on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((el) => el.remove()))
    .on(RoomEvent.LocalTrackPublished, render)
    .on(RoomEvent.LocalTrackUnpublished, render)
    .on(RoomEvent.TrackMuted, render)
    .on(RoomEvent.TrackUnmuted, render)
    .on(RoomEvent.ActiveSpeakersChanged, render)
    .on(RoomEvent.ParticipantAttributesChanged, (changed, p) => { if (isGigi(p)) onState(p.attributes); })
    .on(RoomEvent.DataReceived, onData)
    .on(RoomEvent.AudioPlaybackStatusChanged, () => { $('unlock').hidden = room.canPlaybackAudio; })
    .on(RoomEvent.Disconnected, () => showEnd());
  await room.connect(r.url, r.token);
  try { await room.localParticipant.setMicrophoneEnabled(true); } catch { micBlocked = true; }
  if (size >= 3) { try { await room.localParticipant.setCameraEnabled(true); } catch { /* camera optional */ } }
  show('room');
  await avatar.load();
  const bc = avatar.manifest && avatar.manifest['breath-cycle'];
  pacer = new Pacer($('center'), bc ? `gigi/${bc.video}${bc.v ? `?v=${bc.v}` : ''}` : undefined);
  centerHide = new Hide($('center'), seedOf(code), () => (st.phase === 'breath' ? pacer.fullness() : null));
  $('inviteLink').value = `${location.origin}${location.pathname}?r=${code}`;
  $('invite').hidden = !isCreator || size === 1;
  $('unlock').hidden = room.canPlaybackAudio;
  for (const p of room.remoteParticipants.values()) {
    if (isGigi(p)) onState(p.attributes);
    for (const pub of p.trackPublications.values()) if (pub.track) onTrack(pub.track, pub, p);
  }
  render();
  ticker = setInterval(tick, 250);
  requestAnimationFrame(drawHides);
}

const isGigi = (p) => p && (p.kind === ParticipantKind.AGENT || p.isAgent);
const people = () => {
  if (!room) return [];
  const all = [room.localParticipant, ...[...room.remoteParticipants.values()].filter((p) => !isGigi(p))];
  return all.sort((a, b) => ((a.joinedAt?.getTime() || 0) - (b.joinedAt?.getTime() || 0)) || a.identity.localeCompare(b.identity)).slice(0, size);
};
const amHost = () => st.host === identity;

function onTrack(track, pub, p) {
  if (track.kind === Track.Kind.Audio) {
    $('audioSink').appendChild(track.attach());
    if (isGigi(p)) { gigiId = p.identity; avatar.attach(track.mediaStreamTrack, audioCtx); }
  }
  render();
}

function onState(attrs) {
  const before = st.phase;
  st = { ...attrs };
  if (st.clip && st.clip !== lastClip) { lastClip = st.clip; avatar.arm(st.clip); }
  if (st.prompt_clips) { try { avatar.preload(JSON.parse(st.prompt_clips).concat(['closing', 'goodbye', 'goodbye-breath', 'in', 'hold', 'out'])); } catch { /* ignore */ } }
  if (st.phase === 'breath' && st.breath) { try { pacer.set(JSON.parse(st.breath)); } catch { /* ignore */ } }
  else if (before === 'breath') pacer.clear();
  const turnId = st.phase === 'turn' ? st.turn_id : '';
  if (turnId && turnId !== shownTurn) { shownTurn = turnId; hides.get(st.speaker)?.ripple(1); }
  if (st.phase === 'done') setTimeout(() => showEnd(), 2500);
  autoMute();
  render();
}

// Everyone's mic goes quiet during breath (Gigi's cues stay), and comes back after.
async function autoMute() {
  if (!room) return;
  const lp = room.localParticipant;
  if (st.phase === 'breath' && lp.isMicrophoneEnabled && !autoMuted) { autoMuted = true; await lp.setMicrophoneEnabled(false).catch(() => {}); }
  else if (st.phase !== 'breath' && autoMuted) { autoMuted = false; await lp.setMicrophoneEnabled(true).catch(() => {}); }
}

function seatEl(i) {
  let el = $('grid').querySelector(`.seat[data-i="${i}"]`);
  if (!el) {
    el = document.createElement('div');
    el.className = 'seat';
    el.dataset.i = i;
    el.innerHTML = '<video playsinline muted></video><span class="initial"></span><span class="name"></span><span class="muted-dot"></span>';
    $('grid').appendChild(el);
  }
  return el;
}

function render() {
  if (!room) return;
  const ps = people();
  const layout = size === 1 ? LAYOUT.solo : size === 2 ? LAYOUT.pair : size <= 4 ? LAYOUT.cross : LAYOUT.ring;
  $('grid').classList.toggle('pair', size === 2);
  $('grid').classList.toggle('solo', size === 1);
  layout.slice(0, size).forEach(([row, col], i) => {
    const el = seatEl(i), p = ps[i], key = p ? p.identity : `empty-${i}`;
    Object.assign(el.style, { gridRow: row, gridColumn: col });
    if (el.dataset.key !== key) {
      hides.get(el.dataset.key)?.destroy();
      hides.delete(el.dataset.key);
      el.dataset.key = key;
      hides.set(key, new Hide(el, seedOf(key), () => (st.phase === 'breath' ? pacer.fullness() : null)));
    }
    const me = p && p.identity === identity;
    el.classList.toggle('empty', !p);
    el.querySelector('.initial').textContent = p ? firstName(p.name).slice(0, 1).toUpperCase() : 'Open seat';
    el.querySelector('.name').textContent = p ? (me ? `${firstName(p.name)} (you)` : firstName(p.name)) : '';
    el.classList.toggle('speaking', !!p && p.isSpeaking && st.phase !== 'breath');
    el.classList.toggle('sharing', !!p && st.phase === 'turn' && st.speaker === p.identity);
    el.classList.toggle('mic-off', !!p && !p.isMicrophoneEnabled && st.phase !== 'breath');
    const cam = p && p.getTrackPublication(Track.Source.Camera), video = el.querySelector('video');
    const on = !!(cam && cam.track && !cam.isMuted);
    el.classList.toggle('video', on);
    if (on && video.dataset.sid !== cam.trackSid) { cam.track.attach(video); video.dataset.sid = cam.trackSid; }
    if (!on) video.dataset.sid = '';
  });

  const count = ps.length, ph = st.phase || 'waiting';
  $('roomTitle').textContent = mode === 'gratitude' ? MODE_LABEL[mode] : `${MODE_LABEL[mode]} · ${PATTERN_LABEL[pattern]}`;
  $('roomCount').textContent = size === 1 ? 'Just you and Gigi' : `${count} of ${size} here`;
  $('inviteBtn').hidden = count >= size;
  const c = $('center'), meta = $('centerMeta'), text = $('centerText'), sub = $('centerSub');
  c.classList.toggle('breath', ph === 'breath');
  const gratitudePhase = ['prompt', 'turn', 'between', 'closing', 'waiting_return'].includes(ph) && st.prompt_text;
  $('breathHud').hidden = ph !== 'breath';
  if (ph === 'breath') {
    let b = {}; try { b = JSON.parse(st.breath || '{}'); } catch { /* ignore */ }
    $('breathLabel').textContent = b.label || '';
    $('breathRound').textContent = b.rounds ? `Round ${Math.min(b.round || 1, b.rounds)} of ${b.rounds}` : '';
  } else if (gratitudePhase) {
    meta.textContent = ph === 'closing' ? 'Closing' : `Prompt ${Number(st.prompt_index || 0) + 1} of ${st.prompt_count || 1}`;
    text.textContent = st.prompt_text;
    sub.textContent = ph === 'turn' ? (st.speaker === identity ? 'Your turn' : `${firstName(st.speaker_name)} is sharing`) : '';
  } else {
    meta.textContent = MODE_LABEL[mode];
    text.textContent = { welcome: 'Welcome', done: 'Thank you', between: mode === 'gratitude' ? '' : 'Breathe naturally' }[ph] ?? 'Waiting for everyone';
    sub.textContent = ph === 'waiting' && size > 1 ? `${count} of ${size} here` : '';
  }
  $('promptStrip').hidden = !gratitudePhase || size === 1;   // 1-on-1 shows the prompt on Gigi's tile
  $('promptStrip').textContent = gratitudePhase ? st.prompt_text : '';

  const gigiOff = st.gigi === 'off';
  $('gigiTile').classList.toggle('off', gigiOff);
  $('gigiOff').hidden = !gigiOff;
  const mine = ph === 'turn' && st.speaker === identity;
  $('doneBtn').hidden = !mine;
  $('repeatBtn').hidden = !(mine && !gigiOff);
  $('hostCtl').hidden = !amHost();
  $('beginBtn').hidden = !(ph === 'waiting' && size > 2 && count >= 2);
  $('nextBtn').hidden = !['turn', 'breath', 'between', 'prompt'].includes(ph);
  $('gigiBtn').textContent = gigiOff ? 'Gigi off' : 'Gigi on';
  $('gigiBtn').classList.toggle('on', !gigiOff);

  const lp = room.localParticipant, mic = lp.isMicrophoneEnabled;
  $('micBtn').textContent = ph === 'breath' && autoMuted ? 'Mic (breathing)' : mic ? 'Mic on' : 'Mic off';
  $('micBtn').className = 'ctl ' + (mic ? 'on' : 'off');
  $('camBtn').textContent = lp.isCameraEnabled ? 'Camera on' : 'Camera off';
  $('camBtn').classList.toggle('on', lp.isCameraEnabled);

  let s = '';
  if (micBlocked && !mic) s = 'Your microphone is blocked. Allow it in the address bar, then tap Mic.';
  else if (!gigiId) s = count < 2 && size > 1 ? 'Send the invite link to bring people in.' : 'Gigi is on her way…';
  else s = { waiting: count < 2 ? 'Send the invite link to bring people in.' : size > 2 ? (amHost() ? 'Tap Begin now when everyone is here.' : 'Waiting for the host to begin.') : 'Gigi is gathering you…',
    welcome: gigiOff ? '' : 'Gigi is welcoming you.', breath: 'Breathe with the light. Mics are resting.',
    between: gigiOff ? (amHost() ? 'Tap Next when you are ready.' : '') : '',
    waiting_return: `${firstName(st.speaker_name)} dropped off. Waiting a moment for them…` }[ph] ?? '';
  $('status').textContent = s;
}

function tick() {
  if (st.phase === 'breath' && pacer) $('breathCount').textContent = String(pacer.remaining() || '');
}

function drawHides(t) {
  requestAnimationFrame(drawHides);
  for (const h of hides.values()) h.draw(t);
  if (centerHide && st.phase !== 'breath') centerHide.draw(t);
  if (centerHide) centerHide.canvas.style.opacity = st.phase === 'breath' ? '0' : '1';
  if (pacer) pacer.v.style.opacity = st.phase === 'breath' ? '1' : '0';
}

// ---------------------------------------------------------------- giraffes
function floatGiraffe(key) {
  const el = [...$('grid').querySelectorAll('.seat')].find((s) => s.dataset.key === key);
  if (!el) return;
  const g = document.createElement('span');
  g.className = 'float-giraffe';
  g.textContent = '🦒';
  el.appendChild(g);
  setTimeout(() => g.remove(), 1900);
}

function giraffe(to) {
  const targets = to ? [to] : people().map((p) => p.identity);
  for (const k of targets) { hides.get(k)?.ripple(1.2); floatGiraffe(k); }
}

function onData(payload) {
  try {
    const m = JSON.parse(new TextDecoder().decode(payload));
    if (m.t === 'g') giraffe(m.to || null);
  } catch { /* not ours */ }
}

// ---------------------------------------------------------------- controls
async function rpc(method, payload = '') {
  if (!gigiId) return;
  try { return await room.localParticipant.performRpc({ destinationIdentity: gigiId, method, payload }); }
  catch (e) { console.warn('rpc', method, e); }
}

$('giraffeBtn').onclick = () => {
  const to = st.phase === 'turn' && st.speaker !== identity ? st.speaker : '';
  room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ t: 'g', to })), { reliable: true });
  giraffe(to || null);
};
$('doneBtn').onclick = () => { $('doneBtn').hidden = true; rpc('done'); };
$('repeatBtn').onclick = () => rpc('repeat');
$('beginBtn').onclick = () => { $('beginBtn').hidden = true; rpc('start'); };
$('nextBtn').onclick = () => rpc('next');
$('gigiBtn').onclick = () => rpc('gigi', st.gigi === 'off' ? 'on' : 'off');
$('micBtn').onclick = async () => {
  autoMuted = false;
  try { await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled); micBlocked = false; }
  catch { micBlocked = true; }
  render();
};
$('camBtn').onclick = async () => {
  try { await room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled); } catch (e) { console.warn(e); }
  render();
};
$('inviteBtn').onclick = () => { $('invite').hidden = !$('invite').hidden; };
$('leaveBtn').onclick = () => showEnd('You left the room.');
$('unlock').onclick = async () => { await audioCtx?.resume(); await room?.startAudio(); $('unlock').hidden = room?.canPlaybackAudio; };
$('copyBtn').onclick = async () => {
  const link = $('inviteLink').value;
  if (navigator.share && /Mobi/i.test(navigator.userAgent)) {
    try { await navigator.share({ title: 'Neck and Neck', text: `Join me for ${MODE_LABEL[mode].toLowerCase()}, held by Gigi`, url: link }); return; } catch { /* fall back to copy */ }
  }
  try { await navigator.clipboard.writeText(link); } catch { $('inviteLink').select(); document.execCommand('copy'); }
  $('copyBtn').textContent = 'Copied';
  setTimeout(() => { $('copyBtn').textContent = 'Copy'; }, 1800);
};

if (code) showJoin(); else showStart();
