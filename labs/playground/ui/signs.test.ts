/**
 * @file The gym's signs (labs/playground/ui/signs.ts, WP 13.38): on the block a sign shows only while the player stands
 * in the gym, and within `SIGN_RANGE` of him; from the yards and the house, even within that range, none does (their
 * labels draw over everything, so they showed through those walls: the owner's report of 2026-11-03); none under a
 * screen; on the gym's own scene its range alone decides, and with no player every sign shows. The places are the real
 * block's, asked as the page asks them (`siteStructureAt`, 10 cm over the feet).
 * @see labs/playground/ui/signs.ts
 */
import { describe, expect, it } from 'vitest';
import { getSite, siteStructureAt } from '../../../engine/sim-api';
import { GYM_FEATURES } from '../levels/gym';
import { SITE, SITE_STRUCTURES } from '../levels/site';
import { areaStart, roomPlace } from '../scenes/site';
import { SIGN_RANGE, signShown, type SignPlace } from './signs';

const site = getSite('site:block');
const origin = SITE_STRUCTURES.gym.at;
/** Each of the gym's signs where the block stands it. */
const SIGNS = GYM_FEATURES.map(({ id, sign: [x, y, z] }) => ({
  id,
  at: [x + origin[0], y + origin[1], z + origin[2]],
}));
/** Where feet at `at` stand on the block, as the page asks it. */
const on = ([x, y, z]: readonly number[]): SignPlace => ({ gymScene: false, structure: siteStructureAt(site, x, y + 0.1, z)?.structure.name ?? null }); // prettier-ignore
/** The signs within `SIGN_RANGE` of `at`, along the ground. */
const near = ([x, , z]: readonly number[]) => SIGNS.filter((s) => Math.hypot(s.at[0] - x, s.at[2] - z) <= SIGN_RANGE);
/** The house on the block. */
const HOUSE = SITE.structures[Object.keys(SITE_STRUCTURES).indexOf('house')];

describe('the gym’s signs', () => {
  it('shows none from the yards or the house, even within range: its label would show through their walls', () => {
    const kitchen = roomPlace(
      HOUSE,
      HOUSE.level.rooms!.find((room) => room.name === 'kitchen')!,
    ).at;
    const places = { 'front yard': areaStart('frontyard'), backyard: areaStart('backyard'), kitchen };
    expect(Object.values(places).map((at) => on(at).structure)).toEqual([null, null, 'house']);
    const shown: string[] = [];
    for (const [name, at] of Object.entries(places)) {
      expect(near(at).length, name).toBeGreaterThan(0); // signs in range: only where he stands hides them
      for (const sign of near(at)) if (signShown(sign.at, { x: at[0], z: at[2] }, on(at), false)) shown.push(`${name}: ${sign.id}`); // prettier-ignore
    }
    expect(shown).toEqual([]);
  });

  it('shows the signs near him in the gym, not those farther than SIGN_RANGE, and none under a screen', () => {
    const at = areaStart('gym');
    const [player, where] = [{ x: at[0], z: at[2] }, on(at)];
    expect(`level:${where.structure}`).toBe(SITE_STRUCTURES.gym.level);
    const shown = SIGNS.filter((sign) => signShown(sign.at, player, where, false)).map((sign) => sign.id);
    const far = SIGNS.filter((sign) => !near(at).includes(sign)).map((sign) => sign.id);
    expect([shown.length > 0, far.length > 0]).toEqual([true, true]);
    expect(shown).toEqual(near(at).map((sign) => sign.id));
    expect(SIGNS.filter((sign) => signShown(sign.at, player, where, true))).toEqual([]); // photo mode, a menu
  });

  it('on the gym’s own scene shows a sign by its range alone, and with no player every sign', () => {
    const [{ sign }] = GYM_FEATURES; // the gym's own frame: no site, no structure
    expect(signShown(sign, { x: sign[0] + 2, z: sign[2] }, { gymScene: true }, false)).toBe(true);
    expect(signShown(sign, { x: sign[0] + SIGN_RANGE + 1, z: sign[2] }, { gymScene: true }, false)).toBe(false);
    expect(signShown(sign, null, { gymScene: false, structure: 'house' }, false)).toBe(true);
  });
});
