/**
 * @file Tests for the level bodies (engine/sim/levelBodies.ts): fixtures/levels/room.txt's bodies are solid exactly
 * on its solid grid (at each tile's centre and near its corners), stand as high as each tile's top, rest on a ground
 * slab one tile wider than the map, and enter Rapier the same way every time; a brazier is a cylinder as high and as
 * wide as its glyph says; the hall's hulls (its stairs and the dais) stand within 1 cm of floorHeight, probed. A level
 * written as storeys (WP 13.13, fixtures/levels/storeys/): the bodies stand each storey's floors where floorBelow says;
 * the controller walks up the house's flights from the cellar to the upper floor, and stands on the gable's slope and
 * on the shed's flat roof. A terrain (WP 10.5): its body stands where terrainHeight says, and the controller walks up
 * a hillside and down it again on the ground.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defineStoreyFixtureGlyphs } from '../../fixtures/levels/storeys/glyphs';
import { hashNumbers } from '../core/hash';
import { createRegistry } from '../core/registry';
import { createSettings } from '../core/settings';
import { physicsOf } from '../physics/binding';
import { createCharacter } from '../physics/character';
import { createPhysics } from '../physics/world';
import { compileLevel } from '../world/level/compile';
import { floorBelow, floorHeight } from '../world/level/heights';
import { roofHeight } from '../world/level/roofs';
import type { CompiledLevel } from '../world/level/types';
import { makeTerrain, terrainHeight, type Terrain } from '../world/terrain';
import { spawnActor } from './actors';
import { addLevelBodies, addTerrainBody, LEVEL_FRICTION } from './levelBodies';
import { defineScene } from './scene';
import { createSession } from './session';

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

describe('cylinders and hulls', () => {
  it("stand a brazier as an upright cylinder, as high and as wide as its glyph's top and radius", () => {
    const level = compileLevel('#####\n#.t.#\n#####\n', { file: 'brazier.txt' });
    const physics = createPhysics();
    addLevelBodies(physics, level);
    physics.step({ dt: 1 / 60, settings: createSettings().sim });
    const [x, z] = [2.5, 1.5];
    expect(physics.probe(x, z)?.y).toBeCloseTo(0.75, 5);
    expect(physics.probe(x + 0.3, z)?.y).toBeCloseTo(0.75, 5); // within its 0.3125 m radius
    expect(physics.probe(x + 0.33, z)?.y).toBeCloseTo(0, 5); // just past it: the floor
    expect(physics.probe(x, z - 0.3)?.y).toBeCloseTo(0.75, 5);
    physics.dispose();
  });

  it("match the hall's ramp and dais heights within 1 cm, probed every 25 cm", () => {
    const hall = compileLevel(readFileSync(join(import.meta.dirname, '../../labs/box/levels/hall.txt'), 'utf8'), {
      file: 'labs/box/levels/hall.txt',
    });
    const physics = createPhysics();
    addLevelBodies(physics, hall);
    physics.step({ dt: 1 / 60, settings: createSettings().sim });
    const areas = [...hall.ramps.map((ramp) => ramp.tiles), ...hall.daises.map((dais) => dais.tiles)];
    let [probes, worst] = [0, 0];
    for (const [c0, r0, c1, r1] of areas) {
      // Each area and a tile round it (the dais's base reaches past its tiles), off the tile edges.
      for (let x = c0 - 1 + 0.125; x < c1 + 2; x += 0.25) {
        for (let z = r0 - 1 + 0.125; z < r1 + 2; z += 0.25) {
          const tile = hall.tiles[Math.floor(z) * hall.cols + Math.floor(x)];
          if (hall.legend[tile].solid || hall.legend[tile].collider === 'box') continue; // walls and the gallery
          const hit = physics.probe(x, z);
          worst = Math.max(worst, Math.abs((hit?.y ?? Number.NaN) - floorHeight(hall, x, z)));
          probes++;
        }
      }
    }
    expect(probes).toBeGreaterThan(2000);
    expect(worst).toBeLessThanOrEqual(0.01);
    physics.dispose();
  });

  it('stand every tile of the hall at its height, to Rapier’s single precision: solid tops, floors, galleries', () => {
    const hall = compileLevel(readFileSync(join(import.meta.dirname, '../../labs/box/levels/hall.txt'), 'utf8'));
    const physics = createPhysics();
    addLevelBodies(physics, hall);
    physics.step({ dt: 1 / 60, settings: createSettings().sim });
    const heights = hall.top.map((_, i) => physics.probe((i % hall.cols) + 0.5, Math.floor(i / hall.cols) + 0.5)?.y);
    expect(heights.map((y, i) => Math.abs((y ?? Number.NaN) - hall.top[i]) <= 1e-3)).toEqual(hall.top.map(() => true));
    physics.dispose();
  });
});

/** The storey fixtures, compiled with their room markers. */
const STOREYS = (() => {
  const registry = createRegistry();
  defineStoreyFixtureGlyphs(registry);
  const read = (name: string) =>
    compileLevel(readFileSync(join(import.meta.dirname, `../../fixtures/levels/storeys/${name}.txt`), 'utf8'), { file: `${name}.txt`, registry }); // prettier-ignore
  return { house: read('house'), shed: read('shed'), pavilion: read('pavilion'), annex: read('annex') };
})();

/** A session of `level`'s bodies with a player at `at` (the default character: 0.28 m round, 1.69 m tall). */
function onLevel(id: string, level: CompiledLevel, at: [number, number, number]) {
  const scene = defineScene(id, {
    physics: true,
    setup(w) {
      addLevelBodies(physicsOf(w), level);
      spawnActor(w, { at, character: createCharacter({}) });
    },
  });
  const session = createSession(scene, { seed: 1 });
  const feet = () => (session.world.query('actor') as unknown as { actor: { x: number; y: number; z: number } }[])[0].actor; // prettier-ignore
  return { session, feet };
}

describe('a level written as storeys (fixtures/levels/storeys/, WP 13.13)', () => {
  it("stands every fixture's floors, heads and roofs where floorBelow says, probed from each storey's heights", () => {
    const heights = [-2.5, -1, 0.5, 1.5, 2.5, 3.5, 4.5, 6.5, 7.5, 50];
    for (const [name, level] of Object.entries(STOREYS)) {
      const physics = createPhysics();
      addLevelBodies(physics, level);
      physics.step({ dt: 1 / 60, settings: createSettings().sim });
      let [worst, probes] = [0, 0];
      for (let i = 0; i < level.cols * level.rows * 4; i++) {
        // Two points a tile each way, never on a tile's edge, where either side's collider could answer.
        const [c, r, f, g] = [(i >> 2) % level.cols, Math.floor((i >> 2) / level.cols), i & 1 ? 0.74 : 0.26, i & 2 ? 0.74 : 0.26]; // prettier-ignore
        const [x, z] = [(c + f) * level.tile, (r + g) * level.tile];
        for (const y of heights) {
          const hit = physics.probe(x, z, { from: y });
          if (hit?.y === y) continue; // the ray starts inside a solid
          const below = floorBelow(level, x, y, z);
          worst = Math.max(
            worst,
            hit && below !== null ? Math.abs(hit.y - below) : hit || below !== null ? Infinity : 0,
          );
          probes++;
        }
      }
      expect([name, worst < 1e-3, probes > 1000]).toEqual([name, true, true]);
      physics.dispose();
    }
  });

  it("walks up the cellar's flight to the kitchen floor, 3 m up its open stairwell", () => {
    const { session, feet } = onLevel('storeys-test:cellar', STOREYS.house, [7, -3, 5.25]);
    for (let i = 0; i < 150; i++) session.step({ move: [0, -1] });
    expect(feet().y).toBeCloseTo(0, 2);
    expect(feet().z).toBeLessThan(1);
  });

  it("walks up the hall's flight from the ground floor to the upper floor's landing", () => {
    const { session, feet } = onLevel('storeys-test:flight', STOREYS.house, [1, 0, 5.4]);
    for (let i = 0; i < 150; i++) session.step({ move: [0, -1] });
    expect(feet().y).toBeCloseTo(3, 2);
    expect(feet().z).toBeLessThan(1);
  });

  it("stands on the gable's 35° slope, and on the shed's flat roof", () => {
    const roof = STOREYS.house.roofs![0];
    const slope = onLevel('storeys-test:gable', STOREYS.house, [4, 7.5, 1.5]);
    for (let i = 0; i < 120; i++) slope.session.step({});
    const at = slope.feet();
    // Its feet (the capsule's lowest point on its axis) rest r (1 / cos 35° − 1) + its skin above the slope: 8 cm.
    expect(at.y - roofHeight(roof, at.x, at.z)).toBeGreaterThan(0);
    expect(at.y - roofHeight(roof, at.x, at.z)).toBeLessThan(0.1);
    expect(Math.hypot(at.x - 4, at.z - 1.5)).toBeLessThan(0.1); // it stays put: 35° is under its 40° slide
    const flat = onLevel('storeys-test:shed', STOREYS.shed, [1.5, 4, 2]);
    for (let i = 0; i < 120; i++) flat.session.step({});
    expect(flat.feet().y).toBeCloseTo(2.7, 2);
  });
});

describe('a terrain’s body (WP 10.5)', () => {
  // A hillside rising east to 6 m over 20 m (about 20° on its flank), with gentle noise, from a corner off the origin.
  const HILL: Terrain = makeTerrain({ size: [32, 16], origin: [-6, 1, -8], seed: 2, height: 0.4, scale: 12, hills: [{ at: [26, 0], radius: 24, height: 6 }] }); // prettier-ignore

  it('stands the terrain where terrainHeight says, one fixed body', () => {
    const physics = createPhysics();
    const id = addTerrainBody(physics, HILL);
    physics.step({ dt: 1 / 60, settings: createSettings().sim });
    expect([physics.bodies(), physics.readBody(id).type]).toEqual([[id], 'fixed']);
    let worst = 0;
    for (let x = -5.9; x < 26; x += 0.37) {
      for (let z = -7.9; z < 8; z += 0.41) {
        worst = Math.max(worst, Math.abs(physics.probe(x, z)!.y - terrainHeight(HILL, x, z)!));
      }
    }
    expect(worst).toBeLessThan(2e-4); // a float32 ray from 1 km up
    physics.dispose();
  });

  it('carries the controller up the hillside and down it again, on the ground', () => {
    const scene = defineScene('terrain-test:hillside', {
      physics: true,
      setup(w) {
        addTerrainBody(physicsOf(w), HILL);
        spawnActor(w, { at: [-4, terrainHeight(HILL, -4, 0)!, 0], character: createCharacter({}) });
      },
    });
    const session = createSession(scene, { seed: 1 });
    const feet = () => (session.world.query('actor') as unknown as { actor: { x: number; y: number; z: number } }[])[0].actor; // prettier-ignore
    const onGround = () => feet().y - terrainHeight(HILL, feet().x, feet().z)!;
    const [up, down] = [
      [Infinity, -Infinity],
      [Infinity, -Infinity],
    ];
    for (let i = 0; i < 300; i++) {
      session.step({ move: [1, 0] });
      if (i > 30) [up[0], up[1]] = [Math.min(up[0], onGround()), Math.max(up[1], onGround())];
    }
    const top = { ...feet() };
    expect(top.x).toBeGreaterThan(15);
    expect(top.y).toBeGreaterThan(4);
    for (let i = 0; i < 300; i++) {
      session.step({ move: [-1, 0] });
      [down[0], down[1]] = [Math.min(down[0], onGround()), Math.max(down[1], onGround())];
    }
    expect(feet().x).toBeLessThan(0);
    // Up it, the feet rest on the slope: the capsule's r (1 / cos θ − 1) and its 2 cm skin, under 7 cm. Running down a
    // 23° stretch at 6 m/s the controller's across-then-down move hops it up to 13 cm off (measured); never under it.
    expect([up[0], up[1]].map((v) => v >= -0.01 && v < 0.07)).toEqual([true, true]);
    expect([down[0], down[1]].map((v) => v >= -0.01 && v < 0.15)).toEqual([true, true]);
  });
});
