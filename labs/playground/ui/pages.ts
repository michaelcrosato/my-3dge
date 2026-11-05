/**
 * @file The engine's own pages beside the playground (the owner's answer of 2026-11-05: the Stress Box and the seven
 * labs stay pages of their own, beside the block, opened from Tools): `ENGINE_PAGES`, each by its plain name (its
 * title in labs/labs.json) and one line on what it shows, and the link to one from the playground's page.
 *
 * The pages are Vite pages of the repository, served by its dev server (`npm run dev`, vite.config.ts: 127.0.0.1,
 * port 5173 by default). On the dev server they stand beside the playground (`pageUrl`: `labs/box/` from
 * `labs/playground/`). playground.html, the one file the owner opens from disk (file:, tools/lib/oneFile.ts), holds
 * only the playground: from it a page's link is the dev server's (`DEV_SERVER`), so it opens once the dev server runs,
 * and `awayNote` says so in plain words, naming what to run, wherever such a link is offered (Tools, an owner's check).
 * Tools' pages screen (labs/playground/ui/frontEnd.ts) lists them as `pageItems` gives them, each item's line under
 * the menu `pageAbout`'s.
 *
 * Invariants: data and pure functions; labs/playground/ui/pages.test.ts holds `ENGINE_PAGES` to labs/labs.json (each
 * page there, by its title) and to the repository (each page's index.html).
 *
 * Game code, a page's: it imports nothing.
 *
 * @example
 * pageUrl('labs/box/', 'http://127.0.0.1:5173/labs/playground/'); // 'http://127.0.0.1:5173/labs/box/'
 * pageUrl('labs/box/', 'file:///home/me/my-3dge/playground.html', '?scene=crowd-5000');
 * // 'http://127.0.0.1:5173/labs/box/?scene=crowd-5000': the dev server's, from the file
 * awayNote('http://127.0.0.1:5173/labs/playground/'); // undefined: the pages are here
 * @see labs/playground/ui/pages.test.ts
 */

/** Where the repository's dev server serves its pages (`npm run dev`, `PORT` unset: vite.config.ts's host and port). */
export const DEV_SERVER = 'http://127.0.0.1:5173/';

/** One of the engine's pages: its path from the repository's root, its plain name and what it shows. */
export interface EnginePage {
  readonly page: string;
  readonly label: string;
  readonly about: string;
}

/** The engine's pages Tools lists, the Stress Box first, then the labs index and the seven labs. */
export const ENGINE_PAGES: readonly EnginePage[] = [
  { page: 'labs/box/', label: 'The Stress Box', about: 'A scene for each thing the engine does at scale: crowds of 100, 1,000 and 5,000, a 1,000-agent fight, a hall of props, ragdolls and the clip library.' }, // prettier-ignore
  {
    page: 'labs/index/',
    label: 'The labs index',
    about: 'Every page and lab of the engine, each with what it is for.',
  },
  { page: 'labs/anim/', label: 'Animation Lab', about: 'The bodies and the mannequin told one pose or move, its phases on a timeline to scrub, the bones drawn over them.' }, // prettier-ignore
  { page: 'labs/materials/', label: 'Materials Lab', about: 'Every material on its cube, and every look over its set of things.' }, // prettier-ignore
  { page: 'labs/props/', label: 'Props Lab', about: 'Every prop, turned on the gallery’s stage.' },
  { page: 'labs/fx/', label: 'Effects Lab', about: 'Every emitter, burst again and again.' },
  { page: 'labs/cameras/', label: 'Cameras Lab', about: 'One set of things through every camera the engine has, each switched to with its blend.' }, // prettier-ignore
  { page: 'labs/physics/', label: 'Physics Lab', about: 'Ragdolls falling and getting up, and the hall’s props by the hundred, their settings at hand.' }, // prettier-ignore
  { page: 'labs/library/', label: 'Library Lab', about: 'The clip library: search it, play a clip on the mannequin and the hero, mirror it, step its frames.' }, // prettier-ignore
];

/** Whether the page at `here` is the one file opened from disk, which holds only the playground. */
export const fromFile = (here: string): boolean => new URL(here).protocol === 'file:';

/** The link to the engine's page `page` (`labs/box/`) with `query` (`?scene=…`, or ''), from the playground `here`. */
export function pageUrl(page: string, here: string, query = ''): string {
  return fromFile(here) ? new URL(`${page}${query}`, DEV_SERVER).href : new URL(`../../${page}${query}`, here).href;
}

/** What to run for a page's link to open, in plain words, from the playground at `here`; undefined where it opens. */
export function awayNote(here: string): string | undefined {
  if (!fromFile(here)) return undefined;
  return `playground.html holds only the playground: this page is the repository's. In a checkout of it run npm run dev (on its default port, with no PORT set), then this opens at ${DEV_SERVER}.`; // prettier-ignore
}

/**
 * The items of Tools' pages screen from the playground at `here`, each page by its name (its id the page's path); from
 * playground.html, first a line no cursor rests on saying what to run, so it shows however short the window is.
 */
export function pageItems(here: string): { label: string; id?: string; disabled?: boolean }[] {
  const note = fromFile(here) ? [{ label: 'Not in playground.html: run npm run dev in the repository first', disabled: true }] : []; // prettier-ignore
  return [...note, ...ENGINE_PAGES.map(({ label, page }) => ({ label, id: page }))];
}

/** What the page `page` shows, the line under the menu, from the playground at `here` (from the file, what to run). */
export function pageAbout(page: string, here: string): string {
  const about = ENGINE_PAGES.find((one) => one.page === page)?.about ?? '';
  const away = awayNote(here);
  return away && about ? `${about} ${away}` : about;
}
