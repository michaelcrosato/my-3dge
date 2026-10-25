Add an interactable to the playground: a radio the player turns on and off with the use button, in
`labs/playground/cast/radio.ts` with its unit test beside it.

- It is a prop, `prop:playground-radio`: a small wooden radio about 0.3 m wide, 0.2 m high and 0.15 m deep, with a
  glowing dial on its face.
- `addRadio(w, { at, yaw, on })` stands one in a scene, its foot at `at` (m), facing `yaw` (rad), playing if `on`
  (off by default). Whether it plays is the component `radio` (`{ on }`), so the hash, captures and replays hold it.
- Using it (the `interact` action) turns it on or off. The HUD's prompt says `Turn the radio on` or
  `Turn the radio off`, and each use emits the event `radio` with `{ id, on }`.

No scene needs to stand one yet.
