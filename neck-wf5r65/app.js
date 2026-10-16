import { Room, RoomEvent, Track, ParticipantKind } from 'https://cdn.jsdelivr.net/npm/livekit-client@2.22.3/+esm';
import { GigiAvatar } from './avatar.js';

const $ = (id) => document.getElementById(id);
const TOKEN_URL = 'https://axysrawypndwfzruqkdh.supabase.co/functions/v1/neck-token';
const params = new URLSearchParams(location.search);
const passcode = params.get('k') || '';
let roomCode = params.get('r') || '';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const identity = store.get('nn-id') || (() => { const id = 'g-' + crypto.randomUUID(); store.set('nn-id', id); return id; })();
$('name').value = store.get('nn-name') || '';

const gigi = new GigiAvatar($('gigi'));
gigi.load();
window.gigi = gigi;  // prototype: handy for poking at her from the console

let room = null;
let audioCtx = null;
let gigiId = null;
let state = {};
let turnStart = 0;
let shownTurn = '';
let micBlocked = false;

const status = (t) => { $('status').textContent = t; };
const firstName = (n) => (n || '').trim().split(/\s+/)[0] || 'friend';
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
const inviteUrl = () => `${location.origin}${location.pathname}?k=${encodeURIComponent(passcode)}&r=${roomCode}`;

if (!passcode) {
  $('go').disabled = true;
  $('joinError').hidden = false;
  $('joinError').textContent = 'This link is missing its passcode. Ask for the full invite link.';
}
$('go').textContent = roomCode ? 'Join the practice' : 'Begin';
status(roomCode ? 'Your partner is waiting for you.' : '');

$('go').onclick = async () => {
  const name = $('name').value.trim();
  if (!name) { $('name').focus(); return; }
  store.set('nn-name', name);
  $('go').disabled = true;
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  await audioCtx.resume().catch(() => {});
  if (!roomCode) {
    roomCode = newCode();
    history.replaceState(null, '', `?k=${encodeURIComponent(passcode)}&r=${roomCode}`);
  }
  try {
    await connect(name);
  } catch (e) {
    console.error(e);
    $('go').disabled = false;
    $('joinError').hidden = false;
    $('joinError').textContent = /Permission|NotAllowed/i.test(String(e))
      ? 'Your browser blocked the microphone. Allow it in the address bar, then try again.'
      : 'Could not join. Check your connection and try again.';
  }
};

async function connect(name) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ k: passcode, room: roomCode, name, identity }),
  });
  if (!res.ok) throw new Error('token ' + res.status + ' ' + (await res.text()));
  const { token, url } = await res.json();

  room = new Room({
    adaptiveStream: true,
    dynacast: true,
    audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  room
    .on(RoomEvent.ParticipantConnected, render)
    .on(RoomEvent.ParticipantDisconnected, (p) => { if (p.identity === gigiId) { gigiId = null; gigi.detach(); } render(); })
    .on(RoomEvent.TrackSubscribed, onTrack)
    .on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((el) => el.remove()))
    .on(RoomEvent.LocalTrackPublished, render)
    .on(RoomEvent.LocalTrackUnpublished, render)
    .on(RoomEvent.TrackMuted, render)
    .on(RoomEvent.TrackUnmuted, render)
    .on(RoomEvent.ParticipantAttributesChanged, (changed, p) => { if (isGigi(p)) onState(p.attributes); })
    .on(RoomEvent.ActiveSpeakersChanged, render)
    .on(RoomEvent.AudioPlaybackStatusChanged, () => { $('unlock').hidden = room.canPlaybackAudio; })
    .on(RoomEvent.Disconnected, () => showEnd('You left the practice.'));

  await room.connect(url, token);
  try {
    await room.localParticipant.setMicrophoneEnabled(true);
  } catch (e) {
    console.warn('mic blocked', e);
    micBlocked = true;  // stay in the call; the Mic button retries once they allow it
  }
  $('join').hidden = true;
  $('call').hidden = false;
  $('inviteLink').value = inviteUrl();
  $('unlock').hidden = room.canPlaybackAudio;
  for (const p of room.remoteParticipants.values()) {
    if (isGigi(p)) onState(p.attributes);
    for (const pub of p.trackPublications.values()) if (pub.track) onTrack(pub.track, pub, p);
  }
  render();
  setInterval(tickTurn, 250);
  setInterval(() => gigi.setListening(sharerLevel()), 100);
}

const isGigi = (p) => p && (p.kind === ParticipantKind.AGENT || p.isAgent);
const partner = () => room && [...room.remoteParticipants.values()].find((p) => !isGigi(p));

function onTrack(track, pub, p) {
  if (track.kind === Track.Kind.Audio) {
    const el = track.attach();
    $('audioSink').appendChild(el);
    if (isGigi(p)) {
      gigiId = p.identity;
      gigi.attach(track.mediaStreamTrack, audioCtx);
    }
  }
  render();
}

let lastClip = '';
function onState(attrs) {
  state = { ...attrs };
  if (state.clip && state.clip !== lastClip) { lastClip = state.clip; gigi.arm(state.clip); }
  if (state.prompt_clips) { try { gigi.preload(JSON.parse(state.prompt_clips).concat(['closing', 'goodbye', 'goodbye-solo'])); } catch { /* ignore */ } }
  const turnId = state.phase === 'turn' ? state.turn_id : '';
  if (turnId && turnId !== shownTurn) { shownTurn = turnId; turnStart = performance.now(); }
  if (state.phase === 'done') setTimeout(() => showEnd(), 1500);
  render();
}

function sharerLevel() {
  if (!room || state.phase !== 'turn') return 0;
  const p = state.speaker === identity ? room.localParticipant : room.remoteParticipants.get(state.speaker);
  return p ? p.audioLevel * 3 : 0;
}

function tile(el, p, isMe) {
  const name = p ? firstName(p.name || (isMe ? $('name').value : '')) : '';
  el.classList.toggle('empty', !p);
  el.querySelector('figcaption').textContent = p ? (isMe ? `${name} (you)` : name) : 'Waiting…';
  el.querySelector('.initial').textContent = p ? name.slice(0, 1).toUpperCase() : '?';
  el.classList.toggle('speaking', !!p && p.isSpeaking);
  el.classList.toggle('sharing', !!p && state.phase === 'turn' && state.speaker === p.identity);
  const cam = p && p.getTrackPublication(Track.Source.Camera);
  const video = el.querySelector('video');
  const on = !!(cam && cam.track && !cam.isMuted);
  el.classList.toggle('video', on);
  if (on && video.dataset.sid !== cam.trackSid) { cam.track.attach(video); video.dataset.sid = cam.trackSid; }
  if (!on) video.dataset.sid = '';
}

function render() {
  if (!room) return;
  const them = partner();
  tile($('tileMe'), room.localParticipant, true);
  tile($('tileThem'), them, false);
  $('invite').hidden = !!them || !!state.phase && state.phase !== 'waiting';

  const ph = state.phase;
  const count = Number(state.prompt_count || 5);
  const idx = Number(state.prompt_index || 0);
  const showPrompt = ['prompt', 'turn', 'between', 'waiting_return', 'closing'].includes(ph) && state.prompt_text;
  $('promptCard').hidden = !showPrompt;
  if (showPrompt) {
    $('promptMeta').textContent = ph === 'closing' ? 'Closing' : `Prompt ${idx + 1} of ${count}${state.rung ? ' · ' + state.rung : ''}`;
    $('promptText').textContent = state.prompt_text;
  }
  $('turn').hidden = ph !== 'turn';
  const mine = ph === 'turn' && state.speaker === identity;
  $('done').hidden = !mine;
  $('turnText').textContent = mine ? 'Your turn. Take your time.' : `${firstName(state.speaker_name)} is sharing. Just listen.`;

  if (!gigiId && !them) status('Waiting for your partner to join.');
  else if (!gigiId) status('Gigi is on her way…');
  else status({
    waiting: them ? 'Gigi is gathering you both…' : 'Waiting for your partner to join.',
    welcome: 'Gigi is welcoming you.',
    prompt: 'Gigi is reading the prompt.',
    turn: '',
    between: 'Gigi is reflecting…',
    waiting_return: `${firstName(state.speaker_name)} dropped off. Waiting a moment for them…`,
    closing: 'One last round.',
    done: 'Thank you.',
  }[ph] ?? '');

  const mic = room.localParticipant.isMicrophoneEnabled;
  if (micBlocked && !mic) status('Your microphone is blocked. Allow it in the address bar, then tap Mic.');
  $('mic').textContent = mic ? 'Mic on' : 'Mic off';
  $('mic').className = 'ctl ' + (mic ? 'on' : 'off');
  const cam = room.localParticipant.isCameraEnabled;
  $('cam').textContent = cam ? 'Camera on' : 'Camera off';
  $('cam').classList.toggle('on', cam);
  $('repeat').hidden = !(ph === 'turn' || ph === 'prompt');
}

function tickTurn() {
  if (state.phase !== 'turn') return;
  const soft = Number(state.soft_ms || 90000);
  const p = Math.min(1, (performance.now() - turnStart) / soft);
  $('ringFill').style.strokeDashoffset = String(119.4 * (1 - p));
  $('turn').classList.toggle('over', p >= 1);
}

async function rpc(method) {
  if (!gigiId) return;
  try { await room.localParticipant.performRpc({ destinationIdentity: gigiId, method, payload: '' }); }
  catch (e) { console.warn('rpc', method, e); }
}

$('done').onclick = () => { $('done').hidden = true; rpc('done'); };
$('repeat').onclick = () => rpc('repeat');
$('mic').onclick = async () => {
  try {
    await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled);
    micBlocked = false;
  } catch (e) { console.warn('mic', e); micBlocked = true; }
  render();
};
$('cam').onclick = async () => {
  try { await room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled); } catch (e) { console.warn(e); }
  render();
};
$('leave').onclick = () => room && room.disconnect();
$('unlock').onclick = async () => { await audioCtx?.resume(); await room?.startAudio(); $('unlock').hidden = room?.canPlaybackAudio; };
$('copy').onclick = async () => {
  const link = inviteUrl();
  if (navigator.share && /Mobi/i.test(navigator.userAgent)) {
    try { await navigator.share({ title: 'Neck and Neck', text: 'Practice gratitude with me, held by Gigi', url: link }); return; } catch { /* fall through to copy */ }
  }
  try { await navigator.clipboard.writeText(link); $('copy').textContent = 'Copied'; }
  catch { $('inviteLink').select(); document.execCommand('copy'); $('copy').textContent = 'Copied'; }
  setTimeout(() => { $('copy').textContent = 'Copy'; }, 1800);
};
$('again').onclick = () => { location.href = `${location.pathname}?k=${encodeURIComponent(passcode)}`; };

function showEnd(text) {
  if (!$('end').hidden) return;
  $('call').hidden = true;
  $('end').hidden = false;
  status('');
  const them = partner();
  $('endText').textContent = text || (them ? `You and ${firstName(them.name)} climbed the ladder together.` : 'Your practice is complete.');
  if (room && room.state !== 'disconnected') room.disconnect();
}
