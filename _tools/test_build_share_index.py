"""Tests for build_share_index.py: python3 -I _tools/test_build_share_index.py"""
import json, os, subprocess, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_share_index as b  # noqa: E402


def card(app, title="A night", image=True):
    img = '<meta property="og:image" content="https://grateful.gg/x/cover.jpg">' if image else ""
    return f"""<!doctype html><html><head>
<title>{title}</title>
<meta property="og:title" content="{title}">
{img}
<link rel="canonical" href="{app}">
</head></html>"""


class BuildIndex(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()

    def put(self, slug, html):
        d = os.path.join(self.root, slug)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "index.html"), "w") as f:
            f.write(html)

    def test_maps_app_paths_to_cards(self):
        self.put("aibootcamp7", card("https://app.grateful.gg/ai/bootcamp7"))
        self.put("cosmic-nov-8", card("https://app.grateful.gg/cosmic-nov-8/"))
        self.put("aisafari/simar", card("https://app.grateful.gg/aisafari?ref=simar"))
        self.put("p-key", card("https://app.grateful.gg/p/sound-bath"))
        self.put("sound-bath", card("https://app.grateful.gg/p/sound-bath"))
        cards = b.build(self.root)["cards"]
        self.assertIn({"p": "/ai/bootcamp7", "s": "aibootcamp7"}, cards)
        self.assertIn({"p": "/aisafari", "s": "aisafari/simar", "q": {"ref": "simar"}}, cards)
        # named like their page (the path, or its last segment): the edge finds those itself
        self.assertEqual(len(cards), 2)

    def test_reads_escaped_query_values(self):
        self.put("aaronk", card("https://app.grateful.gg/invite?code=GIGI-AARON-720&amp;name=Aaron"))
        self.assertEqual(b.build(self.root)["cards"], [{"p": "/invite", "s": "aaronk", "q": {"code": "GIGI-AARON-720", "name": "Aaron"}}])

    def test_leaves_out_pages_that_are_not_app_cards(self):
        self.put("shop", card("https://grateful.gg/shop/"))
        self.put("pulse", "<html><head><title>Pulse</title></head></html>")
        self.put("noimage", card("https://app.grateful.gg/noimage", image=False))
        os.makedirs(os.path.join(self.root, "_tools", "x"))
        with open(os.path.join(self.root, "_tools", "x", "index.html"), "w") as f:
            f.write(card("https://app.grateful.gg/hidden"))
        self.assertEqual(b.build(self.root)["cards"], [])

    def test_one_card_per_page_preferring_the_one_named_like_it(self):
        self.put("cosmic-oct-25", card("https://app.grateful.gg/cosmic-nov-8"))
        self.put("cosmic-nov-8", card("https://app.grateful.gg/cosmic-nov-8"))
        self.put("calendar", card("https://app.grateful.gg/events"))
        self.put("events", card("https://app.grateful.gg/events"))
        self.put("abc", card("https://app.grateful.gg/claudewebinar6x"))
        self.put("webinar", card("https://app.grateful.gg/claudewebinar6x"))
        # the named cards win (and the edge finds them by name), so the old ones never take their page
        self.assertEqual(b.build(self.root)["cards"], [{"p": "/claudewebinar6x", "s": "abc"}])

    def test_write_only_when_changed_and_check_mode(self):
        self.put("aibootcamp7", card("https://app.grateful.gg/ai/bootcamp7"))
        self.assertTrue(b.write(self.root))
        self.assertFalse(b.write(self.root))
        with open(os.path.join(self.root, b.INDEX)) as f:
            self.assertEqual(json.load(f)["v"], 1)
        script = os.path.join(HERE, "build_share_index.py")
        ok = subprocess.run([sys.executable, "-I", script, "--root", self.root, "--check"], capture_output=True)
        self.assertEqual(ok.returncode, 0)
        self.put("aischool", card("https://app.grateful.gg/ai/school"))
        stale = subprocess.run([sys.executable, "-I", script, "--root", self.root, "--check"], capture_output=True)
        self.assertEqual(stale.returncode, 1)


if __name__ == "__main__":
    unittest.main()
