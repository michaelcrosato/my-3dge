/**
 * @file Unit tests for the `song` kind (engine/audio/data/song.ts): its timing, the checks (tokens, bar lines, track
 * lengths against the bar and the song, ranges), the voices a pass lays out (pitch, start, held length, drum gain,
 * loops, intensity), and the rendered pass: its length, its level and its reproducibility.
 * @see engine/audio/data/song.ts
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createRegistry, type Registry } from '../../core/registry';
import { peak, toneAmplitude } from '../dsp/measure';
import { soundHash } from '../dsp/render';
import { noteFreq } from '../dsp/voice';
import { defineSfx } from './sfx';
import { defineSong, getSong, renderSong, songProblems, songTiming, songVoices, type SongSpec } from './song';

const RATE = 44100;

let registry: Registry;
beforeEach(() => {
  registry = createRegistry();
});

let defined = 0;
/** Defines `spec` on the test registry under a new id. */
const song = (spec: SongSpec) => defineSong(`song:test${defined++}`, spec, registry);

describe('the song kind', () => {
  it('holds the engine songs and fills the defaults', () => {
    expect(getSong('song:victory', registry)).toMatchObject({ bpm: 150, steps: 4, beats: 4, loop: false });
    const test = song({ tracks: [{ notes: 'C4 . . . . . . . . . . . . . . .' }] });
    expect(test).toMatchObject({ bpm: 120, steps: 4, beats: 4, loop: true, kit: { k: 'sfx:drumKick' } });
    expect(test.tracks[0]).toEqual({
      notes: 'C4 . . . . . . . . . . . . . . .',
      wave: 'square',
      vol: 0.18,
      octave: 0,
      gate: 0.9,
      attack: 0.006,
      intensity: 0,
    });
  });

  it('times steps, bars and a pass', () => {
    expect(songTiming(getSong('song:dungeon', registry))).toEqual({
      stepSeconds: 0.15625,
      barSteps: 16,
      steps: 64,
      seconds: 10,
    });
    const waltz = song({ bpm: 90, steps: 2, beats: 3, tracks: [{ notes: 'C4 - - E4 G4 - | C5 - - - - .' }] });
    expect(songTiming(waltz)).toEqual({ stepSeconds: 1 / 3, barSteps: 6, steps: 12, seconds: 4 });
  });

  it('refuses tracks that do not fit the bar or the song', () => {
    const bars = (n: number) => Array.from({ length: n * 16 }, () => '.').join(' ');
    expect(() => song({ tracks: [{ notes: Array(12).fill('C4').join(' ') }] })).toThrow(
      /tracks\[0\] is 12 steps long: a track fills whole bars or divides one \(a bar is 16 steps\)/,
    );
    expect(() => song({ tracks: [{ notes: `C4 ${bars(2)}`.slice(0, -2) }, { notes: bars(3) }] })).toThrow(
      /tracks\[0\] is 32 steps long, which does not divide the song's 48/,
    );
    expect(() => song({ tracks: [{ notes: 'C4 . . . . . . .' }] })).toThrow(/the song is 8 steps long, not whole bars/);
    expect(song({ beats: 2, tracks: [{ notes: 'C4 . . . . . . .' }] }).beats).toBe(2);
    expect(() => song({ tracks: [{ notes: `C4 . . | ${bars(1)}`.slice(0, -6) }] })).toThrow(
      /a \| falls after step 3, not on a bar line/,
    );
    expect(() => song({ tracks: [] })).toThrow(/it has no tracks/);
    expect(() => song({ tracks: [{ notes: ' | ' }] })).toThrow(/tracks\[0\] has no steps/);
  });

  it('refuses tokens that are not notes, holds that hold nothing, and drums outside the kit', () => {
    const one =
      (notes: string, wave: 'drums' | 'square' = 'square') =>
      () =>
        song({ beats: 1, tracks: [{ notes, wave }] });
    expect(one('C4 . - .')).toThrow(/the - at step 2 holds nothing/);
    expect(one('- C4 . .')).toThrow(/the - at step 0 holds nothing/);
    expect(one('C4 H4 . .')).toThrow(/"H4" at step 1 is not a note/);
    expect(one('k x . .', 'drums')).toThrow(/"x" at step 1 is not in the kit \(k s h o c t\)/);
    expect(one('k - . .', 'drums')).toThrow(/the - at step 1 holds nothing/);
    expect(one('C4 - - .')).not.toThrow();
    expect(() => song({ kit: { '.': 'sfx:drumKick' }, tracks: [{ notes: '. . . .' }], beats: 1 })).toThrow(
      /kit token "\." must be one word/,
    );
  });

  it('refuses values out of range and voices the DSP refuses, naming the field', () => {
    const notes = 'C4 . . .';
    expect(() => song({ bpm: 0, beats: 1, tracks: [{ notes }] })).toThrow(/CORE_BAD_SPEC.*bpm/);
    expect(() => song({ beats: 1, tracks: [{ notes, wave: 'noise' as never }] })).toThrow(/wave/);
    expect(() => song({ beats: 1, tracks: [{ note: notes } as never] })).toThrow(/did you mean "notes"/);
    expect(() => song({ beats: 1, tracks: [{ notes, octave: 0.5 }] })).toThrow(/octave/);
    expect(() => song({ beats: 1, tracks: [{ notes, wave: 'pluck', vib: [5, 0.01] }] })).toThrow(
      /tracks\[0\]: \[AUDIO_BAD_VALUE\].*vib/,
    );
    expect(() => song({ beats: 1, tracks: [{ notes, vib: [5] as never }] })).toThrow(/AUDIO_BAD_VALUE.*vib/);
    const ok = getSong('song:title', registry);
    expect(songProblems(ok)).toEqual([]);
  });
});

describe('songVoices', () => {
  it('plays each note from its step for its held steps times the gate', () => {
    const test = song({ beats: 1, tracks: [{ notes: 'C4 - E4 .', vol: 0.2, octave: 1, vib: [6, 0.01] }] });
    expect(songVoices(test, { registry })).toEqual([
      { wave: 'square', freq: noteFreq('C5'), at: 0, dur: 0.225, vol: 0.2, hold: true, attack: 0.006, vib: [6, 0.01] },
      {
        wave: 'square',
        freq: noteFreq('E5'),
        at: 0.25,
        dur: 0.1125,
        vol: 0.2,
        hold: true,
        attack: 0.006,
        vib: [6, 0.01],
      },
    ]);
  });

  it("loops short tracks, never wraps a hold, and scales a drum track's kit by its gain", () => {
    const test = song({
      tracks: [
        { notes: 'C4 - - - . . . . . . . . . . . .', wave: 'triangle' },
        { notes: 'k . . .', wave: 'drums', vol: 0.36 },
        { notes: 'A4 - - -', wave: 'pluck' },
      ],
    });
    const voices = songVoices(test, { registry });
    const kicks = voices.filter((voice) => voice.wave === 'sine');
    expect(kicks.map((voice) => [voice.at, voice.vol, voice.freq])).toEqual([
      [0, 1.4, 150],
      [0.5, 1.4, 150],
      [1, 1.4, 150],
      [1.5, 1.4, 150],
    ]);
    const plucks = voices.filter((voice) => voice.wave === 'pluck');
    expect(plucks.map((voice) => [voice.at, voice.dur])).toEqual([
      [0, 0.45],
      [0.5, 0.45],
      [1, 0.45],
      [1.5, 0.45],
    ]);
  });

  it('leaves out the tracks above the intensity', () => {
    const test = song({
      beats: 1,
      tracks: [{ notes: 'C4 . . .' }, { notes: 'E4 . . .', intensity: 0.5 }],
    });
    expect(songVoices(test, { registry, intensity: 0.4 }).map((voice) => voice.freq)).toEqual([noteFreq('C4')]);
    expect(songVoices(test, { registry, intensity: 0.5 })).toHaveLength(2);
    expect(songVoices(test, { registry })).toHaveLength(2);
  });

  it("plays a song's own kit", () => {
    defineSfx('sfx:clap', { voices: { wave: 'noise', freq: 1200, dur: 0.05 } }, registry);
    const test = song({
      beats: 1,
      kit: { x: 'sfx:clap', y: 'sfx:clop' },
      tracks: [{ notes: 'x . x .', wave: 'drums' }],
    });
    expect(songVoices(test, { registry }).map((voice) => [voice.wave, voice.at])).toEqual([
      ['noise', 0],
      ['noise', 0.25],
    ]);
    const typo = defineSong(
      'song:typo',
      { beats: 1, kit: { y: 'sfx:clop' }, tracks: [{ notes: 'y . . .', wave: 'drums' }] },
      registry,
    );
    expect(() => songVoices(typo, { registry })).toThrow(/CORE_NO_ENTRY.*sfx:clap/);
  });
});

describe('renderSong', () => {
  it('renders a held note at its level', () => {
    const test = song({ beats: 2, tracks: [{ notes: 'A4 - - - - - - -', wave: 'sine', vol: 0.5 }] });
    const samples = renderSong(test, { registry });
    expect(samples.length).toBe(RATE);
    expect(toneAmplitude(samples, 440, RATE, 4410, 35280)).toBeCloseTo(0.5, 2);
    expect(peak(samples, 39690)).toBe(0);
  });

  it('lasts at least one pass, and is silence when no track plays', () => {
    const test = song({ beats: 2, tracks: [{ notes: 'A4 . . . . . . .', intensity: 0.5 }] });
    expect(renderSong(test, { registry }).length).toBe(RATE);
    const quiet = renderSong(test, { registry, intensity: 0 });
    expect(quiet.length).toBe(RATE);
    expect(peak(quiet)).toBe(0);
  });

  it('renders the same bits for the same seed, and other drum noise for another', () => {
    const title = getSong('song:title', registry);
    const hash = soundHash(renderSong(title, { registry }));
    expect(soundHash(renderSong(title, { registry }))).toBe(hash);
    expect(soundHash(renderSong(title, { registry, seed: 1 }))).not.toBe(hash);
    expect(renderSong('song:title', { registry, rate: 22050 }).length).toBe(189000);
  });
});
