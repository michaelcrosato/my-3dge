/**
 * @file The menu (PLAN.md §6.7, WP 10.6, I-50): a list with a cursor, for title screens, pause menus, settings and
 * shops, as HTML/CSS over the overlay. `createMenu(parent, items, { input, sound, title, place, onPick, onCancel,
 * onMove, send })` makes it open; `update(dt)` each frame reads the page's input and returns true when it picked or
 * cancelled.
 *
 * `uiUp` and `uiDown` (keys, the pad's D-pad and left stick; held, they repeat: engine/ui/widgets.ts `createRepeat`)
 * move the cursor over the items, round the ends, past disabled ones; `uiAccept` picks the item under it, `uiCancel`
 * calls `onCancel` when there is one; a pointer over an item moves the cursor there, a click picks it. A gamepad drives
 * the menu with its buttons, and any other panel through the pad's cursor (`createPadCursor`).
 *
 * Picks that change play: the system layer never enters the intents (engine/input/actionMaps.ts), so a menu never
 * reaches the sim itself. An item with an `id` is handed to `send(id)` when picked, which the page turns into input
 * the session records (a dev action, `__engine.actions.run`, or a custom intent for the next step), so the replay
 * holds the pick; `onPick` hears every pick, for what only the page changes (a look, a panel).
 *
 * Elements: `[data-ui=menu]` (`data-id`, `data-value` the cursor's index; `data-place`), its `[data-ui=menu-title]`,
 * and a `[data-ui=item]` per item (`data-id` its id or index, `data-value` `selected`, `disabled` or empty). Cues: `move`,
 * `pick`, `cancel`. Invariants: presentation only; `active: false` reads no input; the cursor never rests on a disabled
 * item while another is enabled. Carried from `my-3d2dge:engine/my-3d2dge.js:4288-4330` (`Menu`: items, disabled ones
 * skipped, onPick, onCancel, onMove) and shardfall's rule that menu actions reach the game as input (§5.8).
 *
 * @example
 * // browser: the menu needs a page
 * // const pause = createMenu(ui.root, ['Resume', { label: 'Restart', id: 'restart' }], {
 * //   input, title: 'Paused', onCancel: () => pause.remove(), send: (id) => engine.actions.run(id) });
 * // pause.update(dt); // each frame
 * @see engine/ui/menu.test.ts
 * @see tests/e2e/ui.spec.ts
 */
import { codeError, defineCodes } from '../core/log';
import { createRepeat, setText, uiElement, widgetStyle, type UiInput, type UiSound } from './widgets';

/** The codes this module raises, with their fixes. */
export const MENU_CODES = defineCodes('ui', {
  UI_BAD_MENU: {
    template: 'menu: {problem}',
    fix: "give items as strings or { label, id?, disabled? }, and update(dt) the frame's seconds, 0 or more",
    doc: 'Raised by the menu (engine/ui/menu.ts) for an item that is neither a string nor `{ label, id?, disabled? }`, or a frame time that is not a number of seconds from 0.',
  },
});

/** One menu item: its label, or `{ label, id, disabled }` (an `id` is sent when picked). */
export type MenuItem = string | { readonly label: string; readonly id?: string; readonly disabled?: boolean };

/** Where the menu stands. */
export type MenuPlace = 'center' | 'top' | 'bottom';

/** How a menu is made. */
export interface MenuOptions {
  input: UiInput;
  sound?: UiSound;
  /** Its id (`data-id`). */
  id?: string;
  title?: string;
  /** Where it stands (`center`). */
  place?: MenuPlace;
  onPick?(index: number, item: MenuItem): void;
  onCancel?(): void;
  onMove?(index: number, item: MenuItem): void;
  /** Hands a picked item's id to the page, which records it as input (see the file comment). */
  send?(id: string): void;
}

/** The menu (see the file comment). */
export interface Menu {
  readonly el: HTMLElement;
  /** The cursor's index, and its item. */
  readonly index: number;
  readonly selected: MenuItem | undefined;
  /** False: it reads no input (another menu over it has the input). */
  active: boolean;
  /** Reads the input for a frame of `dt` s; true when it picked or cancelled. Throws `UI_BAD_MENU`. */
  update(dt: number): boolean;
  /** Moves the cursor to `index` (a disabled item: the next enabled one after it). */
  select(index: number): void;
  /** Picks the item under the cursor, as accept does; false when it is disabled. */
  pick(): boolean;
  /** Replaces the items, keeping the cursor where it can. Throws `UI_BAD_MENU`. */
  setItems(items: readonly MenuItem[]): void;
  remove(): void;
}

const labelOf = (item: MenuItem) => (typeof item === 'string' ? item : item.label);
const off = (item: MenuItem | undefined) => typeof item === 'object' && item.disabled === true;

/** Makes an open menu of `items` in `parent` (see the file comment). */
export function createMenu(parent: HTMLElement, items: readonly MenuItem[], options: MenuOptions): Menu {
  widgetStyle(parent.ownerDocument);
  const { input, sound = () => {} } = options;
  const el = uiElement(parent, 'ui-panel ui-menu', 'menu', options.id);
  el.dataset.place = options.place ?? 'center';
  if (options.title) el.append(Object.assign(uiElement(el, 'ui-menu-title', 'menu-title'), { textContent: options.title })); // prettier-ignore
  parent.append(el);
  const repeat = createRepeat();
  let list: MenuItem[] = [];
  let rows: HTMLElement[] = [];
  let index = 0;

  /** `index` stepped by `dir` until an enabled item (or all the way round). */
  const skip = (from: number, dir: 1 | -1) => {
    let at = from;
    for (let k = 0; k < list.length && off(list[at]); k++) at = (at + dir + list.length) % list.length;
    return at;
  };
  const draw = () => {
    if (el.dataset.value !== String(index)) el.dataset.value = String(index);
    rows.forEach((row, i) => {
      const value = off(list[i]) ? 'disabled' : i === index ? 'selected' : '';
      if (row.dataset.value !== value) row.dataset.value = value;
    });
  };
  const move = (to: number, dir: 1 | -1) => {
    if (!list.length) return;
    const next = skip(((to % list.length) + list.length) % list.length, dir);
    if (next === index) return;
    index = next;
    sound('move');
    draw();
    options.onMove?.(index, list[index]);
  };
  const pick = () => {
    const item = list[index];
    if (item === undefined || off(item)) return false;
    sound('pick');
    if (typeof item === 'object' && item.id !== undefined) options.send?.(item.id);
    options.onPick?.(index, item);
    return true;
  };
  const setItems = (next: readonly MenuItem[]) => {
    for (const item of next) {
      const ok =
        typeof item === 'string' || (typeof item === 'object' && item !== null && typeof item.label === 'string');
      if (!ok) throw codeError('UI_BAD_MENU', { problem: `the item ${JSON.stringify(item)} is no string or { label }` }); // prettier-ignore
    }
    for (const row of rows) row.remove();
    list = [...next];
    rows = list.map((item, i) => {
      const row = uiElement(el, 'ui-menu-item', 'item', typeof item === 'object' && item.id !== undefined ? item.id : String(i)); // prettier-ignore
      row.dataset.index = String(i);
      setText(row, labelOf(item));
      row.addEventListener('pointerenter', () => !off(list[i]) && move(i, 1));
      row.addEventListener('click', () => {
        if (off(list[i])) return;
        if (i !== index) move(i, 1);
        pick();
      });
      el.append(row);
      return row;
    });
    index = list.length ? skip(Math.min(index, list.length - 1), 1) : 0;
    draw();
  };
  setItems(items);

  return {
    el,
    get index() {
      return index;
    },
    get selected() {
      return list[index];
    },
    active: true,
    update(dt) {
      if (!(dt >= 0 && Number.isFinite(dt))) throw codeError('UI_BAD_MENU', { problem: `update(dt) got dt ${dt}` });
      if (!this.active || !list.length) return false;
      if (repeat(input, 'uiUp', dt)) move(index - 1, -1);
      if (repeat(input, 'uiDown', dt)) move(index + 1, 1);
      if (input.pressed('uiAccept')) return pick();
      if (input.pressed('uiCancel') && options.onCancel) {
        sound('cancel');
        options.onCancel();
        return true;
      }
      return false;
    },
    select: (to) => move(to, 1),
    pick,
    setItems,
    remove: () => el.remove(),
  };
}
