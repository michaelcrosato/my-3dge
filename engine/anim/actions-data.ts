/**
 * @file ACTION DATA (PLAN.md WP 8.7; I-11; docs/ANIMATION-RESEARCH.md §2, §6): the registry kind `action`, what
 * engine/anim/actions.ts `Actions` plays. The engine's set is data/anim/actions/, one file each, which a page or a tool
 * reads and `loadActions` defines. An action is a list of beats (`BEAT_FIELDS`: body states, a motion or a move, a
 * library clip, IK targets, a flip, a squash, events, flags, a cancel window), each lasting its `seconds`; `exit` is
 * the beat `finish()` goes to, `pair` the partner's action played in lockstep, and `check` says how the `anim` QA
 * plays it (engine/anim/actions-check.ts `actionCheck`). Beyond its fields, an action is checked whole
 * (`actionProblems`): beat names unique and known, a move or a motion, triples of 3, signals for any beat that holds.
 *
 * Effector targets are `[forward, right, up]` metres (authoring.ts `B`) times the build's size: the grips and the gaze
 * from the shoulder centre at rest, scaled by the arm's length over `ACTION.arm`; the soles from the ground under the
 * body, scaled by the leg's over `ACTION.leg`. Split from actions.ts to keep each under 400 lines (ADR-0014
 * amendment 16).
 *
 * @example
 * const bend = { name: 'bend', seconds: 0.4, motion: { lean: 0.6 }, events: [{ type: 'lowest', at: 1 }] };
 * defineAction('action:nod-twice', { desc: 'Two nods.', beats: [bend, { name: 'rise', seconds: 0.3 }] });
 * getAction('nod-twice').beats.length; // 2
 * @see engine/anim/actions.test.ts
 */
import { codeError, didYouMean } from '../core/log';
import { registry as sharedRegistry, sameValue, type Entry, type Registry } from '../core/registry';
import { isPlainObject, validate } from '../core/schema';
import { REFERENCE_ARM } from './moves-data';
import { MASKS } from './skeleton';
import { BODY_STATES } from './states';

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
    description:
      "A multi-beat sequence played on a body: beats of body states, clips, IK targets, flips and events. The engine's set is data/anim/actions/, one file each (loadActions).",
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
