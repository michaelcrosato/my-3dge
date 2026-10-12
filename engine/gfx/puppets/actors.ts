/**
 * @file Actors on the stage (PLAN.md WP 3.10, §6.4's view; I-21): every actor with an animator (engine/sim/actors.ts:
 * an entity with the components `actor` and `animator`) drawn as a puppet (engine/gfx/puppets/draw.ts) of the neutral
 * humanoid (`ACTOR_BODY`) in its animator's build, posed every frame by the presentation's half of its animator
 * (engine/anim/character.ts's `pose`) where its feet are at the frame's alpha, so it walks, dashes and jumps as the sim
 * steps it. The stage (engine/gfx/stage.ts) draws these instead of stand-ins.
 *
 * `capture(entities, dt)` after each sim step keeps each actor's last two places (feet and heading) and its animator's
 * data; `draw(alpha)` poses each puppet `alpha` of the way from the one before to the last. `player()` is the first
 * player actor (in id order) as the last draw put it: its feet and, with a puppet, its skeleton, world pose and eye
 * (the head socket, engine/gfx/cameras/first.ts's `eyePoint`), which the cameras follow (engine/app/view.ts).
 * `cull(eye)` hides the player's body from a first-person camera at `eye` (`nearBodyCull`: all but the hands, and any
 * part near the eye) and returns the joints it hid; `cull(null)` shows it whole. `trails()` is each puppet's trail as
 * its last pose sampled it (WP 6.7: what its strike sweeps, oldest first), which the stage's effects draw as ribbons.
 *
 * A puppet is named `actor#<id>`, as its stand-in would be, and carries `userData.entity`; the player's also carries
 * `userData.protagonist`, so the ID pass reports "the hero" (engine/gfx/idpass.ts).
 *
 * Invariants: presentation only (doctrine: WebGPU only): its animators are its own, an `AnimatorPool` loaded from the
 * sim's data at every pose and never writing it, so drawing, culling or not drawing never changes the hash (the
 * animator's own invariant, engine/anim/character.test.ts); one puppet per actor, made again only when its build
 * changes; every object it makes is under `root`. A puppet is a skinned mesh of two draw calls: right for heroes and
 * a few foes; crowds draw through instanced batches (WP 5.4).
 *
 * @example
 * // const actors = createActorPuppets({ materials: library });
 * // stage.scene.add(actors.root);
 * // const drawn = actors.capture(world.query('actor'), world.dt); // the ids drawn as puppets
 * // actors.draw(0.5);
 * // actors.player()?.eye; // where a first-person camera sits
 * @see engine/gfx/puppets/actors.test.ts
 */
import { Group } from 'three/webgpu';
import { AnimatorPool, type AnimatorData, type TrailSample } from '../../anim/character';
import type { WorldPose } from '../../anim/fk';
import type { JointName, Skeleton } from '../../anim/skeleton';
import { lerpAng, Vector3 } from '../../core/math';
import { registry as sharedRegistry, type Registry } from '../../core/registry';
import type { EntityData } from '../../sim/state';
import { eyePoint, nearBodyCull } from '../cameras/first';
import type { Vec3 } from '../cameras/pose';
import type { Warmup } from '../warmup';
import { compileBody } from './compile';
import { createPuppet, puppetMaterials, type Puppet, type PuppetMaterials } from './draw';

/** The body every animated actor wears (engine/gfx/puppets/bodies/humanoid.ts). */
export const ACTOR_BODY = 'body:humanoid';

/** Where an actor stands: its feet (m) and heading (rad). */
interface Place {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** What the module keeps of one actor. */
interface Held {
  before: Place;
  after: Place;
  player: boolean;
  data: AnimatorData | null;
  puppet: Puppet | null;
}

/** The player actor as the last draw put it. */
export interface PlayerView {
  readonly id: number;
  /** Its feet, m. */
  readonly feet: Vec3;
  /** With a puppet: its skeleton and world pose, and its eye (the head socket), m. */
  readonly posed: { readonly skeleton: Skeleton; readonly world: WorldPose; readonly eye: Vec3 } | null;
}

/** Actors drawn as puppets (see the file comment). */
export interface ActorPuppets {
  /** Every puppet, under one group. */
  readonly root: Group;
  /** The puppets, by entity id. */
  readonly puppets: ReadonlyMap<number, Puppet>;
  /** Reads the actors after a sim step (the sim's step `dt`, s); returns the ids it draws as puppets. */
  capture(entities: Iterable<EntityData>, dt?: number): ReadonlySet<number>;
  /** Poses every puppet `alpha` (0 to 1) of the way from its place a step ago to its last. */
  draw(alpha: number): void;
  /** The first player actor at the last draw, or null. */
  player(): PlayerView | null;
  /** Whether the last capture held a player actor. */
  hasPlayer(): boolean;
  /** Each puppet's trail as its last pose sampled it, by entity id (its animator's: oldest first, empty for none). */
  trails(): ReadonlyMap<number, readonly TrailSample[]>;
  /** Hides from a first-person camera at `eye` the player's body but its hands; null shows it. Returns what it hid. */
  cull(eye: Vec3 | null): JointName[];
  /** Registers the puppets with `warmup`, and their builds with its shader key. */
  register(warmup: Pick<Warmup, 'register' | 'keyPart'>): { dispose(): void };
  /** Frees the puppets' geometries. */
  dispose(): void;
}

/** Draws actors as puppets (see the file comment); `registry` holds the bodies and gets the puppets' materials. */
export function createActorPuppets(options: { materials: PuppetMaterials; registry?: Registry }): ActorPuppets {
  const registry = options.registry ?? sharedRegistry;
  puppetMaterials(registry);
  const root = new Group();
  root.name = 'actors';
  const held = new Map<number, Held>();
  const puppets = new Map<number, Puppet>();
  const pool = new AnimatorPool();
  const trails = new Map<number, readonly TrailSample[]>();
  const at = new Vector3();
  let step = 1 / 60;
  let shown: PlayerView | null = null;
  let players = 0;

  const puppetFor = (id: number, data: AnimatorData, player: boolean): Puppet => {
    let puppet = puppets.get(id);
    if (puppet && puppet.compiled.skeleton.build.id === data.build) return puppet;
    puppet?.dispose();
    puppet = createPuppet(compileBody(ACTOR_BODY, data.build, { registry }), {
      materials: options.materials,
      name: `actor#${id}`,
    });
    Object.assign(puppet.mesh.userData, { entity: id, component: 'actor', protagonist: player });
    root.add(puppet.mesh);
    puppets.set(id, puppet);
    return puppet;
  };

  return {
    root,
    puppets,
    capture(entities, dt = step) {
      step = dt;
      const seen = new Set<number>();
      const drawn = new Set<number>();
      for (const entity of entities) {
        const actor = entity.actor as (Place & { player?: boolean }) | undefined;
        if (!actor || seen.has(entity.id)) continue;
        seen.add(entity.id);
        const place = { x: actor.x, y: actor.y, z: actor.z, yaw: actor.yaw };
        const data = (entity.animator as AnimatorData | undefined) ?? null;
        const last = held.get(entity.id);
        const player = actor.player === true;
        const puppet = data ? puppetFor(entity.id, data, player) : null;
        held.set(entity.id, { before: last ? last.after : place, after: place, player, data, puppet });
        if (puppet) drawn.add(entity.id);
      }
      for (const id of [...held.keys()]) if (!seen.has(id)) held.delete(id);
      players = [...held.values()].filter((actor) => actor.player).length;
      for (const [id, puppet] of puppets) {
        if (drawn.has(id)) continue;
        puppet.dispose();
        puppets.delete(id);
        trails.delete(id);
      }
      pool.prune((id) => drawn.has(id));
      return drawn;
    },
    draw(alpha) {
      const k = Math.min(1, Math.max(0, alpha));
      shown = null;
      for (const [id, { before: a, after: b, player, data, puppet }] of [...held].sort(([p], [q]) => p - q)) {
        at.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
        const feet: Vec3 = [at.x, at.y, at.z];
        let posed: PlayerView['posed'] = null;
        if (puppet && data) {
          const animator = pool.get(id, data, { dt: step }).pose({ at, yaw: lerpAng(a.yaw, b.yaw, k) });
          puppet.setPose(animator.body.pose);
          trails.set(id, animator.trail);
          const { skeleton, world } = animator.body;
          posed = { skeleton, world, eye: eyePoint(skeleton, world) };
        }
        if (player && !shown) shown = { id, feet, posed };
      }
      root.updateMatrixWorld(true);
    },
    player: () => shown,
    trails: () => trails,
    hasPlayer: () => players > 0,
    cull(eye) {
      const hide = eye && shown?.posed ? nearBodyCull(shown.posed.skeleton, shown.posed.world, eye) : [];
      for (const [id, puppet] of puppets) puppet.hide(id === shown?.id ? hide : []);
      return hide;
    },
    register(warmup) {
      const registrations = [
        warmup.register('stage:actors', { objects: () => [...puppets.values()].map((puppet) => puppet.mesh) }),
        warmup.keyPart('stage:actors', () =>
          [...new Set([...puppets.values()].map((p) => p.compiled.skeleton.build.id))].sort().join(';'),
        ),
      ];
      return { dispose: () => registrations.forEach((registration) => registration.dispose()) };
    },
    dispose() {
      for (const puppet of puppets.values()) puppet.dispose();
      puppets.clear();
      held.clear();
      trails.clear();
      shown = null;
    },
  };
}
