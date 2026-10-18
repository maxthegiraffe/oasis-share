import { Room, RoomEvent, Track, ParticipantKind, createLocalAudioTrack } from 'https://cdn.jsdelivr.net/npm/livekit-client@2.22.3/+esm';
import { GigiAvatar, breathAt, breathMarks } from './avatar.js?v=48460c951b';
import { Hide, seedOf } from './hide.js?v=5e3b8abe0c';
import { Pacer } from './pacer.js?v=10ed3b6f67';

const FN = 'https://axysrawypndwfzruqkdh.supabase.co/functions/v1/neck-room';
const MODE_LABEL = { gratitude: 'Gratitude', breath: 'Breath', both: 'Breath + Gratitude' };
const PATTERN_LABEL = { coherence: 'Coherence', box: 'Box', '478': '4-7-8' };
const PHASE_LABEL = { in: 'Breathe in', hold: 'Hold', out: 'Breathe out' };
const READY_FALLBACK_MS = 12000;   // solo: tell the agent she's arrived by then even if the walk-up never ended
const BELL_GAIN = 0.06;
const MIC_OPTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
// Solo plays only these (SOLO-V3-SPEC "The session"): the opener loads with the walk-up, the rest once she's arrived.
const SOLO_OPENER = { gratitude: ['welcome-hello', 'welcome-gratitude'], breath: ['solo-welcome-breath'], both: ['solo-arrive-breath'] };
// solo intro lines: a person who has heard one doesn't hear it again (Max: "for strangers yes. for people coming
// back no."). Remembered per browser; sent when a room starts; the agent skips them.
const INTRO = ['welcome-hello', 'welcome-gratitude', 'solo-howto', 'solo-welcome-breath', 'solo-arrive-breath'];
const heardIntro = () => { try { return JSON.parse(store.get('nn-heard') || '[]').filter((c) => INTRO.includes(c)); } catch { return []; } };
const markHeard = (id) => { if (INTRO.includes(id)) { const h = heardIntro(); if (!h.includes(id)) store.set('nn-heard', JSON.stringify([...h, id])); } };
// what she says first: the opener minus what they've heard, else the exercise itself
const soloFirst = (m, p) => {
  const left = SOLO_OPENER[m].filter((c) => !heardIntro().includes(c));
  if (left.length) return left;
  return m === 'gratitude' ? ['lead-first'] : ['breath-in', `breath-${p}`];
};
const SOLO_SHARE = ['solo-howto', 'lead-first', 'lead-next', 'lead-last', 'ready', 'ack-1', 'ack-2', 'ack-3', 'ack-4',
  'ack-5', 'ack-6', 'ack-7', 'ack-8', 'ack-quiet', 'nudge'];   // nudge: a turn still silent after 20 s
const soloRest = (m, p) => [...(m === 'gratitude' ? [] : ['breath-in', `breath-${p}`, 'breath-out']),
  ...({ gratitude: [...SOLO_SHARE, 'solo-closing', 'solo-goodbye'], breath: ['breath-end', 'goodbye-breath'],
    both: ['to-gratitude', ...SOLO_SHARE, 'to-closing-breath', 'goodbye-breath'] }[m] || [])];   // solo Both has no breath-end
const SOLO_AFTER_PROMPTS = ['to-closing-breath', 'solo-goodbye', 'goodbye-breath'];   // once one starts, no prompt is left to show
// Seats in the 3x3 grid as [row, col], filled in this order around the center square.
const LAYOUT = {
  solo: [],                                                            // 1-on-1: Gigi fills the screen, no box for you
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
let run = null, lastRun = '', readySent = false, readyRpc = false, warmed = false, stageObs = null;   // solo
let arrived = false, promptsOver = false;   // solo: the walk-up is over / the last prompt is behind them
const hides = new Map();       // seat key -> Hide
const avatar = new GigiAvatar($('gigiVideo'));
window.gigi = avatar;          // prototype: handy for poking at her from the console

// ---------------------------------------------------------------- views
function show(id) {
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== id;
  document.documentElement.classList.toggle('stage-on', id === 'room' && size === 1);   // solo: nothing scrolls under the stage
}

function badge(el) {
  if (el.querySelector('video')) return;
  const v = document.createElement('video');
  Object.assign(v, { src: 'gigi/clips/idle.mp4?v=65a3da1006', poster: 'gigi/base.webp', muted: true, loop: true, playsInline: true, autoplay: true });
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
  call({ action: 'warm' }).catch(() => {});   // wake a Gigi worker while they choose (an idle agent cold-starts in ~16 s)
  $('startName').value = store.get('nn-name') || '';
  const syncOpts = () => { $('breathOpts').hidden = new FormData($('startForm')).get('mode') === 'gratitude'; };
  for (const r of document.querySelectorAll('input[name=mode]')) r.onchange = syncOpts;
  syncOpts();
  for (const r of document.querySelectorAll('input[name=size]')) r.addEventListener('change', () => { if (r.checked && r.value === '1') warmSolo(); });
  $('startForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target), name = String(f.get('name') || '').trim();
    if (!name) return;
    if (f.get('size') === '1') warmSolo();
    store.set('nn-name', name);
    $('startBtn').disabled = true;
    $('startError').hidden = true;
    await unlockAudio();
    const r = await call({ action: 'create', name, identity, mode: f.get('mode'), size: Number(f.get('size')), heard: heardIntro(),
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
  stopRun();
  if (size === 1) for (const v of $('gigiVideo').querySelectorAll('video')) v.pause();   // solo: she's off screen now
  document.body.classList.toggle('solo-done', size === 1);   // solo ends in the oasis
  show('end');
  badge($('endGigi'));
  const said = size === 1 ? { breath: 'You breathed with Gigi.', both: 'You breathed and shared with Gigi.', gratitude: 'You climbed the ladder of gratitude with Gigi.' }
    : { breath: 'You breathed together.', both: 'You breathed and shared together.', gratitude: 'You climbed the ladder of gratitude together.' };
  $('endText').textContent = text || said[mode] || said.gratitude;
}

// ---------------------------------------------------------------- the room
async function enter(r, name) {
  mode = r.mode || 'gratitude';
  size = Number(r.size) || 2;
  pattern = r.pattern || 'coherence';
  rounds = Number(r.rounds) || 5;
  room = new Room({ adaptiveStream: true, dynacast: true, audioCaptureDefaults: MIC_OPTS });
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
  // solo: the mic prompt comes before connecting (the track is published once in), so the agent's start fallback
  // (it counts from their arrival) can't run out during it and the walk-up follows the connect at once. A refusal
  // shows the blocked-mic note, and Mic asks again.
  let mic = null;
  if (size === 1) { try { mic = await createLocalAudioTrack(MIC_OPTS); } catch { micBlocked = true; } }
  await room.connect(r.url, r.token).catch((e) => { if (mic) mic.stop(); throw e; });   // a failed connect doesn't leave the mic on
  if (mic) { try { await room.localParticipant.publishTrack(mic); } catch { mic.stop(); micBlocked = true; } }
  else if (size > 1) { try { await room.localParticipant.setMicrophoneEnabled(true); } catch { micBlocked = true; } }
  if (size >= 3) { try { await room.localParticipant.setCameraEnabled(true); } catch { /* camera optional */ } }
  if (size === 1) await openStage();
  show('room');
  if (size === 1) { layoutStage(); setTimeout(sendReady, READY_FALLBACK_MS); }
  const first = size === 1 ? soloFirst(mode, pattern) : [];   // computed before this session marks anything heard
  await avatar.load(size === 1 ? { solo: true, preload: first } : undefined);
  if (size > 1) {
    ensurePacer();
    centerHide = new Hide($('center'), seedOf(code), () => (st.phase === 'breath' ? pacer.fullness() : null));
  } else {
    stageImg(); layoutStage();   // in case the manifest came after openStage stopped waiting for it
    // she walks up while the agent connects; once she's on her spot the agent may start (the opener is loaded)
    // no walk-up any more (Max: "should just start with the exercise"): she's on her spot from the first frame,
    // and the agent starts as soon as her first line is in memory
    avatar.walkup().then(() => avatar.loaded(first[0], 3000)).then(() => {
      arrived = true;
      sendReady();
      soloPrompts();                          // the first prompt and her next words first, then the rest
      avatar.preload(soloRest(mode, pattern));
      // no breath-<pattern> render: the pacer breathes instead, so load it now, hidden, not empty when the run starts
      if (mode !== 'gratitude' && !(avatar.manifest && avatar.manifest[`breath-${pattern}`])) ensurePacer();
    });
  }
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
    if (isGigi(p)) { gigiId = p.identity; avatar.attach(track.mediaStreamTrack, audioCtx); readyByRpc(); }
  }
  render();
}

function onState(attrs) {
  const before = st.phase;
  st = { ...attrs };
  if (st.clip && st.clip !== lastClip) {
    lastClip = st.clip;
    avatar.arm(st.clip);
    if (size === 1) markHeard(st.clip.split(':')[0]);
    if (size === 1 && SOLO_AFTER_PROMPTS.includes(st.clip.split(':')[0])) promptsOver = true;
  }
  if (st.prompt_clips) {
    if (size === 1) soloPrompts();
    else { try { avatar.preload(JSON.parse(st.prompt_clips).concat(['closing', 'goodbye', 'goodbye-breath', 'in', 'hold', 'out'])); } catch { /* ignore */ } }
  }
  if (st.phase === 'breath' && st.breath) {
    try {
      const b = JSON.parse(st.breath);
      if (size === 1 && b && b.run !== undefined) startRun(b);   // solo: one publish per run, the page keeps the clock
      else (size === 1 ? ensurePacer() : pacer).set(b);
    } catch { /* ignore */ }
  } else if (before === 'breath') { stopRun(); if (pacer) { pacer.clear(); if (size === 1) pacer.v.pause(); } }   // solo: nothing plays off screen
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
  for (const el of $('grid').querySelectorAll('.seat')) if (Number(el.dataset.i) >= layout.length) { hides.get(el.dataset.key)?.destroy(); hides.delete(el.dataset.key); el.remove(); }
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

  const count = ps.length, ph = st.phase || 'waiting', solo = size === 1;
  $('roomTitle').textContent = mode === 'gratitude' ? MODE_LABEL[mode] : `${MODE_LABEL[mode]} · ${PATTERN_LABEL[pattern]}`;
  $('roomCount').textContent = solo ? '' : `${count} of ${size} here`;   // solo: the top bar is the mode chip and Leave
  $('inviteBtn').hidden = count >= size;
  const c = $('center'), meta = $('centerMeta'), text = $('centerText'), sub = $('centerSub');
  c.classList.toggle('breath', ph === 'breath');
  $('room').classList.toggle('runclips', solo && !!(run && run.clips));   // solo breath plays in her square: keep it up
  // solo: once she's on to the closing breath or the goodbye, the last prompt doesn't come back over her
  const gratitudePhase = ['prompt', 'turn', 'between', 'closing', 'waiting_return'].includes(ph) && st.prompt_text && !(solo && promptsOver);
  $('breathHud').hidden = ph !== 'breath';
  if (ph === 'breath') {
    if (!run) {   // a solo run's HUD runs on its own clock (runTick)
      let b = {}; try { b = JSON.parse(st.breath || '{}'); } catch { /* ignore */ }
      $('breathLabel').textContent = b.label || '';
      $('breathRound').textContent = b.rounds ? `Round ${Math.min(b.round || 1, b.rounds)} of ${b.rounds}` : '';
    }
  } else if (gratitudePhase) {
    // solo: the closing question's turn (phase 'turn', prompt_index = count) reads Closing, not "Prompt 6 of 5"
    const closing = ph === 'closing' || (solo && !!st.prompt_count && Number(st.prompt_index) >= Number(st.prompt_count));
    meta.textContent = closing ? 'Closing' : `Prompt ${Number(st.prompt_index || 0) + 1} of ${st.prompt_count || 1}`;
    text.textContent = st.prompt_text;
    sub.textContent = ph === 'turn' ? (st.speaker === identity ? 'Your turn' : `${firstName(st.speaker_name)} is sharing`) : '';
  } else if (solo) {   // solo: the oasis stays clear between prompts (no waiting or arriving text)
    meta.textContent = sub.textContent = '';
    text.textContent = ph === 'done' ? 'Thank you' : '';
  } else {
    meta.textContent = MODE_LABEL[mode];
    text.textContent = { welcome: 'Welcome', done: 'Thank you', between: mode === 'gratitude' ? '' : 'Breathe naturally' }[ph] ?? 'Waiting for everyone';
    sub.textContent = ph === 'waiting' && size > 1 ? `${count} of ${size} here` : '';
  }
  c.classList.toggle('quiet', solo && !text.textContent);
  $('promptStrip').hidden = !gratitudePhase || size === 1;   // 1-on-1 shows the prompt on Gigi's tile
  $('promptStrip').textContent = gratitudePhase ? st.prompt_text : '';

  const gigiOff = st.gigi === 'off';
  $('gigiTile').classList.toggle('off', gigiOff);
  $('gigiOff').hidden = !gigiOff;
  const mine = ph === 'turn' && st.speaker === identity;
  $('doneBtn').hidden = !mine;
  $('repeatBtn').hidden = !(mine && !gigiOff) || solo;   // solo: the bottom pills are Mic and I'm done
  $('leaveBtn').hidden = solo;
  $('leaveTop').hidden = !solo;                           // solo: Leave sits in the top bar, by the mode chip
  $('hostCtl').hidden = !amHost() || size === 1;   // 1-on-1: Gigi is the session, nothing to hand over
  $('camBtn').hidden = $('giraffeBtn').hidden = size === 1;   // nobody else to see you or receive a giraffe
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
  if (micBlocked && !mic) s = solo ? 'Microphone blocked. Allow it in the address bar, then tap Mic.' : 'Your microphone is blocked. Allow it in the address bar, then tap Mic.';
  else if (solo) s = '';   // solo: no status line, only the blocked-mic note
  else if (!gigiId) s = count < 2 && size > 1 ? 'Send the invite link to bring people in.' : 'Gigi is on her way…';
  else s = { waiting: count < 2 ? 'Send the invite link to bring people in.' : size > 2 ? (amHost() ? 'Tap Begin now when everyone is here.' : 'Waiting for the host to begin.') : 'Gigi is gathering you…',
    welcome: gigiOff ? '' : 'Gigi is welcoming you.', breath: 'Breathe with the light. Mics are resting.',
    between: gigiOff ? (amHost() ? 'Tap Next when you are ready.' : '') : '',
    waiting_return: `${firstName(st.speaker_name)} dropped off. Waiting a moment for them…` }[ph] ?? '';
  $('status').textContent = s;
  $('room').classList.toggle('micnote', solo && !!s);   // solo: the low words make room for the note
}

function tick() {
  if (st.phase === 'breath' && pacer && !run) $('breathCount').textContent = String(pacer.remaining() || '');
}

function drawHides(t) {
  requestAnimationFrame(drawHides);
  for (const h of hides.values()) h.draw(t);
  if (run) hud(run);   // solo breath: the words flip on the frame the bell sounds, not up to a timer tick later
  if (centerHide && st.phase !== 'breath') centerHide.draw(t);
  if (centerHide) centerHide.canvas.style.opacity = st.phase === 'breath' ? '0' : '1';
  if (pacer) pacer.v.style.opacity = st.phase === 'breath' && !(run && run.clips) ? '1' : '0';
}

function ensurePacer() {
  if (!pacer) {
    const bc = avatar.manifest && avatar.manifest['breath-cycle'];
    pacer = new Pacer($('center'), bc ? `gigi/${bc.video}${bc.v ? `?v=${bc.v}` : ''}` : undefined);
  }
  return pacer;
}

// ---------------------------------------------------------------- solo stage
// Solo: fetch the oasis and the walk-up's first frame while they type their name, so the room opens on them
function warmSolo() {
  if (warmed) return;
  warmed = true;
  avatar.fetchManifest().then((m) => {
    if (!m) { warmed = false; return; }
    for (const [a, p] of [[m.stage, 'image'], [m.walkup, 'poster']]) if (a && a[p]) avatar.setImg(new Image(), a[p], a.v);
  });
}

// The room becomes one full-screen stage on the oasis (no card, no page scroll); it opens with a short fade.
async function openStage() {
  await Promise.race([avatar.fetchManifest(), new Promise((ok) => setTimeout(ok, 1500))]);   // a stalled manifest can't keep the room shut (enter picks it up later)
  const img = stageImg();
  $('room').classList.add('solo');
  if (img) await Promise.race([img.decode().catch(() => {}), new Promise((ok) => setTimeout(ok, 800))]);   // open on the oasis, not bare sky
  for (const v of document.querySelectorAll('.gigi-badge video')) v.pause();   // the start page's badge is off screen now
  if (!stageObs && window.ResizeObserver) { stageObs = new ResizeObserver(() => layoutStage()); stageObs.observe($('room')); }
  else if (!stageObs) { stageObs = true; addEventListener('resize', layoutStage); }
}

// the oasis behind her (manifest.stage), set once; null when there's none (yet) or it's already set
function stageImg() {
  const sg = avatar.manifest && avatar.manifest.stage, img = $('stageImg');
  if (!sg || !sg.image || img.src) return null;
  avatar.setImg(img, sg.image, sg.v);
  return img;
}

// Gigi's square is bottom-anchored (her shawl runs off the bottom edge) and as big as the screen allows while
// at least 0.66 of it shows; the oasis image is drawn at the same scale with its square on hers, so the square
// lands exactly on the spot the videos show behind her (manifest.stage: image pixels).
function layoutStage() {
  const el = $('room'), sg = avatar.manifest && avatar.manifest.stage, vw = el.clientWidth, vh = el.clientHeight;
  if (!vw || !vh) return;
  const ok = !!(sg && Array.isArray(sg.sq) && sg.sq[2] > 0 && sg.w > 0 && sg.h > 0);
  el.classList.toggle('nostage', !ok);   // no stage yet: a plain full-screen cover, words low
  if (!ok) { el.classList.remove('sky'); return; }
  const px = (k, v) => el.style.setProperty(k, `${v.toFixed(2)}px`);
  // the spec's fit; then, only if the image wouldn't reach every edge at it (ultrawides), a little bigger until it
  // does, cropping at most 4% off the square's top (sky over her head), so no strip of fill shows at the sides
  const [x0, y0, s] = sg.sq, fit = Math.min(vh / s, vw / (0.66 * s));
  const cover = Math.max(vw / (2 * x0 + s), vw / (2 * (sg.w - x0) - s), vh / (y0 + s));
  const k = Math.max(fit, Math.min(cover, vh / (0.96 * s))), Q = s * k, L = (vw - Q) / 2, T = vh - Q;
  px('--sq', Q); px('--sq-l', L); px('--sq-t', T);
  px('--img-l', L - x0 * k); px('--img-t', T - y0 * k); px('--img-w', sg.w * k); px('--img-h', sg.h * k);
  // portrait: the words sit in the sky above her head (top bar to T + 4% of Q) when there's room for them;
  // otherwise (landscape) low over her shawl, below her face (her head is the top ~45% of the square)
  const bar = $('roomHead').getBoundingClientRect().bottom - el.getBoundingClientRect().top + 8, skyEnd = T + 0.04 * Q;
  const sky = skyEnd - bar >= 120, sideL = L + 0.8 * Q;   // her body fills the middle ~60% of the square
  el.classList.toggle('sky', sky);
  // wide screens: the words and the breath count sit in the open oasis to her right, never over her or her lights
  el.classList.toggle('side', !sky && vw - sideL - 24 >= 300);
  px('--sky-top', bar); px('--sky-bottom', vh - skyEnd); px('--face-bottom', T + 0.5 * Q); px('--side-l', sideL);
}

// Solo: tell the agent she has arrived (the walk-up is over), so her first line starts at once
function sendReady() {
  if (readySent || !room || room.state !== 'connected') return;
  readySent = true;
  room.localParticipant.setAttributes({ ready: '1' }).catch((e) => { console.warn('ready', e); readyRpc = true; readyByRpc(); });
}

// a room pass without canUpdateOwnMetadata can't set the attribute: tell Gigi directly instead (an RPC needs only
// canPublishData), as soon as she's here
function readyByRpc() {
  if (!readyRpc || !gigiId) return;
  readyRpc = false;
  rpc('ready');
}

// solo: the prompts load once she's arrived (not during the walk-up and the opener), and never for Breath
function soloPrompts() {
  if (!arrived || mode === 'breath' || !st.prompt_clips) return;
  // in the order she'll say them: prompt 1 and what follows it, then the later prompts
  try { const ps = JSON.parse(st.prompt_clips); avatar.preload([...ps.slice(0, 1), 'ready', 'lead-next', 'ack-2', 'ack-5', 'ack-7', ...ps.slice(1)]); } catch { /* ignore */ }
}

// ---------------------------------------------------------------- solo breath
// The agent publishes a run once; from the moment it arrives the page plays it (avatar.breathRun) and keeps the
// HUD and the bells on that same local clock. No breath-<pattern> render yet: the pacer breathes instead.
function startRun(b) {
  const id = String(b.run);
  if (id === lastRun) return;   // the same run again (another attribute changed)
  stopRun();
  lastRun = id;
  const t0 = performance.now();
  run = { id, b, t0, clips: avatar.breathRun(b, t0), marks: breathMarks(b), next: 0, at: '', seq: 0, bus: null, hud: '' };
  if (audioCtx) { run.bus = audioCtx.createGain(); run.bus.gain.value = BELL_GAIN; run.bus.connect(audioCtx.destination); }
  run.timer = setInterval(runTick, 100);
  runTick();
}

function stopRun() {
  if (!run) return;
  clearInterval(run.timer);
  try { if (run.bus) run.bus.disconnect(); } catch { /* gone */ }   // silences any bell already scheduled
  if (run.clips) avatar.stopBreath();
  else avatar.show(avatar.idle);   // the pacer's run: she comes back breathing
  run = null;
}

// label, countdown and round off the run's clock; drawn every frame (drawHides) and on every tick
function hud(r, now = performance.now()) {
  const s = breathAt(r.b, now - r.t0), on = s.part === 'cycle';
  const txt = on ? [PHASE_LABEL[s.kind] || '', String(Math.max(1, Math.min(Math.floor(s.dur), Math.ceil(s.dur - s.into)))),
    `Round ${s.round} of ${s.rounds}`] : ['', '', ''];
  if (txt.join('|') !== r.hud) { r.hud = txt.join('|'); [$('breathLabel').textContent, $('breathCount').textContent, $('breathRound').textContent] = txt; }
  return s;
}

function runTick() {
  const r = run, now = performance.now(), el = (now - r.t0) / 1000, s = hud(r, now), on = s.part === 'cycle';
  if (!r.clips && on && `${s.cycle}:${s.i}` !== r.at) {   // fallback: feed the pacer the phases it used to get from the agent
    r.at = `${s.cycle}:${s.i}`;
    ensurePacer().set({ kind: s.kind, dur: s.dur, into: s.into, seq: ++r.seq });
    if (avatar.idle && !avatar.playing) avatar.idle.pause();   // her square has faded out under the pacer: nothing plays there
  }
  // bells, scheduled up to 1.2 s ahead on the AudioContext clock: exact, and a throttled timer can't make one late
  for (; r.bus && r.next < r.marks.length && r.marks[r.next] - el < 1.2; r.next++) {
    const ahead = r.marks[r.next] - el;
    if (ahead > -0.15) bell(Math.max(audioCtx.currentTime, audioCtx.currentTime + ahead - (audioCtx.outputLatency || 0)), r.bus);
  }
}

// a soft bell at the start of every phase: 528 Hz with a 792 Hz partial, a quick strike, ~1.2 s exponential fade
function bell(at, bus) {
  const ctx = audioCtx, g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(1, at + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 1.2);
  g.connect(bus);
  for (const [f, a] of [[528, 0.7], [792, 0.3]]) {
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.frequency.value = f;
    og.gain.value = a;
    o.connect(og).connect(g);
    o.onended = () => { try { og.disconnect(); g.disconnect(); } catch { /* gone */ } };
    o.start(at);
    o.stop(at + 1.25);
  }
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
$('leaveBtn').onclick = $('leaveTop').onclick = () => showEnd('You left the room.');
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
