"""Run with:  python3 -m unittest -v tools/coder/test_coder.py   (stdlib only)"""
from __future__ import annotations

import http.server
import json
import os
import sys
import threading
import unittest
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import engine  # noqa: E402
import server  # noqa: E402
import templates as T  # noqa: E402


class MatchingTests(unittest.TestCase):
    CASES = {
        "snake game": "snake",
        "make me a snake game": "snake",
        "لعبة ثعبان": "snake",
        "lo3ba dyal snake": "snake",
        "jeu serpent": "snake",
        "ping pong game": "pong",
        "pong": "pong",
        "breakout game": "breakout",
        "casse-brique": "breakout",
        "tic tac toe": "tictactoe",
        "morpion": "tictactoe",
        "اكس او": "tictactoe",
        "memory game": "memory",
        "لعبة الذاكرة": "memory",
        "todo app": "todo",
        "app dyal to-do": "todo",
        "مهام": "todo",
        "calculator": "calculator",
        "calculatrice": "calculator",
        "آلة حاسبة": "calculator",
        "pomodoro timer": "pomodoro",
        "مؤقت": "pomodoro",
        "expense tracker": "expenses",
        "مصاريف": "expenses",
        "password generator": "password",
        "mot de passe": "password",
        "كلمة السر": "password",
        "flappy bird": "flappy",
        "tayer": "flappy",
        "space shooter": "shooter",
        "catch game": "catch",
        "whack a mole": "whack",
        "simon says": "simon",
        "notes app": "notes",
        "convertisseur": "converter",
        "لعبة الخلد": "whack",
        "dice": "dice",
        "zar": "dice",
        "stopwatch": "stopwatch",
        "ساعة ايقاف": "stopwatch",
        # generic fall-backs
        "a game": "snake",
        "lo3ba": "snake",
        "small app": "todo",
    }

    def test_known_prompts(self):
        for prompt, key in self.CASES.items():
            with self.subTest(prompt=prompt):
                tpl = engine.match_template(prompt)
                self.assertIsNotNone(tpl, prompt)
                self.assertEqual(tpl.key, key)

    def test_no_match(self):
        for prompt in ["weather forecast", "write a poem", "xyz"]:
            with self.subTest(prompt=prompt):
                self.assertIsNone(engine.match_template(prompt))

    def test_xo_is_whole_word_only(self):
        # "xo" must not fire inside unrelated words
        self.assertIsNone(engine.match_template("xoxo poem"))
        self.assertEqual(engine.match_template("xo game").key, "tictactoe")

    def test_normalize_arabic(self):
        self.assertEqual(engine.normalize("لُعْبَةٌ"), engine.normalize("لعبه"))
        self.assertEqual(engine.normalize("إكس أو"), engine.normalize("اكس او"))


class ThemeAndLevelTests(unittest.TestCase):
    def test_theme_detection(self):
        self.assertEqual(engine.detect_theme("space snake")["key"], "space")
        self.assertEqual(engine.detect_theme("لعبة ثعبان فالشاطئ")["key"], "beach")
        self.assertEqual(engine.detect_theme("lo3ba dyal snake b nar")["key"], "fire")
        self.assertEqual(engine.detect_theme("snake game")["key"], "default")

    def test_level_detection(self):
        self.assertEqual(engine.detect_level("hard pong"), 1.4)
        self.assertEqual(engine.detect_level("easy snake"), 0.7)
        self.assertEqual(engine.detect_level("صعب"), 1.4)
        self.assertEqual(engine.detect_level("pong"), 1.0)

    def test_theme_is_applied_to_output(self):
        r = engine.generate("space flappy bird, hard")
        self.assertTrue(r.ok)
        self.assertEqual(r.name, "flappy")
        self.assertIn("#a855f7", r.html)          # space accent colour
        self.assertIn("<title>Space Flappy</title>", r.html)
        self.assertIn("const LEVEL=1.4", r.html)
        self.assertIn("theme: Space", r.message)

    def test_default_theme_title(self):
        r = engine.generate("snake")
        self.assertIn("<title>Snake</title>", r.html)


class TemplateOutputTests(unittest.TestCase):
    def test_every_template_is_a_complete_page(self):
        for tpl in T.TEMPLATES.values():
            with self.subTest(tpl=tpl.key):
                page = tpl.build()
                self.assertTrue(page.startswith("<!DOCTYPE html>"))
                self.assertIn("<script>", page)
                self.assertIn("</html>", page)
                self.assertIn("<title>", page)
                # offline: no external resources of any kind
                self.assertNotIn("http://", page.split("<body>")[0] + page.split("</body>")[-1])
                self.assertNotIn("<link", page)
                self.assertNotIn("src=\"http", page)
                self.assertNotIn("src='http", page)

    def test_every_template_builds_with_every_theme(self):
        for tpl in T.TEMPLATES.values():
            for theme in T.THEMES.values():
                with self.subTest(tpl=tpl.key, theme=theme["key"]):
                    page = tpl.build(theme=theme, level=1.4)
                    self.assertIn("</html>", page)
                    self.assertIn("const THEME=", page)

    def test_templates_are_unique_and_registered(self):
        self.assertEqual(len(T.TEMPLATES), len({t.key for t in T.TEMPLATES.values()}))
        self.assertGreaterEqual(sum(1 for t in T.TEMPLATES.values() if t.kind == "game"), 5)
        self.assertGreaterEqual(sum(1 for t in T.TEMPLATES.values() if t.kind == "app"), 5)

    def test_safe_evaluator_in_calculator(self):
        # The calculator's evaluator is JS; we check its presence and that eval is not used.
        page = T.calculator()
        self.assertIn("function evaluate(", page)
        self.assertNotIn("Function(", page)
        self.assertNotIn("eval(", page)


class GenerateTests(unittest.TestCase):
    def test_empty_prompt(self):
        r = engine.generate("   ")
        self.assertFalse(r.ok)

    def test_template_generate(self):
        r = engine.generate("snake game")
        self.assertTrue(r.ok)
        self.assertEqual(r.name, "snake")
        self.assertEqual(r.backend, "template")
        self.assertIn("Snake", r.html)

    def test_prompt_too_long(self):
        r = engine.generate("snake " * 1000)
        self.assertFalse(r.ok)

    def test_unknown_backend(self):
        self.assertFalse(engine.generate("snake", backend="cloud").ok)

    def test_template_only_no_match(self):
        r = engine.generate("write a poem", backend="template")
        self.assertFalse(r.ok)
        self.assertIn("Snake", r.message)

    def test_slugify(self):
        self.assertEqual(engine.slugify("My Cool App!!"), "my-cool-app")
        self.assertEqual(engine.slugify("لعبة"), "app")


class ExtractHtmlTests(unittest.TestCase):
    def test_fenced_block(self):
        text = "Here you go:\n```html\n<!DOCTYPE html><html><body><script>1</script></body></html>\n```\nEnjoy"
        html = engine.extract_html(text)
        self.assertTrue(html.lower().startswith("<!doctype html"))
        self.assertIn("</html>", html)

    def test_unfenced_and_unclosed(self):
        html = engine.extract_html("<html><body><script>x()</script>")
        self.assertIn("</html>", html)

    def test_rejects_non_html(self):
        self.assertIsNone(engine.extract_html("sorry, I cannot do that"))
        self.assertIsNone(engine.extract_html("<html><p>no code</p></html>"))


class OllamaTests(unittest.TestCase):
    """Fake Ollama on 127.0.0.1 so tests never need the real thing."""

    @classmethod
    def setUpClass(cls):
        reply = "```html\n<!DOCTYPE html><html><body><script>console.log(1)</script></body></html>\n```"

        class Fake(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                body = json.dumps({"models": [{"name": "qwen2.5-coder:7b"}]}).encode()
                self._ok(body)

            def do_POST(self):
                n = int(self.headers.get("Content-Length", 0))
                req = json.loads(self.rfile.read(n))
                assert req["stream"] is False
                body = json.dumps({"response": reply, "model": req["model"]}).encode()
                self._ok(body)

            def _ok(self, body):
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        cls.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Fake)
        cls.host = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def test_models_listed(self):
        self.assertEqual(engine.ollama_models(self.host), ["qwen2.5-coder:7b"])

    def test_generate_uses_local_model(self):
        html = engine.ollama_generate("a bouncing ball", "qwen2.5-coder:7b", self.host)
        self.assertIn("console.log(1)", html)

    def test_not_running_returns_none(self):
        # port 9 (discard) is essentially never an Ollama server
        self.assertIsNone(engine.ollama_models("http://127.0.0.1:9", timeout=0.5))

    def test_remote_host_refused(self):
        old = os.environ.get("OLLAMA_HOST")
        try:
            os.environ["OLLAMA_HOST"] = "http://example.com:11434"
            with self.assertRaises(engine.OllamaError):
                engine.ollama_host()
            os.environ["OLLAMA_HOST"] = "0.0.0.0:11434"  # bind address -> connect locally
            self.assertEqual(engine.ollama_host(), "http://127.0.0.1:11434")
        finally:
            if old is None:
                os.environ.pop("OLLAMA_HOST", None)
            else:
                os.environ["OLLAMA_HOST"] = old


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = server.make_server(0)
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def _post(self, payload: dict):
        req = urllib.request.Request(
            self.base + "/api/generate", data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=5) as r:
            return json.loads(r.read())

    def test_index_served(self):
        with urllib.request.urlopen(self.base + "/", timeout=5) as r:
            body = r.read().decode()
            self.assertIn("Offline Coder", body)
            self.assertEqual(r.headers["Content-Type"], "text/html; charset=utf-8")

    def test_status(self):
        with urllib.request.urlopen(self.base + "/api/status", timeout=5) as r:
            data = json.loads(r.read())
        self.assertGreaterEqual(len(data["templates"]), 10)
        self.assertIn("ollama", data)

    def test_generate_ok(self):
        data = self._post({"prompt": "pong", "backend": "auto"})
        self.assertTrue(data["ok"])
        self.assertEqual(data["name"], "pong")
        self.assertIn("<canvas", data["html"])

    def test_generate_bad_request(self):
        data = self._post({"prompt": "weather", "backend": "template"})
        self.assertFalse(data["ok"])

    def test_bad_json(self):
        req = urllib.request.Request(
            self.base + "/api/generate", data=b"{nope", method="POST",
            headers={"Content-Type": "application/json"})
        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(req, timeout=5)
        self.assertEqual(cm.exception.code, 400)

    def test_unknown_path(self):
        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(self.base + "/nope", timeout=5)
        self.assertEqual(cm.exception.code, 404)


if __name__ == "__main__":
    unittest.main()
