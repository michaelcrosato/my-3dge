/**
 * @file The Effects Lab (PLAN.md WP 10.8): every emitter the repository registers (particle effects as data), burst
 * on the gallery's stage again and again as it plays in a game, one at a time (labs/index/gallery.ts), with the entry
 * as `x describe` prints it: how its particles start, move and look.
 *
 * The same job without the page: `node x gallery emitter` films each burst at its fullest onto a contact sheet, and
 * `node x describe emitter <id>` prints one.
 *
 * @example
 * // browser
 * // labs/fx/#gallery/emitter/emitter:fire
 * @see tests/e2e/labs.spec.ts
 */
import { galleryLab } from '../index/gallery';

await galleryLab(document, window, {
  title: 'Effects Lab',
  what: 'Every emitter burst again and again where the subject would stand: pick one; its link is the address.',
  command: 'node x gallery emitter',
  kinds: ['emitter'],
});
