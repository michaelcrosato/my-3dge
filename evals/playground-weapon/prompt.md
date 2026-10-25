Add a weapon to the playground: `weapon:playground-smg`, a submachine gun with the R-99's numbers, beside the pistol
and the rifle in `labs/playground/weapons/guns.ts`, with a unit test.

- Automatic at 18 shots a second, 11 points a shot, reaching 60 m; a magazine of 18, a 1.8 s tactical reload and
  2.45 s from empty.
- Its cone: 1.6° from the hip, 0.6° more on the move, 0.15° down the sights; a light kick a shot (about 0.35° up)
  that climbs a little right, then left; its sights a 63° lens, up in 0.18 s; drawn in 0.25 s.
- It is drawn as its own prop, `prop:playground-smg`: boxes and a barrel in the weapon's frame (the grip under the
  origin, +Z along the barrel, about 0.6 m long), with no body. Its shot sounds as the rifle's (`sfx:rifleShot`).
- Nobody carries it yet: the player keeps the pistol and the rifle.
