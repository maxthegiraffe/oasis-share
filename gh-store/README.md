# Grateful Health store: the redesign (Nov 11, 2026)

For Platform Health's team. The words and prices are the ones live on https://gratefulhealth.joinplatformhealth.com today; only the look changes, plus one new line.

## What changed

1. **The same look as our landing page.** The header has the Grateful Health mark and wordmark, as on https://app.grateful.gg/gratefulhealth
   (no "Founding members" badge). The shop and every product page use our drawings (`art/`, one per product, drawn from each
   product's real structure, like app.grateful.gg/peptides) in place of the vial photos.
2. **The button is on the first screen.** On a laptop (1280x720) and on a phone (375x667 and up), "Start your online visit" shows
   without scrolling. On phones the drawing sits beside the name and price instead of above them, so it's never cropped. The first
   line of the medical notice stays right above the button; the rest of it follows the button.
3. **The Biohacking Safari voucher line,** on the shop and on every product page, near the price:
   "Have a voucher from Biohacking Safari? Use it for a discount on your first order!" It needs a discount code at checkout; we'll send the code details separately.
5. **No dashes.** A few live lines use em dashes ("A nasal spray — no needles"); here they read with commas. Everything else is word for word.
4. **"Talk to Gigi"** bottom right (opens a text to Gigi, grateful.gg/textgigi), the same as on our pages, in place of "Ask Paula".

## Files

- `gh-store.css`: one stylesheet. Product page classes match your live markup (`pdp-crumb`, `pdp-grid`, `pdp-media`, `pdp-title`,
  `pdp-lead`, `pdp-price`, `pdp-price-figure`, `pdp-price-note`, `pdp-fine`, `pdp-fine-lead`, `pdp-buy`, `pdp-facts`,
  `pdp-fine--after`), and the shop's match `ph-store-top`, `ph-store-grid`, `ph-store-card`, `-name`, `-from`, `-desc`. New:
  `gh-art` (the drawing frame), `gh-voucher` (the voucher line), `pdp-head` (the phone row), `gh-gigi`.
- `shop.html`, `products/*.html`: all 18 pages as they should look. `art/*.svg`: the drawings (SVG, so they stay sharp at any size).
- `assets/mark-480.webp`: the mark. `products.json`: the words, as read from the live store.

Questions: Max Marine.
