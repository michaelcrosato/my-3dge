/**
 * @file The clip layer (PLAN.md §10.4, WP 8.4): library clips played in the animator's `clips` slot (WP 3.7,
 * engine/anim/weights.ts). `play` crossfades a clip in over what plays now, the clip before kept playing under it
 * until the new one is fully in (shardfall's two slots, `shardfall:crates/pav_core/src/puppet.rs:582-615,
 * 653-698`); `stop` fades it out and the body's own animation takes over; `locomote` picks an idle, a walk or a run
 * by ground speed, each loop played at the character's ground speed (library.ts `walkRate`, `runOverWalk`).
 *
 * Each play takes my-3d2dge's moment fields (`my-3d2dge:src/emberdeep/96-hero-clips.js`, `HCL_MOVES`): `speed`,
 * `fade` and `out`, a bone `mask` ('upper': the legs keep the body's own), `loop`, `additive` (the clip's change from
 * its first frame, added), `mirror`, and the flags `walk` (moving or a flinch does not cancel it), `hold` (a one-shot
 * keeps its last pose), `next` (the clip that follows), `landed` (clip seconds by which a fall is down). Cancel rules:
 * an action takes the body back at once (0.07 s); moving faster than 1.25 m/s, or a flinch, fades a clip without
 * `walk`.
 *
 * The two update paths (§6.4), as the animator's: `step` is the sim's, one fixed tick (times, fades, the walk–run
 * switch, cancels, events, root motion), on plain data (`state`, `save`, `load`); `apply` is the view's, sampling the
 * clips on the animator's skeleton (retarget.ts, contact IK included) and laying them over the pose. Events are a
 * clip's own (format 2), `hit` (an attack's: its `hit` event, else its strike time), `landed` and `end`.
 *
 * Invariants: `apply` writes only the pose (the animator fades the layer by its `weight` and runs FK); a slot's weight
 * eases linearly and shows smoothstepped. Root motion is the clip's travel over the tick, metres in the character's
 * frame at the layer's build (`root`); the pose itself plays in place. Clip names are `SET/Clip`, or a bare name
 * found in the first library that has it; an unknown one throws `ANIM_UNKNOWN_CLIP`.
 *
 * @example
 * import { Animator } from '../character';
 * import { REST, standing } from '../../../tests/unit/anim/clip-fixtures';
 * import { loadClipLibrary } from './library';
 * const up = { ...standing(0.25), armR: [0, 30, 100, 0, 0] };
 * const wave = { src: 'A', dur: 0.5, keys: [standing(0), up, standing(0.5)] };
 * const library = loadClipLibrary({ set: 'TEST', sources: { A: { rest: REST } }, clips: { Wave: wave } });
 * const clips = new ClipLayer({ library, build: 'build:heroic' });
 * const hero = new Animator({ build: 'build:heroic' }).use('clips', clips);
 * clips.play('Wave', { mask: 'upper', walk: true }); // a wave over whatever the legs do
 * for (let i = 0; i < 12; i++) [hero.step(), clips.step({ groundSpeed: 0 })]; // the sim's ticks
 * hero.pose(); // the view: the body's own pose, then the wave laid over it
 * clips.state.current?.w; // 1: faded in over 0.12 s
 * @see engine/anim/clip/layer.test.ts
 */
import { codeError, didYouMean } from '../../core/log';
import { MathUtils, Quaternion, Vector3 } from '../../core/math';
import { SIM_DT } from '../../core/time';
import { getBuild, type Build } from '../builds';
import type { Animator } from '../character';
import { createWorldPose } from '../fk';
import { addPose, blendPoses, makeAdditive, Pose } from '../pose';
import { boneMask, createSkeleton, type JointName, type MaskName, type Skeleton } from '../skeleton';
import type { AnimLayer } from '../weights';
import { travelAt, type BakedClip } from './bake';
import { clipPace, GROUND_SPEED, runOverWalk, walkRate, type ClipLibrary } from './library';
import { hipRatio, retargetPose } from './retarget';

/** How a clip plays (see the file comment). */
export interface ClipPlay {
  /** Playback rate, 1 as captured. */
  speed?: number;
  /** Seconds it fades in over what plays now (0.12; 0 at once). */
  fade?: number;
  /** Seconds it fades out when stopped or ended (0.2). */
  out?: number;
  /** Clip seconds it starts from (0). */
  at?: number;
  /** The joints it plays: a preset, or joints and presets (`boneMask`). */
  mask?: MaskName | readonly (JointName | MaskName | 'root')[];
  /** Loops, or not, whatever the clip says. */
  loop?: boolean;
  /** Added to the pose under it (its change from its first frame), not laid over it. */
  additive?: boolean;
  /** Left and right swapped. */
  mirror?: boolean;
  /** Moving or a flinch does not cancel it. */
  walk?: boolean;
  /** A one-shot keeps its last pose until stopped. */
  hold?: boolean;
  /** The clip that follows when this one ends. */
  next?: string;
  /** Clip seconds by which a fall is down: a `landed` event, and `down()` from then. */
  landed?: number;
  /** Played as an attack: a `hit` event at its `hit` event, else at its strike time. */
  attack?: boolean;
}

/** A slot: a playing clip and where it is. Plain data. */
export interface ClipSlot {
  /** `SET/Clip`. */
  clip: string;
  /** Clip seconds (a loop's run on; sampling wraps them). */
  t: number;
  /** Its fade, 0–1. */
  w: number;
  /** The last tick's rate. */
  rate: number;
  /** Seconds of the fade out under way; 0 while it plays on. */
  stopping: number;
  /** Picked by `locomote`. */
  loco: boolean;
  play: ClipPlay;
}

/** The layer's state, plain data: what `step` changes and `save` copies. */
export interface ClipLayerState {
  current: ClipSlot | null;
  previous: ClipSlot | null;
  /** The loops `locomote` picks from, by ground speed. */
  moving: { idle?: string; walk: string; run?: string } | null;
  /** Whether the run plays (the walk–run switch's side). */
  running: boolean;
  /** The last tick's ground speed, m/s. */
  ground: number;
  /** The last tick's root motion `[x, z]`, metres in the character's frame. */
  root: [number, number];
}

/** An event of the tick `step` took. */
export type ClipLayerEvent =
  { type: 'event'; clip: string; name: string; side?: 'L' | 'R' } | { type: 'hit' | 'landed' | 'end'; clip: string };

/** What `step` reads. */
export interface ClipStepInput {
  /** The character's speed over the ground, m/s. */
  groundSpeed?: number;
  /** A flinch: fades a clip without `walk`. */
  hurt?: boolean;
  /** An action or a roll: takes the body back at once. */
  action?: boolean;
}

/** The layer's defaults: fades (s), the cancel speed (m/s), the locomotion crossfade (shardfall's `FADE`). */
export const CLIP_LAYER = { fade: 0.12, out: 0.2, quick: 0.07, move: 1.25, loco: 0.25 } as const;

/** What a `ClipLayer` is made with. */
export interface ClipLayerOptions {
  /** The libraries its clips come from. */
  library: ClipLibrary | readonly ClipLibrary[];
  /** Its name in the animator ('clips'). */
  name?: string;
  /** The build its paces and root motion are measured on (the animator's; `build:chibi`). */
  build?: Build | string;
  /** The fixed step (`SIM_DT`). */
  dt?: number;
  /** Contact IK and the lift (retarget.ts; true); off, the pose is the rotation copy alone, as a mixer plays it. */
  ik?: boolean;
}

/** Scratch. */
const [clipPose, reference, delta] = [new Pose(), new Pose(), new Pose()];
const [world, from, to] = [createWorldPose(), new Vector3(), new Vector3()];
const [UP, yaw] = [new Vector3(0, 1, 0), new Quaternion()];
const smooth = (w: number) => MathUtils.smoothstep(w, 0, 1);

/** Library clips in the animator's clip slot (see the file comment). */
export class ClipLayer implements AnimLayer {
  readonly name: string;
  /** The animator fades the whole layer by it. */
  weight = 1;
  readonly state: ClipLayerState = { current: null, previous: null, moving: null, running: false, ground: 0, root: [0, 0] }; // prettier-ignore
  /** The last step's events. */
  readonly events: ClipLayerEvent[] = [];
  readonly dt: number;
  /** Whether `apply` plants the feet and lifts the pose (retarget.ts). */
  readonly ik: boolean;
  readonly build: Build;
  readonly #libraries: readonly ClipLibrary[];
  readonly #skeleton: Skeleton;

  constructor(options: ClipLayerOptions) {
    this.#libraries = Array.isArray(options.library) ? options.library : [options.library as ClipLibrary];
    this.name = options.name ?? 'clips';
    this.build = typeof options.build === 'object' ? options.build : getBuild(options.build ?? 'build:chibi');
    this.#skeleton = createSkeleton(this.build);
    this.dt = options.dt ?? SIM_DT;
    this.ik = options.ik ?? true;
  }

  /** The standing hip height of the layer's build, metres. */
  get hipHeight(): number {
    return (this.build.legUpper + this.build.legLower) * this.build.size;
  }

  /** The library and name of `clip` (`SET/Clip` or a bare name). Throws `ANIM_UNKNOWN_CLIP`. */
  resolve(clip: string): [ClipLibrary, string] {
    const cut = clip.indexOf('/');
    const [set, name] = cut >= 0 ? [clip.slice(0, cut), clip.slice(cut + 1)] : ['', clip];
    const found = this.#libraries.find((l) => (!set || l.name.toLowerCase() === set.toLowerCase()) && l.has(name));
    if (found) return [found, name];
    const all = this.#libraries.flatMap((l) => l.names.map((n) => `${l.name}/${n}`));
    const where = set || this.#libraries.map((l) => l.name).join(', ');
    throw codeError('ANIM_UNKNOWN_CLIP', { set: where, name: JSON.stringify(clip), suggestion: didYouMean(clip, all) });
  }

  /** Plays `clip`, crossfading from what plays now; the same clip already playing only takes the new `play`. */
  play(clip: string, play: ClipPlay = {}): this {
    const [library, name] = this.resolve(clip);
    this.#start(`${library.name}/${name}`, play, false);
    return this;
  }

  /** Fades the clip out over `fade` seconds (its `out`); the body's own animation, or `locomote`'s, takes over. */
  stop(fade?: number): this {
    const c = this.state.current;
    if (c?.loco) this.state.moving = null;
    if (c && !c.stopping) c.stopping = Math.max(1e-6, fade ?? c.play.out ?? CLIP_LAYER.out);
    return this;
  }

  /** Plays `idle` below 0.1 m/s, else `walk`, or `run` past the switch, each at ground speed; null stops it. */
  locomote(loops: ClipLayerState['moving']): this {
    if (loops) for (const name of Object.values(loops)) if (name) this.resolve(name);
    this.state.moving = loops;
    const c = this.state.current;
    if (!loops && c?.loco && !c.stopping) c.stopping = CLIP_LAYER.loco;
    return this;
  }

  /** Whether a fall played with `landed` is down. */
  down(): boolean {
    const c = this.state.current;
    return !!c && c.play.landed !== undefined && c.t >= c.play.landed;
  }

  /** The sim's step, one fixed tick (see the file comment); returns the tick's events. */
  step(input: ClipStepInput = {}): ClipLayerEvent[] {
    const st = this.state;
    const ground = input.groundSpeed ?? 0;
    [st.ground, st.root, this.events.length] = [ground, [0, 0], 0];
    this.#cancel(input, ground);
    if (st.moving && (!st.current || st.current.loco || st.current.stopping)) this.#locomote(ground);
    const [c, p] = [st.current, st.previous];
    if (c) this.#advance(c, true);
    if (p && p === st.previous) this.#advance(p, false);
    if (st.previous && (!st.current || st.current.w >= 1 || st.previous.w <= 0)) st.previous = null;
    return this.events;
  }

  /** Lays the playing clips over the animator's pose, on its skeleton, where it stands (the view's part). */
  apply(animator: Animator): void {
    const { body } = animator;
    yaw.setFromAxisAngle(UP, body.yaw);
    for (const slot of [this.state.previous, this.state.current]) {
      if (!slot || slot.w <= 0) continue;
      const [library, name] = this.resolve(slot.clip);
      const baked = library.bake(name, slot.play.mirror);
      const options = { contacts: library.clip(name).contacts, world, ik: this.ik, lift: this.ik };
      const place = (pose: Pose) => {
        pose.rootPos.applyQuaternion(yaw).add(body.position);
        pose.rootRot.copy(yaw);
        return pose;
      };
      place(retargetPose(this.#bakedFor(baked, slot), slot.t, body.skeleton, clipPose, options));
      const mask = slot.play.mask ? boneMask(slot.play.mask) : undefined;
      if (!slot.play.additive) blendPoses(body.pose, clipPose, smooth(slot.w), body.pose, { mask });
      else {
        place(retargetPose(baked, 0, body.skeleton, reference, options));
        addPose(body.pose, makeAdditive(clipPose, reference, delta), smooth(slot.w), body.pose, mask);
      }
    }
  }

  /** The layer as plain JSON: each slot, the locomotion loops, the ground speed, the root motion. */
  inspect(): Record<string, unknown> {
    const r = (x: number) => Math.round(x * 1e4) / 1e4 || 0;
    const slot = (s: ClipSlot | null) =>
      s && { clip: s.clip, t: r(s.t), w: r(s.w), rate: r(s.rate), stopping: s.stopping > 0, loco: s.loco, ...s.play };
    const { moving, running, ground, root } = this.state;
    return { current: slot(this.state.current), previous: slot(this.state.previous), moving, running, ground: r(ground), root: root.map(r) }; // prettier-ignore
  }

  /** A copy of `state`, plain data. */
  save(): ClipLayerState {
    return JSON.parse(JSON.stringify(this.state)) as ClipLayerState;
  }

  /** Reads `state` (copied, never kept). */
  load(state: Readonly<ClipLayerState>): this {
    Object.assign(this.state, JSON.parse(JSON.stringify(state)) as ClipLayerState);
    return this;
  }

  /** A slot's bake, looping or not as its play says. */
  #bakedFor(baked: BakedClip, slot: ClipSlot): BakedClip {
    return slot.play.loop === undefined || slot.play.loop === baked.loop ? baked : { ...baked, loop: slot.play.loop };
  }

  /** Starts `clip` in the current slot, the one playing moving under it (see `play`). */
  #start(clip: string, play: ClipPlay, loco: boolean): void {
    const st = this.state;
    const c = st.current;
    if (c && c.clip === clip && !c.stopping) {
      [c.play, c.loco] = [{ ...play }, loco];
      return;
    }
    if (c && c.w > 0) st.previous = { ...c, stopping: 0 };
    const w = (play.fade ?? CLIP_LAYER.fade) > 0 ? 0 : 1;
    st.current = { clip, t: play.at ?? 0, w, rate: 0, stopping: 0, loco, play: { ...play } };
  }

  /** The cancel rules (see the file comment). */
  #cancel(input: ClipStepInput, ground: number): void {
    const c = this.state.current;
    if (!c || c.stopping || c.loco) return;
    if (input.action) this.stop(CLIP_LAYER.quick);
    else if (!c.play.walk && (ground > CLIP_LAYER.move || input.hurt)) this.stop();
  }

  /** Picks the idle, walk or run loop for `ground` m/s, with the walk–run switch's hysteresis. */
  #locomote(ground: number): void {
    const st = this.state;
    const loops = st.moving!;
    const pace = (name?: string) => (name ? clipPace(this.#clip(name), this.hipHeight) : null);
    st.running = !!loops.run && runOverWalk(pace(loops.walk), pace(loops.run), ground, st.running, this.hipHeight);
    const want = ground < GROUND_SPEED.idle ? loops.idle : st.running ? loops.run : loops.walk;
    const c = st.current;
    if (!want) {
      if (c?.loco && !c.stopping) c.stopping = CLIP_LAYER.loco;
      return;
    }
    const [library, name] = this.resolve(want);
    const clip = `${library.name}/${name}`;
    if (c?.clip !== clip || c.stopping) this.#start(clip, { fade: CLIP_LAYER.loco }, true);
  }

  /** One tick of `slot`: its rate, time, fade, events and travel (the current slot's only). */
  #advance(slot: ClipSlot, current: boolean): void {
    const [library, name] = this.resolve(slot.clip);
    const clip = library.clip(name);
    const pace = slot.loco ? clipPace(clip, this.hipHeight) : null;
    slot.rate = (slot.play.speed ?? 1) * (pace ? walkRate(pace, this.state.ground) : 1);
    const t0 = slot.t;
    slot.t += this.dt * slot.rate;
    const loop = slot.play.loop ?? !!clip.loop;
    if (current) this.#events(slot, library, name, t0, loop);
    if (current && !loop && t0 < clip.dur && slot.t >= clip.dur && !slot.stopping) {
      this.events.push({ type: 'end', clip: slot.clip });
      if (slot.play.next) this.#start(this.#name(slot.play.next), {}, false);
      else if (!slot.play.hold) slot.stopping = slot.play.out ?? CLIP_LAYER.out;
    }
    if (!loop && slot.play.hold && slot.t > clip.dur) slot.t = clip.dur;
    // fades step linearly, and snap to their ends (sixths of a second do not add up to 1 in floats)
    const step = this.dt / (slot.stopping || Math.max(1e-6, slot.play.fade ?? CLIP_LAYER.fade));
    if (slot.stopping) slot.w = slot.w - step > 1e-9 ? slot.w - step : 0;
    else if (current) slot.w = slot.w + step < 1 - 1e-9 ? slot.w + step : 1;
    if (current && slot.w <= 0 && slot.stopping) this.state.current = null;
    if (current && !slot.loco) this.#travel(library.bake(name, slot.play.mirror), t0, Math.min(slot.t, loop ? Infinity : clip.dur)); // prettier-ignore
  }

  /** The events of `slot` crossed from `t0` to its time now (a loop's on every lap). */
  #events(slot: ClipSlot, library: ClipLibrary, name: string, t0: number, loop: boolean): void {
    const clip = library.clip(name);
    if (!loop && t0 >= clip.dur) return;
    const marks: [number, ClipLayerEvent][] = (clip.events ?? []).map((e) => [e.t, { type: 'event', clip: slot.clip, name: e.name, ...(e.side && { side: e.side }) }]); // prettier-ignore
    if (slot.play.attack) {
      const hit = clip.events?.find((e) => e.name === 'hit')?.t ?? library.strikeTime(name);
      marks.push([hit, { type: 'hit', clip: slot.clip }]);
    }
    if (slot.play.landed !== undefined) marks.push([slot.play.landed, { type: 'landed', clip: slot.clip }]);
    const dur = clip.dur;
    for (const [at, event] of marks) {
      const first = loop && dur > 0 ? at + Math.ceil((t0 - at) / dur) * dur : at;
      for (let e = first; e < slot.t && e >= t0; e += loop && dur > 0 ? dur : Infinity) this.events.push(event);
    }
  }

  /** Root motion: the clip's travel from `t0` to `t1`, at the layer's build. */
  #travel(baked: BakedClip, t0: number, t1: number): void {
    if (!baked.root) return;
    travelAt(baked, t1, to)
      .sub(travelAt(baked, t0, from))
      .multiplyScalar(hipRatio(baked, this.#skeleton));
    this.state.root = [to.x, to.z];
  }

  /** The clip `name` resolves to. */
  #clip(name: string) {
    const [library, clip] = this.resolve(name);
    return library.clip(clip);
  }

  /** `SET/Clip` for `name`. */
  #name(name: string): string {
    const [library, clip] = this.resolve(name);
    return `${library.name}/${clip}`;
  }
}
