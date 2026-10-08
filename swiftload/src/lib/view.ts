/** Contract every screen implements. */
import type { Topic } from "./store";

export interface View {
  readonly element: HTMLElement;
  /** Called when the view is shown (lazy loading of history, logs, …). */
  onShow?(): void;
  /** Called whenever the store published a change. */
  onTopic?(topic: Topic): void;
  /** Called when the view is replaced; release timers and subscriptions. */
  destroy?(): void;
}
