#!/usr/bin/env python3
"""The Grateful Giraffes' latest posts, for app.grateful.gg/socialmedia (Max, 2026-11-15: "a page on the oasis called
/socialmedia ... it should show our latest posts on all of our GG social media channels").

Writes socialmedia/feed.json here (served at https://grateful.gg/socialmedia/feed.json, which the page reads):
  - YouTube: the channel's public feed (no key), newest first.
  - Instagram and Facebook: Apify's public-profile scrapers (APIFY_TOKEN), newest first. Their image links are signed
    and expire after a few days, so this runs every 6 hours (.github/workflows/social-feed.yml).
A channel that fails keeps its last good posts, so the page never goes blank because one source hiccuped.

  APIFY_TOKEN=... python3 scripts/social_feed.py
"""
import json, os, sys, urllib.request, xml.etree.ElementTree as ET
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'socialmedia', 'feed.json')
N = 9
YT_CHANNEL = 'UCrcc7hukeBFnkx-ZGi3OiLw'
CHANNELS = {
    'instagram': {'name': 'Instagram', 'handle': '@gratefulgiraffes', 'url': 'https://www.instagram.com/gratefulgiraffes/'},
    'facebook': {'name': 'Facebook', 'handle': '@gratefulgiraffes', 'url': 'https://www.facebook.com/gratefulgiraffes'},
    'youtube': {'name': 'YouTube', 'handle': '@gratefulgiraffes', 'url': 'https://www.youtube.com/@gratefulgiraffes'},
}
UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'}


def get(url, data=None, timeout=60):
    req = urllib.request.Request(url, data=data, headers=dict(UA, **({'Content-Type': 'application/json'} if data else {})),
                                 method='POST' if data else 'GET')
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def clip(s, n=140):
    s = ' '.join(str(s or '').split())
    return s if len(s) <= n else s[:n - 1].rsplit(' ', 1)[0] + '…'


def iso(t):
    if isinstance(t, (int, float)):
        return datetime.fromtimestamp(t, timezone.utc).isoformat().replace('+00:00', 'Z')
    return str(t or '')


def youtube():
    ns = {'a': 'http://www.w3.org/2005/Atom', 'm': 'http://search.yahoo.com/mrss/', 'yt': 'http://www.youtube.com/xml/schemas/2015'}
    root = ET.fromstring(get(f'https://www.youtube.com/feeds/videos.xml?channel_id={YT_CHANNEL}'))
    out = []
    for e in root.findall('a:entry', ns)[:N]:
        vid = e.find('yt:videoId', ns).text
        st = e.find('m:group/m:community/m:statistics', ns)
        out.append({'url': f'https://www.youtube.com/shorts/{vid}', 'thumb': f'https://i.ytimg.com/vi/{vid}/hqdefault.jpg',
                    'caption': clip(e.find('a:title', ns).text), 'at': e.find('a:published', ns).text,
                    'views': int(st.get('views')) if st is not None and st.get('views') else None, 'video': True})
    return out


def apify(actor, body):
    tok = os.environ.get('APIFY_TOKEN', '').strip()
    if not tok:
        raise RuntimeError('no APIFY_TOKEN')
    url = f'https://api.apify.com/v2/acts/{actor}/run-sync-get-dataset-items?token={tok}&timeout=240'
    return json.loads(get(url, json.dumps(body).encode(), timeout=300))


def instagram():
    items = apify('apify~instagram-scraper', {'directUrls': [CHANNELS['instagram']['url']], 'resultsType': 'posts',
                                               'resultsLimit': N + 3, 'addParentData': False})
    posts = [{'url': i.get('url'), 'thumb': i.get('displayUrl'), 'caption': clip(i.get('caption')), 'at': iso(i.get('timestamp')),
              'views': i.get('videoPlayCount') or i.get('videoViewCount'), 'likes': i.get('likesCount'),
              'video': i.get('type') == 'Video'} for i in items if i.get('url') and i.get('displayUrl')]
    return sorted(posts, key=lambda p: p['at'], reverse=True)[:N]


def facebook():
    items = apify('apify~facebook-posts-scraper', {'startUrls': [{'url': CHANNELS['facebook']['url']}], 'resultsLimit': N + 3})
    posts = []
    for i in items:
        m = (i.get('media') or [{}])[0] if isinstance(i.get('media'), list) and i.get('media') else {}
        thumb = m.get('thumbnail') or (m.get('photo_image') or {}).get('uri') or (m.get('image') or {}).get('uri')
        if not (i.get('url') and thumb):
            continue
        posts.append({'url': i.get('url'), 'thumb': thumb, 'caption': clip(i.get('text')), 'at': iso(i.get('timestamp') or i.get('time')),
                      'views': i.get('viewsCount') or i.get('videoPostViewCount'), 'likes': i.get('likes'), 'video': bool(i.get('isVideo'))})
    return sorted(posts, key=lambda p: p['at'], reverse=True)[:N]


def main():
    prev = {}
    if os.path.exists(OUT):
        try:
            prev = json.load(open(OUT)).get('channels', {})
        except Exception:
            prev = {}
    channels, errors = {}, []
    for key, fn in (('instagram', instagram), ('facebook', facebook), ('youtube', youtube)):
        try:
            posts = fn()
            if not posts:
                raise RuntimeError('no posts came back')
            channels[key] = dict(CHANNELS[key], posts=posts, updated_at=datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'))
        except Exception as e:   # keep the last good posts for this channel
            errors.append(f'{key}: {e}')
            channels[key] = prev.get(key) or dict(CHANNELS[key], posts=[], updated_at=None)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump({'updated_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'), 'channels': channels}, f, ensure_ascii=False, indent=1)
    print({k: len(v.get('posts') or []) for k, v in channels.items()}, 'errors:', errors or 'none')
    if len(errors) == 3:
        sys.exit(1)


if __name__ == '__main__':
    main()
