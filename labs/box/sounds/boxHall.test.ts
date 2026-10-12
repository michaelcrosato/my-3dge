/**
 * @file Unit tests for the song `song:boxHall` (labs/box/sounds/boxHall.ts): it is defined, one pass renders at least
 * its length, audible and below full scale, and its drums and lead join from intensity 0.5.
 * @see labs/box/sounds/boxHall.ts
 */
import { describe, expect, it } from 'vitest';
import { renderSong, songTiming, songVoices } from '../../../engine';
import { peak } from '../../../engine/audio/dsp/measure';
import { boxHall } from './boxHall';

describe('song:boxHall', () => {
  it('renders a pass, audible and below full scale', () => {
    expect(boxHall.id).toBe('song:boxHall');
    expect(songTiming(boxHall).seconds).toBeCloseTo(4.8, 9);
    const samples = renderSong(boxHall);
    expect(samples.length).toBeGreaterThanOrEqual(Math.floor(songTiming(boxHall).seconds * 44100));
    expect(peak(samples)).toBeGreaterThan(0.01);
    expect(peak(samples)).toBeLessThan(1);
  });

  it('is calm at intensity 0, and its drums and lead join from 0.5', () => {
    const waves = (intensity: number) => new Set(songVoices(boxHall, { intensity }).map((voice) => voice.wave));
    expect(waves(0)).toEqual(new Set(['triangle', 'square']));
    expect(waves(0.49)).toEqual(waves(0));
    expect(waves(0.5).has('pulse')).toBe(true);
    expect(waves(0.5).size).toBeGreaterThan(3);
  });
});
