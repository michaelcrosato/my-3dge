Add a camera mode to the playground: `cam3=crane`, a crane shot for watching the player run the gym, in
`labs/playground/cameras/crane.ts` with its unit test beside it.

- It is the platformer's orbit-and-follow camera (its recentring, look-ahead and dead zone), with its arm 10 m long,
  looking down 35°.
- `cam3=crane,<yaw>` starts it turned to that heading, in degrees; a bare `cam3=crane` keeps the heading of the camera
  before it.
- The playground's page loads it, so `__engine.camera.set('cam3=crane')` and a link with `?cam3=crane` open it there.
- It is not one of the five camera modes T steps through: those stay as they are.
