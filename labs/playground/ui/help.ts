/**
 * @file The controls sheet (the owner's call of 2026-11-03: a clear way to play and test, not a line of keys across
 * the screen): every action the playground answers, grouped (`HELP_GROUPS`), with its key as the input names it on the
 * device used last (rebound or on a pad, through `input.prompt`), and the page's own keys (the look, the feel panel,
 * the menus). The front end opens it from H, the start menu and pause (labs/playground/ui/frontEnd.ts).
 *
 * Elements: `[data-ui=help]`, a `[data-ui=key]` per action (`data-id` the action), and the Back button
 * (`[data-ui=item][data-id=back]`). Invariants: presentation only; it reads the input's prompts when made.
 *
 * Game code, a page's: it imports only the engine's public API (engine/index.ts) and the playground's own files.
 *
 * @example
 * HELP_GROUPS[0].title; // 'Move'
 * // const sheet = createHelp(root, { prompt: (action) => input.prompt(action), onBack });
 * @see labs/playground/ui/help.test.ts
 */

/** The page's key for the controls sheet (labs/playground/main.ts), kept from rebinding (controls.ts). */
export const HELP_KEY = 'KeyH';
/** The page's key for Go to, kept from rebinding as the sheet's. */
export const GOTO_KEY = 'KeyM';

/** One line of the sheet: an action of the map (its key from the input) or a page key (its key as written). */
export interface HelpLine {
  readonly label: string;
  readonly action?: string;
  readonly key?: string;
}

/** The sheet's groups, in order (see the file comment). */
export const HELP_GROUPS: readonly { readonly title: string; readonly lines: readonly HelpLine[] }[] = [
  {
    title: 'Move',
    lines: [
      { label: 'Move', key: 'WASD' },
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
      { label: 'Fire', action: 'fire' },
      { label: 'Aim down the sights', action: 'aim' },
      { label: 'Reload', action: 'reload' },
      { label: 'Holster', action: 'holster' },
    ],
  },
  {
    title: 'View',
    lines: [
      { label: 'Next camera', action: 'camera' },
      { label: 'Swap shoulder', action: 'shoulder' },
      { label: 'Next look', key: 'P' },
      { label: 'Look around', key: 'Click, then mouse' },
    ],
  },
  {
    title: 'Menus',
    lines: [
      { label: 'Pause', key: 'Esc' },
      { label: 'Go to another area', key: 'M' },
      { label: 'This sheet', key: 'H' },
      { label: 'Feel panel (movement numbers)', key: 'F' },
    ],
  },
];

/** What the sheet needs: the key of an action, and what Back does. */
export interface HelpOptions {
  prompt(action: string): string;
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
      const row = make('div', { className: 'pg-key' });
      row.dataset.ui = 'key';
      row.dataset.id = line.action ?? line.key ?? line.label;
      const key = line.action ? options.prompt(line.action) : (line.key ?? '');
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
