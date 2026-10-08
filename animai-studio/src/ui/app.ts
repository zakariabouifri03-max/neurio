import { AnimationDocument, createProject } from "../engine/document";
import { CanvasView } from "./canvasView";
import { PlaybackController } from "../engine/playback";
import { AudioEngine } from "../engine/audio";
import { AIRegistry } from "../ai/registry";
import { canvasToImageData, imageDataToCanvas } from "../ai/provider";
import { flattenForExport, thumbnail } from "../engine/compositor";
import { serializeProject, deserializeProject, downloadBlob } from "../project/format";
import { AutosaveService } from "../project/autosave";
import { exportAnimation } from "../io/export";
import { importGifOrVideoFrames, importImageAsLayer, importImageToFrame, pickFiles } from "../io/import";
import { createBouncingBallExample } from "../examples/bouncingBall";
import { FPS_PRESETS, ToolId } from "../core/types";
import { loadSettings, saveSettings } from "../core/settings";
import { log } from "../core/logger";
import { el } from "./dom";
import { uid } from "../core/ids";

const TOOLS: { id: ToolId; label: string; key: string; icon: string }[] = [
  { id: "pencil", label: "Pencil", key: "P", icon: "M4 20 L16 8 L20 12 L8 24 Z" },
  { id: "brush", label: "Brush", key: "B", icon: "M7 17c4-8 10-10 13-7-3 3-5 9-13 13 1-3 2-5 0-6z" },
  { id: "ink", label: "Ink", key: "N", icon: "M6 20 L14 4 L18 6 L10 22 Z M6 20 L4 22" },
  { id: "eraser", label: "Eraser", key: "E", icon: "M4 16 L12 8 L20 16 L12 24 Z" },
  { id: "fill", label: "Fill", key: "F", icon: "M7 14 L12 4 L17 14 Z M6 18 h12" },
  { id: "eyedropper", label: "Eyedropper", key: "I", icon: "M6 18 L16 8 L19 11 L9 21 Z" },
  { id: "line", label: "Line", key: "L", icon: "M5 19 L19 5" },
  { id: "rect", label: "Rectangle", key: "R", icon: "M5 6 h14 v12 h-14 z" },
  { id: "circle", label: "Circle", key: "C", icon: "M12 4 a8 8 0 1 1 0 16 a8 8 0 1 1 0 -16" },
  { id: "select", label: "Selection", key: "M", icon: "M5 5 h6 v6 h-6 z M13 13 h6 v6 h-6 z" },
  { id: "lasso", label: "Lasso", key: "Q", icon: "M5 12c2-6 12-8 14-2 2 6-6 10-10 6" },
  { id: "transform", label: "Transform", key: "T", icon: "M4 4 h6 v6 h-6 z M14 14 h6 v6 h-6 z M10 8 L14 16" },
  { id: "text", label: "Text", key: "X", icon: "M6 6 h12 M12 6 v14" },
  { id: "hand", label: "Pan", key: "H", icon: "M8 11 v-3 M12 11 v-5 M16 11 v-3 M7 12 v8 h10 v-8" },
];

const PALETTE = [
  "#1a1a1a", "#4a4a4a", "#888", "#ffffff", "#c0392b", "#e67e22", "#f1c40f",
  "#27ae60", "#1abc9c", "#2980b9", "#8e44ad", "#e84393", "#3ee0c5", "#7c6cff",
  "#f4efe6", "#1a365d",
];

export class AnimaiApp {
  doc = createProject();
  view!: CanvasView;
  playback = new PlaybackController();
  audio = new AudioEngine();
  ai = new AIRegistry();
  autosave = new AutosaveService();
  root!: HTMLElement;
  private thumbsDirty = true;
  private statusLeft!: HTMLElement;
  private statusRight!: HTMLElement;
  private cloudPill!: HTMLElement;
  private layersEl!: HTMLElement;
  private framesEl!: HTMLElement;
  private propsEl!: HTMLElement;
  private chatEl!: HTMLElement;
  private charsEl!: HTMLElement;
  private modalBack!: HTMLElement;
  private progressBack!: HTMLElement;
  private progressBar!: HTMLElement;
  private progressLabel!: HTMLElement;
  private welcome!: HTMLElement;
  private fpsLabel!: HTMLElement;
  private frameLabel!: HTMLElement;

  mount(host: HTMLElement): void {
    this.root = host;
    host.className = "app";
    host.innerHTML = "";
    host.append(this.buildMenu(), this.buildWorkspace(), this.buildStatus());
    this.buildModals();
    const stage = host.querySelector(".stage") as HTMLElement;
    this.view = new CanvasView(this.doc, stage);
    this.view.onColor = (c) => {
      this.doc.color = c;
      this.refreshProps();
    };
    this.view.onStatus = (s) => {
      this.statusLeft.textContent = s;
    };
    this.bindShortcuts();
    this.doc.events.on("change", (e) => this.onDocChange(e.reason));
    this.playback.onFrame = () => this.view.redraw();
    this.autosave.start(() => this.doc);
    this.refresh();
    requestAnimationFrame(() => this.view.fit());
    void this.maybeRecover(false);
    log.info("ANIMAI STUDIO ready");
  }

  private buildMenu(): HTMLElement {
    const bar = el("div", { class: "menubar" });
    const brand = el("div", { class: "brand" }, [
      el("img", { src: new URL("../../assets/icon.png", import.meta.url).href, alt: "ANIMAI" }),
      el("div", { class: "name", text: "" }),
    ]);
    brand.querySelector(".name")!.innerHTML = "ANIM<span>AI</span> STUDIO";
    bar.append(brand);

    const menus: { name: string; items: { label: string; kbd?: string; fn?: () => void; soon?: boolean; sep?: boolean }[] }[] = [
      {
        name: "File",
        items: [
          { label: "New Project…", kbd: "Ctrl+N", fn: () => this.newProjectDialog() },
          { label: "Open…", kbd: "Ctrl+O", fn: () => void this.openProject() },
          { label: "Open Example", fn: () => this.loadExample() },
          { label: "Recover Autosave", fn: () => void this.maybeRecover(true) },
          { sep: true, label: "" },
          { label: "Save", kbd: "Ctrl+S", fn: () => void this.saveProject(false) },
          { label: "Save As…", kbd: "Ctrl+Shift+S", fn: () => void this.saveProject(true) },
          { label: "Export Project (.animai)", fn: () => void this.saveProject(true) },
          { sep: true, label: "" },
          { label: "Import Image…", fn: () => void this.importImages() },
          { label: "Import Video / GIF…", fn: () => void this.importVideo() },
          { label: "Import Audio…", fn: () => void this.importAudio() },
        ],
      },
      {
        name: "Edit",
        items: [
          { label: "Undo", kbd: "Ctrl+Z", fn: () => this.doc.undo() },
          { label: "Redo", kbd: "Ctrl+Y", fn: () => this.doc.redo() },
          { sep: true, label: "" },
          { label: "Copy", kbd: "Ctrl+C", fn: () => this.copy() },
          { label: "Cut", kbd: "Ctrl+X", fn: () => this.view.cutSelection() },
          { label: "Paste", kbd: "Ctrl+V", fn: () => this.doc.pasteClipboard() },
          { label: "Clear Frame", fn: () => this.doc.clearCurrentCel() },
          { sep: true, label: "" },
          { label: "Flip Horizontal", fn: () => this.doc.transformCurrentCel("flipH") },
          { label: "Flip Vertical", fn: () => this.doc.transformCurrentCel("flipV") },
          { label: "Rotate 90° CW", fn: () => this.doc.transformCurrentCel("rotateCW") },
          { label: "Scale Up", fn: () => this.doc.transformCurrentCel("scaleUp") },
          { label: "Scale Down", fn: () => this.doc.transformCurrentCel("scaleDown") },
        ],
      },
      {
        name: "Animation",
        items: [
          { label: "Play / Pause", kbd: "Space", fn: () => this.togglePlay() },
          { label: "Insert Blank Frame", kbd: "Ctrl+F", fn: () => this.doc.insertFrame(this.doc.currentFrame + 1, true) },
          { label: "Duplicate Frame", kbd: "Ctrl+D", fn: () => this.doc.duplicateFrame() },
          { label: "Delete Frame", kbd: "Delete", fn: () => this.doc.deleteFrame() },
          { label: "Extend Hold +1", fn: () => this.doc.setHold(this.doc.currentFrame, this.doc.frames[this.doc.currentFrame].hold + 1) },
          { sep: true, label: "" },
          { label: "Onion Skin", kbd: "O", fn: () => this.toggleOnion() },
        ],
      },
      {
        name: "Layer",
        items: [
          { label: "New Drawing Layer", fn: () => this.doc.addLayer("drawing") },
          { label: "New Image Layer", fn: () => this.doc.addLayer("image") },
          { label: "New Text Layer", fn: () => this.doc.addLayer("text") },
          { label: "New Video Layer", fn: () => this.doc.addLayer("video") },
          { label: "Duplicate Layer", fn: () => this.doc.duplicateLayer() },
          { label: "Delete Layer", fn: () => this.doc.deleteLayer() },
        ],
      },
      {
        name: "AI",
        items: [
          { label: "In-between Frames…", fn: () => this.interpolateDialog() },
          { label: "AI Clean Sketch", fn: () => void this.runCleanup() },
          { label: "AI Color", fn: () => void this.runColor() },
          { label: "Generate Motion…", fn: () => this.motionDialog() },
          { label: "Text to Animation…", fn: () => this.textAnimDialog() },
          { sep: true, label: "" },
          { label: "AI Lip-Sync", soon: true },
          { label: "Keep Character Consistent", fn: () => this.saveCharacter() },
          { label: "AI Settings…", fn: () => this.settingsDialog() },
        ],
      },
      {
        name: "View",
        items: [
          { label: "Fit Canvas", kbd: "0", fn: () => this.view.fit() },
          { label: "Zoom In", kbd: "+", fn: () => { this.doc.zoom *= 1.15; this.view.redraw(); } },
          { label: "Zoom Out", kbd: "-", fn: () => { this.doc.zoom /= 1.15; this.view.redraw(); } },
          { label: "Toggle Onion Skin", kbd: "O", fn: () => this.toggleOnion() },
        ],
      },
      {
        name: "Export",
        items: [
          { label: "Export GIF…", fn: () => this.exportDialog("gif") },
          { label: "Export MP4…", fn: () => this.exportDialog("mp4") },
          { label: "Export WebM…", fn: () => this.exportDialog("webm") },
          { label: "Export PNG Sequence…", fn: () => this.exportDialog("pngseq") },
          { label: "Export Animated WebP…", fn: () => this.exportDialog("webp") },
        ],
      },
      {
        name: "Help",
        items: [
          { label: "Keyboard Shortcuts", fn: () => this.helpDialog() },
          { label: "Error Log", fn: () => this.logDialog() },
          { label: "About ANIMAI STUDIO", fn: () => this.aboutDialog() },
        ],
      },
    ];

    for (const m of menus) {
      const node = el("div", { class: "menu", text: m.name });
      const drop = el("div", { class: "menu-drop" });
      for (const item of m.items) {
        if (item.sep) {
          drop.append(el("div", { class: "sep" }));
          continue;
        }
        const b = el("button", { class: `menu-item${item.soon ? " soon" : ""}` });
        b.append(item.label);
        if (item.kbd && !item.soon) b.append(el("kbd", { text: item.kbd }));
        b.addEventListener("click", () => {
          node.classList.remove("open");
          if (item.soon) this.toastComingSoon(item.label);
          else item.fn?.();
        });
        drop.append(b);
      }
      node.append(drop);
      node.addEventListener("click", (e) => {
        e.stopPropagation();
        bar.querySelectorAll(".menu").forEach((x) => x.classList.remove("open"));
        node.classList.add("open");
      });
      bar.append(node);
    }
    document.addEventListener("click", () => bar.querySelectorAll(".menu").forEach((x) => x.classList.remove("open")));

    this.cloudPill = el("div", { class: "cloud-pill", text: "Cloud AI — drawings would leave this device" });
    bar.append(el("div", { style: "flex:1" }), this.cloudPill);
    return bar;
  }

  private buildWorkspace(): HTMLElement {
    const ws = el("div", { class: "workspace" });
    const tools = el("div", { class: "tools" });
    for (const t of TOOLS) {
      if (t.id === "line") tools.append(el("div", { class: "tool-gap" }));
      const b = el("button", { class: "tool", title: `${t.label} (${t.key})`, "data-tool": t.id });
      b.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="${t.icon}"/></svg>`;
      b.addEventListener("click", () => this.doc.setTool(t.id));
      tools.append(b);
    }

    const stage = el("div", { class: "stage" });
    this.welcome = this.buildWelcome();
    stage.append(this.welcome);
    const hudL = el("div", { class: "stage-hud hud-left" });
    this.frameLabel = el("div", { class: "chip" });
    this.fpsLabel = el("div", { class: "chip" });
    hudL.append(this.frameLabel, this.fpsLabel);
    const hudR = el("div", { class: "stage-hud hud-right" });
    hudR.append(
      btn("Fit", () => this.view.fit()),
      btn("−", () => { this.doc.zoom /= 1.15; this.view.redraw(); }),
      btn("+", () => { this.doc.zoom *= 1.15; this.view.redraw(); })
    );
    stage.append(hudL, hudR);

    const right = el("div", { class: "right" });
    const tabs = el("div", { class: "tabs" });
    const tabNames = ["Layers", "Props", "AI", "Cast"];
    tabNames.forEach((name, i) => {
      const t = el("button", { class: `tab${i === 0 ? " active" : ""}${name === "AI" ? " ai" : ""}`, text: name });
      t.addEventListener("click", () => {
        tabs.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
        right.querySelectorAll(".panel").forEach((x) => x.classList.remove("active"));
        t.classList.add("active");
        right.querySelectorAll(".panel")[i].classList.add("active");
      });
      tabs.append(t);
    });
    this.layersEl = el("div", { class: "panel active" });
    this.propsEl = el("div", { class: "panel" });
    const aiPanel = el("div", { class: "panel" });
    this.charsEl = el("div", { class: "panel" });
    this.buildAiPanel(aiPanel);
    right.append(tabs, this.layersEl, this.propsEl, aiPanel, this.charsEl);

    const tl = el("div", { class: "timeline-wrap" });
    const controls = el("div", { class: "tl-controls" });
    controls.append(
      btn("⏮", () => this.doc.setFrame(0)),
      btn("◀", () => this.doc.setFrame(this.doc.currentFrame - 1)),
      btn("▶ / ❚❚", () => this.togglePlay()),
      btn("▶", () => this.doc.setFrame(this.doc.currentFrame + 1)),
      btn("⏭", () => this.doc.setFrame(this.doc.frameCount - 1)),
      el("div", { class: "grow" }),
      btn("+ Blank", () => this.doc.insertFrame(this.doc.currentFrame + 1, true)),
      btn("Duplicate", () => this.doc.duplicateFrame()),
      btn("Delete", () => this.doc.deleteFrame()),
      btn("Hold+", () => this.doc.setHold(this.doc.currentFrame, this.doc.frames[this.doc.currentFrame].hold + 1))
    );
    this.framesEl = el("div", { class: "frames" });
    const audioLane = el("div", { class: "audio-lane" });
    audioLane.append(
      btn("Import audio", () => void this.importAudio()),
      btn("Record", () => void this.toggleRecord()),
      el("div", { class: "clip", id: "audio-clip", text: "No audio clip — import WAV/MP3 or record voice" })
    );
    tl.append(controls, this.framesEl, audioLane);

    const splitL = el("div", { class: "split-v left" });
    const splitR = el("div", { class: "split-v right" });
    const splitB = el("div", { class: "split-h" });
    this.bindSplit(splitL, "left");
    this.bindSplit(splitR, "right");
    this.bindSplit(splitB, "bottom");

    ws.append(tools, splitL, stage, splitR, right, splitB, tl);
    return ws;
  }

  private buildWelcome(): HTMLElement {
    const w = el("div", { class: "welcome" });
    const card = el("div", { class: "welcome-card" });
    const img = el("img", { src: new URL("../../assets/icon.png", import.meta.url).href, width: "56", height: "56" });
    img.style.borderRadius = "14px";
    card.append(img);
    card.append(el("h1", { text: "ANIMAI STUDIO" }));
    card.append(el("div", { class: "sub", text: "Local-first 2D animation. Draw frames, then let AI handle the in-betweens." }));
    const actions = el("div", { class: "welcome-actions" });
    const n = el("button", { class: "hero-btn main" });
    n.innerHTML = "<b>New project</b><span>Choose canvas size and FPS</span>";
    n.onclick = () => this.newProjectDialog();
    const o = el("button", { class: "hero-btn" });
    o.innerHTML = "<b>Open</b><span>Resume a .animai file</span>";
    o.onclick = () => void this.openProject();
    const e = el("button", { class: "hero-btn" });
    e.innerHTML = "<b>Example</b><span>Bouncing ball, 12 frames</span>";
    e.onclick = () => this.loadExample();
    actions.append(n, o, e);
    card.append(actions);
    w.append(card);
    w.addEventListener("click", (ev) => {
      if (ev.target === w) w.style.display = "none";
    });
    return w;
  }

  private buildAiPanel(host: HTMLElement): void {
    host.append(el("div", { class: "field" }, [
      el("label", { text: "Provider" }),
    ]));
    const sel = el("select");
    for (const p of this.ai.providers) {
      const o = el("option", { value: p.id, text: p.name });
      if (p.id === this.ai.currentId) o.selected = true;
      sel.append(o);
    }
    sel.onchange = () => {
      this.ai.setCurrent(sel.value);
      this.updateCloudPill();
    };
    host.append(sel);
    host.append(el("p", { style: "color:var(--text-dim);font-size:12px", text: "Local mode never uploads drawings. Cloud requires an endpoint in Settings → AI." }));
    this.chatEl = el("div", { class: "chat" });
    this.chatEl.append(bubble("ai", "Hi — I'm the ANIMAI assistant. Draw a pose, then try “generate 4 in-between frames” or “make this character jump”."));
    host.append(this.chatEl);
    const quick = el("div", { class: "quick" });
    const qs = [
      ["In-between 4", () => void this.runInterpolate(4)],
      ["Clean sketch", () => void this.runCleanup()],
      ["Color", () => void this.runColor()],
      ["Jump", () => void this.runMotion("jump", 8)],
      ["Walk", () => void this.runMotion("walk", 8)],
    ];
    for (const [label, fn] of qs) {
      const b = el("button", { text: label as string });
      b.onclick = fn as () => void;
      quick.append(b);
    }
    host.append(quick);
    const row = el("div", { class: "color-row" });
    const input = el("input", { type: "text", placeholder: "Make this character wave…" }) as HTMLInputElement;
    const send = el("button", { class: "ai-btn", text: "Send" });
    const go = () => {
      const v = input.value.trim();
      if (!v) return;
      input.value = "";
      void this.ask(v);
    };
    send.onclick = go;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") go();
    });
    row.append(input, send);
    host.append(row);
  }

  private buildStatus(): HTMLElement {
    const s = el("div", { class: "status" });
    s.append(el("div", { class: "dot" }));
    this.statusLeft = el("div", { text: "Ready" });
    this.statusRight = el("div", { class: "push", text: "Local AI · unsaved" });
    s.append(this.statusLeft, this.statusRight);
    return s;
  }

  private buildModals(): void {
    this.modalBack = el("div", { class: "modal-back" });
    this.progressBack = el("div", { class: "progress-back" });
    const card = el("div", { class: "progress-card" });
    this.progressLabel = el("div", { text: "Working…" });
    const bar = el("div", { class: "bar" });
    this.progressBar = el("i");
    bar.append(this.progressBar);
    card.append(this.progressLabel, bar);
    this.progressBack.append(card);
    document.body.append(this.modalBack, this.progressBack);
  }

  private bindSplit(handle: HTMLElement, which: "left" | "right" | "bottom"): void {
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const start = which === "bottom" ? e.clientY : e.clientX;
      const ws = this.root.querySelector(".workspace") as HTMLElement;
      const cs = getComputedStyle(ws);
      const startVal =
        which === "left"
          ? parseFloat(cs.getPropertyValue("--left") || getComputedStyle(document.documentElement).getPropertyValue("--left"))
          : which === "right"
            ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--right"))
            : parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bottom"));
      const move = (ev: PointerEvent) => {
        if (which === "left") {
          const v = Math.max(56, Math.min(160, startVal + (ev.clientX - start)));
          document.documentElement.style.setProperty("--left", v + "px");
        } else if (which === "right") {
          const v = Math.max(220, Math.min(480, startVal - (ev.clientX - start)));
          document.documentElement.style.setProperty("--right", v + "px");
        } else {
          const v = Math.max(140, Math.min(420, startVal - (ev.clientY - start)));
          document.documentElement.style.setProperty("--bottom", v + "px");
        }
        this.view.resize();
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
  }

  private bindShortcuts(): void {
    window.addEventListener("keydown", (e) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.code === "Space") {
        e.preventDefault();
        this.togglePlay();
        return;
      }
      if (ctrl && e.key.toLowerCase() === "z") {
        e.preventDefault();
        this.doc.undo();
        return;
      }
      if (ctrl && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
        e.preventDefault();
        this.doc.redo();
        return;
      }
      if (ctrl && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void this.saveProject(e.shiftKey);
        return;
      }
      if (ctrl && e.key.toLowerCase() === "n") {
        e.preventDefault();
        this.newProjectDialog();
        return;
      }
      if (ctrl && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void this.openProject();
        return;
      }
      if (ctrl && e.key.toLowerCase() === "c") {
        this.copy();
        return;
      }
      if (ctrl && e.key.toLowerCase() === "v") {
        this.doc.pasteClipboard();
        return;
      }
      if (ctrl && e.key.toLowerCase() === "d") {
        e.preventDefault();
        this.doc.duplicateFrame();
        return;
      }
      if (ctrl && e.key.toLowerCase() === "f") {
        e.preventDefault();
        this.doc.insertFrame(this.doc.currentFrame + 1, true);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (this.doc.selection) this.view.cutSelection();
        else this.doc.deleteFrame();
        return;
      }
      if (e.key === "o" || e.key === "O") this.toggleOnion();
      if (e.key === "0") this.view.fit();
      if (e.key === "+" || e.key === "=") this.doc.zoom *= 1.1;
      if (e.key === "-") this.doc.zoom /= 1.1;
      if (["ArrowLeft", "ArrowRight"].includes(e.key) && !this.doc.selection) {
        this.doc.setFrame(this.doc.currentFrame + (e.key === "ArrowRight" ? 1 : -1));
      }
      const map: Record<string, ToolId> = {
        p: "pencil",
        b: "brush",
        e: "eraser",
        f: "fill",
        i: "eyedropper",
        l: "line",
        r: "rect",
        c: "circle",
        m: "select",
        h: "hand",
        n: "ink",
        t: "transform",
        x: "text",
        q: "lasso",
      };
      if (!ctrl && map[e.key.toLowerCase()]) this.doc.setTool(map[e.key.toLowerCase()]);
    });
  }

  private copy(): void {
    if (this.doc.selection) this.view.copySelection();
    else this.doc.copyCurrentCel();
  }

  private togglePlay(): void {
    if (this.doc.playing) {
      this.playback.stop(this.doc);
      this.audio.stop();
    } else {
      this.audio.play(this.doc, this.doc.currentFrame);
      this.playback.start(this.doc);
    }
  }

  private toggleOnion(): void {
    this.doc.onion.enabled = !this.doc.onion.enabled;
    this.doc.mark("onion");
  }

  private onDocChange(reason: string): void {
    this.view?.redraw();
    if (reason === "brush" || reason === "tool") {
      this.refreshTools();
      this.refreshHud();
      return;
    }
    if (["Stroke", "Fill", "Shape", "Text", "Clear", "Clear frame", "Paste", "Cut", "history", "undo", "redo", "cam", "cam-key", "onion", "fps", "hold", "vis", "lock", "opacity", "rename"].includes(reason) || reason.startsWith("flip") || reason.startsWith("rotate") || reason.startsWith("scale")) {
      this.refreshFrames();
      this.refreshHud();
      this.refreshLayers();
      return;
    }
    this.refresh();
  }

  refresh(): void {
    this.view?.setDoc(this.doc);
    this.view?.redraw();
    this.refreshTools();
    this.refreshLayers();
    this.refreshFrames();
    this.refreshProps();
    this.refreshChars();
    this.refreshHud();
    this.updateCloudPill();
    this.thumbsDirty = true;
  }

  private refreshHud(): void {
    if (!this.frameLabel) return;
    this.frameLabel.innerHTML = `Frame <b>${this.doc.currentFrame + 1}</b> / ${this.doc.frameCount}`;
    this.fpsLabel.innerHTML = `<b>${this.doc.fps}</b> fps · ${this.doc.width}×${this.doc.height}`;
    this.statusRight.textContent = `${this.ai.current().name} · ${this.doc.dirty ? "unsaved" : "saved"} · ${this.doc.settings.name}`;
  }

  private refreshTools(): void {
    this.root.querySelectorAll(".tool").forEach((t) => {
      t.classList.toggle("active", (t as HTMLElement).dataset.tool === this.doc.tool);
    });
  }

  private refreshLayers(): void {
    if (!this.layersEl) return;
    this.layersEl.innerHTML = "";
    const actions = el("div", { class: "row-actions" });
    actions.append(
      btn("+ Drawing", () => this.doc.addLayer("drawing")),
      btn("Dup", () => this.doc.duplicateLayer()),
      btn("Del", () => this.doc.deleteLayer())
    );
    this.layersEl.append(actions);
    [...this.doc.layers].reverse().forEach((layer) => {
      const idx = this.doc.layers.indexOf(layer);
      const row = el("div", { class: `layer-row${idx === this.doc.currentLayer ? " active" : ""}` });
      const vis = el("button", { class: "tiny", text: layer.meta.visible ? "◉" : "○", title: "Visibility" });
      vis.onclick = (e) => {
        e.stopPropagation();
        layer.meta.visible = !layer.meta.visible;
        this.doc.mark("vis");
      };
      const lock = el("button", { class: "tiny", text: layer.meta.locked ? "🔒" : "🔓", title: "Lock" });
      lock.onclick = (e) => {
        e.stopPropagation();
        layer.meta.locked = !layer.meta.locked;
        this.doc.mark("lock");
      };
      const name = el("input", { type: "text", value: layer.meta.name }) as HTMLInputElement;
      name.onclick = (e) => e.stopPropagation();
      name.onchange = () => {
        layer.meta.name = name.value;
        this.doc.mark("rename");
      };
      const op = el("input", { type: "number", min: "0", max: "100", value: String(Math.round(layer.meta.opacity * 100)) }) as HTMLInputElement;
      op.onchange = () => {
        layer.meta.opacity = Math.max(0, Math.min(1, Number(op.value) / 100));
        this.doc.mark("opacity");
      };
      row.append(vis, lock, name, op);
      row.onclick = () => this.doc.setLayerIndex(idx);
      this.layersEl.append(row);
    });
  }

  private refreshFrames(): void {
    if (!this.framesEl) return;
    this.framesEl.innerHTML = "";
    this.doc.frames.forEach((fr, i) => {
      const cell = el("div", { class: `frame-cell${i === this.doc.currentFrame ? " active" : ""}${fr.hold > 1 ? " hold-wide" : ""}` });
      const thumb = thumbnail(this.doc, i);
      cell.append(thumb);
      const meta = el("div", { class: "meta" });
      meta.append(el("span", { text: String(i + 1) }), el("span", { text: fr.hold > 1 ? `hold ${fr.hold}` : "" }));
      cell.append(meta);
      cell.onclick = () => this.doc.setFrame(i);
      cell.ondblclick = () => {
        const n = Number(window.prompt("Hold duration (frames)", String(fr.hold)));
        if (n) this.doc.setHold(i, n);
      };
      this.framesEl.append(cell);
    });
    const active = this.framesEl.querySelector(".frame-cell.active") as HTMLElement | null;
    active?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }

  private refreshProps(): void {
    if (!this.propsEl) return;
    this.propsEl.innerHTML = "";
    const b = this.doc.brush;
    const sliders: [string, number, number, number, number, (v: number) => void][] = [
      ["Size", b.size, 1, 128, 1, (v) => (b.size = v)],
      ["Opacity", b.opacity, 0.05, 1, 0.01, (v) => (b.opacity = v)],
      ["Hardness", b.hardness, 0, 1, 0.01, (v) => (b.hardness = v)],
      ["Stabilization", b.stabilization, 0, 0.95, 0.01, (v) => (b.stabilization = v)],
      ["Pressure", b.pressureSensitivity, 0, 1, 0.01, (v) => (b.pressureSensitivity = v)],
      ["Spacing", b.spacing, 0.04, 0.6, 0.01, (v) => (b.spacing = v)],
      ["Smoothing", b.smoothing, 0, 0.9, 0.01, (v) => (b.smoothing = v)],
    ];
    for (const [label, val, min, max, step, set] of sliders) {
      this.propsEl.append(slider(label, val, min, max, step, (v) => {
        set(v);
        this.doc.events.emit("change", { reason: "brush" });
      }));
    }
    const color = el("div", { class: "field" });
    color.append(el("label", { text: "Color" }));
    const cr = el("div", { class: "color-row" });
    const picker = el("input", { type: "color", value: this.doc.color }) as HTMLInputElement;
    picker.oninput = () => {
      this.doc.color = picker.value;
    };
    cr.append(picker);
    color.append(cr);
    const sw = el("div", { class: "swatches" });
    for (const hex of PALETTE) {
      const s = el("button", { class: "swatch" });
      s.style.background = hex;
      s.onclick = () => {
        this.doc.color = hex;
        picker.value = hex;
      };
      sw.append(s);
    }
    color.append(sw);
    this.propsEl.append(color);

      this.propsEl.append(slider("Onion previous", this.doc.onion.prev, 0, 5, 1, (v) => { this.doc.onion.prev = v; this.view.redraw(); }));
    this.propsEl.append(slider("Onion next", this.doc.onion.next, 0, 5, 1, (v) => { this.doc.onion.next = v; this.view.redraw(); }));
    this.propsEl.append(slider("Onion opacity", this.doc.onion.opacity, 0.05, 0.8, 0.01, (v) => { this.doc.onion.opacity = v; this.view.redraw(); }));

    const cam = el("div", { class: "field" });
    cam.append(el("label", { text: "Virtual camera" }));
    cam.append(slider("Cam X", this.doc.camera.x, -400, 400, 1, (v) => { this.doc.camera.x = v; this.view.redraw(); }));
    cam.append(slider("Cam Y", this.doc.camera.y, -400, 400, 1, (v) => { this.doc.camera.y = v; this.view.redraw(); }));
    cam.append(slider("Cam Zoom", this.doc.camera.zoom, 0.2, 4, 0.01, (v) => { this.doc.camera.zoom = v; this.view.redraw(); }));
    cam.append(slider("Cam Rotate", this.doc.camera.rotation, -45, 45, 0.5, (v) => { this.doc.camera.rotation = v; this.view.redraw(); }));
    cam.append(slider("Shake", this.doc.camera.shake, 0, 1, 0.01, (v) => { this.doc.camera.shake = v; this.view.redraw(); }));
    const keyBtn = btn("Set camera keyframe", () => {
      this.doc.cameraKeys = this.doc.cameraKeys.filter((k) => k.frame !== this.doc.currentFrame);
      this.doc.cameraKeys.push({ frame: this.doc.currentFrame, camera: { ...this.doc.camera } });
      this.doc.mark("cam-key");
    });
    cam.append(keyBtn);
    this.propsEl.append(cam);

    const fps = el("div", { class: "field" });
    fps.append(el("label", { text: "FPS" }));
    const fs = el("select") as HTMLSelectElement;
    for (const n of FPS_PRESETS) {
      const o = el("option", { value: String(n), text: `${n} fps` });
      if (n === this.doc.fps) o.selected = true;
      fs.append(o);
    }
    fs.onchange = () => {
      this.doc.settings.fps = Number(fs.value);
      this.doc.mark("fps");
    };
    fps.append(fs);
    this.propsEl.append(fps);
  }

  private refreshChars(): void {
    if (!this.charsEl) return;
    this.charsEl.innerHTML = "";
    this.charsEl.append(btn("Save current frame as character", () => this.saveCharacter()));
    if (!this.doc.characters.length) {
      this.charsEl.append(el("p", { style: "color:var(--text-dim);font-size:12px", text: "Character Library is empty. Draw a turnaround or bust, then save it. Motion generation uses the active character as the source sheet." }));
      return;
    }
    for (const ch of this.doc.characters) {
      const card = el("div", { class: "char-card" });
      card.append(el("img", { src: ch.thumbnailDataUrl, alt: ch.name }));
      const col = el("div");
      col.append(el("b", { text: ch.name }));
      col.append(el("div", { style: "color:var(--text-dim);font-size:11px", text: ch.notes.style || "No style notes" }));
      card.append(col);
      this.charsEl.append(card);
    }
  }

  saveCharacter(): void {
    const flat = flattenForExport(this.doc, this.doc.currentFrame, true);
    const name = window.prompt("Character name", `Character ${this.doc.characters.length + 1}`);
    if (!name) return;
    this.doc.characters.push({
      id: uid("ch"),
      name,
      createdAt: Date.now(),
      notes: {
        face: "",
        hair: "",
        clothes: "",
        colors: this.doc.color,
        proportions: `${this.doc.width}x${this.doc.height}`,
        accessories: "",
        style: "source sheet from current frame",
      },
      thumbnailDataUrl: flat.toDataURL("image/png"),
      sheetDataUrl: flat.toDataURL("image/png"),
    });
    this.doc.mark("character");
    this.toast("Character saved to library.");
  }

  private updateCloudPill(): void {
    const p = this.ai.current();
    this.cloudPill.classList.toggle("on", p.requiresCloud);
  }

  async ask(prompt: string): Promise<void> {
    this.chatEl.append(bubble("user", prompt));
    const provider = this.ai.current();
    this.updateCloudPill();
    const ctx = {
      frameCount: this.doc.frameCount,
      currentFrame: this.doc.currentFrame,
      layerName: this.doc.activeLayer.meta.name,
      fps: this.doc.fps,
      hasDrawing: Boolean(this.doc.activeLayer.getCel(this.doc.currentFrame)),
    };
    const result = await provider.assistant(prompt, ctx);
    this.chatEl.append(bubble("ai", result.message));
    this.chatEl.scrollTop = this.chatEl.scrollHeight;
    this.doc.ai.lastPrompt = prompt;
    this.doc.ai.lastProvider = provider.id;
    this.doc.ai.generations.push({ at: Date.now(), kind: result.action?.type || "chat", prompt, provider: provider.id });
    const a = result.action;
    if (!a || a.type === "none") return;
    if (a.type === "interpolate") await this.runInterpolate(a.count);
    if (a.type === "cleanup") await this.runCleanup(a.strength);
    if (a.type === "colorize") await this.runColor(a.description);
    if (a.type === "motion") await this.runMotion(a.motion, a.frames);
    if (a.type === "text-to-anim") await this.runTextAnim(a.prompt);
    if (a.type === "transform") this.doc.transformCurrentCel(a.kind as "flipH");
    if (a.type === "frames") {
      for (let i = 0; i < a.count; i++) {
        if (a.op === "duplicate") this.doc.duplicateFrame();
        else this.doc.insertFrame(this.doc.currentFrame + 1, true);
      }
    }
    if (a.type === "onion") {
      if (a.enabled !== undefined) this.doc.onion.enabled = a.enabled;
      this.doc.mark("onion");
    }
  }

  private currentImage(): ImageData {
    const cel = this.doc.activeLayer.getCel(this.doc.currentFrame) || flattenForExport(this.doc, this.doc.currentFrame, true);
    return canvasToImageData(cel);
  }

  async runInterpolate(count: number): Promise<void> {
    if (this.doc.currentFrame >= this.doc.frameCount - 1) {
      this.toast("Duplicate or add a second keyframe after the current one first.");
      return;
    }
    const a = this.doc.activeLayer.getCel(this.doc.currentFrame);
    const b = this.doc.activeLayer.getCel(this.doc.currentFrame + 1);
    if (!a || !b) {
      this.toast("Need drawings on this frame and the next frame.");
      return;
    }
    this.showProgress("Estimating motion…");
    try {
      const frames = await this.ai.current().interpolate(canvasToImageData(a), canvasToImageData(b), {
        count,
        onProgress: (t) => this.setProgress(t, "In-betweening"),
      });
      const canvases = frames.map(imageDataToCanvas);
      this.hideProgress();
      await this.previewGenerated(canvases, `Preview ${count} in-betweens`, () => {
        this.doc.insertGeneratedFrames(this.doc.currentFrame, canvases);
        this.toast(`Inserted ${count} editable in-betweens.`);
      });
    } catch (err) {
      log.error("interpolate", err);
      this.toast("Interpolation failed. See Help → Error Log.");
      this.hideProgress();
    }
  }

  private previewGenerated(canvases: HTMLCanvasElement[], title: string, apply: () => void): Promise<void> {
    return new Promise((resolve) => {
      this.modalBack.innerHTML = "";
      const m = el("div", { class: "modal" });
      m.style.width = "min(860px, 96vw)";
      m.append(el("h2", { text: title }));
      m.append(el("p", { text: "These frames are not committed yet. Apply to insert them into the timeline as editable cels." }));
      const row = el("div", { style: "display:flex;gap:8px;overflow:auto;padding:8px 0" });
      for (const c of canvases) {
        const img = document.createElement("canvas");
        const scale = 120 / Math.max(c.width, c.height);
        img.width = Math.max(1, Math.round(c.width * scale));
        img.height = Math.max(1, Math.round(c.height * scale));
        img.getContext("2d")!.drawImage(c, 0, 0, img.width, img.height);
        img.style.background = "#fff";
        img.style.borderRadius = "6px";
        row.append(img);
      }
      m.append(row);
      const actions = el("div", { class: "modal-actions" });
      const cancel = el("button", { class: "ghost", text: "Discard" });
      cancel.onclick = () => {
        this.modalBack.classList.remove("show");
        resolve();
      };
      const ok = el("button", { class: "primary", text: "Apply to timeline" });
      ok.onclick = () => {
        this.modalBack.classList.remove("show");
        apply();
        resolve();
      };
      actions.append(cancel, ok);
      m.append(actions);
      this.modalBack.append(m);
      this.modalBack.classList.add("show");
    });
  }

  async runCleanup(strength = 0.6): Promise<void> {
    const img = this.currentImage();
    this.showProgress("Cleaning sketch…");
    try {
      const out = await this.ai.current().cleanup(img, { strength, detail: 0.5, preserveOriginal: true });
      const layer = this.doc.addLayer("drawing", "Cleanup");
      layer.cels.set(this.doc.currentFrame, imageDataToCanvas(out));
      this.toast("Cleanup landed on a new layer. Original preserved.");
    } finally {
      this.hideProgress();
    }
  }

  async runColor(description = "color this character"): Promise<void> {
    const img = this.currentImage();
    this.showProgress("Coloring…");
    try {
      const out = await this.ai.current().colorize(img, {
        palette: [this.doc.color, "#f4d19b", "#1a365d", "#c0392b"],
        description,
      });
      const layer = this.doc.addLayer("drawing", "Color");
      layer.cels.set(this.doc.currentFrame, imageDataToCanvas(out));
      this.doc.reorderLayer(this.doc.layers.length - 1, Math.max(0, this.doc.currentLayer));
      this.toast("Color on a new layer.");
    } finally {
      this.hideProgress();
    }
  }

  async runMotion(motion: string, frames: number): Promise<void> {
    const source = this.doc.characters[0]
      ? await dataUrlToImageData(this.doc.characters[0].sheetDataUrl)
      : this.currentImage();
    this.showProgress(`Generating ${motion}…`);
    try {
      const out = await this.ai.current().generateMotion(source, { motion, customPrompt: motion, frames });
      this.doc.insertGeneratedFrames(this.doc.currentFrame, out.map(imageDataToCanvas));
    } finally {
      this.hideProgress();
    }
  }

  async runTextAnim(prompt: string): Promise<void> {
    this.showProgress("Storyboarding…");
    try {
      const out = await this.ai.current().textToAnimation(prompt, this.doc.width, this.doc.height, 12);
      while (this.doc.frameCount < out.length) this.doc.insertFrame(this.doc.frameCount, true);
      const layer = this.doc.addLayer("drawing", "Text-to-anim");
      out.forEach((img, i) => layer.cels.set(i, imageDataToCanvas(img)));
      this.toast("Editable sequence added. Refine each frame on the timeline.");
    } finally {
      this.hideProgress();
    }
  }

  interpolateDialog(): void {
    this.formModal("AI In-betweening", [
      { name: "count", label: "Frames to generate", type: "select", options: ["2", "4", "6", "8", "12"], value: "4" },
    ], (v) => void this.runInterpolate(Number(v.count)));
  }

  motionDialog(): void {
    this.formModal("Generate Motion", [
      { name: "motion", label: "Preset", type: "select", options: ["walk", "run", "jump", "idle", "wave", "fight", "sit", "stand", "dance", "turn", "talk", "bounce"], value: "walk" },
      { name: "frames", label: "Frame count", type: "number", value: "8" },
      { name: "custom", label: "Custom prompt", type: "text", value: "" },
    ], (v) => void this.runMotion(v.custom || v.motion, Number(v.frames) || 8));
  }

  textAnimDialog(): void {
    this.formModal("Text to Animation", [
      { name: "prompt", label: "Prompt", type: "text", value: "A young character walks through a rainy city and opens an umbrella." },
    ], (v) => void this.runTextAnim(v.prompt));
  }

  newProjectDialog(): void {
    this.formModal("New Project", [
      { name: "name", label: "Name", type: "text", value: "Untitled" },
      { name: "preset", label: "Canvas", type: "select", options: ["1920x1080", "1080x1920", "1080x1080", "1280x720", "custom"], value: "1920x1080" },
      { name: "w", label: "Custom width", type: "number", value: "1920" },
      { name: "h", label: "Custom height", type: "number", value: "1080" },
      { name: "fps", label: "FPS", type: "select", options: FPS_PRESETS.map(String), value: "12" },
      { name: "bg", label: "Background", type: "text", value: "#ffffff" },
    ], (v) => {
      let w = Number(v.w) || 1920;
      let h = Number(v.h) || 1080;
      if (v.preset !== "custom" && v.preset.includes("x")) {
        const [pw, ph] = v.preset.split("x").map(Number);
        w = pw;
        h = ph;
      }
      this.replaceDoc(createProject({ name: v.name, width: w, height: h, fps: Number(v.fps), background: v.bg }));
      this.welcome.style.display = "none";
      requestAnimationFrame(() => this.view.fit());
    });
  }

  settingsDialog(): void {
    const s = loadSettings();
    this.formModal("Settings — AI", [
      { name: "cloudEndpoint", label: "Cloud endpoint", type: "text", value: s.cloudEndpoint },
      { name: "cloudKey", label: "Cloud API key", type: "text", value: s.cloudKey },
      { name: "customEndpoint", label: "Custom endpoint", type: "text", value: s.customEndpoint },
      { name: "customKey", label: "Custom API key", type: "text", value: s.customKey },
    ], (v) => {
      this.ai.configure(v);
      saveSettings({ ...loadSettings(), ...v });
      this.toast("AI settings saved. Drawings stay local unless a cloud provider is selected AND available.");
    });
  }

  exportDialog(format: "gif" | "mp4" | "webm" | "pngseq" | "webp"): void {
    this.formModal(`Export ${format.toUpperCase()}`, [
      { name: "fps", label: "FPS", type: "select", options: FPS_PRESETS.map(String), value: String(this.doc.fps) },
      { name: "scale", label: "Scale", type: "select", options: ["1", "0.5", "0.25"], value: this.doc.width > 1280 ? "0.5" : "1" },
      { name: "quality", label: "Quality 0–1", type: "number", value: "0.8" },
      { name: "transparent", label: "Transparent (gif/png)", type: "select", options: ["no", "yes"], value: "no" },
    ], (v) => {
      void this.doExport(format, v);
    });
  }

  private async doExport(format: "gif" | "mp4" | "webm" | "pngseq" | "webp", v: Record<string, string>): Promise<void> {
    this.showProgress("Exporting…");
    try {
      await exportAnimation(this.doc, {
        format,
        fps: Number(v.fps),
        quality: Number(v.quality) || 0.8,
        scale: Number(v.scale) || 1,
        transparent: v.transparent === "yes",
        filename: `${this.doc.settings.name}.${format}`,
        onProgress: (t, label) => this.setProgress(t, label),
      });
    } catch (err) {
      log.error("export", err);
      this.toast("Export failed. Try a smaller scale or GIF/PNG sequence.");
    } finally {
      this.hideProgress();
    }
  }

  async saveProject(saveAs: boolean): Promise<void> {
    try {
      const bytes = await serializeProject(this.doc);
      const name = `${this.doc.settings.name.replace(/\s+/g, "-")}.animai`;
      if (window.animaiDesktop) {
        const path =
          !saveAs && this.doc.filePath
            ? this.doc.filePath
            : await window.animaiDesktop.saveDialog({
                title: "Save ANIMAI project",
                defaultPath: name,
                filters: [{ name: "ANIMAI Project", extensions: ["animai"] }],
              });
        if (!path) return;
        await window.animaiDesktop.writeFile(path, Array.from(bytes), "binary");
        this.doc.filePath = path;
      } else {
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        downloadBlob(new Blob([copy.buffer], { type: "application/zip" }), name);
      }
      this.doc.markClean();
      this.toast("Project saved.");
    } catch (err) {
      log.error("save", err);
      this.toast("Save failed.");
    }
  }

  async openProject(): Promise<void> {
    try {
      let bytes: Uint8Array | null = null;
      if (window.animaiDesktop) {
        const files = await window.animaiDesktop.openDialog({
          title: "Open ANIMAI project",
          filters: [{ name: "ANIMAI", extensions: ["animai"] }],
        });
        if (!files[0]) return;
        const data = await window.animaiDesktop.readFile(files[0], "binary");
        if (!data) return;
        bytes = Uint8Array.from(data as number[]);
      } else {
        const files = await pickFiles(".animai,application/zip");
        if (!files[0]) return;
        bytes = new Uint8Array(await files[0].arrayBuffer());
      }
      const doc = await deserializeProject(bytes);
      this.replaceDoc(doc);
      this.welcome.style.display = "none";
      this.view.fit();
    } catch (err) {
      log.error("open", err);
      this.toast("Could not open project. It may be corrupted.");
    }
  }

  loadExample(): void {
    this.replaceDoc(createBouncingBallExample());
    this.welcome.style.display = "none";
    requestAnimationFrame(() => this.view.fit());
  }

  replaceDoc(doc: AnimationDocument): void {
    this.doc = doc;
    this.view?.setDoc(doc);
    this.doc.events.on("change", (e) => this.onDocChange(e.reason));
    this.refresh();
  }

  async importImages(): Promise<void> {
    const files = await pickFiles("image/png,image/jpeg,image/webp,image/svg+xml", true);
    for (const f of files) {
      if (f.type === "image/svg+xml") await importImageToFrame(this.doc, f, true);
      else await importImageToFrame(this.doc, f, true);
    }
  }

  async importVideo(): Promise<void> {
    const files = await pickFiles("video/mp4,video/quicktime,video/webm,image/gif");
    if (files[0]) await importGifOrVideoFrames(this.doc, files[0]);
  }

  async importAudio(): Promise<void> {
    const files = await pickFiles("audio/wav,audio/mpeg,audio/mp3,audio/*");
    if (files[0]) {
      await this.audio.importFile(this.doc, files[0], this.doc.currentFrame);
      this.drawWave();
    }
  }

  private drawWave(): void {
    const host = this.root.querySelector("#audio-clip") as HTMLElement | null;
    if (!host || !this.doc.audio[0]) return;
    host.innerHTML = "";
    host.append(this.audio.waveform(this.doc.audio[0], Math.max(320, host.clientWidth || 320), 36));
  }

  async toggleRecord(): Promise<void> {
    if (this.audio.recording) {
      await this.audio.stopRecording(this.doc);
      this.drawWave();
      this.toast("Voice clip added to the audio timeline.");
    } else {
      try {
        await this.audio.startRecording();
        this.toast("Recording… click Record again to stop.");
      } catch {
        this.toast("Microphone permission denied.");
      }
    }
  }

  helpDialog(): void {
    this.showModal(
      "Shortcuts",
      `<p>Space play · B brush · P pencil · E eraser · F fill · I eyedropper · O onion · Ctrl+Z undo · Ctrl+S save · Ctrl+D duplicate frame · arrows change frames · 0 fit · Ctrl+wheel zoom.</p>`
    );
  }

  logDialog(): void {
    this.showModal("Error log", `<pre style="white-space:pre-wrap;font-size:11px;max-height:300px;overflow:auto">${escapeHtml(log.dump() || "(empty)")}</pre>`);
  }

  aboutDialog(): void {
    this.showModal(
      "ANIMAI STUDIO 1.0",
      `<p>Local-first 2D animation studio. Frame-by-frame drawing, onion skin, layers, and a modular AI provider layer. The editor works fully without AI.</p>`
    );
  }

  private toastComingSoon(label: string): void {
    this.toast(`${label} — Coming Soon`);
  }

  toast(msg: string): void {
    this.statusLeft.textContent = msg;
    this.chatEl?.append(bubble("ai", msg));
  }

  showProgress(label: string): void {
    this.progressLabel.textContent = label;
    this.progressBar.style.width = "8%";
    this.progressBack.classList.add("show");
  }
  setProgress(t: number, label: string): void {
    this.progressLabel.textContent = label;
    this.progressBar.style.width = `${Math.round(t * 100)}%`;
  }
  hideProgress(): void {
    this.progressBack.classList.remove("show");
  }

  showModal(title: string, html: string): void {
    this.modalBack.innerHTML = "";
    const m = el("div", { class: "modal" });
    m.append(el("h2", { text: title }));
    const body = el("div");
    body.innerHTML = html;
    m.append(body);
    const actions = el("div", { class: "modal-actions" });
    const close = el("button", { class: "primary", text: "Close" });
    close.onclick = () => this.modalBack.classList.remove("show");
    actions.append(close);
    m.append(actions);
    this.modalBack.append(m);
    this.modalBack.classList.add("show");
  }

  formModal(
    title: string,
    fields: { name: string; label: string; type: string; value?: string; options?: string[] }[],
    onOk: (values: Record<string, string>) => void
  ): void {
    this.modalBack.innerHTML = "";
    const m = el("div", { class: "modal" });
    m.append(el("h2", { text: title }));
    const inputs: Record<string, HTMLInputElement | HTMLSelectElement> = {};
    for (const f of fields) {
      const wrap = el("div", { class: "field" });
      wrap.append(el("label", { text: f.label }));
      if (f.type === "select") {
        const s = el("select") as HTMLSelectElement;
        for (const o of f.options || []) {
          const opt = el("option", { value: o, text: o });
          if (o === f.value) opt.selected = true;
          s.append(opt);
        }
        inputs[f.name] = s;
        wrap.append(s);
      } else {
        const i = el("input", { type: f.type === "number" ? "number" : "text", value: f.value || "" }) as HTMLInputElement;
        inputs[f.name] = i;
        wrap.append(i);
      }
      m.append(wrap);
    }
    const actions = el("div", { class: "modal-actions" });
    const cancel = el("button", { class: "ghost", text: "Cancel" });
    cancel.onclick = () => this.modalBack.classList.remove("show");
    const ok = el("button", { class: "primary", text: "OK" });
    ok.onclick = () => {
      const values: Record<string, string> = {};
      for (const [k, n] of Object.entries(inputs)) values[k] = n.value;
      this.modalBack.classList.remove("show");
      onOk(values);
    };
    actions.append(cancel, ok);
    m.append(actions);
    this.modalBack.append(m);
    this.modalBack.classList.add("show");
  }

  async maybeRecover(force: boolean): Promise<void> {
    const meta = this.autosave.meta();
    if (!meta && !force) return;
    if (!force) return;
    const doc = await this.autosave.recover();
    if (doc) {
      this.replaceDoc(doc);
      this.welcome.style.display = "none";
      this.toast("Recovered autosave.");
    } else {
      this.toast("No autosave found.");
    }
  }
}

function btn(label: string, fn: () => void): HTMLButtonElement {
  const b = el("button", { class: "ghost", text: label });
  b.addEventListener("click", fn);
  return b;
}

function slider(label: string, value: number, min: number, max: number, step: number, on: (v: number) => void): HTMLElement {
  const f = el("div", { class: "field" });
  const lab = el("label");
  const span = el("span", { text: String(round(value)) });
  lab.append(label, span);
  const i = el("input", { type: "range", min: String(min), max: String(max), step: String(step), value: String(value) }) as HTMLInputElement;
  i.oninput = () => {
    const v = Number(i.value);
    span.textContent = String(round(v));
    on(v);
  };
  f.append(lab, i);
  return f;
}

function round(n: number): number | string {
  return Math.abs(n) >= 10 ? Math.round(n) : Math.round(n * 100) / 100;
}

function bubble(kind: "ai" | "user", text: string): HTMLElement {
  return el("div", { class: `bubble ${kind}`, text });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}

async function dataUrlToImageData(url: string): Promise<ImageData> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}
