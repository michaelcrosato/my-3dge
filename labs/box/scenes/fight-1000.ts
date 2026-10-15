/**
 * @file The fight at 1,000, Box 5 (PLAN.md §9.0, WP 6.7): the fight (labs/box/scenes/fight.ts) against a crowd of
 * 1,000 walkers, slimes and wisps, entering 25 a step: the hero's attack tokens still let only three swing and pounce
 * at once, so it is the crowd's, the hits' and the effects' cost that grows, not the danger. Its settings are the
 * fight's, the count 1,000 unless set.
 *
 * Game code, sim-side: it imports only engine/sim-api.ts and the box's own files.
 *
 * @example
 * // node x sim labs/box/scenes/fight-1000 --steps 600
 * // http://127.0.0.1:5173/labs/box/?scene=fight-1000&cam3=chase
 * @see labs/box/scenes/fight.test.ts
 */
import { defineScene } from '../../../engine/sim-api';
import { fightStep, setupFight } from './fight';
import type { FightComponents, FightEvents } from './fight-rules';
import { boxSounds } from '../sounds/events';
import { HALL_LEVEL } from './hall';

/** The fight at 1,000. */
export const fight1000 = defineScene<FightComponents, FightEvents>('box:fight-1000', {
  description:
    'Box 5: the hall, its hero with a sword, and a crowd of 1,000 walkers, slimes and wisps fighting him, three at a time.',
  level: 'level:hall',
  sounds: boxSounds(HALL_LEVEL),
  physics: true,
  settings: { 'box.crowd.count': 1000 },
  setup(w) {
    setupFight(w);
  },
  step: fightStep,
});

export default fight1000;
