Add a dev action to the playground's gym (`playground:gym`): `launch`, which throws the player straight up from where
he stands, for testing a fall from a height without a tower to climb.

- It takes `{ speed }`, in m/s, 10 by default: he leaves the ground at that speed, straight up, and falls as he would
  from a jump, so at the default he rises about v² / 2g, 2.6 m under Apex's gravity.
- It is the gym's own, beside its dev action `place`, and documented with it; like every dev action it is recorded in
  replays, so a run that launches him replays to the same hashes.
- `__engine.actions.run('launch', { speed: 12 })` runs it in the page and headless.
- The gym plays as before when nobody launches him: its replays keep their golden hashes.
