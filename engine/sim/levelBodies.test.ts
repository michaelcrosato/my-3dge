/**
 * @file Tests for the level bodies (engine/sim/levelBodies.ts): fixtures/levels/room.txt's bodies are solid exactly
 * on its solid grid (at each tile's centre and near its corners), stand as high as each tile's top, rest on a ground
 * slab one tile wider than the map, and enter Rapier the same way every time.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hashNumbers } from '../core/hash';
import { createSettings } from '../core/settings';
import { createPhysics } from '../physics/world';
import { compileLevel } from '../world/level/compile';
import { addLevelBodies, LEVEL_FRICTION } from './levelBodies';

const ROOM = compileLevel(readFileSync(join(import.meta.dirname, '../../fixtures/levels/room.txt'), 'utf8'), {
  file: 'room.txt',
});

/** A physics world holding the room's bodies, stepped once so queries see them. */
function room() {
  const physics = createPhysics();
  const id = addLevelBodies(physics, ROOM);
  physics.step({ dt: 1 / 60, settings: createSettings().sim });
  return { physics, id };
}

describe("fixtures/levels/room.txt's level bodies", () => {
  it('are one fixed body: the ground slab and one box per merged collider', () => {
    const { physics, id } = room();
    expect([physics.bodies(), physics.readBody(id).type]).toEqual([[id], 'fixed']);
    expect(ROOM.colliders.length).toBeGreaterThan(3);
    expect(LEVEL_FRICTION).toBe(0.6);
    physics.dispose();
  });

  it('match its solid grid: solid at every solid tile, and nowhere else above the ground', () => {
    const { physics } = room();
    const t = ROOM.tile;
    const inset = 0.05 * t;
    const solid: boolean[] = [];
    for (let r = 0; r < ROOM.rows; r++) {
      for (let c = 0; c < ROOM.cols; c++) {
        const points = [
          [(c + 0.5) * t, (r + 0.5) * t],
          [c * t + inset, r * t + inset],
          [(c + 1) * t - inset, r * t + inset],
          [c * t + inset, (r + 1) * t - inset],
          [(c + 1) * t - inset, (r + 1) * t - inset],
        ];
        const hits = points.map(([x, z]) => physics.overlap({ type: 'ball', radius: 0.01 }, [x, 0.05, z]).length > 0);
        expect(new Set(hits).size, `tile ${c}, ${r}: solid at some points only`).toBe(1);
        solid.push(hits[0]);
      }
    }
    expect(solid).toEqual(ROOM.solid);
    expect(solid.filter(Boolean).length).toBeGreaterThan(40);
    physics.dispose();
  });

  it('stand as high as each tile’s top, on a ground slab one tile wider than the map', () => {
    const { physics, id } = room();
    const t = ROOM.tile;
    for (let r = 0; r < ROOM.rows; r++) {
      for (let c = 0; c < ROOM.cols; c++) {
        const ground = physics.probe((c + 0.5) * t, (r + 0.5) * t);
        const i = r * ROOM.cols + c;
        expect(ground?.y, `tile ${c}, ${r}`).toBeCloseTo(ROOM.solid[i] ? ROOM.top[i] : ROOM.floor[i], 5);
        expect(ground?.body).toBe(id);
      }
    }
    expect(physics.probe(-0.5 * t, -0.5 * t)?.y).toBeCloseTo(0, 5); // the slab's rim, outside the map
    expect(physics.probe(-1.5 * t, 0)).toBeNull();
    expect(physics.probe(0.5 * t, 0.5 * t, { from: 0.5 })?.y).toBe(0.5); // inside a wall: struck at once
    physics.dispose();
  });

  it('enter Rapier the same way every time', () => {
    const states = [room(), room()].map(({ physics }) => {
      const state = hashNumbers(physics.state());
      physics.dispose();
      return state;
    });
    expect(states[0]).toBe(states[1]);
  });
});
