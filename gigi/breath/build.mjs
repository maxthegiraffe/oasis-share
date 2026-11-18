// Gigi's breathing tracks for the web (grateful.gg/gigi and app.grateful.gg/gigi), 2026-11-18: "her breath voice is too
// fierce (especially the 1) its not calming or relaxing". The page had been playing the phone-call tracks (16 kHz, 32 kbps,
// each count its own clip, so a lone "One." came out loud and punchy, 6 dB over every other word). These are made for
// listening on headphones:
//  - 44.1 kHz, slower and steadier (stability .85, style 0, speed .8, no speaker boost), the call builder's calm coherent
//    settings (gigi repo scripts/build_breath.mjs) for every pattern;
//  - every count cut from one calm spoken run ("one, two, three, four."), so the pitch falls like a sentence instead of
//    restarting on each word; coherent counts down on the out-breath, as on calls;
//  - every clip faded and brought to the same level (counts a little under the cues), then the whole track to -20 LUFS;
//  - the exact time each phase starts is written to web/phases.json for the pacer (src/lib/gigiLive/breathCues.js in oasis,
//    gigi/breathcues.js here: keep both).
// Run (needs ffmpeg and an ElevenLabs key, ELEVENLABS_API_KEY, or a proxy that adds it):
//   node gigi/breath/build.mjs [box|coherent|478|sigh ...]   -> gigi/breath/web/<id>.mp3 + web/phases.json
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(HERE, 'web');
const VOICE = 'd0NpsluCMIhcxftWaNBW';   // Gigi (the call agent's voice, the same as the old tracks)
const SETTINGS = { stability: 0.85, similarity_boost: 0.8, style: 0, speed: 0.8, use_speaker_boost: false };
const KEY = process.env.ELEVENLABS_API_KEY || 'set-by-proxy';
const NUMS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
const LEVEL = { line: -21, count: -23 };   // mean volume of each clip, dB

const OUTRO = "Good. Let your breath return to normal. Well done. I'm right here.";
const PATTERNS = {
  box: {
    sides: [['in', 4], ['hold', 4], ['out', 4], ['hold', 4]], rounds: 4, lead: 1.4, beat: 1.2,
    intro: "Box breathing. Every side of the box is four slow counts: in, hold, out, hold. I'll count with you the whole way. Four rounds. Let's begin.",
  },
  coherent: {
    sides: [['in', 5], ['out', 5]], rounds: 6, lead: 1.5, beat: 1.1, down: true,
    intro: "Slow, soft breathing. Five counts in, and five counts out, through the nose. I'll count up as you breathe in, and back down as you breathe out. Six rounds. Let's begin.",
  },
  478: {
    sides: [['in', 4], ['hold', 7], ['out', 8]], rounds: 4, lead: 1.3, beat: 1.0,
    intro: 'Four, seven, eight breathing. Rest the tip of your tongue just behind your top front teeth. First, let all of your breath out, through your mouth.',
    clear: 4.5,   // seconds for that first breath out, then "Let's begin."
  },
  sigh: {
    rounds: 4, sigh: true,
    intro: 'The physiological sigh. Two breaths in through the nose, the second one topping up the first. Then one long, slow breath out, through the mouth.',
    outro: "Good. Notice how you feel. I'm right here.",
  },
};
const LINES = { in: 'Breathe in.', hold: 'Hold.', out: 'Breathe out.', last: 'Last round.', begin: "Let's begin.", more: 'And a little more.', slow: 'Now let it all go, slowly.' };

const TMP = fs.mkdtempSync(path.join(process.env.BREATH_TMP || os.tmpdir(), 'breath-'));
const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());
const meanDb = (f) => Number(/mean_volume: (-?[\d.]+) dB/.exec(spawnSync('ffmpeg', ['-hide_banner', '-i', f, '-af', 'volumedetect', '-f', 'null', '-']).stderr.toString())[1]);

async function ttsRaw(key, text) {
  const raw = path.join(TMP, `${key}.raw.mp3`);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: SETTINGS }),
    });
    if (r.ok) { fs.writeFileSync(raw, Buffer.from(await r.arrayBuffer())); return raw; }
    const why = `${r.status} ${(await r.text()).slice(0, 200)}`;
    if (r.status < 500 && r.status !== 429) throw new Error(`tts ${key}: ${why}`);
    console.log(`tts ${key}: ${why}, again`);
    await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
  }
  throw new Error(`tts ${key}: gave up`);
}

// Trim the silence on both ends (a clip's onset is the moment its word starts), fade, and set its level.
function finish(src, key, level) {
  const trimmed = path.join(TMP, `${key}.trim.wav`);
  ff(['-i', src, '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse', '-ar', '44100', '-ac', '1', trimmed]);
  const d = dur(trimmed);
  const gain = level - meanDb(trimmed);
  const file = path.join(TMP, `${key}.wav`);
  ff(['-i', trimmed, '-af', `afade=t=in:d=0.03,afade=t=out:st=${Math.max(0, d - 0.2).toFixed(3)}:d=0.2,volume=${gain.toFixed(2)}dB`, file]);
  return { file, dur: d };
}
async function line(key, text) { return finish(await ttsRaw(key, text), key, LEVEL.line); }

// One calm spoken run of counts, cut at its pauses into one clip per word. Retries until it splits into that many words.
async function run(key, words) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const raw = await ttsRaw(`${key}${attempt}`, `${words.join(', <break time="0.8s" /> ')}.`);
    const log = spawnSync('ffmpeg', ['-hide_banner', '-i', raw, '-af', 'silencedetect=noise=-40dB:d=0.2', '-f', 'null', '-']).stderr.toString();
    const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => +m[1]);
    const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => +m[1]);
    const total = dur(raw);
    const spans = [];
    let cur = 0;
    starts.map((s, i) => [s, ends[i] ?? total]).sort((a, b) => a[0] - b[0]).forEach(([s, e]) => { if (s - cur > 0.12) spans.push([cur, s]); cur = e; });
    if (total - cur > 0.12) spans.push([cur, total]);
    if (spans.length !== words.length) { console.log(`${key}: ${spans.length} words heard, want ${words.length}, again`); continue; }
    const out = {};
    spans.forEach(([s, e], i) => {
      const cut = path.join(TMP, `${key}-${words[i]}.cut.wav`);
      ff(['-ss', Math.max(0, s - 0.03).toFixed(3), '-to', (e + 0.06).toFixed(3), '-i', raw, cut]);
      out[words[i]] = finish(cut, `${key}-${words[i]}`, LEVEL.count);
    });
    return out;
  }
  throw new Error(`${key}: never split into ${words.length} words`);
}

async function build(id) {
  const P = PATTERNS[id];
  const clips = {};
  const say = async (k, text) => { clips[k] ??= await line(`${id}-${k}`, text); return clips[k]; };
  await say('intro', P.intro);
  await say('outro', P.outro || OUTRO);
  const place = [];   // [clip key, start s]
  const phases = [];  // [start s, kind, to?]
  const at = (k, s) => place.push([k, s]);
  let t = 0.6;
  at('intro', t); t += clips.intro.dur;

  if (P.sigh) {
    for (const k of ['in', 'more', 'slow']) await say(k, LINES[k]);
    t += 1.6;
    for (let r = 0; r < P.rounds; r += 1) {
      phases.push([t, 'in', 0.72]); at('in', t); t += 2.4;
      phases.push([t, 'in']); at('more', t); t += 2.0;
      phases.push([t, 'out']); at('slow', t); t += 8.5;
      if (r < P.rounds - 1) { phases.push([t, 'rest']); t += 2.0; }
    }
  } else {
    const most = Math.max(...P.sides.map(([, n]) => n));
    const nums = NUMS.slice(0, most);
    const up = await run(`${id}-up`, nums);
    const down = P.down ? await run(`${id}-down`, [...nums].reverse()) : null;
    for (const k of new Set(P.sides.map(([s]) => s))) await say(k, LINES[k]);
    await say('last', LINES.last);
    if (P.clear) {
      t += 0.6; phases.push([t, 'out']); t += P.clear;
      await say('begin', LINES.begin);
      phases.push([t, 'rest']); at('begin', t); t += clips.begin.dur + 1.4;
    } else t += 1.4;
    for (let r = 0; r < P.rounds; r += 1) {
      if (r === P.rounds - 1) { phases.push([t, 'rest']); at('last', t); t += clips.last.dur + 1.0; }
      for (const [side, n] of P.sides) {
        phases.push([t, side]); at(side, t);
        const seq = P.down && side === 'out' ? [...nums.slice(0, n)].reverse().map((w) => ['down', w]) : nums.slice(0, n).map((w) => ['up', w]);
        seq.forEach(([dir, w], i) => { const k = `${dir}-${w}`; clips[k] = (dir === 'down' ? down : up)[w]; at(k, t + P.lead + i * P.beat); });
        t += P.lead + n * P.beat;
      }
    }
  }
  t += 0.6;
  const end = t;
  at('outro', t); t += clips.outro.dur + 1.2;

  // Mix: every clip at its time, a gentle low cut and a softer top, then -20 LUFS, peaks under -3 dB.
  const args = ['-f', 'lavfi', '-t', t.toFixed(2), '-i', 'anullsrc=r=44100:cl=mono'];
  place.forEach(([k]) => args.push('-i', clips[k].file));
  const fc = `${place.map(([, s], i) => `[${i + 1}]adelay=${Math.round(s * 1000)}:all=1[a${i}]`).join(';')};`
    + `[0]${place.map((_, i) => `[a${i}]`).join('')}amix=inputs=${place.length + 1}:normalize=0:duration=first,`
    + 'highpass=f=70,highshelf=f=5500:g=-3,loudnorm=I=-20:TP=-3:LRA=7,aresample=44100[m]';
  const file = path.join(OUT, `${id}.mp3`);
  ff([...args, '-filter_complex', fc, '-map', '[m]', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '128k', file]);
  const r2 = (x) => Math.round(x * 100) / 100;
  return { id, file, length: r2(dur(file)), end: r2(end), rounds: P.rounds, phases: phases.map(([s, k, to]) => (to === undefined ? [r2(s), k] : [r2(s), k, to])) };
}

fs.mkdirSync(OUT, { recursive: true });
const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PATTERNS);
const pj = path.join(OUT, 'phases.json');
const all = fs.existsSync(pj) ? JSON.parse(fs.readFileSync(pj, 'utf8')) : {};
for (const id of ids) {
  if (!PATTERNS[id]) throw new Error(`pattern: ${Object.keys(PATTERNS).join(' | ')}`);
  const b = await build(id);
  all[id] = { rounds: b.rounds, end: b.end, length: b.length, phases: b.phases };
  console.log(`${id}: ${b.file}, ${b.length} s, ${b.phases.length} phases`);
}
fs.writeFileSync(pj, `${JSON.stringify(all, null, 1)}\n`);
console.log(`wrote ${pj}`);
