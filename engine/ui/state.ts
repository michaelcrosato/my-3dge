/**
 * @file `ui.state()` (PLAN.md §6.7, WP 6.5, I-50; doctrine: Verifiable without a display): the overlay's elements as
 * plain data, read from the page itself, so a test or an agent sees what a player sees as text, places, boxes and
 * visibility, never as pixels. `uiState(root)` reads every element marked `data-ui` under `root`, in page order.
 *
 * Each element gives:
 * - `kind` (its `data-ui`: `label`, `damage`, `hud`, `crosshair`, and later the widgets of WP 10.6), its `id`
 *   (`data-id`) and `value` (`data-value`) when it has them, and its `text`;
 * - `at`: where the overlay put its centre (`--ui-x`, `--ui-y`: CSS px from the root's top left), for placed ones;
 * - `box`: `[x, y, width, height]` from `getBoundingClientRect`, relative to the root, or null where nothing lays the
 *   page out (Node's stand-in documents);
 * - `visible`: no `hidden` attribute on it or up to the root, rendered (`checkVisibility`: not `display: none` or
 *   `visibility: hidden`, opacity aside, so a blinking number stays visible), and its box, when known, not empty
 *   and overlapping the root's.
 *
 * Plus the root's `size` (CSS px) and whether the page is in touch mode (the `touch` class, engine/ui/chrome.ts).
 *
 * Invariants: it only reads the DOM; numbers are rounded to 0.01 px, so states compare and snapshot exactly.
 *
 * @example
 * // browser: it reads a page's layout
 * // uiState(ui.root).elements.filter((e) => e.kind === 'damage').map((e) => e.value); // ['12', '7']
 * @see engine/ui/state.test.ts
 */

/** One overlay element (see the file comment). */
export interface UiElementState {
  kind: string;
  id?: string;
  value?: string;
  text: string;
  at?: [number, number];
  box: [number, number, number, number] | null;
  visible: boolean;
}

/** The overlay as plain data (see the file comment). */
export interface UiState {
  size: [number, number];
  touch: boolean;
  elements: UiElementState[];
}

/** `v` to 0.01. */
const round = (v: number) => Math.round(v * 100) / 100 + 0;

/** The rect of `el` relative to `origin`, or null where there is no layout. */
function boxOf(el: Element, origin: DOMRect | null): [number, number, number, number] | null {
  if (!origin || typeof el.getBoundingClientRect !== 'function') return null;
  const r = el.getBoundingClientRect();
  return [round(r.left - origin.left), round(r.top - origin.top), round(r.width), round(r.height)];
}

/** Whether `el` or an element between it and `root` carries `hidden`. */
function hiddenUnder(el: Element, root: Element): boolean {
  for (let at: Element | null = el; at && at !== root; at = at.parentElement) {
    if (at.hasAttribute('hidden')) return true;
  }
  return root.hasAttribute('hidden');
}

/** The overlay under `root` as plain data (see the file comment). */
export function uiState(root: HTMLElement): UiState {
  const origin = typeof root.getBoundingClientRect === 'function' ? root.getBoundingClientRect() : null;
  const size: [number, number] = origin
    ? [round(origin.width), round(origin.height)]
    : [parseFloat(root.style.width) || 0, parseFloat(root.style.height) || 0];
  const elements = Array.from(root.querySelectorAll<HTMLElement>('[data-ui]'), (el) => {
    const { ui, id, value } = el.dataset;
    const x = el.style.getPropertyValue('--ui-x');
    const y = el.style.getPropertyValue('--ui-y');
    const box = boxOf(el, origin);
    const laidOut = !box || (box[2] > 0 && box[3] > 0 && overlaps(box, size));
    const rendered = typeof el.checkVisibility !== 'function' || el.checkVisibility({ visibilityProperty: true });
    const state: UiElementState = { kind: ui ?? '', text: el.textContent ?? '', box, visible: false };
    if (id !== undefined) state.id = id;
    if (value !== undefined) state.value = value;
    if (x !== '' && y !== '') state.at = [round(Number(x)), round(Number(y))];
    state.visible = !hiddenUnder(el, root) && rendered && laidOut;
    return state;
  });
  return { size, touch: root.ownerDocument.documentElement.classList.contains('touch'), elements };
}

/** Whether `box` overlaps the root's `size` (both CSS px from the root's top left). */
function overlaps(box: readonly number[], size: readonly number[]): boolean {
  return box[0] < size[0] && box[1] < size[1] && box[0] + box[2] > 0 && box[1] + box[3] > 0;
}
