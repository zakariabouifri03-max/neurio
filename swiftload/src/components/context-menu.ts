/**
 * Context menu (the ⋮ button and right-click on a download card).
 *
 * One menu exists at a time. It is positioned so it never leaves the window and
 * closes on Escape, on scroll, on resize, or on any click outside of it.
 */

import { el } from "../lib/dom";

export interface MenuItem {
  /** Absent for separators. */
  label?: string;
  icon?: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  /** Renders a separator instead of an item. */
  separator?: boolean;
  onSelect?: () => void;
}

let open: HTMLElement | null = null;
let cleanup: (() => void) | null = null;

export function closeContextMenu(): void {
  cleanup?.();
  cleanup = null;
  open?.remove();
  open = null;
}

export function openContextMenu(items: MenuItem[], position: { x: number; y: number }): void {
  closeContextMenu();
  const host = document.getElementById("menu-root") ?? document.body;

  const menu = el("div", { class: "menu", attrs: { role: "menu" } });

  for (const item of items) {
    if (item.separator) {
      menu.append(el("div", { class: "sep" }));
      continue;
    }
    const button = el(
      "button",
      {
        class: item.danger ? "danger" : undefined,
        attrs: { type: "button", role: "menuitem" },
        on: {
          click: () => {
            closeContextMenu();
            item.onSelect?.();
          },
        },
      },
      [
        el("span", { class: "icon", text: item.icon ?? "" }),
        el("span", { text: item.label ?? "" }),
        item.shortcut ? el("span", { class: "shortcut", text: item.shortcut }) : null,
      ],
    );
    if (item.disabled) button.disabled = true;
    menu.append(button);
  }

  menu.style.visibility = "hidden";
  host.append(menu);

  const rect = menu.getBoundingClientRect();
  const margin = 6;
  const x = Math.max(margin, Math.min(position.x, window.innerWidth - rect.width - margin));
  const y = Math.max(margin, Math.min(position.y, window.innerHeight - rect.height - margin));
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.style.visibility = "visible";
  open = menu;

  const onPointerDown = (event: MouseEvent) => {
    if (!menu.contains(event.target as Node)) closeContextMenu();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") closeContextMenu();
  };

  // `capture` so the menu closes even if another handler stops propagation.
  document.addEventListener("mousedown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("blur", closeContextMenu);
  window.addEventListener("resize", closeContextMenu);
  document.addEventListener("scroll", closeContextMenu, true);

  cleanup = () => {
    document.removeEventListener("mousedown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("blur", closeContextMenu);
    window.removeEventListener("resize", closeContextMenu);
    document.removeEventListener("scroll", closeContextMenu, true);
  };

  // Focus the first usable entry so the menu is keyboard navigable.
  const first = menu.querySelector<HTMLButtonElement>("button:not(:disabled)");
  first?.focus();
}
