/**
 * Settings — the complete configuration surface.
 *
 * Every control writes into a local draft that is sent to the backend with a
 * short debounce. The backend clamps the values (concurrency, timeouts, buffer
 * sizes …) and returns what it actually stored, which is what the fields then
 * show — so the screen can never display a value the engine did not accept.
 */

import { api } from "../lib/api";
import { confirmDialog } from "../components/dialogs";
import { el, setText } from "../lib/dom";
import { toUiError } from "../lib/errors";
import { formatBytes, formatLimit, formatTimestamp, parseLimit } from "../lib/format";
import { store } from "../lib/store";
import type { AppSettings, LogRecord, LogLevel, Theme } from "../lib/types";
import { toast, toastError } from "../components/toast";
import type { View } from "../lib/view";

interface Control {
  row: HTMLElement;
  /** Applies a (possibly clamped) value coming back from the backend. */
  write: (settings: AppSettings) => void;
  /** Element that must not be rewritten while the user is typing in it. */
  element: HTMLElement;
}

type TabName = "general" | "downloads" | "network" | "appearance" | "advanced" | "about";

export function createSettingsView(): View {
  let draft: AppSettings | null = null;
  let saveTimer: number | null = null;
  let blockReason = "";
  let logLevelFilter: LogLevel | "all" = "all";
  let autostartRequested: boolean | null = null;

  const status = el("span", { class: "faint", text: "" });
  const controls: Control[] = [];
  const register = <T extends Control>(control: T): T => {
    controls.push(control);
    return control;
  };

  // ---------------------------------------------------------------- rows --

  const numberRow = (
    title: string,
    hint: string,
    range: { min: number; max: number; step?: number; unit?: string },
    read: (s: AppSettings) => number,
    write: (s: AppSettings, value: number) => void,
  ): Control => {
    const input = el("input", {
      attrs: {
        type: "number",
        min: String(range.min),
        max: String(range.max),
        step: String(range.step ?? 1),
      },
    });
    input.addEventListener("input", () => {
      const value = Number.parseInt(input.value, 10);
      if (!Number.isFinite(value)) return;
      mutate((settings) => write(settings, value));
    });
    return register({
      row: settingRow(title, hint, [input, range.unit ? el("span", { class: "faint", text: range.unit }) : null]),
      element: input,
      write: (settings) => {
        if (document.activeElement !== input) input.value = String(read(settings));
      },
    });
  };

  const toggleRow = (
    title: string,
    hint: string,
    read: (s: AppSettings) => boolean,
    write: (s: AppSettings, value: boolean) => void,
    onChange?: (value: boolean) => void,
  ): Control => {
    const input = el("input", { attrs: { type: "checkbox" } });
    input.addEventListener("change", () => {
      const value = input.checked;
      onChange?.(value);
      mutate((settings) => write(settings, value));
    });
    const label = el("label", { class: "switch" }, [
      input,
      el("span", { class: "track" }),
      el("span", { class: "label", text: "" }),
    ]);
    return register({
      row: settingRow(title, hint, [label]),
      element: input,
      write: (settings) => {
        input.checked = read(settings);
      },
    });
  };

  const textRow = (
    title: string,
    hint: string,
    read: (s: AppSettings) => string,
    write: (s: AppSettings, value: string) => void,
    options: { placeholder?: string; validate?: (value: string) => string | null } = {},
  ): Control => {
    const input = el("input", {
      attrs: { type: "text", placeholder: options.placeholder ?? "", spellcheck: "false" },
    });
    const error = el("div", { class: "hint" });
    error.style.gridColumn = "1 / -1";
    input.addEventListener("change", () => {
      const message = options.validate?.(input.value.trim()) ?? null;
      setText(error, message ?? "");
      error.classList.toggle("error", Boolean(message));
      if (message) return;
      mutate((settings) => write(settings, input.value.trim()));
    });
    const row = settingRow(title, hint, [input]);
    row.append(error);
    return register({
      row,
      element: input,
      write: (settings) => {
        if (document.activeElement !== input) input.value = read(settings);
      },
    });
  };

  const dirRow = (
    title: string,
    hint: string,
    read: (s: AppSettings) => string,
    write: (s: AppSettings, value: string) => void,
  ): Control => {
    const input = el("input", { attrs: { type: "text", spellcheck: "false" } });
    const note = el("div", { class: "hint" });
    const check = el("button", {
      class: "btn small",
      text: "Check",
      attrs: { type: "button" },
      on: {
        click: async () => {
          const dir = input.value.trim();
          if (dir.length === 0) {
            setText(note, "Enter a folder.");
            note.classList.add("error");
            return;
          }
          try {
            await api.checkFolder(dir);
            setText(note, "The folder exists and is writable.");
            note.classList.remove("error");
          } catch (raw) {
            setText(note, toUiError(raw).message);
            note.classList.add("error");
          }
        },
      },
    });
    input.addEventListener("change", () => {
      if (input.value.trim().length === 0) {
        setText(note, "A download folder is required.");
        note.classList.add("error");
        return;
      }
      setText(note, "");
      note.classList.remove("error");
      mutate((settings) => write(settings, input.value.trim()));
    });
    note.style.gridColumn = "1 / -1";
    const row = settingRow(title, hint, [
      el("div", { class: "path-row" }, [
        input,
        el("button", {
          class: "btn small",
          text: "Browse…",
          attrs: { type: "button" },
          on: {
            click: async () => {
              const picked = await api.pickFolder(input.value.trim() || null).catch(() => null);
              if (!picked) return;
              input.value = picked;
              setText(note, "");
              mutate((settings) => write(settings, picked));
            },
          },
        }),
        check,
      ]),
    ]);
    row.append(note);
    return register({
      row,
      element: input,
      write: (settings) => {
        if (document.activeElement !== input) input.value = read(settings);
      },
    });
  };

  const selectRow = <T extends string>(
    title: string,
    hint: string,
    options: Array<{ value: T; label: string }>,
    read: (s: AppSettings) => T,
    write: (s: AppSettings, value: T) => void,
    onChange?: (value: T) => void,
  ): Control => {
    const select = el("select", {});
    for (const option of options) {
      select.append(el("option", { attrs: { value: option.value }, text: option.label }));
    }
    select.addEventListener("change", () => {
      const value = select.value as T;
      onChange?.(value);
      mutate((settings) => write(settings, value));
    });
    return register({
      row: settingRow(title, hint, [select]),
      element: select,
      write: (settings) => {
        select.value = read(settings);
      },
    });
  };

  const themeRow = (): Control => {
    const buttons: HTMLButtonElement[] = [];
    const apply = (theme: Theme) => {
      for (const button of buttons) button.classList.toggle("active", button.dataset.theme === theme);
    };
    buttons.push(
      ...[
        { value: "light" as Theme, label: "Light" },
        { value: "dark" as Theme, label: "Dark" },
        { value: "system" as Theme, label: "System" },
      ].map((option) =>
        el("button", {
          class: "btn small",
          text: option.label,
          attrs: { type: "button", "data-theme": option.value },
          on: {
            click: () => {
              apply(option.value);
              mutate((settings) => {
                settings.general.theme = option.value;
              });
            },
          },
        }),
      ),
    );
    return register({
      row: settingRow(
        "Theme",
        "System follows the Windows light/dark setting",
        [el("div", { class: "row" }, buttons)],
      ),
      element: buttons[0],
      write: (settings) => apply(settings.general.theme),
    });
  };

  const speedLimitRow = (): Control => {
    const select = el("select", {});
    const presets: Array<{ value: string; label: string }> = [
      { value: "unlimited", label: "Unlimited" },
      { value: "100000", label: "100 KB/s" },
      { value: "500000", label: "500 KB/s" },
      { value: "1048576", label: "1 MB/s" },
      { value: "5242880", label: "5 MB/s" },
      { value: "10485760", label: "10 MB/s" },
      { value: "custom", label: "Custom…" },
    ];
    for (const preset of presets) {
      select.append(el("option", { attrs: { value: preset.value }, text: preset.label }));
    }
    const custom = el("input", {
      attrs: { type: "text", placeholder: "e.g. 750 KB", "aria-label": "Custom limit" },
    });
    custom.style.maxWidth = "110px";
    const note = el("span", { class: "faint" });

    const readValue = (): number | null => {
      if (select.value === "unlimited") return null;
      if (select.value === "custom") {
        const parsed = parseLimit(custom.value);
        return parsed === undefined ? null : parsed;
      }
      return Number.parseInt(select.value, 10);
    };

    const commit = () => {
      const value = readValue();
      setText(note, value === null ? "no limit" : `${formatLimit(value)}`);
      mutate((settings) => {
        settings.downloads.speedLimitBps = value;
      });
    };

    select.addEventListener("change", () => {
      custom.toggleAttribute("hidden", select.value !== "custom");
      commit();
    });
    custom.addEventListener("change", commit);

    return register({
      row: settingRow(
        "Global speed limit",
        "Throttles every download together. Per-download limits are available in the list menu.",
        [select, custom, note],
      ),
      element: select,
      write: (settings) => {
        const value = settings.downloads.speedLimitBps;
        const known = value === null ? "unlimited" : String(value);
        const hasPreset = presets.some((preset) => preset.value === known);
        select.value = value === null ? "unlimited" : hasPreset ? known : "custom";
        custom.toggleAttribute("hidden", select.value !== "custom");
        if (select.value === "custom" && value !== null && document.activeElement !== custom) {
          custom.value = formatBytes(value, 0);
        }
        setText(note, value === null ? "no limit" : formatLimit(value));
      },
    });
  };

  const buttonRow = (title: string, hint: string, buttons: HTMLElement[]): HTMLElement =>
    settingRow(title, hint, [el("div", { class: "row wrap" }, buttons)]);

  // ------------------------------------------------------------ controls --

  const general: Control[] = [
    dirRow(
      "Default download folder",
      "Where new downloads are saved unless you choose another folder in the dialog",
      (s) => s.general.defaultDownloadDir,
      (s, value) => {
        s.general.defaultDownloadDir = value;
      },
    ),
    toggleRow(
      "Start with Windows",
      "Adds SwiftLoad to your own startup entries; only your user account is affected",
      (s) => s.general.startWithWindows,
      (s, value) => {
        s.general.startWithWindows = value;
      },
      (value) => {
        autostartRequested = value;
      },
    ),
    toggleRow(
      "Desktop notifications",
      "Show a Windows notification when a download finishes or fails",
      (s) => s.general.notifications,
      (s, value) => {
        s.general.notifications = value;
      },
    ),
    toggleRow(
      "Bring the window forward when a download finishes",
      "Only applies while notifications are enabled",
      (s) => s.general.focusOnComplete,
      (s, value) => {
        s.general.focusOnComplete = value;
      },
    ),
    toggleRow(
      "Confirm before removing downloads",
      "Removing an entry deletes its partial data. Deleting a finished file always asks first.",
      (s) => s.general.confirmBeforeDelete,
      (s, value) => {
        s.general.confirmBeforeDelete = value;
      },
    ),
    toggleRow(
      "Watch the clipboard for links",
      "When the window regains focus, a copied download link is offered on the dashboard — no timer, no background process",
      (s) => s.general.clipboardWatch,
      (s, value) => {
        s.general.clipboardWatch = value;
      },
    ),
  ];

  const downloads: Control[] = [
    numberRow(
      "Maximum simultaneous downloads",
      "Extra downloads wait in the queue and start as soon as a slot is free",
      { min: 1, max: 16 },
      (s) => s.downloads.maxConcurrent,
      (s, value) => {
        s.downloads.maxConcurrent = value;
      },
    ),
    numberRow(
      "Connections per download",
      "Starting point for servers that support ranged requests",
      { min: 1, max: 32 },
      (s) => s.downloads.connectionsPerDownload,
      (s, value) => {
        s.downloads.connectionsPerDownload = value;
      },
    ),
    numberRow(
      "Maximum connections",
      "Upper bound the adaptive controller may use",
      { min: 1, max: 32 },
      (s) => s.downloads.maxConnectionsPerDownload,
      (s, value) => {
        s.downloads.maxConnectionsPerDownload = value;
      },
    ),
    toggleRow(
      "Adjust connections automatically",
      "Adds a connection when throughput improves, removes one when it drops or fails",
      (s) => s.downloads.adaptiveConnections,
      (s, value) => {
        s.downloads.adaptiveConnections = value;
      },
    ),
    numberRow(
      "Retries per download",
      "Failed attempts are retried with exponential backoff (1s, 2s, 4s…). Invalid addresses are never retried.",
      { min: 0, max: 20 },
      (s) => s.downloads.maxRetries,
      (s, value) => {
        s.downloads.maxRetries = value;
      },
    ),
    numberRow(
      "Retry delay",
      "Base delay; each further attempt doubles it",
      { min: 100, max: 60_000, step: 100, unit: "ms" },
      (s) => s.downloads.retryDelayMs,
      (s, value) => {
        s.downloads.retryDelayMs = value;
      },
    ),
    numberRow(
      "Maximum retry delay",
      "Upper bound for the backoff and for a server's Retry-After header",
      { min: 1000, max: 900_000, step: 1000, unit: "ms" },
      (s) => s.downloads.retryMaxDelayMs,
      (s, value) => {
        s.downloads.retryMaxDelayMs = value;
      },
    ),
    speedLimitRow(),
    toggleRow(
      "Verify segments when resuming",
      "Re-reads the last bytes of every segment so a partially written block is never trusted",
      (s) => s.downloads.verifyOnResume,
      (s, value) => {
        s.downloads.verifyOnResume = value;
      },
    ),
    toggleRow(
      "Keep partial files when cancelling",
      "Off means cancelling removes the .part file",
      (s) => s.downloads.keepPartialFiles,
      (s, value) => {
        s.downloads.keepPartialFiles = value;
      },
    ),
    toggleRow(
      "Check free space before starting",
      "Compares the announced size with the free space of the destination volume",
      (s) => s.downloads.checkFreeSpace,
      (s, value) => {
        s.downloads.checkFreeSpace = value;
      },
    ),
    toggleRow(
      "Compute SHA-256 for every download",
      "Reads the finished file once more and stores the hash in the history",
      (s) => s.downloads.computeSha256,
      (s, value) => {
        s.downloads.computeSha256 = value;
      },
    ),
  ];

  const network: Control[] = [
    numberRow(
      "Connection timeout",
      "How long SwiftLoad waits for a TCP/TLS handshake",
      { min: 1000, max: 120_000, step: 500, unit: "ms" },
      (s) => s.network.connectTimeoutMs,
      (s, value) => {
        s.network.connectTimeoutMs = value;
      },
    ),
    numberRow(
      "Stall timeout",
      "Abort a transfer that receives nothing for this long. There is no whole-request timeout, so long downloads are never killed while they make progress.",
      { min: 0, max: 600_000, step: 1000, unit: "ms" },
      (s) => s.network.stallTimeoutMs,
      (s, value) => {
        s.network.stallTimeoutMs = value;
      },
    ),
    selectRow(
      "Proxy",
      "System uses the Windows proxy settings; custom accepts http://, https:// and socks5:// addresses",
      [
        { value: "off", label: "No proxy" },
        { value: "system", label: "Windows system proxy" },
        { value: "custom", label: "Custom proxy" },
      ],
      (s) => s.network.proxyMode,
      (s, value) => {
        s.network.proxyMode = value;
      },
    ),
    textRow(
      "Proxy address",
      "Example: http://127.0.0.1:8080",
      (s) => s.network.proxyUrl,
      (s, value) => {
        s.network.proxyUrl = value;
      },
      {
        validate: (value) => {
          if (value.length === 0) {
            blockReason = "";
            return null;
          }
          if (!/^(https?|socks5h?):\/\/.+/i.test(value)) {
            const message = "Use a full proxy address such as http://host:port.";
            blockReason = message;
            return message;
          }
          blockReason = "";
          return null;
        },
      },
    ),
    textRow(
      "Bypass proxy for",
      "Comma separated host names",
      (s) => s.network.noProxy,
      (s, value) => {
        s.network.noProxy = value;
      },
      { placeholder: "localhost, 127.0.0.1" },
    ),
    textRow(
      "User agent",
      "Sent with every request; some servers require a browser-like value",
      (s) => s.network.userAgent,
      (s, value) => {
        s.network.userAgent = value;
      },
      {
        validate: (value) => (value.length === 0 ? "A user agent is required." : null),
      },
    ),
    numberRow(
      "Maximum redirects",
      "",
      { min: 0, max: 30 },
      (s) => s.network.maxRedirects,
      (s, value) => {
        s.network.maxRedirects = value;
      },
    ),
    numberRow(
      "Idle connections per host",
      "Connections kept open for the next request",
      { min: 0, max: 64 },
      (s) => s.network.poolIdlePerHost,
      (s, value) => {
        s.network.poolIdlePerHost = value;
      },
    ),
    toggleRow(
      "Use HTTP/1.1 only",
      "Some servers handle large ranged requests incorrectly over HTTP/2",
      (s) => s.network.http1Only,
      (s, value) => {
        s.network.http1Only = value;
      },
    ),
  ];

  const appearance: Control[] = [
    themeRow(),
    toggleRow(
      "Compact mode",
      "Tighter rows so more downloads fit on the screen",
      (s) => s.general.compactMode,
      (s, value) => {
        s.general.compactMode = value;
      },
    ),
    numberRow(
      "Progress refresh interval",
      "How often the engine pushes progress to the window; lower values look smoother",
      { min: 100, max: 5000, step: 50, unit: "ms" },
      (s) => s.advanced.uiRefreshMs,
      (s, value) => {
        s.advanced.uiRefreshMs = value;
      },
    ),
  ];

  const advanced: Control[] = [
    selectRow(
      "Log level",
      "Written to %LOCALAPPDATA%\\SwiftLoad\\logs, one file per day, the last seven kept",
      [
        { value: "debug", label: "Debug (most detailed)" },
        { value: "info", label: "Info" },
        { value: "warn", label: "Warnings" },
        { value: "error", label: "Errors only" },
      ],
      (s) => s.advanced.logLevel,
      (s, value) => {
        s.advanced.logLevel = value;
      },
    ),
    dirRow(
      "Temporary download folder",
      "Leave empty to keep the .part file and its .swlmeta next to the target file",
      (s) => s.advanced.tempDir,
      (s, value) => {
        s.advanced.tempDir = value;
      },
    ),
    numberRow(
      "Resume checkpoint interval",
      "How often the on-disk progress of running downloads is written to the database",
      { min: 500, max: 60_000, step: 500, unit: "ms" },
      (s) => s.advanced.checkpointIntervalMs,
      (s, value) => {
        s.advanced.checkpointIntervalMs = value;
      },
    ),
    numberRow(
      "Write buffer",
      "Bytes buffered per connection before a write; larger values use more memory",
      { min: 8192, max: 4 * 1024 * 1024, step: 8192, unit: "bytes" },
      (s) => s.advanced.writeBufferBytes,
      (s, value) => {
        s.advanced.writeBufferBytes = value;
      },
    ),
    toggleRow(
      "Sparse files",
      "Preallocate with sparse blocks so the disk is not filled before the bytes arrive",
      (s) => s.advanced.sparseFiles,
      (s, value) => {
        s.advanced.sparseFiles = value;
      },
    ),
    toggleRow(
      "Notification for every completed download",
      "Needs the master switch in General",
      (s) => s.advanced.notifyOnComplete,
      (s, value) => {
        s.advanced.notifyOnComplete = value;
      },
    ),
  ];

  // --------------------------------------------------------------- pages --

  const logView = el("div", { class: "log-view" });
  const logLevelSelect = el("select", {});
  for (const option of [
    { value: "all", label: "All levels" },
    { value: "debug", label: "Debug" },
    { value: "info", label: "Info" },
    { value: "warn", label: "Warnings" },
    { value: "error", label: "Errors" },
  ]) {
    logLevelSelect.append(el("option", { attrs: { value: option.value }, text: option.label }));
  }
  logLevelSelect.addEventListener("change", () => {
    logLevelFilter = logLevelSelect.value as LogLevel | "all";
    void loadLogs();
  });

  async function loadLogs(): Promise<void> {
    try {
      const records = await api.logs(400, logLevelFilter === "all" ? null : logLevelFilter);
      if (records.length === 0) {
        setText(logView, "No log entries yet.");
        return;
      }
      logView.replaceChildren(...records.map(logLine));
      logView.scrollTop = 0;
    } catch (raw) {
      setText(logView, toUiError(raw).message);
    }
  }

  function logLine(record: LogRecord): HTMLElement {
    return el("div", { class: `log-line ${record.level}` }, [
      el("span", { class: "time", text: formatTimestamp(record.timestamp) }),
      el("span", { class: "cat", text: record.category }),
      el("span", { class: "msg", text: record.downloadId ? `[${record.downloadId}] ${record.message}` : record.message }),
    ]);
  }

  const aboutRows = el("div", { class: "settings-section" });
  const integrationStatusLabel = el("span", { class: "faint" });
  const integrationToggle = el("input", { attrs: { type: "checkbox" } });
  integrationToggle.addEventListener("change", async () => {
    try {
      const enabled = await api.integrationSet(integrationToggle.checked);
      integrationToggle.checked = enabled;
      setText(
        integrationStatusLabel,
        enabled
          ? "Registered for your user account (HKCU\\Software\\Classes\\swiftload)"
          : "Not registered",
      );
      toast.info(enabled ? "Link handler registered" : "Link handler removed");
    } catch (raw) {
      integrationToggle.checked = !integrationToggle.checked;
      toastError(toUiError(raw));
    }
  });

  async function loadAbout(): Promise<void> {
    try {
      const info = await api.appInfo();
      store.setAppInfo(info);
      const rows: Array<[string, string]> = [
        ["Application", `${info.name} ${info.version}`],
        ["Engine", info.engineVersion],
        ["Tauri", info.tauriVersion],
        ["System", `${info.os} (${info.arch})`],
        ["Executable", info.executable],
        ["Data folder", info.dataDir],
        ["Log folder", info.logDir],
        ["Database", info.databasePath],
        ["Default download folder", info.defaultDownloadDir],
        ["Offline", "SwiftLoad never contacts a server of its own — only the addresses you download from"],
      ];
      aboutRows.replaceChildren(
        ...rows.map(([key, value]) =>
          el("div", { class: "setting stack" }, [
            el("div", { class: "desc" }, [
              el("div", { class: "title", text: key }),
              el("div", { class: "hint mono", text: value }),
            ]),
          ]),
        ),
      );
      integrationToggle.checked = info.integrationRegistered;
      setText(
        integrationStatusLabel,
        info.integrationRegistered
          ? "Registered for your user account (HKCU\\Software\\Classes\\swiftload)"
          : "Not registered",
      );
    } catch (raw) {
      setText(aboutRows, toUiError(raw).message);
    }
  }

  const pageNodes: Record<TabName, HTMLElement> = {
    general: sectionPage("General", "Folders, startup behaviour and notifications", general),
    downloads: sectionPage("Downloads", "Concurrency, connections, retries and bandwidth", downloads),
    network: sectionPage("Network", "Timeouts, proxy and the HTTP client", network),
    appearance: sectionPage("Appearance", "Theme and layout", appearance),
    advanced: el("div", { class: "panel" }, [
      el("header", {}, [
        el("h2", { text: "Advanced" }),
        el("span", { class: "spacer" }),
        el("button", {
          class: "btn small",
          text: "Open log folder",
          attrs: { type: "button" },
          on: {
            click: async () => {
              try {
                await api.logsOpenDir();
              } catch (raw) {
                toastError(toUiError(raw));
              }
            },
          },
        }),
        el("button", {
          class: "btn small",
          text: "Open data folder",
          attrs: { type: "button" },
          on: {
            click: async () => {
              try {
                await api.openDataDir();
              } catch (raw) {
                toastError(toUiError(raw));
              }
            },
          },
        }),
      ]),
      el("div", { class: "body settings-section" }, [
        ...advanced.map((control) => control.row),
        buttonRow("Diagnostics", "Version, paths and database integrity in one block", [
          el("button", {
            class: "btn small",
            text: "Copy diagnostics",
            attrs: { type: "button" },
            on: {
              click: async () => {
                try {
                  const report = await api.diagnostics();
                  await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
                  toast.info("Diagnostics copied to the clipboard");
                } catch (raw) {
                  toastError(toUiError(raw));
                }
              },
            },
          }),
          el("button", {
            class: "btn small",
            text: "Clear settings",
            attrs: { type: "button" },
            on: {
              click: async () => {
                const confirmed = await confirmDialog({
                  title: "Restore every setting?",
                  message: "All settings return to their default values.",
                  confirmLabel: "Restore defaults",
                });
                if (!confirmed) return;
                try {
                  const applied = await api.settingsReset();
                  draft = applied;
                  store.setSettings(applied);
                  applyAll(applied);
                  toast.info("Settings restored");
                } catch (raw) {
                  toastError(toUiError(raw));
                }
              },
            },
          }),
        ]),
        el("div", { class: "setting stack" }, [
          el("div", { class: "desc" }, [
            el("div", { class: "title", text: "Log" }),
            el("div", {
              class: "hint",
              text: "The newest entries are on top; the log keeps one file per day.",
            }),
          ]),
          el("div", { class: "row" }, [
            logLevelSelect,
            el("button", {
              class: "btn small",
              text: "Refresh",
              attrs: { type: "button" },
              on: { click: () => void loadLogs() },
            }),
            el("button", {
              class: "btn small",
              text: "Clear view",
              attrs: { type: "button" },
              on: {
                click: async () => {
                  try {
                    await api.logsClear();
                    void loadLogs();
                  } catch (raw) {
                    toastError(toUiError(raw));
                  }
                },
              },
            }),
          ]),
          logView,
        ]),
      ]),
    ]),
    about: el("div", { class: "panel" }, [
      el("header", {}, [el("h2", { text: "About & integration" }), el("span", { class: "spacer" })]),
      el("div", { class: "body settings-section" }, [
        aboutRows,
        settingRow(
          "Handle swiftload: links",
          "Registers SwiftLoad in your own user account so links you click anywhere open the New Download dialog. Nothing is installed system-wide and no browser extension is added.",
          [el("div", { class: "row" }, [el("label", { class: "switch" }, [integrationToggle, el("span", { class: "track" })]), integrationStatusLabel])],
        ),
      ]),
    ]),
  };

  const tabs: Array<{ name: TabName; label: string }> = [
    { name: "general", label: "General" },
    { name: "downloads", label: "Downloads" },
    { name: "network", label: "Network" },
    { name: "appearance", label: "Appearance" },
    { name: "advanced", label: "Advanced" },
    { name: "about", label: "About" },
  ];

  const tabButtons = tabs.map((tab) =>
    el("button", {
      class: tab.name === "general" ? "active" : "",
      text: tab.label,
      attrs: { type: "button", "data-tab": tab.name },
      on: {
        click: () => {
          for (const button of tabButtons) {
            button.classList.toggle("active", button.dataset.tab === tab.name);
          }
          pages.replaceChildren(pageNodes[tab.name]);
          if (tab.name === "advanced") void loadLogs();
          if (tab.name === "about") void loadAbout();
        },
      },
    }),
  );

  const pages = el("div", {}, [pageNodes.general]);

  const element = el("div", { class: "view" }, [
    el("div", { class: "view-header" }, [
      el("div", { class: "titles" }, [
        el("h1", { text: "Settings" }),
        el("div", { class: "subtitle", text: "Changes are applied immediately and stored in SQLite" }),
      ]),
      el("div", { class: "actions" }, [status]),
    ]),
    el("div", { class: "settings-layout" }, [
      el("div", { class: "settings-tabs" }, tabButtons),
      pages,
    ]),
  ]);

  // -------------------------------------------------------------- wiring --

  function mutate(change: (settings: AppSettings) => void): void {
    if (!draft) return;
    change(draft);
    scheduleSave();
  }

  function applyAll(settings: AppSettings): void {
    for (const control of controls) {
      if (document.activeElement === control.element) continue;
      control.write(settings);
    }
  }

  function scheduleSave(): void {
    setText(status, "Saving…");
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      void saveNow();
    }, 400);
  }

  async function saveNow(): Promise<void> {
    if (!draft) return;
    if (blockReason) {
      setText(status, blockReason);
      status.classList.add("error");
      return;
    }
    status.classList.remove("error");
    try {
      const applied = await api.settingsUpdate(draft);
      draft = applied;
      store.setSettings(applied);
      applyAll(applied);
      setText(status, `Saved at ${new Date().toLocaleTimeString()}`);

      if (autostartRequested !== null) {
        const wanted = autostartRequested;
        autostartRequested = null;
        const info = await api.appInfo().catch(() => null);
        if (info) {
          store.setAppInfo(info);
          if (info.autostartEnabled !== wanted) {
            toast.warning(
              "Windows start-up could not be changed",
              wanted
                ? "The entry was refused. Try running SwiftLoad once without limited rights."
                : "The entry is still present; remove it in Task Manager → Startup.",
            );
          }
        }
      }
    } catch (raw) {
      setText(status, "Not saved");
      status.classList.add("error");
      toastError(toUiError(raw));
    }
  }

  return {
    element,
    onShow() {
      if (draft) applyAll(draft);
    },
    onTopic(topic) {
      if (topic === "settings" && store.settings) {
        draft = store.settings;
        applyAll(draft);
      }
    },
    destroy() {
      if (saveTimer !== null) window.clearTimeout(saveTimer);
    },
  };
}

// ---------------------------------------------------------------- helpers --

function settingRow(title: string, hint: string, control: Array<HTMLElement | null>): HTMLElement {
  const row = el("div", { class: "setting" }, [
    el("div", { class: "desc" }, [
      el("div", { class: "title", text: title }),
      hint.length > 0 ? el("div", { class: "hint", text: hint }) : null,
    ]),
    el("div", { class: "control" }, control),
  ]);
  return row;
}

function sectionPage(title: string, subtitle: string, group: Control[]): HTMLElement {
  return el("div", { class: "panel" }, [
    el("header", {}, [
      el("h2", { text: title }),
      el("span", { class: "spacer" }),
      el("span", { class: "faint", text: subtitle }),
    ]),
    el("div", { class: "body settings-section" }, group.map((control) => control.row)),
  ]);
}
