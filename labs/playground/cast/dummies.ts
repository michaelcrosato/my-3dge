/**
 * @file The ring's sparring dummies (docs/PLAYGROUND.md §2.2, §7.3; PLAN.md WP 13.19): things (WP 10.4,
 * engine/world/things.ts) standing as `prop:playground-dummy` on the ring's canvas, sprung into their bases. Their kind,
 * `thing:playground-dummy` (`DUMMY_KIND`): a hit counts and rocks the dummy away from the blow on its spring; its points
 * come back at each hit, so a punch or a kick never puts it down (a blast's all-it-has does, for its `rise`, and it
 * stands again). The component `sparring` holds its lean and how fast it swings (`SPARRING_FIELDS`); the system
 * `dummies` (phase `anim`, added with the first) springs each back toward upright, a damped spring (`SPRING`), and
 * drives its body there, leaning about its base (`driveBody`), so the physics step carries it, what strikes it next
 * meets it where it leans, and the view draws it rocking. `standDummies(w)` stands the ring's three (`RING_DUMMIES`),
 * last in a scene's setup. The two that ragdoll on a hard hit and get up are people: partners.ts (WP 10.2).
 *
 * Invariants: everything a dummy is lives in its components; dummies step in id order; no random stream.
 *
 * Game code, sim-side: it imports only engine/sim-api.ts and the playground's own files.
 *
 * @example
 * // in a scene's setup, after the site's things: standDummies(w);
 * // a punch from the south: its `sparring.vz` < 0, the head swung north; 3 s later it stands upright again
 * @see labs/playground/cast/dummies.test.ts
 */
import { defineComponent, defineThing, driveBody, getProp, physicsOf, propCentre, Quaternion, spawnThing, Vector3, type ThingTouch, type World } from '../../../engine/sim-api'; // prettier-ignore
import '../props/outdoors';

/** A sparring dummy's spring: its frequency (Hz) and damping ratio, a hit's swing (rad/s) and the most it leans (rad). */ // prettier-ignore
export const SPRING = Object.freeze({ frequency: 1.4, damping: 0.22, kick: 2.6, most: 0.5 });

/** The component `sparring`'s fields: the lean (rad: its head toward +X and +Z), its swing (rad/s) and its turn. */
export const SPARRING_FIELDS = {
  x: { type: 'number', default: 0, unit: 'rad', description: 'How far it leans toward +X (east).' },
  z: { type: 'number', default: 0, unit: 'rad', description: 'How far it leans toward +Z (south).' },
  vx: { type: 'number', default: 0, unit: 'rad/s', description: 'How fast it swings toward +X.' },
  vz: { type: 'number', default: 0, unit: 'rad/s', description: 'How fast it swings toward +Z.' },
  yaw: { type: 'number', default: 0, unit: 'rad', description: 'Its turn about +Y, as it was stood.' },
} as const;

/** A dummy's lean and swing (`SPARRING_FIELDS`). */
export interface Sparring {
  x: number;
  z: number;
  vx: number;
  vz: number;
  yaw: number;
}

defineComponent('sparring', { description: 'A sparring dummy’s lean on its spring (WP 13.19).', fields: SPARRING_FIELDS }); // prettier-ignore

/** A dummy as this module reads it. */
type Dummy = { id: number; sparring: Sparring; sceneProp: { prop: string; body: number }; thing: { x0: number; y0: number; z0: number } }; // prettier-ignore

/** A hit rocks the dummy away from where it came from, and its points come back (see the file comment). */
function rock(touch: ThingTouch): void {
  const w = touch.world as World;
  const e = w.get(touch.entity!) as unknown as Dummy;
  touch.thing.hp = touch.kind.hp;
  const [dx, dz] = [e.thing.x0 - touch.from[0], e.thing.z0 - touch.from[2]];
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return;
  e.sparring.vx += (dx / d) * SPRING.kick;
  e.sparring.vz += (dz / d) * SPRING.kick;
}

/** The ring's dummies' kind (see the file comment). */
export const DUMMY_KIND = defineThing('thing:playground-dummy', { prop: 'prop:playground-dummy', hp: 2, rise: 3, hit: rock }); // prettier-ignore

/** Where the ring's dummies stand (m, on its canvas 1 m up) and face: three across its north half, toward its steps. */
export const RING_DUMMIES: readonly { readonly at: readonly [number, number, number]; readonly yaw: number }[] = [
  { at: [64.5, 1, 5], yaw: 0 },
  { at: [66, 1, 4.5], yaw: 0 },
  { at: [67.5, 1, 5], yaw: 0 },
];

const [up, axis, base, centre] = [new Vector3(0, 1, 0), new Vector3(), new Vector3(), new Vector3()];
const [lean, turn] = [new Quaternion(), new Quaternion()];

/** The system `dummies`: each dummy's spring one step on, its body driven to its lean (see the file comment). */
function stepDummies(w: World): void {
  const omega = 2 * Math.PI * SPRING.frequency;
  for (const e of w.query('sparring', 'thing', 'sceneProp') as unknown as Dummy[]) {
    const s = e.sparring;
    s.vx += (-omega * omega * s.x - 2 * SPRING.damping * omega * s.vx) * w.dt;
    s.vz += (-omega * omega * s.z - 2 * SPRING.damping * omega * s.vz) * w.dt;
    s.x = Math.max(-SPRING.most, Math.min(SPRING.most, s.x + s.vx * w.dt));
    s.z = Math.max(-SPRING.most, Math.min(SPRING.most, s.z + s.vz * w.dt));
    const angle = Math.hypot(s.x, s.z);
    if (angle > 1e-9)
      lean.setFromAxisAngle(axis.set(s.z / angle, 0, -s.x / angle), angle); // up × the lean's way
    else lean.identity();
    const rotation = lean.multiply(turn.setFromAxisAngle(up, s.yaw)); // turned as stood, then leaning
    const h = propCentre(getProp(e.sceneProp.prop));
    base.set(e.thing.x0, e.thing.y0 - h, e.thing.z0);
    centre.set(0, h, 0).applyQuaternion(rotation).add(base); // its middle, leaning about its base
    driveBody(physicsOf(w), e.sceneProp.body, centre, rotation, w.dt);
  }
}

/** Stands a sparring dummy on its base at `at` (m), facing `yaw` (rad): its entity. */
export function standDummy<C extends object>(w: World<C>, at: readonly [number, number, number], yaw = 0): number {
  const world = w as unknown as World;
  if (!world.systems.has('dummies')) world.systems.add('dummies', stepDummies, { phase: 'anim' });
  return spawnThing(w, DUMMY_KIND.id, at, yaw, { sparring: { x: 0, z: 0, vx: 0, vz: 0, yaw } });
}

/** Stands the ring's dummies (`RING_DUMMIES`): their entities, in order. */
export function standDummies<C extends object>(w: World<C>): number[] {
  return RING_DUMMIES.map(({ at, yaw }) => standDummy(w, at, yaw));
}
