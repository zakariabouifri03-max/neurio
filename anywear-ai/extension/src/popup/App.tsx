import React, { useCallback, useEffect, useRef, useState } from "react";
import { ApiClient, ApiError, HistoryItem, JobStatus } from "./api";
import { loadSettings, saveSettings, Settings, DEFAULT_SETTINGS } from "./storage";
import { CATEGORIES, Category, categoryLabel, classNames, formatTime, truncate } from "../lib/format";
import { MSG, CandidateImage, BackgroundEvent, PopupRequest } from "../lib/messages";
import { Dropzone, ProgressBar, Spinner, Toast } from "./components/ui";
import { Wordmark } from "./components/Logo";
import { fileToDataURL } from "../lib/image";

type Step = "product" | "person" | "review" | "processing" | "result" | "history" | "settings";

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [client, setClient] = useState<ApiClient>(new ApiClient(DEFAULT_SETTINGS.apiBaseURL));
  const [ready, setReady] = useState(false);

  const [step, setStep] = useState<Step>("product");
  const [toast, setToast] = useState<{ msg: string; tone: "info" | "error" | "success" } | null>(null);

  // product state
  const [candidates, setCandidates] = useState<CandidateImage[]>([]);
  const [selectedGarment, setSelectedGarment] = useState<CandidateImage | null>(null);
  const [garmentPreview, setGarmentPreview] = useState<string | null>(null);
  const [garmentFile, setGarmentFile] = useState<File | null>(null);
  const [garmentUrlMode, setGarmentUrlMode] = useState(false);
  const [scanning, setScanning] = useState(false);

  // person state
  const [personFile, setPersonFile] = useState<File | null>(null);
  const [personPreview, setPersonPreview] = useState<string | null>(null);

  // category
  const [category, setCategory] = useState<Category>("other");

  // job state
  const [job, setJob] = useState<JobStatus | null>(null);
  const [progress, setProgress] = useState(0);
  const [resultImg, setResultImg] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [tabTitle, setTabTitle] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const pollTimer = useRef<number | null>(null);
  const [pickerActive, setPickerActive] = useState(false);

  const showToast = (msg: string, tone: "info" | "error" | "success" = "info") => {
    setToast({ msg, tone });
    window.setTimeout(() => setToast(null), 3600);
  };

  // --- init ---
  useEffect(() => {
    (async () => {
      const s = await loadSettings();
      setSettings(s);
      const c = new ApiClient(s.apiBaseURL, s.apiKey);
      setClient(c);
      setCategory(s.defaultCategory as Category);
      await refreshHistory();
      await refreshHealth(c);
      requestCandidates();
      requestPageInfo();
      setReady(true);
    })();
    return () => {
      if (pollTimer.current) window.clearInterval(pollTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- persist settings ---
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  // --- background events from content script ---
  useEffect(() => {
    const handler = (msg: any) => {
      if (msg?.type !== MSG.BG_EVENT) return;
      const ev = msg.event as BackgroundEvent;
      if (ev.type === "candidates" && ev.candidates?.length) {
        setCandidates(ev.candidates);
        setScanning(false);
      } else if (ev.type === "picked") {
        const c = ev.src ? { id: "picked", src: ev.src, width: 0, height: 0, score: 100, source: "drag" as const, name: ev.name } : null;
        if (c) {
          setSelectedGarment(c);
          setGarmentPreview(null);
          setGarmentFile(null);
          setStep("person");
        }
        setPickerActive(false);
        showToast("Garment selected", "success");
      } else if (ev.type === "drag-image") {
        const c: CandidateImage = {
          id: "drag",
          src: ev.src,
          width: 0,
          height: 0,
          score: 95,
          source: "drag",
          name: ev.name,
        };
        setCandidates((prev) => (prev.some((p) => p.src === ev.src) ? prev : [c, ...prev]));
        setSelectedGarment(c);
        setGarmentPreview(null);
        setGarmentFile(null);
        showToast("Garment dropped — pick your photo to continue", "success");
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  const sendPopupRequest = useCallback((req: PopupRequest): Promise<any> => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ request: req }, (res) => resolve(res));
    });
  }, []);

  const requestCandidates = useCallback(async () => {
    setScanning(true);
    const res = await sendPopupRequest({ type: "get-candidates" });
    if (res?.ok && res.candidates?.length) {
      setCandidates(res.candidates);
    } else if (res?.error === "no-active-tab") {
      showToast("Open a product page first", "error");
    }
    setScanning(false);
  }, [sendPopupRequest, showToast]);

  const requestPageInfo = useCallback(async () => {
    const res = await sendPopupRequest({ type: "page-info" });
    if (res?.ok) {
      setTabTitle(res.title);
      setPageUrl(res.url);
    }
  }, [sendPopupRequest]);

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await client.history());
    } catch {
      /* backend offline — history stays empty */
    }
  }, [client]);

  const refreshHealth = useCallback(async (c: ApiClient) => {
    try {
      const h = await c.health();
      if (!h.provider_available) {
        showToast(`AI provider "${h.provider}" not reachable — check settings`, "error");
      }
    } catch {
      showToast("Backend offline — start it with `uvicorn app.main:app`", "error");
    }
  }, [showToast]);

  // --- garment selection ---
  const pickGarment = useCallback((c: CandidateImage) => {
    setSelectedGarment(c);
    setGarmentFile(null);
    setGarmentPreview(null);
    setStep("person");
  }, []);

  const startPicker = useCallback(async () => {
    await sendPopupRequest({ type: "select-on-page" });
    setPickerActive(true);
    showToast("Click a highlighted garment on the page", "info");
  }, [sendPopupRequest, showToast]);

  const cancelPicker = useCallback(async () => {
    await sendPopupRequest({ type: "cancel-picker" });
    setPickerActive(false);
  }, [sendPopupRequest]);

  // --- person photo ---
  const onPersonFile = useCallback((file: File) => {
    setPersonFile(file);
    fileToDataURL(file).then(setPersonPreview).catch(() => {});
  }, []);

  // --- garment fallback: fetch from page / manual upload ---
  const garmentAsFile = useCallback(async (): Promise<{ file: File | null; url: string | null }> => {
    if (garmentFile) return { file: garmentFile, url: null };
    const c = selectedGarment;
    if (!c) return { file: null, url: null };
    if (c.src.startsWith("data:")) {
      const blob = await fetch(c.src).then((r) => r.blob());
      return { file: new File([blob], "garment.png", { type: blob.type || "image/png" }), url: null };
    }
    // Try page fetch (works same-origin); fall back to URL mode for the backend.
    const res = await sendPopupRequest({ type: "fetch-image", url: c.src });
    if (res?.ok && res.dataURL) {
      const blob = await fetch(res.dataURL).then((r) => r.blob());
      return { file: new File([blob], "garment.png", { type: blob.type || "image/png" }), url: null };
    }
    // Cross-origin taint or fetch failure → backend fetches the URL server-side.
    return { file: null, url: c.src };
  }, [garmentFile, selectedGarment, sendPopupRequest]);

  // --- try-on ---
  const runTryOn = useCallback(async () => {
    if (!personFile) return;
    const garment = await garmentAsFile();
    if (!garment.file && !garment.url) {
      showToast("Select a garment image first", "error");
      return;
    }
    setStep("processing");
    setProgress(8);
    try {
      const res = await client.submitTryOn({
        personFile,
        garmentFile: garment.file,
        garmentUrl: garment.url,
        category,
      });
      setJob({ job_id: res.job_id, status: "queued" } as JobStatus);
      setProgress(22);
      pollJob(res.job_id);
    } catch (e) {
      const err = e as ApiError;
      showToast(`Try-on failed: ${err.detail}`, "error");
      setStep("person");
    }
  }, [personFile, garmentAsFile, client, category, showToast]);

  const pollJob = useCallback(
    (jobId: string) => {
      if (pollTimer.current) window.clearInterval(pollTimer.current);
      const tick = async () => {
        try {
          const status = await client.job(jobId);
          setJob(status);
          if (status.status === "queued") setProgress((p) => Math.min(45, p + 6));
          else if (status.status === "running") setProgress((p) => Math.min(75, p + 14));
          else if (status.status === "succeeded") {
            setProgress(100);
            const abs = client.resolveURL(status.result_url);
            setResultImg(abs ?? null);
            setStep("result");
            refreshHistory();
            if (pollTimer.current) window.clearInterval(pollTimer.current);
          } else if (status.status === "failed") {
            showToast(`Generation failed: ${status.error || "unknown error"}`, "error");
            setStep("person");
            if (pollTimer.current) window.clearInterval(pollTimer.current);
          }
        } catch {
          /* keep polling */
        }
      };
      pollTimer.current = window.setInterval(tick, settings.pollIntervalMs);
    },
    [client, refreshHistory, settings.pollIntervalMs, showToast]
  );

  const downloadResult = useCallback(() => {
    if (!resultImg) return;
    fetch(resultImg)
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `anywear-${Date.now()}.jpg`;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(() => showToast("Download failed", "error"));
  }, [resultImg, showToast]);

  const deleteHistoryItem = useCallback(
    async (id: string) => {
      await client.deleteHistory(id);
      setHistory((prev) => prev.filter((h) => h.id !== id));
    },
    [client]
  );

  const resetFlow = useCallback(() => {
    setStep("product");
    setPersonFile(null);
    setPersonPreview(null);
    setResultImg(null);
    setJob(null);
    setProgress(0);
  }, []);

  if (!ready) {
    return (
      <div className="flex h-[520px] items-center justify-center text-ink-muted">
        <Spinner size={22} />
      </div>
    );
  }

  return (
    <div className="flex min-h-[520px] flex-col bg-mist">
      {/* header */}
      <header className="flex items-center justify-between border-b border-mist-line bg-white px-4 py-3">
        <Wordmark />
        <nav className="flex items-center gap-1 text-[11px]">
          <button
            onClick={resetFlow}
            className={classNames(
              "rounded-full px-2.5 py-1 font-medium transition-colors",
              step === "product" ? "bg-ink text-mist" : "text-ink-muted hover:bg-mist-line"
            )}
          >
            New
          </button>
          <button
            onClick={() => {
              refreshHistory();
              setStep("history");
            }}
            className="rounded-full px-2.5 py-1 font-medium text-ink-muted transition-colors hover:bg-mist-line"
          >
            History
          </button>
        </nav>
      </header>

      {/* tab indicator */}
      {pageUrl && (
        <div className="flex items-center gap-2 border-b border-mist-line bg-white px-4 py-2">
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
          <span className="truncate text-[11px] text-ink-muted" title={pageUrl}>
            {truncate(pageUrl, 42)}
          </span>
        </div>
      )}

      <main className="flex-1 overflow-y-auto p-4">
        {toast && (
          <div className="mb-3">
            <Toast message={toast.msg} tone={toast.tone} />
          </div>
        )}

        {/* ---------- STEP: PRODUCT ---------- */}
        {step === "product" && (
          <div className="animate-fade-in space-y-4">
            <div className="rounded-2xl bg-white p-4 shadow-card">
              <div className="text-[13px] font-semibold text-ink">Find your garment</div>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
                Anywear scans the page for product photos. Pick the right one — or click any image on the page.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={requestCandidates}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-ink px-3 py-2.5 text-[12px] font-semibold text-mist transition-opacity hover:opacity-90"
                >
                  {scanning ? <Spinner size={13} /> : null}
                  {scanning ? "Scanning…" : "Scan page"}
                </button>
                <button
                  onClick={startPicker}
                  disabled={pickerActive}
                  className="flex items-center justify-center rounded-xl border border-mist-line bg-white px-3 py-2.5 text-[12px] font-semibold text-ink transition-colors hover:bg-mist disabled:opacity-50"
                >
                  Select on page
                </button>
              </div>
              {pickerActive && (
                <div className="mt-2 text-[11px] font-medium text-amber-600">
                  Picker active — click a highlighted garment, or close it here.
                  <button onClick={cancelPicker} className="ml-1 underline">
                    Close
                  </button>
                </div>
              )}
            </div>

            {candidates.length > 0 && (
              <div className="animate-slide-up space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                  Detected {candidates.length} product images
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {candidates.slice(0, 12).map((c) => (
                    <button
                      key={c.id}
                      onClick={() => pickGarment(c)}
                      title={c.name || c.src}
                      className={classNames(
                        "group relative aspect-[3/4] overflow-hidden rounded-xl border-2 bg-white transition-all",
                        selectedGarment?.src === c.src
                          ? "border-ink ring-2 ring-ink/20"
                          : "border-mist-line hover:border-ink-soft"
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={c.src}
                        alt={c.name || "product"}
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.opacity = "0.2";
                        }}
                      />
                      <span className="absolute bottom-0 left-0 right-0 truncate bg-black/55 px-1.5 py-1 text-[9px] font-medium text-white">
                        {c.score}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {candidates.length === 0 && !scanning && (
              <div className="rounded-2xl border border-dashed border-mist-line bg-white p-6 text-center">
                <div className="text-[12px] font-semibold text-ink">No product images yet</div>
                <div className="mt-1 text-[11px] text-ink-muted">
                  Scan a product page, use “Select on page”, drag a garment image here, or upload one manually below.
                </div>
              </div>
            )}

            {/* manual garment upload fallback */}
            <div className="rounded-2xl bg-white p-4 shadow-card">
              <div className="text-[13px] font-semibold text-ink">No product image? Upload a garment</div>
              <Dropzone
                accept="image/*"
                label="Upload garment photo"
                hint="PNG · JPG · WEBP — max 8 MB"
                onFile={(file) => {
                  setGarmentFile(file);
                  fileToDataURL(file).then(setGarmentPreview).catch(() => {});
                  setSelectedGarment(null);
                }}
              />
              {garmentPreview && (
                <button
                  onClick={() => setStep("person")}
                  className="mt-3 w-full rounded-xl bg-ink py-2.5 text-[12px] font-semibold text-mist hover:opacity-90"
                >
                  Continue with uploaded garment
                </button>
              )}
            </div>
          </div>
        )}

        {/* ---------- STEP: PERSON ---------- */}
        {step === "person" && (
          <div className="animate-fade-in space-y-4">
            <div className="rounded-2xl bg-white p-4 shadow-card">
              <div className="text-[13px] font-semibold text-ink">Upload your photo</div>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
                A full-body or upper-body photo works best. Wear minimal clothing for the most accurate try-on.
              </p>
              <div className="mt-3">
                <Dropzone
                  accept="image/*"
                  label="Drop your photo here"
                  hint="Straight-on photo · good lighting · PNG/JPG"
                  onFile={onPersonFile}
                  preview={personPreview}
                />
              </div>
            </div>

            {/* garment summary */}
            {(selectedGarment || garmentFile) && (
              <div className="flex items-center gap-3 rounded-2xl border border-mist-line bg-white p-3">
                {garmentFile ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={garmentPreview || ""} alt="garment" className="h-14 w-14 rounded-lg object-cover" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={selectedGarment?.src || ""}
                    alt="garment"
                    className="h-14 w-14 rounded-lg object-cover"
                    onError={(e) => ((e.currentTarget as HTMLImageElement).style.opacity = "0.2")}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-semibold text-ink">
                    {garmentFile?.name || selectedGarment?.name || "Garment"}
                  </div>
                  <div className="truncate text-[10px] text-ink-muted">
                    {garmentFile ? "uploaded file" : truncate(selectedGarment?.src || "", 36)}
                  </div>
                </div>
                <button
                  onClick={() => {
                    setSelectedGarment(null);
                    setGarmentFile(null);
                    setGarmentPreview(null);
                    setStep("product");
                  }}
                  className="text-[11px] font-medium text-ink-muted underline-offset-2 hover:underline"
                >
                  Change
                </button>
              </div>
            )}

            {/* category */}
            <div className="rounded-2xl bg-white p-4 shadow-card">
              <div className="text-[13px] font-semibold text-ink">Garment category</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    className={classNames(
                      "rounded-full px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                      category === c ? "bg-ink text-mist" : "bg-mist text-ink-soft hover:bg-mist-line"
                    )}
                  >
                    {categoryLabel(c)}
                  </button>
                ))}
              </div>
            </div>

            {personFile && (
              <button
                onClick={runTryOn}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink py-3 text-[13px] font-bold text-mist shadow-pop transition-opacity hover:opacity-90"
              >
                Try It On
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M5 12h14m-6-6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            {!personFile && (
              <button
                disabled
                className="w-full rounded-xl border border-mist-line bg-mist py-3 text-[13px] font-semibold text-ink-muted"
              >
                Upload your photo to start
              </button>
            )}
          </div>
        )}

        {/* ---------- STEP: PROCESSING ---------- */}
        {step === "processing" && (
          <div className="flex flex-col items-center justify-center gap-5 py-16 animate-fade-in">
            <div className="relative flex h-24 w-24 items-center justify-center">
              <span className="absolute inline-flex h-24 w-24 animate-pulse-ring rounded-full bg-ink/10" />
              <span className="absolute inline-flex h-24 w-24 rounded-full bg-ink/10" />
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-ink text-mist">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
            <div className="text-center">
              <div className="text-[14px] font-bold text-ink">Generating your try-on…</div>
              <div className="mt-1 text-[11px] text-ink-muted">
                {job?.status === "succeeded"
                  ? "Almost done"
                  : "Preserving identity & garment detail — typically 5–30s"}
              </div>
            </div>
            <div className="w-full max-w-[260px]">
              <ProgressBar value={progress} />
              <div className="mt-1.5 text-right text-[10px] font-medium text-ink-muted">{progress}%</div>
            </div>
            {job && (
              <div className="text-[10px] font-medium uppercase tracking-wide text-ink-muted">
                Job {truncate(job.job_id, 12)} · {job.status}
              </div>
            )}
          </div>
        )}

        {/* ---------- STEP: RESULT ---------- */}
        {step === "result" && resultImg && (
          <div className="animate-fade-in space-y-4">
            <div className="rounded-2xl bg-white p-2 shadow-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={resultImg} alt="try-on result" className="w-full rounded-xl object-contain" />
            </div>
            <div className="flex gap-2">
              <button
                onClick={downloadResult}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-ink py-2.5 text-[13px] font-bold text-mist hover:opacity-90"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Download
              </button>
              <button
                onClick={resetFlow}
                className="flex-1 rounded-xl border border-mist-line bg-white py-2.5 text-[13px] font-semibold text-ink hover:bg-mist"
              >
                New Try-On
              </button>
            </div>
            {job && (
              <div className="rounded-2xl bg-white p-3 text-[11px] text-ink-muted shadow-card">
                <span className="font-semibold text-ink">Mode:</span> {job.mode || "unknown"}
                {job.provider ? ` · provider: ${job.provider}` : ""}
                {job.meta?.dev_mode ? " · DEVELOPER MODE" : ""}
              </div>
            )}
          </div>
        )}

        {/* ---------- HISTORY ---------- */}
        {step === "history" && (
          <div className="animate-fade-in space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-[14px] font-bold text-ink">Recent try-ons</div>
              <button onClick={refreshHistory} className="text-[11px] font-medium text-ink-muted hover:underline">
                Refresh
              </button>
            </div>
            {history.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-mist-line bg-white p-8 text-center text-[12px] text-ink-muted">
                No generations yet — your results will appear here.
              </div>
            ) : (
              <div className="space-y-2">
                {history.map((h) => (
                  <div key={h.id} className="flex gap-3 rounded-2xl bg-white p-2.5 shadow-card">
                    {h.result_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={client.resolveURL(h.result_url) || ""}
                        alt="result"
                        className="h-16 w-12 shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="flex h-16 w-12 shrink-0 items-center justify-center rounded-lg bg-mist text-ink-muted">
                        <Spinner size={14} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-semibold text-ink">
                        {h.category || "try-on"} · {formatTime(h.created_at)}
                      </div>
                      <div className="truncate text-[10px] text-ink-muted">{h.mode || ""}</div>
                    </div>
                    <button
                      onClick={() => deleteHistoryItem(h.id)}
                      className="self-center rounded-lg px-2 py-1 text-[11px] font-medium text-ink-muted transition-colors hover:bg-red-50 hover:text-red-600"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={resetFlow}
              className="w-full rounded-xl bg-ink py-2.5 text-[13px] font-semibold text-mist hover:opacity-90"
            >
              Start a new try-on
            </button>
          </div>
        )}

        {/* ---------- SETTINGS ---------- */}
        {step === "settings" && <SettingsPanel settings={settings} onChange={(s) => { setSettings(s); setClient(new ApiClient(s.apiBaseURL, s.apiKey)); }} onTest={() => refreshHealth(new ApiClient(settings.apiBaseURL, settings.apiKey))} />}
      </main>

      {/* footer */}
      <footer className="flex items-center justify-between border-t border-mist-line bg-white px-4 py-2.5">
        <button
          onClick={resetFlow}
          className="text-[11px] font-medium text-ink-muted hover:text-ink"
        >
          New try-on
        </button>
        <button
          onClick={() => setStep(step === "settings" ? "product" : "settings")}
          className="text-[11px] font-medium text-ink-muted hover:text-ink"
        >
          Settings
        </button>
      </footer>
    </div>
  );
}

function SettingsPanel({
  settings,
  onChange,
  onTest,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  onTest: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const update = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });

  const test = async () => {
    setTesting(true);
    await onTest();
    window.setTimeout(() => setTesting(false), 900);
  };

  return (
    <div className="animate-fade-in space-y-4">
      <div>
        <div className="text-[13px] font-semibold text-ink">Backend</div>
        <p className="mt-1 text-[11px] text-ink-muted">
          Anywear AI backend API URL. Defaults to a local development server.
        </p>
        <input
          value={settings.apiBaseURL}
          onChange={(e) => update({ apiBaseURL: e.target.value })}
          placeholder="http://localhost:8000"
          className="mt-2 w-full rounded-xl border border-mist-line bg-white px-3 py-2 text-[12px] text-ink outline-none transition-colors focus:border-ink"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={test}
            disabled={testing}
            className="flex items-center gap-2 rounded-xl bg-ink px-3 py-2 text-[12px] font-semibold text-mist hover:opacity-90"
          >
            {testing ? <Spinner size={12} /> : null}
            Test connection
          </button>
        </div>
      </div>

      <div>
        <div className="text-[13px] font-semibold text-ink">API key (optional)</div>
        <input
          value={settings.apiKey}
          onChange={(e) => update({ apiKey: e.target.value })}
          type="password"
          placeholder="Only if your backend requires one"
          className="mt-2 w-full rounded-xl border border-mist-line bg-white px-3 py-2 text-[12px] text-ink outline-none focus:border-ink"
        />
      </div>

      <div>
        <div className="text-[13px] font-semibold text-ink">Default category</div>
        <select
          value={settings.defaultCategory}
          onChange={(e) => update({ defaultCategory: e.target.value })}
          className="mt-2 w-full rounded-xl border border-mist-line bg-white px-3 py-2 text-[12px] text-ink outline-none"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {categoryLabel(c)}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-2xl bg-white p-3 text-[10px] leading-relaxed text-ink-muted shadow-card">
        Privacy: photos are uploaded to your backend and deleted when you remove history.
        No data leaves your machine. The extension never sends API keys anywhere except your backend.
      </div>
    </div>
  );
}
