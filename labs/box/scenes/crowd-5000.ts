/**
 * @file The crowd at 5,000, Box 4 (PLAN.md §9.0, WP 5.7): the crowd scene (labs/box/scenes/crowd-1000.ts) with 5,000
 * walkers, slimes and wisps, 25 entering a step, so the hall fills over 200 steps: the top of the perf ladder, and
 * the page that shows the crowd grows to 5,000 with no pipeline built (tests/e2e/box-crowd.spec.ts). Its settings are
 * the crowd's (`box.crowd.*`), the count 5,000 unless set.
 *
 * Game code, sim-side: it imports only engine/sim-api.ts and the box's own files.
 *
 * @example
 * // node x sim labs/box/scenes/crowd-5000 --steps 300
 * // http://127.0.0.1:5173/labs/box/?scene=crowd-5000&cam=iso
 * @see labs/box/scenes/crowd-1000.test.ts
 */
import { defineScene } from '../../../engine/sim-api';
import { setupCrowd, type CrowdComponents } from './crowd-1000';
import { boxSounds } from '../sounds/events';
import { HALL_LEVEL } from './hall';

/** The crowd at 5,000. */
export const crowd5000 = defineScene<CrowdComponents>('box:crowd-5000', {
  description:
    'Box 4: the hall with its hero filling with a crowd of 5,000 walkers, slimes and wisps, 25 entering a step, that chase him.',
  level: 'level:hall',
  sounds: boxSounds(HALL_LEVEL),
  physics: true,
  settings: { 'box.crowd.count': 5000 },
  setup(w) {
    setupCrowd(w);
  },
});

export default crowd5000;
