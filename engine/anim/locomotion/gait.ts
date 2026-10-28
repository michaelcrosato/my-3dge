/**
 * @file The gait's constants (PLAN.md WP 3.6, §5.2; engine/anim/locomotion.ts's formulas read them): every number of
 * the humanoid's gait, idle, lean and arm swing (breathing, the bob, the sway, the stride, the lean, the shoulders,
 * the head and the hands), each with its line. Split from locomotion.ts at its line cap.
 *
 * Invariants: lengths in metres, the source's units ÷ 16; angles in radians; rates per second; read-only.
 * Carried from `my-3d2dge:engine/my-3d2dge.js:1919-1954` (`_pose`'s numbers).
 *
 * @example
 * GAIT.breatheRate; // 2.3: radians of the breathing cycle a second
 * @see engine/anim/humanoid.test.ts
 */
/** Every constant of the gait, idle, lean and arm swing; lengths in metres (the source's units ÷ 16). */
export const GAIT = {
  /** Breathing: radians of its cycle per second. */
  breatheRate: 2.3,
  /** How far each breath lifts the pelvis, metres (fades out with speed). */
  breatheLift: 0.01875,
  /** The bob's offset at rest, metres: the pelvis sits this much higher at a standstill… */
  bobRest: 0.03125,
  /** …and drops by up to this much at each footfall while moving, metres (× |cos phase|). */
  bobDrop: 0.08125,
  /** Idle weight shift from foot to foot: radians of its cycle per second. */
  swayRate: 1.15,
  /** How far the idle sway moves the pelvis sideways, metres. */
  swayReach: 0.01875,
  /** How far the pelvis leads forward along the movement at full speed, metres. */
  pelvisLead: 0.025,
  /** Floor of the speed weight in the stride's length: slow steps are short, not slow (the phase's, humanoid.ts). */
  strideFloor: 0.4,
  /** A planted stride's share at the top speed weight: its steps lengthen past the run's into a sprint (new). */
  strideTop: 1.25,
  /** A planted stride's share given up crouched (the humanoid's crouch weight, new): short quick steps. */
  crouchStride: 0.3,
  /** A crouched planted swing lifts this much higher, its shin trailing low (a share of the lift, at a full crouch). */
  crouchLift: 1,
  /** A planted stride's steps this much shorter moving straight sideways, at a quicker cadence (a share). */
  sideStride: 0.35,
  /** A planted stride's forward lean per speed share past the run (new): a sprint leans further. */
  leanSprint: 0.4,
  /** How far a planted stride's crossing foot passes ahead of the other moving sideways, metres (new). */
  crossAhead: 0.16,
  /** How far the pelvis leads sideways along the movement at full speed, metres. */
  pelvisSide: 0.01875,
  /** How far a flinch pushes the pelvis back, metres. */
  hurtBack: 0.025,
  /** How far a flinch drops the pelvis, metres. */
  hurtDrop: 0.0375,
  /** How far a dash drops the pelvis, metres. */
  dashDrop: 0.1375,
  /** Share of a lunge the pelvis follows forward. */
  lungePelvis: 0.55,
  /** Share of the stance height (`hipHeight`) the pelvis drops in a full kneel. */
  kneelDrop: 0.42,
  /** How far the guard pose drops the pelvis, metres. */
  guardDrop: 0.05625,
  /** Share of the stance height the pelvis drops in a full crouch. */
  crouchDrop: 0.32,
  /** How far the knees buckle midway through a fall or a get-up, crouch share (× sin(down · π)). */
  fallCrouch: 0.85,
  /** The share of the hips' turn in the shoulders' (body) twist. */
  hipTwist: 0.4,
  /** A standing foot sits this far ahead of the pelvis on the right, metres. */
  standAheadR: 0.05,
  /** A standing foot sits this far ahead of the pelvis on the left (negative: behind), metres. */
  standAheadL: -0.0375,
  /** Forward lean per unit of forward speed share, radians. */
  leanSpeed: 0.16,
  /** Forward lean of a dash, radians. */
  leanDash: 0.45,
  /** Backward lean of a flinch, radians (subtracted). */
  leanHurt: 0.35,
  /** Forward lean of a full crouch, radians. */
  leanCrouch: 0.22,
  /** Sideways lean per unit of sideways speed share, radians. */
  leanSide: 0.1,
  /** Share of the build's `hunch` that tips the head forward. */
  headHunch: 0.9,
  /** A hanging hand rests this far ahead of its shoulder when still, metres. */
  handRest: 0.03125,
  /** A hanging hand moves this far forward per unit of `hunch`, metres. */
  handHunch: 0.1875,
  /** A hanging hand rests this far out from its shoulder, metres. */
  handOut: 0.05625,
  /** A hanging hand drops this share of the arm's length below its shoulder. */
  handDrop: 0.86,
  /** How far a swinging hand lifts at the ends of its swing, metres (× |sin phase|). */
  handLift: 0.075,
} as const;
