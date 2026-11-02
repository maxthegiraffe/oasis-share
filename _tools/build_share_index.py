#!/usr/bin/env python3
"""share-index.json: which grateful.gg card belongs to which app.grateful.gg page.

The app's edge (oasis-stack apps/staging-edge/lib/link-preview.ts) reads it so a link to
app.grateful.gg/<page> shows the same preview as grateful.gg/<slug>. Each card already names its
app page in <link rel="canonical">; this collects them: [{p: app path, s: slug, q?: query values}].
The edge finds cards named like their page (grateful.gg/<path>/, or its last segment) on its own,
so only the rest are listed: /ai/bootcamp7 -> aibootcamp7, personal invites, ...

    python3 -I _tools/build_share_index.py            # rewrite share-index.json if it changed
    python3 -I _tools/build_share_index.py --check    # exit 1 if it's out of date

.githooks/pre-commit runs it on every commit. Folders starting with _ or . are never published
(Jekyll), so they are skipped.
"""
import argparse, html, json, os, re, subprocess, sys
from urllib.parse import parse_qsl, urlsplit

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
INDEX = "share-index.json"
APP_HOST = "app.grateful.gg"

META = re.compile(r"<meta\b[^>]*>", re.I)
LINK = re.compile(r"<link\b[^>]*>", re.I)
ATTR = re.compile(r"""([a-z][a-z0-9:_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))""", re.I)


def attrs(tag):
    return {m.group(1).lower(): html.unescape(m.group(2) or m.group(3) or m.group(4) or "") for m in ATTR.finditer(tag)}


def card_of(page):
    """(app path, query values) of a share page whose canonical is an app page and that has a title and image, else None."""
    keys = {(a.get("property") or a.get("name") or "").lower() for a in map(attrs, META.findall(page))}
    if "og:title" not in keys or "og:image" not in keys:
        return None
    for a in map(attrs, LINK.findall(page)):
        if a.get("rel", "").lower() == "canonical" and a.get("href"):
            u = urlsplit(a["href"])
            if u.hostname != APP_HOST:
                return None
            return (u.path.rstrip("/") or "/"), dict(parse_qsl(u.query))
    return None


def committed_at(root, path):
    try:
        out = subprocess.run(["git", "--no-optional-locks", "-C", root, "log", "-1", "--format=%ct", "--", path],
                             capture_output=True, text=True, timeout=10).stdout.strip()
        return int(out or 0)
    except (OSError, ValueError, subprocess.SubprocessError):
        return 0


def build(root=ROOT):
    found = {}
    for dirpath, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs if not d.startswith((".", "_")))
        if dirpath == root or "index.html" not in files:
            continue
        slug = os.path.relpath(dirpath, root).replace(os.sep, "/")
        with open(os.path.join(dirpath, "index.html"), encoding="utf-8", errors="replace") as f:
            c = card_of(f.read())
        if not c:
            continue
        path, q = c
        found.setdefault((path.lower(), tuple(sorted(q.items()))), []).append((slug, path, q))

    cards = []
    for (lpath, _), group in found.items():
        # one card per page: the one named like it (cosmic-nov-8 for /cosmic-nov-8), else the newest
        named = lambda s: s.lower() in (lpath.strip("/"), lpath.rsplit("/", 1)[-1])
        group.sort(key=lambda g: (not named(g[0]), -committed_at(root, f"{g[0]}/index.html") if len(group) > 1 else 0, g[0]))
        slug, path, q = group[0]
        if named(slug) and not q:
            continue  # the edge finds it by name
        cards.append({"p": path, "s": slug, **({"q": q} if q else {})})
    cards.sort(key=lambda c: (c["p"].lower(), c["s"]))
    return {"v": 1, "about": "app.grateful.gg page -> grateful.gg card, for link previews (_tools/build_share_index.py)", "cards": cards}


def render(root=ROOT):
    return json.dumps(build(root), indent=0, ensure_ascii=False, separators=(",", ":")) + "\n"


def write(root=ROOT):
    """Rewrite the index if it changed. True if it did."""
    target = os.path.join(root, INDEX)
    new = render(root)
    try:
        with open(target, encoding="utf-8") as f:
            if f.read() == new:
                return False
    except FileNotFoundError:
        pass
    with open(target, "w", encoding="utf-8") as f:
        f.write(new)
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--root", default=ROOT)
    ap.add_argument("--check", action="store_true", help="exit 1 if share-index.json is out of date")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()
    if a.check:
        try:
            with open(os.path.join(a.root, INDEX), encoding="utf-8") as f:
                same = f.read() == render(a.root)
        except FileNotFoundError:
            same = False
        if not same:
            print(f"{INDEX} is out of date: run python3 -I _tools/build_share_index.py", file=sys.stderr)
        sys.exit(0 if same else 1)
    changed = write(a.root)
    if not a.quiet:
        n = len(build(a.root)["cards"])
        print(f"{INDEX}: {n} cards{' (updated)' if changed else ' (no change)'}")


if __name__ == "__main__":
    main()
