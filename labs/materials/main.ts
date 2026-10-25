/**
 * @file The Materials Lab (PLAN.md WP 10.8): every material the repository registers on the gallery's cube, and every
 * look over the gallery's set (a crate, a barrel, three cubes and a figure), one at a time (labs/index/gallery.ts),
 * with the entry as `x describe` prints it. A look changes the materials' style and the filter chain, so the two kinds
 * are compared on one page.
 *
 * The same job without the page: `node x gallery material` and `node x gallery look` film every entry onto a contact
 * sheet (`--look <id>` draws every material in one look), and `node x describe material <id>` prints one.
 *
 * @example
 * // labs/materials/#gallery/look/look:playground-pixel
 * @see tests/e2e/labs.spec.ts
 */
import { galleryLab } from '../index/gallery';

await galleryLab(document, window, {
  title: 'Materials Lab',
  what: 'Every material on its cube, and every look over its set of things: pick one; its link is the address.',
  command: 'node x gallery material · node x gallery look',
  kinds: ['material', 'look'],
});
