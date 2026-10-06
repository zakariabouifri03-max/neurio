/**
 * All extension UI lives inside a Shadow DOM with these styles, so Etsy's
 * CSS can't break us and ours can't leak into Etsy. Dark mode by default,
 * light mode follows the page-time toggle.
 */
export const EXTENSION_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, Arial, sans-serif; }

.es-root {
  --es-bg: #0f172a;
  --es-bg-soft: #1e293b;
  --es-border: #334155;
  --es-text: #e2e8f0;
  --es-muted: #94a3b8;
  --es-green: #22c55e;
  --es-yellow: #eab308;
  --es-red: #ef4444;
  --es-gray: #64748b;
  --es-accent: #f97316;
  color: var(--es-text);
  font-size: 12px;
  line-height: 1.35;
}
.es-root.es-light {
  --es-bg: #ffffff;
  --es-bg-soft: #f1f5f9;
  --es-border: #e2e8f0;
  --es-text: #0f172a;
  --es-muted: #64748b;
}

/* ---------- compact panel injected on search cards ---------- */
.es-panel {
  margin-top: 8px;
  border: 1px solid var(--es-border);
  border-radius: 10px;
  background: var(--es-bg);
  padding: 8px 10px;
  width: 100%;
}
.es-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.es-logo { font-weight: 700; font-size: 12px; letter-spacing: .01em; }
.es-est-badge {
  font-size: 9px; font-weight: 700; letter-spacing: .05em;
  background: color-mix(in srgb, var(--es-yellow) 20%, transparent);
  color: var(--es-yellow);
  border: 1px solid color-mix(in srgb, var(--es-yellow) 45%, transparent);
  border-radius: 4px; padding: 1px 4px;
}
.es-spacer { flex: 1; }
.es-why, .es-watch {
  cursor: pointer; border: 1px solid var(--es-border); background: var(--es-bg-soft);
  color: var(--es-text); border-radius: 6px; font-size: 10px; padding: 2px 7px;
}
.es-why:hover, .es-watch:hover { border-color: var(--es-accent); }

.es-real { display: flex; flex-wrap: wrap; gap: 4px 10px; color: var(--es-text); margin-bottom: 6px; }
.es-real b { font-weight: 600; }
.es-tag { font-size: 10px; color: var(--es-muted); }

.es-est { display: flex; flex-direction: column; gap: 3px; margin-bottom: 6px; }
.es-est-row { display: flex; justify-content: space-between; gap: 8px; }
.es-est-label { color: var(--es-muted); font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
.es-est-value { font-weight: 600; white-space: nowrap; }
.es-unavailable { color: var(--es-gray); font-style: italic; font-weight: 400; }

.es-scores { display: flex; gap: 6px; margin-bottom: 6px; }
.es-score {
  flex: 1; text-align: center; border-radius: 8px; padding: 4px 2px;
  border: 1px solid var(--es-border); background: var(--es-bg-soft); cursor: default;
}
.es-score b { display: block; font-size: 14px; }
.es-score span { font-size: 9px; color: var(--es-muted); text-transform: uppercase; letter-spacing: .03em; }
.es-good { color: var(--es-green); }
.es-warn { color: var(--es-yellow); }
.es-bad { color: var(--es-red); }
.es-na { color: var(--es-gray); }

.es-conf { display: flex; align-items: center; gap: 6px; }
.es-conf-bar { flex: 1; height: 5px; background: var(--es-bg-soft); border-radius: 3px; overflow: hidden; }
.es-conf-fill { height: 100%; border-radius: 3px; }
.es-conf-label { font-size: 10px; color: var(--es-muted); white-space: nowrap; }
.es-tracked { font-size: 10px; color: var(--es-muted); margin-top: 4px; }
.es-disclaimer { margin-top: 6px; font-size: 9px; color: var(--es-gray); }

.es-loading { color: var(--es-muted); padding: 4px 0; }
.es-error { color: var(--es-yellow); font-size: 11px; }

/* ---------- evidence modal ---------- */
.es-modal-backdrop {
  position: fixed; inset: 0; background: rgba(2,6,23,.55); z-index: 2147483646;
  display: flex; align-items: center; justify-content: center;
}
.es-modal {
  width: min(560px, 92vw); max-height: 84vh; overflow: auto;
  background: var(--es-bg); border: 1px solid var(--es-border); border-radius: 14px;
  padding: 18px 20px; color: var(--es-text);
}
.es-modal h3 { margin: 0 0 4px; font-size: 15px; }
.es-modal h4 { margin: 14px 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--es-muted); }
.es-modal ul { margin: 0; padding-left: 16px; }
.es-modal li { margin: 3px 0; font-size: 12px; }
.es-modal table { width: 100%; border-collapse: collapse; font-size: 11px; }
.es-modal th, .es-modal td { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--es-border); }
.es-close { float: right; cursor: pointer; background: none; border: none; color: var(--es-muted); font-size: 16px; }
.es-note { font-size: 11px; color: var(--es-muted); }

/* ---------- floating toolbar ---------- */
.es-toolbar {
  position: fixed; left: 16px; bottom: 16px; z-index: 2147483645;
  display: flex; align-items: center; gap: 8px;
  background: var(--es-bg); border: 1px solid var(--es-border); border-radius: 12px;
  padding: 8px 10px; box-shadow: 0 8px 30px rgba(2,6,23,.35);
}
.es-btn {
  cursor: pointer; border: none; border-radius: 8px; padding: 7px 12px;
  font-size: 12px; font-weight: 600; background: var(--es-accent); color: #fff;
}
.es-btn.es-secondary { background: var(--es-bg-soft); color: var(--es-text); border: 1px solid var(--es-border); }
.es-btn:disabled { opacity: .5; cursor: default; }
.es-select {
  background: var(--es-bg-soft); color: var(--es-text); border: 1px solid var(--es-border);
  border-radius: 8px; padding: 6px 8px; font-size: 12px;
}
.es-status { color: var(--es-muted); font-size: 11px; }

/* ---------- listing-page drawer ---------- */
.es-drawer {
  position: fixed; top: 0; right: 0; height: 100vh; width: 400px; max-width: 94vw;
  background: var(--es-bg); border-left: 1px solid var(--es-border); z-index: 2147483645;
  overflow-y: auto; padding: 16px 18px 40px;
  box-shadow: -12px 0 40px rgba(2,6,23,.35);
}
.es-drawer h2 { font-size: 16px; margin: 0 0 2px; }
.es-drawer h4 {
  margin: 18px 0 6px; font-size: 11px; text-transform: uppercase;
  letter-spacing: .07em; color: var(--es-accent);
}
.es-kv { display: grid; grid-template-columns: 1fr auto; gap: 3px 10px; font-size: 12px; }
.es-kv .k { color: var(--es-muted); }
.es-kv .v { font-weight: 600; text-align: right; }
.es-pill-row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.es-pill { border: 1px solid var(--es-border); border-radius: 999px; padding: 2px 9px; font-size: 11px; }
.es-drawer .es-scores { margin-top: 8px; }
.es-spark { width: 100%; height: 64px; }
.es-drawer-close { position: sticky; top: 0; float: right; }
`;
