import React, { useCallback, useEffect, useRef, useState } from "react";
import { ApiClient, HistoryItem, JobStatus } from "./api";

const CATEGORIES = ["shirt", "tshirt", "dress", "jacket", "coat", "trousers", "pants", "skirt", "sweater", "hoodie", "other"] as const;

function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" role="img" aria-label="Anywear AI">
      <rect width="64" height="64" rx="16" fill="#111114" />
      <path d="M32 17 L21 46" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
      <path d="M32 17 L43 46" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
      <path d="M24.5 36.5 L39.5 36.5" stroke="#e8e6e1" strokeWidth="5" strokeLinecap="round" />
      <circle cx="32" cy="49" r="3.4" fill="#fff" />
    </svg>
  );
}

export default function App() {
  const [baseURL, setBaseURL] = useState("http://localhost:8000");
  const [tab, setTab] = useState<"welcome" | "new" | "history" | "settings">("welcome");
  const [health, setHealth] = useState<Awaited<ReturnType<ApiClient["health"]>> | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const showToast = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 3200);
  };

  const client = useRef<ApiClient>(new ApiClient("http://localhost:8000"));
  client.current.baseURL = baseURL;

  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await client.current.health());
    } catch {
      setHealth(null);
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await client.current.history());
    } catch {
      /* offline */
    }
  }, []);

  useEffect(() => {
    refreshHealth();
    refreshHistory();
  }, [refreshHealth, refreshHistory, baseURL]);

  const offline = !health;
  const devMode = health?.dev_mode;

  return (
    <div className="min-h-screen bg-mist">
      {/* header */}
      <header className="sticky top-0 z-10 border-b border-mist-line bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Logo />
            <div>
              <div className="text-lg font-bold tracking-tight text-ink">Anywear AI</div>
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted">Virtual Try-On Studio</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold ${
                offline ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-700"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${offline ? "bg-red-500" : "bg-emerald-500"}`} />
              {offline ? "Backend offline" : devMode ? "Dev mode" : "Live"}
            </span>
            <button
              onClick={() => {
                refreshHealth();
                refreshHistory();
              }}
              className="rounded-full border border-mist-line px-3 py-1 text-[11px] font-semibold text-ink-soft transition-colors hover:bg-mist-line"
            >
              Refresh
            </button>
          </div>
        </div>
        {/* nav */}
        <nav className="mx-auto flex max-w-5xl gap-1 px-6">
          {(["welcome", "new", "history", "settings"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`border-b-2 px-3 py-2.5 text-[13px] font-semibold transition-colors ${
                tab === t ? "border-ink text-ink" : "border-transparent text-ink-muted hover:text-ink"
              }`}
            >
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {toast && (
          <div className="mb-5 animate-fade-in rounded-xl bg-ink px-4 py-3 text-[13px] font-medium text-mist">
            {toast}
          </div>
        )}

        {offline && (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-800">
            <strong>Backend not reachable.</strong> Start it with{" "}
            <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[12px]">
              cd backend && uvicorn app.main:app --reload --port 8000
            </code>{" "}
            — or point this dashboard to another API URL in Settings.
          </div>
        )}

        {tab === "welcome" && (
          <WelcomeSection
            devMode={!!devMode}
            offline={offline}
            historyCount={history.length}
            onNew={() => setTab("new")}
            onHistory={() => setTab("history")}
            onPreview={setPreview}
          />
        )}

        {tab === "new" && (
          <NewTryOn
            client={client.current}
            onToast={showToast}
            onDone={() => {
              refreshHistory();
              setTab("history");
            }}
          />
        )}

        {tab === "history" && (
          <HistorySection
            items={history}
            client={client.current}
            onDelete={async (id) => {
              await client.current.deleteHistory(id);
              setHistory((prev) => prev.filter((h) => h.id !== id));
            }}
            onPreview={setPreview}
            onToast={showToast}
          />
        )}

        {tab === "settings" && (
          <SettingsSection baseURL={baseURL} setBaseURL={setBaseURL} onToast={showToast} />
        )}
      </main>

      {preview && <PreviewModal src={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

/* ---------------- Welcome ---------------- */
function WelcomeSection({
  devMode,
  offline,
  historyCount,
  onNew,
  onHistory,
  onPreview,
}: {
  devMode: boolean;
  offline: boolean;
  historyCount: number;
  onNew: () => void;
  onHistory: () => void;
  onPreview: (src: string) => void;
}) {
  return (
    <div className="animate-fade-in space-y-8">
      <section className="overflow-hidden rounded-3xl bg-white shadow-card">
        <div className="grid md:grid-cols-2">
          <div className="flex flex-col justify-center p-10">
            <div className="mb-4 inline-flex w-fit rounded-full bg-mist px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
              Try anything, anywhere
            </div>
            <h1 className="font-display text-4xl leading-tight text-ink">
              See it on you before you buy it.
            </h1>
            <p className="mt-3 text-[14px] leading-relaxed text-ink-muted">
              Drop a garment photo and a picture of yourself — Anywear generates a realistic
              virtual try-on in seconds. Works with any store, any style, any device.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                onClick={onNew}
                disabled={offline}
                className="rounded-xl bg-ink px-6 py-3 text-[14px] font-bold text-mist shadow-pop transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                Start a new try-on →
              </button>
              <button
                onClick={onHistory}
                className="rounded-xl border border-mist-line bg-white px-6 py-3 text-[14px] font-semibold text-ink transition-colors hover:bg-mist"
              >
                {historyCount} saved {historyCount === 1 ? "try-on" : "try-ons"}
              </button>
            </div>
            {devMode && (
              <p className="mt-4 rounded-xl bg-amber-50 p-3 text-[12px] text-amber-800">
                <strong>Development mode:</strong> the AI engine is running the local
                composite provider (CPU). For neural try-on quality, connect an IDM-VTON
                inference server — see docs/AI_ENGINE.md.
              </p>
            )}
          </div>
          <div className="relative flex min-h-[320px] items-center justify-center bg-gradient-to-br from-mist to-mist-line p-10">
            <svg width="100%" height="100%" viewBox="0 0 300 300" fill="none" className="max-w-[280px]">
              <rect x="20" y="40" width="120" height="160" rx="16" fill="#111114" opacity="0.92" />
              <path d="M80 80 L60 160 M80 80 L100 160" stroke="#fff" strokeWidth="8" strokeLinecap="round" />
              <path d="M72 122 L88 122" stroke="#e8e6e1" strokeWidth="8" strokeLinecap="round" />
              <circle cx="80" cy="182" r="6" fill="#fff" />
              <path d="M180 70 Q190 50 200 70" stroke="#111114" strokeWidth="6" fill="none" strokeLinecap="round" />
              <path d="M160 90 L240 90 L250 240 L150 240 Z" fill="#111114" opacity="0.88" />
              <path d="M165 130 L235 130" stroke="#3a3a40" strokeWidth="3" />
              <path d="M150 170 L250 170" stroke="#3a3a40" strokeWidth="3" />
              <circle cx="180" cy="100" r="6" fill="#e8e6e1" />
              <path d="M210 100 L220 112 M170 100 L160 112" stroke="#e8e6e1" strokeWidth="4" strokeLinecap="round" />
            </svg>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          { t: "Any store", d: "Zara, H&M, ASOS, Amazon, Shein — or any product page with an image." },
          { t: "Real AI pipeline", d: "IDM-VTON-class try-on with a clean provider interface and dev fallback." },
          { t: "Private by design", d: "Photos stay on your backend. Delete history and images disappear." },
        ].map((f) => (
          <div key={f.t} className="rounded-2xl bg-white p-5 shadow-card">
            <div className="text-[15px] font-bold text-ink">{f.t}</div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-muted">{f.d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}

/* ---------------- New Try-On ---------------- */
function NewTryOn({
  client,
  onToast,
  onDone,
}: {
  client: ApiClient;
  onToast: (m: string) => void;
  onDone: () => void;
}) {
  const [person, setPerson] = useState<File | null>(null);
  const [garment, setGarment] = useState<File | null>(null);
  const [garmentUrl, setGarmentUrl] = useState("");
  const [category, setCategory] = useState<string>("dress");
  const [step, setStep] = useState<"form" | "processing" | "done">("form");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const onFile = useCallback((setter: (f: File | null) => void) => (files: FileList | null) => {
    if (!files?.length) return;
    const f = Array.from(files).find((x) => x.type.startsWith("image/"));
    if (f) setter(f);
  }, []);

  const start = async () => {
    if (!person || (!garment && !garmentUrl.trim())) {
      onToast("Add a photo of yourself and a garment image or URL.");
      return;
    }
    setStep("processing");
    setProgress(8);
    try {
      const res = await client.submitTryOn({
        personFile: person,
        garmentFile: garment,
        garmentUrl: garmentUrl.trim() || null,
        category,
      });
      setProgress(24);
      const tick = async () => {
        const s = await client.job(res.job_id);
        if (s.status === "queued") setProgress((p) => Math.min(45, p + 5));
        else if (s.status === "running") setProgress((p) => Math.min(78, p + 10));
        else if (s.status === "succeeded") {
          setProgress(100);
          setResult(client.resolveURL(s.result_url) ?? null);
          setStep("done");
          if (pollRef.current) window.clearInterval(pollRef.current);
        } else if (s.status === "failed") {
          onToast(`Generation failed: ${s.error || "unknown error"}`);
          setStep("form");
          if (pollRef.current) window.clearInterval(pollRef.current);
        }
      };
      pollRef.current = window.setInterval(tick, 1500);
    } catch (e) {
      onToast(`Try-on failed: ${(e as Error).message}`);
      setStep("form");
    }
  };

  useEffect(() => () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
  }, []);

  if (step === "processing") {
    return (
      <div className="flex flex-col items-center justify-center gap-5 py-24">
        <div className="relative flex h-28 w-28 items-center justify-center">
          <span className="absolute inline-flex h-28 w-28 animate-pulse-ring rounded-full bg-ink/10" />
          <span className="absolute inline-flex h-28 w-28 rounded-full bg-ink/10" />
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-ink text-mist">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-ink">Generating your try-on…</div>
          <div className="mt-1 text-[12px] text-ink-muted">Preserving identity & garment detail</div>
        </div>
        <div className="w-full max-w-[320px]">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-mist-line">
            <div className="h-full rounded-full bg-ink transition-[width] duration-500" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-1.5 text-right text-[11px] font-medium text-ink-muted">{progress}%</div>
        </div>
      </div>
    );
  }

  if (step === "done" && result) {
    return (
      <div className="animate-fade-in space-y-5">
        <div className="overflow-hidden rounded-3xl bg-white shadow-card">
          <img src={result} alt="try-on result" className="w-full" />
        </div>
        <div className="flex gap-3">
          <a
            href={result}
            download={`anywear-${Date.now()}.jpg`}
            className="flex-1 rounded-xl bg-ink px-6 py-3 text-center text-[14px] font-bold text-mist transition-opacity hover:opacity-90"
          >
            Download result
          </a>
          <button
            onClick={() => {
              setResult(null);
              setPerson(null);
              setGarment(null);
              setGarmentUrl("");
              setStep("form");
            }}
            className="flex-1 rounded-xl border border-mist-line bg-white px-6 py-3 text-[14px] font-semibold text-ink transition-colors hover:bg-mist"
          >
            Start another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in mx-auto max-w-xl space-y-5">
      <h2 className="text-xl font-bold text-ink">New try-on</h2>

      <div className="rounded-2xl bg-white p-5 shadow-card">
        <label className="block text-[13px] font-bold text-ink">1. Your photo</label>
        <p className="mt-1 text-[12px] text-ink-muted">Full or upper body, straight-on, minimal clothing.</p>
        <label className="mt-3 flex h-44 cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed border-mist-line bg-mist/40 transition-colors hover:border-ink-soft">
          {person ? (
            <img src={URL.createObjectURL(person)} alt="person" className="max-h-40 w-full object-cover" />
          ) : (
            <span className="text-[13px] font-semibold text-ink-muted">Drop or click to upload</span>
          )}
          <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(setPerson)(e.target.files)} />
        </label>
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-card">
        <label className="block text-[13px] font-bold text-ink">2. Garment</label>
        <p className="mt-1 text-[12px] text-ink-muted">Upload a garment photo or paste a product image URL.</p>
        <div className="mt-3 space-y-3">
          <label className="flex h-36 cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed border-mist-line bg-mist/40 transition-colors hover:border-ink-soft">
            {garment ? (
              <img src={URL.createObjectURL(garment)} alt="garment" className="max-h-32 w-full object-cover" />
            ) : (
              <span className="text-[13px] font-semibold text-ink-muted">Upload garment image</span>
            )}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(setGarment)(e.target.files)} />
          </label>
          <input
            value={garmentUrl}
            onChange={(e) => setGarmentUrl(e.target.value)}
            placeholder="…or paste garment image URL"
            className="w-full rounded-xl border border-mist-line bg-white px-3 py-2.5 text-[13px] text-ink outline-none focus:border-ink"
          />
        </div>
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-card">
        <label className="block text-[13px] font-bold text-ink">3. Category</label>
        <div className="mt-3 flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
                category === c ? "bg-ink text-mist" : "bg-mist text-ink-soft hover:bg-mist-line"
              }`}
            >
              {c[0].toUpperCase() + c.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={start}
        disabled={!person || (!garment && !garmentUrl.trim())}
        className="w-full rounded-xl bg-ink py-3.5 text-[14px] font-bold text-mist shadow-pop transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        Try it on →
      </button>
    </div>
  );
}

/* ---------------- History ---------------- */
function HistorySection({
  items,
  client,
  onDelete,
  onPreview,
  onToast,
}: {
  items: HistoryItem[];
  client: ApiClient;
  onDelete: (id: string) => void;
  onPreview: (src: string) => void;
  onToast: (m: string) => void;
}) {
  return (
    <div className="animate-fade-in">
      <h2 className="mb-4 text-xl font-bold text-ink">Recent try-ons</h2>
      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-mist-line bg-white py-16 text-center">
          <div className="text-[14px] font-semibold text-ink">Nothing yet</div>
          <p className="mt-1 text-[12px] text-ink-muted">Your generated try-ons will appear here.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {items.map((h) => (
            <div key={h.id} className="group overflow-hidden rounded-2xl bg-white shadow-card">
              <div className="relative aspect-[4/5] bg-mist">
                {h.result_url ? (
                  <img
                    src={client.resolveURL(h.result_url) ?? ""}
                    alt="try-on"
                    className="h-full w-full object-cover"
                    onClick={() => h.result_url && onPreview(client.resolveURL(h.result_url) ?? "")}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-ink-muted">—</div>
                )}
                <div className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
                  {h.category || "try-on"}
                </div>
              </div>
              <div className="flex items-center justify-between p-3">
                <div>
                  <div className="text-[12px] font-semibold text-ink">{h.mode ? `${h.mode} mode` : "generated"}</div>
                  <div className="text-[11px] text-ink-muted">
                    {new Date(h.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  </div>
                </div>
                <button
                  onClick={() => onDelete(h.id)}
                  className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-ink-muted transition-colors hover:bg-red-50 hover:text-red-600"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Settings ---------------- */
function SettingsSection({
  baseURL,
  setBaseURL,
  onToast,
}: {
  baseURL: string;
  setBaseURL: (s: string) => void;
  onToast: (m: string) => void;
}) {
  return (
    <div className="animate-fade-in mx-auto max-w-xl space-y-5">
      <h2 className="text-xl font-bold text-ink">Settings</h2>
      <div className="rounded-2xl bg-white p-5 shadow-card">
        <label className="block text-[13px] font-bold text-ink">Backend API URL</label>
        <input
          value={baseURL}
          onChange={(e) => setBaseURL(e.target.value)}
          className="mt-2 w-full rounded-xl border border-mist-line bg-white px-3 py-2.5 text-[13px] text-ink outline-none focus:border-ink"
        />
        <p className="mt-2 text-[11px] text-ink-muted">
          Defaults to the local development server. The extension popup has its own settings page.
        </p>
      </div>
      <div className="rounded-2xl bg-white p-5 shadow-card">
        <h3 className="text-[13px] font-bold text-ink">Privacy</h3>
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-muted">
          Photos and results are stored on your backend in opaque UUID-named files.
          Deleting a history entry removes its files. Nothing is sent to third parties.
        </p>
      </div>
      <button
        onClick={() => onToast("Settings saved (stored in this session)")}
        className="rounded-xl bg-ink px-6 py-2.5 text-[13px] font-bold text-mist transition-opacity hover:opacity-90"
      >
        Save
      </button>
    </div>
  );
}

/* ---------------- Preview modal ---------------- */
function PreviewModal({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 animate-fade-in"
      onClick={onClose}
    >
      <div className="relative max-h-[88vh] max-w-3xl" onClick={(e) => e.stopPropagation()}>
        <img src={src} alt="preview" className="max-h-[80vh] w-full rounded-2xl object-contain shadow-pop" />
        <button
          onClick={onClose}
          className="absolute -top-12 right-0 flex h-9 w-9 items-center justify-center rounded-full bg-white text-ink shadow-card transition-colors hover:bg-mist-line"
        >
          ✕
        </button>
        <a href={src} download={`anywear-${Date.now()}.jpg`} className="mt-3 block rounded-xl bg-ink px-6 py-3 text-center text-[13px] font-bold text-mist transition-opacity hover:opacity-90">
          Download
        </a>
      </div>
    </div>
  );
}
