// grateful.gg/health: the animated peptide cards. Built to health/app.js by scripts/health/build.mjs.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { PeptideExplainer, PX_CSS } from './PeptideExplainer.jsx';
import w from './words.json';

const SHOP = 'https://health.grateful.gg/protocols/proto-gratefulhealth-';
// [key, name, what it is made of, the shop's name for it, the shop page]
const PEPTIDES = [
  ['bpc157', 'BPC-157', '15 amino acids', 'BPC-157', 'bpc-157-rd8x'],
  ['tb500', 'TB-500', 'From thymosin beta-4, 43 amino acids', 'TB-500', 'tb-500-rahc'],
  ['glp1', 'GLP-1', 'A gut hormone, copied', 'Tirzepatide', 'tirzepatide-rrec'],
  ['nad', 'NAD+', 'Two nucleotides, a coenzyme', 'NAD+', 'nad-injection-rtle'],
  ['sermorelin', 'Sermorelin', '29 amino acids, one helix', 'Sermorelin', 'sermorelin-rsb2'],
];

function Cards() {
  return PEPTIDES.map(([k, name, cap, shopName, slug]) => (
    <article className="pep" id={k} key={k}>
      <PeptideExplainer k={k} name={name} cap={cap} w={w}>
        <p className="pep-what">{w[`pep_${k}`]}</p>
      </PeptideExplainer>
      <a className="pep-shop" href={SHOP + slug}>See {shopName} in the shop<span aria-hidden="true"> →</span></a>
    </article>
  ));
}

const style = document.createElement('style');
style.textContent = PX_CSS;
document.head.appendChild(style);
createRoot(document.getElementById('peptides')).render(<Cards />);
