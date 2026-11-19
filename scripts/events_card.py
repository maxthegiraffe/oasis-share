#!/usr/bin/env python3
"""grateful.gg/events link preview, rebuilt from the live calendar (Max, 2026-11-19: "events preview should be next up
with dates and change dynamically"). Run daily by .github/workflows/events-card.yml, or by hand: python3 scripts/events_card.py

Reads the public calendar feed (the app's getFallGatherings, the same one /events reads; no sign-in), takes the next
four listed gatherings by Pacific date, and draws the "next up" card: "What's coming up" over four tiles of each
gathering's own art with its date and name. Writes events/cover-<hash>.jpg (a new name whenever it changes, since chat
apps cache a preview by its image URL), points events/index.html at it, and removes the previous generated cover.
app.grateful.gg/events shows the same preview (the edge copies grateful.gg/events/). No change, no write.

Each tile's art, first that exists: the gathering's own image, its plate on the app (/events-plates/<key>.jpg, or the
key without its date), else the art side (right 28%) of its own grateful.gg card. No em or en dashes anywhere.
"""
import datetime, glob, hashlib, io, json, os, re, sys, urllib.request
from zoneinfo import ZoneInfo
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EV, FONTS = os.path.join(ROOT, 'events'), os.path.join(ROOT, 'scripts', 'fonts')
APP_ID = '69882c256690d6f8c4ce18bf'  # public: it ships in the app's own JS
FEED = f'https://app.grateful.gg/api/apps/{APP_ID}/functions/getFallGatherings'
UA = {'User-Agent': 'Mozilla/5.0 (grateful.gg events card)'}
W, H = 1200, 630
INK, MUTED, ORANGE = (32, 24, 40), (105, 92, 110), (214, 104, 40)
MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']


def fetch(url, data=None):
    req = urllib.request.Request(url, data=data, headers={**UA, **({'Content-Type': 'application/json'} if data else {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def font(name, size, weight):
    f = ImageFont.truetype(os.path.join(FONTS, name), size)
    f.set_variation_by_name(weight)
    return f


def next_up(n=4):
    cards = json.loads(fetch(FEED, b'{}')).get('cards') or []
    today = datetime.datetime.now(ZoneInfo('America/Los_Angeles')).date().isoformat()
    ok = [c for c in cards if not c.get('unlisted') and not c.get('date_tbd') and (c.get('date') or '') >= today]
    ok.sort(key=lambda c: (c['date'], c.get('time') or ''))
    return ok[:n]


def art(c):
    key = c.get('fall_key') or c.get('id') or ''
    tries = [c.get('image_url'), f'https://app.grateful.gg/events-plates/{key}.jpg']
    bare = re.sub(r'-(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)-\d{1,2}$', '', key)
    if bare != key: tries.append(f'https://app.grateful.gg/events-plates/{bare}.jpg')
    for u in filter(None, tries):
        try:
            im = Image.open(io.BytesIO(fetch(u))).convert('RGB')
            if im.width >= 300: return im
        except Exception:
            pass
    route = c.get('route') or f'/{key}'
    slug = route[3:] if route.startswith('/p/') else route.strip('/')
    page = fetch(f'https://grateful.gg/{slug}/').decode('utf-8', 'replace')
    og = re.search(r'og:image" content="([^"]+)"', page).group(1)
    im = Image.open(io.BytesIO(fetch(og))).convert('RGB')
    return im.crop((int(im.width * 0.72), 0, im.width, im.height))   # the art side of the card, clear of its words


def tile(im, w, h):
    r = max(w / im.width, h / im.height)
    im = im.resize((int(im.width * r) + 1, int(im.height * r) + 1), Image.LANCZOS)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))


def rounded(im, rad):
    m = Image.new('L', im.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, im.width - 1, im.height - 1), rad, fill=255)
    return m


def label(c, d, width):
    """The gathering's name, shrunk to fit its tile before falling back to a shorter name or its city."""
    t = re.sub(r'\s+', ' ', str(c.get('title') or '')).strip()
    main = re.split(r'\s*[:·(]\s*', t)[0]
    for cand in (main, main.split(' with ')[0], str(c.get('city') or '').split(',')[0]):
        for size in (24, 22, 20):
            f = font('Figtree.ttf', size, b'SemiBold')
            if cand and d.textlength(cand, font=f) <= width: return cand, f
    return main[:18], font('Figtree.ttf', 20, b'SemiBold')


def draw(events):
    bg = Image.new('RGB', (W, H), (251, 246, 242))
    glow = Image.new('RGB', (W, H), (251, 246, 242)); g = ImageDraw.Draw(glow)
    g.ellipse((800, -260, 1500, 300), fill=(250, 214, 190)); g.ellipse((-300, 120, 420, 760), fill=(226, 214, 246))
    card = Image.blend(bg, glow.filter(ImageFilter.GaussianBlur(120)), 0.9)
    d = ImageDraw.Draw(card)
    d.text((60, 44), 'THE GATHERINGS · GRATEFUL GIRAFFES', font=font('Figtree.ttf', 24, b'SemiBold'), fill=ORANGE)
    d.text((56, 80), "What's coming up", font=font('Gelasio.ttf', 96, b'Bold'), fill=INK)
    n, gap = len(events), 22
    tw = (W - 120 - gap * (n - 1)) // n
    fd = font('Gelasio.ttf', 44, b'Bold')
    for i, c in enumerate(events):
        x, y = 60 + i * (tw + gap), 250
        t = tile(art(c), tw, 250)
        card.paste(t, (x, y), rounded(t, 16))
        y0, m0, d0 = (int(v) for v in c['date'][:10].split('-'))
        d.text((x + 2, y + 264), f'{MON[m0 - 1]} {d0}', font=fd, fill=INK)
        name, fl = label(c, d, tw - 4)
        d.text((x + 2, y + 316), name, font=fl, fill=MUTED)
    return card


def main():
    events = next_up()
    if len(events) < 2:
        print('fewer than 2 upcoming gatherings; keeping the current card'); return
    out = io.BytesIO(); draw(events).save(out, 'JPEG', quality=86, optimize=True, progressive=True)
    data = out.getvalue()
    name = f"cover-{hashlib.sha1(data).hexdigest()[:10]}.jpg"
    page = os.path.join(EV, 'index.html')
    html = open(page, encoding='utf-8').read()
    if f'/events/{name}' in html:
        print('no change:', name); return
    open(os.path.join(EV, name), 'wb').write(data)
    for old in glob.glob(os.path.join(EV, 'cover-*.jpg')):
        if os.path.basename(old) != name: os.remove(old)
    names = ', '.join(f"{c.get('title', '').split(':')[0].split('·')[0].strip()}" for c in events)
    alt = re.sub('[–—]', ',', f"What's coming up: {names}")
    title = "What's coming up · Grateful Giraffes"
    desc = 'Gatherings with the Grateful Giraffes. RSVP in the Oasis and bring a friend.'
    img = f'https://grateful.gg/events/{name}'
    subs = [(r'(<meta property="og:image" content=")[^"]*', img), (r'(<meta property="og:image:secure_url" content=")[^"]*', img),
            (r'(<meta name="twitter:image" content=")[^"]*', img), (r'(<meta property="og:title" content=")[^"]*', title),
            (r'(<meta name="twitter:title" content=")[^"]*', title), (r'(<meta property="og:description" content=")[^"]*', desc),
            (r'(<meta name="twitter:description" content=")[^"]*', desc), (r'(<meta property="og:image:alt" content=")[^"]*', alt),
            (r'(<title>)[^<]*', f'{title} · The Oasis')]
    for pat, val in subs:
        html, k = re.subn(pat, lambda m: m.group(1) + val.replace('&', '&amp;').replace('"', '&quot;'), html, count=1)
        if not k: sys.exit(f'events/index.html is missing {pat}')
    open(page, 'w', encoding='utf-8').write(html)
    print('new card', name, '|', ' / '.join(f"{c['date']} {c.get('fall_key')}" for c in events))


if __name__ == '__main__':
    main()
