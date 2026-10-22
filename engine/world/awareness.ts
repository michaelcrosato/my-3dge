/**
 * @file Awareness (PLAN.md WP 10.4; doctrine: Reproducible): what an agent knows of its target beyond WP 5.2's sight
 * (engine/world/ai.ts `canSee`), as the neighbours of games' open worlds know the player: whether it sees him now (the
 * caller's test: `canSee` over a level's grid, or a ray through the physics world on a site), the noises it hears
 * (`Noise`: a shot, a kick, a door slammed, each heard within its `loudness` metres times the agent's `hearing`, half
 * as far with a wall between when the caller says so), and where it last saw or heard him, which it remembers for
 * `memory` seconds. An agent's awareness is plain data in a component (`AWARENESS_FIELDS`); `sense` moves it on by a
 * step and says what it knows (`AwarenessState`):
 * - `sees`: he is in sight, where it knows him to be (`x`, `y`, `z`);
 * - `heard`: a noise reached it this step (startle, turn to it), the loudest for its distance; `x`, `y`, `z` its place;
 * - `remembers`: neither, but it saw or heard within `memory` seconds: where to look;
 * - `unaware`: nothing yet, or forgotten.
 * `sense` also says whether this step woke it (`alerted`: it knew nothing a step ago), for a startle or a turn of the
 * head.
 *
 * Invariants: pure: `sense` reads only its input and the component, and writes only the component; noises are weighed
 * in their order, the first of equals winning; times are the sim's (`w.time`). `Math.hypot` by name. Problems raise
 * `CORE_BAD_SPEC`.
 *
 * Carried as a concept from my-3d2dge's monsters' `aware` (`src/emberdeep/30-monsters-core.js:145-163`: aware within
 * a range, or closer, or in a clear line; WP 5.2's `canSee`), with hearing and a memory of the last place as stealth
 * games keep them.
 *
 * @example
 * const aware = { ...AWARENESS, memory: 5 };
 * const ears = { x: 0, y: 1.6, z: 0 };
 * sense(aware, { time: 1, ears, sees: true, target: { x: 4, y: 0, z: 3 } }); // { state: 'sees', alerted: true }
 * sense(aware, { time: 2, ears, sees: false }).state; // 'remembers': he was at (4, 0, 3)
 * sense(aware, { time: 9, ears, sees: false }).state; // 'unaware': forgotten after 5 s
 * const shot = { x: 10, y: 1, z: 0, loudness: 30, source: 3, kind: 'shot' };
 * sense(aware, { time: 10, ears, sees: false, noises: [shot] }); // { state: 'heard', alerted: true }: 10 m off
 * @see engine/world/awareness.test.ts
 */
import { codeError } from '../core/log';
import { copyValue, defineSchema, freezeValue } from '../core/schema';
import type { SteerPoint } from './steer';

/** What an agent knows (see the file comment). */
export const AWARENESS_STATES = ['unaware', 'sees', 'heard', 'remembers'] as const;
/** One of `AWARENESS_STATES`. */
export type AwarenessState = (typeof AWARENESS_STATES)[number];

/** An agent's awareness fields, for a scene's component: `defineComponent('aware', { description, fields: … })`. */
export const AWARENESS_FIELDS = defineSchema({
  state: { type: 'string', enum: [...AWARENESS_STATES], default: 'unaware', description: 'What it knows: unaware, sees, heard or remembers.' }, // prettier-ignore
  x: { type: 'number', default: 0, unit: 'm', description: 'Where it last saw him or heard a noise, east.' },
  y: { type: 'number', default: 0, unit: 'm', description: 'Where it last saw him or heard a noise, up.' },
  z: { type: 'number', default: 0, unit: 'm', description: 'Where it last saw him or heard a noise, south.' },
  at: { type: 'number', default: -1, unit: 's', description: 'When it last saw him or heard a noise (−1: never).' },
  seen: { type: 'number', default: -1, unit: 's', description: 'When it last saw him (−1: never).' },
  heard: { type: 'number', default: -1, unit: 's', description: 'When it last heard a noise (−1: never).' },
  source: { type: 'integer', default: -1, minimum: -1, description: 'Who made the last noise it heard (−1: none).' },
  memory: { type: 'number', default: 10, minimum: 0, unit: 's', description: 'How long it remembers where he was.' },
  hearing: { type: 'number', default: 1, minimum: 0, description: 'How far it hears, as a share of a noise’s loudness (0: deaf).' }, // prettier-ignore
});

/** An agent's awareness (`AWARENESS_FIELDS` says what each field means). */
export interface Awareness {
  state: AwarenessState;
  x: number;
  y: number;
  z: number;
  at: number;
  seen: number;
  heard: number;
  source: number;
  memory: number;
  hearing: number;
}

/** An agent with every field at its default: unaware, remembering 10 s, hearing noises as loud as they are. */
export const AWARENESS: Readonly<Awareness> = freezeValue(
  Object.fromEntries(Object.entries(AWARENESS_FIELDS).map(([key, field]) => [key, copyValue(field.default)])) as unknown as Awareness, // prettier-ignore
);

/** A noise a step made: where, how far it carries (m), who made it (−1: nobody) and what it was (a shot, a kick). */
export interface Noise {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly loudness: number;
  readonly source: number;
  readonly kind: string;
}

/** What `sense` reads in a step: the time, the agent's ears, whether it sees its target and where, the noises. */
export interface SenseInput {
  /** The sim's time (s): `w.time`. */
  readonly time: number;
  /** Where the agent hears from (m): its head. */
  readonly ears: SteerPoint;
  /** Whether it sees its target now: the caller's sight test (engine/world/ai.ts `canSee`, or a ray on a site). */
  readonly sees: boolean;
  /** Where its target is (m), read when it sees him. */
  readonly target?: SteerPoint | null;
  /** The noises made this step (a shot's, a kick's), in the order made. */
  readonly noises?: readonly Noise[];
  /** Whether nothing stands between two points (a wall halves how far a noise carries); open air without it. */
  readonly clear?: (from: SteerPoint, to: SteerPoint) => boolean;
}

/** What `sense` found: what the agent knows now, and whether this step woke it (it knew nothing a step ago). */
export interface Sensed {
  readonly state: AwarenessState;
  readonly alerted: boolean;
}

/** How far `noise` carries to `ears` for an agent of `hearing` (m): its loudness, half through a wall. */
export function earshot(noise: Noise, ears: SteerPoint, hearing = 1, clear?: SenseInput['clear']): number {
  const walled = clear !== undefined && !clear(noise, ears);
  return noise.loudness * hearing * (walled ? 0.5 : 1);
}

/** Whether an agent at `ears` of `hearing` hears `noise` (see `earshot`). */
export function hears(noise: Noise, ears: SteerPoint, hearing = 1, clear?: SenseInput['clear']): boolean {
  return Math.hypot(noise.x - ears.x, noise.y - ears.y, noise.z - ears.z) <= earshot(noise, ears, hearing, clear);
}

/** Throws `CORE_BAD_SPEC` naming the first non-finite number of `input`. */
function check(input: SenseInput): void {
  const points: [string, SteerPoint | null | undefined][] = [['ears', input.ears], ['target', input.sees ? input.target : null]]; // prettier-ignore
  const bad = [['time', input.time] as const, ...points.flatMap(([name, p]) => (p ? [[`${name}.x`, p.x], [`${name}.y`, p.y], [`${name}.z`, p.z]] as const : []))].find(([, v]) => !Number.isFinite(v)); // prettier-ignore
  if (bad) throw codeError('CORE_BAD_SPEC', { where: `sense(aware, { ${bad[0]} })`, problems: `${String(bad[1])}: give finite seconds and metres` }); // prettier-ignore
  if (input.sees && !input.target) throw codeError('CORE_BAD_SPEC', { where: 'sense(aware, { sees: true })', problems: 'no target: give where he is when it sees him' }); // prettier-ignore
}

/**
 * Moves `aware` on by a step (see the file comment): sight first (it knows where he is), then the step's noises (the
 * nearest for its earshot wins), then its memory; returns what it knows now and whether this step woke it.
 */
export function sense(aware: Awareness, input: SenseInput): Sensed {
  check(input);
  const before = aware.state;
  const { time, ears } = input;
  let heard: Noise | null = null;
  let best = Infinity;
  for (const noise of input.noises ?? []) {
    const reach = earshot(noise, ears, aware.hearing, input.clear);
    const share = reach > 0 ? Math.hypot(noise.x - ears.x, noise.y - ears.y, noise.z - ears.z) / reach : Infinity;
    if (share <= 1 && share < best) [heard, best] = [noise, share];
  }
  if (heard) [aware.heard, aware.source] = [time, heard.source];
  if (input.sees) {
    const { x, y, z } = input.target!;
    Object.assign(aware, { state: 'sees', x, y, z, at: time, seen: time });
  } else if (heard) Object.assign(aware, { state: 'heard', x: heard.x, y: heard.y, z: heard.z, at: time });
  else aware.state = aware.at >= 0 && time - aware.at <= aware.memory ? 'remembers' : 'unaware';
  return { state: aware.state, alerted: before === 'unaware' && aware.state !== 'unaware' };
}
