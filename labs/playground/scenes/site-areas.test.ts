/**
 * @file The bot over the block (PLAN.md WP 13.18, gate G11; engine/dev/bot.ts on labs/playground/scenes/site.ts): from
 * the front yard's spawn it reaches every other area's spawn (labs/playground/levels/site.ts `SITE_AREAS`: the hall,
 * the backyard, the street, the gym through its gates, the hill's foot, the range behind its counter, the foot of the
 * ring's steps) across the yards, the street and the terrain, and comes back within a metre of where it started.
 * @see labs/playground/scenes/site.ts
 */
import { describe, expect, it } from 'vitest';
import { runBot } from '../../../engine/dev/bot';
import { createSession } from '../../../engine/sim/session';
import { SITE, SITE_AREAS, type SiteArea } from '../levels/site';
import { SITE_SCENES, areaStart } from './site';

const START = areaStart('frontyard');

describe('the bot outdoors', () => {
  for (const area of (Object.keys(SITE_AREAS) as SiteArea[]).filter((a) => a !== 'frontyard')) {
    it(`reaches ${SITE_AREAS[area].what} from the front yard and back`, () => {
      const [x, y, z] = areaStart(area);
      const report = runBot(createSession(SITE_SCENES.frontyard, { seed: 1 }), SITE, { to: [{ x, y, z }], back: true, steps: 6000, climb: 0.5 }); // prettier-ignore
      expect([report.status, report.reason, report.reached]).toEqual(['arrived', null, 2]);
      expect(Math.hypot(report.at[0] - START[0], report.at[2] - START[2])).toBeLessThan(1);
    }, 120_000);
  }
});
