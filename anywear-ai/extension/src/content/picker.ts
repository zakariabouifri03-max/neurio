/**
 * Manual "select on page" picker: highlights candidate images with overlay
 * badges so the user can click the right garment on the actual page.
 * Injects a small, self-contained UI that never touches page scripts.
 */

import type { CandidateImage } from "../lib/messages";

export class PagePicker {
  private active = false;
  private badges: HTMLDivElement[] = [];
  private onPick: (src: string, name: string) => void = () => {};
  private styleEl: HTMLStyleElement | null = null;

  setHandler(fn: (src: string, name: string) => void) {
    this.onPick = fn;
  }

  enter(candidates: CandidateImage[]) {
    this.leave();
    this.active = true;
    this.injectStyles();

    const overlay = document.createElement("div");
    overlay.className = "anywear-pick-overlay";
    overlay.dataset.anywear = "overlay";
    overlay.addEventListener("click", (ev) => ev.stopPropagation());
    document.body.appendChild(overlay);

    const labels = [
      "Pick this garment",
      "Choose the product image",
      "Select the clothing photo",
      "This one",
    ];

    candidates.slice(0, 24).forEach((c, i) => {
      const badge = document.createElement("div");
      badge.className = "anywear-pick-badge";
      badge.dataset.anywear = "1";
      badge.textContent = labels[i % labels.length];
      badge.title = "Anywear AI: click to select this garment image";

      badge.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.onPick(c.src, c.name || "product image");
        this.leave();
      });

      document.body.appendChild(badge);
      this.badges.push(badge);
      this.position(badge, c.src, i);
    });
  }

  private position(badge: HTMLDivElement, src: string, index: number) {
    const apply = () => {
      if (!this.active) return;
      const img = findImgForSrc(src);
      if (!img) {
        badge.remove();
        return;
      }
      const r = img.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) {
        badge.style.display = "none";
        return;
      }
      badge.style.display = "flex";
      badge.style.left = `${r.left + r.width / 2 - badge.offsetWidth / 2}px`;
      badge.style.top = `${r.top - badge.offsetHeight - 6}px`;
      badge.style.position = "fixed";
    };
    apply();
    // Reposition on scroll/resize.
    const mo = new MutationObserver(() => apply());
    mo.observe(document.body, { subtree: true, childList: true, attributes: true });
    window.addEventListener("scroll", apply, true);
    window.addEventListener("resize", apply);
    // Store cleanup refs.
    (badge as any)._mo = mo;
  }

  private injectStyles() {
    if (this.styleEl) return;
    const style = document.createElement("style");
    style.textContent = `
      .anywear-pick-badge {
        position: fixed; z-index: 2147483647;
        background: #111114; color: #fff;
        font: 600 11px/1.2 Inter, system-ui, sans-serif;
        padding: 6px 10px; border-radius: 999px;
        pointer-events: auto; cursor: pointer;
        box-shadow: 0 4px 16px rgba(0,0,0,.35);
        animation: anywear-pop 200ms ease-out;
        white-space: nowrap; user-select: none;
      }
      .anywear-pick-badge:hover { background: #2b2b31; }
      .anywear-pick-overlay {
        position: fixed; inset: 0; z-index: 2147483646;
        background: rgba(17,17,20,.06); cursor: crosshair;
      }
      @keyframes anywear-pop {
        from { transform: translateY(6px) scale(.9); opacity: 0; }
        to { transform: none; opacity: 1; }
      }
    `;
    document.head.appendChild(style);
    this.styleEl = style;
  }

  leave() {
    this.active = false;
    for (const b of this.badges) {
      (b as any)._mo?.disconnect?.();
      b.remove();
    }
    this.badges = [];
    const overlay = document.querySelector('[data-anywear="overlay"]');
    overlay?.remove();
    if (this.styleEl) {
      this.styleEl.remove();
      this.styleEl = null;
    }
  }

  isActive() {
    return this.active;
  }
}

function findImgForSrc(src: string): HTMLImageElement | null {
  // Prefer data-src (lazy) matches.
  const imgs = Array.from(document.images);
  return (
    imgs.find((im) => (im.getAttribute("data-src") || im.getAttribute("data-original") || "") === src) ||
    imgs.find((im) => (im.currentSrc || im.getAttribute("src") || "") === src) ||
    null
  );
}
