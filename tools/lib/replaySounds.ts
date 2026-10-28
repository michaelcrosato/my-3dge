/**
 * @file A replay's sound events, read and mixed in Node (PLAN.md §8.1, WP 9.4, I-23), for `node x audio --replay`
 * (tools/cmd/audio.ts): `replaySoundEvents` plays a replay step by step through the page's playback, against its
 * goldens, and reads the sounds its scene's `sounds` gives each traced sim event (`{ sfx, vol?, variant? }` or a list:
 * engine/sim/scene.ts), after setup and after each step, as the page reads them, so an event read at step k plays at
 * k / hz seconds; `mixSoundEvents` renders their effects and sums them into one mono mix, unspatialized. Split from
 * tools/cmd/audio.ts at its line cap.
 *
 * Invariants: an event naming no sfx entry, a bad gain or variant is a problem, never a sound; without `variant` an
 * effect plays its variants in turn; each effect is rendered once per variant (seed 0, 44,100 Hz).
 *
 * @example
 * mixSoundEvents([], 0.5).mix.length; // 22050: half a second of silence
 * @see tools/cmd/audio.test.ts
 */
import { createPlayback } from '../../engine/app/playback';
import { getSfx, renderSfx, sfxKind } from '../../engine/audio/data/sfx';
import { DEFAULT_RATE } from '../../engine/audio/dsp/render';
import type { TraceRecord } from '../../engine/core/events';
import { registry as sharedRegistry, type Registry } from '../../engine/core/registry';
import { show } from '../../engine/core/schema';
import { checkpointsOf, playReplay, type Replay } from '../../engine/sim/replay';
import { getScene } from '../../engine/sim/scene';
import type { World } from '../../engine/sim/world';
import { closest } from '../x';

/** One sound event of a replay: when, from which sim event, which effect at which gain and variant. */
export interface SoundEvent {
  step: number;
  /** Seconds: step / hz. */
  time: number;
  /** The sim event's type. */
  type: string;
  sfx: string;
  vol: number;
  variant: number;
}

/** A replay's sound events, the problems of those that name no sound, its length and the hashes of its checkpoints. */
export interface SoundTimeline {
  events: SoundEvent[];
  /** The run's length in seconds: its steps / hz. */
  seconds: number;
  problems: string[];
  hashes: Record<string, string>;
}

/** A sound a scene's `sounds` gives a traced sim event (by default its payload's sfx, engine/sim/scene.ts), unchecked. */
type Made = { sfx: unknown; vol?: unknown; variant?: unknown };

/**
 * One sound a scene's `sounds` gave a traced sim event as a sound event, its variant the one given or the effect's
 * next in turn (`turns`); or the problem with it.
 */
function soundEventOf(
  { sfx, vol = 1, variant }: Made,
  record: TraceRecord,
  world: World,
  registry: Registry,
  turns: Map<string, number>,
): SoundEvent | string {
  const where = `step ${world.tick}, event ${record.type}`;
  if (typeof sfx !== 'string' || !registry.has('sfx', sfx)) {
    const near = closest(
      String(sfx),
      registry.list('sfx').map((entry) => entry.id),
    );
    return `${where}: ${show(sfx)} is not an sfx entry${near ? `: did you mean ${near}?` : ''}`;
  }
  if (typeof vol !== 'number' || !(vol >= 0 && vol < Infinity))
    return `${where}: vol ${show(vol)} must be a gain, 0 or more`;
  const variants = getSfx(sfx, registry).variants;
  if (variant !== undefined && ![...Array(variants).keys()].includes(variant as number)) {
    return `${where}: variant ${show(variant)} of ${sfx} must be a whole number from 0 to ${variants - 1}`;
  }
  const turn = turns.get(sfx) ?? 0;
  turns.set(sfx, turn + 1);
  const chosen = (variant as number | undefined) ?? turn % variants;
  return { step: world.tick, time: world.tick / world.hz, type: record.type, sfx, vol, variant: chosen };
}

/**
 * Plays `replay` (its scene defined on `registry`) step by step through `createPlayback` (engine/app/playback.ts, the
 * page's real-time playback), hashing its checkpoints, and reads the sound events from the sim's event trace after
 * setup and after each step, as the box's page does (labs/box/sounds/events.ts).
 */
export function replaySoundEvents(replay: Replay, registry: Registry = sharedRegistry): SoundTimeline {
  sfxKind(registry);
  const playback = createPlayback(replay);
  const { session } = playReplay(replay, { registry, until: 0, checkpoints: [] }); // its checks, its setup
  const [world, scene] = [session.world, getScene(replay.scene, registry)];
  const marks = new Set(checkpointsOf(replay));
  const hashes: Record<string, string> = {};
  const problems: string[] = [];
  const events: SoundEvent[] = [];
  const turns = new Map<string, number>();
  let seen = 0;
  const read = () => {
    const trace = world.events.trace();
    if (trace.length && trace[0].seq > seen + 1) {
      problems.push(`step ${world.tick}: ${trace[0].seq - seen - 1} events left the trace (256) before they were read`);
    }
    for (const record of trace.filter((item) => item.seq > seen)) {
      const made = (scene.sounds(record, world) as Made | readonly Made[] | null) ?? []; // one sound, a list or none
      for (const event of [made].flat().map((one) => soundEventOf(one, record, world, registry, turns))) {
        if (typeof event === 'string') problems.push(event);
        else events.push(event);
      }
    }
    seen = trace.at(-1)?.seq ?? seen;
  };
  read();
  for (;;) {
    if (marks.has(world.tick)) hashes[world.tick] = world.hash();
    if (playback.done) break;
    playback.step(session);
    read();
  }
  return { events, problems, hashes, seconds: replay.steps / world.hz };
}

/**
 * The events' effects rendered (each once per variant, seed 0, at 44,100 Hz) and summed into one mono mix at least
 * `seconds` long, with each event's span in it, `[start, end)` in samples.
 */
export function mixSoundEvents(events: readonly SoundEvent[], seconds: number, registry = sharedRegistry) {
  const [rate, rendered] = [DEFAULT_RATE, new Map<string, Float32Array>()];
  const sound = ({ sfx, variant }: SoundEvent) => {
    const key = `${sfx}#${variant}`;
    if (!rendered.has(key)) rendered.set(key, renderSfx(sfx, { variant, registry }));
    return rendered.get(key) as Float32Array;
  };
  const spans = events.map((event): [number, number] => {
    const start = Math.round(event.time * rate);
    return [start, start + sound(event).length];
  });
  const mix = new Float64Array(spans.reduce((n, [, end]) => Math.max(n, end), Math.round(seconds * rate)));
  events.forEach((event, e) => {
    const samples = sound(event);
    for (let i = 0; i < samples.length; i++) mix[spans[e][0] + i] += event.vol * samples[i];
  });
  return { mix: Float32Array.from(mix), spans };
}
