/**
 * @file Firearms drawn (PLAN.md WP 13.20; docs/PLAYGROUND.md §7.2, §4): what the view shows of the weapons the sim
 * fires (engine/sim/weapons.ts; the kind `weapon`, engine/world/weapons.ts), presentation only.
 * - **The gun in the hand.** `weaponOut(entity)` is the weapon an actor's component `weapons` has out (null:
 *   holstered, or none), and `gunPose(skeleton, world, barrel)` where its prop stands: at the right hand's grip (the
 *   socket `weaponR`), its +Z along the hold's barrel (engine/anim/traversal/hold.ts `HoldPlant.barrel`), its +Y as
 *   near up as that leaves. The stage draws it as its prop (engine/gfx/stageProps.ts `carry`), first person as a mesh
 *   of its own at the arms' grip, by their lens (engine/gfx/viewmodel/body.ts): `gunGeometry`, its prop's parts as one
 *   geometry coloured by their tints, which the arms' vertex-coloured material draws; `muzzlePoint` is where its shots
 *   leave.
 * - **Shots** (`createWeaponFx`): `feed(trace, muzzleOf)` plays each `gunshot` event of the world's trace once: a
 *   tracer from the muzzle (`muzzleOf(id)`, the carried gun's, else `TRACER.ahead` along the shot from where it left)
 *   to where it ended, for `TRACER.life`; a flash of sparks at the muzzle, and where it struck a star and sparks off
 *   the surface (the effects' `emitter:impact` and `emitter:sparks`) and a hole facing its normal (`HOLES`), the latest
 *   `HOLES.capacity` kept. `frame(dt)` moves the tracers on; `register(warmup)` makes both batches' pipelines before
 *   the first frame.
 *
 * Invariants: presentation only: it reads the trace and the posed bodies and writes nothing back; each event plays
 * once, by its number, as the effects' own `feed` reads the trace; its batches exist from the start and never grow.
 *
 * Carried from the hit effects of `my-3d2dge:engine/my-3d2dge.js:1569-1580` (`hitFx`: a star and sparks where a blow
 * lands), with Apex Legends' tracers and bullet holes.
 *
 * @example
 * import { Vector3 } from 'three/webgpu';
 * import { Animator } from '../anim/character';
 * // const shots = createWeaponFx({ effects: stage.fx.effects }); stage.scene.add(shots.root);
 * // shots.feed(world.events.trace(), (id) => stage.actors.muzzle(id)); shots.frame(dt); // each drawn frame
 * const { skeleton, world } = new Animator({ build: 'build:adult', clock: 1 }).update({ position: new Vector3() }).body;
 * gunPose(skeleton, world, new Vector3(0, 0, 1)).position; // the right hand's grip, the barrel along +Z
 * @see engine/gfx/weapons.test.ts
 */
import {
  BoxGeometry,
  BufferAttribute,
  CustomBlending,
  Matrix4,
  MeshBasicNodeMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Group,
} from 'three/webgpu';
import { socketPosition, type WorldPose } from '../anim/fk';
import type { Skeleton } from '../anim/skeleton';
import { toLinear } from '../core/color';
import { registry as sharedRegistry, type Registry } from '../core/registry';
import type { EntityData } from '../sim/state';
import { getProp } from '../world/props/prop';
import { getWeapon, type WeaponKind } from '../world/weapons';
import type { Effects } from './fx/effects';
import { mergeGeometries } from './geometry/groups';
import { createInstancedBatch, type InstancedBatch } from './instancing';
import { getMaterial } from './materials/material';
import { buildPropPart, partMatrix } from './props';
import type { Warmup } from './warmup';

/** A tracer's look: its life (s), width (m), colour, and how far ahead of where a shot left it starts without a gun. */
export const TRACER = Object.freeze({ life: 0.05, width: 0.012, color: '#ffd27a', ahead: 0.8, capacity: 32 });
/** A bullet hole: its size (m), colour and how far off its surface (m); the latest `capacity` stay. */
export const HOLES = Object.freeze({ size: 0.05, color: '#14110f', lift: 0.004, capacity: 64 });

/** A gun in a hand as the view draws it: its weapon, and where its grip stands and its turn (world). */
export interface HeldGun {
  readonly kind: WeaponKind;
  readonly position: Vector3;
  readonly rotation: Quaternion;
}

/** The weapon `entity`'s component `weapons` has out (its kind, of `registry`), or null: holstered, or no weapons. */
export function weaponOut(entity: EntityData, registry: Registry = sharedRegistry): WeaponKind | null {
  const weapons = entity.weapons as { slots?: unknown; slot?: unknown } | undefined;
  if (!weapons || !Array.isArray(weapons.slots) || typeof weapons.slot !== 'number' || weapons.slot < 0) return null;
  const id = weapons.slots[weapons.slot];
  return typeof id === 'string' ? getWeapon(id, registry) : null;
}

/** Where a gun stands in a posed body's hand: at its grip (`weaponR`), +Z along `barrel` (unit, world), +Y up-most. */
export function gunPose(
  skeleton: Skeleton,
  world: WorldPose,
  barrel: Vector3,
): { position: Vector3; rotation: Quaternion } {
  // prettier-ignore
  const position = socketPosition(skeleton, world, 'weaponR', new Vector3());
  return { position, rotation: alongBarrel(barrel, new Quaternion()) };
}

/** A turn putting +Z on the unit `barrel` and +Y as near the world's up as that leaves (a level gun when it is level). */
export function alongBarrel(barrel: Vector3, out: Quaternion): Quaternion {
  const z = scratch[0].copy(barrel).normalize();
  const x = scratch[1].set(0, 1, 0).cross(z); // up × forward: the gun's left (+X)
  if (x.lengthSq() < 1e-10) x.set(1, 0, 0);
  x.normalize();
  const y = scratch[2].crossVectors(z, x);
  return out.setFromRotationMatrix(basis.makeBasis(x, y, z));
}

/** Where `kind`'s shots leave a gun standing at `pose` (world, m): its muzzle in its frame. */
export function muzzlePoint(
  kind: WeaponKind,
  pose: { position: Vector3; rotation: Quaternion },
  out = new Vector3(),
): Vector3 {
  // prettier-ignore
  return out.set(...kind.muzzle).applyQuaternion(pose.rotation).add(pose.position);
}

const scratch = [new Vector3(), new Vector3(), new Vector3()];
const basis = new Matrix4();

/**
 * `kind`'s prop as one geometry in its frame (the grip at the origin, +Z along the barrel), positions and normals, each
 * vertex coloured by its part's tint over its material's colour (linear): what first person draws in the arms'
 * vertex-coloured material (see the file comment). Null for a weapon with no prop. The geometry is the caller's.
 */
export function gunGeometry(kind: WeaponKind, registry: Registry = sharedRegistry): BufferGeometry | null {
  if (!kind.prop) return null;
  const parts = getProp(kind.prop, registry).parts.map((part) => {
    const geometry = buildPropPart(part, registry).applyMatrix4(partMatrix(part));
    for (const name of Object.keys(geometry.attributes)) if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name); // prettier-ignore
    geometry.clearGroups();
    const [tint, base] = [toLinear(part.tint), toLinear(getMaterial(part.material, registry).color)];
    const color = new Float32Array(geometry.getAttribute('position').count * 3);
    for (let i = 0; i < color.length; i++) color[i] = tint[i % 3] * base[i % 3];
    return geometry.setAttribute('color', new BufferAttribute(color, 3));
  });
  const gun = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return gun;
}

/** What a played `gunshot` carries for the view. */
interface Gunshot {
  readonly id: number;
  readonly from: readonly number[];
  readonly to: readonly number[];
  readonly normal: readonly number[] | null;
}

/** The shots' effects (see the file comment). */
export interface WeaponFx {
  /** The tracers' and holes' batches: add it to the scene. */
  readonly root: Group;
  /**
   * Plays the trace's `gunshot` events not played yet (`play` false: reads them only, as the effects do while off);
   * `muzzleOf(id)` is the shooter's muzzle now, or null. Returns how many it played.
   */
  feed(trace: readonly { seq: number; type: string; payload: unknown }[], muzzleOf: (id: number) => Vector3 | null, play?: boolean): number; // prettier-ignore
  /** Moves the tracers `dt` seconds on and draws them and the holes. */
  frame(dt: number): void;
  /** The tracers drawn now and the holes kept. */
  stats(): { tracers: number; holes: number };
  register(warmup: Pick<Warmup, 'register'>): { dispose(): void };
  /** Forgets the tracers, the holes and the trace read (the view's run started again). */
  reset(): void;
  dispose(): void;
}

/** Makes the shots' effects over `effects` (the view's, for the flashes and the impacts; see the file comment). */
export function createWeaponFx(options: { effects: Pick<Effects, 'burst'> }): WeaponFx {
  const line = new BoxGeometry(1, 1, 1).translate(0, 0, 0.5); // from its origin along +Z
  const glow = new MeshBasicNodeMaterial({ color: '#ffffff', transparent: true, depthWrite: false, blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor }); // prettier-ignore
  const dark = new MeshBasicNodeMaterial({ color: '#ffffff', transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); // prettier-ignore
  const tracers: InstancedBatch = createInstancedBatch({ name: 'weapons:tracers', geometry: line, material: glow, renderOrder: 3 }); // prettier-ignore
  const holes: InstancedBatch = createInstancedBatch({ name: 'weapons:holes', geometry: new PlaneGeometry(1, 1), material: dark, renderOrder: 1 }); // prettier-ignore
  tracers.root.add(holes.root);
  const root = tracers.root;
  root.name = 'weapons';
  const live: { from: Vector3; to: Vector3; age: number }[] = [];
  const kept: Matrix4[] = [];
  const [tracerTint, holeTint] = [toLinear(TRACER.color), toLinear(HOLES.color)];
  let read = 0;
  const [m, q, s, d] = [new Matrix4(), new Quaternion(), new Vector3(), new Vector3()];

  /** Plays one shot: its tracer, its flash, and where it struck its impact and hole. */
  const play = (shot: Gunshot, muzzle: Vector3 | null) => {
    const to = new Vector3(shot.to[0], shot.to[1], shot.to[2]);
    const from = muzzle ?? new Vector3(shot.from[0], shot.from[1], shot.from[2]);
    if (!muzzle) from.add(d.subVectors(to, from).normalize().multiplyScalar(Math.min(TRACER.ahead, to.distanceTo(from) * 0.5))); // prettier-ignore
    if (live.length >= TRACER.capacity) live.shift();
    live.push({ from, to, age: 0 });
    options.effects.burst('emitter:sparks', from, { size: 0.25, color: [tracerTint, tracerTint] });
    if (!shot.normal) return;
    const n = new Vector3(shot.normal[0], shot.normal[1], shot.normal[2]);
    options.effects.burst('emitter:impact', to, { size: 0.35 });
    options.effects.burst('emitter:sparks', to, { size: 0.4, velocity: [n.x * 2, n.y * 2, n.z * 2] });
    const at = to.clone().addScaledVector(n, HOLES.lift);
    const hole = new Matrix4().compose(at, q.setFromUnitVectors(s.set(0, 0, 1), n), new Vector3(HOLES.size, HOLES.size, 1)); // prettier-ignore
    if (kept.length >= HOLES.capacity) kept.shift();
    kept.push(hole);
  };

  return {
    root,
    feed(trace, muzzleOf, playing = true) {
      let played = 0;
      for (const record of trace) {
        if (record.seq <= read) continue;
        read = record.seq;
        if (record.type !== 'gunshot' || !playing) continue;
        const shot = record.payload as Gunshot;
        play(shot, muzzleOf(shot.id));
        played++;
      }
      return played;
    },
    frame(dt) {
      tracers.begin();
      for (let i = live.length - 1; i >= 0; i--) {
        const t = live[i];
        t.age += dt;
        if (t.age > TRACER.life) live.splice(i, 1);
      }
      for (const t of live) {
        const length = t.from.distanceTo(t.to);
        if (length < 1e-6) continue;
        q.setFromUnitVectors(s.set(0, 0, 1), d.subVectors(t.to, t.from).divideScalar(length));
        tracers.add(m.compose(t.from, q, s.set(TRACER.width, TRACER.width, length)).elements, tracerTint);
      }
      tracers.end();
      holes.begin();
      for (const hole of kept) holes.add(hole.elements, holeTint);
      holes.end();
    },
    stats: () => ({ tracers: live.length, holes: kept.length }),
    register(warmup) {
      return warmup.register('fx:weapons', { objects: () => [...tracers.pages, ...holes.pages] });
    },
    reset() {
      [live.length, kept.length, read] = [0, 0, 0];
    },
    dispose() {
      tracers.dispose();
      holes.dispose();
      line.dispose();
      glow.dispose();
      dark.dispose();
    },
  };
}
