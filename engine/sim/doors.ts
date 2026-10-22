/**
 * @file Doors (PLAN.md WP 13.16; docs/PLAYGROUND.md §7.1): `addDoor(w, spec)` hangs a door, a kinematic prop (the
 * library's `prop:door` by default) on a hinge: the leaf's foot at its hinged edge stands at `hinge` (m) and, closed,
 * its width runs from there along +X turned `yaw` about +Y, its faces ±Z. The component `door` holds its state. The
 * system `doors` (phase `anim`, after the step's uses) swings each toward its target at its speed, unless a body (an
 * actor, a prop) stands where the leaf would go: it waits there. Using one (engine/sim/interact.ts) opens it away from
 * the user, a quarter turn and a little more (`swing`, 1.65 rad), or closes it; a locked one says so and stays shut.
 *
 * Strikes (`strikeDoor`, a melee hit while the striker faces it, Apex's rule): the first bursts it open away from the
 * striker, three times as fast, unlocking it; the second breaks it off its hinges: the leaf's body turns dynamic,
 * knocked away, and the event its prop's `breaks.shards` names goes out (`splinters`: engine/sim/breakables.ts). A
 * shot or a blast (`force`) breaks it at once. A sliding door (`slide: [dx, dy, dz]`, the garage's: up 2.2 m) moves
 * along that offset instead, opened and closed by its switch (engine/sim/switches.ts), never struck open.
 * `addLevelDoors(w, level, place?)` hangs `prop:door` (0.9 m) in the middle of each door opening of a level written as
 * storeys (in a site's structure: `place`, its `at` and quarter turns): 5 cm a side in the door glyph's 1 m.
 *
 * Events: `door` `{ id, open, locked }`, `splinters` `{ id, prop, position, ground }`.
 * Invariants: a leaf's pose is a pure function of its hinge, yaw and angle (or its offset and amount), driven exactly
 * there each step (`driveBody`); everything a door is lives in its components.
 * @see engine/sim/doors.test.ts
 */
import type { EventMap } from '../core/events';
import { Quaternion, Vector3 } from '../core/math';
import { physicsOf } from '../physics/binding';
import { driveBody, knock } from '../physics/bodies';
import type { CompiledLevel, OpeningDescriptor } from '../world/level/types';
import { propBody } from '../world/props/place';
import { getProp } from '../world/props/prop';
import { toWorld, type QuarterTurns } from '../world/site';
import { defineStrikable, defineUsable } from './interact';
import { spawnProp, type ScenePropComponents } from './props';
import { defineComponent } from './state';
import type { World } from './world';

/** A door's swing open (rad): a quarter turn and a little more. */
export const DOOR_SWING = 1.65;
/** How fast a door turns (rad/s), or slides (its way open a second), and how much faster a burst is. */
const SPEED = { turn: 2.6, slide: 0.6, burst: 3 } as const;
/** What blocks a leaf: actors and props. */
const BLOCKERS = ['actor', 'prop'] as const;

/** What `addDoor` takes (see the file comment). */
export interface DoorSpec {
  hinge: readonly [number, number, number];
  yaw?: number;
  prop?: string;
  locked?: boolean;
  /** A sliding door's way open (m), instead of a hinge. */
  slide?: readonly [number, number, number];
}

/** The component `door`. */
export interface DoorComponent {
  hinge: [number, number, number];
  yaw: number;
  /** Where it is (rad on a hinge; 0 to 1 of its slide) and where it is going. */
  angle: number;
  target: number;
  speed: number;
  locked: boolean;
  /** Strikes taken; broken at the second. */
  struck: number;
  broken: boolean;
  slide: [number, number, number];
}

type DoorEntity = ScenePropComponents & { id: number; door: DoorComponent };

const vec = (description: string, value: readonly number[] = [0, 0, 0]) => ({ type: 'array', items: { type: 'number' }, default: [...value], unit: 'm', description }) as const; // prettier-ignore
defineComponent('door', {
  description: 'A door on its hinge or its slide (WP 13.16): where it is, where it is going, locked, struck, broken.',
  fields: {
    hinge: vec('The leaf’s foot at its hinged edge (m).'),
    yaw: { type: 'number', default: 0, description: 'The closed leaf’s turn about +Y (rad).' },
    angle: { type: 'number', default: 0, description: 'Where it is: rad on its hinge, or 0 to 1 of its slide.' },
    target: { type: 'number', default: 0, description: 'Where it is going.' },
    speed: { type: 'number', default: 2.6, minimum: 0, description: 'How fast (rad/s, or of its slide per second).' },
    locked: { type: 'boolean', default: false, description: 'Whether using it opens it.' },
    struck: { type: 'integer', default: 0, minimum: 0, description: 'Strikes taken: the second breaks it.' },
    broken: { type: 'boolean', default: false, description: 'Off its hinges, a falling body.' },
    slide: vec('A sliding door’s way open (m); none for a hinge.'),
  },
});

/** Whether `door` slides rather than swings. */
const slides = (door: DoorComponent) => door.slide.some((v) => v !== 0);

/** The leaf's centre and turn at `angle` (see the file comment). */
function leafPose(door: DoorComponent, prop: string, angle: number): { position: Vector3; rotation: Quaternion } {
  const { size } = getProp(prop).body;
  const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), door.yaw + (slides(door) ? 0 : angle));
  const centre = new Vector3(size[0] / 2, size[1] / 2, 0).applyQuaternion(turn).add(new Vector3(...door.hinge));
  if (slides(door)) centre.addScaledVector(new Vector3(...door.slide), angle);
  return { position: centre, rotation: turn };
}

/** Which side of a closed door `at` stands on: +1 on its +Z face's, −1 on the other. */
function sideOf(door: DoorComponent, at: readonly number[]): 1 | -1 {
  const [dx, dz] = [at[0] - door.hinge[0], at[2] - door.hinge[2]];
  return dx * Math.sin(door.yaw) + dz * Math.cos(door.yaw) >= 0 ? 1 : -1;
}

/** Hangs a door (see the file comment) and returns its entity. */
export function addDoor<C extends object, E extends EventMap>(world: World<C, E>, spec: DoorSpec): number {
  const w = world as unknown as World;
  const door: DoorComponent = { hinge: [...spec.hinge], yaw: spec.yaw ?? 0, angle: 0, target: 0, speed: spec.slide ? SPEED.slide : SPEED.turn, locked: spec.locked ?? false, struck: 0, broken: false, slide: [...(spec.slide ?? [0, 0, 0])] }; // prettier-ignore
  const prop = spec.prop ?? 'prop:door';
  const { position } = leafPose(door, prop, 0); // the leaf's centre: its base half its height under it, turned `yaw`
  const base = position.setY(position.y - getProp(prop).body.size[1] / 2);
  const id = spawnProp(w, { prop, at: [base.x, base.y, base.z], yaw: door.yaw }, { as: 'kinematic', components: { door } }); // prettier-ignore
  if (!w.systems.has('doors')) w.systems.add('doors', swingDoors, { phase: 'anim' });
  return id;
}

/** Opens `id` away from `from` (m), or closes it; a locked door stays. Returns whether it moved. */
export function useDoor<C extends object, E extends EventMap>(
  world: World<C, E>,
  id: number,
  from: readonly number[],
): boolean {
  const { door } = (world as unknown as World).get(id) as unknown as DoorEntity;
  if (door.broken) return false;
  if (door.locked) return (void (world as unknown as World).emit('door', { id, open: false, locked: true }), false);
  door.target = door.target !== 0 ? 0 : slides(door) ? 1 : sideOf(door, from) * DOOR_SWING; // away: +θ swings to −Z
  door.speed = slides(door) ? SPEED.slide : SPEED.turn;
  (world as unknown as World).emit('door', { id, open: door.target !== 0, locked: false });
  return true;
}

/** Breaks `id` off its hinges (see the file comment), knocked away from `from`. */
export function breakDoor<C extends object, E extends EventMap>(
  world: World<C, E>,
  id: number,
  from: readonly [number, number, number],
): void {
  const w = world as unknown as World;
  const { door, sceneProp } = w.get(id) as unknown as DoorEntity;
  if (door.broken) return;
  door.broken = true;
  const physics = physicsOf(w);
  const { position: p, rotation: r } = physics.readBody(sceneProp.body);
  physics.removeBody(sceneProp.body);
  const spec = propBody({ prop: sceneProp.prop, at: [p.x, p.y, p.z], yaw: 0 }, undefined, 'dynamic')!;
  sceneProp.body = physics.addBody({ ...spec, position: [p.x, p.y, p.z], rotation: [r.x, r.y, r.z, r.w] });
  knock(physics, sceneProp.body, from, { speed: 3, up: 1.5 });
  const event = { id, prop: sceneProp.prop, position: [p.x, p.y, p.z], ground: door.hinge[1] };
  w.emit(getProp(sceneProp.prop).breaks.shards || 'shatter', event);
}

/** A strike on `id` from `from`: the first bursts it open, the second breaks it; a shot or a blast breaks it at once. */
export function strikeDoor<C extends object, E extends EventMap>(
  world: World<C, E>,
  id: number,
  from: readonly [number, number, number],
  faced = true,
  force: 'melee' | 'shot' | 'blast' = 'melee',
): void {
  // prettier-ignore
  const w = world as unknown as World;
  const { door } = w.get(id) as unknown as DoorEntity;
  if (door.broken || slides(door)) return;
  if (force !== 'melee') return breakDoor(w, id, from);
  if (!faced) return;
  door.struck++;
  if (door.struck >= 2) return breakDoor(w, id, from);
  [door.locked, door.target, door.speed] = [false, sideOf(door, from) * DOOR_SWING, SPEED.turn * SPEED.burst];
  w.emit('door', { id, open: true, locked: false });
}

/** The system `doors`: every door toward its target, waiting while a body stands in the leaf's way, in id order. */
function swingDoors(w: World): void {
  const physics = physicsOf(w);
  for (const e of w.query('door' as never) as unknown as DoorEntity[]) {
    const { door, sceneProp } = e;
    if (door.broken) continue;
    const step = door.speed * w.dt;
    const next = Math.abs(door.target - door.angle) <= step ? door.target : door.angle + Math.sign(door.target - door.angle) * step; // prettier-ignore
    const pose = leafPose(door, sceneProp.prop, next);
    const [sx, sy, sz] = getProp(sceneProp.prop).body.size;
    const box = { type: 'box', size: [Math.max(sx - 0.04, 0.01), Math.max(sy - 0.04, 0.01), Math.max(sz, 0.01)] } as const; // prettier-ignore
    const rotation = [pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w] as const;
    const blocked = next !== door.angle && physics.overlap(box, pose.position, { rotation, groups: [...BLOCKERS], exclude: sceneProp.body }).length > 0; // prettier-ignore
    if (!blocked) door.angle = next;
    const at = leafPose(door, sceneProp.prop, door.angle);
    driveBody(physics, sceneProp.body, at.position, at.rotation, w.dt);
  }
}

/** The openings of `level` a door hangs in: its door openings, in the level's order. */
const doorOpenings = (level: CompiledLevel): OpeningDescriptor[] => (level.openings ?? []).filter((o) => o.kind === 'door'); // prettier-ignore

/**
 * Hangs a door in each door opening of `level` (a site's structure placed at `place.at`, turned `place.turn`), its hinge
 * at the opening's west or north end, the leaf in the opening's middle, and returns their entities.
 */
export function addLevelDoors<C extends object, E extends EventMap>(
  world: World<C, E>,
  level: CompiledLevel,
  place?: { at: readonly number[]; turn: QuarterTurns },
): number[] {
  // prettier-ignore
  return doorOpenings(level).map((opening) => {
    const [cx, , cz] = opening.center;
    const along = opening.axis === 'x';
    const end = Math.max(0, opening.width - getProp('prop:door').body.size[0]) / 2 - opening.width / 2; // the leaf centred
    const [lx, lz] = along ? [cx + end, cz] : [cx, cz + end];
    const [x, z] = place ? toWorld({ at: place.at as [number, number, number], turn: place.turn }, lx, lz) : [lx, lz];
    const yaw = (along ? 0 : -Math.PI / 2) + ((place?.turn ?? 0) * Math.PI) / 2;
    return addDoor(world, { hinge: [x, opening.bottom + (place?.at[1] ?? 0), z], yaw });
  });
}

defineUsable('door', {
  prompt: (w, id) => {
    const { door } = w.get(id) as unknown as DoorEntity;
    if (door.broken || slides(door)) return null;
    return door.locked ? 'Locked' : door.target !== 0 ? 'Close' : 'Open';
  },
  use: (w, id, user) => {
    const actor = (w.get(user) as unknown as { actor: { x: number; y: number; z: number } }).actor;
    useDoor(w, id, [actor.x, actor.y, actor.z]);
  },
});
defineStrikable('door', (w, id, from, faced, force) => strikeDoor(w, id, from, faced, force));
