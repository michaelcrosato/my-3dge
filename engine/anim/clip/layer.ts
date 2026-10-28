/**
 * @file The clip layer (PLAN.md §10.4, WP 8.4): library clips played in the animator's `clips` slot (WP 3.7,
 * engine/anim/weights.ts), stacked, the last played on top (`current`), each fading in over what plays under it. A
 * full-body clip covers the clips under it: they play on until it is fully in, and fade out with it, by the same
 * step, when it stops first (shardfall's two slots, `shardfall:crates/pav_core/src/puppet.rs:582-615, 653-698`); a
 * masked or additive one lies over them, and they play on under it and after it. `locomote` picks an idle, a walk or
 * a run by ground speed, each loop at the character's ground speed (library.ts `walkRate`, `runOverWalk`).
 *
 * Each play takes my-3d2dge's moment fields (`my-3d2dge:src/emberdeep/96-hero-clips.js`, `HCL_MOVES`): `speed`,
 * `fade` and `out`, a bone `mask` ('upper': the legs keep the body's own), `loop`, `additive` (the clip's change from
 * its first frame, added), `mirror`, and the flags `walk` (moving or a flinch does not cancel it), `hold` (a one-shot
 * keeps its last pose), `next` (the clip that follows), `landed` (clip seconds by which a fall is down). Cancel rules:
 * an action takes the body back at once (0.07 s); moving over 1.25 m/s, or a flinch, fades a clip without `walk`.
 *
 * The two update paths (§6.4), as the animator's: `step` is the sim's, one fixed tick (times, fades, the walk–run
 * switch, cancels, events, root motion), on plain data (`state`, `save`, `load`: layerData.ts); `apply` is the view's,
 * sampling the clips on the animator's skeleton (retarget.ts: contact IK, the held blade above the floor) and laying
 * them over the pose. Events are a clip's own (format 2), `hit` (an attack's: its `hit` event, else its strike time),
 * `landed` and `end`, from each clip neither covered nor fading out: a cancelled or stopped attack lands no hit.
 *
 * Invariants: `apply` writes only the pose (the animator fades the layer by its `weight` and runs FK); a slot's weight
 * eases linearly and shows smoothstepped, and a slot goes only at 0 or under a full-body clip fully in: nothing pops.
 * Root motion is the top full-body clip's travel over the tick, metres in the character's frame at the layer's build
 * (`root`), which must be the animator's. Clip names are `SET/Clip`, or bare: the first library's with that name.
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
 * clips.current?.w; // 1: faded in over 0.12 s
 * @see engine/anim/clip/layer-play.test.ts (the play options; layer.test.ts, beside this file, tests the rest)
 */
import { codeError, didYouMean } from '../../core/log';
import { MathUtils, Quaternion, Vector3 } from '../../core/math';
import { SIM_DT } from '../../core/time';
import { getBuild, type Build } from '../builds';
import type { Animator } from '../character';
import { createWorldPose } from '../fk';
import { addPose, blendPoses, makeAdditive, Pose } from '../pose';
import { boneMask, createSkeleton, type Skeleton } from '../skeleton';
import type { AnimLayer } from '../weights';
import { travelAt, type BakedClip } from './bake';
import { clipPace, GROUND_SPEED, runOverWalk, walkRate, type ClipLibrary } from './library';
import type { Clip } from './readable';
import { CLIP_LAYER, type ClipLayerEvent, type ClipLayerOptions, type ClipLayerState, type ClipPlay, type ClipSlot, type ClipStepInput } from './layerData'; // prettier-ignore
import { hipRatio, retargetPose } from './retarget';

export { CLIP_LAYER } from './layerData';
export type { ClipLayerEvent, ClipLayerOptions, ClipLayerState, ClipPlay, ClipSlot, ClipStepInput } from './layerData';

const [clipPose, reference, delta, world] = [new Pose(), new Pose(), new Pose(), createWorldPose()];
const [UP, yaw, from, to] = [new Vector3(0, 1, 0), new Quaternion(), new Vector3(), new Vector3()];
const smooth = (w: number) => MathUtils.smoothstep(w, 0, 1);
/** Whether a slot covers what plays under it: a full-body clip, laid over, not added. */
const covers = (s: ClipSlot) => !s.play.additive && (!s.play.mask || s.play.mask === 'full');
/** A slot's bake, looping or not as its play says. */
const loopedAs = (baked: BakedClip, s: ClipSlot): BakedClip =>
  s.play.loop === undefined || s.play.loop === baked.loop ? baked : { ...baked, loop: s.play.loop };
/** The fade out of `s`: `fade`, else its `out`. */
const outOf = (s: ClipSlot, fade?: number) => Math.max(1e-6, fade ?? s.play.out ?? CLIP_LAYER.out);

/** Library clips in the animator's clip slot (see the file comment). */
export class ClipLayer implements AnimLayer {
  readonly name: string;
  /** The animator fades the whole layer by it. */
  weight = 1;
  readonly state: ClipLayerState = { slots: [], moving: null, running: false, ground: 0, root: [0, 0] };
  /** The last step's events. */
  readonly events: ClipLayerEvent[] = [];
  readonly dt: number;
  /** Whether `apply` plants the feet and lifts the pose (retarget.ts). */
  readonly ik: boolean;
  /** The held blade's length (m), or 0 for none. */
  readonly blade: number;
  readonly build: Build;
  readonly #libraries: readonly ClipLibrary[];
  readonly #skeleton: Skeleton;

  constructor(options: ClipLayerOptions) {
    this.#libraries = Array.isArray(options.library) ? options.library : [options.library as ClipLibrary];
    this.name = options.name ?? 'clips';
    this.build = typeof options.build === 'object' ? options.build : getBuild(options.build ?? 'build:chibi');
    this.#skeleton = createSkeleton(this.build);
    [this.dt, this.ik, this.blade] = [options.dt ?? SIM_DT, options.ik ?? true, options.blade ?? 0];
  }

  /** The clip on top, the one played last; null when none plays. */
  get current(): ClipSlot | null {
    return this.state.slots.at(-1) ?? null;
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
    // the closest names: `SET/Clip` for a name given with its set, bare names for a bare one
    const all = this.#libraries.flatMap((l) => l.names.map((n) => (set ? `${l.name}/${n}` : n)));
    const where = set || this.#libraries.map((l) => l.name).join(', ');
    throw codeError('ANIM_UNKNOWN_CLIP', { set: where, name: JSON.stringify(clip), suggestion: didYouMean(clip, all) });
  }

  /**
   * Plays `clip` on top, fading in over what plays now; the same clip already on top only takes the new `play`. Its
   * mask and `next` are checked now, so a step never throws: `ANIM_UNKNOWN_CLIP`, `ANIM_UNKNOWN_JOINT`,
   * `ANIM_BAD_MASK`.
   */
  play(clip: string, play: ClipPlay = {}): this {
    const [library, name] = this.resolve(clip);
    if (play.mask) boneMask(play.mask);
    if (play.next) this.resolve(play.next);
    const [c, id] = [this.current, `${library.name}/${name}`];
    if (c?.clip === id && !c.stopping) [c.play, c.loco] = [{ ...play }, false];
    else this.#start(id, play, false, this.state.slots.length);
    return this;
  }

  /**
   * Fades out the top clip not already fading, over `fade` seconds (its `out`), with the clips it covers: what lies
   * under it takes over, `locomote`'s loops, or the body's own animation. Stopping one of the loops ends `locomote`.
   */
  stop(fade?: number): this {
    const c = this.state.slots.filter((s) => !s.stopping).at(-1);
    if (c?.loco) this.state.moving = null;
    if (c) c.stopping = outOf(c, fade);
    return this;
  }

  /** Plays `idle` below 0.1 m/s, else `walk`, or `run` past the switch, each at ground speed; null stops it. */
  locomote(loops: ClipLayerState['moving']): this {
    if (loops) for (const name of Object.values(loops)) if (name) this.resolve(name);
    this.state.moving = loops;
    if (!loops) for (const s of this.state.slots) if (s.loco && !s.stopping) s.stopping = CLIP_LAYER.loco;
    return this;
  }

  /** Whether a fall played with `landed` is down. */
  down(): boolean {
    return this.state.slots.some((s) => s.play.landed !== undefined && s.t >= s.play.landed);
  }

  /** The sim's step, one fixed tick (see the file comment); returns the tick's events. */
  step(input: ClipStepInput = {}): ClipLayerEvent[] {
    const st = this.state;
    const ground = input.groundSpeed ?? 0;
    [st.ground, st.root, this.events.length] = [ground, [0, 0], 0];
    this.#cancel(input, ground);
    // the loops run unless a full-body clip of the caller's plays on
    if (st.moving && !st.slots.some((s) => !s.loco && !s.stopping && covers(s))) this.#locomote(ground);
    // top down: a full-body clip fading out takes what it covers with it, by the same step (`locomote`'s loops stay
    // its own); under one playing on, a slot is covered (no events); the top full-body one moves the root
    let [fade, covered, rooted] = [0, false, false];
    for (const s of st.slots.slice().reverse()) {
      if (fade && !s.stopping && !(s.loco && st.moving)) s.stopping = fade;
      const whole = covers(s);
      this.#advance(s, !covered, whole && !rooted);
      [covered, rooted, fade] = [covered || (whole && !s.stopping), rooted || whole, fade || (whole ? s.stopping : 0)];
    }
    // gone: the slots faded out, and every slot under a full-body clip fully in
    const top = st.slots.reduce((at, s, i) => (covers(s) && s.w >= 1 ? i : at), -1);
    st.slots = st.slots.filter((s, i) => i >= top && !(s.stopping && s.w <= 0));
    return this.events;
  }

  /** The view's part: the clips laid over the animator's pose, on its skeleton (`ANIM_LAYER_BUILD`: another build). */
  apply(animator: Animator): void {
    const [body, build] = [animator.body, this.build];
    if (body.build !== build) throw codeError('ANIM_LAYER_BUILD', { layer: build.id, animator: body.build.id });
    yaw.setFromAxisAngle(UP, body.yaw);
    for (const slot of this.state.slots) {
      if (slot.w <= 0) continue;
      const [library, name] = this.resolve(slot.clip);
      const baked = library.bake(name, slot.play.mirror); // its contacts too, mirrored with it
      const options = { world, ik: this.ik, lift: this.ik, blade: this.blade };
      const place = (pose: Pose) => {
        pose.rootPos.applyQuaternion(yaw).add(body.position);
        pose.rootRot.copy(yaw);
        return pose;
      };
      place(retargetPose(loopedAs(baked, slot), slot.t, body.skeleton, clipPose, options));
      const mask = slot.play.mask ? boneMask(slot.play.mask) : undefined;
      if (!slot.play.additive) blendPoses(body.pose, clipPose, smooth(slot.w), body.pose, { mask });
      else {
        place(retargetPose(baked, 0, body.skeleton, reference, options));
        addPose(body.pose, makeAdditive(clipPose, reference, delta), smooth(slot.w), body.pose, mask);
      }
    }
  }

  /** The layer as plain JSON: each slot, bottom first, the locomotion loops, the ground speed, the root motion. */
  inspect(): Record<string, unknown> {
    const r = (x: number) => Math.round(x * 1e4) / 1e4 || 0;
    const slot = (s: ClipSlot) => ({ clip: s.clip, t: r(s.t), w: r(s.w), rate: r(s.rate), stopping: s.stopping > 0, loco: s.loco, ...s.play }); // prettier-ignore
    const { slots, moving, running, ground, root } = this.state;
    return { slots: slots.map(slot), moving, running, ground: r(ground), root: root.map(r) };
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

  /** Starts `clip` in a new slot at `at` in the stack (the top: `slots.length`). */
  #start(clip: string, play: ClipPlay, loco: boolean, at: number): void {
    const w = (play.fade ?? CLIP_LAYER.fade) > 0 ? 0 : 1;
    this.state.slots.splice(at, 0, { clip, t: play.at ?? 0, w, rate: 0, stopping: 0, loco, play: { ...play } });
  }

  /** The cancel rules (see the file comment), for each clip but `locomote`'s loops. */
  #cancel(input: ClipStepInput, ground: number): void {
    for (const s of this.state.slots) {
      if (s.stopping || s.loco) continue;
      if (input.action) s.stopping = CLIP_LAYER.quick;
      else if (!s.play.walk && (ground > CLIP_LAYER.move || input.hurt)) s.stopping = outOf(s);
    }
  }

  /** Picks the idle, walk or run loop for `ground` m/s, with the walk–run switch's hysteresis. */
  #locomote(ground: number): void {
    const st = this.state;
    const loops = st.moving!;
    const pace = (name?: string) => (name ? clipPace(this.#find(name)[0], this.hipHeight) : null);
    st.running = !!loops.run && runOverWalk(pace(loops.walk), pace(loops.run), ground, st.running, this.hipHeight);
    const want = ground < GROUND_SPEED.idle ? loops.idle : st.running ? loops.run : loops.walk;
    const clip = want && this.#find(want)[1];
    // the loops not wanted fade out; the one wanted plays on, or starts under the clips laid over the top
    const live = st.slots.filter((s) => s.loco && !s.stopping);
    for (const s of live) if (s.clip !== clip) s.stopping = CLIP_LAYER.loco;
    if (!clip || live.some((s) => s.clip === clip)) return;
    let at = st.slots.length;
    while (at > 0 && !st.slots[at - 1].loco && !covers(st.slots[at - 1])) at--;
    this.#start(clip, { fade: CLIP_LAYER.loco }, true, at);
  }

  /** One tick of `slot`: its rate, time and fade; its events and end when `live` and not stopping, travel at `root`. */
  #advance(slot: ClipSlot, live: boolean, root: boolean): void {
    const [library, name] = this.resolve(slot.clip);
    const clip = library.clip(name);
    const pace = slot.loco ? clipPace(clip, this.hipHeight) : null;
    slot.rate = (slot.play.speed ?? 1) * (pace ? walkRate(pace, this.state.ground) : 1);
    const t0 = slot.t;
    slot.t += this.dt * slot.rate;
    const loop = slot.play.loop ?? !!clip.loop;
    // a slot fading out says nothing more: a cancelled or stopped attack lands no hit, a fall stopped early no `landed`
    if (live && !slot.stopping) this.#events(slot, library, name, t0, loop);
    if (live && !loop && t0 < clip.dur && slot.t >= clip.dur && !slot.stopping) {
      this.events.push({ type: 'end', clip: slot.clip });
      const next = slot.play.next;
      if (next) this.#start(this.#find(next)[1], {}, false, this.state.slots.indexOf(slot) + 1);
      else if (!slot.play.hold) slot.stopping = outOf(slot);
    }
    if (!loop && slot.play.hold && slot.t > clip.dur) slot.t = clip.dur;
    // fades step linearly, and snap to their ends (sixths of a second do not add up to 1 in floats)
    const step = this.dt / (slot.stopping || Math.max(1e-6, slot.play.fade ?? CLIP_LAYER.fade));
    if (slot.stopping) slot.w = slot.w - step > 1e-9 ? slot.w - step : 0;
    else slot.w = slot.w + step < 1 - 1e-9 ? slot.w + step : 1;
    // root motion: the clip's travel over the tick, at the layer's build
    const baked = root && !slot.loco ? loopedAs(library.bake(name, slot.play.mirror), slot) : null;
    if (!baked?.root) return;
    travelAt(baked, Math.min(slot.t, loop ? Infinity : clip.dur), to).sub(travelAt(baked, t0, from));
    to.multiplyScalar(hipRatio(baked, this.#skeleton));
    this.state.root = [to.x, to.z];
  }

  /** The events of `slot` crossed from `t0` to its time now (a loop's on every lap). */
  #events(slot: ClipSlot, library: ClipLibrary, name: string, t0: number, loop: boolean): void {
    const clip = library.clip(name);
    if (!loop && t0 >= clip.dur) return;
    // a mirrored clip's events happen on the other side
    const side = (s?: 'L' | 'R') => (s && slot.play.mirror ? ({ L: 'R', R: 'L' } as const)[s] : s);
    const marks: [number, ClipLayerEvent][] = (clip.events ?? []).map((e) => [e.t, { type: 'event', clip: slot.clip, name: e.name, ...(e.side && { side: side(e.side) }) }]); // prettier-ignore
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

  /** The clip `name` resolves to, and its `SET/Clip`. */
  #find(name: string): [Clip, string] {
    const [library, clip] = this.resolve(name);
    return [library.clip(clip), `${library.name}/${clip}`];
  }
}
