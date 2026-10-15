/**
 * @file The box's sound events (PLAN.md §9.0, WP 9.5, I-23): which effect (labs/box/sounds/effects.ts) each of the
 * box's sim events plays, how loud and where. The sound comes from the sim's events, never from the page's state, so
 * a run's sound timeline is a pure function of the run: a replay gives the same timeline in Node and in Chromium
 * (tests/e2e/box-audio.spec.ts), and the page plays exactly that (labs/box/sounds/page.ts).
 *
 * - `footstep` (an animator's foot landing, engine/sim/actors.ts): the effect `BOX_FOOTSTEPS` maps the surface tag
 *   under the actor's feet to (engine/world/level `surfaceAt`), louder the faster it moves;
 * - `land`: `sfx:boxThud` under the actor, louder the harder it came down; `jump` and `dash`: the engine's
 *   `sfx:whoosh` under it;
 * - the fight's (labs/box/scenes/fight-rules.ts): `hit`, `sfx:boxHit`, louder the bigger the blow, at most 0.5 (after
 *   G9: a sweep's four hits and a death at once, box-5-fight at 9.3 s, peaked at 1.54 in `x audio --replay`'s
 *   unspatialized mix and now at 0.80, −2 dBFS); `shot`, a bolt launched, `sfx:boxLaunch`; `slam`, a pounce landing,
 *   `sfx:boxThud`; `slain`, `sfx:boxDeath`, which ducks the music and ambience while it plays;
 * - every other event (`damage`, `lap`…) plays nothing.
 *
 * `createSoundReader().read(world, level)` maps the events a world has delivered since the last read, in order, each
 * once by its `seq`: called after every step it gives a run's timeline, each event at its step; called once a frame,
 * each event at the frame's last step. A new world (a restart, a replay) is read from its first event.
 * `timelineHash` hashes a timeline (FNV-1a, 64 bits, over its JSON), the one number Node and the browser compare.
 * `boxSounds(level)` is the same map as a scene's `sounds` hook (engine/sim/scene.ts), so `x audio --replay` mixes in
 * Node what the page plays (after G9, ADR-0013 amendment 3): sim-side, it imports only engine/sim-api.ts.
 *
 * Invariants: pure reads: the world and its events are never changed, and nothing here plays a sound. Positions are
 * world space, metres, as the sim gives them, so the same run gives the same bits everywhere. An actor's events
 * sound at its feet; one it no longer has sounds unplaced.
 *
 * @example
 * const reader = createSoundReader();
 * // after each step of a run: reader.read(session.world, HALL_LEVEL) → [{ step: 52, type: 'hit', sfx: 'sfx:boxHit', … }]
 * timelineHash([]); // '09612b07b5ecb5a5': the JSON '[]' hashed
 * @see labs/box/sounds/events.test.ts
 */
import { surfaceAt, type CompiledLevel, type SceneSound, type TraceRecord } from '../../../engine/sim-api';

/** A point in the world, metres. */
export type Point = readonly [number, number, number];

/** One sound the box plays for a sim event. Plain data. */
export interface BoxSoundEvent {
  /** The step it was read at (see the file comment). */
  readonly step: number;
  /** The sim event it comes from. */
  readonly type: string;
  /** The effect it plays. */
  readonly sfx: string;
  /** Its gain, 0 to 1. */
  readonly vol: number;
  /** Where it sounds, or null: unplaced, in the listener's head. */
  readonly position: Point | null;
  /** Whether it ducks the music and ambience while it plays. */
  readonly duck: boolean;
}

/** Footsteps by surface tag (the level legend's `surface`): the effect a step on it plays; `'*'` any other. */
export const BOX_FOOTSTEPS: Readonly<Record<string, string>> = Object.freeze({
  stone: 'sfx:boxStep',
  iron: 'sfx:boxStepIron',
  '*': 'sfx:boxStep',
});

/** What the reader reads of a world: its step, its event trace and its entities. */
export interface SoundWorld {
  readonly tick: number;
  readonly events: { trace(): readonly TraceRecord[] };
  get(id: number): unknown;
}

/** An event's payload as the mapping reads it (every field optional). */
type Payload = { id?: number; speed?: number; size?: number; position?: Point };
/** A sound without its step and type, or null for none. */
type Sound = Omit<BoxSoundEvent, 'step' | 'type'>;

/** `value` held to [low, high]. */
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Where an actor's feet are (its `actor` component), or null once it has none. */
function feetOf(world: SoundWorld, id: number | undefined): Point | null {
  const actor =
    id === undefined ? undefined : (world.get(id) as { actor?: { x: number; y: number; z: number } })?.actor;
  return actor ? [actor.x, actor.y, actor.z] : null;
}

/** The effect a footstep plays at `at` on `level`: its surface's (`BOX_FOOTSTEPS`), the `'*'` one off any level. */
export function footstepSfx(level: CompiledLevel | null, at: Point | null): string {
  const surface = level && at ? surfaceAt(level, at[0], at[2]) : '';
  return BOX_FOOTSTEPS[surface] ?? BOX_FOOTSTEPS['*'];
}

/** A sound of `sfx` at gain `vol`, placed at `position` (unplaced without one). */
const sound = (sfx: string, vol: number, position: Point | null | undefined, duck = false): Sound => ({
  sfx,
  vol,
  position: position ?? null,
  duck,
});

/** The sound for each event type that has one (see the file comment). */
const SOUNDS: Readonly<Record<string, (p: Payload, world: SoundWorld, level: CompiledLevel | null) => Sound>> = {
  footstep: (p, world, level) => {
    const feet = feetOf(world, p.id);
    return sound(footstepSfx(level, feet), clamp(0.4 + 0.5 * (p.speed ?? 1), 0.4, 1), feet);
  },
  land: (p, world) => sound('sfx:boxThud', clamp((p.speed ?? 0) / 8, 0.3, 1), feetOf(world, p.id)),
  jump: (p, world) => sound('sfx:whoosh', 0.5, feetOf(world, p.id)),
  dash: (p, world) => sound('sfx:whoosh', 0.9, feetOf(world, p.id)),
  hit: (p) => sound('sfx:boxHit', clamp(0.15 + 0.3 * (p.size ?? 1), 0.15, 0.5), p.position),
  shot: (p) => sound('sfx:boxLaunch', clamp(0.8 * (p.size ?? 1), 0.3, 1), p.position),
  slam: (p) => sound('sfx:boxThud', 0.8, p.position),
  slain: (p) => sound('sfx:boxDeath', 1, p.position, true),
};

/** The event types that play a sound, in the order the file comment gives them. */
export const SOUND_EVENTS: readonly string[] = Object.keys(SOUNDS);

/** The sound one traced event plays in `world` on `level` (read at `world.tick`), or null when it plays none. */
export function soundOf(record: TraceRecord, world: SoundWorld, level: CompiledLevel | null): BoxSoundEvent | null {
  const map = Object.hasOwn(SOUNDS, record.type) ? SOUNDS[record.type] : undefined;
  const payload = record.payload;
  const made = map && typeof payload === 'object' && payload !== null ? map(payload as Payload, world, level) : null;
  return made && { step: world.tick, type: record.type, ...made };
}

/** A scene's `sounds` hook for the box's scenes on `level`: each event's effect and gain, as the page plays them. */
export function boxSounds(level: CompiledLevel | null): (record: TraceRecord, world: SoundWorld) => SceneSound | null {
  return (record, world) => {
    const made = soundOf(record, world, level);
    return made && { sfx: made.sfx, vol: made.vol };
  };
}

/** Reads a world's new events as sounds (see the file comment). */
export interface SoundReader {
  /** The sounds of the events `world` delivered since the last read, in order. */
  read(world: SoundWorld, level: CompiledLevel | null): BoxSoundEvent[];
  /** Events that left the world's trace (its latest 256) before they were read: 0 when every one was heard. */
  readonly missed: number;
}

/** A reader that reads each event of a world once (see the file comment). */
export function createSoundReader(): SoundReader {
  let [read, seen, missed]: [SoundWorld | null, number, number] = [null, 0, 0];
  return {
    get missed() {
      return missed;
    },
    read(world, level) {
      if (world !== read) [read, seen] = [world, 0];
      const records = world.events.trace();
      const fresh = records.filter((record) => record.seq > seen);
      if (fresh.length && fresh[0].seq > seen + 1) missed += fresh[0].seq - seen - 1;
      seen = records.at(-1)?.seq ?? seen;
      return fresh.map((record) => soundOf(record, world, level)).filter((sound) => sound !== null);
    },
  };
}

const FNV_PRIME = 0x100000001b3n;
const MASK = (1n << 64n) - 1n;

/** A timeline's hash: FNV-1a, 64 bits, over its JSON's UTF-16 code units, as 16 hex digits. */
export function timelineHash(events: readonly BoxSoundEvent[]): string {
  const text = JSON.stringify(events);
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) hash = ((hash ^ BigInt(text.charCodeAt(i))) * FNV_PRIME) & MASK;
  return hash.toString(16).padStart(16, '0');
}
