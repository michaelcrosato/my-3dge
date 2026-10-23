/**
 * @file Unit tests for the samples (engine/audio/runtime/buffers.ts): a song splits into one layer per intensity,
 * each a whole pass long; the layers' renders add up to the song's; the loop layout's passes are the head and the
 * folded tails, so the passes played back to back are exact; a song that does not loop is left as rendered; an
 * effect's loop pass folds its tail over its start, so the engine's looped foley never dips at its seam.
 */
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../core/registry';
import { getSfx, renderSfx } from '../data/sfx';
import { defineSong, renderSong, songTiming } from '../data/song';
import { DEFAULT_RATE } from '../dsp/render';
import { foldLoop, loopLayout, passSamples, renderLayers, songLayers } from './buffers';
import { nextLine } from './music';

const RATE = 8000;

/** How far the quietest 0.1 s of a loop, played round (its seam among them), falls below the whole loop's level, dB. */
function deepestDip(pass: Float32Array, rate: number): number {
  const rms = (from: number, n: number) => Math.sqrt(Array.from({ length: n }, (_, i) => pass[(from + i) % pass.length] ** 2).reduce((a, b) => a + b, 0) / n); // prettier-ignore
  const [whole, n] = [rms(0, pass.length), Math.round(0.1 * rate)];
  const quietest = Math.min(...Array.from({ length: Math.ceil(pass.length / (n / 2)) }, (_, k) => rms((k * n) / 2, n)));
  return 20 * Math.log10(whole / quietest);
}

/** A registry with a two-layer song: a bass bar (intensity 0) and a half-bar lead from 0.5. */
function layered() {
  const registry = createRegistry();
  const song = defineSong(
    'song:layers',
    {
      bpm: 120,
      tracks: [
        { notes: 'C3 - - - . . . . G2 - - - . . . .', wave: 'triangle', vol: 0.3 },
        { notes: 'E5 - G5 - C6 - . .', wave: 'sine', vol: 0.2, intensity: 0.5 },
      ],
    },
    registry,
  );
  return { registry, song };
}

describe('songLayers', () => {
  it('makes one layer per intensity, ascending, each a whole song pass long', () => {
    const { song } = layered();
    const layers = songLayers(song);
    expect(layers.map((layer) => layer.intensity)).toEqual([0, 0.5]);
    for (const layer of layers) expect(songTiming(layer.song)).toEqual(songTiming(song));
    expect(layers[1].song.tracks.map((track) => track.notes.split(' ').length)).toEqual([8, 16]);
  });

  it('renders layers that add up to the whole song', () => {
    const { registry, song } = layered();
    const whole = renderSong(song, { rate: RATE, registry });
    const [low, high] = songLayers(song).map((layer) => renderSong(layer.song, { rate: RATE, registry }));
    expect(low.length).toBe(whole.length);
    let worst = 0;
    for (let i = 0; i < whole.length; i++) worst = Math.max(worst, Math.abs(low[i] + high[i] - whole[i]));
    expect(worst).toBeLessThan(1e-6);
  });
});

describe('loopLayout', () => {
  it('keeps the head pass as rendered and folds every later sample onto the loop pass', () => {
    expect([...loopLayout(new Float32Array([1, 2, 3, 4, 5]), 2)]).toEqual([1, 2, 9, 6]);
    expect([...loopLayout(new Float32Array([1, 2, 3]), 3)]).toEqual([1, 2, 3, 1, 2, 3]);
  });

  it('plays passes back to back exactly as rendering them one after another would', () => {
    const { registry, song } = layered();
    const pass = passSamples(song, RATE);
    const [layer] = renderLayers(song, RATE, { registry });
    const once = renderSong(songLayers(song)[0].song, { rate: RATE, registry });
    const looped = new Float32Array(3 * pass); // the head, then the loop twice
    looped.set(layer.samples.subarray(0, pass));
    looped.set(layer.samples.subarray(pass), pass);
    looped.set(layer.samples.subarray(pass), 2 * pass);
    const overlapped = new Float64Array(3 * pass + once.length);
    for (let k = 0; k < 3; k++) for (let i = 0; i < once.length; i++) overlapped[k * pass + i] += once[i];
    let worst = 0;
    for (let i = 0; i < 3 * pass; i++) worst = Math.max(worst, Math.abs(looped[i] - overlapped[i]));
    expect(worst).toBeLessThan(1e-6);
  });

  it('folds an effect’s loop pass, its tail over its start, so a looped bed never dips at its seam', () => {
    expect([...foldLoop(new Float32Array([1, 2, 3, 4, 5]), 2)]).toEqual([9, 6]);
    for (const id of ['sfx:zipRun', 'sfx:wind']) {
      const sfx = getSfx(id);
      const pass = foldLoop(renderSfx(sfx), Math.round(sfx.loop * DEFAULT_RATE));
      expect(pass.length / DEFAULT_RATE, id).toBeCloseTo(sfx.loop, 4);
      expect(deepestDip(pass, DEFAULT_RATE), id).toBeLessThan(6); // dB: a crossfade, never a fade to silence
    }
  });

  it('leaves a song that plays once as rendered', () => {
    const registry = createRegistry();
    const jingle = defineSong('song:once', { loop: false, steps: 1, tracks: [{ notes: 'C5 E5 G5 C6' }] }, registry);
    const [layer] = renderLayers(jingle, RATE, { registry });
    expect([...layer.samples]).toEqual([...renderSong(jingle, { rate: RATE, registry })]);
  });
});

describe('nextLine', () => {
  it('finds the first line of the grid at or after a time, and the start before it', () => {
    expect(nextLine(0.6, 0.02, 0.5)).toBeCloseTo(1.02, 12);
    expect(nextLine(1.02, 0.02, 0.5)).toBeCloseTo(1.02, 12);
    expect(nextLine(1.0200000001, 0.02, 0.5)).toBeCloseTo(1.02, 12);
    expect(nextLine(1.03, 0.02, 0.5)).toBeCloseTo(1.52, 12);
    expect(nextLine(0, 0.5, 2)).toBe(0.5);
  });
});
