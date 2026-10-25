Give the Stress Box's slimes a sound of their own: their pounce now lands with the same thud as everything else.

- Add the sound effect `sfx:boxSquelch` beside the box's other effects: a slime's pounce coming down, a wet smack
  shorter than half a second, with a few variants so repeats differ.
- The box's sound map plays it for a pounce's landing (the sim event `slam`), as loud as the thud played there; every
  other event keeps its sound (a landing still thuds).
- The sim does not change: every replay keeps its golden hashes. Only what is heard changes; where a sound test holds
  a golden of what is heard, update it, with the reason beside it.
