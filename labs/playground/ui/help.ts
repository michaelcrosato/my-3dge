/**
 * @file The controls sheet (the owner's call of 2026-11-03: a clear way to play and test, not a line of keys across
 * the screen): every action the playground answers, grouped (`HELP_GROUPS`), with its key as the input names it for
 * the map in use on the device used last (rebound or on a pad, through `input.prompt`): the move keys, or the left
 * stick; the mouse's look under the pointer lock, its aim with the pointer free, or the right stick; the view's own
 * keys only where the map has them (the shooter's shoulder, isometric's turn); a line the device has no key for is left
 * out (the pad's weapon swap on a keyboard: `UNBOUND`). The page's own keys (the look, the feel panel, the menus) are
 * as written. The front end opens it from H, the start menu and pause (frontEnd.ts).
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

/** The page's key for the controls sheet (labs/playground/main.ts), kept from rebinding (controls.ts). */
export const HELP_KEY = 'KeyH';
/** The page's key for Go to, kept from rebinding as the sheet's. */
export const GOTO_KEY = 'KeyM';

/** The input's prompt for an action the device has no key for (engine/input/bindings.ts `pickLabel`). */
export const UNBOUND = '—';

/** What the sheet reads of the input: the prompts on the device used last, and the map in use. */
export type HelpInput = Pick<Input, 'prompt' | 'bindings' | 'lastDevice'>;

/** One line of the sheet: an action of the map, a key worked out from the input, or a page key as written. */
export interface HelpLine {
  readonly label: string;
  /** The action whose key the input names. */
  readonly action?: string;
  /** The key worked out from the input; null leaves the line out (the map has no such key). */
  readonly keys?: (input: HelpInput) => string | null;
  /** A page key, as written (labs/playground/main.ts reads it, never the map). */
  readonly page?: string;
}

const pad = (input: HelpInput) => input.lastDevice === 'gamepad';
/** A view action's key where the map in use has it. */
const viewKey = (action: string) => (input: HelpInput) => (input.bindings.map.view.includes(action) ? input.prompt(action) : null); // prettier-ignore

/** The sheet's groups, in order (see the file comment). */
export const HELP_GROUPS: readonly { readonly title: string; readonly lines: readonly HelpLine[] }[] = [
  {
    title: 'Move',
    lines: [
      { label: 'Move', keys: (input) => (pad(input) ? 'L Stick' : ['forward', 'left', 'back', 'right'].map((action) => input.prompt(action)).join(' ')) }, // prettier-ignore
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
      { label: 'Look around', keys: (input) => (pad(input) ? 'R Stick' : input.bindings.map.lock ? 'Click, then mouse' : 'Mouse: it aims') }, // prettier-ignore
      { label: 'Next camera', action: 'camera' },
      { label: 'Swap shoulder', keys: viewKey('shoulder') },
      { label: 'Turn the view', keys: (input) => (viewKey('turnLeft')(input) === null ? null : `${input.prompt('turnLeft')} ${input.prompt('turnRight')}`) }, // prettier-ignore
      { label: 'Next look', page: 'P' },
    ],
  },
  {
    title: 'Menus',
    lines: [
      { label: 'Pause', action: 'pause' },
      { label: 'Go to another area', page: 'M' },
      { label: 'This sheet', page: 'H' },
      { label: 'Feel panel (movement numbers)', page: 'F' },
    ],
  },
];

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
    const part = make('div', { className: 'pg-group' });
    part.append(make('h3', { textContent: group.title }));
    const grid = make('div', { className: 'pg-keys' });
    for (const line of group.lines) {
      const key = line.action ? options.input.prompt(line.action) : line.keys ? line.keys(options.input) : (line.page ?? ''); // prettier-ignore
      if (key === null || key === UNBOUND) continue; // the map in use, or the device, has none
      const row = make('div', { className: 'pg-key' });
      row.dataset.ui = 'key';
      row.dataset.id = line.action ?? line.page ?? line.label;
      row.append(make('span', { textContent: line.label }), make('kbd', { textContent: key }));
      grid.append(row);
    }
    part.append(grid);
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
