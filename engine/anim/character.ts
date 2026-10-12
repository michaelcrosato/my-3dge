/**
 * @file The character animator (PLAN.md WP 3.7, §6.4, ADR-0009; I-09): `Animator` drives a body (the procedural
 * humanoid, engine/anim/humanoid.ts) through an explicit, named layer stack, keeps its sockets, samples its trail
 * (socket history), reports its footsteps and returns all of it as plain JSON (`inspect()`).
 *
 * The stack (weights.ts `SLOTS`, in order): weights → base → override → solve → clips → additive → post → physics →
 * secondary. The body fills the first four: the named weights, locomotion, poses, stances and a move (the body state
 * `body`: its arm path and body motion, WP 6.1), and the IK solve. The others take `AnimLayer`s (`use(slot, layer)`): clips (WP
 * 8.4), additive reactions and secondary motion (WP 6.2), post IK (the feet on probed ground, grips, aim), a
 * ragdoll blend (WP 10.2). A layer writes the pose at full strength; the animator fades it by its weight.
 *
 * The two update paths (§6.4):
 * - `step(states)`, the sim's, for every character, every tick: it checks the body states (states.ts), eases the
 *   body's weights and clocks, and lists the tick's `events` (`footstep` as a foot lands). Cheap, and part of the
 *   gameplay hash: `save()` writes what it changed as plain data (`ANIMATOR_FIELDS`), `load()` reads it back.
 * - `pose(options)`, the presentation's, for characters that are drawn: the body's solve, the layers, FK, the trail.
 *   It re-solves once per tick and between ticks moves the last pose with the body. `lod` (an index into weights.ts
 *   `LOD`) is a view-only hook: fewer layers, fewer re-solves.
 * - `preciseHits`: the sim poses the character itself every tick (engine/sim/actors.ts), at full detail with no
 *   layers, so its trail (the weapon sweeps) is sim data, saved with the rest. It never depends on visibility.
 *
 * Invariants: `pose()` writes only the pose, its FK, the trail and the layers' own state, never what `save()` writes:
 * posing as often as wanted, or never, leaves the sim's hash as it is (character.test.ts). The camera never feeds the
 * animator. `AnimatorPool` keeps an animator per entity, loaded from the entity's data at every `get`.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:1885-1897` (the trail: what each part's ribbon spans, the ages, the
 * jump that starts a new ribbon, 12 samples at most).
 *
 * @example
 * import { Vector3 } from '../core/math';
 * const hero = new Animator({ build: 'build:heroic', weapon: 'sword' });
 * for (let i = 0; i < 60; i++) hero.update({ velocity: new Vector3(0, 0, 5), position: new Vector3(0, 0, i / 12) });
 * hero.inspect().layers[1]; // { slot: 'base', by: 'humanoid', active: { speed: 1 } }
 * hero.step({ pose: 'cheer', trail: 'blade' }).events; // [] standing; while walking, footsteps: { type: 'footstep', side: 'L', … }
 * hero.pose().trail.length; // 1: the sword's first sample
 * @see engine/anim/character.test.ts
 */
import { codeError, defineCodes, log as engineLog, type Log } from '../core/log';
import { MathUtils, Quaternion, Vector3 } from '../core/math';
import type { Rng } from '../core/rng';
import { copyValue, defineSchema } from '../core/schema';
import { fru, type LimbSide } from './authoring';
import { forwardKinematics, jointPosition, jointRotation, socketPosition } from './fk';
import { Humanoid, type HumanoidOptions, type HumanoidState } from './humanoid';
import { blendPoses, Pose } from './pose';
import { WEAPONS, type Weapon } from './poses';
import { SOCKETS, type SocketName } from './skeleton';
import { checkBodyStates, TRAILS, type AnimatorInput, type TrailName } from './states';
import { activeWeights, LAYER_SLOTS, LOD, SLOTS, type AnimLayer, type LayerSlot, type SlotName } from './weights';

/** The codes this module raises, with their fixes. */
export const CHARACTER_CODES = defineCodes('anim', {
  ANIM_BAD_LAYER: {
    template: 'layer {name}: {problem}',
    fix: 'give each layer its own name and one of the slots {slots}',
    doc: 'Raised by `Animator.use` (engine/anim/character.ts) for a slot that takes no layers or a name already in use.',
  },
});

/** Footsteps: a foot lands as the gait's phase crosses π/2 + kπ, the left for even k (locomotion.ts `gaitFoot`). */
export const FOOTSTEP = {
  minSpeed: 0.1, // the speed weight under which the feet shuffle without a footstep
  maxWeight: 0.5, // the climb or down weight over which no foot lands
} as const;

/** The trail's tuning: the source's numbers, lengths ÷ 16 in metres before the build's size. */
export const TRAIL = {
  samples: 12, // the most samples a trail keeps
  maxAge: 0.14, // seconds a sample lasts while the part trails…
  fadeAge: 0.07, // …and after, so the ribbon clears quickly
  jump: 0.875, // metres the tip may move in a tick before a new ribbon starts (a teleport, a respawn)
  bladeBase: 0.125, // metres from the grip along the sword where its ribbon starts…
  bladeTip: 0.6875, // …and ends: the sword's length
  blade: 1, // a sword's ribbon weight
  limb: 0.6, // a fist's or a foot's
} as const;

/** An event of the tick `step` took. */
export type AnimEvent = { type: 'footstep'; side: LimbSide; speed: number };

/** One trail sample: the part's base and tip, world metres, at the body's `clock`, and its ribbon's weight. */
export type TrailSample = Readonly<{ base: Vector3; tip: Vector3; clock: number; weight: number }>;

/** The body's state at rest (the default of `ANIMATOR_FIELDS.state`). */
const REST: HumanoidState = copyValue(new Humanoid({ clock: 0 }).state);

/** An animator as plain data: its make (build, weapon, preciseHits) and what `step` changes. */
export const ANIMATOR_FIELDS = defineSchema({
  build: { type: 'string', default: 'build:chibi', description: 'Its build’s id.' },
  weapon: { type: 'string', enum: Object.keys(WEAPONS), default: 'none', description: 'What its right hand holds.' },
  preciseHits: { type: 'boolean', default: false, description: 'Posed in the sim every tick, so weapon sweeps hit.' },
  started: { type: 'boolean', default: false, description: 'Whether its breathing phase was drawn from its stream.' },
  state: { type: 'object', default: REST, description: 'The body’s state (HumanoidState): what its step eases.' },
  trailing: { type: 'string', default: '', description: 'The part that trailed at its last step; empty for none.' },
  trail: { type: 'array', default: [], description: 'With preciseHits, the trail: base, tip, clock, weight a sample.' },
});

/** What `ANIMATOR_FIELDS` holds. */
export interface AnimatorData {
  build: string;
  weapon: string;
  preciseHits: boolean;
  started: boolean;
  state: HumanoidState;
  trailing: string;
  trail: number[];
}

/** What an animator is made from: the humanoid's options, and `preciseHits`. */
export interface AnimatorOptions extends HumanoidOptions {
  /** Posed in the sim every tick, so its weapon sweeps can hit (false). */
  preciseHits?: boolean;
}

/** Where and how `pose` draws the body. */
export interface PoseOptions {
  /** The ground point under it, world metres; the last step's when absent. */
  at?: Vector3;
  /** Its heading, radians; the last step's when absent. */
  yaw?: number;
  /** The detail level, an index into `LOD` (0, everything). */
  lod?: number;
}

/** What `inspect()` returns: plain JSON, numbers to 0.1 mm. */
export type AnimatorReport = ReturnType<Animator['inspect']>;

/** `x` to 0.1 mm, without −0. */
const r = (x: number) => Math.round(x * 1e4) / 1e4 || 0;
const xyz = (v: Vector3) => [r(v.x), r(v.y), r(v.z)];
/** Scratch objects. */
const [shift, along, at] = [new Vector3(), new Vector3(), new Vector3()];
const [turn, before] = [new Quaternion(), new Pose()];

/** Copies `from`'s numbers into `to`, into the same nested objects: nothing is shared. */
function copyNumbers(from: object, to: object): void {
  for (const [key, value] of Object.entries(from)) {
    const target = to as Record<string, unknown>;
    if (typeof value === 'object' && value !== null) copyNumbers(value as object, target[key] as object);
    else target[key] = value;
  }
}

/** The character animator: a body, its layer stack and the two update paths. See the file comment. */
export class Animator {
  /** The body: the procedural humanoid. */
  readonly body: Humanoid;
  /** Whether the sim poses it every tick. */
  readonly preciseHits: boolean;
  /** The stream it was made with, if any (the entity's, in the sim). */
  readonly rng: Rng | undefined;
  /** The events of the last step. */
  readonly events: AnimEvent[] = [];
  /** The trail, oldest first. */
  readonly trail: TrailSample[] = [];
  /** The part that trailed at the last step. */
  trailing: TrailName | undefined;
  /** The detail level of the last pose. */
  lod = 0;
  readonly #layers: Record<LayerSlot, AnimLayer[]> = { clips: [], additive: [], post: [], physics: [], secondary: [] };
  readonly #ignored = new Set<string>();
  readonly #log: Log;
  /** The body's clock at the last solve; NaN before the first. */
  #solvedAt = NaN;
  readonly #placed = new Vector3();

  /** An animator standing at the origin, facing +Z. */
  constructor(options: AnimatorOptions = {}) {
    this.body = new Humanoid(options);
    this.preciseHits = options.preciseHits ?? false;
    this.rng = options.rng;
    this.#log = options.log ?? engineLog;
  }

  /** The sim's step: checks `states` (states.ts), eases the body one tick, lists the tick's `events`. */
  step(states: AnimatorInput = {}): this {
    const input = checkBodyStates(states, this.#log, this.#ignored);
    const from = this.body.state.phase;
    this.body.step(input);
    this.trailing = input.trail;
    this.events.length = 0;
    const { phase, weights: w } = this.body.state;
    const still = w.speed < FOOTSTEP.minSpeed || Math.max(w.climb, w.down) > FOOTSTEP.maxWeight;
    if (input.air || still) return this;
    const landing = (p: number) => Math.floor((p - Math.PI / 2) / Math.PI);
    for (let k = landing(from) + 1; k <= landing(phase); k++) {
      this.events.push({ type: 'footstep', side: k % 2 === 0 ? 'L' : 'R', speed: w.speed });
    }
    return this;
  }

  /** The presentation's part: solves the body, runs the layers and FK, samples the trail. Never touches sim state. */
  pose(options: PoseOptions = {}): this {
    const body = this.body;
    if (options.at) body.position.copy(options.at);
    if (options.yaw !== undefined) body.yaw = options.yaw;
    this.lod = MathUtils.clamp(Math.trunc(options.lod ?? 0), 0, LOD.length - 1);
    const level = LOD[this.lod];
    const ticks = Math.round((body.state.clock - this.#solvedAt) / body.dt);
    if (ticks >= 0 && ticks < level.every) {
      body.pose.rootPos.add(shift.subVectors(body.position, this.#placed));
      forwardKinematics(body.skeleton, body.pose, body.world);
    } else {
      body.solve();
      this.#solvedAt = body.state.clock;
      for (const slot of level.slots) for (const layer of this.#layers[slot]) this.#apply(layer);
    }
    this.#placed.copy(body.position);
    this.#sample(level.trail);
    return this;
  }

  /** Where socket `name` is, world metres, as the last pose put it. Throws `ANIM_UNKNOWN_JOINT` for another name. */
  socket(name: SocketName, out = new Vector3()): Vector3 {
    return socketPosition(this.body.skeleton, this.body.world, name, out);
  }

  /** `step(states)`, then `pose(options)`. */
  update(states: AnimatorInput = {}, options: PoseOptions = {}): this {
    return this.step(states).pose(options);
  }

  /** Adds `layer` at the end of `slot`. Throws `ANIM_BAD_LAYER` for a slot that takes no layers or a name in use. */
  use(slot: LayerSlot, layer: AnimLayer): this {
    const slots = LAYER_SLOTS.join(', ');
    const fail = (problem: string) => codeError('ANIM_BAD_LAYER', { name: JSON.stringify(layer.name), problem, slots });
    if (!Object.hasOwn(this.#layers, slot)) throw fail(`slot ${JSON.stringify(slot)} takes no layers`);
    if (this.layer(layer.name)) throw fail('the name is in use');
    this.#layers[slot].push(layer);
    return this;
  }

  /** The layer named `name`, if any. */
  layer(name: string): AnimLayer | undefined {
    return LAYER_SLOTS.flatMap((slot) => this.#layers[slot]).find((layer) => layer.name === name);
  }

  /** Removes the layer named `name`, if any. */
  drop(name: string): this {
    for (const slot of LAYER_SLOTS) this.#layers[slot] = this.#layers[slot].filter((layer) => layer.name !== name);
    return this;
  }

  /** Writes what `step` changed into `out`, plain data: the body's state, the trailing part, a precise trail. */
  save(out: AnimatorData): AnimatorData {
    copyNumbers(this.body.state, out.state);
    [out.started, out.trailing] = [true, this.trailing ?? ''];
    out.trail.length = 0;
    if (this.preciseHits)
      for (const s of this.trail) out.trail.push(...s.base.toArray(), ...s.tip.toArray(), s.clock, s.weight);
    return out;
  }

  /** Reads `data`, copying and never keeping it: the body's state, the trailing part, a precise trail. */
  load(data: Readonly<AnimatorData>): this {
    copyNumbers(data.state, this.body.state);
    this.trailing = Object.hasOwn(TRAILS, data.trailing) ? (data.trailing as TrailName) : undefined;
    if (!this.preciseHits) return this;
    this.trail.length = 0;
    for (let i = 0; i + 8 <= data.trail.length; i += 8) {
      const [base, tip] = [new Vector3().fromArray(data.trail, i), new Vector3().fromArray(data.trail, i + 3)];
      this.trail.push({ base, tip, clock: data.trail[i + 6], weight: data.trail[i + 7] });
    }
    return this;
  }

  /**
   * Everything about it now, as plain JSON (numbers to 0.1 mm): the weights, each slot, the effectors (rig-local
   * `[forward, right, up]` metres before the build's size), the sockets (world), the events, the trail, and the body
   * states it ignored.
   */
  inspect() {
    const { body } = this;
    const { state: st, effectors: E } = body;
    const effector = (v: Vector3) => fru(v).map(r);
    return {
      body: 'humanoid' as const,
      build: body.build.id,
      weapon: body.weapon,
      preciseHits: this.preciseHits,
      lod: this.lod,
      clock: r(st.clock),
      phase: r(st.phase),
      weights: Object.fromEntries(Object.entries(st.weights).map(([name, w]) => [name, r(w)])),
      layers: (Object.keys(SLOTS) as SlotName[]).map((slot) => {
        if (slot === 'solve') return { slot, by: 'humanoid' };
        if (slot === 'weights' || slot === 'base' || slot === 'override') {
          return { slot, by: 'humanoid', active: activeWeights(st.weights, slot === 'weights' ? undefined : slot, r) };
        }
        return {
          slot,
          layers: this.#layers[slot].map((l) => ({ name: l.name, weight: r(l.weight), ...l.inspect?.() })),
        };
      }),
      effectors: {
        pelvis: effector(E.pelvis),
        footL: effector(E.feet.L),
        footR: effector(E.feet.R),
        handL: effector(E.hands.L),
        handR: effector(E.hands.R),
        blade: effector(E.blade),
      },
      sockets: Object.fromEntries(SOCKETS.map((s) => [s, xyz(this.socket(s, at))])),
      events: this.events.map((event) => ({ ...event, speed: r(event.speed) })),
      trailing: this.trailing ?? null,
      trail: this.trail.map(({ base, tip, clock, weight }) => ({
        base: xyz(base),
        tip: xyz(tip),
        age: r(st.clock - clock),
        weight,
      })),
      ignored: [...this.#ignored].sort(),
    };
  }

  /** Runs `layer` at full strength, fades it by its weight, and runs FK. */
  #apply(layer: AnimLayer): void {
    const w = MathUtils.clamp(layer.weight, 0, 1);
    if (!(w > 0)) return;
    const { body } = this;
    if (w < 1) before.copy(body.pose);
    layer.apply(this);
    if (w < 1) blendPoses(before, body.pose, w, body.pose);
    forwardKinematics(body.skeleton, body.pose, body.world);
  }

  /** Ages the trail out and, once a tick while a part trails, adds a sample (a new ribbon after a jump). */
  #sample(on: boolean): void {
    const { trail, body } = this;
    const clock = body.state.clock;
    if (trail.length && trail[trail.length - 1].clock > clock) trail.length = 0;
    const keep = this.trailing ? TRAIL.maxAge : TRAIL.fadeAge;
    while (trail.length && clock - trail[0].clock > keep) trail.shift();
    const last = trail.at(-1);
    if (!on || !this.trailing || (last && last.clock >= clock)) return;
    const sample = this.#part(this.trailing, clock);
    if (last && last.tip.distanceTo(sample.tip) > TRAIL.jump * body.build.size) trail.length = 0;
    trail.push(sample);
    if (trail.length > TRAIL.samples) trail.shift();
  }

  /** Where `part`'s ribbon spans now (my-3d2dge's `b` and `t`). */
  #part(part: TrailName, clock: number): TrailSample {
    const { skeleton, world, weapon, build } = this.body;
    const [base, tip] = [new Vector3(), new Vector3()];
    if (part === 'blade' && weapon === 'sword') {
      socketPosition(skeleton, world, 'weaponR', base);
      along.set(0, 0, build.size).applyQuaternion(jointRotation(world, 'handR', turn));
      tip.copy(base).addScaledVector(along, TRAIL.bladeTip);
      return { base: base.addScaledVector(along, TRAIL.bladeBase), tip, clock, weight: TRAIL.blade };
    }
    const side: LimbSide = part === 'fistL' ? 'L' : 'R';
    jointPosition(world, part === 'kick' ? 'shinR' : (`forearm${side}` as const), base);
    if (part === 'kick') socketPosition(skeleton, world, 'contactR', tip);
    else jointPosition(world, `hand${side}` as const, tip);
    return { base, tip, clock, weight: TRAIL.limb };
  }
}

/** Animators by entity id, each made from its entity's data and loaded with it at every `get`. */
export class AnimatorPool {
  readonly #byId = new Map<number, { make: string; animator: Animator }>();

  /**
   * The animator of entity `id`, loaded with `data`; made again when its make or `options.rng` changed. `options` are
   * the humanoid's (`rng`, `dt`, `log`) for a new one. Never writes `data`.
   */
  get(id: number, data: Readonly<AnimatorData>, options: Pick<HumanoidOptions, 'rng' | 'dt' | 'log'> = {}): Animator {
    const make = `${data.build}|${data.weapon}|${data.preciseHits}`;
    let held = this.#byId.get(id);
    if (!held || held.make !== make || (options.rng && held.animator.rng !== options.rng)) {
      const { build, preciseHits } = data;
      const animator = new Animator({ ...options, build, weapon: data.weapon as Weapon, preciseHits, clock: 0 });
      this.#byId.set(id, (held = { make, animator }));
    }
    return held.animator.load(data);
  }

  /** Forgets the animators of the entities `keep` turns down. */
  prune(keep: (id: number) => boolean): void {
    for (const id of this.#byId.keys()) if (!keep(id)) this.#byId.delete(id);
  }
}
