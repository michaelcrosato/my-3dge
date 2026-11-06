/**
 * @file A screen's frame over the world (labs/playground/ui/frontEnd.ts's screens, labs/playground/ui/theme.ts's look):
 * `createFrame(root, kind, heading, footer)` makes a `.pg-screen` of `kind` (`title`: the start menu's column at the
 * left; `menu`; `list`: a long menu in columns; `panel`: a panel in the middle; `side`: a panel at the side over the
 * open world), headed by the playground's name (`heading` null), a heading, or nothing (''), with a body for the
 * screen's menu or panel, a line under it that says what the selected item does (`detail`, `ABOUT`'s words), and the
 * keys in the footer: `footer`, a string or a function read again at each `refresh()` (the front end's screens call
 * it each frame), for `screenKeys`, the menus' keys on the device used last; marked `data-keyboard`, so a touch screen
 * hides it (engine/ui/overlay.ts). `brand(doc, sub)` is the playground's name as the start menu and the splash head it,
 * the engine's version beside its name (`[data-ui=version]`, `ENGINE_VERSION`).
 *
 * Invariants: presentation only; it reads nothing but what `footer` reads, and the caller removes `el`.
 *
 * Game code, a page's: it imports only the engine's public API (engine/index.ts) and the playground's own files.
 *
 * @example
 * ABOUT.play; // 'Walk the block: …'
 * screenKeys({ prompt: (action) => (action === 'uiAccept' ? 'A' : 'B') }, 'title'); // 'A: select · B: play'
 * // const { el, body, detail } = createFrame(ui.root, 'menu', 'Paused');
 * @see tests/e2e/playground-ui.spec.ts
 */
import { ENGINE_VERSION, type Input } from '../../../engine';

/** What each menu item is for, shown under the menu as the cursor rests on it. */
export const ABOUT: Readonly<Record<string, string>> = {
  play: 'Walk the block: the house, the gym, the range, the ring, the hill and the street, each with something to try.',
  spawns: 'Start in another area of the block, or in any room of the house.',
  settings: 'The camera, the mouse, the movement, the look and quality, the volumes, and every key.',
  help: 'Every control, with its key.',
  photo: 'A free camera: fly it with the move keys, turn it with a drag.',
  card: 'Back to play, the card of the area you are in shown again: what it is and what to try (I).',
  tour: 'Sit back: a recorded tour of everything on the block, the view stepping through the cameras and the looks.',
  checks: 'What only you can judge: try each thing it names and say how it feels or looks.',
  tools:
    'For tuning and testing: the look’s filters, recorded runs, the movement numbers, and the Stress Box and the labs.',
  tune: 'Every filter of the look, its scope and amount, and looks laid on: changes show at once.',
  replays: 'Play a recorded run of the block, then take over the controls.',
  feel: 'The movement numbers, live (F shows and hides it).',
  pages:
    'The engine’s own pages beside the block, each in a new tab: the Stress Box’s crowds, fights, props and ragdolls, and the seven labs.',
  restart: 'Start the block again from the beginning, on the same seed.',
  title: 'Back to the start menu.',
  check: 'Say how the check under way went.',
};

/** A `div` of `className` holding `textContent`, made in `doc`. */
export const textDiv = (doc: Document, className: string, textContent: string): HTMLElement =>
  Object.assign(doc.createElement('div'), { className, textContent });

/** The playground's name as the start menu and the splash head it: a kicker (the engine and its version), the title
 * and `sub` under it. */
export function brand(doc: Document, sub: string): HTMLElement {
  const el = textDiv(doc, 'pg-brand', '');
  const kicker = textDiv(doc, 'pg-brand-kicker', 'my-3dge ');
  const version = Object.assign(doc.createElement('span'), { textContent: ENGINE_VERSION });
  version.dataset.ui = 'version';
  kicker.append(version);
  el.append(kicker, textDiv(doc, 'pg-brand-title', 'The Playground'), textDiv(doc, 'pg-brand-sub', sub));
  return el;
}

/**
 * The footer of a screen of `kind`, naming the menus' keys (`uiAccept`, `uiCancel`) on the device used last: on the
 * start menu cancelling plays, on every other screen it goes back; a panel names only that, a side panel nothing.
 */
export function screenKeys(input: Pick<Input, 'prompt'>, kind: string): string {
  const cancel = `${input.prompt('uiCancel')}: ${kind === 'title' ? 'play' : 'back'}`;
  return kind === 'side' ? '' : kind === 'panel' ? cancel : `${input.prompt('uiAccept')}: select · ${cancel}`;
}

/** A screen's frame, made in `root` (see the file comment); `refresh()` writes a function footer again. */
export function createFrame(
  root: HTMLElement,
  kind: string,
  heading: string | null,
  footer: string | (() => string) = '',
): { el: HTMLElement; body: HTMLElement; detail: HTMLElement; refresh(): void } {
  const doc = root.ownerDocument;
  const el = Object.assign(doc.createElement('div'), { className: 'pg-screen' });
  el.dataset.kind = kind;
  const text = (className: string, textContent: string) => textDiv(doc, className, textContent);
  if (heading === null)
    el.append(brand(doc, 'One block of everything the engine does: a house, a gym, a range, a ring, a hill and a street to try it in.')); // prettier-ignore
  else if (heading) el.append(text('pg-heading', heading));
  const body = Object.assign(doc.createElement('div'), { className: 'pg-body' });
  const detail = text('pg-detail', '');
  el.append(body, detail);
  const foot = footer ? text('pg-footer', '') : null;
  if (foot) {
    foot.dataset.keyboard = ''; // a key hint
    el.append(foot);
  }
  const refresh = () => {
    const now = typeof footer === 'function' ? footer() : footer;
    if (foot && foot.textContent !== now) foot.textContent = now;
  };
  refresh();
  root.append(el);
  return { el, body, detail, refresh };
}
