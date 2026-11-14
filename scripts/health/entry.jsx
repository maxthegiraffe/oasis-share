// grateful.gg/health: the hero, in four versions under test, and the animated cards below it.
// Built to health/app.js by scripts/health/build.mjs.
//
// THE TEST (Max, 2026-11-13: "let's test 4 different landing pages and see what gets the most traction"): test "health-lp",
// a browser gets one version at random and keeps it; ?v=a|b|c|d forces one, ?abq=1 once mutes a browser (our own checks).
//   a  The lab: pick a name, watch its animation, read about it, Shop <name> or Ask Gigi
//   b  Text Gigi: one button, Text Gigi PEPTIDES (she asks one question and sends their own page)
//   c  The question: "What do you want most right now?", then the ones to ask a physician about, each with its shop page
//   d  The shelf: every product with its photo, each straight to its own shop page
// Steps go to the Oasis edge (app.grateful.gg/__f, the same counter as the Safari landing test; never a name, email or
// phone): view, engage (first tap in the hero), scroll (reached the cards), stay30 (30 seconds on the page), shop (a tap
// on a product's shop page, detail = the product), gigi (a tap on a Text Gigi link).
// Read with agentic-business-os-pkg/projects/grateful-health/tools/health_lp_report.py.
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PeptideExplainer, PeptideStage, PX_CSS } from './PeptideExplainer.jsx';
import w from './words.json';

const SHOP = 'https://health.grateful.gg/protocols/proto-gratefulhealth-';
// Gigi answers "PEPTIDES: <name>" from anyone with what it is, how ordering works and its shop page, and the word
// PEPTIDES alone with her one question (gigi-whatsapp peptide_match.private.js). Keep the names here matching its PRODUCTS.
const GIGI = 'sms:+15164197249?&body=';
// [key, name, what it is, the shop's name for it, the shop page, its photo, other forms: [label, shop page]]
const PEPTIDES = [
  ['bpc157', 'BPC-157', '15 amino acids', 'BPC-157', 'bpc-157-rd8x', 'bpc-157'],
  ['tb500', 'TB-500', 'From thymosin beta-4, 43 amino acids', 'TB-500', 'tb-500-rahc', 'tb-500'],
  ['glp1', 'GLP-1', 'A gut hormone, copied', 'Tirzepatide', 'tirzepatide-rrec', 'tirzepatide'],
  ['nad', 'NAD+', 'Two nucleotides, a coenzyme', 'NAD+', 'nad-injection-rtle', 'nad', [['Nasal spray', 'nad-nasal-spray-roi7'], ['With glutathione', 'nad-glutathione-stack-rb6q']]],
  ['sermorelin', 'Sermorelin', '29 amino acids, one helix', 'Sermorelin', 'sermorelin-rsb2', 'sermorelin', [['Nasal spray', 'sermorelin-nasal-spray-rl7z']]],
  ['dsip', 'DSIP', '9 amino acids', 'DSIP', 'dsip-o1au', 'dsip'],
  ['epithalon', 'Epithalon', '4 amino acids', 'Epithalon', 'epithalon-o0mf', 'epithalon'],
  ['pt141', 'PT-141', 'A ring of 7 amino acids', 'PT-141', 'pt-141-bremelanotide-rkmz', 'bremelanotide', [['Nasal spray', 'pt-141-nasal-spray-rjpy']]],
  ['glutathione', 'Glutathione', '3 amino acids, an antioxidant', 'Glutathione', 'glutathione-injection-rn6m', 'glutathione', [['Nasal spray', 'glutathione-nasal-spray-ridl'], ['With NAD+', 'nad-glutathione-stack-rb6q']]],
  ['mb', 'Methylene Blue', 'A dye medicine, not a peptide', 'Methylene Blue', 'methylene-blue-rpw0', 'methylene-blue'],
  ['b12', 'Vitamin B12', 'A vitamin built around cobalt', 'Vitamin B12', 'vitamin-b12-injection-rgl6', 'b12'],
  ['lipoc', 'Lipo-C', 'Nutrients the body uses to process fat', 'Lipo-C', 'lipo-c-injection-rf4j', 'lipo-c'],
];
const BY_KEY = Object.fromEntries(PEPTIDES.map((p) => [p[0], p]));
const BY_SLUG = Object.fromEntries(PEPTIDES.flatMap((p) => [[p[4], p[0]], ...(p[6] || []).map(([, s]) => [s, p[0]])]));

// ---- the test: which version, and the steps ----
const TEST = 'health-lp';
const VERSIONS = ['a', 'b', 'c', 'd'];
const BEACON = 'https://app.grateful.gg/__f';
const store = {
  get(k) { try { return window.localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { window.localStorage.setItem(k, v); } catch { /* private mode: this visit only */ } },
};
function pickVersion() {
  let v = '';
  try { v = (new URLSearchParams(window.location.search).get('v') || '').toLowerCase(); } catch { v = ''; }
  if (!VERSIONS.includes(v)) v = store.get(`ab:${TEST}`) || '';
  if (!VERSIONS.includes(v)) v = VERSIONS[Math.floor(Math.random() * VERSIONS.length)];
  store.set(`ab:${TEST}`, v);
  return v;
}
function visitorId() {
  let id = store.get('ab:id') || '';
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(id)) {
    const a = new Uint8Array(12);
    try { crypto.getRandomValues(a); } catch { for (let i = 0; i < a.length; i += 1) a[i] = Math.floor(Math.random() * 256); }
    id = Array.from(a, (b) => (b % 36).toString(36)).join('');
    store.set('ab:id', id);
  }
  return id;
}
function quiet() {
  try {
    if (/[?&]abq=1\b/.test(window.location.search)) store.set('ab:quiet', '1');
    if (store.get('ab:quiet') === '1') return true;
    const h = window.location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost');
  } catch { return true; }
}
const V = pickVersion();
const QUIET = quiet();
const sent = new Set();
function track(step, detail = '') {
  const x = String(detail || '').replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 64);
  const tag = `${step}:${x}`;
  if (sent.has(tag)) return;
  sent.add(tag);
  const body = JSON.stringify({ t: TEST, v: V, s: step, a: visitorId(), ...(x ? { x } : {}), p: '/health/' });
  (window.__healthSteps = window.__healthSteps || []).push(`${V}:${tag}`);   // for our own checks
  if (QUIET) return;
  try { if (navigator.sendBeacon && navigator.sendBeacon(BEACON, new Blob([body], { type: 'text/plain' }))) return; } catch { /* fall through */ }
  try { fetch(BEACON, { method: 'POST', body, keepalive: true, mode: 'no-cors', headers: { 'Content-Type': 'text/plain' } }).catch(() => {}); } catch { /* best effort */ }
}
const engage = (what) => { track('engage'); if (what) track('pick', what); };

// ---- a: the lab (Max: "the more about should appear in the hero section and not need scrolling down - as well as the
// buy button", "or ask gigi"). Until someone picks, it moves on to the next one after each loop, unless motion is reduced.
const TABS = [['what', 'lab_what'], ['benefits', 'x_benefits'], ['risks', 'x_risks'], ['dose', 'x_dose'], ['stack', 'x_stack']];
function Lab() {
  const [i, setI] = useState(0);
  const [tab, setTab] = useState('what');
  const picked = useRef(false);
  const row = useRef(null);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const id = setInterval(() => { if (!picked.current && !document.hidden) setI((x) => (x + 1) % PEPTIDES.length); }, 12000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const el = row.current, chip = el?.children[i];
    if (chip && el.scrollWidth > el.clientWidth) el.scrollTo({ left: chip.offsetLeft - (el.clientWidth - chip.offsetWidth) / 2, behavior: 'smooth' });
  }, [i]);
  const [k, name, cap, shopName, slug] = PEPTIDES[i];
  const pick = (fn, what) => { picked.current = true; engage(what); fn(); };
  return (
    <>
      <div className="lab-pick">
        <p className="lab-hint">{w.lab_hint}</p>
        <div className="lab-chips" role="tablist" aria-label={w.lab_hint} ref={row}>
          {PEPTIDES.map(([pk, pn], j) => (
            <button key={pk} type="button" role="tab" aria-selected={j === i} onClick={() => pick(() => setI(j), pk)}>{pn}</button>
          ))}
        </div>
        <PeptideStage key={k} k={k} name={name} w={w} />
      </div>
      <div className="lab-info">
        <p className="lab-name"><b>{name}</b><small>{cap}</small></p>
        <div className="lab-tabs" role="tablist" aria-label={name}>
          {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => pick(() => setTab(id))}>{w[label]}</button>)}
        </div>
        <p className="lab-text" role="tabpanel" key={k + tab}>{tab === 'what' ? w[`pep_${k}`] : w[`x_${k}_${tab}`]}</p>
        <div className="lab-go">
          <a className="btn" href={SHOP + slug}>{w.lab_buy} {shopName}<span aria-hidden="true"> →</span></a>
          <a className="btn alt" href={GIGI + encodeURIComponent(`PEPTIDES: ${name}`)}>{w.lab_gigi}</a>
        </div>
      </div>
    </>
  );
}

// ---- b: Text Gigi. One button; she asks her one question and sends their own page.
function TextGigi() {
  return (
    <div className="tg">
      <img className="tg-mark" src="mark.webp" alt="" width="640" height="640" />
      <a className="btn tg-btn" href={`${GIGI}PEPTIDES`}>Text Gigi <em>PEPTIDES</em></a>
      <p className="tg-line">{w.tg_line}</p>
      <p className="tg-num">{w.tg_or} <a href={`${GIGI}PEPTIDES`}>(516) 419-7249</a></p>
      <a className="more" href="#learn">{w.tg_more} ↓</a>
    </div>
  );
}

// ---- c: the question. The same goals Gigi asks by text (gigi-whatsapp peptide_match GOALS), then up to three of the shop's
// products to ask a physician about, each with its own shop page. The first names per goal are the Oasis /peptides page's own
// matching (oasis src/lib/peptideMatch.js WEIGHTS, minus GHK-Cu, which the shop doesn't carry); the lighter ones come from
// each card's own "studied for" line on this page.
const GOALS = [
  ['recover', 'Recover faster', { tb500: 3, bpc157: 2, sermorelin: 1 }],
  ['joints', 'Joints and old injuries', { bpc157: 3, tb500: 2 }],
  ['weight', 'Weight and metabolism', { glp1: 3, lipoc: 1.5, sermorelin: 1 }],
  ['energy', 'Energy and focus', { nad: 3, mb: 1.5, b12: 1.2, sermorelin: 1 }],
  ['sleep', 'Deeper sleep', { sermorelin: 3, dsip: 2 }],
  ['longevity', 'Healthy aging', { nad: 2, epithalon: 1.5, glutathione: 1.2, sermorelin: 1 }],
];
function matchGoals(goals) {
  const score = {};
  for (const g of goals) for (const [k, n] of Object.entries((GOALS.find(([key]) => key === g) || [])[2] || {})) score[k] = (score[k] || 0) + n;
  return PEPTIDES.map((p, i) => [p, score[p[0]] || 0, i]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1] || a[2] - b[2]).slice(0, 3).map(([p]) => p);
}
function Quiz() {
  const [goals, setGoals] = useState([]);
  const toggle = (g) => { engage(); track('goal', g); setGoals((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : cur.length >= 3 ? cur : [...cur, g])); };
  const list = matchGoals(goals);
  return (
    <div className="qz">
      <p className="qz-q">{w.qz_q}</p>
      <div className="qz-goals">
        {GOALS.map(([g, label]) => <button key={g} type="button" aria-pressed={goals.includes(g)} onClick={() => toggle(g)}>{label}</button>)}
      </div>
      <div className="qz-out" aria-live="polite">
        {list.length === 0 ? <p className="qz-empty">{w.qz_empty}</p> : (
          <>
            <p className="qz-eye">{w.qz_eye}</p>
            {list.map(([k, name, cap, shopName, slug, photo]) => (
              <a key={k} className="qz-row" href={SHOP + slug}>
                <img src={`products/${photo}.webp`} alt="" width="48" height="48" />
                <span><b>{k === 'glp1' ? shopName : name}</b><small>{k === 'glp1' ? w.qz_glp1 : cap}</small></span>
                <i>{w.lab_buy}<span aria-hidden="true"> →</span></i>
              </a>
            ))}
          </>
        )}
      </div>
      <a className="more" href="#learn">{w.qz_more} ↓</a>
    </div>
  );
}

// ---- d: the shelf. Every product with its photo, each straight to its own page in the shop.
function Shelf() {
  const row = useRef(null);
  useEffect(() => {
    const el = row.current;
    if (!el) return undefined;
    const on = () => engage();
    el.addEventListener('scroll', on, { passive: true, once: true });
    return () => el.removeEventListener('scroll', on);
  }, []);
  return (
    <div className="sh">
      <p className="lab-hint sh-hint">{w.sh_hint}</p>
      <div className="sh-row" ref={row}>
        {PEPTIDES.map(([k, name, cap, shopName, slug, photo]) => (
          <a key={k} className="sh-tile" href={SHOP + slug}>
            <span className="sh-ph"><img src={`products/${photo}.webp`} alt="" width="320" height="320" loading={k === 'bpc157' || k === 'tb500' || k === 'glp1' ? 'eager' : 'lazy'} /></span>
            <b>{k === 'glp1' ? shopName : name}</b>
            <small>{k === 'glp1' ? w.qz_glp1 : cap}</small>
            <i>{w.lab_buy}<span aria-hidden="true"> →</span></i>
          </a>
        ))}
      </div>
      <a className="more" href="#learn">{w.sh_more} ↓</a>
    </div>
  );
}

function Cards() {
  return PEPTIDES.map(([k, name, cap, shopName, slug, photo, forms = []]) => (
    <article className="pep" id={k} key={k}>
      <PeptideExplainer k={k} name={name} cap={cap} w={w}>
        <p className="pep-what">{w[`pep_${k}`]}</p>
      </PeptideExplainer>
      <div className="pep-buy">
        <img src={`products/${photo}.webp`} alt="" width="56" height="56" loading="lazy" />
        <a className="pep-shop" href={SHOP + slug}>See {shopName} {w.lab_shop}<span aria-hidden="true"> →</span></a>
      </div>
      {forms.length > 0 && <p className="pep-forms">{forms.map(([label, s]) => <a key={s} href={SHOP + s}>{label} <span aria-hidden="true">→</span></a>)}</p>}
    </article>
  ));
}

// Every product, by name, each to its own shop page (Max, 2026-11-13: "it shouldnt open the shop it should have a link for each one").
function Names() {
  return PEPTIDES.map(([k, name, , shopName, slug]) => <a key={k} href={SHOP + slug}>{k === 'glp1' ? shopName : name}<span aria-hidden="true"> →</span></a>);
}

const style = document.createElement('style');
style.textContent = PX_CSS;
document.head.appendChild(style);
document.documentElement.dataset.v = V;
const Hero = { a: Lab, b: TextGigi, c: Quiz, d: Shelf }[V];
createRoot(document.getElementById('lab')).render(<Hero />);
createRoot(document.getElementById('peptides')).render(<Cards />);
const names = document.getElementById('names');
if (names) createRoot(names).render(<Names />);

// the steps
track('view');
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a) return;
  const h = a.getAttribute('href') || '';
  if (h.startsWith(SHOP)) track('shop', `${BY_SLUG[h.slice(SHOP.length)] || 'other'}:${a.closest('.hero') ? 'hero' : 'page'}`);
  else if (h.startsWith('sms:')) track('gigi', a.closest('.hero') ? 'hero' : 'page');
}, true);
let seconds = 0;
const clock = setInterval(() => { if (!document.hidden && (seconds += 1) >= 30) { track('stay30'); clearInterval(clock); } }, 1000);
const learn = document.getElementById('learn');
if (learn && typeof IntersectionObserver !== 'undefined') {
  const io = new IntersectionObserver(([en]) => { if (en.isIntersecting) { track('scroll'); io.disconnect(); } }, { rootMargin: '0px 0px -40% 0px' });
  io.observe(learn);
}
document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#peptides button')) track('card'); }, true);
