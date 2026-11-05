/**
 * @file Tools, the start menu's and pause's screen for tuning and testing (labs/playground/ui/frontEnd.ts `tools`):
 * its items (`toolsItems`), each said under the menu by frame.ts `ABOUT`: the Tune panel (`tune`, tune.ts, WP 13.32),
 * the recorded runs (`replays`, runs.ts: each by its name, played on the block, opened as `?replay=<id>`, the view
 * kept: links.ts) and the feel panel (labs/playground/feel.ts) where the page has them, and the engine's own pages
 * beside the block (`pages`, pages.ts: the Stress Box and the seven labs, each in a new tab; from playground.html, the
 * screen first saying to run npm run dev).
 *
 * Invariants: data only; labs/playground/ui/frontEnd.test.ts holds every item but Back to a line in `ABOUT`.
 *
 * Game code, a page's: it imports nothing.
 *
 * @example
 * toolsItems({ replays: true, feel: true }).map((item) => item.id); // ['tune', 'replays', 'feel', 'pages', 'back']
 * @see labs/playground/ui/frontEnd.test.ts
 */

/** One of Tools' items, as the engine's menu takes it. */
export interface ToolsItem {
  readonly label: string;
  readonly id: string;
  readonly disabled?: boolean;
}

/** Tools' items (see the file comment): the recorded runs and the feel panel offered where the page has them. */
export const toolsItems = (has: { replays: boolean; feel: boolean }): ToolsItem[] => [
  { label: 'Tune the look…', id: 'tune' },
  { label: 'Recorded runs…', id: 'replays', disabled: !has.replays },
  { label: 'Feel panel', id: 'feel', disabled: !has.feel },
  { label: 'The Stress Box and the labs…', id: 'pages' },
  { label: 'Back', id: 'back' },
];
