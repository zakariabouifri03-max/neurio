import React, { useCallback, useRef, useState } from "react";
import { classNames } from "../../lib/format";

export function Spinner({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      className={classNames("animate-spin-slow", className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.18" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ProgressBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-mist-line">
      <div
        className="h-full rounded-full bg-ink transition-[width] duration-500 ease-out"
        style={{ width: `${v}%` }}
      />
    </div>
  );
}

export function Toast({ message, tone = "info" }: { message: string; tone?: "info" | "error" | "success" }) {
  const colors = {
    info: "bg-mist-line text-ink",
    error: "bg-red-50 text-red-700",
    success: "bg-emerald-50 text-emerald-700",
  }[tone];
  return (
    <div className={classNames("animate-fade-in rounded-lg px-3 py-2 text-[12px] font-medium", colors)}>
      {message}
    </div>
  );
}

interface DropzoneProps {
  accept: string;
  onFile: (file: File) => void;
  label: string;
  hint?: string;
  preview?: string | null;
}

export function Dropzone({ accept, onFile, label, hint, preview }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || !files.length) return;
      const file = Array.from(files).find((f) => f.type.startsWith("image/"));
      if (file) onFile(file);
    },
    [onFile]
  );

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleFiles(e.dataTransfer?.files ?? null);
      }}
      className={classNames(
        "relative cursor-pointer overflow-hidden rounded-2xl border-2 border-dashed transition-colors",
        dragOver ? "border-ink bg-mist" : "border-mist-line bg-mist/40",
        preview ? "p-1" : "p-6"
      )}
    >
      {preview ? (
        <img src={preview} alt="upload preview" className="max-h-52 w-full rounded-xl object-cover" />
      ) : (
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-ink text-mist">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 16V4m0 0L7 9m5-5l5 5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" />
            </svg>
          </div>
          <div className="text-[13px] font-semibold text-ink">{label}</div>
          {hint && <div className="text-[11px] text-ink-muted">{hint}</div>}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}
