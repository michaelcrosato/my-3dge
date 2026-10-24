/**
 * @file Crowd bodies on the stage (PLAN.md WP 5.7 core proposal, ADR-0008 amendment 6; §6.4's view; I-21): every
 * entity with the component `crowdBody` (engine/sim/crowdBodies.ts: a humanoid, blob, floater or quadruped rig, where it stands
 * and its rig's state) drawn through a crowd (engine/gfx/puppets/crowd.ts: instanced batches, a few dozen draw calls
 * for thousands), seen through the crowd's level of detail (engine/gfx/puppets/lod.ts) from the frame's camera. The
 * stage (engine/gfx/stage.ts) draws these instead of stand-ins.
 *
 * `capture(entities, dt)` after each sim step keeps each crowd body's last two places (where it stands and faces) and
 * its component, and returns the ids it draws. `draw(alpha, camera)`, once the frame's camera is placed, puts each
 * body `alpha` of the way from its place a step ago to its last and asks the crowd whether the camera sees it: only a
 * seen body is posed (the view's half of its rig, loaded from the component: a humanoid's animator at its band's
 * detail, `animator.pose({ lod })`; a blob, a floater or a quadruped from its state alone) and drawn, a blob shadow
 * under each humanoid, blob and quadruped on the level's floor. Humanoids wear the neutral humanoid (`body:humanoid`)
 * in their build, blobs `BLOB_BODY` with their features (`blobBody`), floaters `FLOATER_BODY`, quadrupeds
 * `QUADRUPED_BODY` (the dog).
 *
 * The crowd is made when the first crowd body arrives, and added to the stage's scene then: a stage with none has
 * none, and its scene graph is the one it had before. Each look is prepared (its batches made) when the first body
 * wearing it arrives; `register` registers the crowd's batches, present and future, with the warm-up and adds the
 * prepared looks to the shader key, so the frame after a new look arrives warms up first instead of stalling, and a
 * crowd growing in a look it has already built builds no pipeline (its new pages share their batch's shader).
 *
 * Invariants: presentation only (doctrine: WebGPU only): it reads the components and writes nothing back; its rigs
 * are its own, loaded from the component at every pose, so drawing, LOD, culling or not drawing never changes the
 * hash; every object it makes is under the crowd's root.
 *
 * @example
 * // const crowd = createStageCrowd({ scene: stage.scene, materials: library, level });
 * // const drawn = crowd.capture(world.query('crowdBody'), world.dt); // the ids drawn as crowd bodies
 * // crowd.draw(0.5, camera); // halfway between the last two steps, as the camera sees them
 * @see engine/gfx/stageCrowd.test.ts
 */
import { type Camera, type Material, type Scene } from 'three/webgpu';
import { AnimatorPool, type AnimatorData } from '../anim/character';
import { Blob, BLOB, type BlobState } from '../anim/blob';
import { Floater, type FloaterState } from '../anim/floater';
import { Quadruped, type QuadrupedState } from '../anim/quadruped';
import { Vector3 } from '../core/math';
import { registry as sharedRegistry, type Registry } from '../core/registry';
import type { CrowdBody } from '../sim/crowdBodies';
import type { EntityData } from '../sim/state';
import { floorHeight } from '../world/level/heights';
import type { CompiledLevel } from '../world/level/types';
import { BLOB_BODY, blobBody, type BlobFeatures } from './puppets/bodies/blob';
import { FLOATER_BODY } from './puppets/bodies/floater';
import { QUADRUPED_BODY } from './puppets/bodies/quadruped';
import { compileBody, type CompiledBody } from './puppets/compile';
import { createCrowd, type Crowd, type RigBody, type RigJoints } from './puppets/crowd';
import type { Warmup } from './warmup';

/** What the stage's crowd is made from: where it goes, the materials, the level for the shadows' floor, a registry. */
export interface StageCrowdOptions {
  scene: Scene;
  materials: { get(id: string): Material };
  level?: CompiledLevel | null;
  registry?: Registry;
}

/** The crowd bodies on a stage (see the file comment). */
export interface StageCrowd {
  /** The crowd, made when the first crowd body arrives; null until then. */
  readonly crowd: Crowd | null;
  /** Reads the crowd bodies after a sim step of `dt` s (keeps the place before); returns the ids it draws. */
  capture(entities: Iterable<EntityData>, dt?: number): Set<number>;
  /** Poses and draws every body `camera` sees, `alpha` (0 to 1) of the way between its last two places; how many. */
  draw(alpha: number, camera: Camera): number;
  /** Registers the crowd's batches and its looks with `warmup`; `dispose()` undoes it. */
  register(warmup: Pick<Warmup, 'register' | 'keyPart'>): { dispose(): void };
  /** Frees the crowd. */
  dispose(): void;
}

/** Where a body stands and faces. */
interface Place {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** A crowd body as the stage holds it: its component, and its places a step ago and now. */
interface Held {
  body: CrowdBody;
  before: Place;
  after: Place;
}

/** The radius (m) of a floater's sphere as the crowd culls it: its core and its motes' orbit. */
const FLOATER_REACH = 0.7;
/** A blob's sphere for culling, in its radii: its body, stretched, its wings and its leap. */
const BLOB_REACH = 2.6;
/** The radius (m) of a quadruped's sphere as the crowd culls it, about its body: its head to its tail's tip. */
const QUADRUPED_REACH = 0.8;

/** The shorter way from angle `a` to `b`, `k` of the way. */
function lerpAngle(a: number, b: number, k: number): number {
  return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
}

/** A blob's features from its look's word. */
const featuresOf = (look: string): BlobFeatures =>
  look === 'horns' ? { horns: true } : look === 'ears' ? { ears: true } : look === 'wings' ? { wings: true } : {};

/** Builds the crowd bodies of a stage (see the file comment). */
export function createStageCrowd(options: StageCrowdOptions): StageCrowd {
  const registry = options.registry ?? sharedRegistry;
  const held = new Map<number, Held>();
  const humanoids = new Map<string, CompiledBody>();
  const blobLooks = new Map<string, RigBody>();
  const looks = new Set<string>();
  const warmups = new Set<Pick<Warmup, 'register' | 'keyPart'>>();
  const registrations = new Map<Pick<Warmup, 'register' | 'keyPart'>, { dispose(): void }>();
  const animators = new AnimatorPool();
  const blobs = new Map<number, Blob>();
  const floater = new Floater();
  const quadruped = new Quadruped();
  const [ground, at] = [new Vector3(), new Vector3()];
  let crowd: Crowd | null = null;
  let dt = 1 / 60;

  /** The crowd, made now if it is not yet, and registered with every warm-up so far. */
  function made(): Crowd {
    if (crowd) return crowd;
    crowd = createCrowd({ materials: options.materials, name: 'crowd' });
    options.scene.add(crowd.root);
    for (const warmup of warmups) registrations.set(warmup, crowd.register(warmup, 'stage:crowd'));
    return crowd;
  }
  /** Prepares the look `key` once, with the body `make` builds. */
  function prepare<T extends CompiledBody | RigBody>(key: string, cache: Map<string, T>, make: () => T): T {
    let body = cache.get(key);
    if (!body) {
      cache.set(key, (body = make()));
      made().prepare(body);
      looks.add(key);
    }
    return body;
  }
  const humanoidOf = (build: string) =>
    prepare(`humanoid:${build}`, humanoids, () => compileBody('body:humanoid', build, { registry }));
  const blobLookOf = (look: string) =>
    prepare(`blob:${look}`, blobLooks, () => (look ? blobBody(featuresOf(look)) : BLOB_BODY));
  const floaterLook = () => prepare('floater', blobLooks, () => FLOATER_BODY);
  const quadrupedLook = () => prepare('quadruped', blobLooks, () => QUADRUPED_BODY);
  const floorAt = (x: number, z: number) => (options.level ? floorHeight(options.level, x, z) : 0);

  const stageCrowd: StageCrowd = {
    get crowd() {
      return crowd;
    },
    capture(entities, step) {
      if (step !== undefined && step > 0) dt = step;
      const seen = new Set<number>();
      for (const entity of entities) {
        const body = entity.crowdBody as CrowdBody | undefined;
        if (!body || seen.has(entity.id)) continue;
        seen.add(entity.id);
        if (body.rig === 'humanoid') humanoidOf(body.look || 'build:chibi');
        else if (body.rig === 'blob') blobLookOf(body.look);
        else if (body.rig === 'quadruped') quadrupedLook();
        else floaterLook();
        const place = { x: body.x, y: body.y, z: body.z, yaw: body.yaw };
        const last = held.get(entity.id);
        held.set(entity.id, { body, before: last ? last.after : place, after: place });
      }
      for (const id of held.keys()) if (!seen.has(id)) held.delete(id);
      animators.prune((id) => held.has(id));
      return seen;
    },
    draw(alpha, camera) {
      if (!crowd) return 0;
      const k = Math.min(1, Math.max(0, alpha));
      crowd.begin(camera);
      let drawn = 0;
      for (const [id, { body, before: a, after: b }] of held) {
        const [x, y, z] = [a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k];
        if (body.rig === 'humanoid') {
          const compiled = humanoidOf(body.look || 'build:chibi');
          const band = crowd.see(x, y + compiled.skeleton.offsets[1], z, compiled.reach);
          if (!band || !Object.keys(body.state).length) continue;
          const animator = animators.get(id, body.state as unknown as AnimatorData, { dt });
          animator.pose({ at: ground.set(x, y, z), yaw: lerpAngle(a.yaw, b.yaw, k), lod: band.pose });
          crowd.humanoid(compiled, animator.body.pose, { band, floor: floorAt(x, z) });
        } else if (body.rig === 'blob') {
          const radius = body.size || BLOB.radius;
          const band = crowd.see(x, y + radius, z, radius * BLOB_REACH);
          if (!band || !Object.keys(body.state).length) continue;
          let blob = blobs.get(radius);
          if (!blob) blobs.set(radius, (blob = new Blob({ radius })));
          Object.assign(blob.state, body.state as unknown as BlobState);
          blob.position.set(x, y, z);
          crowd.blob(blob, { band, floor: floorAt(x, z), body: blobLookOf(body.look) });
        } else if (body.rig === 'quadruped') {
          const band = crowd.see(x, y + 0.4, z, QUADRUPED_REACH);
          if (!band || !Object.keys(body.state).length) continue;
          quadruped.state = body.state as unknown as QuadrupedState; // read only: its pose never writes the state
          quadruped.position.set(x, y, z);
          crowd.rig(quadrupedLook(), quadruped.pose() as RigJoints, { band, floor: floorAt(x, z) });
        } else {
          const band = crowd.see(x, y, z, FLOATER_REACH);
          if (!band || !Object.keys(body.state).length) continue;
          Object.assign(floater.state, body.state as unknown as FloaterState);
          floater.position.copy(at.set(x, y, z));
          crowd.floater(floater, { band, body: floaterLook() });
        }
        drawn++;
      }
      crowd.end();
      return drawn;
    },
    register(warmup) {
      warmups.add(warmup);
      if (crowd) registrations.set(warmup, crowd.register(warmup, 'stage:crowd'));
      const key = warmup.keyPart('stage:crowd', () => [...looks].sort().join(';'));
      return {
        dispose() {
          warmups.delete(warmup);
          registrations.get(warmup)?.dispose();
          registrations.delete(warmup);
          key.dispose();
        },
      };
    },
    dispose() {
      for (const registration of registrations.values()) registration.dispose();
      registrations.clear();
      warmups.clear();
      crowd?.root.removeFromParent();
      crowd?.dispose();
      crowd = null;
      held.clear();
      humanoids.clear();
      blobLooks.clear();
      looks.clear();
    },
  };
  return stageCrowd;
}
