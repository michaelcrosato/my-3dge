/**
 * @file A screen's frame over the world (labs/playground/ui/frontEnd.ts's screens, labs/playground/ui/theme.ts's look):
 * `createFrame(root, kind, heading, footer)` makes a `.pg-screen` of `kind` (`title`: the start menu's column at the
 * left; `menu`; `list`: a long menu in columns; `panel`: a panel in the middle; `side`: a panel at the side over the
 * open world), headed by the playground's name (`heading` null), a heading, or nothing (''), with a body for the
 * screen's menu or panel, a line under it that says what the selected item does (`detail`, `ABOUT`'s words), and the
 * keys in the footer. `brand(doc, sub)` is the playground's name as the start menu and the splash head it.
 *
 * Invariants: presentation only; it reads nothing and the caller removes `el`.
 *
 * Game code, a page's: it imports only the engine's public API (engine/index.ts) and the playground's own files.
 *
 * @example
 * ABOUT.play; // 'Walk the block: …'
 * // const { el, body, detail } = createFrame(ui.root, 'menu', 'Paused');
 * @see tests/e2e/playground-ui.spec.ts
 */

/** What each menu item is for, shown under the menu as the cursor rests on it. */
export const ABOUT: Readonly<Record<string, string>> = {
  play: 'Walk the block: the house, the gym, the range, the ring, the hill and the street, each with something to try.',
  spawns: 'Start in another area of the block, or in any room of the house.',
  settings: 'The camera, the mouse, the movement, the look and quality, the volumes, and every key.',
  help: 'Every control, with its key.',
  photo: 'A free camera: fly it with the move keys, turn it with a drag.',
  tour: 'Sit back: a recorded tour of everything on the block, the view stepping through the cameras and the looks.',
  checks: 'What only you can judge: try each thing it names and say how it feels or looks.',
  tools: 'For tuning and testing: the look’s filters, recorded runs, the movement numbers.',
  tune: 'Every filter of the look, its scope and amount, and looks laid on: changes show at once.',
  replays: 'Play a recorded run of the block, then take over the controls.',
  feel: 'The movement numbers, live (F shows and hides it).',
  restart: 'Start the block again from the beginning, on the same seed.',
  title: 'Back to the start menu.',
  check: 'Say how the check under way went.',
};

/** A `div` of `className` holding `textContent`, made in `doc`. */
export const textDiv = (doc: Document, className: string, textContent: string): HTMLElement =>
  Object.assign(doc.createElement('div'), { className, textContent });

/** The playground's name as the start menu and the splash head it: a kicker, the title and `sub` under it. */
export function brand(doc: Document, sub: string): HTMLElement {
  const el = textDiv(doc, 'pg-brand', '');
  el.append(textDiv(doc, 'pg-brand-kicker', 'my-3dge'), textDiv(doc, 'pg-brand-title', 'The Playground'), textDiv(doc, 'pg-brand-sub', sub)); // prettier-ignore
  return el;
}

/** A screen's frame, made in `root` (see the file comment). */
export function createFrame(
  root: HTMLElement,
  kind: string,
  heading: string | null,
  footer = 'Enter: select · Esc: back',
): { el: HTMLElement; body: HTMLElement; detail: HTMLElement } {
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
  if (footer) el.append(text('pg-footer', footer));
  root.append(el);
  return { el, body, detail };
}
