/**
 * @file Renders a sound in Node and prints its numbers, or mixes a replay's sound events (PLAN.md §8.1, WP 9.4, I-23).
 * Usage: node x audio <id> [--variant n] [--seed s] [--intensity i] [--wav] [--spectrogram] | node x audio --replay
 * <file> [--wav] [--spectrogram]. Exit 0 when the sound or mix passes, 1 when it fails, 2 on a usage error (an unknown
 * id, a bad variant, a missing replay), naming the closest.
 *
 * `<id>` is an `sfx` or `song` entry (the engine's, or a game's from `labs/<name>/sounds/`), rendered as the DSP does
 * (engine/audio/data). It prints the audio QA family's metrics (tools/qa/audio.ts): duration, peak, RMS, DC offset,
 * clicks, leading silence, spectral centroid, and the hash; it fails when the QA would report the render and its
 * baseline does not accept it. `--wav` writes `sound.wav` (16-bit mono PCM); `--spectrogram` writes `spectrogram.png`,
 * 512 × 256: time left to right with a line every 0.1 s (1 s past 2 s, 10 s past 20 s), log frequency bottom to top
 * from 20 Hz to Nyquist with lines at 100 Hz, 1 kHz and 10 kHz, level from black (−96 dBFS) through blue, magenta and
 * orange to pale yellow (0 dBFS). Files go in `out/audio/<id>/`, beside the report.
 *
 * `--replay` plays a replay (engine/sim/replay.ts) in Node, step by step, against its goldens, and reads its sound
 * events: the sound its scene's `sounds` gives each traced sim event, `{ sfx, vol?, variant? }` (engine/sim/scene.ts:
 * by default the event payload's own `sfx`; the box maps its events as its page does, labs/box/sounds/events.ts). `vol`
 * is a gain, 1 by default; without `variant` an effect plays its variants in turn. The events are read after setup
 * and after each step, as the page reads them, so an event read at step k plays at k / hz seconds. It mixes them offline into one mono mix, unspatialized (every source at
 * the listener: the loudest the mix can be), and fails when the mix clips, naming the sounds playing at its peak, when
 * an event names no sfx entry, or when the run parts from its goldens. After shardfall's offline audio capture
 * (`crates/pav_tools/src/tools.rs:1270-1309`, §5.8).
 *
 * @example
 * encodeWav(new Float32Array([0, 0.5]), 44100).length; // 48: the header and two samples
 * @see tools/cmd/audio.test.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPlayback } from '../../engine/app/playback';
import { getSfx, renderSfx, sfxKind } from '../../engine/audio/data/sfx';
import { renderSong } from '../../engine/audio/data/song';
import { DEFAULT_RATE, soundHash } from '../../engine/audio/dsp/render';
import type { TraceRecord } from '../../engine/core/events';
import { hashValue, type Canonical } from '../../engine/core/hash';
import { EngineError } from '../../engine/core/log';
import { registry as sharedRegistry, type Registry } from '../../engine/core/registry';
import { show } from '../../engine/core/schema';
import { checkpointsOf, checkReplay, judgeRuns, playReplay, type Replay } from '../../engine/sim/replay';
import { getScene, type Scene } from '../../engine/sim/scene';
import type { World } from '../../engine/sim/world';
import { targetSlug, type Artifact, type Finding } from '../lib/report';
import { dbfs, frameSpectrum, loadSoundModules, soundMetrics, soundProblems, type SoundMetrics } from '../qa/audio';
import { compareWithBaselines, readBaselines } from './qa';
import { wholeFlag } from './sim';
import { resolveSceneModule } from '../lib/scenes';
import { closest, UsageError, type Command, type CommandResult } from '../x';

/** A command's flag values. */
type Values = Record<string, unknown>;

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

/** Encodes samples as a 16-bit mono PCM WAV file, clamped to ±1. */
export function encodeWav(samples: ArrayLike<number>, rate: number): Buffer {
  const out = Buffer.alloc(44 + samples.length * 2);
  out.write('RIFF', 0, 'latin1');
  out.writeUInt32LE(36 + samples.length * 2, 4);
  out.write('WAVEfmt ', 8, 'latin1');
  out.writeUInt32LE(16, 16); // the format chunk's size
  out.writeUInt16LE(1, 20); // PCM
  out.writeUInt16LE(1, 22); // one channel
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28); // bytes per second
  out.writeUInt16LE(2, 32); // bytes per frame
  out.writeUInt16LE(16, 34); // bits per sample
  out.write('data', 36, 'latin1');
  out.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + 2 * i);
  }
  return out;
}

/** The spectrogram's size, FFT length, floor (dBFS) and lowest frequency (Hz). */
export const SPECTROGRAM = { width: 512, height: 256, size: 2048, floor: -96, low: 20 } as const;

/** The colour ramp from the floor to full scale: black, blue, magenta, orange, pale yellow. */
// prettier-ignore
const RAMP = [[0, 0, 0], [40, 10, 110], [190, 40, 120], [250, 140, 30], [252, 250, 190]];

/** A picture as RGBA bytes, row by row from the top. */
export type Picture = { width: number; height: number; rgba: Uint8Array };

/** A spectrogram of `samples` as RGBA bytes (see the file comment for its axes and colours). */
export function spectrogram(samples: ArrayLike<number>, rate: number): Picture {
  const { width, height, size, floor, low } = SPECTROGRAM;
  const rgba = new Uint8Array(width * height * 4);
  const span = Math.log(rate / 2 / low);
  const binOf = (y: number) => (low * Math.exp(span * (1 - y / height)) * size) / rate; // y: a row's top edge
  for (let x = 0; x < width; x++) {
    const spectrum = frameSpectrum(samples, ((x + 0.5) * samples.length) / width, size);
    for (let y = 0; y < height; y++) {
      const [from, to] = [Math.round(binOf(y + 1)), Math.round(binOf(y))];
      let level = 0;
      for (let k = from; k <= Math.min(Math.max(from, to), size / 2); k++) level = Math.max(level, spectrum[k]);
      const t = Math.max(0, Math.min(1, (20 * Math.log10(level + 1e-12) - floor) / -floor)) * (RAMP.length - 1);
      const k = Math.min(RAMP.length - 2, Math.floor(t));
      for (let c = 0; c < 3; c++)
        rgba[(y * width + x) * 4 + c] = Math.round(RAMP[k][c] + (RAMP[k + 1][c] - RAMP[k][c]) * (t - k));
      rgba[(y * width + x) * 4 + 3] = 255;
    }
  }
  const lighten = (x: number, y: number) => {
    for (let c = 0; c < 3; c++) rgba[(y * width + x) * 4 + c] = Math.max(80, rgba[(y * width + x) * 4 + c]);
  };
  for (const hz of [100, 1000, 10000]) {
    const y = Math.round(height * (1 - Math.log(hz / low) / span));
    if (y >= 0 && y < height) for (let x = 0; x < width; x++) lighten(x, y);
  }
  const seconds = samples.length / rate;
  const tick = seconds <= 2 ? 0.1 : seconds <= 20 ? 1 : 10;
  for (let i = 1; i * tick < seconds; i++) {
    const x = Math.round(((i * tick) / seconds) * width);
    if (x < width) for (let y = 0; y < height; y++) lighten(x, y);
  }
  return { width, height, rgba };
}

/**
 * The sound event a traced sim event makes when its scene's `sounds` gives it one (by default its payload's sfx, engine/
 * sim/scene.ts), its variant the one given or the effect's next in turn (`turns`); or the problem with it.
 */
function soundEventOf(
  record: TraceRecord,
  world: World,
  scene: Scene,
  registry: Registry,
  turns: Map<string, number>,
): SoundEvent | string | undefined {
  const made = scene.sounds(record, world) as { sfx: unknown; vol?: unknown; variant?: unknown } | null;
  if (!made) return undefined;
  const { sfx, vol = 1, variant } = made;
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
      const event = soundEventOf(record, world, scene, registry, turns);
      if (typeof event === 'string') problems.push(event);
      else if (event) events.push(event);
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

/** Writes the WAV and spectrogram asked for into `out/audio/<slug>/`, returning them as artifacts. */
async function writeFiles(root: string, slug: string, samples: Float32Array, what: string, values: Values) {
  const artifacts: Artifact[] = [];
  const dir = join('out', 'audio', slug);
  if (values.wav || values.spectrogram) mkdirSync(join(root, dir), { recursive: true });
  if (values.wav) {
    writeFileSync(join(root, dir, 'sound.wav'), encodeWav(samples, DEFAULT_RATE));
    artifacts.push({ path: `${dir}/sound.wav`, kind: 'audio', describes: `${what}, 16-bit mono PCM at 44,100 Hz` });
  }
  if (values.spectrogram) {
    const { encodePng } = await import('./shot');
    const { width, height, rgba } = spectrogram(samples, DEFAULT_RATE);
    writeFileSync(join(root, dir, 'spectrogram.png'), encodePng(width, height, rgba));
    const describes = `the spectrogram of ${what}: time left to right, log frequency 20 Hz–22 kHz bottom to top (lines at 100 Hz, 1 kHz, 10 kHz), level black (−96 dBFS) to pale yellow (0 dBFS)`;
    artifacts.push({ path: `${dir}/spectrogram.png`, kind: 'image', describes });
  }
  return artifacts;
}

/** A render's metrics for the report, to 6 decimals. */
const reportMetrics = (m: SoundMetrics) => ({
  seconds: m.seconds,
  peak: round(m.peak),
  peakAt: round(m.peakAt),
  clipped: m.clipped,
  rms: round(m.rms),
  dc: round(m.dc),
  clicks: m.clicks.length,
  lead: round(m.lead),
  centroid: Math.round(m.centroid),
});

/** `x audio <id>`: one sound's metrics, judged as the audio QA family judges it. */
async function runSound(root: string, id: string, values: Values): Promise<CommandResult> {
  const kind = ['sfx', 'song'].find((name) => sharedRegistry.has(name, id));
  if (!kind) {
    const ids = [...sharedRegistry.list('sfx'), ...sharedRegistry.list('song')].map((entry) => entry.id);
    const near = closest(id, ids);
    throw new UsageError(
      `there is no sfx or song "${id}"${near ? `: did you mean ${near}?` : ''} (x describe sfx, x describe song)`,
    );
  }
  const other = kind === 'sfx' ? 'intensity' : 'variant';
  if (values[other] !== undefined) throw new UsageError(`--${other} is not for ${kind} entries such as ${id}`);
  const seed = wholeFlag(values.seed, 'seed', 0);
  const variant = wholeFlag(values.variant, 'variant', 0);
  const intensity = values.intensity === undefined ? 1 : Number(values.intensity);
  if (!(intensity >= 0 && intensity <= 1))
    throw new UsageError(`--intensity takes a number from 0 to 1, not ${String(values.intensity)}`);
  let samples: Float32Array;
  try {
    samples = kind === 'sfx' ? renderSfx(id, { variant, seed }) : renderSong(id, { seed, intensity });
  } catch (error) {
    if (error instanceof EngineError) throw new UsageError(error.message);
    throw error;
  }
  const what = kind === 'sfx' ? `${id} variant ${variant}` : `${id} at intensity ${intensity}`;
  const m = soundMetrics(samples, DEFAULT_RATE);
  const violations = soundProblems(kind, m).map((problem) => ({ id, ...problem }));
  const { failures } = compareWithBaselines('audio', violations, readBaselines(root, 'audio').entries);
  const hash = soundHash(samples);
  const label = `${what}${seed ? ` from seed ${seed}` : ''}`;
  const artifacts = await writeFiles(root, targetSlug(id), samples, label, values);
  return {
    ok: failures.length === 0,
    target: id,
    summary: `${what}: ${m.seconds.toFixed(3)} s, peak ${m.peak.toFixed(3)} (${dbfs(m.peak)}), ${failures.length ? `${failures.length} problem(s) the audio QA reports` : 'within the audio QA limits'}`,
    lines: [
      `rms ${m.rms.toFixed(3)}, dc ${m.dc.toFixed(5)}, clicks ${m.clicks.length}, leading silence ${(m.lead * 1000).toFixed(1)} ms, centroid ${Math.round(m.centroid)} Hz`,
      `hash ${hash} (seed ${seed}, 44,100 Hz)`,
      ...artifacts.map((artifact) => `wrote ${artifact.path}`),
    ],
    failures,
    metrics: { ...reportMetrics(m), samples: samples.length, hash },
    artifacts,
  };
}

/** `value` to 6 decimals, for the report. */
const round = (value: number) => Math.round(value * 1e6) / 1e6;

/** `x audio --replay <file>`: the replay's sound events mixed and judged for clipping. */
async function runReplay(root: string, file: string, values: Values): Promise<CommandResult> {
  const path = resolve(root, file);
  if (!existsSync(path)) throw new UsageError(`there is no replay ${file} (tests/replays/ holds them)`);
  const name = relative(root, path);
  let replay: Replay;
  try {
    replay = checkReplay(JSON.parse(readFileSync(path, 'utf8')), name);
  } catch (error) {
    if (error instanceof EngineError || error instanceof SyntaxError) throw new UsageError(error.message);
    throw error;
  }
  await import(pathToFileURL(join(root, resolveSceneModule(root, replay.scene))).href);
  await loadSoundModules(root);
  const { events, problems, hashes, seconds } = replaySoundEvents(replay);
  const { mix, spans } = mixSoundEvents(events, seconds);
  const m = soundMetrics(mix, DEFAULT_RATE);
  const failures: Finding[] = problems.map((message) => ({ id: 'AUDIO_BAD_SOUND_EVENT', message, file: name }));
  if (m.peak > 1) {
    const at = Math.round(m.peakAt * DEFAULT_RATE);
    const named = tally(events.filter((_, e) => spans[e][0] <= at && at < spans[e][1]).map((event) => event.sfx));
    failures.push({
      id: 'AUDIO_MIX_CLIPS',
      message: `the mix clips: peak ${m.peak.toFixed(3)} (${dbfs(m.peak)}) at ${m.peakAt.toFixed(3)} s, ${m.clipped} samples beyond ±1, where ${named} play together: lower their events' vol or the effects' voices, or space them out`,
      file: name,
    });
  }
  const platform = `${process.platform}-${process.arch}`;
  const verdict = judgeRuns(replay, [hashes], platform);
  if (verdict.golden === 'mismatch') {
    failures.push({
      id: 'AUDIO_REPLAY_PARTED',
      message: `the run parted from its goldens by step ${verdict.step}: its sound events are not the recorded run's (node x replay ${name} --bisect)`,
      file: name,
    });
  }
  const timeline = hashValue(events as unknown as Canonical);
  const artifacts = await writeFiles(root, targetSlug(name), mix, `the sound events of ${name}`, values);
  return {
    ok: failures.length === 0,
    target: name,
    summary: `${name}: ${events.length} sound events in ${replay.steps} steps, mix ${m.seconds.toFixed(2)} s, peak ${m.peak.toFixed(3)} (${dbfs(m.peak)}): ${m.peak > 1 ? 'it clips' : 'no clipping'}`,
    lines: [
      `sounds: ${tally(events.map((event) => event.sfx)) || 'none'}`,
      `goldens: ${verdict.golden === 'match' ? `match (${platform})` : verdict.golden === 'mismatch' ? `parted by step ${verdict.step}` : `none for ${platform}`}`,
      `mix hash ${soundHash(mix)}, timeline hash ${timeline}`,
      ...artifacts.map((artifact) => `wrote ${artifact.path}`),
    ],
    failures,
    metrics: { ...reportMetrics(m), events: events.length, mixHash: soundHash(mix), timeline },
    artifacts,
  };
}

/** `a ×2, b` style counts, most frequent first, at most six names. */
function tally(names: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  const sorted = [...counts].sort(([a, m], [b, n]) => n - m || (a < b ? -1 : 1));
  const shown = sorted.slice(0, 6).map(([name, n]) => `${name} ${n}`);
  return `${shown.join(', ')}${sorted.length > 6 ? ', …' : ''}`;
}

export default {
  usage:
    'audio <id> [--variant n] [--seed s] [--intensity i] [--wav] [--spectrogram] | --replay <file> [--wav] [--spectrogram]',
  options: {
    variant: { type: 'string' },
    seed: { type: 'string' },
    intensity: { type: 'string' },
    wav: { type: 'boolean' },
    spectrogram: { type: 'boolean' },
    replay: { type: 'string' },
  },
  maxPositionals: 1,
  async run({ positionals, values, root }): Promise<CommandResult> {
    const replay = values.replay as string | undefined;
    if (replay !== undefined && positionals.length) throw new UsageError('name a sound or --replay <file>, not both');
    if (replay !== undefined) return runReplay(root, replay, values);
    if (!positionals.length) throw new UsageError('name a sound (sfx:jump, song:title) or --replay <file>');
    await loadSoundModules(root);
    return runSound(root, positionals[0], values);
  },
} satisfies Command;
