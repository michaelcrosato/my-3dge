/**
 * @file Tests for the physics part of the sim's state (engine/physics/capture.ts), through a sim world that has the
 * physics world as its hook: body ids round-trip through handles, and a removed body's id never names the newer body
 * its slot holds (WP 13.16: a broken pane's slot taken by a shard); 40 bodies falling into a walled pit give the same
 * hashes every run; a capture taken mid-run, with bodies resting on bodies, restores (in place, into a new world, and
 * from its text) and continues with the uninterrupted run's hashes; every hashed field of a body counts; a capture from
 * another Rapier, or with bad bytes, is refused before anything changes.
 */
import { describe, expect, it } from 'vitest';
import { deserialize, serialize, type Canonical } from '../core/hash';
import { createRegistry } from '../core/registry';
import { createSettings, defineSettings } from '../core/settings';
import type { WorldCapture } from '../sim/capture';
import { createWorld, type World } from '../sim/world';
import { bodyId, handleOf, rapierBuild, STATE_STRIDE } from './capture';
import { PHYSICS_SETTINGS } from './params';
import { createPhysics, type Physics } from './world';

/** A sim world over a new physics world, with the physics step as its system, on its own registry. */
function simWorld(physics = createPhysics()): { w: World; physics: Physics } {
  const registry = createRegistry();
  defineSettings(PHYSICS_SETTINGS, registry);
  const settings = createSettings({ registry });
  const w = createWorld({ seed: 1, registry, settings, physics });
  w.systems.add('physics', (world) => physics.step(world), { phase: 'physics' });
  return { w, physics };
}

/** A 6 × 6 m pit (one fixed body of merged boxes), 5 stacks of 4 crates and 20 balls tossed in from above. */
function fill(physics: Physics): void {
  const box = (size: [number, number, number], position: [number, number, number]) => ({
    shape: { type: 'box' as const, size },
    position,
    friction: 0.6,
  });
  physics.addBody({
    type: 'fixed',
    colliders: [
      box([8, 1, 8], [0, -0.5, 0]),
      box([0.5, 3, 7], [-3.25, 1.5, 0]),
      box([0.5, 3, 7], [3.25, 1.5, 0]),
      box([6, 3, 0.5], [0, 1.5, -3.25]),
      box([6, 3, 0.5], [0, 1.5, 3.25]),
    ],
  });
  for (let stack = 0; stack < 5; stack++) {
    for (let level = 0; level < 4; level++) {
      physics.addBody({
        position: [-2 + stack, 0.3 + level * 0.6, -1.5 + 0.05 * level],
        rotation: [0, Math.sin(0.1 * stack), 0, Math.cos(0.1 * stack)],
        colliders: [{ shape: { type: 'box', size: [0.6, 0.6, 0.6] }, density: 300 }],
      });
    }
  }
  for (let i = 0; i < 20; i++) {
    physics.addBody({
      position: [-2.2 + (i % 5) * 1.1, 4 + Math.floor(i / 5) * 0.8, 0.5 + (i % 3) * 0.6],
      velocity: [(i % 4) - 1.5, 0, -1.5],
      colliders: [{ shape: { type: 'ball', radius: 0.25 }, restitution: 0.3 }],
    });
  }
}

/** Steps `w` to tick `until`, recording each step's hash by tick. */
function stepTo(w: World, until: number, hashes: Record<number, string> = {}): Record<number, string> {
  while (w.tick < until) {
    w.step({});
    hashes[w.tick] = w.hash();
  }
  return hashes;
}

/** A fresh, filled sim world. */
function filled() {
  const made = simWorld();
  made.w.run(() => fill(made.physics));
  return made;
}

describe('body ids', () => {
  it('round-trip through Rapier handles: slot plus generation · 2³²', () => {
    expect([bodyId(0), bodyId(5e-324), handleOf(1)]).toEqual([0, 1, 5e-324]);
    for (const id of [0, 7, 4294967295, 4294967296, 4294967296 * 3 + 12]) expect(bodyId(handleOf(id))).toBe(id);
  });

  it('never name the newer body a removed one’s slot holds', () => {
    const physics = createPhysics();
    const ball = { type: 'dynamic', colliders: [{ shape: { type: 'ball', radius: 0.1 } }] } as const;
    const [gone, kept] = [physics.addBody(ball), physics.addBody(ball)];
    physics.removeBody(gone);
    const reused = physics.addBody({ ...ball, position: [0, 5, 0] }); // slot 0 again, generation 1
    expect([gone, kept, reused, physics.hasBody(gone), physics.hasBody(reused)]).toEqual([0, 1, 4294967296, false, true]); // prettier-ignore
    expect(() => physics.readBody(gone)).toThrow(/PHYSICS_NO_BODY/);
    expect(() => physics.raycast([0, 0, 0], [0, 1, 0], { exclude: gone })).toThrow(/exclude/);
    physics.dispose();
  });
});

describe('the physics hook in a sim world', () => {
  const steps = 600;
  const reference = filled();
  const golden = stepTo(reference.w, steps);

  it('gives 40 bodies the same hashes every run', () => {
    expect(reference.physics.count).toBe(41); // the pit and 40 bodies
    for (let run = 0; run < 2; run++) expect(stepTo(filled().w, steps)).toEqual(golden);
    expect(reference.physics.state().length).toBe(41 * STATE_STRIDE);
  });

  it('restores a capture taken with bodies resting on bodies, and continues with the uninterrupted hashes', () => {
    const { w, physics } = filled();
    stepTo(w, 300);
    const resting = physics.bodies().filter((id) => {
      const body = physics.readBody(id);
      return body.type === 'dynamic' && body.position.y > 0.8; // above the floor's layer: on another body
    });
    expect(resting.length).toBeGreaterThanOrEqual(10);
    const capture = w.capture();
    expect(capture.physics).toMatchObject({ rapier: rapierBuild() });
    stepTo(w, 450);
    w.restore(capture);
    expect(w.tick).toBe(300);
    expect(w.hash()).toBe(golden[300]);
    const again = stepTo(w, steps);
    for (let k = 301; k <= steps; k++) expect(again[k], `step ${k}`).toBe(golden[k]);

    const text = serialize(capture as unknown as Canonical);
    const elsewhere = simWorld();
    elsewhere.w.restore(deserialize(text) as unknown as WorldCapture);
    expect(elsewhere.w.hash()).toBe(golden[300]);
    expect(stepTo(elsewhere.w, steps)[steps]).toBe(golden[steps]);
    w.restore(capture); // a capture restores any number of times
    expect(stepTo(w, steps)[steps]).toBe(golden[steps]);
  });

  it('hashes every body’s translation, rotation and velocities', () => {
    const { w, physics } = filled();
    stepTo(w, 30);
    const before = w.hash();
    const id = physics.bodies()[5];
    const body = physics.readBody(id);
    const changes = [
      { position: body.position.clone().setX(body.position.x + 1e-3) },
      {
        rotation: body.rotation.clone().set(body.rotation.x, body.rotation.y, body.rotation.z + 1e-3, body.rotation.w),
      },
      { velocity: body.velocity.clone().setY(body.velocity.y + 1e-3) },
      { angularVelocity: body.angularVelocity.clone().setZ(body.angularVelocity.z + 1e-3) },
    ];
    const capture = w.capture();
    for (const change of changes) {
      physics.setBody(id, change);
      expect(w.hash(), Object.keys(change)[0]).not.toBe(before);
      w.restore(capture);
      expect(w.hash()).toBe(before);
    }
    expect(w.trace().parts.physics).toMatch(/^[0-9a-f]{16}$/);
  });

  it('refuses a capture from another Rapier, or with bad bytes, before changing anything', () => {
    const { w, physics } = filled();
    const capture = w.capture();
    const before = w.hash();
    const part = capture.physics as { rapier: string; snapshot: Uint8Array };
    const bad = (physicsPart: unknown) => ({ ...capture, physics: physicsPart }) as WorldCapture;
    expect(() => physics.restore({ ...part, rapier: 'simd-compat 0.19.3' })).toThrow(
      /PHYSICS_BAD_CAPTURE.*0\.19\.3.*version-locked/,
    );
    expect(() => physics.restore({ ...part, snapshot: [1, 2, 300] })).toThrow(/PHYSICS_BAD_CAPTURE.*snapshot/);
    expect(() => physics.restore('snapshot')).toThrow(/PHYSICS_BAD_CAPTURE/);
    expect(() => w.restore(bad({ ...part, snapshot: new Uint8Array([1, 2, 3]) }))).toThrow(/PHYSICS_BAD_CAPTURE/);
    expect(w.hash()).toBe(before);
    expect(part.snapshot.length).toBeGreaterThan(1000);
  });
});
