#!/usr/bin/env python3
"""python3 -I _tools/test_build_agents_page.py"""
import copy, json, os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_agents_page as b

TOOLS = json.load(open(b.TOOLS, encoding="utf-8"))
PAGE = json.load(open(b.PAGE, encoding="utf-8"))


class AgentsPage(unittest.TestCase):
    def test_the_words_on_file_build(self):
        self.assertEqual(b.problems(TOOLS, PAGE), [])
        files = b.build()
        for t in TOOLS:
            self.assertIn(f'id="{t["name"]}"', files["index.html"])
        self.assertEqual(json.loads(files["tools.json"])["count"], len(TOOLS))

    def test_a_tool_without_an_example_stops_the_build(self):
        tools = TOOLS + [{"name": "brand_new_tool", "title": "New", "inputSchema": {"type": "object", "properties": {}}}]
        self.assertTrue(any("brand_new_tool" in p for p in b.problems(tools, PAGE)))

    def test_an_example_must_match_what_the_tool_takes(self):
        page = copy.deepcopy(PAGE)
        page["tools"]["get_page"]["call"] = {"page": "x"}
        wrong = b.problems(TOOLS, page)
        self.assertTrue(any("passes page" in p for p in wrong))
        self.assertTrue(any("leaves out event" in p for p in wrong))
        page = copy.deepcopy(PAGE)
        page["tools"]["list_guests"]["call"]["status"] = "maybe"
        self.assertTrue(any("must be one of" in p for p in b.problems(TOOLS, page)))

    def test_no_dashes_and_no_prices_in_the_words(self):
        page = copy.deepcopy(PAGE)
        page["hero"]["lede"] = "Plan it — run it."
        self.assertTrue(any("dash" in p for p in b.problems(TOOLS, page)))
        page = copy.deepcopy(PAGE)
        page["hero"]["lede"] = "Only $20 a seat."
        self.assertTrue(any("price" in p for p in b.problems(TOOLS, page)))

    def test_the_public_list_never_carries_the_long_descriptions(self):
        public = json.loads(b.build()["tools.json"])
        self.assertEqual([t["name"] for t in public["tools"]][:2], ["list_my_events", "get_page"])
        self.assertNotIn("description", public["tools"][0])
        self.assertEqual(public["tools"][1]["takes"], [{"name": "event", "required": True}])


if __name__ == "__main__":
    unittest.main()
