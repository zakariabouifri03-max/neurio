'use client';

/** Shared insertion helpers used by every side panel. */
import type { Page, SceneNode } from '@/engine/types';
import { useEditor } from '@/store/editor';
import { uid } from '@/engine/factory';

/** Places a node so it lands in the middle of the visible page area. */
export function placeNode(node: SceneNode, page: Page, opts: { center?: boolean; scaleToPage?: number } = {}): SceneNode {
  const scaleToPage = opts.scaleToPage ?? 0.4;
  if (opts.center !== false) {
    const maxWidth = page.width * scaleToPage;
    const ratio = node.height / Math.max(1, node.width);
    const width = node.width > maxWidth ? maxWidth : node.width;
    node.width = width;
    node.height = width * ratio;
    node.x = Math.round((page.width - node.width) / 2);
    node.y = Math.round((page.height - node.height) / 2);
  }
  return node;
}

/** Deep-clones a node subtree with fresh ids (used when adding library items). */
export function freshNode(node: SceneNode): SceneNode {
  const clone: SceneNode = JSON.parse(JSON.stringify(node));
  const reid = (current: SceneNode): SceneNode => {
    current.id = uid(current.type.slice(0, 3));
    if (current.children?.length) current.children = current.children.map(reid);
    return current;
  };
  return reid(clone);
}

/** Adds a node to the active page through the store (undoable, selected). */
export function addToPage(node: SceneNode, label?: string): void {
  const store = useEditor.getState();
  store.addNode(node, { label: label ?? `Add ${node.name}` });
}

/** Adds a node at the current scroll/viewport centre if available. */
export function addAtViewCenter(node: SceneNode, label?: string): void {
  const state = useEditor.getState();
  const page = state.doc.pages[state.activePage];
  if (!page) return;
  addToPage(placeNode(node, page), label);
}
