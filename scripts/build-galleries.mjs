// Rebuild /gallery1, /gallery2 and /giraffeartgallery from the oasis dataset.
// Usage (from this repo root):
//   node scripts/build-galleries.mjs ../oasis/src/data/giraffeArtPieces.mjs .
// Images are expected at /gallery-assets/<id>.jpg (download + resize with sips, 900px max).

// Build gallery1 (under $100), gallery2 ($100 and up), and the chooser at /giraffeartgallery
// Usage: node build-galleries.mjs <dataset.mjs> <siteRoot>
import fs from 'node:fs';
import path from 'node:path';
const [datasetPath, siteRoot] = process.argv.slice(2);
const { GIRAFFE_ART_PIECES } = await import(datasetPath);

const MARKUP = 1.2;
const sell = (b) => Math.round(b * MARKUP * 100) / 100;
const MARKET_RE = /etsy|saatchi|society6|redbubble|fine art america|minted|ugallery|artsy|1stdibs|rise art|ebay|amazon|displate|icanvas|zazzle|desenio|juniqe|artfinder|singulart/i;
const STYLES = [
  ['realistic','Realistic'],['abstract','Abstract'],['whimsical','Whimsical'],['minimalist','Minimalist'],
  ['watercolor','Watercolor'],['nursery','Nursery'],['pop','Pop Art'],['vintage','Vintage'],
  ['african','African'],['photography','Photography'],
];
const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const money = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

// Public shape: no marketplace, no listing URL, no base price, no source image URL.
const all = GIRAFFE_ART_PIECES.map(p => ({
  id: p.id,
  title: p.title,
  artist: MARKET_RE.test(p.artist) ? 'Studio print' : p.artist,
  price: sell(p.basePrice),
  medium: p.medium,
  style: p.style,
  dimensions: p.dimensions,
  description: p.description,
  image: `/gallery-assets/${p.id}.jpg`,
}));
for (const p of all) {
  for (const f of ['title','artist','medium','description']) {
    if (MARKET_RE.test(p[f])) throw new Error(`marketplace name leaks in ${p.id}.${f}: ${p[f]}`);
  }
}
const g1 = all.filter(p => p.price < 100);
const g2 = all.filter(p => p.price >= 100);
const range = (list) => [Math.min(...list.map(p => p.price)), Math.max(...list.map(p => p.price))];

const jsonSafe = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const HEAD = (title, desc, url) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Grateful Giraffes">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="https://grateful.gg/og-default.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="https://grateful.gg/og-default.jpg">
<link rel="canonical" href="${url}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Libre+Bodoni:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap" rel="stylesheet">`;

const CSS = `<style>
  *{box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{margin:0;font-family:'Libre Bodoni',Georgia,serif;color:#1c1917;background:linear-gradient(135deg,#fffbeb 0%,#fff7ed 50%,#fefce8 100%);min-height:100vh}
  a{color:inherit}
  .hero{position:relative;padding:88px 24px;text-align:center;background:linear-gradient(135deg,#78350f 0%,#9a3412 55%,#713f12 100%);color:#fff}
  .hero .kicker{margin:0 0 18px;font-size:12px;letter-spacing:.35em;text-transform:uppercase;color:#fcd34d}
  .hero h1{margin:0;font-size:clamp(40px,7vw,72px);font-weight:700;line-height:1.05}
  .hero .rule{width:56px;height:1px;background:#fbbf24;margin:22px auto}
  .hero p.lede{max-width:720px;margin:0 auto;font-size:clamp(17px,2.2vw,21px);line-height:1.6;color:rgba(255,255,255,.82)}
  .hero .switch{margin:26px 0 0;font-size:14px;color:rgba(255,255,255,.7)}
  .hero .switch a{color:#fcd34d;text-decoration:none;border-bottom:1px solid rgba(252,211,77,.5)}
  .bar{position:sticky;top:0;z-index:30;padding:14px 24px;background:rgba(255,251,235,.95);backdrop-filter:blur(6px);border-bottom:1px solid #fde68a}
  .bar .inner{max-width:1152px;margin:0 auto;display:flex;flex-direction:column;gap:10px}
  .row{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;align-items:center}
  .chip{appearance:none;border:1px solid #fde68a;background:#fff;color:#78350f;font:inherit;font-size:14px;font-weight:500;padding:7px 16px;border-radius:999px;cursor:pointer;transition:all .15s}
  .chip:hover{background:#fffbeb}
  .chip[aria-pressed="true"]{background:#b45309;color:#fff;border-color:#b45309;box-shadow:0 2px 6px rgba(120,53,15,.25)}
  select.sort{font:inherit;font-size:14px;color:#78350f;background:#fff;border:1px solid #fde68a;border-radius:999px;padding:7px 12px}
  main{padding:56px 24px 40px}
  .wrap{max-width:1152px;margin:0 auto}
  .count{text-align:center;font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:rgba(146,64,14,.6);margin:0 0 36px}
  .empty{text-align:center;color:#78716c;padding:48px 0;display:none}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:24px}
  .card{background:#fff;border:1px solid #fef3c7;border-radius:24px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.04);display:flex;flex-direction:column;transition:box-shadow .2s,transform .2s}
  .card:hover{box-shadow:0 18px 40px rgba(120,53,15,.16);transform:translateY(-2px)}
  .card .art{position:relative;display:block;aspect-ratio:4/5;background:#fffbeb;overflow:hidden}
  .card .art img{width:100%;height:100%;object-fit:cover;display:block}
  .num{position:absolute;top:12px;left:12px;padding:4px 12px;border-radius:999px;font-size:12px;font-weight:600;background:rgba(255,251,235,.92);color:#92400e}
  .body{padding:20px;display:flex;flex-direction:column;gap:12px;flex:1}
  .artist{margin:0 0 4px;font-size:12px;letter-spacing:.15em;text-transform:uppercase;color:#d97706}
  .title{margin:0;font-size:16px;font-weight:700;line-height:1.3;color:#1c1917}
  .meta{margin:4px 0 0;font-size:12px;color:#78716c}
  .price{margin:0;font-size:24px;font-weight:700;color:#92400e}
  .desc{margin:0;font-size:14px;line-height:1.6;color:#57534e;flex:1}
  footer{padding:56px 24px;text-align:center;border-top:1px solid #fde68a}
  footer p{max-width:640px;margin:0 auto 10px;font-size:13px;color:rgba(120,53,15,.55);line-height:1.6}
  footer a{color:#b45309}
  /* chooser */
  .choose{max-width:960px;margin:0 auto;padding:64px 24px;display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:28px}
  .door{display:block;text-decoration:none;background:#fff;border:1px solid #fef3c7;border-radius:28px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.04);transition:box-shadow .2s,transform .2s}
  .door:hover{box-shadow:0 22px 48px rgba(120,53,15,.18);transform:translateY(-3px)}
  .door .strip{display:grid;grid-template-columns:repeat(3,1fr);aspect-ratio:3/1.6;background:#fffbeb}
  .door .strip img{width:100%;height:100%;object-fit:cover;display:block}
  .door .info{padding:26px 28px 30px}
  .door .roman{margin:0 0 6px;font-size:12px;letter-spacing:.3em;text-transform:uppercase;color:#d97706}
  .door h2{margin:0 0 8px;font-size:28px;font-weight:700;color:#1c1917}
  .door p{margin:0;font-size:15px;line-height:1.6;color:#57534e}
  .door .go{display:inline-block;margin-top:18px;padding:12px 22px;border-radius:12px;background:linear-gradient(90deg,#d97706,#ea580c);color:#fff;font-weight:600;font-size:15px}
  @media (max-width:640px){.hero{padding:64px 20px}main{padding:40px 16px}.grid{gap:16px}.choose{padding:40px 16px}}
</style>`;

const JS = `<script>
(function () {
  var PIECES = JSON.parse(document.getElementById('pieces').textContent);
  var state = { style: 'all', sort: 'featured' };
  var grid = document.getElementById('grid'), count = document.getElementById('count'), empty = document.getElementById('empty');
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var money = function (n) { return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' }); };
  function visible() {
    var list = PIECES.filter(function (p) { return state.style === 'all' || p.style === state.style; });
    if (state.sort === 'price-asc') list = list.slice().sort(function (a, b) { return a.price - b.price; });
    if (state.sort === 'price-desc') list = list.slice().sort(function (a, b) { return b.price - a.price; });
    return list;
  }
  function card(p, i) {
    return '<article class="card">' +
      '<div class="art"><img src="' + esc(p.image) + '" alt="' + esc(p.title + ' by ' + p.artist) + '" loading="lazy" width="900" height="1125">' +
      '<span class="num">No. ' + esc(p.n) + '</span></div>' +
      '<div class="body">' +
        '<div><p class="artist">' + esc(p.artist) + '</p><h3 class="title">' + esc(p.title) + '</h3>' +
        '<p class="meta">' + esc(p.medium) + (p.dimensions ? ' · ' + esc(p.dimensions) : '') + '</p></div>' +
        '<p class="price">' + money(p.price) + '</p>' +
        '<p class="desc">' + esc(p.description) + '</p>' +
      '</div></article>';
  }
  function render() {
    var list = visible();
    grid.innerHTML = list.map(card).join('');
    count.textContent = list.length + ' piece' + (list.length === 1 ? '' : 's') + ' · Artists around the world';
    empty.style.display = list.length ? 'none' : 'block';
  }
  document.getElementById('styles').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-style]'); if (!btn) return;
    state.style = btn.getAttribute('data-style');
    Array.prototype.forEach.call(document.querySelectorAll('#styles button[data-style]'), function (b) { b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); });
    render();
  });
  document.getElementById('sort').addEventListener('change', function (e) { state.sort = e.target.value; render(); });
  render();
})();
</script>`;

function galleryPage({ slug, roman, title, lede, list, otherSlug, otherLabel }) {
  const url = `https://grateful.gg/${slug}`;
  const [lo, hi] = range(list);
  const numbered = list.map((p, i) => ({ ...p, n: i + 1 }));
  const usedStyles = new Set(list.map(p => p.style));
  return `${HEAD(`${title} · Grateful Giraffes`, lede, url)}
${CSS}
</head>
<body>
<header class="hero">
  <p class="kicker">Grateful Giraffes · Giraffe Gallery ${roman}</p>
  <h1>${esc(title)}</h1>
  <div class="rule"></div>
  <p class="lede">${esc(lede)}</p>
  <p class="switch">Looking for something else? <a href="/${otherSlug}">${esc(otherLabel)} &rarr;</a></p>
</header>

<nav class="bar" aria-label="Filters">
  <div class="inner">
    <div class="row" id="styles">
      <button class="chip" data-style="all" aria-pressed="true">All styles</button>
      ${STYLES.filter(([id]) => usedStyles.has(id)).map(([id, label]) => `<button class="chip" data-style="${id}" aria-pressed="false">${label}</button>`).join('\n      ')}
      <select class="sort" id="sort" aria-label="Sort pieces">
        <option value="featured">Featured</option>
        <option value="price-asc">Price: low to high</option>
        <option value="price-desc">Price: high to low</option>
      </select>
    </div>
  </div>
</nav>

<main>
  <div class="wrap">
    <p class="count" id="count"></p>
    <p class="empty" id="empty">No pieces match that style here. Try another, or visit <a href="/${otherSlug}">${esc(otherLabel)}</a>.</p>
    <div class="grid" id="grid"></div>
  </div>
</main>

<footer>
  <p>${list.length} pieces from ${money(lo)} to ${money(hi)}. Prices in USD and subject to change; each work is by an independent artist and availability is not guaranteed.</p>
  <p>Giraffe Gallery ${roman} · <a href="/giraffeartgallery">All galleries</a> · <a href="https://app.grateful.gg/">Grateful Giraffes Community</a></p>
</footer>

<script id="pieces" type="application/json">${jsonSafe(numbered)}</script>
${JS}
</body>
</html>
`;
}

function chooserPage() {
  const pick = (list, n) => list.filter((_, i) => i % Math.floor(list.length / n) === 0).slice(0, n);
  const door = (slug, roman, title, list, blurb) => {
    const [lo, hi] = range(list);
    return `<a class="door" href="/${slug}">
    <div class="strip">${pick(list, 3).map(p => `<img src="${p.image}" alt="${esc(p.title)}" loading="lazy">`).join('')}</div>
    <div class="info">
      <p class="roman">Gallery ${roman}</p>
      <h2>${esc(title)}</h2>
      <p>${esc(blurb)} ${list.length} pieces, ${money(lo)} to ${money(hi)}.</p>
      <span class="go">Enter Gallery ${roman} &rarr;</span>
    </div>
  </a>`;
  };
  return `${HEAD('The Giraffe Gallery · Grateful Giraffes', 'One hundred giraffe artworks in two galleries: everything under $100, and originals and collector pieces from $100 up.', 'https://grateful.gg/giraffeartgallery')}
${CSS}
</head>
<body>
<header class="hero">
  <p class="kicker">Grateful Giraffes · Curated Collection</p>
  <h1>The Giraffe Gallery</h1>
  <div class="rule"></div>
  <p class="lede">One hundred giraffe artworks from painters, printmakers, and photographers around the world, in two galleries.</p>
</header>
<section class="choose">
  ${door('gallery1', 'I', 'Under $100', g1, 'Prints, posters, and small works for every wall.')}
  ${door('gallery2', 'II', '$100 and up', g2, 'Originals, limited editions, and collector pieces.')}
</section>
<footer>
  <p>Prices in USD and subject to change; each work is by an independent artist and availability is not guaranteed.</p>
  <p>The Giraffe Gallery · <a href="https://app.grateful.gg/">Grateful Giraffes Community</a></p>
</footer>
</body>
</html>
`;
}

const write = (rel, html) => { const f = path.join(siteRoot, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, html); console.log('wrote', rel, (html.length / 1024).toFixed(0) + ' KB'); };
write('gallery1/index.html', galleryPage({ slug: 'gallery1', roman: 'I', title: 'Under $100', lede: `${g1.length} giraffe prints, posters, and small works, every one under one hundred dollars.`, list: g1, otherSlug: 'gallery2', otherLabel: 'Gallery II, $100 and up' }));
write('gallery2/index.html', galleryPage({ slug: 'gallery2', roman: 'II', title: '$100 and up', lede: `${g2.length} original paintings, limited editions, and collector pieces, from one hundred dollars up.`, list: g2, otherSlug: 'gallery1', otherLabel: 'Gallery I, under $100' }));
write('giraffeartgallery/index.html', chooserPage());
console.log(`gallery1 ${g1.length} pieces ${range(g1).join('-')}, gallery2 ${g2.length} pieces ${range(g2).join('-')}`);
