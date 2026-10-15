/**
 * @file ACTIONS (PLAN.md WP 8.7; I-11; docs/ANIMATION-RESEARCH.md §2, §6): multi-beat sequences played on a body,
 * between one move and a behaviour. `Actions` plays the registry kind `action` (actions-data.ts: the beats and their
 * fields, `defineAction`, `loadActions`) one at a time. A beat `until: 'next'` holds its contact frame (a charge, a
 * hang, a fall) until the game calls `next()` or `go(beat)`; `then` loops; `finish()` goes to the `exit` beat; a
 * `pair` plays on a partner in lockstep (`play(id, partner)`). actions-check.ts plays one for the `anim` QA.
 *
 * The two update paths (§6.4), as reactions': `step()` is the sim's tick (beats, clip calls, events) and `body` what
 * the beat tells the humanoid, to lay over the animator's input; plain data (`save`, `load`). The view: `apply` (slot
 * `post`) solves the effectors; `flipLayer` (slot `physics`, every detail level) turns and squashes the body.
 *
 * Invariants:
 * - Exact in ticks, as timeline.ts: time left when a beat ends carries into the next; events fire in order.
 * - Nothing pops: as a beat begins, its channels (`CHANNELS`: motion, effectors, flip, scale) are taken from where
 *   they are and ease (smoothstep) to the beat's over its `seconds`; after an action they ease to rest over
 *   `ACTION.out`. They come from data, never from a pose, so posing never changes the hash.
 * - Effector targets are `[forward, right, up]` metres times the build's size (actions-data.ts says from where).
 * - A flip turns the body `turns` times about a pivot `ACTION.pivot` hip heights up (a `ground` one, a roll, keeps its
 *   lowest point on its ground point; in the air the arc is the game's); a scale keeps the lowest point where it was.
 *
 * Carried from `my-3d2dge:src/emberdeep/96-hero-clips.js:31-49` (`HCL_MOVES`, as input: a moment's clip and its
 * speed, fades, mask, walk, hold, landed and next, as a beat's `clip` and the beats after it) and
 * `src/emberdeep/20-hero.js:193-196` (`heroRoll`: the pivot at 0.55 of the hip height, the eased whole turn).
 *
 * @example
 * import { defineAction } from './actions-data';
 * import { Animator } from './character';
 * const bend = { name: 'bend', seconds: 0.4, motion: { lean: 0.6 }, events: [{ type: 'lowest', at: 1 }] };
 * defineAction('action:bow', { desc: 'A bow.', beats: [bend, { name: 'rise', seconds: 0.3, cancel: { by: ['walk'] } }] });
 * const hero = new Animator({ build: 'build:heroic' });
 * const acts = new Actions().attach(hero).play('bow'); // acts.beat: 'bend'
 * for (let i = 0; i < 25; i++) hero.update({ ...acts.step() && acts.body });
 * acts.beat; // 'rise': 0.4 s in, after 'lowest'
 * acts.cancel('walk'); // true: walking may cut the rise
 * @see engine/anim/actions.test.ts
 */
import { codeError, defineCodes, didYouMean } from '../core/log';
import { MathUtils, Quaternion, Vector3 } from '../core/math';
import { registry as sharedRegistry, type Registry } from '../core/registry';
import { SIM_DT } from '../core/time';
import { ACTION, EFFECTORS, FLIP_AXES, getAction, type Action, type Beat } from './actions-data';
import { B } from './authoring';
import type { Animator } from './character';
import { ClipLayer, type ClipPlay } from './clip/layer';
import { forwardKinematics, socketPosition, tipPosition, type WorldPose } from './fk';
import { aim, handTo, twoBoneRot } from './ik';
import { blendPoses, Pose } from './pose';
import { boneMask, JOINT_COUNT, SOCKETS, socketIndex, type Skeleton } from './skeleton';
import type { AnimatorInput } from './states';
import { TICK_EPSILON, type TimelineEvent } from './timeline';
import type { AnimLayer } from './weights';

/** The codes this module raises, with their fixes. */
export const ACTION_CODES = defineCodes('anim', {
  ANIM_UNKNOWN_BEAT: {
    template: 'action {action} has no beat {name}{suggestion}',
    fix: 'go to one of its beats: {names}',
    doc: 'Thrown by `Actions.go` (engine/anim/actions.ts) for a beat name the playing action lacks, or when nothing plays. The message names the closest beats.',
  },
  ANIM_ACTION_NO_CLIPS: {
    template: 'action {action} plays clips ({clips}), but its Actions has no clip layer',
    fix: "make it with one: new Actions({ clips }), the ClipLayer in the animator's clips slot, with the sets those clips come from",
    doc: 'Thrown by `Actions.play` (engine/anim/actions.ts) for an action with a `clip` beat when the player was made without `clips`: the beat would play nothing, silently.',
  },
});

/** The channels' layout: motion (5), each effector's target and weight (4 × 5), the flip's angle and axis, scale (3). */
export const CHANNELS = { motion: 0, effectors: 5, flip: 25, scale: 27, count: 30 } as const;
const MOTION = ['lean', 'lunge', 'hop', 'crouch', 'twist'] as const;
const AXES = Object.keys(FLIP_AXES) as (keyof typeof FLIP_AXES)[];
const smooth = (x: number) => MathUtils.smoothstep(x, 0, 1);
const TURN = 2 * Math.PI;
/** An angle wrapped into (−π, π]. */
const wrap = (a: number) => a - TURN * Math.ceil((a - Math.PI) / TURN);

/** An `Actions`' state, plain data. */
export interface ActionsState {
  /** The action playing, by id; '' when none. */ playing: string;
  /** Its beat's index; −1 at rest. */ beat: number;
  /** Seconds into the beat (at rest: since the last action let go). */ t: number;
  /** The channels as the beat began (`CHANNELS`). */ from: number[];
  /** The clip its beats started (`SET/Clip`), '' when none. */ clip: string;
}

/** What `new Actions` takes. */
export interface ActionsOptions {
  /** Its layer's name (`actions`); `flipLayer`'s is this plus `:flip`. */ name?: string;
  /** The fixed step, seconds (`SIM_DT`). */ dt?: number;
  /** The clip layer its clip beats play on (the animator's `clips` slot). */ clips?: ClipLayer;
  /** Where its actions are defined (the shared registry). */ registry?: Registry;
}

/** Scratch. */
const [va, vb, vc, vs] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
const [qa, before] = [new Quaternion(), new Pose()];
const MASK = { handL: boneMask('armL'), handR: boneMask('armR'), footL: boneMask('legL'), footR: boneMask('legR'), look: boneMask(['chest', 'neck', 'head']) }; // prettier-ignore

/** The lowest point of a posed body, world metres: its joints, the tips of its leaves and its sockets. */
function lowest(skeleton: Skeleton, world: WorldPose): number {
  let y = Infinity;
  for (let j = 0; j < JOINT_COUNT; j++) y = Math.min(y, world.positions[j * 3 + 1], tipPosition(skeleton, world, j, va).y); // prettier-ignore
  for (const s of SOCKETS) y = Math.min(y, socketPosition(skeleton, world, s, va).y);
  return y;
}

/** A body's actions, one playing at a time. See the file comment. */
export class Actions implements AnimLayer {
  readonly name: string;
  /** 0–1: how much of the effectors shows. */
  weight = 1;
  readonly dt: number;
  readonly clips: ClipLayer | undefined;
  readonly state: ActionsState = { playing: '', beat: -1, t: ACTION.out, from: [], clip: '' };
  /** The events since the last step began: the calls before it (play, go…) and its own. */
  readonly events: TimelineEvent[] = [];
  /** Its partner layer, for the slot `physics`: the flip and the squash. */
  readonly flipLayer: AnimLayer;
  readonly #registry: Registry;
  #action: Action | undefined;
  /** Whether a call (play, go…) fired events since the last step: the next step keeps them. */
  #called = false;

  /** Actions at rest: nothing playing. */
  constructor(options: ActionsOptions = {}) {
    this.state.from = Array.from({ length: CHANNELS.count }, (_, i) => (i >= CHANNELS.scale ? 1 : 0)); // at rest
    this.name = options.name ?? 'actions';
    [this.dt, this.clips, this.#registry] = [options.dt ?? SIM_DT, options.clips, options.registry ?? sharedRegistry];
    this.flipLayer = { name: `${this.name}:flip`, weight: 1, apply: (animator) => this.#turn(animator) };
  }

  /** Adds it to `animator`: itself in the slot `post`, `flipLayer` in the slot `physics`. */
  attach(animator: Animator): this {
    animator.use('post', this).use('physics', this.flipLayer);
    return this;
  }

  /** The beat playing, if any. */
  get beat(): string | undefined {
    return this.#beat()?.name;
  }

  /** Progress through the beat's seconds, 0–1 (1 past them, or at rest). */
  get u(): number {
    const beat = this.#beat();
    return beat && beat.seconds > 0 ? Math.min(1, this.state.t / beat.seconds) : 1;
  }

  /** What the beat tells the humanoid: lay it over the animator's input. Nothing at rest. */
  get body(): AnimatorInput {
    const [beat, ch] = [this.#beat(), this.channels()];
    if (!beat) return {};
    const out: AnimatorInput = { ...((beat.body ?? {}) as AnimatorInput) };
    const [u0, u1] = beat.move?.u ?? [0, 1];
    if (beat.move) out.body = { move: beat.move.id, phase: beat.move.phase, u: MathUtils.lerp(u0, u1, this.u) };
    else if (MOTION.some((_, i) => Math.abs(ch[i]) > 1e-9)) out.body = Object.fromEntries(MOTION.map((k, i) => [k, ch[i]])); // prettier-ignore
    return out;
  }

  /**
   * Plays the action `id` (`action:jump`, or `jump`) from its first beat, over whatever played; and its `pair` on
   * `partner` (a grab's victim), which then steps in lockstep with it (tell both `next()` and `go()`).
   */
  play(id: string | Action, partner?: Actions): this {
    const action = typeof id === 'string' ? getAction(id, this.#registry) : id;
    if (partner && action.pair) partner.play(getAction(action.pair, this.#registry));
    const clips = [...new Set(action.beats.flatMap((b) => b.clip?.name ?? []))];
    if (clips.length && !this.clips) throw codeError('ANIM_ACTION_NO_CLIPS', { action: action.id, clips: clips.join(', ') }); // prettier-ignore
    return this.#start(action, 0);
  }

  /** Ends the beat playing and starts the one that follows: what a beat held `until: 'next'` waits for. */
  next(): this {
    return this.#action ? this.#start(this.#action, this.#following()) : this;
  }

  /** Jumps to the playing action's beat `name`. Throws `ANIM_UNKNOWN_BEAT`. */
  go(name: string): this {
    const [action, names] = [this.#action, this.#action?.beats.map((b) => b.name) ?? []];
    if (!action || !names.includes(name)) {
      const values = { action: action?.id ?? '(none playing)', name: JSON.stringify(name), names: names.join(', ') };
      throw codeError('ANIM_UNKNOWN_BEAT', { ...values, suggestion: didYouMean(name, names) });
    }
    return this.#start(action, names.indexOf(name));
  }

  /** Goes to the action's `exit` beat, or stops when it has none. */
  finish(): this {
    return this.#action?.exit ? this.go(this.#action.exit) : this.stop();
  }

  /** Stops at once: the channels ease back to rest, a clip it started fades out. Fires nothing. */
  stop(): this {
    return this.#action ? this.#start(undefined, -1) : this;
  }

  /** Whether the beat playing lets `by` (move, action, walk, jump, hurt) cut it now; true when nothing plays. */
  cancels(by: string): boolean {
    const c = this.#beat()?.cancel;
    return !this.#action || (!!c && (c.by.includes(by) || c.by.includes('any')) && this.u >= c.after - TICK_EPSILON);
  }

  /** Stops the action if its window lets `by` cut it; returns whether nothing plays now. */
  cancel(by: string): boolean {
    if (this.#action && this.cancels(by)) this.stop();
    return !this.#action;
  }

  /** Whether the beat playing raises `flag` (`invulnerable`). */
  flag(flag: string): boolean {
    return this.#beat()?.flags.includes(flag) ?? false;
  }

  /** The sim's tick: the beats, exact in ticks. Returns `events`: each beat's name as it begins, its events, `end`. */
  step(): TimelineEvent[] {
    const st = this.state;
    if (!this.#called) this.events.length = 0;
    this.#called = false;
    let left = this.dt;
    if (!this.#action) st.t = Math.min(ACTION.out, st.t + left);
    for (let guard = 0; this.#action && guard < 256; guard++) {
      const beat = this.#action.beats[st.beat];
      const length = beat.until === 'next' ? Infinity : beat.seconds;
      const [from, to] = [st.t, st.t + left];
      for (const mark of beat.events) {
        const at = mark.at * beat.seconds;
        if (at > from + TICK_EPSILON && at <= to + TICK_EPSILON)
          this.events.push({ type: mark.type, phase: beat.name, late: Math.max(0, to - at) });
      }
      if (to + TICK_EPSILON < length) {
        st.t = to;
        break;
      }
      [st.t, left] = [length, Math.max(0, to - length)];
      this.#enter(this.#action, this.#following(), left);
    }
    return this.events;
  }

  /** The channels now (`CHANNELS`): eased from where the beat began toward its own, or toward rest. */
  channels(out: number[] = new Array<number>(CHANNELS.count)): number[] {
    const [beat, from] = [this.#beat(), this.state.from];
    const span = beat ? beat.seconds : ACTION.out;
    const s = smooth(span > 0 ? Math.min(1, this.state.t / span) : 1);
    const to = (i: number, target: number) => (out[i] = MathUtils.lerp(from[i], target, s));
    MOTION.forEach((key, i) => to(i, beat?.motion?.[key] ?? 0));
    EFFECTORS.forEach((key, k) => {
      const [i, target] = [CHANNELS.effectors + 4 * k, beat?.effectors?.[key]];
      for (let c = 0; c < 3; c++) out[i + c] = !target ? from[i + c] : from[i + 3] > 0 ? MathUtils.lerp(from[i + c], target[c], s) : target[c]; // prettier-ignore
      to(i + 3, target ? 1 : 0);
    });
    const flip = beat?.flip;
    out[CHANNELS.flip] = from[CHANNELS.flip] * (1 - s) + (flip ? flip.turns * TURN * s : 0);
    out[CHANNELS.flip + 1] = flip ? AXES.indexOf(flip.axis as (typeof AXES)[number]) : from[CHANNELS.flip + 1];
    for (let c = 0; c < 3; c++) to(CHANNELS.scale + c, beat?.scale?.[c] ?? 1);
    return out;
  }

  /** The state as plain data. */
  save(): ActionsState {
    return JSON.parse(JSON.stringify(this.state)) as ActionsState;
  }

  /** Reads a state `save` wrote. */
  load(state: Readonly<ActionsState>): this {
    Object.assign(this.state, JSON.parse(JSON.stringify(state)) as ActionsState);
    this.#action = state.playing ? getAction(state.playing, this.#registry) : undefined;
    if (!this.#beat()) [this.#action, this.state.playing, this.state.beat] = [undefined, '', -1];
    return this;
  }

  /** The view (slot `post`): the effectors pulled to their targets, each faded by its weight. */
  apply(animator: Animator): void {
    const ch = this.channels();
    const { pose, world, skeleton, build: b } = animator.body;
    const [arms, legs] = [(b.armUpper + b.armLower) / ACTION.arm, (b.legUpper + b.legLower) / ACTION.leg];
    qa.setFromAxisAngle(vb.set(0, 1, 0), animator.body.yaw);
    EFFECTORS.forEach((key, k) => {
      const i = CHANNELS.effectors + 4 * k;
      const w = smooth(ch[i + 3]);
      if (!(w > 0)) return;
      const foot = key === 'footL' || key === 'footR';
      B(ch[i], ch[i + 1], ch[i + 2], va).multiplyScalar(foot ? legs : arms);
      if (!foot) va.y += b.hipHeight + b.torso;
      va.multiplyScalar(b.size).applyQuaternion(qa).add(animator.body.position);
      before.copy(pose);
      if (key === 'look') aim(skeleton, pose, world, va);
      else if (!foot) handTo(skeleton, pose, world, key, va);
      else {
        const offset = vc.fromArray(skeleton.socketOffsets, socketIndex(key === 'footL' ? 'contactL' : 'contactR') * 3); // prettier-ignore
        twoBoneRot(skeleton, pose, world, key, va, { offset });
      }
      blendPoses(before, pose, w, pose, { mask: MASK[key] });
      forwardKinematics(skeleton, pose, world);
    });
  }

  /** What plays, as plain JSON. */
  inspect(): Record<string, unknown> {
    const [r, flags] = [(x: number) => Math.round(x * 1e4) / 1e4 || 0, this.#beat()?.flags ?? []];
    return { playing: this.#action?.id ?? null, beat: this.beat ?? null, t: r(this.state.t), u: r(this.u), flags, clip: this.state.clip || null }; // prettier-ignore
  }

  /** The beat playing, if any. */
  #beat(): Beat | undefined {
    return this.#action?.beats[this.state.beat];
  }

  /** The index of the beat after the one playing: its `then`, the next in order, or −1 past the last. */
  #following(): number {
    const beats = this.#action?.beats ?? [];
    const then = beats[this.state.beat]?.then;
    if (then) return beats.findIndex((b) => b.name === then);
    return this.state.beat + 1 < beats.length ? this.state.beat + 1 : -1;
  }

  /** Begins beat `index` of `action` (−1, or none: rest) between steps: `events` are its own. */
  #start(action: Action | undefined, index: number): this {
    if (!this.#called) this.events.length = 0;
    this.#called = true;
    this.#enter(action, index, 0);
    return this;
  }

  /** Begins beat `index` of `action` (−1, or no action: rest), `late` seconds before the step's end. */
  #enter(action: Action | undefined, index: number, late: number): number {
    const st = this.state;
    const last = this.#beat()?.name ?? '';
    st.from = this.channels();
    st.from[CHANNELS.flip] = wrap(st.from[CHANNELS.flip]);
    const beat = action?.beats[index];
    [this.#action, st.playing, st.beat, st.t] = beat ? [action, action!.id, index, 0] : [undefined, '', -1, 0];
    if (!beat) {
      if (action && last) this.events.push({ type: 'end', phase: last, late });
      this.#clip();
      return -1;
    }
    this.events.push({ type: beat.name, phase: beat.name, late });
    for (const mark of beat.events) if (mark.at <= 0) this.events.push({ type: mark.type, phase: beat.name, late });
    this.#clip(beat);
    return index;
  }

  /** Plays `beat`'s clip; without one, fades out the clip its beats started, if it is still on top. */
  #clip(beat?: Beat): void {
    const [clips, st] = [this.clips, this.state];
    if (!clips) return;
    if (beat?.clip) {
      const { name, ...play } = beat.clip;
      const [library, clip] = clips.resolve(name);
      clips.play(name, play as ClipPlay);
      st.clip = `${library.name}/${clip}`;
    } else if (st.clip) {
      if (clips.current?.clip === st.clip && !clips.current.stopping) clips.stop();
      st.clip = '';
    }
  }

  /** `flipLayer`: squashes the body keeping its lowest point, turns it about its pivot, rolls it on the ground. */
  #turn(animator: Animator): void {
    const ch = this.channels();
    const { pose, world, skeleton, build: b, position, yaw } = animator.body;
    const [angle, axis] = [ch[CHANNELS.flip], FLIP_AXES[AXES[ch[CHANNELS.flip + 1]] ?? 'forward']];
    const scale = vs.fromArray(ch, CHANNELS.scale);
    const squashed = !scale.equals(vb.set(1, 1, 1));
    const ground = this.#beat()?.flip?.ground;
    if (!squashed && Math.abs(angle) < 1e-9 && !ground) return;
    if (squashed) {
      const low = lowest(skeleton, world);
      pose.rootScale.multiply(scale);
      forwardKinematics(skeleton, pose, world);
      pose.rootPos.y += low - lowest(skeleton, world);
    }
    const turn = qa.setFromAxisAngle(vb.fromArray(axis).applyAxisAngle(vc.set(0, 1, 0), yaw), angle);
    const pivot = vc.copy(position).setY(position.y + ACTION.pivot * b.hipHeight * b.size);
    pose.rootPos.sub(pivot).applyQuaternion(turn).add(pivot);
    pose.rootRot.premultiply(turn);
    forwardKinematics(skeleton, pose, world);
    if (ground) pose.rootPos.y += position.y - lowest(skeleton, world); // in the air, the arc is the game's
  }
}
