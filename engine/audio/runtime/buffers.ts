/**
 * @file Samples for Web Audio (PLAN.md WP 9.3): an effect or a song rendered by the DSP (engine/audio/data) becomes
 * an `AudioBuffer`, and a song splits into its intensity layers, each laid out to loop without a seam.
 *
 * A song's layers: its tracks grouped by the `intensity` they join at (engine/audio/data/song.ts), one layer per
 * distinct value, ascending. Each layer renders as a song of its own tracks plus a silent track as long as the whole
 * song, so every layer's pass is the song's pass and the layers play in step whichever are on.
 *
 * The loop layout of a pass of `n` samples, rendered with its tails (`length ≥ n`): the first `n` samples as rendered
 * (nothing rings before the song starts), then `n` samples of the render folded onto one pass (`loop[j] = Σ render[j +
 * k·n]`), which is what every later pass sounds like, the last notes' tails ringing into the next pass. A source
 * plays it with `loopStart = n / rate` and `loopEnd = 2n / rate`: the exact sum of the passes played back to back.
 *
 * Invariants: pure functions of the song and the rate (the DSP's reproducibility holds); buffers are mono, at the
 * rate they were rendered at.
 *
 * @example
 * const layers = songLayers(getSong('song:boss')); // [{ intensity: 0, song }]: every engine song is one layer
 * loopLayout(new Float32Array([1, 2, 3, 4, 5]), 2); // [1, 2, 9, 6]: the head, then 1+3+5 and 2+4
 * @see engine/audio/runtime/buffers.test.ts
 */
import { renderSong, songTiming, type Song } from '../data/song';
import type { Registry } from '../../core/registry';

/** One intensity layer of a song. */
export interface SongLayer {
  /** The intensity from which it plays. */
  readonly intensity: number;
  /** A song of its tracks only, a pass as long as the whole song's. */
  readonly song: Song;
}

/** The layers of `song`, by ascending intensity (see the file comment). */
export function songLayers(song: Song): SongLayer[] {
  const levels = [...new Set(song.tracks.map((track) => track.intensity))].sort((a, b) => a - b);
  const { steps } = songTiming(song);
  const rest = { ...song.tracks[0], notes: Array(steps).fill('.').join(' '), wave: 'square' as const, vol: 0 };
  return levels.map((intensity) => ({
    intensity,
    song: { ...song, tracks: [...song.tracks.filter((track) => track.intensity === intensity), rest] },
  }));
}

/** `samples` (one pass of `pass` samples, then tails) as the head pass followed by the folded loop pass. */
export function loopLayout(samples: Float32Array, pass: number): Float32Array {
  const out = new Float32Array(2 * pass);
  out.set(samples.subarray(0, pass));
  for (let i = 0; i < samples.length; i++) out[pass + (i % pass)] += samples[i];
  return out;
}

/** The samples of one pass of `song` at `rate`. */
export function passSamples(song: Song, rate: number): number {
  return Math.round(songTiming(song).seconds * rate);
}

/** Each layer of `song` rendered at `rate`, laid out to loop when the song loops (else as rendered). */
export function renderLayers(
  song: Song,
  rate: number,
  options: { seed?: number; registry?: Registry } = {},
): { intensity: number; samples: Float32Array }[] {
  const pass = passSamples(song, rate);
  return songLayers(song).map(({ intensity, song: layer }) => {
    const samples = renderSong(layer, { ...options, rate });
    return { intensity, samples: song.loop ? loopLayout(samples, pass) : samples };
  });
}

/** `samples` as a one-channel `AudioBuffer` of `context` at `rate`. */
export function toBuffer(context: BaseAudioContext, samples: Float32Array, rate: number): AudioBuffer {
  const buffer = context.createBuffer(1, Math.max(1, samples.length), rate);
  buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  return buffer;
}
