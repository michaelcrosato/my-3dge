/**
 * @file The `audio` QA family (PLAN.md §8.6, WP 9.4, I-23, I-29): `node x qa audio` renders every sound the shared
 * registry has, the engine's `sfx` and `song` entries (engine/audio/data) and a game's (each `*.ts` module under
 * `labs/<name>/sounds/` imported first), and measures each render by numbers: no ear needed (doctrine: Verifiable). It
 * runs in T1 through `runQa` (tools/qa/audio.test.ts), and `x audio` (tools/cmd/audio.ts) prints the same metrics for
 * one sound.
 *
 * Renders: every variant of an effect (each variant already draws its noise from its own seed) and a song with every
 * track (intensity 1), from seed 0, at 44,100 Hz. Metrics, one violation per sound and metric, valued by the worst
 * render (larger is worse):
 * - `clipping`: the peak above 1 (full scale), where the output clips;
 * - `dcOffset`: the mean sample's size above 0.01;
 * - `clicks`: how many jumps of at least 0.05 lead into or out of near-silence, the buffer's ends included, and do not
 *   recur as a waveform's edges do (`findClicks`): an onset with no attack, a cut-off with no release, a hole;
 * - `silence`: the seconds before the first sample above −60 dBFS, above 0.05 s, or the whole length when the sound
 *   never rises above it;
 * - `duration`: the seconds above 10 for an effect, above 300 for a song (a `dur` in milliseconds, a runaway echo);
 * - `centroid`: the spectral centroid (the power-weighted mean frequency of the Hann-windowed spectrum) outside 60 Hz
 *   to 16 kHz, in octaves: a sound mostly below small speakers' range, or mostly above most ears' (a hi-hat's is
 *   about 13 kHz);
 * - `render`: 1 when it throws (an unknown layer, a cycle), with the error.
 * A violation names the render (variant and seed), the numbers and the likely fix. Accepted exceptions go in
 * `tests/baselines/qa-audio.json`, each with its reason.
 *
 * Invariants: sounds are checked in kind then id order, renders in a fixed order, so violations come in a fixed order.
 * The metrics are pure functions of the samples and the rate.
 *
 * @example
 * import { renderSfx } from '../../engine/audio/data/sfx';
 * soundMetrics(renderSfx('sfx:jump'), 44100).clicks; // []
 * checkSounds(undefined, ['sfx:jump']); // []
 * @see tools/qa/audio.test.ts
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getSfx, renderSfx, sfxKind } from '../../engine/audio/data/sfx';
import { renderSong, songKind } from '../../engine/audio/data/song';
import { dcOffset, rms } from '../../engine/audio/dsp/measure';
import { DEFAULT_RATE } from '../../engine/audio/dsp/render';
import { registry as sharedRegistry, type Registry } from '../../engine/core/registry';
import type { QaFamily, QaViolation } from '../cmd/qa';

/** The levels and limits the checks use (see the file comment). */
export const AUDIO_LIMITS = {
  dcOffset: 0.01,
  clickJump: 0.05,
  /** The window either side of a jump, in seconds. */
  clickWindow: 0.001,
  /** How far a waveform's repeated edge may be, in seconds (a 40 Hz period). */
  clickMemory: 0.025,
  /** −60 dBFS: quieter is silence. */
  silence: 0.001,
  leadingSilence: 0.05,
  duration: { sfx: 10, song: 300 } as Record<string, number>,
  centroid: [60, 16000],
} as const;

/** What `soundMetrics` measures. */
export interface SoundMetrics {
  seconds: number;
  peak: number;
  /** Where the peak is, in seconds. */
  peakAt: number;
  /** Samples beyond ±1. */
  clipped: number;
  rms: number;
  /** The mean sample. */
  dc: number;
  /** When each click is, in seconds (the length for a cut at the end). */
  clicks: number[];
  /** Seconds before the first sample above −60 dBFS; the whole length when there is none. */
  lead: number;
  /** In Hz; 0 for silence. */
  centroid: number;
}

/** Per FFT size: the bit-reversed order, the twiddle factors and the Hann window, made once. */
const plans = new Map<number, { swap: Uint32Array; cos: Float64Array; sin: Float64Array; hann: Float64Array }>();

/** The plan for an FFT of `n` points. */
function planOf(n: number) {
  const known = plans.get(n);
  if (known) return known;
  const swap = new Uint32Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    swap[i] = j ^= bit;
  }
  const angle = (k: number) => (2 * Math.PI * k) / n;
  const plan = {
    swap,
    cos: Float64Array.from({ length: n / 2 }, (_, k) => Math.cos(angle(k))),
    sin: Float64Array.from({ length: n / 2 }, (_, k) => -Math.sin(angle(k))),
    hann: Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos(angle(i))),
  };
  plans.set(n, plan);
  return plan;
}

/** In-place radix-2 FFT of `re` and `im`, whose length is a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  const { swap, cos, sin } = planOf(n);
  for (let i = 1; i < n; i++) {
    const j = swap[i];
    if (i >= j) continue;
    let t = re[i];
    re[i] = re[j];
    re[j] = t;
    t = im[i];
    im[i] = im[j];
    im[j] = t;
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const stride = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const a = start + k;
        const b = a + half;
        const wr = cos[k * stride];
        const wi = sin[k * stride];
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/** Fills `re` (zeroing `im`) with the Hann-windowed `re.length` samples centred on `centre`, then transforms them. */
function transform(samples: ArrayLike<number>, centre: number, re: Float64Array, im: Float64Array): void {
  const size = re.length;
  const { hann } = planOf(size);
  const start = Math.round(centre) - size / 2;
  re.fill(0);
  im.fill(0);
  for (let i = Math.max(0, -start); i < size && start + i < samples.length; i++) re[i] = samples[start + i] * hann[i];
  fft(re, im);
}

/**
 * The amplitude spectrum of the `size` samples centred on `centre` (zeros beyond the ends), Hann-windowed: `size / 2 +
 * 1` bins `rate / size` apart, about 1 for a full-scale sine on a bin.
 */
export function frameSpectrum(samples: ArrayLike<number>, centre: number, size = 2048): Float64Array {
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  transform(samples, centre, re, im);
  const out = new Float64Array(size / 2 + 1);
  for (let k = 0; k <= size / 2; k++) out[k] = (4 * Math.sqrt(re[k] * re[k] + im[k] * im[k])) / size;
  return out;
}

/** The power-weighted mean frequency of `samples`' spectrum (2048-sample frames, half overlapping), in Hz; 0: silence. */
export function spectralCentroid(samples: ArrayLike<number>, rate: number): number {
  const size = 2048;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  let [moment, total] = [0, 0];
  for (let centre = size / 4; centre < samples.length + size / 4; centre += size / 2) {
    transform(samples, centre, re, im);
    for (let k = 1; k <= size / 2; k++) {
      const power = re[k] * re[k] + im[k] * im[k];
      moment += k * power;
      total += power;
    }
  }
  return total > 0 ? ((moment / total) * rate) / size : 0;
}

/** The loudest |sample| in `[from, to)`, zeros beyond the ends. */
function windowPeak(samples: ArrayLike<number>, from: number, to: number): number {
  let top = 0;
  for (let i = Math.max(0, from); i < Math.min(to, samples.length); i++) top = Math.max(top, Math.abs(samples[i]));
  return top;
}

/** Whether a jump of `jump` (signed) recurs, at least half as large, between `from` and `to`: a waveform's edge. */
function recurs(at: (i: number) => number, jump: number, from: number, to: number): boolean {
  for (let j = from; j < to; j++) if ((at(j) - at(j - 1)) / jump >= 0.5) return true;
  return false;
}

/**
 * The clicks of `samples`, as sample indices `i`, one per 1 ms: each jump `x[i] − x[i−1]` of at least 0.05 (silence
 * before the start and after the end) into or out of near-silence (the 1 ms before or from it peaking below a
 * sixteenth of the jump) that the waveform does not repeat: no jump of the same sign at least half as large in the
 * 25 ms before an onset, or after a cut. A pulse wave's edges repeat; an onset without attack, a cut-off or a hole
 * does not.
 */
export function findClicks(samples: ArrayLike<number>, rate: number): number[] {
  const window = Math.max(1, Math.round(rate * AUDIO_LIMITS.clickWindow));
  const memory = Math.round(rate * AUDIO_LIMITS.clickMemory);
  const clicks: number[] = [];
  const at = (i: number) => (i >= 0 && i < samples.length ? samples[i] : 0);
  for (let i = 0; i <= samples.length; i++) {
    const jump = at(i) - at(i - 1);
    if (Math.abs(jump) < AUDIO_LIMITS.clickJump) continue;
    const quiet = Math.abs(jump) / 16;
    const onset = windowPeak(samples, i - window, i) < quiet && !recurs(at, jump, i - memory, i - 2);
    const cut = windowPeak(samples, i, i + window) < quiet && !recurs(at, jump, i + 3, i + memory);
    if (!onset && !cut) continue;
    clicks.push(i);
    i += window - 1;
  }
  return clicks;
}

/** Every metric of a render (see `SoundMetrics`). */
export function soundMetrics(samples: ArrayLike<number>, rate: number): SoundMetrics {
  let [top, topAt, clipped, first] = [0, 0, 0, -1];
  for (let i = 0; i < samples.length; i++) {
    const size = Math.abs(samples[i]);
    if (size > top) [top, topAt] = [size, i];
    if (size > 1) clipped++;
    if (first < 0 && size > AUDIO_LIMITS.silence) first = i;
  }
  return {
    seconds: samples.length / rate,
    peak: top,
    peakAt: topAt / rate,
    clipped,
    rms: rms(samples),
    dc: dcOffset(samples),
    clicks: findClicks(samples, rate).map((i) => i / rate),
    lead: (first < 0 ? samples.length : first) / rate,
    centroid: spectralCentroid(samples, rate),
  };
}

/** A problem a render shows: its metric, its value (larger is worse) and the sentence an agent reads. */
export interface SoundProblem {
  metric: string;
  value: number;
  message: string;
}

/** `x` in decibels relative to full scale, one decimal. */
export const dbfs = (x: number): string => `${x > 0 ? (20 * Math.log10(x)).toFixed(1) : '−∞'} dBFS`;
/** `value` kept to 4 decimals, so baselines stay readable. */
const round = (value: number) => Math.round(value * 1e4) / 1e4;

/** The problems of a render of a `kind` (`sfx` or `song`) sound, judged by its metrics against `AUDIO_LIMITS`. */
export function soundProblems(kind: string, m: SoundMetrics): SoundProblem[] {
  const problems: SoundProblem[] = [];
  const add = (metric: string, value: number, message: string) =>
    problems.push({ metric, value: round(value), message });
  if (m.peak > 1) {
    add(
      'clipping',
      m.peak,
      `peak ${m.peak.toFixed(3)} (${dbfs(m.peak)}) at ${m.peakAt.toFixed(3)} s, ${m.clipped} samples beyond ±1: lower the vol of its loudest voices or layers`,
    );
  }
  if (Math.abs(m.dc) > AUDIO_LIMITS.dcOffset) {
    add(
      'dcOffset',
      Math.abs(m.dc),
      `the mean sample is ${m.dc.toFixed(4)} (the limit is ±${AUDIO_LIMITS.dcOffset}): a waveform or filter off centre; check the voices' wave and filter`,
    );
  }
  if (m.clicks.length) {
    const times = m.clicks.slice(0, 3).map((t) => t.toFixed(4));
    add(
      'clicks',
      m.clicks.length,
      `${m.clicks.length} jump(s) into or out of silence, at ${times.join(', ')}${m.clicks.length > 3 ? ' …' : ''} s: give the voice an attack and a release of a few ms (attack 0 or a cut-off clicks)`,
    );
  }
  if (m.lead >= m.seconds) {
    add(
      'silence',
      m.seconds,
      `silent throughout: its peak is ${dbfs(m.peak)}, below −60 dBFS; raise its vol or remove it`,
    );
  } else if (m.lead > AUDIO_LIMITS.leadingSilence) {
    add(
      'silence',
      m.lead,
      `${m.lead.toFixed(3)} s of silence before it starts (the limit is ${AUDIO_LIMITS.leadingSilence} s): start its first voice or layer at 0 (\`at\`), so it plays when triggered`,
    );
  }
  const longest = AUDIO_LIMITS.duration[kind] ?? Infinity;
  if (m.seconds > longest) {
    add(
      'duration',
      m.seconds,
      `it lasts ${m.seconds.toFixed(2)} s (the limit for ${kind} is ${longest} s): durations are in seconds, not milliseconds; check \`dur\`, \`at\` and \`delay\``,
    );
  }
  const [low, high] = AUDIO_LIMITS.centroid;
  if (m.peak > AUDIO_LIMITS.silence && (m.centroid < low || m.centroid > high)) {
    const below = m.centroid < low;
    const octaves = below ? Math.log2(low / m.centroid) : Math.log2(m.centroid / high);
    add(
      'centroid',
      octaves,
      `its spectral centroid is ${Math.round(m.centroid)} Hz, ${octaves.toFixed(2)} octaves ${below ? `below ${low} Hz: mostly rumble small speakers cannot play; raise its pitch or add a higher voice` : `above ${high} Hz: mostly hiss; lower its pitch or filter it (lowpass)`}`,
    );
  }
  return problems;
}

/** A game's sound modules, `labs/<name>/sounds/*.ts` (tests excluded), labs and files in name order. */
export function soundModules(root: string): string[] {
  const labs = join(root, 'labs');
  if (!existsSync(labs)) return [];
  return readdirSync(labs)
    .sort()
    .map((lab) => join('labs', lab, 'sounds'))
    .filter((dir) => existsSync(join(root, dir)))
    .flatMap((dir) =>
      readdirSync(join(root, dir))
        .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
        .sort()
        .map((name) => join(dir, name)),
    );
}

/** Imports the games' sound modules, so their entries join the shared registry's (whose sound kinds it declares). */
export async function loadSoundModules(root: string): Promise<void> {
  for (const module of soundModules(root)) await import(pathToFileURL(join(root, module)).href);
  sfxKind(sharedRegistry);
  songKind(sharedRegistry);
}

/** The renders the family checks of a sound, from seed 0: each variant of an effect, a song with every track. */
function renders(registry: Registry, kind: string, id: string): { at: string; render: () => Float32Array }[] {
  if (kind !== 'sfx') return [{ at: 'every track', render: () => renderSong(id, { registry }) }];
  return Array.from({ length: getSfx(id, registry).variants }, (_, variant) => ({
    at: `variant ${variant}`,
    render: () => renderSfx(id, { variant, registry }),
  }));
}

/** The violations of every sound on `registry` (or those of `ids`): effects, then songs, each in id order. */
export function checkSounds(registry: Registry = sharedRegistry, ids?: readonly string[]): QaViolation[] {
  sfxKind(registry);
  songKind(registry);
  const violations: QaViolation[] = [];
  for (const kind of ['sfx', 'song']) {
    for (const { id } of registry.list(kind)) {
      if (ids && !ids.includes(id)) continue;
      const worst = new Map<string, SoundProblem>();
      try {
        for (const { at, render } of renders(registry, kind, id)) {
          for (const problem of soundProblems(kind, soundMetrics(render(), DEFAULT_RATE))) {
            const known = worst.get(problem.metric);
            if (!known || problem.value > known.value)
              worst.set(problem.metric, { ...problem, message: `${at}: ${problem.message}` });
          }
        }
      } catch (error) {
        worst.set('render', { metric: 'render', value: 1, message: `rendering it threw: ${(error as Error).message}` });
      }
      for (const { metric, value, message } of worst.values()) violations.push({ id, metric, value, message });
    }
  }
  return violations;
}

/** The family: every sound of the shared registry, after importing the games' sound modules. */
const family: QaFamily = {
  async run({ root, only }) {
    await loadSoundModules(root);
    const ids = [...sharedRegistry.list('sfx'), ...sharedRegistry.list('song')].map((entry) => entry.id);
    return checkSounds(
      sharedRegistry,
      only.length ? ids.filter((id) => only.some((prefix) => id.startsWith(prefix))) : ids,
    );
  },
};

export default family;
