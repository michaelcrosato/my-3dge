/**
 * @file ACTIONS (PLAN.md WP 8.7; I-11; docs/ANIMATION-RESEARCH.md §2, §6): multi-beat sequences played on a body,
 * between one move and a behaviour. An action (the registry kind `action`; the engine's set is data/anim/actions/, one
 * file each, which a page or a tool reads and `loadActions` defines) is a list of beats (`BEAT_FIELDS`: body states,
 * a motion or a move, a library clip, IK targets, a flip, a squash, events, flags, a cancel window), each lasting its
 * `seconds`. A beat `until: 'next'` holds its contact frame (a charge, a hang, a fall) until the game calls `next()`
 * or `go(beat)`; `then` loops; `finish()` goes to the `exit` beat; a `pair` plays on a partner in lockstep
 * (`play(id, partner)`); `check` says how the `anim` QA plays it (`actionCheck`).
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
 * - Effector targets are `[forward, right, up]` metres (authoring.ts `B`) times the build's size: the grips and the
 *   gaze from the shoulder centre at rest, scaled by the arm's length over the reference arm; the soles from the
 *   ground under the body, scaled by the leg's over `build:chibi`'s.
 * - A flip turns the body `turns` times about a pivot `ACTION.pivot` hip heights up (a `ground` one, a roll, keeps its
 *   lowest point on its ground point; in the air the arc is the game's); a scale keeps the lowest point where it was.
 *
 * Carried from `my-3d2dge:src/emberdeep/96-hero-clips.js:31-49` (`HCL_MOVES`, as input: a moment's clip and its
 * speed, fades, mask, walk, hold, landed and next, as a beat's `clip` and the beats after it) and
 * `src/emberdeep/20-hero.js:193-196` (`heroRoll`: the pivot at 0.55 of the hip height, the eased whole turn).
 *
 * @example
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
import { registry as sharedRegistry, sameValue, type Entry, type Registry } from '../core/registry';
import { isPlainObject, validate } from '../core/schema';
import { SIM_DT } from '../core/time';
import { B } from './authoring';
import type { Animator } from './character';
import type { MatrixState } from './check';
import { ClipLayer, type ClipPlay } from './clip/layer';
import type { ClipLibrary } from './clip/library';
import { forwardKinematics, socketPosition, tipPosition, type WorldPose } from './fk';
import { aim, handTo, twoBoneRot } from './ik';
import { REFERENCE_ARM } from './moves-data';
import { blendPoses, Pose } from './pose';
import { boneMask, JOINT_COUNT, MASKS, SOCKETS, socketIndex, type Skeleton } from './skeleton';
import { BODY_STATES, type AnimatorInput } from './states';
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

/**
 * Every constant: `out`, the seconds the channels ease back to rest after an action; `pivot`, the flip's pivot above
 * the ground, a share of the hip height (`heroRoll`'s `cz`); `arm` and `leg`, the metres hand and foot targets are
 * written for (the reference arm, moves-data.ts; `build:chibi`'s thigh and shin).
 */
export const ACTION = { out: 0.2, pivot: 0.55, arm: REFERENCE_ARM, leg: 0.75 } as const;

/** What a flip turns about, in the body's frame: the top of the body goes forward, back, left, right; or it spins left. */
export const FLIP_AXES = { forward: [1, 0, 0], back: [-1, 0, 0], left: [0, 0, -1], right: [0, 0, 1], spin: [0, 1, 0] } as const; // prettier-ignore

/** The effectors a beat may pull, in channel order. */
export const EFFECTORS = ['handL', 'handR', 'footL', 'footR', 'look'] as const;

/** Schema shorthands: a `[forward, right, up]` target, a flag, a share, a number that defaults to 0. */
const fru = (description: string) => ({ type: 'array', items: { type: 'number' }, unit: 'm', description }) as const;
const flag = (description: string) => ({ type: 'boolean', description }) as const;
const share = (description: string) => ({ type: 'number', minimum: 0, maximum: 1, default: 0, description }) as const; // prettier-ignore
const zero = (description: string, unit: string) => ({ type: 'number', default: 0, unit, description }) as const;
const seconds = (description: string) => ({ type: 'number', minimum: 0, unit: 's', description }) as const;

/** The fields of a beat. */
// prettier-ignore
export const BEAT_FIELDS = {
  name: { type: 'string', required: true, description: 'Its name, fired as an event as it begins; `go` takes it.' },
  seconds: { ...seconds('How long it lasts; held until next, how long its channels take to reach their targets.'), required: true },
  until: { type: 'string', enum: ['time', 'next'], default: 'time', description: 'Ends after its seconds, or holds until next() or go().' },
  then: { type: 'string', default: '', description: 'The beat that follows ("": the next in order; a loop names one).' },
  body: { type: 'object', description: 'Body states told to the humanoid while it plays: pose, stance, air, down… (states.ts BODY_STATES).' },
  motion: { type: 'object', description: 'A body motion it eases to (locomotion.ts BodyMotion); none: 0 each.', properties: {
    lean: zero('Forward lean.', 'rad'), lunge: zero('Step forward of the pelvis and the lead foot.', 'm'),
    hop: zero('Lift of the whole body.', 'm'), crouch: share('Crouch share.'),
    twist: zero('Turn of the shoulders toward the right hand.', 'rad'),
  } },
  move: { type: 'object', description: 'A move at one phase over the beat (its arm path and body motion), not a motion.', properties: {
    id: { type: 'string', required: true, description: 'The move: move:overhead, or overhead.' },
    phase: { type: 'string', enum: ['wind', 'active', 'recover'], required: true, description: 'The phase.' },
    u: { type: 'array', items: { type: 'number' }, default: [0, 1], description: 'Its share at the start and end.' },
  } },
  effectors: { type: 'object', description: 'IK targets [forward, right, up], metres (see the file comment).', properties: {
    handL: fru("The left hand's grip, from the shoulder centre."), handR: fru("The right hand's grip, likewise."),
    footL: fru('The left sole, from the ground under the body.'), footR: fru('The right sole, likewise.'),
    look: fru('Where the eyes look, from the shoulder centre.'),
  } },
  flip: { type: 'object', description: 'The whole body turned over the beat, eased: whole turns end upright.', properties: {
    turns: { type: 'number', default: 1, description: 'Turns over the beat.' }, ground: flag('A roll: its lowest point stays on the ground.'),
    axis: { type: 'string', enum: Object.keys(FLIP_AXES), default: 'forward', description: 'Which way (FLIP_AXES).' },
  } },
  scale: { type: 'array', items: { type: 'number', minimum: 0.01 }, description: 'The body squashed: [x, y, z].' },
  clip: { type: 'object', description: 'A library clip played as it begins (ClipPlay); the same clip keeps its time.', properties: {
    name: { type: 'string', required: true, description: 'SET/Clip, or a bare name.' },
    speed: { type: 'number', minimum: 0, description: 'Playback rate (0 holds the frame).' },
    fade: seconds('Seconds it fades in.'), out: seconds('Seconds it fades out.'), at: seconds('Clip seconds it starts from.'),
    mask: { type: 'string', enum: MASKS, description: 'The joints it plays (skeleton.ts MASKS).' },
    loop: flag('Loops, or not.'), additive: flag('Added to the pose under it.'), mirror: flag('Left and right swapped.'),
    walk: flag('Moving or a flinch does not cancel it.'), hold: flag('A one-shot keeps its last pose.'),
    landed: seconds('Clip seconds by which a fall is down.'),
  } },
  events: { type: 'array', default: [], description: 'Events at shares of its seconds.', items: { type: 'object', properties: {
    type: { type: 'string', required: true, description: 'The event.' }, at: share('Share of the beat where it fires.'),
  } } },
  cancel: { type: 'object', description: 'What may cut it (move, action, walk, jump, hurt, any), from a share on.', properties: {
    by: { type: 'array', items: { type: 'string' }, required: true, description: 'What may cut it.' },
    after: share('Share of the beat from which it may.'),
  } },
  flags: { type: 'array', items: { type: 'string' }, default: [], description: 'Flags it raises (invulnerable).' },
} as const;

/** The fields of an `action` entry. */
// prettier-ignore
export const ACTION_FIELDS = {
  desc: { type: 'string', required: true, description: 'What it is and where its timing comes from.' },
  beats: { type: 'array', required: true, items: { type: 'object', properties: BEAT_FIELDS }, description: 'Its beats.' },
  exit: { type: 'string', default: '', description: 'The beat finish() goes to ("": it stops).' },
  pair: { type: 'string', default: '', description: "The partner's action, played in lockstep (a grab's victim)." },
  check: { type: 'object', default: { seconds: 0, signals: [], lift: [] }, description: 'How the anim QA plays it (actionCheck).', properties: {
    seconds: { ...seconds('How long (0: the last signal, then its length, plus ACTION.out).'), default: 0 },
    signals: { type: 'array', default: [], description: 'What the game does, when: next, finish, stop or a beat (go).', items: {
      type: 'object', properties: {
        at: { ...seconds('Seconds after it starts.'), required: true },
        do: { type: 'string', required: true, description: 'next, finish, stop or a beat.' },
      } } },
    lift: { type: 'array', default: [], items: { type: 'array', items: { type: 'number' } },
      description: "[seconds, metres] points: the body's height, linear between them (the jump the game makes)." },
  } },
} as const;

/** An `action` entry. */
export type Action = Entry<typeof ACTION_FIELDS>;

/** One beat of an action. */
export type Beat = Action['beats'][number];

/** A value with every field optional, all the way down: what a spec leaves out takes its default. */
type Loose<T> = T extends readonly (infer I)[] ? readonly Loose<I>[] : T extends object ? { readonly [K in keyof T]?: Loose<T[K]> } : T; // prettier-ignore

/** What `defineAction` takes: `desc` and `beats`, each beat's `name` and `seconds`; the rest as it likes. */
export type ActionSpec = Loose<Omit<Action, 'id' | 'kind'>> & { desc: string; beats: readonly (Loose<Beat> & { name: string; seconds: number })[] }; // prettier-ignore

/** The problems of an action beyond its fields. */
function actionProblems(a: Action): string[] {
  const out: string[] = [];
  const names = a.beats.map((b) => b.name);
  const known = (name: string, what: string, among = names) =>
    name && !among.includes(name) && out.push(`${what} ${JSON.stringify(name)} is unknown${didYouMean(name, among)}`); // prettier-ignore
  if (!names.length) out.push('it has no beats');
  names.forEach((name, i) => names.indexOf(name) < i && out.push(`two beats are named ${JSON.stringify(name)}`));
  a.beats.forEach((b) => {
    known(b.then, `beat ${b.name}'s then`);
    if (b.move && b.motion) out.push(`beat ${b.name} has a move and a motion: a move brings its own`);
    for (const word of Object.keys(b.body ?? {})) known(word, `beat ${b.name}'s body state`, Object.keys(BODY_STATES));
    const triples = [...Object.values(b.effectors ?? {}), b.scale ?? [1, 1, 1]];
    if (triples.some((v) => v?.length !== 3)) out.push(`beat ${b.name} has a target or a scale that is not 3 numbers`);
  });
  known(a.exit, 'exit');
  for (const s of a.check.signals) if (!['next', 'finish', 'stop'].includes(s.do)) known(s.do, 'a check signal');
  const held = a.beats.some((b) => b.until === 'next' || b.then);
  if (held && !a.check.signals.length) out.push('a beat holds or loops, so check.signals must say when it moves on');
  return out;
}

/** Declares the kind `action` on `registry`, unless it has it. */
export function actionKind(registry: Registry): void {
  if (registry.kinds().includes('action')) return;
  registry.defineKind('action', {
    description: 'A multi-beat sequence played on a body: beats of body states, clips, IK targets, flips and events.',
    fields: ACTION_FIELDS,
    defineWith: "defineAction('<id>', { desc, beats: [{ name, seconds, … }] })",
    check: (entry) => actionProblems(entry as Action),
  });
}
actionKind(sharedRegistry);

/** Defines an action on `registry` (the shared one). Throws `CORE_BAD_SPEC` naming each problem, `CORE_DUPLICATE_ID`. */
export function defineAction(id: string, spec: ActionSpec, registry: Registry = sharedRegistry): Action {
  actionKind(registry);
  return registry.def('action', id, spec as Record<string, unknown>) as Action;
}

/** The action `id` (`action:jump`, or `jump`); a missing one throws `CORE_NO_ENTRY`, naming the closest. */
export function getAction(id: string, registry: Registry = sharedRegistry): Action {
  actionKind(registry);
  return registry.get('action', id.includes(':') ? id : `action:${id}`) as Action;
}

/**
 * Defines the actions of files read from data/anim/actions/ (each `{ "action": "<name>", …spec }`, as
 * `action:<name>`) and returns them. A file defined before with the same spec is kept; another spec throws
 * `CORE_DUPLICATE_ID`, a bad one `CORE_BAD_SPEC`.
 */
export function loadActions(files: readonly unknown[], registry: Registry = sharedRegistry): Action[] {
  actionKind(registry);
  return files.map((file) => {
    const { action, ...spec } = isPlainObject(file) ? file : {};
    const where = 'an action file';
    if (typeof action !== 'string' || !action)
      throw codeError('CORE_BAD_SPEC', { where, problems: 'no "action" name' });
    const id = `action:${action}`;
    const kept = registry.has('action', id) ? (registry.get('action', id) as Action) : undefined;
    const same = (value: object) => Object.entries(value).every(([k, v]) => sameValue(v, kept?.[k as keyof Action]));
    return kept && same(validate(ACTION_FIELDS, spec).value) ? kept : defineAction(id, spec as ActionSpec, registry);
  });
}

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
   * `partner` (a grab's victim), which then steps in lockstep with it.
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

/** The body's height in `check.lift` at `t` seconds: linear between its points, flat beyond them. */
function liftAt(points: readonly (readonly number[])[], t: number): number {
  const i = points.findIndex((p) => p[0] > t);
  if (i <= 0) return (i < 0 ? points.at(-1) : points[0])?.[1] ?? 0;
  const [[t0, y0], [t1, y1]] = [points[i - 1], points[i]];
  return MathUtils.lerp(y0, y1, (t - t0) / Math.max(1e-9, t1 - t0));
}

/**
 * The action's check: a state of the matrix (check.ts) that plays it as `check` says, on the animator's build with a
 * clip layer over `libraries` (its clip beats' sets), signalling at its times and lifting the body by `lift` (times
 * the build's size). `registry` is where it is defined (the shared one).
 */
export function actionCheck(
  action: Action | string,
  options: { libraries?: readonly ClipLibrary[]; registry?: Registry } = {},
): MatrixState {
  const registry = options.registry ?? sharedRegistry;
  const entry = typeof action === 'string' ? getAction(action, registry) : action;
  const { seconds, signals, lift } = entry.check;
  const length = entry.beats.reduce((sum, b) => sum + (b.until === 'next' ? 0 : b.seconds), 0);
  return {
    seconds: seconds || Math.max(0, ...signals.map((s) => s.at)) + length + ACTION.out, // the last signal, then the rest
    script: (animator) => {
      const { dt, build } = animator.body;
      const libraries = options.libraries ?? [];
      const clips = libraries.length ? new ClipLayer({ library: libraries, build, dt }) : undefined;
      if (clips) animator.use('clips', clips);
      const acts = new Actions({ clips, dt, registry }).attach(animator);
      let n = 0;
      return (step) => {
        const [now, end] = [n * step, ++n * step];
        if (now === 0) acts.play(entry);
        for (const s of signals) {
          if (s.at <= now - TICK_EPSILON || s.at > end - TICK_EPSILON) continue;
          if (s.do === 'next' || s.do === 'finish' || s.do === 'stop') acts[s.do]();
          else acts.go(s.do);
        }
        acts.step();
        clips?.step({ groundSpeed: 0 });
        return { ...acts.body, position: new Vector3(0, liftAt(lift, end) * build.size, 0) };
      };
    },
  };
}
