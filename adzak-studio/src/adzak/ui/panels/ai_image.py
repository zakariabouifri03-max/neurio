"""AI Image Studio.

Generation only happens through a real, user-configured provider. When no
provider/key is configured, the UI says so explicitly — it never renders a
placeholder and calls it AI output.
"""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import (
    QComboBox, QFileDialog, QFormLayout, QGroupBox, QHBoxLayout, QLabel,
    QLineEdit, QMessageBox, QPlainTextEdit, QProgressBar, QPushButton,
    QSpinBox, QVBoxLayout, QWidget,
)

from ...ai.capabilities import by_studio
from ...ai.keystorage import KeyStore
from ...ai.providers import ImageProvider, ProviderConfig, ProviderError
from ...core.jobs import Job
from ...core.settings import Settings


class AIImagePanel(QWidget):
    def __init__(self, runner, settings: Settings, tr=str, parent=None):
        super().__init__(parent)
        self.runner = runner
        self.settings = settings
        self.tr = tr
        self.keys = KeyStore()
        self._build()
        self.runner.job_finished.connect(self._done)

    def _provider(self) -> ImageProvider:
        cfg = ProviderConfig(
            provider=self.settings.get("ai/provider", "openai") or "openai",
            base_url=self.settings.get("ai/base_url", ""),
            chat_model=self.settings.get("ai/chat_model", ""),
            image_model=self.settings.get("ai/image_model", ""),
        )
        return ImageProvider(cfg, self.keys)

    def _build(self):
        root = QHBoxLayout(self)
        left = QVBoxLayout()

        status_box = QGroupBox("Service status")
        sv = QVBoxLayout(status_box)
        self.status_label = QLabel()
        self.status_label.setWordWrap(True)
        sv.addWidget(self.status_label)
        features = QLabel("\n".join(
            f"• {f.label} — {f.status.value}" for f in by_studio("image")))
        features.setObjectName("hint")
        sv.addWidget(features)
        left.addWidget(status_box)

        form = QGroupBox("Generate")
        f = QFormLayout(form)
        self.prompt = QPlainTextEdit()
        self.prompt.setPlaceholderText("Describe the image you want…")
        self.prompt.setMaximumHeight(110)
        self.negative = QLineEdit()
        self.negative.setPlaceholderText("Negative prompt (if supported by provider)")
        self.size = QComboBox()
        self.size.addItems(["1024x1024", "1024x1536", "1536x1024", "512x512"])
        self.count = QSpinBox(); self.count.setRange(1, 4); self.count.setValue(1)
        f.addRow("Prompt", self.prompt)
        f.addRow("Negative", self.negative)
        f.addRow("Size", self.size)
        f.addRow("Images", self.count)
        left.addWidget(form)

        tools = QGroupBox("Local tools (offline, free)")
        tv = QVBoxLayout(tools)
        self.up_img = QLineEdit(); self.up_img.setReadOnly(True)
        b_pick = QPushButton("Choose image…")
        b_pick.clicked.connect(self._pick_upscale_src)
        row = QHBoxLayout(); row.addWidget(self.up_img, 1); row.addWidget(b_pick)
        self.up_w = QSpinBox(); self.up_w.setRange(64, 8192); self.up_w.setValue(2048)
        b_up = QPushButton("Enlarge (Lanczos) → PNG")
        b_up.clicked.connect(self.upscale)
        tv.addLayout(row)
        h2 = QHBoxLayout(); h2.addWidget(QLabel("Target width")); h2.addWidget(self.up_w, 1)
        tv.addLayout(h2)
        tv.addWidget(b_up)
        left.addWidget(tools)

        self.gen_btn = QPushButton("Generate with provider")
        self.gen_btn.setObjectName("primary")
        self.gen_btn.clicked.connect(self.generate)
        left.addWidget(self.gen_btn)
        self.progress = QProgressBar(); self.progress.setRange(0, 0)
        self.progress.setVisible(False)
        left.addWidget(self.progress)
        left.addStretch(1)

        self.result = QLabel(alignment=Qt.AlignCenter)
        self.result.setStyleSheet("background:#0c0d10; border-radius:8px;")
        self.result.setMinimumSize(380, 380)
        self.result.setText("No image generated yet")
        self.result.setWordWrap(True)

        lw = QWidget(); lw.setLayout(left); lw.setMaximumWidth(430)
        root.addWidget(lw); root.addWidget(self.result, 1)
        self._refresh_status()

    def _refresh_status(self):
        ok, why = self._provider().available()
        if ok:
            self.status_label.setText(
                f"<span style='color:#58c470'>● Provider connected</span> "
                f"({self.settings.get('ai/provider')}) — image model: "
                f"{self.settings.get('ai/image_model') or 'not set'}")
        else:
            self.status_label.setText(
                f"<span style='color:#e0a63f'>● API features unavailable</span><br>{why}<br>"
                "Local tools below still work without any key.")

    def _pick_upscale_src(self):
        p, _ = QFileDialog.getOpenFileName(self, "Image", "",
                                           "Images (*.png *.jpg *.jpeg *.webp *.bmp)")
        if p:
            self.up_img.setText(p)

    def upscale(self):
        src = self.up_img.text()
        if not src:
            return
        dest, _ = QFileDialog.getSaveFileName(self, "Save enlarged image",
                                              Path(src).stem + "_upscaled.png", "PNG (*.png)")
        if not dest:
            return

        def fn(*_):
            from ...services import image_ops
            img = image_ops.load_rgba(src)
            ratio = self.up_w.value() / img.width
            out = img.resize((self.up_w.value(), max(1, round(img.height * ratio))),
                             __import__("PIL.Image", fromlist=["Image"]).LANCZOS)
            return image_ops.save_image(out, dest)

        self.runner.submit(Job(fn=fn, title="Enlarge image"))
        self.progress.setVisible(True)

    def generate(self):
        provider = self._provider()
        ok, why = provider.available()
        if not ok:
            QMessageBox.warning(self, "AI provider not configured",
                                why + "\n\nADZAK does not simulate generation. "
                                "Configure the provider in Settings → AI Providers, "
                                "or use the local tools which work offline.")
            return
        prompt = self.prompt.toPlainText().strip()
        if not prompt:
            QMessageBox.warning(self, self.tr("common.warning"), "Write a prompt first.")
            return

        def fn(report, cancel):
            report(0.05, "contacting provider")
            images = provider.generate(prompt, self.negative.text().strip(),
                                       self.size.currentText(), self.count.value())
            saved = []
            for i, blob in enumerate(images):
                dest = self.settings and self._save_generated(blob, i)
                saved.append(dest)
            report(1.0, "done")
            return saved

        self.runner.submit(Job(fn=fn, title=f"Generate: {prompt[:40]}"))
        self.progress.setVisible(True)
        self.result.setText("Contacting provider… (this can take a while)")

    def _save_generated(self, blob: bytes, index: int) -> str:
        from ...core import paths
        out = paths.cache_dir() / f"ai_generated_{index}_{abs(hash(blob[:16])) % 99999}.png"
        out.write_bytes(blob)
        return str(out)

    def _done(self, job: Job):
        if "Generate" not in job.title and job.title != "Enlarge image":
            return
        self.progress.setVisible(False)
        if job.result and job.result.ok and job.result.value:
            first = job.result.value[0]
            pm = QPixmap(first)
            if not pm.isNull():
                self.result.setPixmap(pm.scaled(self.result.size(), Qt.KeepAspectRatio,
                                                Qt.SmoothTransformation))
            QMessageBox.information(
                self, self.tr("common.info"),
                f"Saved {len(job.result.value)} image(s):\n" +
                "\n".join(job.result.value))
        elif job.result and job.result.error != "cancelled":
            self.result.setText("Generation failed — no file was written.")
            QMessageBox.critical(self, self.tr("common.error"), job.result.error)
