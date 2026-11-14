// grateful.gg/health: the hero's lab (pick a peptide, watch what it does) and the animated cards.
// Built to health/app.js by scripts/health/build.mjs.
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PeptideExplainer, PeptideStage, PX_CSS } from './PeptideExplainer.jsx';
import w from './words.json';

const SHOP = 'https://health.grateful.gg/protocols/proto-gratefulhealth-';
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

// The hero's lab: pick a name, watch its animation, read about it and go to its page in the shop, all on the first
// screen (Max, 2026-11-13: "the more about should appear in the hero section and not need scrolling down - as well as
// the buy button", "or ask gigi"). Until someone picks, it moves on to the next one after each loop (three steps of
// four seconds), unless motion is reduced.
// The bare word PEPTIDES is what opens Gigi for someone she doesn't know (gigi-whatsapp peptide_match isTrigger);
// "PEPTIDES: <name>" got them the members-only letter (checked 2026-11-13). Add the name back once she handles it.
const GIGI = 'sms:+15164197249?&body=';
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
  const pick = (fn) => { picked.current = true; fn(); };
  return (
    <>
      <div className="lab-pick">
        <p className="lab-hint">{w.lab_hint}</p>
        <div className="lab-chips" role="tablist" aria-label={w.lab_hint} ref={row}>
          {PEPTIDES.map(([pk, pn], j) => (
            <button key={pk} type="button" role="tab" aria-selected={j === i} onClick={() => pick(() => setI(j))}>{pn}</button>
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
          <a className="btn alt" href={GIGI + 'PEPTIDES'}>{w.lab_gigi}</a>
        </div>
      </div>
    </>
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

const style = document.createElement('style');
style.textContent = PX_CSS;
document.head.appendChild(style);
createRoot(document.getElementById('lab')).render(<Lab />);
createRoot(document.getElementById('peptides')).render(<Cards />);
