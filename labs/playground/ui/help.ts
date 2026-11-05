/**
 * @file The controls sheet (the owner's call of 2026-11-03: a clear way to play and test, not a line of keys across the
 * screen): every action the playground answers, grouped (`HELP_GROUPS`), with its key as the input names it for the map
 * in use on the device used last (rebound or on a pad, through `input.prompt`): the move keys, or the left stick; the
 * mouse's look under the pointer lock, or the right stick's, and where the map aims with the pointer (isometric,
 * top-down) the mouse's or the right stick's aim; the view's own keys only where the map has them (the shooter's
 * shoulder, isometric's turn, each half the device has); a line the device has no key for is left out (the pad's weapon
 * swap on a keyboard: `UNBOUND`), and a group left with none. The page's own keys (the look, the feel panel, the menus,
 * the area's card) are as written, on a keyboard only: a pad reaches them through pause. On a touch screen (`onTouch`:
 * touch mode on, or a finger used last, and no pad) the sheet names the stick, the touch layout's buttons
 * (labs/playground/touch.ts) and the menu button, and leaves out the rest. The front end opens it from H, the start
 * menu and pause (frontEnd.ts).
 *
 * Elements: `[data-ui=help]`, a `[data-ui=key]` per line (`data-id` the action, else the page key or the label), and
 * the Back button (`[data-ui=item][data-id=back]`). Invariants: presentation only; it reads the input when made.
 *
 * Game code, a page's: it imports only the engine's public API (engine/index.ts) and the playground's own files.
 *
 * @example
 * HELP_GROUPS[0].title; // 'Move'
 * // const sheet = createHelp(root, { input, onBack });
 * @see labs/playground/ui/help.test.ts
 */
import type { Input } from '../../../engine';
import { PLAYGROUND_TOUCH_BUTTONS } from '../touch';

/** The page's key for the controls sheet (labs/playground/main.ts), kept from rebinding (controls.ts). */
export const HELP_KEY = 'KeyH';
/** The page's key for Go to, kept from rebinding as the sheet's. */
export const GOTO_KEY = 'KeyM';
/** The page's key that shows the area's card again (labs/playground/ui/areas.ts), kept from rebinding as the sheet's. */
export const CARD_KEY = 'KeyI';

/** The input's prompt for an action the device has no key for (engine/input/bindings.ts `pickLabel`). */
export const UNBOUND = '—';

/** What the sheet reads of the input: the prompts on the device used last, the map in use, and touch mode. */
export type HelpInput = Pick<Input, 'prompt' | 'bindings' | 'lastDevice' | 'touch'>;

/** One line of the sheet: an action of the map, a key worked out from the input, or a page key as written. */
export interface HelpLine {
  /** What it does, as the sheet shows it unless `says` words it for the input; the line's id when it has no other. */
  readonly label: string;
  /** What it does on this input, where that differs (the mouse's look is its aim in isometric). */
  readonly says?: (input: HelpInput) => string;
  /** The action whose key the input names. */
  readonly action?: string;
  /** The key worked out from the input; null leaves the line out (the map has no such key). */
  readonly keys?: (input: HelpInput) => string | null;
  /** A page key, as written (labs/playground/main.ts reads it, never the map). */
  readonly page?: string;
}

const pad = (input: HelpInput) => input.lastDevice === 'gamepad';
/** On touch: a finger used last, or touch mode on (a coarse pointer, as the engine hides key hints) and no pad used. */
export const onTouch = (input: Pick<Input, 'lastDevice' | 'touch'>): boolean =>
  input.lastDevice === 'touch' || (input.lastDevice !== 'gamepad' && input.touch?.active === true);
const touch = onTouch;
/** Whether the map aims with the pointer or the right stick, the camera following (isometric, top-down). */
const aims = (input: HelpInput) => input.bindings.map.aimWith === 'pointer';
/** The view actions' keys where the map in use has them, the halves the device has none for left out; null if none
 * (on touch always). */
const viewKey =
  (...actions: string[]) =>
  (input: HelpInput) => {
    if (touch(input)) return null; // no touch button turns the view
    const keys = actions.filter((action) => input.bindings.map.view.includes(action)).map((action) => input.prompt(action)); // prettier-ignore
    const had = keys.filter((key) => key !== UNBOUND);
    return had.length ? had.join(' ') : null;
  };
/** The touch layout's button for an action, by its label (labs/playground/touch.ts); the menu button pauses. */
const TOUCH_KEYS: Readonly<Record<string, string>> = { ...Object.fromEntries(PLAYGROUND_TOUCH_BUTTONS.map((button) => [button.action, button.label])), pause: 'Menu button, top right' }; // prettier-ignore

/** The sheet's groups, in order (see the file comment). */
export const HELP_GROUPS: readonly { readonly title: string; readonly lines: readonly HelpLine[] }[] = [
  {
    title: 'Move',
    lines: [
      { label: 'Move', keys: (input) => (touch(input) ? 'Stick: touch and drag' : pad(input) ? 'L Stick' : ['forward', 'left', 'back', 'right'].map((action) => input.prompt(action)).join(' ')) }, // prettier-ignore
      { label: 'Jump, mantle, climb', action: 'jump' },
      { label: 'Sprint (hold, or tap to keep)', action: 'sprint' },
      { label: 'Walk', action: 'walk' },
      { label: 'Crouch; slide at a sprint', action: 'crouch' },
    ],
  },
  {
    title: 'Act',
    lines: [
      { label: 'Use: doors, switches, ziplines, ladders, things to carry', action: 'interact' },
      { label: 'Strike: punch, kick, uppercut', action: 'melee' },
    ],
  },
  {
    title: 'Weapons',
    lines: [
      { label: 'Pistol', action: 'weapon1' },
      { label: 'Rifle', action: 'weapon2' },
      { label: 'Swap weapons', action: 'swap' },
      { label: 'Fire', action: 'fire' },
      { label: 'Aim down the sights', action: 'aim' },
      { label: 'Reload', action: 'reload' },
      { label: 'Holster', action: 'holster' },
    ],
  },
  {
    title: 'View',
    lines: [
      { label: 'Look around', says: (input) => (aims(input) ? 'Aim' : 'Look around'), keys: (input) => (touch(input) ? null : pad(input) ? 'R Stick' : aims(input) ? 'Mouse' : 'Click, then mouse') }, // prettier-ignore
      { label: 'Next camera', action: 'camera' },
      { label: 'Swap shoulder', keys: viewKey('shoulder') },
      { label: 'Turn the view', keys: viewKey('turnLeft', 'turnRight') },
      { label: 'Next look', page: 'P' },
    ],
  },
  {
    title: 'Menus',
    lines: [
      { label: 'Pause', action: 'pause' },
      { label: 'Go to another area', page: 'M' },
      { label: 'This area’s card again', page: 'I' },
      { label: 'This sheet', page: 'H' },
      { label: 'Feel panel (movement numbers)', page: 'F' },
    ],
  },
];

/** The key a line shows on `input` (see the file comment): null or `UNBOUND` leaves the line out. */
export function keyOf(line: HelpLine, input: HelpInput): string | null {
  if (line.action) return touch(input) ? (TOUCH_KEYS[line.action] ?? null) : input.prompt(line.action);
  if (line.keys) return line.keys(input);
  return pad(input) || touch(input) ? null : (line.page ?? null); // the page's keys: a keyboard's alone
}

/** What the sheet needs: the input it names the keys from, and what Back does. */
export interface HelpOptions {
  input: HelpInput;
  onBack(): void;
}

/** Makes the controls sheet in `parent` (see the file comment). */
export function createHelp(parent: HTMLElement, options: HelpOptions): { remove(): void } {
  const doc = parent.ownerDocument;
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}) =>
    Object.assign(doc.createElement(tag), props) as HTMLElementTagNameMap[K];
  const el = make('div', { className: 'ui-panel ui-box pg-help' });
  el.dataset.ui = 'help';
  const groups = make('div', { className: 'pg-groups' });
  el.append(make('h2', { textContent: 'Controls' }), groups);
  for (const group of HELP_GROUPS) {
    const grid = make('div', { className: 'pg-keys' });
    let rows = 0;
    for (const line of group.lines) {
      const key = keyOf(line, options.input);
      if (key === null || key === UNBOUND) continue; // the map in use, or the device, has none
      const row = make('div', { className: 'pg-key' });
      row.dataset.ui = 'key';
      row.dataset.id = line.action ?? line.page ?? line.label;
      row.append(make('span', { textContent: line.says?.(options.input) ?? line.label }), make('kbd', { textContent: key })); // prettier-ignore
      grid.append(row);
      rows++;
    }
    if (!rows) continue; // a group the device has no key of (the weapons on touch)
    const part = make('div', { className: 'pg-group' });
    part.append(make('h3', { textContent: group.title }), grid);
    groups.append(part);
  }
  const back = make('button', { type: 'button', className: 'pg-back', textContent: 'Back' });
  back.dataset.ui = 'item';
  back.dataset.id = 'back';
  back.addEventListener('click', () => options.onBack());
  el.append(back);
  parent.append(el);
  return { remove: () => el.remove() };
}
