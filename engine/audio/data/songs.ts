/**
 * @file The engine's five songs as data (PLAN.md WP 9.2, I-23): original chiptune loops for a title screen, an
 * adventure, a dungeon, a boss fight and a victory jingle, each a `song` entry (engine/audio/data/song.ts) under the id
 * `song:<name>`.
 *
 * Invariants: the tracks are the source's, note for note, in its tracker notation (one token per step: a note such as
 * `C5`, `-` holding the previous note, `.` a rest, `|` a bar line). Each song is in 4/4 at four steps per beat, so a
 * bar is 16 steps, and every track fills whole bars or divides one (song.ts checks it). `song:victory` plays once.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:3838-3856` (`E.songs`).
 *
 * @example
 * SONGS['song:dungeon'].bpm; // 96
 * Object.keys(SONGS); // ['song:title', 'song:adventure', 'song:dungeon', 'song:boss', 'song:victory']
 * @see engine/audio/data/sounds.test.ts
 */
import type { SongSpec } from './song';

/** The engine's songs by id. */
export const SONGS: Readonly<Record<string, SongSpec>> = {
  'song:title': {
    bpm: 112,
    steps: 4,
    tracks: [
      {
        wave: 'square',
        vol: 0.16,
        notes:
          'C5 - - - G4 - C5 - E5 - - - D5 - C5 - | D5 - - - G4 - B4 - D5 - - - F5 - E5 - | E5 - - - C5 - E5 - G5 - - - A5 - G5 - | F5 - E5 - D5 - B4 - C5 - - - - - . .',
      },
      {
        wave: 'triangle',
        vol: 0.3,
        notes:
          'C3 - . C3 G2 - . G2 C3 - . C3 G2 - . G2 | G2 - . G2 D3 - . D3 G2 - . G2 D3 - . D3 | A2 - . A2 E3 - . E3 A2 - . A2 E3 - . E3 | F2 - . F2 G2 - . G2 C3 - . C3 G2 - . .',
      },
      { wave: 'drums', vol: 0.14, notes: 'k . h . s . h . k . h k s . h .' },
    ],
  },
  'song:adventure': {
    bpm: 138,
    steps: 4,
    tracks: [
      {
        wave: 'pulse',
        vol: 0.15,
        notes:
          'E5 - G5 - A5 - - C6 B5 - A5 - G5 - E5 - | D5 - E5 - G5 - - A5 G5 - E5 - D5 - . . | E5 - G5 - A5 - - C6 D6 - C6 - A5 - G5 - | A5 - G5 - E5 - D5 - C5 - - - - - . .',
      },
      {
        wave: 'square',
        vol: 0.07,
        notes:
          'C5 . E5 . G5 . E5 . C5 . E5 . G5 . E5 . | B4 . D5 . G5 . D5 . B4 . D5 . G5 . D5 . | A4 . C5 . E5 . C5 . A4 . C5 . E5 . C5 . | F4 . A4 . C5 . A4 . G4 . B4 . D5 . B4 .',
      },
      {
        wave: 'triangle',
        vol: 0.32,
        notes:
          'C3 . C4 . C3 . C4 . C3 . C4 . C3 . C4 . | G2 . G3 . G2 . G3 . G2 . G3 . G2 . G3 . | A2 . A3 . A2 . A3 . A2 . A3 . A2 . A3 . | F2 . F3 . F2 . F3 . G2 . G3 . G2 . G3 .',
      },
      { wave: 'drums', vol: 0.15, notes: 'k . h . s . h h k . h . s . h o' },
    ],
  },
  'song:dungeon': {
    bpm: 96,
    steps: 4,
    tracks: [
      {
        wave: 'pulse12',
        vol: 0.13,
        notes:
          'A4 - - - C5 - B4 - A4 - - - E4 - - - | F4 - - - A4 - G4 - E4 - - - - - . . | A4 - - - C5 - D5 - E5 - - - D5 - C5 - | B4 - - - G#4 - - - A4 - - - - - . .',
      },
      {
        wave: 'triangle',
        vol: 0.32,
        notes:
          'A2 - . . A2 . . . E2 - . . A2 . . . | F2 - . . F2 . . . E2 - . . E2 . . . | A2 - . . A2 . . . G2 - . . G2 . . . | E2 - . . E2 . . . A2 - . . A2 . . .',
      },
      { wave: 'drums', vol: 0.1, notes: 'k . . . h . . . k . k . h . . .' },
    ],
  },
  'song:boss': {
    bpm: 164,
    steps: 4,
    tracks: [
      {
        wave: 'saw',
        vol: 0.09,
        notes:
          'D5 D5 . D5 F5 - D5 . D5 D5 . D5 A5 - F5 . | C5 C5 . C5 E5 - C5 . C5 C5 . C5 G5 - E5 . | Bb4 Bb4 . Bb4 D5 - F5 - Bb4 Bb4 . Bb4 F5 - D5 - | A4 - C#5 - E5 - A5 - G5 - E5 - C#5 - A4 -',
      },
      {
        wave: 'square',
        vol: 0.09,
        notes:
          'D4 . D4 . D4 . D4 . D4 . D4 . D4 . D4 . | C4 . C4 . C4 . C4 . C4 . C4 . C4 . C4 . | Bb3 . Bb3 . Bb3 . Bb3 . Bb3 . Bb3 . Bb3 . Bb3 . | A3 . A3 . A3 . A3 . A3 . A3 . C#4 . C#4 .',
      },
      {
        wave: 'triangle',
        vol: 0.32,
        notes:
          'D2 D3 D2 D3 D2 D3 D2 D3 D2 D3 D2 D3 D2 D3 D2 D3 | C2 C3 C2 C3 C2 C3 C2 C3 C2 C3 C2 C3 C2 C3 C2 C3 | Bb1 Bb2 Bb1 Bb2 Bb1 Bb2 Bb1 Bb2 Bb1 Bb2 Bb1 Bb2 Bb1 Bb2 Bb1 Bb2 | A1 A2 A1 A2 A1 A2 A1 A2 A1 A2 A1 A2 C#2 C#3 C#2 C#3',
      },
      { wave: 'drums', vol: 0.16, notes: 'k h s h k k s h k h s h k s s s' },
    ],
  },
  'song:victory': {
    bpm: 150,
    steps: 4,
    loop: false,
    tracks: [
      {
        wave: 'square',
        vol: 0.17,
        notes: 'G4 . C5 . E5 . G5 - - - E5 - G5 - - - A5 - G5 - E5 - F5 - G5 - - - - - . .',
      },
      {
        wave: 'triangle',
        vol: 0.3,
        notes: 'C3 . C3 . C3 . C3 - - - C3 - C3 - - - F2 - F2 - C3 - G2 - C3 - - - - - . .',
      },
    ],
  },
};
