#!/usr/bin/env python3
"""grateful.gg/agents: the Oasis for AI agents, one plain page made from the connector's own tool list.

    python3 -I _tools/build_agents_page.py            # rewrite agents/index.html and agents/tools.json
    python3 -I _tools/build_agents_page.py --check    # exit 1 if they are out of date

Reads  _tools/agents/tools.json   the connector's tools, as an MCP client gets them (dump_connector_tools.ts refreshes it)
       _tools/agents/page.json    the page's words: hero, how to connect, what waits for a yes, and one example per tool
Writes agents/index.html          the page (static HTML, no script needed to read it; agents/cover.jpg is its share card)
       agents/tools.json          the same list for machines: name, title, what it takes, the example

It stops when a tool has no example, an example names an argument the tool doesn't take or misses one it needs, or
the words carry an em or en dash or a price. So the page lists every tool, or it doesn't build.
"""
import argparse, html, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TOOLS = os.path.join(HERE, "agents", "tools.json")
PAGE = os.path.join(HERE, "agents", "page.json")
OUT_DIR = os.path.join(ROOT, "agents")
URL = "https://grateful.gg/agents"
COVER_MAX = 290_000

e = html.escape


def problems(tools, page):
    """Everything wrong with the words, as a list of sentences. Empty means the page can be built."""
    out = []
    names = [t["name"] for t in tools]
    grouped = [n for g in page["groups"] for n in g["tools"]]
    for n in names:
        if grouped.count(n) != 1:
            out.append(f"{n}: must be in exactly one group (it is in {grouped.count(n)})")
        if n not in page["tools"]:
            out.append(f"{n}: no line, ask and call in page.json")
    for n in grouped:
        if n not in names:
            out.append(f"{n}: grouped in page.json but the connector has no such tool")
    by_name = {t["name"]: t for t in tools}
    for n, w in page["tools"].items():
        t = by_name.get(n)
        if not t:
            out.append(f"{n}: an example for a tool the connector doesn't have")
            continue
        for k in ("line", "ask"):
            if not str(w.get(k, "")).strip():
                out.append(f"{n}: {k} is empty")
        call = w.get("call")
        if not isinstance(call, dict):
            out.append(f"{n}: call must be an object")
            continue
        schema = t.get("inputSchema") or {}
        props = schema.get("properties") or {}
        for k in call:
            if k not in props:
                out.append(f"{n}: the example passes {k}, which the tool doesn't take")
            elif "enum" in props[k] and call[k] not in props[k]["enum"]:
                out.append(f"{n}: {k} must be one of {props[k]['enum']}")
        for k in schema.get("required") or []:
            if k not in call:
                out.append(f"{n}: the example leaves out {k}, which the tool needs")
    words = json.dumps({k: v for k, v in page.items() if k != "_about"}, ensure_ascii=False)
    if re.search("[–—]", words):
        out.append("the words carry an em or en dash: use a comma, a period or ' · '")
    if re.search(r"[$€£]\s?\d|\d\s?(?:dollars|USD)\b", words):
        out.append("the words state a price: the page never does")
    return out


def reads_only(t):
    return bool((t.get("annotations") or {}).get("readOnlyHint"))


def takes(t):
    schema = t.get("inputSchema") or {}
    need = set(schema.get("required") or [])
    return [{"name": k, "required": k in need} for k in (schema.get("properties") or {})]


def public_tools(tools, page):
    """agents/tools.json: what a machine needs to know before it connects. The full schemas come from tools/list after sign-in."""
    group_of = {n: g["title"] for g in page["groups"] for n in g["tools"]}
    order = [n for g in page["groups"] for n in g["tools"]]
    by_name = {t["name"]: t for t in tools}
    return {
        "name": "The Oasis connector",
        "mcp": page["address"],
        "transport": "Streamable HTTP, OAuth 2.1 sign-in",
        "page": URL,
        "count": len(order),
        "tools": [
            {
                "name": n, "title": by_name[n].get("title", ""), "group": group_of[n], "reads_only": reads_only(by_name[n]),
                "summary": page["tools"][n]["line"], "takes": takes(by_name[n]),
                "example": {"ask": page["tools"][n]["ask"], "call": {"name": n, "arguments": page["tools"][n]["call"]}},
            }
            for n in order
        ],
    }


CSS = """
:root{--ink:#26211b;--soft:#6f675f;--line:#eadfce;--paper:#fffaf3;--card:#ffffff;--accent:#b45309;--accent-ink:#ffffff;--wash:#fff3df;--code:#2b241c}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;color:var(--ink);font:400 17px/1.6 "DM Sans",system-ui,-apple-system,"Segoe UI",sans-serif;background:linear-gradient(160deg,#fff4e2 0%,#fffaf3 38%,#ffffff 100%) fixed;text-rendering:optimizeLegibility}
.wrap{width:min(100% - 40px,1040px);margin-inline:auto}
h1,h2,h3{font-family:"Libre Bodoni","Bodoni 72",Didot,Georgia,serif;font-weight:700;line-height:1.08;margin:0;text-wrap:balance}
p{margin:0}
a{color:var(--accent);text-underline-offset:3px}
a:hover{text-decoration-thickness:2px}
code,pre{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:.84em}
.label{font-size:12px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:var(--accent)}
.top{position:sticky;top:0;z-index:5;background:rgba(255,250,243,.86);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.top .wrap{display:flex;align-items:center;justify-content:space-between;height:56px}
.top a.home{font-family:"Libre Bodoni",Georgia,serif;font-weight:700;font-size:19px;color:var(--ink);text-decoration:none}
.top nav{display:flex;gap:22px}
.top nav a{font-size:14px;font-weight:500;color:var(--soft);text-decoration:none}
.top nav a:hover{color:var(--ink)}
.hero{min-height:calc(100svh - 57px);display:flex;align-items:center;padding:clamp(20px,5svh,56px) 0}
.hero h1{font-size:clamp(38px,min(8.4vw,11svh),92px);letter-spacing:-.015em;margin:clamp(10px,2svh,20px) 0 clamp(12px,2.4svh,24px)}
.hero h1 span{display:block}
.hero .lede{max-width:60ch;font-size:clamp(16px,2.3svh,20px);color:var(--soft)}
.address{display:flex;flex-wrap:wrap;align-items:stretch;gap:10px;margin-top:clamp(16px,3.4svh,34px)}
.address code{flex:1 1 300px;min-width:0;display:flex;align-items:center;padding:13px 18px;border:1px solid var(--line);border-radius:999px;background:var(--card);font-size:15px;color:var(--code);overflow-x:auto;white-space:nowrap}
.btn{appearance:none;border:0;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:14px 26px;border-radius:999px;background:var(--accent);color:var(--accent-ink);font:700 13px/1 "DM Sans",system-ui,sans-serif;letter-spacing:.18em;text-transform:uppercase;text-decoration:none;transition:transform .15s ease,background-color .15s ease}
.btn:hover{background:#9a4507;transform:translateY(-1px)}
.btn:active{transform:translateY(1px)}
.btn:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.under{display:flex;flex-wrap:wrap;align-items:center;gap:8px 22px;margin-top:clamp(12px,2.2svh,22px);font-size:14px;color:var(--soft)}
.under ul{display:flex;flex-wrap:wrap;gap:6px 18px;list-style:none;margin:0;padding:0}
.under li+li::before{content:"·";margin-right:18px;color:var(--line)}
section{padding:clamp(48px,8vw,96px) 0;border-top:1px solid var(--line)}
section h2{font-size:clamp(30px,4.6vw,52px);margin:10px 0 14px}
section .intro{max-width:62ch;color:var(--soft);margin-bottom:28px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr));gap:18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:24px;padding:24px 26px}
.card h3{font-size:24px;margin-bottom:10px}
.card ol{margin:0;padding-left:20px;color:var(--soft)}
.card pre,.tool pre{margin:0 0 12px;padding:12px 14px;border-radius:14px;background:var(--wash);color:var(--code);overflow-x:auto;white-space:pre-wrap;word-break:break-word}
.other{margin-top:22px;max-width:70ch;color:var(--soft)}
.more{margin-top:14px}
.rules{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:0 44px;margin:0;padding:0;list-style:none}
.rules li{padding:18px 0;border-top:1px solid var(--line)}
.rules strong{display:block;font-family:"Libre Bodoni",Georgia,serif;font-size:21px;line-height:1.2;margin-bottom:4px}
.rules span{color:var(--soft)}
.open{margin:0;padding:0;list-style:none}
.open li{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,6fr);gap:6px 28px;padding:16px 0;border-top:1px solid var(--line)}
.open a{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:14.5px;overflow-wrap:anywhere}
.open span{color:var(--soft)}
.group{margin-top:44px}
.group>h3{font-size:clamp(24px,3vw,32px)}
.group>p{color:var(--soft);margin:6px 0 16px}
.tools{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}
.tool{background:var(--card);border:1px solid var(--line);border-radius:24px;padding:22px 24px;min-width:0;scroll-margin-top:76px}
.tool header{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 12px;margin-bottom:8px}
.tool h4{margin:0;font:600 16.5px/1.3 ui-monospace,"SF Mono",Menlo,Consolas,monospace;color:var(--code)}
.tool .kind{font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);border:1px solid #f1d9b5;background:var(--wash);border-radius:999px;padding:3px 10px}
.tool .kind.reads{color:#3f6b4f;border-color:#cfe3d5;background:#eef7f0}
.tool .what{margin-bottom:14px}
.tool dl{margin:0}
.tool dt{font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--soft);margin-bottom:4px}
.tool dd{margin:0 0 12px}
.tool dd:last-child,.tool dd:last-child pre{margin-bottom:0}
.tool .ask{font-family:"Libre Bodoni",Georgia,serif;font-size:19px;line-height:1.3}
footer{border-top:1px solid var(--line);padding:36px 0 56px;color:var(--soft);font-size:14.5px}
footer .wrap{display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px 28px}
footer nav{display:flex;flex-wrap:wrap;gap:8px 22px}
@media (max-width:760px){
  body{font-size:16px}
  .top nav a:not(:last-child){display:none}
  .tools{grid-template-columns:1fr}
  .open li{grid-template-columns:1fr}
  .address code{flex-basis:100%;font-size:13.5px;padding:12px 16px}
  .btn{width:100%}
  .under li+li::before{margin-right:12px}
  .under ul{gap:6px 12px}
}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}.btn{transition:none}}
"""

SCRIPT = """
(function(){var b=document.querySelector('[data-copy]');if(!b||!navigator.clipboard)return;
b.addEventListener('click',function(){navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function(){
var t=b.textContent;b.textContent=b.getAttribute('data-done');setTimeout(function(){b.textContent=t},1800)})})})();
"""


def render(tools, page):
    by_name = {t["name"]: t for t in tools}
    count = len(tools)
    fill = lambda s: s.replace("{count}", str(count))
    m, h, c, a, o, ts = page["meta"], page["hero"], page["connect"], page["approval"], page["open"], page["tools_section"]
    title, desc = fill(m["title"]), fill(m["description"])
    addr = page["address"]

    def client(cl):
        code = f'<pre><code>{e(cl["code"])}</code></pre>' if cl.get("code") else ""
        steps = "".join(f"<li>{e(s)}</li>" for s in cl["steps"])
        return f'<div class="card"><h3>{e(cl["name"])}</h3>{code}<ol>{steps}</ol></div>'

    def tool(n):
        t, w = by_name[n], page["tools"][n]
        ro = reads_only(t)
        call = json.dumps({"name": n, "arguments": w["call"]}, indent=2, ensure_ascii=False)
        return (
            f'<article class="tool" id="{e(n)}"><header><h4>{e(n)}</h4>'
            f'<span class="kind{" reads" if ro else ""}">{e(ts["reads"] if ro else ts["changes"])}</span></header>'
            f'<p class="what">{e(w["line"])}</p><dl>'
            f'<dt>{e(ts["ask_label"])}</dt><dd class="ask">{e(w["ask"])}</dd>'
            f'<dt>{e(ts["call_label"])}</dt><dd><pre><code>{e(call)}</code></pre></dd></dl></article>'
        )

    groups = "".join(
        f'<div class="group"><h3>{e(g["title"])}</h3><p>{e(g["intro"])}</p><div class="tools">{"".join(tool(n) for n in g["tools"])}</div></div>'
        for g in page["groups"]
    )
    h1 = "".join(f"<span>{e(part.strip())}</span>" for part in re.findall(r"[^.]+\.", h["title"])) or e(h["title"])
    facts = "".join(f"<li>{e(fill(f))}</li>" for f in h["facts"])
    rules = "".join(f"<li><strong>{e(k)}</strong><span>{e(v)}</span></li>" for k, v in a["lines"])
    opens = "".join(f'<li><a href="{e(u)}">{e(u.replace("https://", ""))}</a><span>{e(v)}</span></li>' for u, v in o["items"])
    foot = "".join(f'<a href="{e(u)}">{e(k)}</a>' for k, u in page["footer"]["links"])
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)} · Grateful Giraffes</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{URL}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="The Oasis">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:url" content="{URL}">
<meta property="og:image" content="{URL}/cover.jpg">
<meta property="og:image:secure_url" content="{URL}/cover.jpg">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="{e(m["card_alt"])}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{e(title)}">
<meta name="twitter:description" content="{e(desc)}">
<meta name="twitter:image" content="{URL}/cover.jpg">
<link rel="alternate" type="application/json" href="{URL}/tools.json" title="The Oasis connector tools">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700&family=Libre+Bodoni:wght@700&display=swap" rel="stylesheet">
<style>{CSS}</style>
</head>
<body>
<!-- Made by _tools/build_agents_page.py from the Oasis connector's tool list and _tools/agents/page.json. Edit those, not this file. -->
<div class="top"><div class="wrap"><a class="home" href="https://app.grateful.gg/">The Oasis</a>
<nav><a href="#connect">Connect</a><a href="#approval">Approval</a><a href="#open">Open data</a><a href="#tools">Tools</a></nav></div></div>
<main>
<div class="hero"><div class="wrap">
<p class="label">{e(h["eyebrow"])}</p>
<h1>{h1}</h1>
<p class="lede">{e(h["lede"])}</p>
<div class="address"><code>{e(addr)}</code><button class="btn" type="button" data-copy="{e(addr)}" data-done="{e(h["copied"])}">{e(h["copy_button"])}</button></div>
<div class="under"><ul>{facts}</ul><a href="#tools">{e(h["tools_link"])}</a></div>
</div></div>
<section id="connect"><div class="wrap">
<p class="label">Step by step</p>
<h2>{e(c["title"])}</h2>
<p class="intro">{e(c["intro"])}</p>
<div class="cards">{"".join(client(cl) for cl in c["clients"])}</div>
{f'<p class="other">{e(c["other"])}</p>' if c.get("other") else ""}
<p class="more"><a href="{e(c["more"]["href"])}">{e(c["more"]["text"])}</a></p>
</div></section>
<section id="approval"><div class="wrap">
<p class="label">Agents propose, people approve</p>
<h2>{e(a["title"])}</h2>
<p class="intro">{e(a["intro"])}</p>
<ul class="rules">{rules}</ul>
</div></section>
<section id="open"><div class="wrap">
<p class="label">For any agent</p>
<h2>{e(o["title"])}</h2>
<p class="intro">{e(o["intro"])}</p>
<ul class="open">{opens}</ul>
</div></section>
<section id="tools"><div class="wrap">
<p class="label">{count} tools</p>
<h2>{e(ts["title"])}</h2>
<p class="intro">{e(ts["intro"])}</p>
{groups}
</div></section>
</main>
<footer><div class="wrap"><p>{e(page["footer"]["line"])}</p><nav>{foot}</nav></div></footer>
<script>{SCRIPT}</script>
</body>
</html>
"""


def build():
    tools = json.load(open(TOOLS, encoding="utf-8"))
    page = json.load(open(PAGE, encoding="utf-8"))
    wrong = problems(tools, page)
    if wrong:
        raise SystemExit("agents page not built:\n  " + "\n  ".join(wrong))
    return {
        "index.html": render(tools, page),
        "tools.json": json.dumps(public_tools(tools, page), indent=1, ensure_ascii=False) + "\n",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    files = build()
    stale = []
    for name, text in files.items():
        path = os.path.join(OUT_DIR, name)
        old = open(path, encoding="utf-8").read() if os.path.exists(path) else None
        if old != text:
            stale.append(name)
            if not args.check:
                os.makedirs(OUT_DIR, exist_ok=True)
                open(path, "w", encoding="utf-8").write(text)
    cover = os.path.join(OUT_DIR, "cover.jpg")
    if not os.path.exists(cover):
        print("note: agents/cover.jpg (the 1200x630 share card) is missing", file=sys.stderr)
    elif os.path.getsize(cover) > COVER_MAX:
        raise SystemExit(f"agents/cover.jpg is over {COVER_MAX} bytes: WhatsApp would show no picture")
    if args.check and stale:
        raise SystemExit("out of date: " + ", ".join(stale) + " (run python3 -I _tools/build_agents_page.py)")
    print(("up to date" if not stale else ("out of date: " if args.check else "wrote ") + ", ".join(stale)) + f" ({len(json.loads(files['tools.json'])['tools'])} tools)")


if __name__ == "__main__":
    main()
