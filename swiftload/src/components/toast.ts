/**
 * Toasts.
 *
 * Used for background results (a download finished, a file could not be
 * deleted, the server kept resetting the connection). Errors that the user can
 * act on carry a Retry button wired to the same operation that failed.
 */

import { el } from "../lib/dom";
import type { Toast, UiError } from "../lib/types";

const MAX_VISIBLE = 4;

function root(): HTMLElement {
  const node = document.getElementById("toast-root");
  if (node) return node;
  const created = el("div", { id: "toast-root", class: "toast-root" });
  document.body.append(created);
  return created;
}

export function showToast(toast: Omit<Toast, "id">): void {
  const host = root();
  while (host.children.length >= MAX_VISIBLE) {
    host.firstElementChild?.remove();
  }

  const node = el("div", { class: `toast ${toast.kind}` });

  const actions = el("div", { class: "actions" });

  const dismiss = () => {
    window.clearTimeout(timer);
    node.remove();
  };

  const close = el("button", {
    class: "btn ghost small",
    attrs: { type: "button", "aria-label": "Dismiss" },
    text: "✕",
    on: { click: dismiss },
  });

  if (toast.retry) {
    actions.append(
      el("button", {
        class: "btn small",
        text: "Retry",
        attrs: { type: "button" },
        on: {
          click: () => {
            dismiss();
            toast.retry?.();
          },
        },
      }),
    );
  }
  actions.append(close);

  node.append(
    el("div", { class: "body" }, [
      el("div", { class: "title", text: toast.title }),
      toast.message ? el("div", { class: "message", text: toast.message }) : null,
    ]),
    actions,
  );

  host.append(node);

  const timeout = toast.timeoutMs ?? (toast.kind === "error" ? 9000 : 4200);
  const timer = window.setTimeout(dismiss, timeout);
}

export const toast = {
  info: (title: string, message?: string) => showToast({ kind: "info", title, message }),
  success: (title: string, message?: string) => showToast({ kind: "success", title, message }),
  warning: (title: string, message?: string) => showToast({ kind: "warning", title, message }),
  error: (title: string, message?: string, retry?: () => void) =>
    showToast({ kind: "error", title, message, retry }),
};

/** Standard rendering for a backend error, with an optional retry action. */
export function toastError(error: UiError, retry?: () => void): void {
  showToast({
    kind: "error",
    title: errorTitle(error),
    message: error.message,
    retry: retry && error.retryable !== false ? retry : undefined,
  });
}

function errorTitle(error: UiError): string {
  switch (error.code) {
    case "invalid_url":
    case "unsupported_scheme":
      return "Invalid address";
    case "not_found":
      return "Download not found";
    case "busy":
      return "Already in progress";
    case "disk_error":
      return "File system problem";
    case "no_backend":
      return "Desktop shell unavailable";
    default:
      return "Operation failed";
  }
}
