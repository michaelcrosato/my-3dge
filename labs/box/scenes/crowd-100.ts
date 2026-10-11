/**
 * @file The crowd at 100, Box 4 (PLAN.md §9.0, WP 5.7): the crowd scene (labs/box/scenes/crowd-1000.ts) with 100
 * walkers, slimes and wisps, in four steps of the queue: few enough to follow one by one, and the scene the Box 4
 * replays play (tests/replays/box-4-*.replay.json), so they run quickly in the rendering page too. Its settings are
 * the crowd's (`box.crowd.*`), the count 100 unless set.
 *
 * Game code, sim-side: it imports only engine/sim-api.ts and the box's own files.
 *
 * @example
 * // node x sim labs/box/scenes/crowd-100 --steps 600
 * // http://127.0.0.1:5173/labs/box/?scene=crowd-100&cam3=chase
 * @see labs/box/scenes/crowd-1000.test.ts
 */
import { defineScene } from '../../../engine/sim-api';
import { setupCrowd, type CrowdComponents } from './crowd-1000';

/** The crowd at 100. */
export const crowd100 = defineScene<CrowdComponents>('box:crowd-100', {
  description:
    'Box 4: the hall with its hero and a crowd of 100 walkers, slimes and wisps that chase him round the pillars and up the stairs.',
  level: 'level:hall',
  physics: true,
  settings: { 'box.crowd.count': 100 },
  setup(w) {
    setupCrowd(w);
  },
});

export default crowd100;
