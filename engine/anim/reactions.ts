/**
 * @file Reactions (PLAN.md WP 6.2, §5.2; I-11): how a body answers a hit. `Reactions` keeps a directional flinch
 * (shardfall's additive spring: a hit leans the spine and head along its travel; the spring brings them back) and
 * plays the reaction timelines (`REACTIONS`): `knockDown` (fall, lie), `die` (stagger, buckle, topple, dead) and the
 * get-up chosen by how the body lies: on its back (`getUpBack`: sit up, kneel, rise) or on its face (`getUpFront`:
 * push up, kneel, rise). A body falls the way the hit pushes it, forward onto its face, else onto its back;
 * `lyingOf` reads the same from a chest's rotation (a ragdoll's: WP 10.2 takes over the fall).
 *
 * The two update paths (§6.4): `step()` is the sim's, one fixed tick of the spring and the timeline, returning its
 * events (each phase's name as it begins, `end`); `body` is what the phase tells the humanoid (`down`, `pose`), to lay
 * over the animator's input; all plain data (`save`, `load`), part of the gameplay hash. `apply` is the view's: in
 * the slot `additive` it bends the spine and neck by the flinch; `lyingLayer`, in the slot `physics` (every detail
 * level), turns a body lying face down onto its face (the humanoid's knockdown lays every body on its back).
 * `attach(animator)` adds both.
 *
 * Invariants:
 * - The humanoid plays the body: its die pose (humanoid.ts `STEP.die`) and knockdown (`STEP.fall`, `KNOCKDOWN`). The
 *   die timeline is cut at the die pose's own times, so each event fires as the body changes.
 * - Exact in ticks (timeline.ts): a knocked-down body gets up on the tick its `lie` runs out, the time left over
 *   carried into the get-up. An endless `lie`, and `dead`, last until told otherwise.
 * - Lying face down is drawn only (a body the sim poses itself, `preciseHits`, lies on its back there), its legs
 *   straightened and its feet pointed as it goes down, so its knees and toes stay off the floor.
 *
 * Carried from `shardfall:crates/pav_core/src/puppet.rs:568-573, 700-710` (the flinch spring, `hit`) and
 * `my-3d2dge:engine/my-3d2dge.js:1824-1827` (`die`, as the humanoid's die pose plays it), made timelines.
 *
 * @example
 * import { Vector3 } from '../core/math';
 * import { Animator } from './character';
 * const hero = new Animator({ build: 'build:heroic' });
 * const react = new Reactions().attach(hero);
 * react.knockDown(new Vector3(0, 0, 1), 0); // struck from behind: it falls onto its face
 * for (let i = 0; i < 60; i++) {
 *   react.step(); // the sim's tick tells the body; the view draws it
 *   hero.step(react.body).pose();
 * }
 * react.events.map((e) => e.type); // ['end', 'pushUp']: it fell for 0.2 s, lay 0.8 s, and pushes itself up
 * react.hit(new Vector3(-1, 0, 0), 0); // a blow from its left: it leans right, and springs back
 * @see engine/anim/reactions.test.ts
 */
import { MathUtils, Quaternion, Vector3 } from '../core/math';
import { SIM_DT } from '../core/time';
import { B } from './authoring';
import type { Animator } from './character';
import { KNOCKDOWN, STEP } from './humanoid';
import type { JointName } from './skeleton';
import type { AnimatorInput } from './states';
import { Timeline, type TimelineEvent, type TimelinePhase, type TimelineState } from './timeline';
import type { AnimLayer } from './weights';

/** Every constant of the reactions: rates per second, times in seconds. */
export const REACTION = {
  /** The flinch spring (shardfall's): its pull and damping, the kick per unit of strength and the strength's bounds. */
  flinch: { stiffness: 150, damping: 9, kick: 7, strength: [0.2, 3] },
  limit: 0.9, // the lean's bound either way: the tangent of the spine's tilt
  head: 0.6, // the head's lean beyond the spine's, a share of the flinch
  /** The joints that share the lean equally, from the pelvis up; the head nods at the neck. */
  spine: ['spine0', 'spine1', 'spine2', 'chest'] as const satisfies readonly JointName[],
  fall: 0.2, // seconds to fall flat (the humanoid's fall takes about 0.16 s)
  lie: 0.8, // seconds a knocked-down body lies before it gets up
} as const;

/** How a body lies: on its back (`up`) or on its face (`down`). */
export type Lying = 'up' | 'down';

/** What a reaction's phase tells the humanoid: a pose, how far down. */
export type ReactionBody = Readonly<Pick<AnimatorInput, 'down' | 'pose'>>;

/** The phases a get-up shares after its first: kneel, then rise (the kneel eases out). */
const RISE = [
  { name: 'kneel', duration: 0.3, content: { down: 0, pose: 'kneel' } },
  { name: 'rise', duration: 0.2, content: {} },
] as const;

/** The reactions' timelines: each phase's name, seconds and body states. */
export const REACTIONS = {
  down: [
    { name: 'fall', duration: REACTION.fall, content: { down: 1 } },
    { name: 'lie', duration: REACTION.lie, content: { down: 1 } },
  ],
  die: [
    { name: 'stagger', duration: STEP.die.kneel[0], content: { pose: 'die' } },
    { name: 'buckle', duration: STEP.die.down - STEP.die.kneel[0], content: { pose: 'die' } },
    { name: 'topple', duration: REACTION.fall, content: { pose: 'die' } },
    { name: 'dead', duration: Infinity, content: { pose: 'die' } },
  ],
  getUpBack: [{ name: 'sitUp', duration: 0.25, content: { down: 0.5, pose: 'crouch' } }, ...RISE],
  getUpFront: [{ name: 'pushUp', duration: 0.3, content: { down: 0.5, pose: 'cast' } }, ...RISE],
} as const satisfies Readonly<Record<string, readonly TimelinePhase<ReactionBody>[]>>;

/** A reaction timeline's name. */
export type ReactionName = keyof typeof REACTIONS;

/** Reactions as plain data. */
export interface ReactionState {
  /** The flinch: lean right (+) and forward (+), each a tilt's tangent, and their speeds per second. */
  flinch: [side: number, forward: number, sideSpeed: number, forwardSpeed: number];
  /** What plays: a `REACTIONS` name, or '' for nothing. */
  playing: ReactionName | '';
  /** How the body lies while down; `up` again once it stands. */
  lying: Lying;
  /** Seconds a knocked-down body lies before it gets up; −1 until `getUp`. */
  lie: number;
  /** The timeline's phase and seconds into it. */
  timeline: TimelineState;
}

/** What `new Reactions` takes. */
export interface ReactionOptions {
  /** Its layer's name (`reactions`); `lyingLayer`'s is this plus `:lying`. */
  name?: string;
  /** The fixed step, seconds (`SIM_DT`). */
  dt?: number;
}

const [UP, X_AXIS, FORWARD] = [new Vector3(0, 1, 0), new Vector3(1, 0, 0), new Vector3(0, 0, 1)];
const NONE: ReactionBody = Object.freeze({});
/** A foot's local rotation lying face down: pointed, toes along the shin, off the floor. */
const [IDENTITY, POINTED] = [new Quaternion(), new Quaternion().setFromAxisAngle(X_AXIS, Math.PI / 2)];
/** Scratch objects. */
const [va, vb] = [new Vector3(), new Vector3()];
const [qa, qb, qc, qd] = [new Quaternion(), new Quaternion(), new Quaternion(), new Quaternion()];

/** How a body whose chest turned by `chest` (a world rotation) lies: face up when the chest's front looks up. */
export function lyingOf(chest: Quaternion): Lying {
  return va.copy(FORWARD).applyQuaternion(chest).y >= 0 ? 'up' : 'down';
}

/** Whether a hit travelling along `direction` pushes a body facing `yaw` forward (its share along the facing > 0). */
const forwardPush = (direction: Vector3, yaw: number) => direction.x * Math.sin(yaw) + direction.z * Math.cos(yaw) > 0;

/** A body's reactions: the flinch, the knockdown, the death, the get-ups. See the file comment. */
export class Reactions implements AnimLayer {
  /** Its layer's name. */
  readonly name: string;
  /** 0–1: how much of the flinch shows. */
  weight = 1;
  /** The fixed step, seconds. */
  readonly dt: number;
  /** The flinch now: the lean right and forward (tangents), and their speeds per second. */
  readonly flinch = { side: 0, forward: 0, sideSpeed: 0, forwardSpeed: 0 };
  /** How the body lies while down; `up` again once it stands. */
  lying: Lying = 'up';
  /** The events of the last `step` or start. */
  readonly events: TimelineEvent[] = [];
  /** Its partner layer, for the slot `physics`: turns a body lying face down onto its face. */
  readonly lyingLayer: AnimLayer;
  #playing: ReactionName | '' = '';
  #lie: number = REACTION.lie;
  #timeline: Timeline<ReactionBody> | undefined;

  /** Reactions at rest: upright, nothing playing. */
  constructor(options: ReactionOptions = {}) {
    this.name = options.name ?? 'reactions';
    this.dt = options.dt ?? SIM_DT;
    this.lyingLayer = {
      name: `${this.name}:lying`,
      weight: 1,
      apply: (animator) => this.#turnOver(animator),
      inspect: () => ({ lying: this.lying }),
    };
  }

  /** Adds it to `animator`: itself in the slot `additive`, `lyingLayer` in the slot `physics`. */
  attach(animator: Animator): this {
    animator.use('additive', this).use('physics', this.lyingLayer);
    return this;
  }

  /** The timeline playing, if any. */
  get playing(): ReactionName | undefined {
    return this.#playing || undefined;
  }

  /** The phase playing, if any. */
  get phase(): string | undefined {
    return this.#timeline?.current?.name;
  }

  /** The body states the phase playing tells the humanoid: lay them over the animator's input. */
  get body(): ReactionBody {
    return this.#timeline?.current?.content ?? NONE;
  }

  /** A hit travelling along `direction` (world) on a body facing `yaw`, `strength` about 1: a flinch along it. */
  hit(direction: Vector3, yaw: number, strength = 1): this {
    const [sin, cos] = [Math.sin(yaw), Math.cos(yaw)];
    const length = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
    const [x, z] = length > 1e-9 ? [direction.x / length, direction.z / length] : [-sin, -cos];
    const { kick, strength: [low, high] } = REACTION.flinch; // prettier-ignore
    const k = kick * MathUtils.clamp(strength, low, high);
    this.flinch.sideSpeed += (z * sin - x * cos) * k;
    this.flinch.forwardSpeed += (x * sin + z * cos) * k;
    return this;
  }

  /**
   * Knocked down by a hit travelling along `direction` on a body facing `yaw`: it falls onto its face when pushed
   * forward, else onto its back (a body already down stays as it lies), lies `lie` seconds (Infinity: until `getUp`)
   * and gets up the way it lies. A dead body stays dead.
   */
  knockDown(direction: Vector3, yaw: number, lie: number = REACTION.lie): this {
    if (this.#playing === 'die') return this;
    if (!this.#down()) this.lying = forwardPush(direction, yaw) ? 'down' : 'up';
    this.#lie = Number.isFinite(lie) ? Math.max(0, lie) : -1;
    return this.#play('down');
  }

  /** Dies: falls onto its face when a hit along `direction` pushes a body facing `yaw` forward, else onto its back. */
  die(direction?: Vector3, yaw = 0): this {
    if (!this.#down()) this.lying = direction && forwardPush(direction, yaw) ? 'down' : 'up';
    return this.#play('die');
  }

  /** Gets up (the dead too) the way it lies, or the way a chest turned by `chest` lies (`lyingOf`: a ragdoll's). */
  getUp(chest?: Quaternion): this {
    if (chest) this.lying = lyingOf(chest);
    return this.#play(this.lying === 'up' ? 'getUpBack' : 'getUpFront');
  }

  /** The sim's tick: the flinch spring, then the timeline. Returns `events`: each phase's name as it begins, `end`. */
  step(): TimelineEvent[] {
    const { dt, flinch: f } = this;
    const { stiffness: k, damping: c } = REACTION.flinch;
    f.sideSpeed += (-f.side * k - f.sideSpeed * c) * dt;
    f.forwardSpeed += (-f.forward * k - f.forwardSpeed * c) * dt;
    f.side = MathUtils.clamp(f.side + f.sideSpeed * dt, -REACTION.limit, REACTION.limit);
    f.forward = MathUtils.clamp(f.forward + f.forwardSpeed * dt, -REACTION.limit, REACTION.limit);
    this.events.length = 0;
    const fired = this.#timeline?.advance(dt) ?? [];
    this.events.push(...fired);
    const end = fired.at(-1);
    if (end?.type !== 'end') return this.events;
    if (this.#playing !== 'down') {
      [this.#playing, this.#timeline, this.lying] = ['', undefined, 'up'];
      return this.events;
    }
    const started = this.getUp().events.map((e) => ({ ...e, late: end.late }));
    const rest = this.#timeline?.advance(end.late) ?? [];
    this.events.splice(0, this.events.length, ...fired, ...started, ...rest);
    return this.events;
  }

  /** The state as plain data. */
  save(): ReactionState {
    const f = this.flinch;
    const timeline = this.#timeline?.save() ?? [-1, 0];
    return { flinch: [f.side, f.forward, f.sideSpeed, f.forwardSpeed], playing: this.#playing, lying: this.lying, lie: this.#lie, timeline }; // prettier-ignore
  }

  /** Reads a state `save` wrote. */
  load(state: Readonly<ReactionState>): this {
    const f = this.flinch;
    [f.side, f.forward, f.sideSpeed, f.forwardSpeed] = state.flinch;
    [this.lying, this.#lie] = [state.lying === 'down' ? 'down' : 'up', state.lie];
    this.#playing = Object.hasOwn(REACTIONS, state.playing) ? state.playing : '';
    this.#timeline = this.#playing ? this.#make(this.#playing).load(state.timeline) : undefined;
    if (!this.#timeline?.playing) [this.#playing, this.#timeline] = ['', undefined];
    return this;
  }

  /** The view: bends the spine and the neck by the flinch, in the root's frame. */
  apply(animator: Animator): void {
    const { side, forward } = this.flinch;
    if (side === 0 && forward === 0) return;
    const pose = animator.body.pose;
    const torso = va.set(-side, 1, forward).normalize();
    const share = qa.identity().slerp(qb.setFromUnitVectors(UP, torso), 1 / REACTION.spine.length);
    const parent = pose.getRotation('pelvis', qb);
    const bend = (joint: JointName, turn: Quaternion) => {
      const local = pose.getRotation(joint, qc);
      const next = qd.copy(parent).invert().multiply(turn).multiply(parent).multiply(local);
      pose.setRotation(joint, next);
      parent.multiply(next);
    };
    for (const joint of REACTION.spine) bend(joint, share);
    const head = vb.set(-side, 0, forward).multiplyScalar(REACTION.head).add(torso).normalize();
    bend('neck', qa.setFromUnitVectors(torso, head));
  }

  /** The flinch, what plays and how the body lies, as plain JSON. */
  inspect(): Record<string, unknown> {
    const r = (x: number) => Math.round(x * 1e4) / 1e4 || 0;
    const { side, forward } = this.flinch;
    return { flinch: [r(side), r(forward)], playing: this.#playing || null, phase: this.phase ?? null, lying: this.lying }; // prettier-ignore
  }

  /** Whether a fall or a death plays, so the body is down. */
  #down(): boolean {
    return this.#playing === 'down' || this.#playing === 'die';
  }

  /** The timeline of `name` (a knockdown's `lie` from the state). */
  #make(name: ReactionName): Timeline<ReactionBody> {
    const phases: readonly TimelinePhase<ReactionBody>[] = REACTIONS[name];
    const lie = this.#lie < 0 ? Infinity : this.#lie;
    return new Timeline(name === 'down' ? [phases[0], { ...phases[1], duration: lie }] : phases);
  }

  /** Starts `name`'s timeline; its first events are `events`. */
  #play(name: ReactionName): this {
    [this.#playing, this.#timeline] = [name, this.#make(name)];
    this.events.splice(0, this.events.length, ...this.#timeline.start());
    return this;
  }

  /** `lyingLayer`: a body down and lying face down turns forward, not back (humanoid.ts `#placeRoot`, mirrored). */
  #turnOver(animator: Animator): void {
    const body = animator.body;
    const down = body.state.weights.down;
    if (this.lying !== 'down' || !(down > 0)) return;
    const { pose, build: b } = body;
    const yaw = qa.setFromAxisAngle(UP, body.yaw + body.state.arm.turn);
    const knock = qb.setFromAxisAngle(X_AXIS, down * KNOCKDOWN.turn);
    pose.rootRot.copy(yaw).multiply(knock);
    const slide = B(-down * KNOCKDOWN.shift * (b.hipHeight + b.torso), 0, down * KNOCKDOWN.lift, vb).multiplyScalar(b.size); // prettier-ignore
    pose.rootPos.copy(body.rootOffset).applyQuaternion(knock).add(slide).applyQuaternion(yaw).add(body.position);
    for (const joint of ['thighL', 'shinL', 'thighR', 'shinR'] as const) {
      pose.setRotation(joint, pose.getRotation(joint, qc).slerp(IDENTITY, down)); // straight legs: knees off the floor
    }
    for (const foot of ['footL', 'footR'] as const)
      pose.setRotation(foot, pose.getRotation(foot, qc).slerp(POINTED, down));
  }
}
