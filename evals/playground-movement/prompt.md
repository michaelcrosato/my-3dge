Add a movement profile to the playground: `movement:heavy`, a heavy soldier on the shooter model, and a scene of the
gym where the player moves on it.

- `movement:heavy` has `movement:apex`'s hull, steps, slopes and gravity, but runs at 3.6 m/s and sprints at 5.4 m/s
  with a weapon out (empty-handed 1.15 times faster, as Apex's), and jumps 1.0 m. Every other number of its model is
  Apex's.
- The scene `playground:gym-heavy`, in `labs/playground/scenes/gym-heavy.ts`: the gym as it is, its player moving on
  `movement:heavy`.
- The gym itself, `playground:gym`, plays exactly as before: its replays keep their golden hashes.
- The playground's README lists the new scene.
