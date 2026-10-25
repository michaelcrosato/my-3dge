/**
 * @file The Props Lab (PLAN.md WP 10.8): every prop the repository registers, standing on the gallery's stage as play
 * stands it (on the floor, or hung 1.2 m up when it has no body), one at a time (labs/index/gallery.ts), with the
 * entry as `x describe` prints it: its meshes, its body, its light spot.
 *
 * The same job without the page: `node x gallery prop` films every prop from four sides onto a contact sheet, and
 * `node x describe prop <id>` prints one.
 *
 * @example
 * // labs/props/#gallery/prop/prop:crate
 * @see tests/e2e/labs.spec.ts
 */
import { galleryLab } from '../index/gallery';

await galleryLab(document, window, {
  title: 'Props Lab',
  what: 'Every prop where it stands, turned on the gallery’s stage: pick one; its link is the address.',
  command: 'node x gallery prop',
  kinds: ['prop'],
});
