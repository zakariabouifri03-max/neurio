/**
 * A deliberately tiny DOM helper.
 *
 * The UI needs element creation, events and list diffing — nothing more. A
 * 60-line builder keeps the bundle small (no framework runtime) which matches
 * the "lightweight, low memory" goal of the application.
 */

export type Child = Node | string | number | null | undefined | false;

interface ElementProps {
  class?: string;
  id?: string;
  /** Plain attributes (`type`, `title`, `aria-label`, `hidden`, …). */
  attrs?: Record<string, string | number | boolean | null | undefined>;
  /** `style` properties, camelCased. */
  style?: Partial<Record<keyof CSSStyleDeclaration, string>>;
  /** Event listeners, keyed without the `on` prefix. */
  on?: Record<string, (event: Event) => void>;
  /** `dataset` entries. */
  data?: Record<string, string>;
  text?: string;
  html?: string;
}

/** Creates an element with children. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  applyProps(node, props);
  append(node, children);
  return node;
}

/** Applies the same props as {@link el} to an existing element. */
export function applyProps(node: HTMLElement, props: ElementProps): void {
  if (props.class) node.className = props.class;
  if (props.id) node.id = props.id;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.html !== undefined) node.innerHTML = props.html;
  if (props.attrs) {
    for (const [key, value] of Object.entries(props.attrs)) {
      if (value === null || value === undefined || value === false) {
        node.removeAttribute(key);
      } else {
        node.setAttribute(key, String(value));
      }
    }
  }
  if (props.style) {
    for (const [key, value] of Object.entries(props.style)) {
      if (value !== undefined) {
        (node.style as unknown as Record<string, string>)[key] = value as string;
      }
    }
  }
  if (props.data) {
    for (const [key, value] of Object.entries(props.data)) {
      node.dataset[key] = value;
    }
  }
  if (props.on) {
    for (const [key, handler] of Object.entries(props.on)) {
      node.addEventListener(key, handler);
    }
  }
}

export function append(node: HTMLElement, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === "string" || typeof child === "number" ? String(child) : child);
  }
}

/** Focuses the element when it is inside the document and focusable. */
export function focusIfPossible(node: HTMLElement | null): void {
  if (!node || !document.body.contains(node)) return;
  const focusable = node.matches("button, input, select, textarea, [tabindex]")
    ? node
    : node.querySelector<HTMLElement>("button, input, select, textarea, [tabindex]");
  focusable?.focus();
}

/** Removes every child of a node. */
export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Replaces the children of `node` with `children`. */
export function replace(node: HTMLElement, children: Child[]): void {
  clear(node);
  append(node, children);
}

/** Sets text only when it changed (avoids needless layout work). */
export function setText(node: HTMLElement | null, value: string): void {
  if (node && node.textContent !== value) node.textContent = value;
}

/** Sets a CSS custom property / style value only when it changed. */
export function setStyle(node: HTMLElement | null, property: string, value: string): void {
  if (!node) return;
  const current = (node.style as unknown as Record<string, string>)[property];
  if (current !== value) {
    (node.style as unknown as Record<string, string>)[property] = value;
  }
}

export function toggleClass(node: HTMLElement | null, name: string, on: boolean): void {
  if (!node) return;
  node.classList.toggle(name, on);
}

/** Returns the closest ancestor (or the node itself) matching a selector. */
export function closestFrom(target: EventTarget | null, selector: string): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const match = target.closest(selector);
  return match instanceof HTMLElement ? match : null;
}

/** Copies text to the clipboard using the standard browser API. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for environments without the async clipboard API.
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Formats a keyboard shortcut for the given event (Windows conventions). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}
