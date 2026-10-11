/**
 * @file Tests for the nav-1000 fixture (PLAN.md WP 4.3): its level is the hall, character for character; runs agree
 * hash for hash; navigation is derived data, so a capture restores and continues exactly; agents stay on open tiles
 * and close in on the target. Its budget: `node x perf fixtures/scenes/nav-1000 --budget`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSession } from '../../../engine/sim/scene';
import { getLevel } from '../../../engine/world/level/level';
import { NavGrid } from '../../../engine/world/nav';
import scene, { NAV_1000_LEVEL, targetAt } from './index';
import { HALL_TEXT } from './hall';

/** Steps a new session `steps` times and returns it. */
function run(steps: number) {
  const session = createSession(scene, { seed: 1 });
  for (let k = 0; k < steps; k++) session.step();
  return session;
}

describe('the nav-1000 fixture', () => {
  it('walks the hall, character for character', () => {
    const file = readFileSync(join(import.meta.dirname, '../../../labs/box/levels/hall.txt'), 'utf8');
    expect(HALL_TEXT, 'copy labs/box/levels/hall.txt into fixtures/scenes/nav-1000/hall.ts').toBe(file);
    expect(scene.level).toBe(NAV_1000_LEVEL);
  });

  it('gives the same hashes on every run', () => {
    const [a, b] = [run(0), run(0)];
    for (let k = 1; k <= 120; k++) {
      a.step();
      b.step();
      if (k % 40 === 0) expect(a.world.hash(), `step ${k}`).toBe(b.world.hash());
    }
  });

  it('restores a capture and continues exactly: navigation is never saved', () => {
    const session = run(90);
    const capture = session.capture();
    for (let k = 0; k < 60; k++) session.step();
    const later = session.world.hash();
    session.restore(capture);
    for (let k = 0; k < 60; k++) session.step();
    expect(session.world.hash()).toBe(later);
  });

  it('keeps agents on open tiles, closing in on the target', () => {
    const grid = new NavGrid(getLevel(NAV_1000_LEVEL));
    const near = (session: ReturnType<typeof run>) => {
      const target = targetAt(session.world.tick, session.world.dt);
      const field = grid.flowField(grid.nearestOpen(target.x, target.z));
      const agents = session.world.query('navAgent').map((e) => e.navAgent as { x: number; z: number });
      expect(agents.filter((a) => !grid.open[grid.cellAt(a.x, a.z)])).toEqual([]);
      return agents.filter((a) => field.distanceAt(a.x, a.z) < 5).length;
    };
    const session = run(0);
    expect(session.world.count).toBe(1000);
    const before = near(session);
    for (let k = 0; k < 300; k++) session.step();
    expect(near(session)).toBeGreaterThan(5 * before);
  });
});
