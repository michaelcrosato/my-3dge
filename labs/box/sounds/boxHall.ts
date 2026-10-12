/**
 * @file The song `song:boxHall`: the box's demo song (PLAN.md WP 9.5), two bars in A minor at 100 bpm that loop in the
 * hall and the room, calm until a fight raises the intensity.
 *
 * Its layers (engine/audio/runtime/music.ts): a triangle bass and a square arpeggio from intensity 0, the calm; drums
 * and a pulse lead join from 0.5, which labs/box/sounds/page.ts reaches while blows land and leaves once they stop.
 *
 * Invariants: tracker notation, one token per step: a note (C4, F#3, Bb2), - holding the note before it, . a rest,
 * and | a bar line, which takes no step; a drums track writes the kit's tokens (k kick, s snare, h hat, o open hat,
 * c crash, t tom). At `steps` per beat and `beats` per bar, every track fills whole bars or divides one (node x
 * describe song lists the fields; engine/audio/data/song.ts gives the rules). `intensity` makes a track join only
 * when the music's intensity reaches it.
 *
 * @example
 * import { songTiming } from '../../../engine';
 * songTiming(boxHall).seconds; // 4.8: two bars of 4/4 at 100 bpm
 * @see labs/box/sounds/boxHall.test.ts
 */
import { defineSong } from '../../../engine';

/** The song `song:boxHall`: the box's music, calm, with a fight's drums and lead from intensity 0.5. */
export const boxHall = defineSong('song:boxHall', {
  bpm: 100,
  tracks: [
    {
      wave: 'triangle',
      vol: 0.22,
      notes: 'A2 - - - - - - - E2 - - - - - - - | F2 - - - - - - - G2 - - - E2 - - -',
    },
    {
      wave: 'square',
      vol: 0.07,
      notes: 'A4 . C5 . E5 . C5 . B4 . E5 . G#4 . B4 . | A4 . C5 . F5 . C5 . G4 . B4 . D5 . B4 .',
    },
    { wave: 'drums', vol: 0.14, intensity: 0.5, notes: 'k . h . s . h . k k h . s . h o' },
    {
      wave: 'pulse',
      vol: 0.09,
      intensity: 0.5,
      notes: 'E5 - - - D5 - C5 - B4 - - - G#4 - - - | A4 - - - C5 - D5 - E5 - - - - - . .',
    },
  ],
});
