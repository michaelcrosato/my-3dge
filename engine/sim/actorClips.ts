/**
 * @file Clips on actors (PLAN.md §10.4, WP 8.9): the clip layer (engine/anim/clip/layer.ts) in an actor's animator,
 * as sim data. `spawnActor`'s `clips` (engine/sim/actors.ts), or `addClips(w, id, { sets })` for a live actor, gives
 * an animated actor the component `clips`
 * (clipsets.ts `CLIPS_FIELDS`: the clip sets it plays from, its contact IK and blade, and the layer's state), so the
 * sim hashes, captures and restores what it plays; `playClip(w, id, clip, play?)` and `stopClip(w, id, fade?)` play and
 * stop a clip on it (the layer's `play` and `stop`), `seekClip(w, id, t)` puts the clip on top at a moment (a frame
 * step), `locomoteClips(w, id, loops)` picks loops by ground speed, and `clipLayerOf(w, id)` is the layer itself,
 * loaded from the component, to read. The view poses the layer over the body (engine/gfx/puppets/actors.ts), from the
 * same data.
 *
 * The system `actors.clips` (phase `anim`, after `actors.anim`) steps each layer once a tick at the actor's ground
 * speed (its controller's horizontal velocity) and writes its state back; it emits each of the layer's events as
 * `clip` `{ id, type, clip, name?, side? }`: a clip's own events (`event`, with its name and side), an attack's
 * `hit`, a fall's `landed`, and a one-shot's `end`.
 *
 * Invariants: everything a layer is in the sim is the component; the layers are a pool per world (clipsets.ts
 * `ClipLayerPool`), loaded from the components at every use, so a bake made while the sim steps is the sim's own and
 * the view never shares one. The system is added once per world, with the first actor's clips. The clip sets come from the
 * registry (`defineClipSet`), registered before the scene starts.
 *
 * @example
 * import { createCharacter } from '../physics/character';
 * import { spawnActor } from './actors';
 * // in a scene with a physics world, the sets registered (defineClipSet):
 * // const id = spawnActor(w, { at: [0, 0, 0], character: createCharacter(), anim: { build: 'build:heroic' } });
 * // addClips(w, id, { sets: ['clipset:quaternius'] });
 * // playClip(w, id, 'QUATERNIUS/Wave', { mask: 'upper', walk: true });
 * // w.step(); w.get(id).clips.state.slots[0].clip; // 'QUATERNIUS/Wave'
 * @see engine/sim/actorClips.test.ts
 */
import { CLIPS_FIELDS, ClipLayerPool, emptyClipState, type ClipsData } from '../anim/clip/clipsets';
import type { Build } from '../anim/builds';
import { ClipLayer, type ClipLayerState, type ClipPlay } from '../anim/clip/layer';
import { codeError } from '../core/log';
import { registry as sharedRegistry, type Registry } from '../core/registry';
import type { ActorComponents } from './actors';
import { defineComponent } from './state';
import type { World } from './world';

/** Declares the component `clips` on `registry`, once. */
export function defineClipKinds(registry: Registry = sharedRegistry): void {
  if (registry.kinds().includes('component') && registry.has('component', 'clips')) return;
  const description =
    'An actor’s clip layer (engine/anim/clip/layer.ts) as plain data: the clip sets it plays from, its contact IK and blade, and what it plays.';
  defineComponent('clips', { description, fields: CLIPS_FIELDS }, registry);
}
defineClipKinds();

/** What `spawnActor`'s `clips` and `addClips` take. */
export interface ClipsSpec {
  /** The clip sets it plays from, by id (`clipset:quaternius`): a bare clip name is the first set's. */
  sets: readonly string[];
  /** Contact IK and the lift when posed (true). */
  ik?: boolean;
  /** A blade held in the right hand, m, kept above the floor (0). */
  blade?: number;
  /** The clip it plays from the start (`SET/Clip`, or the clip and how it plays: the layer's `play`); none when absent. */
  play?: string | ({ clip: string } & ClipPlay);
}

/** An entity with an animated actor and its clips. */
type ClipActor = Pick<ActorComponents, 'actor' | 'animator'> & { id: number; clips: ClipsData };

/** The layers of each world (see the file comment). */
const pools = new WeakMap<World, ClipLayerPool>();

/** The pool of `w`, pruned of the despawned. */
function poolOf(w: World): ClipLayerPool {
  let pool = pools.get(w);
  if (!pool) pools.set(w, (pool = new ClipLayerPool()));
  pool.prune((id) => w.has(id));
  return pool;
}

/** The entity `id`, an animated actor with clips; throws `SIM_BAD_ARGUMENT` naming `where` for another. */
function clipActor(w: World, id: number, where: string): ClipActor {
  const entity = w.get(id) as Partial<ClipActor> | undefined;
  if (!entity?.actor || !entity.animator || !entity.clips)
    throw codeError('SIM_BAD_ARGUMENT', {
      where,
      value: String(id),
      expected: 'an animated actor given clips (addClips)',
    });
  return entity as ClipActor;
}

/**
 * The component `clips` for `spec` on an animator of `build` (its `play` playing, else nothing), the world given the
 * system `actors.clips`: what `spawnActor`'s `clips` spawns an actor with. Throws `CORE_NO_ENTRY` for a set not
 * registered, naming the closest, and `ANIM_UNKNOWN_CLIP` for a clip the sets lack.
 */
export function clipsFor<C extends object>(world: World<C>, spec: ClipsSpec, build: Build | string): ClipsData {
  const w = world as unknown as World;
  const pool = poolOf(w);
  const library = spec.sets.map((set) => pool.library(set));
  if (!w.systems.has('actors.clips')) w.systems.add('actors.clips', stepClips, { phase: 'anim' });
  const data = { sets: [...spec.sets], ik: spec.ik ?? true, blade: spec.blade ?? 0, state: emptyClipState() };
  if (spec.play === undefined) return data;
  const { clip, ...play } = typeof spec.play === 'string' ? { clip: spec.play } : spec.play;
  const layer = new ClipLayer({ library, build, dt: w.dt, ik: data.ik, blade: data.blade }).play(clip, play);
  return { ...data, state: layer.save() };
}

/**
 * Gives the live animated actor `id` the component `clips` (`clipsFor`); an actor spawned in the same step takes
 * them from `spawnActor`'s `clips`. Throws `SIM_BAD_ARGUMENT` for an entity without an animator.
 */
export function addClips<C extends object>(world: World<C>, id: number, spec: ClipsSpec): ClipsData {
  const w = world as unknown as World;
  const entity = w.get(id) as Partial<ClipActor> | undefined;
  if (!entity?.actor || !entity.animator)
    throw codeError('SIM_BAD_ARGUMENT', { where: 'addClips(w, id, spec)', value: String(id), expected: 'a live animated actor’s id' }); // prettier-ignore
  return w.add(id, 'clips', clipsFor(w, spec, entity.animator.build) as never) as unknown as ClipsData;
}

/** Changes the clip layer of `id` with `change` and writes its state back; returns the state. */
function change(w: World, id: number, where: string, how: (layer: ClipLayer) => void): ClipLayerState {
  const { animator, clips } = clipActor(w, id, where);
  const layer = poolOf(w).get(id, clips, animator.build, w.dt);
  how(layer);
  return (clips.state = layer.save());
}

/**
 * Plays `clip` (`SET/Clip`, or bare) on actor `id`, fading in over what plays (the layer's `play`). Throws
 * `ANIM_UNKNOWN_CLIP` naming the closest clips, and `SIM_BAD_ARGUMENT` for an actor without clips.
 */
export function playClip<C extends object>(world: World<C>, id: number, clip: string, play?: ClipPlay): ClipLayerState {
  return change(world as unknown as World, id, 'playClip(w, id, clip)', (layer) => layer.play(clip, play));
}

/** Fades out the clip on top of actor `id` over `fade` seconds (its `out`), with what it covers. */
export function stopClip<C extends object>(world: World<C>, id: number, fade?: number): ClipLayerState {
  return change(world as unknown as World, id, 'stopClip(w, id)', (layer) => layer.stop(fade));
}

/** Plays `loops.idle`, `walk` or `run` on actor `id` by its ground speed, each at that speed; null stops them. */
export function locomoteClips<C extends object>(
  world: World<C>,
  id: number,
  loops: ClipLayerState['moving'],
): ClipLayerState {
  return change(world as unknown as World, id, 'locomoteClips(w, id, loops)', (layer) => layer.locomote(loops));
}

/**
 * Puts the clip on top of actor `id` at `t` clip seconds (kept within 0 and its length), its fade done: a frame step
 * is `seekClip(w, id, frame / BAKE_FPS)`. Nothing playing, it changes nothing.
 */
export function seekClip<C extends object>(world: World<C>, id: number, t: number): ClipLayerState {
  return change(world as unknown as World, id, 'seekClip(w, id, t)', (layer) => {
    const top = layer.current;
    if (!top) return;
    const [library, name] = layer.resolve(top.clip);
    const { dur } = library.clip(name);
    [top.t, top.w, top.stopping] = [Math.min(Math.max(0, t), dur), 1, 0];
  });
}

/** The clip layer of actor `id`, loaded from its component, to read (`current`, `inspect()`); changes are not kept. */
export function clipLayerOf<C extends object>(world: World<C>, id: number): ClipLayer {
  const w = world as unknown as World;
  const { animator, clips } = clipActor(w, id, 'clipLayerOf(w, id)');
  return poolOf(w).get(id, clips, animator.build, w.dt);
}

/** The system `actors.clips`: each layer's tick at its actor's ground speed, in id order; emits its events. */
function stepClips(w: World): void {
  const pool = poolOf(w);
  for (const { id, actor, animator, clips } of w.query('actor', 'animator', 'clips') as unknown as ClipActor[]) {
    const layer = pool.get(id, clips, animator.build, w.dt);
    const events = layer.step({ groundSpeed: Math.hypot(actor.vx, actor.vz) });
    clips.state = layer.save();
    for (const { type, ...event } of events) w.emit('clip', { id, type, ...event });
  }
}
