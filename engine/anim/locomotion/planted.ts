/**
 * @file The planted stride (PLAN.md WP 13.10, docs/PLAYGROUND.md §5.1; ADR-0025 amendment 10): how a build with
 * `plantedStride` (the playground's adult) steps so a foot on the ground stays where it landed. The humanoid's gait
 * (engine/anim/locomotion.ts `gaitFoot`) swings each foot on a sine, which slides it at every touchdown and lift-off
 * (0.36 m a contact at a run, 0.8 m in the anim QA's run); here a foot stands for its share of the cycle, `plantedDuty`
 * (a walk's 0.62 down to a sprint's 0.24, so a run has its flight; a crouch's a walk's), moving back through the stance
 * at an even pace, then swings forward over the rest of the cycle on a half cosine, lifting early (`plantedStep`, the
 * heel kick) with its knee bent at least as far as the gait's kick (`plantedKnee`). `locomotion.ts` scales the step to
 * the speed (the stride warped: a foot travels back exactly as far as the body goes in its stance), turns it along the
 * move at full length (`plantedMove`), drops the pelvis as far as the soles need (`plantedHeight`: a lifted one less,
 * none once it swings), a trailing heel lifting off the ball, and bobs a run's low through its stances and up into its
 * flights (`plantedBob`).
 *
 * Touchdowns stay where the gait's phase puts them (`footCycle`: the left lands at π/2, the right at 3π/2, as the
 * animator's footsteps say, engine/anim/character.ts), so the phase, which the sim hashes, stays the gait's: only the
 * pose changes here (its rate is the build's stride, which `strideShare` lets a planted sprint lengthen to 1.25). A
 * foot stands while its cycle is under the duty: what the foot plant's stance locks hold (engine/anim/footPlant.ts).
 *
 * Invariants: pure functions of their numbers; `plantedStep` is continuous over the cycle (its place at the swing's
 * end is the stance's start) and lifts only in the swing.
 *
 * @example
 * plantedDuty(1); // 0.3: a run's foot stands under a third of its cycle
 * plantedEase(0.5); // 1: well into the stride
 * footCycle(Math.PI / 2, false); // 0: the left foot lands
 * plantedStep(0, 0.5); // [1, 0]: landing, a full reach ahead, on the ground
 * plantedStep(0.69, 0.5); // [≈−0.37, 1]: early in the swing, still behind the hip at the top of its lift
 * @see engine/anim/locomotion/planted.test.ts
 */
import type { Vector3 } from '../../core/math';
import { ankleLimit, sideSign, SOLVE } from '../authoring';
import type { Build } from '../builds';
import { PROPORTIONS } from '../skeleton';

/** The planted stride's numbers: duty shares by speed share (the humanoid's speed weight, up to 1.25). */
export const PLANTED = {
  /** A foot's stance share of its cycle up to a walk's speed share (`walkShare`). */
  dutyWalk: 0.62,
  /** The speed share up to which the walk's duty holds. */
  walkShare: 0.4,
  /** At the run's speed share, 1: a flight between the steps. */
  dutyRun: 0.3,
  /** At the sprint's, `sprintShare`: a shorter stance still. */
  dutySprint: 0.24,
  /** The top of the speed share (humanoid.ts `STEP.speedShareMax`'s 1.25). */
  sprintShare: 1.25,
  /** The speed share over which a standing foot eases into the stride (and out of it on a stop). */
  start: 0.15,
  /** Share of the straight leg a planted sole may take: the knee never locks. */
  reach: 0.985,
  /** How early the swing lifts: its top at `u = 0.38` of the swing for 0.5 (0 a half sine's middle), the heel kick. */
  kick: 0.5,
  /** A swing's least knee bend at its top (rad), walking, running and sprinting: the heel kicked up behind… */
  kneeWalk: (55 * Math.PI) / 180,
  kneeRun: (90 * Math.PI) / 180,
  kneeSprint: (110 * Math.PI) / 180,
  /** …over this share of the swing, a half sine begun `kneeLead` early (a push-off's bend), none past it: the leg reaching for its touchdown. */ // prettier-ignore
  kneeSwing: 0.7,
  kneeLead: 0.1,
  /** How low a run's pelvis rides through each stance, m (before `size`): the leg's spring, as low as the soles' reach
   * holds it at a touchdown and a toe-off (`plantedHeight`)… */
  runDrop: 0.1,
  /** …and how far its flight rises from there, m. */
  runRise: 0.075,
} as const;

/**
 * A foot's stance share of its cycle at speed share `share`: the walk's to the run's to the sprint's, eased linearly;
 * a walk's as far as it is crouched (`crouch`: a crouch never flies, nor lengthens its stance as it slows to a stop).
 */
export function plantedDuty(share: number, crouch = 0): number {
  const P = PLANTED;
  const run = (share - P.walkShare) / (1 - P.walkShare);
  const sprint = Math.min(1, (share - 1) / (P.sprintShare - 1));
  const duty = share <= P.walkShare ? P.dutyWalk : share <= 1 ? P.dutyWalk + (P.dutyRun - P.dutyWalk) * run : P.dutyRun + (P.dutySprint - P.dutyRun) * sprint; // prettier-ignore
  return duty + (P.dutyWalk - duty) * crouch;
}

/**
 * The least bend of a planted foot's knee at cycle `c` with duty `d` and speed share `share` (rad): none in its stance,
 * then over the first `kneeSwing` of its swing a half sine begun `kneeLead` early, from about the push-off's bend up
 * to the gait's (`kneeWalk` to `kneeSprint`, eased as the duty is) and down, the heel kicked up behind. The leg solve draws the sole toward the hip as far as that takes
 * (authoring.ts `solveLeg`), so a swing leaves the floor at once and its toes clear it.
 */
export function plantedKnee(c: number, d: number, share: number): number {
  const P = PLANTED;
  const u = (c - d) / (1 - d);
  if (!(u > 0 && u < P.kneeSwing)) return 0;
  const run = Math.min(1, Math.max(0, (share - P.walkShare) / (1 - P.walkShare)));
  const sprint = Math.min(1, Math.max(0, (share - 1) / (P.sprintShare - 1)));
  const top = P.kneeWalk + (P.kneeRun - P.kneeWalk) * run + (P.kneeSprint - P.kneeRun) * sprint;
  return top * Math.sin((Math.PI * (u + P.kneeLead)) / (P.kneeSwing + P.kneeLead));
}

/**
 * How far into the stride a body at speed share `sp` is, 0 standing to 1 from `PLANTED.start` up (a smoothstep): the
 * stride's reach and the standing stance (and a crouch's, poses.ts) trade places over it.
 */
export function plantedEase(sp: number): number {
  const t = Math.min(1, Math.max(0, sp / PLANTED.start));
  return t * t * (3 - 2 * t);
}

/** Where a foot is in its cycle at gait phase `phase`, 0 at its touchdown to 1: the left lands at π/2, the right at 3π/2. */
export function footCycle(phase: number, right: boolean): number {
  const c = (phase + (right ? Math.PI : 0) - Math.PI / 2) / (2 * Math.PI);
  return c - Math.floor(c);
}

/**
 * A planted foot at cycle `c` with duty `d`: its place along the move as a share of the reach (+1 a reach ahead of the
 * hip, −1 behind) and its lift as a share of the step's height (0 on the ground, 1 at the swing's top).
 */
export function plantedStep(c: number, d: number): [along: number, lift: number] {
  if (c < d) return [1 - (2 * c) / d, 0];
  const u = (c - d) / (1 - d);
  return [-Math.cos(Math.PI * u), Math.sin(Math.PI * (u + PLANTED.kick * u * (1 - u)))];
}

/**
 * A planted stride's direction from the humanoid's movement components (forward, right): its unit vector once they are
 * half long or more. The humanoid eases them toward the velocity (a reversal passes near none), and a step that shrank
 * with them would land short of the stance the body then walks, the locked foot left far behind.
 */
export function plantedMove(forward: number, right: number): [forward: number, right: number] {
  const length = Math.max(0.5, Math.hypot(forward, right));
  return [forward / length, right / length];
}

/**
 * How high a pelvis at `f` forward and `r` right (rig metres before `size`), riding `free` with nothing holding it,
 * may ride for each sole the gait puts down (`soles`, left and right) to be in reach of its hip, `PLANTED.reach` of the
 * straight leg: what a `plantedStride` build's gait drops to as its feet spread. A lifted sole holds it as far as the
 * leg solve plants it (authoring.ts `solveLeg`: none once it swings `SOLVE.liftHeight` up), so the height eases down
 * into a touchdown and back up out of a lift-off; one beyond that reach across the floor holds nothing. A trailing
 * foot reaches further with its heel lifted off the ball past the ankle's bend, as far as the solve rolls it: the
 * height settles over a few passes, each lifting the heel as far as the last one's leg leans.
 */
export function plantedHeight(
  build: Build,
  f: number,
  r: number,
  soles: readonly [Vector3, Vector3],
  free: number,
): number {
  const b = build;
  const reach = (b.legUpper + b.legLower) * PLANTED.reach;
  const knee =
    Math.PI -
    Math.acos((b.legUpper * b.legUpper + b.legLower * b.legLower - reach * reach) / (2 * b.legUpper * b.legLower));
  const bend = ankleLimit(knee); // the ankle's, the leg at its reach
  const [up, ahead] = [PROPORTIONS.ballHeight * b.ankleHeight, (PROPORTIONS.ball - PROPORTIONS.heel) * b.footLength];
  let top = free;
  for (const [i, sole] of soles.entries()) {
    const holds = 1 - Math.min(1, Math.max(0, sole.y / SOLVE.liftHeight)); // as the leg solve plants it
    if (holds === 0) continue; // it swings
    const dx = sole.x - (-r - sideSign(i === 0 ? 'L' : 'R') * b.hipHalf);
    let [y, z, high] = [sole.y, sole.z, Infinity]; // the sole under the ankle, as its heel lifts
    for (let pass = 0; pass < 3; pass++) {
      const flat = dx * dx + (z - f) * (z - f);
      if (!(flat < reach * reach)) break;
      high = y + Math.sqrt(reach * reach - flat);
      const lift = Math.max(0, Math.atan2(f - z, high - y) - bend) * holds; // the leg's lean past the ankle's bend
      [y, z] = [sole.y + up - up * Math.cos(lift) + ahead * Math.sin(lift), sole.z + ahead - up * Math.sin(lift) - ahead * Math.cos(lift)]; // prettier-ignore
    }
    if (high < free) top = Math.min(top, free + (high - free) * holds);
  }
  return top;
}

/**
 * A planted run's bob at gait phase `phase` and speed share `share` (m, before `size`), what it takes over from the
 * source's as the walk becomes a run (`share` past `walkShare` up to 1, none crouched (`crouch`), the weight it returns): the pelvis rides
 * `runDrop` low through each stance (the leg's spring) and rises `runRise` into its flight, a half sine between a
 * toe-off and the next touchdown, where the source's sank lowest at the toe-off.
 */
export function plantedBob(phase: number, share: number, crouch = 0): [bob: number, weight: number] {
  const P = PLANTED;
  const weight = Math.min(1, Math.max(0, (share - P.walkShare) / (1 - P.walkShare))) * (1 - crouch);
  const d = plantedDuty(share, crouch);
  const x = footCycle(phase, false) % 0.5; // a step: one foot's stance, then the flight to the other's touchdown
  const flight = x < d || d >= 0.5 ? 0 : Math.sin((Math.PI * (x - d)) / (0.5 - d));
  return [-P.runDrop + P.runRise * flight, weight];
}
