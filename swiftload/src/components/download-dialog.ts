/**
 * New-download dialog.
 *
 * Every fact shown here comes from the server: the *Check* step asks the backend
 * to probe the URL (final URL, size, content type, range support) and the fields
 * are filled from that answer. Nothing guesses a file size, a filename or a
 * download capability, and an existing file is never overwritten silently.
 */

import { api } from "../lib/api";
import { el, setText } from "../lib/dom";
import { toUiError } from "../lib/errors";
import { formatBytes, formatTimestamp, shortenMiddle } from "../lib/format";
import type {
  AddDownloadArgs,
  ConflictAction,
  DownloadRecord,
  ProbeResult,
} from "../lib/types";

export interface DownloadDialogOptions {
  /** Pre-filled URL (clipboard detection, `swiftload:` link, paste shortcut). */
  url?: string;
  connections?: number;
  destDir?: string;
  sha256?: string;
}

interface Refs {
  url: HTMLInputElement;
  dir: HTMLInputElement;
  name: HTMLInputElement;
  connections: HTMLInputElement;
  sha: HTMLInputElement;
  urlError: HTMLElement;
  hint: HTMLElement;
  facts: HTMLElement;
  values: HTMLElement[];
  conflictBox: HTMLElement;
  conflictText: HTMLElement;
  spaceLine: HTMLElement;
  check: HTMLButtonElement;
  start: HTMLButtonElement;
  spinner: HTMLElement;
  connectionsHint: HTMLElement;
}

export class DownloadDialog {
  private node: HTMLElement | null = null;
  private refs: Refs | null = null;
  private probeToken = 0;
  private probeTimer: number | null = null;
  private lastProbe: ProbeResult | null = null;
  private busy = false;
  private conflict: ConflictAction = "rename";
  /** The file name came from the server and has not been edited by the user. */
  private nameFromServer = true;
  private onStarted: ((record: DownloadRecord) => void) | null = null;

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") this.close();
  };

  /** Registers the callback fired after a successful `download_add`. */
  withStarted(callback: (record: DownloadRecord) => void): this {
    this.onStarted = callback;
    return this;
  }

  async open(options: DownloadDialogOptions = {}): Promise<void> {
    this.close();
    this.conflict = "rename";
    this.nameFromServer = true;
    this.lastProbe = null;

    const settings = await api.settingsGet().catch(() => null);
    const maxConnections = Math.max(
      1,
      Math.min(16, settings?.downloads.maxConnectionsPerDownload ?? 8),
    );
    const defaultConnections = Math.max(
      1,
      Math.min(
        maxConnections,
        options.connections ?? settings?.downloads.connectionsPerDownload ?? 4,
      ),
    );
    const defaultDir =
      options.destDir ??
      settings?.general.defaultDownloadDir ??
      (await api.defaultDownloadDir().catch(() => ""));

    const refs = this.build({
      options,
      defaultDir,
      defaultConnections,
      maxConnections,
    });
    this.refs = refs;

    refs.url.addEventListener("input", () => {
      this.lastProbe = null;
      refs.facts.setAttribute("hidden", "");
      refs.conflictBox.setAttribute("hidden", "");
      const error = clientUrlError(refs.url.value);
      this.showUrlError(error);
      if (!error) this.scheduleProbe();
    });
    refs.name.addEventListener("input", () => {
      this.nameFromServer = false;
    });
    refs.dir.addEventListener("change", () => void this.refreshSpace());
    refs.url.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.probeThenStart();
      }
    });
    refs.name.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.start();
      }
    });

    refs.url.focus();
    refs.url.select();
    void this.refreshSpace();
    if (refs.url.value.trim().length > 0) this.scheduleProbe(250);
  }

  close(): void {
    document.removeEventListener("keydown", this.onKeyDown);
    if (this.probeTimer !== null) window.clearTimeout(this.probeTimer);
    this.probeTimer = null;
    this.probeToken += 1;
    this.node?.remove();
    this.node = null;
    this.refs = null;
  }

  // --- construction -----------------------------------------------------

  private build(context: {
    options: DownloadDialogOptions;
    defaultDir: string;
    defaultConnections: number;
    maxConnections: number;
  }): Refs {
    const { options, defaultDir, defaultConnections, maxConnections } = context;

    const url = el("input", {
      attrs: {
        type: "text",
        id: "dlg-url",
        placeholder: "https://example.com/file.zip",
        spellcheck: "false",
        autocomplete: "off",
      },
    });
    url.value = options.url ?? "";

    const dir = el("input", {
      attrs: { type: "text", spellcheck: "false", placeholder: "C:\\Users\\me\\Downloads" },
    });
    dir.value = defaultDir;

    const name = el("input", { attrs: { type: "text", spellcheck: "false", placeholder: "file name" } });
    const connections = el("input", {
      attrs: {
        type: "number",
        min: "1",
        max: String(maxConnections),
        step: "1",
        "aria-label": "Number of connections",
      },
    });
    connections.value = String(defaultConnections);
    const sha = el("input", {
      attrs: { type: "text", spellcheck: "false", placeholder: "optional, 64 hex characters" },
    });
    sha.value = options.sha256 ?? "";

    const urlError = el("div", { class: "error", attrs: { hidden: true } });
    const hint = el("div", {
      class: "hint",
      text: "Check contacts the server for the real file name, size and resume support.",
    });

    const factKey = (label: string) => el("span", { class: "k", text: label });
    const factValue = () => el("div", { class: "v", text: "—" });
    const values = [factValue(), factValue(), factValue(), factValue(), factValue()];
    const facts = el("div", { class: "file-facts", attrs: { hidden: true } }, [
      el("div", {}, [factKey("File name"), values[0]]),
      el("div", {}, [factKey("Size"), values[1]]),
      el("div", {}, [factKey("Content type"), values[2]]),
      el("div", {}, [factKey("Resume support"), values[3]]),
      el("div", {}, [factKey("Last modified"), values[4]]),
    ]);

    const conflictText = el("span", {});
    const choices = el("div", { class: "row" });
    const conflictBox = el("div", { class: "banner warning", attrs: { hidden: true } }, [
      conflictText,
      el("span", { class: "spacer" }),
      choices,
    ]);
    const choice = (value: ConflictAction, label: string, description: string) => {
      const button = el("button", {
        class: "btn small",
        text: label,
        attrs: { type: "button", title: description },
        on: {
          click: () => {
            this.conflict = value;
            for (const child of Array.from(choices.children)) {
              child.classList.toggle("primary", child === button);
            }
          },
        },
      });
      if (value === this.conflict) button.classList.add("primary");
      choices.append(button);
    };
    choice("replace", "Replace", "Overwrite the existing file once the new download is verified");
    choice("rename", "Keep both", "Save next to it as “name (2).ext”");
    choice("cancel", "Cancel", "Do not start the download at all");

    const spaceLine = el("div", { class: "hint" });
    const connectionsHint = el("span", {
      class: "hint",
      text: `1–${maxConnections} connections`,
    });

    const spinner = el("span", { class: "spinner", attrs: { hidden: true } });
    const check = el("button", {
      class: "btn",
      attrs: { type: "button" },
      text: "Check",
      on: { click: () => void this.probe(true) },
    });
    const start = el("button", {
      class: "btn primary",
      attrs: { type: "button" },
      text: "Start download",
      on: { click: () => void this.probeThenStart() },
    });

    const modal = el(
      "div",
      { class: "modal", attrs: { role: "dialog", "aria-modal": "true", "aria-label": "New download" } },
      [
        el("header", {}, [
          el("h2", { text: "New download" }),
          el("span", { class: "spacer" }),
          el("button", {
            class: "btn ghost icon",
            attrs: { type: "button", "aria-label": "Close" },
            text: "✕",
            on: { click: () => this.close() },
          }),
        ]),
        el("div", { class: "content" }, [
          el("div", { class: "field" }, [
            el("label", { text: "Download address", attrs: { for: "dlg-url" } }),
            url,
            urlError,
            hint,
          ]),
          facts,
          conflictBox,
          el("div", { class: "field" }, [
            el("label", { text: "Save to" }),
            el("div", { class: "path-row" }, [
              dir,
              el("button", {
                class: "btn",
                text: "Browse…",
                attrs: { type: "button" },
                on: { click: () => void this.browseFolder() },
              }),
            ]),
            spaceLine,
          ]),
          el("div", { class: "field" }, [
            el("label", { text: "File name" }),
            name,
          ]),
          el("div", { class: "row wrap" }, [
            el("div", { class: "field" }, [
              el("label", { text: "Connections" }),
              connections,
              connectionsHint,
            ]),
            el("div", { class: "field", style: { flex: "1" } }, [
              el("label", { text: "SHA-256 (optional)" }),
              sha,
              el("span", { class: "hint", text: "Verified after the download finishes" }),
            ]),
          ]),
        ]),
        el("footer", {}, [
          check,
          spinner,
          el("span", { class: "spacer" }),
          el("button", {
            class: "btn ghost",
            text: "Cancel",
            attrs: { type: "button" },
            on: { click: () => this.close() },
          }),
          start,
        ]),
      ],
    );

    const backdrop = el("div", { class: "modal-backdrop" }, [modal]);
    backdrop.addEventListener("mousedown", (event) => {
      if (event.target === backdrop) this.close();
    });
    document.addEventListener("keydown", this.onKeyDown);

    const root = document.getElementById("modal-root") ?? document.body;
    root.append(backdrop);
    this.node = backdrop;

    return {
      url,
      dir,
      name,
      connections,
      sha,
      urlError,
      hint,
      facts,
      values,
      conflictBox,
      conflictText,
      spaceLine,
      check,
      start,
      spinner,
      connectionsHint,
    };
  }

  private async browseFolder(): Promise<void> {
    const refs = this.refs;
    if (!refs) return;
    const picked = await api.pickFolder(refs.dir.value.trim() || null).catch(() => null);
    if (picked) {
      refs.dir.value = picked;
      void this.refreshSpace();
    }
  }

  // --- probing ----------------------------------------------------------

  private scheduleProbe(delay = 550): void {
    if (this.probeTimer !== null) window.clearTimeout(this.probeTimer);
    this.probeTimer = window.setTimeout(() => {
      this.probeTimer = null;
      void this.probe(false);
    }, delay);
  }

  private showUrlError(message: string | null): void {
    const refs = this.refs;
    if (!refs) return;
    if (message) {
      refs.urlError.textContent = message;
      refs.urlError.removeAttribute("hidden");
      refs.url.classList.add("invalid");
    } else {
      refs.urlError.setAttribute("hidden", "");
      refs.url.classList.remove("invalid");
    }
  }

  /** Asks the backend about the URL. Returns the probe result or `null`. */
  private async probe(explicit: boolean): Promise<ProbeResult | null> {
    const refs = this.refs;
    if (!refs) return null;
    const url = refs.url.value.trim();

    const error = clientUrlError(url);
    this.showUrlError(error);
    if (error) return null;

    const token = ++this.probeToken;
    refs.spinner.removeAttribute("hidden");
    if (explicit) setText(refs.hint, "Contacting the server…");

    try {
      const result = await api.probe(url, refs.dir.value.trim() || null);
      if (token !== this.probeToken) return null;
      this.lastProbe = result;
      this.applyProbe(result);
      return result;
    } catch (raw) {
      if (token !== this.probeToken) return null;
      const failure = toUiError(raw);
      this.lastProbe = null;
      this.showUrlError(failure.message);
      setText(refs.hint, "The server could not be reached for this address.");
      return null;
    } finally {
      if (token === this.probeToken) refs.spinner.setAttribute("hidden", "");
    }
  }

  private applyProbe(result: ProbeResult): void {
    const refs = this.refs;
    if (!refs) return;

    if (this.nameFromServer || refs.name.value.trim().length === 0) {
      refs.name.value = result.filename;
    }

    refs.facts.removeAttribute("hidden");
    setText(refs.values[0], result.filename || "—");
    setText(
      refs.values[1],
      result.contentLength === null ? "unknown (server sends no length)" : formatBytes(result.contentLength),
    );
    setText(refs.values[2], result.contentType ?? "not specified");
    setText(
      refs.values[3],
      result.acceptsRanges
        ? "supported — segmented download available"
        : "not supported — single connection",
    );
    setText(refs.values[4], result.lastModified ?? "not provided");
    setText(refs.hint, `Server answered HTTP ${result.httpStatus}.`);

    // Only offer more than one connection when the server can actually serve
    // ranges; the backend enforces the same rule.
    if (!result.acceptsRanges) {
      refs.connections.value = "1";
      refs.connections.disabled = true;
      setText(refs.connectionsHint, "This server does not support ranged requests.");
    } else {
      refs.connections.disabled = false;
      const wanted = Number.parseInt(refs.connections.value, 10);
      const max = Number.parseInt(refs.connections.max, 10);
      refs.connections.value = String(Math.max(1, Math.min(Number.isFinite(wanted) ? wanted : 1, max)));
      setText(refs.connectionsHint, `1–${max} connections`);
    }

    if (result.existingFile) {
      const existing = result.existingFile;
      const base = existing.path.split(/[\\/]/).pop() ?? existing.path;
      refs.conflictText.textContent =
        `“${base}” already exists (${formatBytes(existing.size)}, modified ${formatTimestamp(existing.modified)}). ` +
        "Choose how to continue.";
      refs.conflictBox.removeAttribute("hidden");
    } else {
      refs.conflictBox.setAttribute("hidden", "");
      this.conflict = "rename";
    }

    void this.refreshSpace();
  }

  private async refreshSpace(): Promise<void> {
    const refs = this.refs;
    if (!refs) return;
    const dir = refs.dir.value.trim();
    if (dir.length === 0) {
      setText(refs.spaceLine, "");
      return;
    }
    try {
      const free = await api.freeSpace(dir);
      if (free === null) {
        setText(refs.spaceLine, "");
        return;
      }
      const needed = this.lastProbe?.contentLength ?? null;
      if (needed !== null && needed > free) {
        refs.spaceLine.classList.add("error");
        setText(
          refs.spaceLine,
          `Not enough space in ${shortenMiddle(dir, 44)}: ${formatBytes(free)} free, ${formatBytes(needed)} needed.`,
        );
      } else {
        refs.spaceLine.classList.remove("error");
        setText(refs.spaceLine, `${formatBytes(free)} free in ${shortenMiddle(dir, 44)}.`);
      }
    } catch {
      setText(refs.spaceLine, "");
    }
  }

  // --- starting ---------------------------------------------------------

  private async probeThenStart(): Promise<void> {
    if (this.lastProbe) {
      await this.start();
      return;
    }
    const result = await this.probe(true);
    if (result) await this.start();
  }

  private async start(): Promise<void> {
    const refs = this.refs;
    if (!refs || this.busy) return;

    const url = refs.url.value.trim();
    const error = clientUrlError(url);
    this.showUrlError(error);
    if (error) return;
    if (!this.lastProbe) {
      await this.probe(true);
      if (!this.lastProbe) return;
    }

    const args: AddDownloadArgs = {
      url,
      destDir: refs.dir.value.trim() || null,
      filename: refs.name.value.trim() || null,
      connections: Number.parseInt(refs.connections.value, 10) || 1,
      sha256: refs.sha.value.trim() || null,
      onConflict: this.conflict,
      start: true,
    };

    this.busy = true;
    refs.start.disabled = true;
    refs.check.disabled = true;
    refs.spinner.removeAttribute("hidden");

    try {
      const record = await api.add(args);
      this.busy = false;
      this.close();
      this.onStarted?.(record);
    } catch (raw) {
      this.busy = false;
      refs.start.disabled = false;
      refs.check.disabled = false;
      refs.spinner.setAttribute("hidden", "");
      const failure = toUiError(raw);
      this.showUrlError(failure.message);
      setText(refs.hint, "The download could not be started.");
    }
  }
}

/**
 * Instant, client-side sanity check. The backend validates the URL again — this
 * only avoids a pointless round trip while the user is still typing.
 */
export function clientUrlError(raw: string): string | null {
  const text = raw.trim();
  if (text.length === 0) return "Enter the address you want to download from.";
  if (text.length > 4000) return "That address is too long.";
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return "That does not look like a valid address.";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "Only http:// and https:// addresses can be downloaded.";
  }
  if (parsed.hostname.length === 0) return "The address has no host name.";
  return null;
}
