/**
 * @file The physics part of the sim's state (PLAN.md WP 3.1, §6.5 items 5–7; doctrine: Reproducible): how bodies are
 * named (ids from Rapier's handles), what the hash covers, and the capture that restores the world exactly.
 *
 * - **Body ids.** A Rapier handle is a float64 whose bits hold the body's slot (low 32 bits) and the slot's generation
 *   (high 32 bits), so the first body's handle is 5e-324. The engine names a body by `slot + generation · 2³²`, a
 *   whole number (0, 1, 2…, a reused slot 4294967296 and up), computed from the handle and back, so it needs no
 *   table and survives a restore.
 * - **The hash** (`physicsState`): every body's id, translation, rotation, linear velocity and angular velocity, in id
 *   order, as one `Float64Array` (14 numbers a body). Rapier stores them as float32, so they convert exactly. The
 *   snapshot bytes are never hashed: at 5,000 bodies they are 5.7 MB (§4.7).
 * - **The capture** (`capturePhysics`): Rapier's own snapshot, `{ rapier: 'simd-compat 0.21.0', snapshot }`. It holds
 *   the whole world (bodies, colliders, contacts and their warm-start impulses, islands and sleep, the broad phase,
 *   gravity and the integration parameters), so `restorePhysics` rebuilds a world that steps on exactly like the
 *   uninterrupted one: Rapier 0.21 restores exactly, measured in Node and Chromium (§4.7), with no extra step.
 *   Snapshots are version-locked, so a capture names the build and version, and a restore refuses another
 *   (`PHYSICS_BAD_CAPTURE`). Serialized as text (engine/core/hash.ts) the bytes become a list of numbers; restore
 *   takes either.
 *
 * Invariants: captures share nothing with the world (a snapshot is a fresh copy) and restoring never changes the
 * capture, so one capture restores any number of times. Reading the state changes nothing.
 *
 * @example
 * bodyId(5e-324); // 1: the second slot, generation 0
 * handleOf(1); // 5e-324
 * bodyId(handleOf(4294967296)); // 4294967296: slot 0, generation 1
 * @see engine/physics/capture.test.ts
 */
import RAPIER from '@dimforge/rapier3d-simd-compat';
import { codeError, defineCodes } from '../core/log';
import { isPlainObject, show } from '../core/schema';

/** The codes this module raises, with their fixes. */
export const CAPTURE_CODES = defineCodes('physics', {
  PHYSICS_BAD_CAPTURE: {
    template: 'the physics part of a capture {problem}',
    fix: "restore what capture() returned (or its serialize/deserialize round trip), unchanged, with the engine's own Rapier build and version: snapshots are version-locked, so a capture taken with another Rapier restores only there",
  },
});

/** The Rapier build and version a capture records, `'simd-compat 0.21.0'`: snapshots restore only into the same. */
export function rapierBuild(): string {
  return `simd-compat ${RAPIER.version()}`;
}

/** The physics part of a capture: Rapier's snapshot, with the build and version that took it. */
export interface PhysicsCapture {
  readonly rapier: string;
  /** Rapier's `takeSnapshot()` bytes (a list of numbers once serialized as text). */
  readonly snapshot: Uint8Array | readonly number[];
}

/** Numbers a body takes in the hashed state: id, translation (3), rotation (4), linear and angular velocity (3 each). */
export const STATE_STRIDE = 14;

const bits = new DataView(new ArrayBuffer(8));
const TWO_32 = 4294967296;

/** The body id of a Rapier handle: `slot + generation · 2³²`. */
export function bodyId(handle: number): number {
  bits.setFloat64(0, handle, true);
  return bits.getUint32(0, true) + bits.getUint32(4, true) * TWO_32;
}

/** The Rapier handle of a body id. */
export function handleOf(id: number): number {
  bits.setUint32(0, id % TWO_32, true);
  bits.setUint32(4, Math.floor(id / TWO_32), true);
  return bits.getFloat64(0, true);
}

/** Every body's id, in id order. */
export function bodyIds(world: RAPIER.World): number[] {
  const ids: number[] = [];
  world.bodies.forEach((body) => void ids.push(bodyId(body.handle)));
  return ids.sort((a, b) => a - b);
}

/** What the hash covers: per body, in id order, its id, translation, rotation, linear and angular velocity. */
export function physicsState(world: RAPIER.World): Float64Array {
  const ids = bodyIds(world);
  const out = new Float64Array(ids.length * STATE_STRIDE);
  ids.forEach((id, i) => {
    const body = world.getRigidBody(handleOf(id));
    const t = body.translation();
    const r = body.rotation();
    const v = body.linvel();
    const w = body.angvel();
    out.set([id, t.x, t.y, t.z, r.x, r.y, r.z, r.w, v.x, v.y, v.z, w.x, w.y, w.z], i * STATE_STRIDE);
  });
  return out;
}

/** The world as a capture: Rapier's snapshot, a fresh copy, with the build that took it. */
export function capturePhysics(world: RAPIER.World): PhysicsCapture {
  return { rapier: rapierBuild(), snapshot: world.takeSnapshot() };
}

/** Throws `PHYSICS_BAD_CAPTURE` naming `problem` unless `ok`. */
function need(ok: boolean, problem: () => string): asserts ok {
  if (!ok) throw codeError('PHYSICS_BAD_CAPTURE', { problem: problem() });
}

/** A new world from a capture (checked first: `PHYSICS_BAD_CAPTURE`); the capture is left as it was. */
export function restorePhysics(data: unknown): RAPIER.World {
  need(isPlainObject(data), () => `is ${show(data)}, not what capture() returned`);
  const build = rapierBuild();
  need(data.rapier === build, () => `was taken with Rapier ${show(data.rapier)}; this is ${build}`);
  const { snapshot } = data;
  const bytes =
    snapshot instanceof Uint8Array
      ? snapshot
      : Array.isArray(snapshot) && snapshot.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
        ? Uint8Array.from(snapshot as number[])
        : undefined;
  need(bytes !== undefined && bytes.length > 0, () => `holds the snapshot ${show(snapshot)}, not Rapier's bytes`);
  let world: RAPIER.World | null = null;
  let failure: unknown;
  try {
    world = RAPIER.World.restoreSnapshot(bytes); // null when Rapier cannot read the bytes
  } catch (error) {
    failure = error;
  }
  if (!world) throw codeError('PHYSICS_BAD_CAPTURE', { problem: 'holds bytes Rapier could not read' }, failure);
  return world;
}
