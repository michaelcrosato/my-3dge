/**
 * @file Unit tests for the firearms drawn (engine/gfx/weapons.ts, PLAN.md WP 13.20), in Node: the weapon an actor has
 * out; a gun stood in a posed body's right hand, its barrel along the hold's and its top up, its muzzle ahead of the
 * grip; its prop as one geometry, each vertex its part's tint over its material; each `gunshot` of the trace played
 * once, a tracer from the shooter's muzzle (or ahead of where the shot left, without one) and a hole where it struck,
 * none for a miss, the tracer gone after its life and the latest holes kept; off, the trace read and nothing played.
 * The actors' puppets carry the gun out in the right hand while the hold holds one, its muzzle where the shots leave,
 * and first person draws it in the arms instead (engine/gfx/viewmodel/body.ts), the stage's props leaving it out and
 * the shots leaving its muzzle as the arms' lens draws it; holstered, it stays in the hand as the hands lower it.
 * @see engine/gfx/weapons.ts
 */
import { Box3, BufferAttribute, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { Animator } from '../anim/character';
import { socketPosition } from '../anim/fk';
import { createRegistry } from '../core/registry';
import { createCharacter } from '../physics/character';
import { physicsOf } from '../physics/binding';
import { spawnActor } from '../sim/actors';
import { defineScene, startScene } from '../sim/scene';
import { weaponsFor } from '../sim/weapons';
import { defineProp } from '../world/props/prop';
import { defineWeapon } from '../world/weapons';
import { makePose } from './cameras/pose';
import { defineMaterial } from './materials/material';
import { createMaterialLibrary } from './materials/library';
import { createActorPuppets } from './puppets/actors';
import { alongBarrel, createWeaponFx, gunGeometry, gunPose, HOLES, muzzlePoint, TRACER, weaponOut } from './weapons';

/** A pistol of two boxes on the shared registry, its muzzle 0.3 m ahead of the grip and 6 cm up. */
defineProp('prop:test-pistol', {
  parts: [
    { name: 'grip', geometry: 'geometry:box', params: { width: 0.03, height: 0.1, depth: 0.04 }, position: [0, -0.08, 0], tint: '#202020' }, // prettier-ignore
    { name: 'slide', geometry: 'geometry:box', params: { width: 0.03, height: 0.03, depth: 0.3 }, position: [0, 0.045, 0.13] }, // prettier-ignore
  ],
  body: { type: 'none' },
});
const PISTOL = defineWeapon('weapon:test-pistol', { prop: 'prop:test-pistol', muzzle: [0, 0.06, 0.3] });

/** A floor and the player at the origin, a gun's body, the pistol drawn. */
const scene = defineScene('test:weapons-drawn', {
  physics: true,
  setup(w) {
    physicsOf(w).addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [20, 1, 20] }, position: [0, -0.5, 0] }] }); // prettier-ignore
    const components = { weapons: weaponsFor([PISTOL.id], 0) };
    spawnActor(w, { at: [0, 0, 0], character: createCharacter(), anim: { build: 'build:adult', weapon: 'gun' }, components }); // prettier-ignore
  },
});

/** Two vectors' distance. */
const apart = (a: Vector3, b: Vector3) => a.distanceTo(b);

describe('the firearms drawn', () => {
  it('names the weapon an actor has out, and none holstered or without weapons', () => {
    const registry = createRegistry();
    defineWeapon('weapon:t', { rate: 4 }, registry);
    expect(weaponOut({ id: 1, weapons: { slots: ['weapon:t'], slot: 0 } }, registry)?.rate).toBe(4);
    expect(weaponOut({ id: 1, weapons: { slots: ['weapon:t'], slot: -1 } }, registry)).toBe(null);
    expect(weaponOut({ id: 1 }, registry)).toBe(null);
  });

  it('stands a gun at the right hand’s grip, along the barrel with its top up, its muzzle ahead', () => {
    const animator = new Animator({ build: 'build:adult', clock: 1 }).update({ position: new Vector3() });
    const { skeleton, world } = animator.body;
    const level = gunPose(skeleton, world, new Vector3(0, 0, 1));
    expect(apart(level.position, socketPosition(skeleton, world, 'weaponR'))).toBeLessThan(1e-9);
    expect(apart(new Vector3(0, 1, 0).applyQuaternion(level.rotation), new Vector3(0, 1, 0))).toBeLessThan(1e-9);
    const up = new Vector3(1, 1, 1).normalize(); // up and to the side
    const turn = alongBarrel(up, level.rotation.clone());
    expect(apart(new Vector3(0, 0, 1).applyQuaternion(turn), up)).toBeLessThan(1e-9);
    const top = new Vector3(0, 1, 0).applyQuaternion(turn);
    expect([Math.abs(top.dot(up)) < 1e-9, top.y > 0, Math.abs(top.x - top.z) < 1e-9]).toEqual([true, true, true]); // square to it, upward, in its vertical plane
    const muzzle = muzzlePoint(PISTOL, level);
    expect(apart(muzzle, level.position.clone().add(new Vector3(0, 0.06, 0.3)))).toBeLessThan(1e-9);
  });

  it('builds its prop as one geometry, each vertex its part’s tint over its material’s colour', () => {
    const registry = createRegistry();
    defineMaterial('material:half', { color: '#bcbcbc' }, registry); // 0.5 linear
    const box = {
      geometry: 'geometry:box',
      params: { width: 0.1, height: 0.1, depth: 0.1 },
      material: 'material:half',
    };
    defineProp('prop:g', { parts: [{ name: 'a', ...box, tint: '#ff0000' }, { name: 'b', ...box, position: [0, 0, 0.5] }], body: { type: 'none' } }, registry); // prettier-ignore
    const gun = gunGeometry(defineWeapon('weapon:g', { prop: 'prop:g' }, registry), registry)!;
    expect(Object.keys(gun.attributes).sort()).toEqual(['color', 'normal', 'position']);
    const [position, color] = [gun.getAttribute('position'), gun.getAttribute('color')] as BufferAttribute[];
    const colours = new Set<string>();
    for (let i = 0; i < position.count; i++) {
      const far = position.getZ(i) > 0.25; // part b, half a metre along +Z
      colours.add(`${far}:${[color.getX(i), color.getY(i), color.getZ(i)].map((c) => c.toFixed(2)).join()}`);
    }
    expect([...colours].sort()).toEqual(['false:0.50,0.00,0.00', 'true:0.50,0.50,0.50']);
    expect(gun.groups).toEqual([]);
    expect(gunGeometry(defineWeapon('weapon:bare', {}, registry), registry)).toBe(null); // no prop
  });

  it('plays each gunshot once: a tracer from the muzzle, a hole where it struck, none for a miss', () => {
    const bursts: string[] = [];
    const shots = createWeaponFx({ effects: { burst: (id: string) => (bursts.push(id), true) } as never });
    const hit = { seq: 1, type: 'gunshot', payload: { id: 1, from: [0, 1.5, 0], to: [0, 1.5, 10], normal: [0, 0, -1] } }; // prettier-ignore
    const miss = { seq: 2, type: 'gunshot', payload: { id: 2, from: [0, 1.5, 0], to: [0, 1.5, 100], normal: null } };
    const muzzle = new Vector3(0.2, 1.3, 0.4);
    expect(shots.feed([hit, miss], (id) => (id === 1 ? muzzle : null))).toBe(2);
    expect(shots.stats()).toEqual({ tracers: 2, holes: 1 });
    expect(bursts).toEqual(['emitter:sparks', 'emitter:impact', 'emitter:sparks', 'emitter:sparks']); // the flash, the impact, the flash
    expect(shots.feed([hit, miss], () => null)).toBe(0); // read: never twice
    shots.frame(TRACER.life / 2);
    expect(shots.stats().tracers).toBe(2);
    shots.frame(TRACER.life);
    expect(shots.stats()).toEqual({ tracers: 0, holes: 1 }); // the tracers gone, the hole kept
    const many = Array.from({ length: HOLES.capacity + 5 }, (_, k) => ({ ...hit, seq: 3 + k }));
    shots.feed(many, () => null);
    expect(shots.stats().holes).toBe(HOLES.capacity); // the latest kept
    shots.reset();
    expect(shots.stats()).toEqual({ tracers: 0, holes: 0 });
    expect(shots.feed([{ ...hit, seq: 1 }], () => null, false)).toBe(0); // off: read, not played
    expect(shots.feed([{ ...hit, seq: 1 }], () => null)).toBe(0);
    shots.dispose();
  });

  it('carries the gun out in the right hand, and first person draws it in the arms instead', () => {
    const { world } = startScene(scene);
    world.step({});
    const actors = createActorPuppets({ materials: createMaterialLibrary() });
    actors.capture(world.query('actor'), world.dt);
    actors.draw(1);
    const { skeleton, world: pose } = actors.player()!.posed!;
    const gun = actors.carried().get(1)!;
    expect(gun.kind.id).toBe(PISTOL.id);
    expect(apart(gun.position, socketPosition(skeleton, pose, 'weaponR'))).toBeLessThan(1e-9);
    expect(apart(actors.muzzle(1)!, muzzlePoint(PISTOL, gun))).toBeLessThan(1e-9);
    const eye = actors.player()!.posed!.eye;
    const frame = { pose: makePose({ position: eye, fov: 74, near: 0.05 }), dt: 1 / 60, aspect: 16 / 9, player: null, effects: null }; // prettier-ignore
    actors.firstPerson(frame);
    const shown = actors.puppets.get(1)!.mesh.children.filter((child) => child.userData.viewmodel === 'gun' && child.visible); // prettier-ignore
    expect(shown.map((mesh) => [mesh.name, mesh.userData.weapon])).toEqual([['actor#1/gun', PISTOL.id]]);
    expect(actors.carried().has(1)).toBe(false); // the stage's props leave it to the arms
    const drawn = actors.muzzle(1)!;
    expect(apart(drawn, new Vector3(...eye))).toBeLessThan(0.3); // where the arms' lens draws it, near the eye
    expect(drawn.z).toBeGreaterThan(eye[2]); // ahead of it, as he faces
    actors.firstPerson(null);
    expect([actors.carried().has(1), actors.muzzle(1)!.distanceTo(muzzlePoint(PISTOL, gun))]).toEqual([true, 0]);
    const box = new Box3().setFromObject(actors.puppets.get(1)!.mesh, true); // the scene dump's size: hidden children count
    expect(box.min.y).toBeGreaterThan(-0.05); // its soles, 2.4 cm down: the hidden guns a point at its root (a pistol at the origin reached -8.5 cm)
    const player = world.get(1) as unknown as { weapons: { slot: number }; animator: { weapon: string } };
    [player.weapons.slot, player.animator.weapon] = [-1, 'none']; // holstered, as the sim's system writes it
    const held = () => (world.step({}), actors.capture(world.query('actor'), world.dt), actors.draw(1), actors.carried().has(1)); // prettier-ignore
    expect(held()).toBe(true); // still in the hand as the hands lower it
    for (let k = 0; k < 15; k++) held();
    expect([actors.carried().size, actors.muzzle(1)]).toEqual([0, null]); // gone 0.25 s on
    actors.dispose();
  });
});
