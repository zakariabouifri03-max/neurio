from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import parse_generated_files, parse_ollama_models, safe_workspace_target, workspace_context  # noqa: E402


class ParseGeneratedFilesTests(unittest.TestCase):
    def test_parses_multiple_tagged_files(self):
        answer = '''Created the app.
<file path="index.html">
<!doctype html>
<h1>Hello</h1>
</file>
<file path="src/app.js">
console.log("ready");
</file>'''
        self.assertEqual(
            parse_generated_files(answer),
            {
                "index.html": '<!doctype html>\n<h1>Hello</h1>',
                "src/app.js": 'console.log("ready");',
            },
        )

    def test_parses_markdown_file_fence(self):
        answer = """```file: src/main.py
print('hello')
```"""
        self.assertEqual(parse_generated_files(answer), {"src/main.py": "print('hello')"})

    def test_uses_target_for_single_unlabelled_code_block(self):
        self.assertEqual(
            parse_generated_files("Here is the code:\n```js\nalert('ok');\n```", "app.js"),
            {"app.js": "alert('ok');"},
        )

    def test_does_not_guess_between_multiple_unlabelled_blocks(self):
        answer = "```js\nconsole.log(1)\n```\n```css\nbody {}\n```"
        self.assertEqual(parse_generated_files(answer, "main.js"), {})

    def test_question_without_code_returns_no_files(self):
        self.assertEqual(parse_generated_files("You can use Canvas for a simple browser game."), {})


class OllamaModelListTests(unittest.TestCase):
    def test_parses_installed_model_names_and_skips_header(self):
        output = "NAME                 ID      SIZE    MODIFIED\nqwen2.5-coder:3b    abc123  2.0 GB  1 hour ago\nllama3.2:latest     def456  2.2 GB  2 days ago\nqwen3-coder:480b-cloud ghi789  0 B  1 hour ago\n"
        self.assertEqual(parse_ollama_models(output), ["qwen2.5-coder:3b", "llama3.2:latest"])


class WorkspaceSafetyTests(unittest.TestCase):
    def test_resolves_relative_path_inside_workspace(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertEqual(safe_workspace_target(root, "src/main.py"), root / "src" / "main.py")

    def test_rejects_parent_absolute_and_drive_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            for bad in ("../escape.py", "/tmp/escape.py", "C:/escape.py", "src/../../escape.py"):
                with self.subTest(path=bad), self.assertRaises(ValueError):
                    safe_workspace_target(directory, bad)

    def test_rejects_symlink_that_escapes_workspace(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as outside:
            root = Path(directory)
            link = root / "shortcut"
            try:
                link.symlink_to(Path(outside), target_is_directory=True)
            except (OSError, NotImplementedError):
                self.skipTest("Symlinks are not available in this environment")
            with self.assertRaises(ValueError):
                safe_workspace_target(root, "shortcut/escape.txt")

    def test_context_skips_env_and_build_folders(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "app.py").write_text("print('hello')", encoding="utf-8")
            (root / ".env").write_text("TOKEN=do-not-share", encoding="utf-8")
            (root / "node_modules").mkdir()
            (root / "node_modules" / "dep.js").write_text("private dependency", encoding="utf-8")
            context = workspace_context(root)
            self.assertIn("app.py", context)
            self.assertNotIn("do-not-share", context)
            self.assertNotIn("private dependency", context)


if __name__ == "__main__":
    unittest.main()
