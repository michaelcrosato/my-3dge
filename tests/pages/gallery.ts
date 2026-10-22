/**
 * @file The gallery's page (tests/pages/gallery.html; PLAN.md WP 7.7): every entry the repository registers, so `x
 * gallery` films them all by default. It imports every lab's scenes, looks and bodies, as their pages do (Vite's
 * `import.meta.glob`, each module registering what it defines), defines the mannequin from the Quaternius set's
 * `_set.json` (engine/gfx/puppets/bodies/mannequin.ts; that set is CC0, so the page owes no credit), then starts the
 * engine on the gallery's scene (engine/dev/gallery.ts) on the entry its hash names, `#gallery/<kind>/<id>`, or the
 * first kind's first entry without one.
 *
 * @example
 * // node x gallery body (this page by default), or open tests/pages/gallery.html#gallery/prop/prop:chair
 * @see tests/e2e/gallery.spec.ts
 */
import { createEngine } from '../../engine';
import { defineMannequin } from '../../engine/gfx/puppets/bodies/mannequin';
import quaternius from '../../data/anim/sets/quaternius/_set.json?raw';

import.meta.glob(['../../labs/*/{scenes,looks,bodies}/*.ts', '!../../labs/**/*.test.ts'], { eager: true });
defineMannequin(JSON.parse(quaternius) as Parameters<typeof defineMannequin>[0]);

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
await createEngine({ canvas, scenes: [], hash: location.hash || '#gallery' });
