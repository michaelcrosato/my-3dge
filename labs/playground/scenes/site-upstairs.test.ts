/**
 * @file The bot through the house's upper floor and attic (PLAN.md WP 13.18, gate G11; engine/dev/bot.ts on labs/playground/scenes/site.ts):
 * from the front yard's spawn it reaches each of their rooms, opening the doors on its way, up the flights and down
 * them (up the attic's ladder and down through its hatch), and comes back within a metre of where it started. The rooms run in two files, downstairs and upstairs, so the test workers share them.
 * @see labs/playground/scenes/site.ts
 */
import { describe, expect, it } from 'vitest';
import { runBot } from '../../../engine/dev/bot';
import { createSession } from '../../../engine/sim/session';
import { toWorld } from '../../../engine/sim-api';
import { SITE, SITE_STRUCTURES } from '../levels/site';
import { SITE_SCENES, areaStart } from './site';

const HOUSE = SITE.structures[Object.keys(SITE_STRUCTURES).indexOf('house')];
const START = areaStart('frontyard');

describe('the bot upstairs', () => {
  for (const room of HOUSE.level.rooms!.filter((r) => [2, 3].includes(r.storey))) {
    it(`reaches the ${room.name} (${HOUSE.level.storeys![room.storey].name}) from the front yard and back`, () => {
      const [x, z] = toWorld(HOUSE, room.position[0], room.position[2]);
      const goal = { x, y: room.position[1] + HOUSE.at[1], z };
      const report = runBot(createSession(SITE_SCENES.frontyard, { seed: 1 }), SITE, { to: [goal], back: true, steps: 6000, climb: 0.5 }); // prettier-ignore
      expect([report.status, report.reason, report.reached]).toEqual(['arrived', null, 2]);
      expect(Math.hypot(report.at[0] - START[0], report.at[2] - START[2])).toBeLessThan(1);
    }, 120_000);
  }
});
