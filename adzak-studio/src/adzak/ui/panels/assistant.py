"""AI Assistant panel.

Offline knowledge base + generators always work. When a chat provider is
configured, free-form questions are forwarded to it (answers are labelled
with their source so users know what they're looking at).
"""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QComboBox, QFormLayout, QGroupBox, QHBoxLayout, QLabel, QLineEdit,
    QMessageBox, QPlainTextEdit, QPushButton, QVBoxLayout, QWidget,
)

from ...ai import assistant as asst
from ...ai.keystorage import KeyStore
from ...ai.providers import ChatProvider, ProviderConfig, ProviderError
from ...core.settings import Settings


class AssistantPanel(QWidget):
    def __init__(self, settings: Settings, tr=str, parent=None):
        super().__init__(parent)
        self.settings = settings
        self.tr = tr
        self.keys = KeyStore()
        self._build()

    def _provider(self) -> ChatProvider:
        cfg = ProviderConfig(
            provider=self.settings.get("ai/provider", "") or "",
            base_url=self.settings.get("ai/base_url", ""),
            chat_model=self.settings.get("ai/chat_model", "gpt-4o-mini"),
        )
        return ChatProvider(cfg, self.keys)

    def _build(self):
        root = QHBoxLayout(self)

        left = QVBoxLayout()
        chat_box = QGroupBox("Ask the assistant")
        cv = QVBoxLayout(chat_box)
        self.question = QPlainTextEdit()
        self.question.setPlaceholderText(
            "e.g. How do I export for TikTok? / How do I cut a clip?")
        self.question.setMaximumHeight(90)
        b_ask = QPushButton("Ask")
        b_ask.setObjectName("primary")
        b_ask.clicked.connect(self.ask)
        cv.addWidget(self.question); cv.addWidget(b_ask)
        self.answer = QPlainTextEdit(); self.answer.setReadOnly(True)
        self.answer.setPlaceholderText("Answers appear here (source labelled).")
        cv.addWidget(self.answer, 1)
        left.addWidget(chat_box, 1)

        gen = QGroupBox("Generators (offline)")
        gv = QVBoxLayout(gen)
        f = QFormLayout()
        self.topic = QLineEdit("My awesome tutorial")
        b_titles = QPushButton("Suggest titles")
        b_tags = QPushButton("Suggest hashtags")
        b_titles.clicked.connect(self.gen_titles)
        b_tags.clicked.connect(self.gen_tags)
        f.addRow("Topic", self.topic)
        row = QHBoxLayout(); row.addWidget(b_titles); row.addWidget(b_tags)
        f.addRow(row)
        gv.addLayout(f)
        sf = QFormLayout()
        self.script_title = QLineEdit("5 Tips for Better Videos")
        self.script_points = QLineEdit("hook, tip 1, tip 2, outro")
        b_script = QPushButton("Write script outline")
        b_script.clicked.connect(self.gen_script)
        sf.addRow("Script title", self.script_title)
        sf.addRow("Points (comma-separated)", self.script_points)
        sf.addRow(b_script)
        gv.addLayout(sf)
        pf = QFormLayout()
        self.prompt_subject = QLineEdit("a red sports car on a dune")
        self.prompt_style = QComboBox()
        self.prompt_style.addItems(["photorealistic", "cinematic", "anime",
                                    "3D render", "watercolor"])
        b_prompt = QPushButton("Build image prompt")
        b_prompt.clicked.connect(self.gen_prompt)
        pf.addRow("Subject", self.prompt_subject)
        pf.addRow("Style", self.prompt_style)
        pf.addRow(b_prompt)
        gv.addLayout(pf)
        ef = QFormLayout()
        self.exp_platform = QComboBox()
        self.exp_platform.addItems(["youtube", "tiktok", "instagram"])
        self.exp_duration = QLineEdit("60")
        b_exp = QPushButton("Recommend export settings")
        b_exp.clicked.connect(self.gen_export)
        ef.addRow("Platform", self.exp_platform)
        ef.addRow("Duration (s)", self.exp_duration)
        ef.addRow(b_exp)
        gv.addLayout(ef)
        left.addWidget(gen)

        right = QVBoxLayout()
        self.output = QPlainTextEdit(); self.output.setReadOnly(True)
        right.addWidget(QLabel("<b>Output</b>"))
        right.addWidget(self.output, 1)

        lw = QWidget(); lw.setLayout(left)
        rw = QWidget(); rw.setLayout(right); rw.setMaximumWidth(460)
        root.addWidget(lw, 3); root.addWidget(rw, 2)

    # ------------------------------------------------------------------
    def ask(self):
        q = self.question.toPlainText().strip()
        if not q:
            return
        provider = self._provider()
        ok, _why = provider.available()
        if ok:
            try:
                text = provider.complete(
                    "You are ADZAK's creative assistant. Answer concisely about "
                    "video/photo editing, export settings, titles and prompts.",
                    q, max_tokens=500)
                self.answer.setPlainText(f"[provider answer]\n{text}")
                return
            except ProviderError as e:
                self.answer.setPlainText(
                    f"[provider failed: {e}]\n\nFalling back to offline help.\n\n")
        reply = asst.answer(q)
        self.answer.setPlainText(f"[offline knowledge base]\n{reply.text}")

    def gen_titles(self):
        self.output.setPlainText("\n".join(
            f"{i}. {t}" for i, t in enumerate(
                asst.suggest_titles(self.topic.text()), 1)))

    def gen_tags(self):
        self.output.setPlainText(" ".join(asst.suggest_hashtags(self.topic.text())))

    def gen_script(self):
        points = [p.strip() for p in self.script_points.text().split(",") if p.strip()]
        self.output.setPlainText(
            asst.video_script(self.script_title.text() or "Untitled", points))

    def gen_prompt(self):
        self.output.setPlainText(
            asst.image_prompt(self.prompt_subject.text() or "a subject",
                              self.prompt_style.currentText()))

    def gen_export(self):
        try:
            dur = float(self.exp_duration.text() or 60)
        except ValueError:
            dur = 60.0
        rec = asst.recommend_export(self.exp_platform.currentText(), dur,
                                    bool(self.settings.get("ui/low_memory_mode")))
        self.output.setPlainText(
            f"Preset: {rec['label']}\n"
            f"Estimated size: {rec['estimated_size_mb']} MB\n{rec['note']}")
