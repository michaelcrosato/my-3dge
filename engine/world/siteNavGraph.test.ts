/**
 * @file Unit tests for engine/world/siteNavGraph.ts (T1) on the fixture site (fixtures/levels/storeys/site.ts): a lazy
 * field answers `direction`, `crouch` and `rise` exactly as the full one, from every open node, in any order of reads,
 * having flooded only as far as they read; a full flood is the same whatever lazy ones ran between; and
 * engine/world/siteNav.ts's `createSiteNav` gives a navigation made before for the same options, the last `KEPT`.
 * @see engine/world/siteNavGraph.ts
 */
import { describe, expect, it } from 'vitest';
import { defineFixtureSite } from '../../fixtures/levels/storeys/site';
import { createRegistry } from '../core/registry';
import { Rng } from '../core/rng';
import { createSiteNav } from './siteNav';

const site = defineFixtureSite(createRegistry());
const nav = createSiteNav(site, { climb: 0.5 });
/** Every open node's centre, a little over its floor. */
const OPEN = Array.from({ length: nav.nodes }, (_, node) => node)
  .filter((node) => {
    const { grid, tile } = nav.locate(node);
    return grid.grid.open[tile];
  })
  .map((node) => nav.center(node).toArray() as [number, number, number]);
/** What the searches answer from `at` down `field`. */
const answers = (field: Float64Array, at: [number, number, number]) => [
  nav.direction(field, ...at)?.toArray() ?? null,
  nav.crouch(field, ...at, 2),
  nav.rise(field, ...at),
];
const finite = (field: Float64Array) => field.filter((d) => d < Infinity).length;

describe('the searches over a site’s graph', () => {
  it('answer on a lazy field exactly as on the full one, from every open node in any order, flooding only as far as read', () => {
    const rng = new Rng(7);
    for (const goal of [OPEN[0], OPEN[Math.floor(OPEN.length / 2)], OPEN.at(-1)!]) {
      const [full, lazy] = [nav.flowField(goal), nav.flowField(goal, { lazy: true })];
      expect(finite(lazy)).toBe(1); // nothing flooded before a read: only the goal
      const near = OPEN.find((at) => at !== goal && full[nav.nodeAt(...at)] < 3)!;
      expect(answers(lazy, near)).toEqual(answers(full, near));
      expect(finite(lazy)).toBeLessThan(finite(full)); // a reader near the goal floods a little way
      const order = OPEN.map((at) => [rng.next(), at] as const).sort((a, b) => a[0] - b[0]);
      for (const [, at] of order) expect([at, ...answers(lazy, at)]).toEqual([at, ...answers(full, at)]);
    }
  });

  it('floods a full field the same whatever lazy ones ran between', () => {
    const goal = OPEN[5];
    const before = nav.flowField(goal);
    const lazy = nav.flowField(OPEN[9], { lazy: true });
    nav.direction(lazy, ...OPEN[40]);
    expect(nav.flowField(goal)).toEqual(before);
    expect(nav.findPath(OPEN[40], OPEN[9])).toEqual(nav.findPath(OPEN[40], OPEN[9]));
  });

  it('is made once for the same options, kept the last 4 asked for', () => {
    const block = (x: number) => ({ min: [x, 0, 0] as const, max: [x + 1, 1, 1] as const });
    expect(createSiteNav(site, { climb: 0.5 })).toBe(nav);
    expect(createSiteNav(site, { climb: 0.5, blocked: [block(1)] })).not.toBe(nav);
    expect(createSiteNav(site, { climb: 0.5, blocked: [block(1)] })).toBe(createSiteNav(site, { climb: 0.5, blocked: [block(1)] })); // prettier-ignore
    for (const x of [2, 3, 4, 5]) createSiteNav(site, { climb: 0.5, blocked: [block(x)] });
    expect(createSiteNav(site, { climb: 0.5 })).not.toBe(nav); // pushed out by four others
    expect(createSiteNav(site, { climb: 0.5, blocked: [block(-0)] })).not.toBe(createSiteNav(site, { climb: 0.5, blocked: [block(0)] })); // prettier-ignore
  });
});
