/**
 * @file Tests for props in a running scene (engine/sim/props.ts, PLAN.md WP 4.6 core proposal): `spawnProp` stands a
 * crate on its body (its centre half a crate up, its turn the placement's yaw) and a fire with no body at its pose,
 * also in a scene without physics; `props.readback` copies each body's pose into its component after the physics
 * step, so a falling crate's component is its body's pose at every step; `hitProp` calls the prop's hook, whose knock
 * throws a crate more than 0.25 m away from the hit with the caller's strength, leaves a fixed pillar, and runs a
 * game's own hook; a capture taken while the crate flies restores and continues to the same hashes; `removeProp`
 * removes body and entity; an id that is no prop is refused, naming the call.
 * @see engine/sim/props.ts
 */
import { describe, expect, it } from 'vitest';
import { deserialize, serialize, type Canonical } from '../core/hash';
import { physicsOf } from '../physics/world';
import { defineProp, type PropTouch } from '../world/props/prop';
import type { WorldCapture } from './capture';
import { hitProp, removeProp, spawnProp, type ScenePropComponents } from './props';
import { defineScene, startScene } from './scene';
import type { World } from './world';

/** The yard: a 40 × 40 m floor; a crate at (2, 0, 3) turned 0.4 rad, a pillar at (6, 0, 8), a fire at (0, 0.75, 0). */
defineScene('propsYard', {
  physics: true,
  setup(w) {
    physicsOf(w).addBody({
      type: 'fixed',
      colliders: [{ shape: { type: 'box', size: [40, 1, 40] }, position: [0, -0.5, 0] }],
    });
    spawnProp(w, { prop: 'prop:crate', at: [2, 0, 3], yaw: 0.4 });
    spawnProp(w, { prop: 'prop:pillar', at: [6, 0, 8], yaw: 0 });
    spawnProp(w, { prop: 'prop:brazier', at: [0, 0.75, 0], yaw: 0 });
  },
});

/** A scene with no physics: a fire alone. */
defineScene('propsHearth', {
  setup(w) {
    spawnProp(w, { prop: 'prop:brazier', at: [1, 0.75, 1], yaw: 0 });
  },
});

/** The props of a world, in id order. */
const props = (w: World) => w.query('sceneProp') as unknown as (ScenePropComponents & { id: number })[];

/** Expects the component of `id` to hold its body's pose. */
function expectOnBody(w: World, id: number) {
  const { sceneProp } = w.get(id) as unknown as ScenePropComponents;
  const { position, rotation } = physicsOf(w).readBody(sceneProp.body);
  expect([sceneProp.x, sceneProp.y, sceneProp.z]).toEqual([position.x, position.y, position.z]);
  expect(sceneProp.q).toEqual([rotation.x, rotation.y, rotation.z, rotation.w]);
}

/** The world after `steps` steps, `hit` hitting the crate from 1 m west of it after `at` steps. */
function run(steps: number, at = -1) {
  const { world } = startScene('propsYard');
  for (let i = 0; i < steps; i++) {
    if (i === at) hitProp(world, 1, [1, 0, 3], { spin: world.rng('knock').range(-0.5, 0.5) });
    world.step({});
  }
  return world;
}

describe('props in a scene', () => {
  it('stand on their bodies, a fire at its pose with none, and are read back after the physics step', () => {
    const { world } = startScene('propsYard');
    expect(world.systems.list().map((s) => `${s.phase}:${s.name}`)).toEqual([
      'intents:scene',
      'physics:physics',
      'readback:props.readback',
    ]);
    const [crate, pillar, fire] = props(world);
    expect(crate.sceneProp).toMatchObject({ prop: 'prop:crate', x: 2, y: 0.375, z: 3 });
    expect(crate.sceneProp.q).toEqual([0, Math.sin(0.2), 0, Math.cos(0.2)]);
    expect(physicsOf(world).readBody(crate.sceneProp.body).type).toBe('dynamic');
    expect(physicsOf(world).readBody(pillar.sceneProp.body).type).toBe('fixed');
    expect(fire.sceneProp).toMatchObject({ prop: 'prop:brazier', body: -1, x: 0, y: 0.75, z: 0, q: [0, 0, 0, 1] });
    for (let i = 0; i < 30; i++) world.step({});
    expectOnBody(world, crate.id);
    expect(crate.sceneProp.y).toBeCloseTo(0.375, 2); // resting on the floor
    const hearth = startScene('propsHearth').world;
    hearth.step({});
    expect(props(hearth)[0].sceneProp).toMatchObject({ prop: 'prop:brazier', body: -1, x: 1, y: 0.75, z: 1 });
  });

  it('a hit knocks a crate more than 0.25 m away from it, its component on its body each step; a pillar stands', () => {
    const world = run(10);
    const [crate, pillar] = props(world);
    const before = { ...crate.sceneProp };
    const fixed = { ...pillar.sceneProp };
    hitProp(world, crate.id, [1, 0, 3]);
    hitProp(world, pillar.id, [5, 0, 8]);
    for (let i = 0; i < 20; i++) {
      world.step({});
      expectOnBody(world, crate.id);
    }
    expect(crate.sceneProp.y).toBeGreaterThan(before.y); // thrown up and away, east
    for (let i = 0; i < 60; i++) world.step({});
    expect(crate.sceneProp.x - before.x).toBeGreaterThan(0.25);
    expect(Math.abs(crate.sceneProp.z - before.z)).toBeLessThan(0.25);
    expect(pillar.sceneProp).toEqual(fixed);
    // the caller's strength under the hook's: a harder hit goes further
    const soft = run(90, 10);
    const hard = (() => {
      const w = run(10);
      hitProp(w, 1, [1, 0, 3], { speed: 9 });
      for (let i = 0; i < 80; i++) w.step({});
      return w;
    })();
    expect(props(hard)[0].sceneProp.x).toBeGreaterThan(props(soft)[0].sceneProp.x + 0.5);
  });

  it("runs a game's own hit hook with the prop, its body, where the hit came from and its knock", () => {
    const touches: PropTouch[] = [];
    defineProp('prop:propsTestUrn', {
      parts: [{ geometry: 'geometry:frustum', material: 'material:planks' }],
      body: { type: 'dynamic', shape: 'cylinder', radius: 0.2, height: 0.5 },
      hit: (touch: PropTouch) => void touches.push(touch),
    });
    const { world } = startScene('propsYard');
    const urn = spawnProp(world, { prop: 'prop:propsTestUrn', at: [-3, 0, 0], yaw: 0 });
    world.step({});
    hitProp(world, urn, [-4, 0, 0], { up: 0 });
    expect(touches).toHaveLength(1);
    expect(touches[0]).toMatchObject({ body: props(world)[3].sceneProp.body, from: [-4, 0, 0] });
    expect(touches[0].prop.id).toBe('prop:propsTestUrn');
    for (let i = 0; i < 30; i++) world.step({});
    expect(props(world)[3].sceneProp.x).toBeCloseTo(-3, 2); // the hook did not knock it
    touches[0].knock();
    for (let i = 0; i < 30; i++) world.step({});
    expect(props(world)[3].sceneProp.x).toBeGreaterThan(-2.75); // its knock does, east and flat (up 0)
  });

  it('a capture taken while a crate flies restores and continues to the same hashes', () => {
    const straight = run(60, 10);
    const hashes = [straight.hash()];
    for (let i = 0; i < 30; i++) straight.step({});
    hashes.push(straight.hash());
    const world = run(60, 10);
    const capture = deserialize(serialize(world.capture() as unknown as Canonical)) as unknown as WorldCapture;
    for (let i = 0; i < 7; i++) world.step({}); // somewhere else
    world.restore(capture);
    expect(world.hash()).toBe(hashes[0]);
    for (let i = 0; i < 30; i++) world.step({});
    expect(world.hash()).toBe(hashes[1]);
  });

  it('removeProp removes body and entity; an id that is no prop is refused', () => {
    const { world } = startScene('propsYard');
    const [crate] = props(world);
    const body = crate.sceneProp.body;
    removeProp(world, crate.id);
    expect([world.has(crate.id), physicsOf(world).hasBody(body)]).toEqual([false, false]);
    removeProp(world, 3); // the fire: no body to remove
    expect(props(world).map((e) => e.sceneProp.prop)).toEqual(['prop:pillar']);
    expect(() => hitProp(world, 99, [0, 0, 0])).toThrow(/SIM_BAD_ARGUMENT.*hitProp\(w, id, from\)/);
    expect(() => removeProp(world, 99)).toThrow(/SIM_BAD_ARGUMENT.*removeProp\(w, id\)/);
  });
});
