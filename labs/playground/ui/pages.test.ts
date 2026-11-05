/**
 * @file Unit tests for labs/playground/ui/pages.ts (WP 13.38): Tools lists the Stress Box and the seven labs of
 * labs/labs.json by their titles, each a page the repository has; from the dev server a page's link stands beside the
 * playground, and from playground.html (file:, on Linux or Windows) it is the dev server's, the screen and the line
 * under it saying in plain words to run npm run dev first.
 * @see labs/playground/ui/pages.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { awayNote, DEV_SERVER, ENGINE_PAGES, pageAbout, pageItems, pageUrl } from './pages';

/** The repository's root. */
const ROOT = new URL('../../../', import.meta.url).pathname;

/** The playground's page on the dev server, and the one file opened from disk, on Linux and on Windows. */
const HERE = 'http://127.0.0.1:5173/labs/playground/';
const FILES = ['file:///home/me/my-3dge/playground.html', 'file:///C:/Users/me/Downloads/playground.html'];

/** labs/labs.json's entries, by page: its title. */
const LABS = JSON.parse(readFileSync(`${ROOT}labs/labs.json`, 'utf8')) as { sections: { id: string; entries: { page: string; title: string }[] }[] }; // prettier-ignore
const titles = (section: string) => LABS.sections.find((one) => one.id === section)!.entries.map((entry) => [`labs/${entry.page}/`, entry.title]); // prettier-ignore

describe('the engine’s pages beside the playground', () => {
  it('lists the Stress Box and every lab of labs.json by its title, each a page the repository has', () => {
    const listed = Object.fromEntries(ENGINE_PAGES.map((one) => [one.page, one.label]));
    expect(listed).toMatchObject(Object.fromEntries([titles('pages')[0], ...titles('keep')]));
    expect(ENGINE_PAGES[0].label).toBe('The Stress Box');
    expect(ENGINE_PAGES.map((one) => one.page)).toContain('labs/index/');
    for (const { page, about } of ENGINE_PAGES) {
      expect(existsSync(`${ROOT}${page}index.html`), page).toBe(true);
      expect(about.length, page).toBeGreaterThan(0);
    }
  });

  it('links a page beside the playground on the dev server, and the dev server’s from playground.html', () => {
    expect(pageUrl('labs/box/', HERE, '?scene=crowd-5000')).toBe('http://127.0.0.1:5173/labs/box/?scene=crowd-5000');
    expect(pageUrl('labs/index/', `${HERE}?scene=site#x`)).toBe('http://127.0.0.1:5173/labs/index/');
    for (const file of FILES) {
      expect(pageUrl('labs/box/', file, '?scene=crowd-5000'), file).toBe(`${DEV_SERVER}labs/box/?scene=crowd-5000`);
      expect(awayNote(file), file).toMatch(/npm run dev/);
    }
    expect(awayNote(HERE)).toBeUndefined();
  });

  it('says what to run on the screen itself from playground.html, and nothing more on the dev server', () => {
    const served = pageItems(HERE);
    expect(served.filter((item) => item.disabled)).toEqual([]);
    expect(served.map((item) => item.id)).toEqual(ENGINE_PAGES.map((one) => one.page));
    const [note, ...rest] = pageItems(FILES[0]);
    expect(note).toMatchObject({ disabled: true, label: expect.stringMatching(/npm run dev/) });
    expect(rest).toEqual(served);
    expect(pageAbout('labs/box/', HERE)).toBe(ENGINE_PAGES[0].about);
    expect(pageAbout('labs/box/', FILES[0])).toMatch(/^A scene for each .* npm run dev, then this opens at http:\/\/127\.0\.0\.1:5173\/\.$/); // prettier-ignore
  });
});
