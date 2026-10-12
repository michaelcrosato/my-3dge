/**
 * @file Actors on the stage (PLAN.md WP 3.10, §6.4's view; I-21): every actor with an animator (engine/sim/actors.ts:
 * an entity with the components `actor` and `animator`) drawn as a puppet (engine/gfx/puppets/draw.ts) of the neutral
 * humanoid (`ACTOR_BODY`), or of the body its component `puppet` names (`body:mannequin`, WP 8.9), in its animator's
 * build, posed every frame by the presentation's half of its animator (engine/anim/character.ts's `pose`) where its
 * feet are at the frame's alpha, so it walks, dashes and jumps as the sim steps it; an actor with clips (the component
 * `clips`, engine/sim/actorClips.ts) has its clip layer laid over the body, loaded from the same data (a
 * `ClipLayerPool` of the view's own, engine/anim/clip/clipsets.ts). The stage (engine/gfx/stage.ts) draws these
 * instead of stand-ins.
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
 * WP 6.2 in the box (WP 7.8): an actor's `reactions` (engine/sim/reactions.ts) are a `Reactions` layer on its puppet's
 * animator, loaded at every pose (its flinch bends its spine; a body down on its face is drawn so), its `secondary` a
 * `Secondary` layer whose chains hang under the puppet as meshes (engine/gfx/puppets/chains.ts: `actor#<id>/cape`…).
 *
 * Invariants: presentation only (doctrine: WebGPU only): its animators and their layers are its own, loaded from the
 * sim's data at every pose and never writing it, so drawing, culling or not drawing never changes the hash (the
 * animator's own invariant, engine/anim/character.test.ts); one puppet per actor, made again only when its build
 * changes, its layers when its animator or their components do; every object it makes is under `root`. A puppet is a
 * skinned mesh of two draw calls: right for heroes and a few foes; crowds draw through instanced batches (WP 5.4).
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
import { AnimatorPool, type Animator, type AnimatorData, type TrailSample } from '../../anim/character';
import { ClipLayerPool, type ClipsData } from '../../anim/clip/clipsets';
import type { WorldPose } from '../../anim/fk';
import { Reactions, type ReactionState } from '../../anim/reactions';
import { Secondary } from '../../anim/secondary';
import type { JointName, Skeleton } from '../../anim/skeleton';
import { lerpAng, Vector3 } from '../../core/math';
import { registry as sharedRegistry, type Registry } from '../../core/registry';
import type { SecondaryComponent } from '../../sim/reactions';
import type { EntityData } from '../../sim/state';
import { eyePoint, nearBodyCull } from '../cameras/first';
import type { Vec3 } from '../cameras/pose';
import type { Warmup } from '../warmup';
import { createChainMeshes, type ChainMeshes } from './chains';
import { compileBody } from './compile';
import { createPuppet, puppetMaterials, type Puppet, type PuppetMaterials } from './draw';

/** The body every animated actor wears (engine/gfx/puppets/bodies/humanoid.ts). */
export const ACTOR_BODY = 'body:humanoid';

/** A puppet's part of the warm-up's key: its build, and its body when not `ACTOR_BODY`. */
const worn = (build: string, body = ACTOR_BODY) => (body === ACTOR_BODY ? build : `${build}+${body}`);

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
  /** Its clip layer's data (the component `clips`), or null. */
  clips: ClipsData | null;
  puppet: Puppet | null;
  reactions: ReactionState | null;
  secondary: SecondaryComponent | null;
}

/** The view's own layers on one actor's puppet animator: its reactions, its secondary motion and their meshes. */
interface Layers {
  animator: Animator;
  key: string;
  reactions: Reactions | null;
  secondary: Secondary | null;
  chains: ChainMeshes | null;
}

/** What an actor's layers are made for: whether it has reactions, and its secondary motion. */
const layersKey = (held: Held) => {
  const look = held.secondary;
  const parts = look ? [look.hair, look.cape ? 'cape' : '', look.tail ? 'tail' : ''].filter(Boolean) : [];
  const drawn = look && parts.length ? `${parts.join('+')}@${look.color}` : '';
  return `${held.reactions ? 'reactions' : ''}|${drawn}`;
};

/** Takes `layers` off their animator and frees their meshes. */
function dropLayers(layers: Layers): void {
  if (layers.reactions) layers.animator.drop(layers.reactions.name).drop(layers.reactions.lyingLayer.name);
  if (layers.secondary) layers.animator.drop(layers.secondary.name);
  layers.chains?.dispose();
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
  /** The view's layers on each puppet's animator, by entity id: its `Reactions` and `Secondary`, when it has them. */
  layers(): ReadonlyMap<number, { readonly reactions: Reactions | null; readonly secondary: Secondary | null }>;
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
  const clipPool = new ClipLayerPool(registry);
  const trails = new Map<number, readonly TrailSample[]>();
  const layers = new Map<number, Layers>();
  const at = new Vector3();
  let step = 1 / 60;
  let shown: PlayerView | null = null;
  let players = 0;

  const puppetFor = (id: number, data: AnimatorData, player: boolean, body: string): Puppet => {
    let puppet = puppets.get(id);
    if (puppet && puppet.compiled.skeleton.build.id === data.build && puppet.compiled.body.id === body) return puppet;
    puppet?.dispose();
    puppet = createPuppet(compileBody(body, data.build, { registry }), {
      materials: options.materials,
      name: `actor#${id}`,
    });
    Object.assign(puppet.mesh.userData, { entity: id, component: 'actor', protagonist: player });
    root.add(puppet.mesh);
    puppets.set(id, puppet);
    return puppet;
  };

  /** The layers of actor `id`, whose puppet animator is `animator`: made again when what they are made for changed. */
  const layersFor = (id: number, animator: Animator, held: Held, puppet: Puppet): Layers => {
    const key = layersKey(held);
    let own = layers.get(id);
    if (own?.animator !== animator || own.key !== key) {
      if (own) dropLayers(own);
      const look = held.secondary;
      const reactions = held.reactions ? new Reactions({ name: 'view:reactions' }).attach(animator) : null;
      const wanted = look && (look.hair || look.cape || look.tail) ? look : null;
      const secondary = wanted
        ? new Secondary({ name: 'view:secondary', squash: false, cape: wanted.cape, tail: wanted.tail, ...(wanted.hair ? { hair: wanted.hair } : {}) }) // prettier-ignore
        : null;
      if (secondary) animator.use('secondary', secondary);
      const material = options.materials.get(puppet.compiled.body.material);
      const chains =
        secondary && wanted
          ? createChainMeshes(secondary, { material, color: wanted.color, name: `actor#${id}` })
          : null;
      own = { animator, key, reactions, secondary, chains };
      layers.set(id, own);
    }
    const meshes = own.chains?.meshes ?? [];
    if (meshes.length && meshes[0].parent !== puppet.mesh) puppet.mesh.add(...meshes); // a puppet made again
    return own;
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
        const clips = (entity.clips as ClipsData | undefined) ?? null;
        const body = (entity.puppet as { body?: string } | undefined)?.body ?? ACTOR_BODY;
        const last = held.get(entity.id);
        const player = actor.player === true;
        const puppet = data ? puppetFor(entity.id, data, player, body) : null;
        const reactions = (entity.reactions as ReactionState | undefined) ?? null;
        const secondary = (entity.secondary as SecondaryComponent | undefined) ?? null;
        const before = last ? last.after : place;
        held.set(entity.id, { before, after: place, player, data, clips, puppet, reactions, secondary });
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
      for (const [id, own] of layers) {
        if (drawn.has(id)) continue;
        dropLayers(own);
        layers.delete(id);
      }
      pool.prune((id) => drawn.has(id));
      clipPool.prune((id) => drawn.has(id));
      return drawn;
    },
    draw(alpha) {
      const k = Math.min(1, Math.max(0, alpha));
      shown = null;
      for (const [id, actor] of [...held].sort(([p], [q]) => p - q)) {
        const { before: a, after: b, player, data, clips, puppet } = actor;
        at.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
        const feet: Vec3 = [at.x, at.y, at.z];
        let posed: PlayerView['posed'] = null;
        if (puppet && data) {
          const animator = pool.get(id, data, { dt: step });
          // its clips, laid over the body as the sim plays them (engine/sim/actorClips.ts)
          const layer = clips ? clipPool.get(id, clips, animator.body.build, step) : null;
          if (animator.layer('clips') !== (layer ?? undefined)) animator.drop('clips');
          if (layer && !animator.layer('clips')) animator.use('clips', layer);
          const own = layersFor(id, animator, actor, puppet);
          if (own.reactions && actor.reactions) own.reactions.load(actor.reactions);
          animator.pose({ at, yaw: lerpAng(a.yaw, b.yaw, k) });
          puppet.setPose(animator.body.pose);
          own.chains?.update();
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
    layers: () => layers,
    hasPlayer: () => players > 0,
    cull(eye) {
      const hide = eye && shown?.posed ? nearBodyCull(shown.posed.skeleton, shown.posed.world, eye) : [];
      for (const [id, puppet] of puppets) puppet.hide(id === shown?.id ? hide : []);
      return hide;
    },
    register(warmup) {
      const chains = () => [...layers.values()].flatMap((own) => own.chains?.meshes ?? []);
      const registrations = [
        warmup.register('stage:actors', {
          objects: () => [...[...puppets.values()].map((puppet) => puppet.mesh), ...chains()],
        }),
        warmup.keyPart('stage:actors', () => {
          const bodies = [...puppets.values()].map(({ compiled }) =>
            worn(compiled.skeleton.build.id, compiled.body.id),
          );
          const parts = [...new Set(chains().map((mesh) => String(mesh.userData.part)))].sort().join('+');
          const worns = [...new Set(bodies)].sort().join(';');
          return parts ? `${worns}|${parts}` : worns;
        }),
      ];
      return { dispose: () => registrations.forEach((registration) => registration.dispose()) };
    },
    dispose() {
      for (const own of layers.values()) dropLayers(own);
      layers.clear();
      for (const puppet of puppets.values()) puppet.dispose();
      puppets.clear();
      held.clear();
      trails.clear();
      shown = null;
    },
  };
}
