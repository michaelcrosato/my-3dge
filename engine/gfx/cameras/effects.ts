/**
 * @file Camera effects (PLAN.md WP 13.8, docs/PLAYGROUND.md §4; doctrine: Common ground): Apex Legends' view effects,
 * driven by the player's state, view only. `cameraPlayer(entity)` reads what they need off the player actor's
 * components (`actor`, and `motion` on the shooter model) after a sim step; `createCameraEffects()` keeps their
 * springs and phases: `step(player)` once a sim step (a landing, a jump or a mantle's grab kicks the view), `frame(dt,
 * view)` once a rendered frame gives an `EffectsFrame`, and `applyEffects(pose, frame, weights)` puts it on a camera's
 * pose, each part scaled by that camera's `EffectWeights` (first person takes them all; the shooter its lens, half the
 * roll and the punch; the platformer a little punch).
 *
 * The effects (`EFFECTS` holds the numbers):
 * - the sprint lowers the eye `sprintDrop` and rolls up to `sprintRoll` into a turn of `sprintTurn` rad/s or faster;
 * - a boosted slide (its boost not yet taken back) widens the lens ×`slideFov` and rolls up to `slideRoll` toward a
 *   slide across the view;
 * - a jump kicks the view up, a landing down by its speed, a mantle's grab down a little (`punch`, a damped spring);
 * - the bob, one dip each `bob.period` at a run on the ground, a sway every two: the eye's, and its phase and share for
 *   the weapon (WP 13.12);
 * - aiming down sights zooms to the weapon's lens (Apex's rifles: 55° at a 70° lens) in `ads.time`, as `zoom`;
 * - a landing faster than `shake.from` shakes the screen (`frame.shake`, by the camera's share of the punch: the rig's
 *   `shake()`, which the view adds to engine/gfx/fx/shake.ts);
 * - `kick(pitch, yaw)`, a weapon's recoil (WP 13.20's firearms, through the rig's `kick`), on the punch's spring.
 * The drop, the rolls and the lens ease with a time constant of `ease`, so no effect cuts. `apexFov(h)` is the lens
 * Apex's slider makes (`h` horizontal degrees at 4:3), in the vertical degrees three.js takes.
 *
 * The eye on the shooter model stands Apex's heights over the feet (`CAMERA_EYE`: 1.52 m standing, 0.81 m crouched,
 * the duck's share between): the cameras' numbers until the sim needs the eye (WP 13.9's aim) and its profile holds
 * them (ADR-0025 amendment 8).
 *
 * Invariants: view only: it reads plain component data and never writes it; at rest (still, standing, not aiming,
 * nothing kicked) every part is 0 and `applyEffects` returns the pose it is given.
 *
 * @example
 * import { makePose } from './pose';
 * const effects = createCameraEffects();
 * const pose = makePose({ position: [0, 1.5, 0], fov: 74 });
 * applyEffects(pose, effects.frame(1 / 60, { yaw: 0 }), FIRST_EFFECTS) === pose; // true: at rest
 * apexFov(90); // 73.74…: Apex's 90 at 4:3, vertical
 * @see engine/gfx/cameras/effects.test.ts
 */
import { MathUtils } from '../../core/math';
import type { EntityData } from '../../sim/state';
import { makePose, poseRight, type CameraPose, type Vec3 } from './pose';

const DEG = MathUtils.DEG2RAD;

/** The effects' numbers (see the file comment): metres, radians, seconds. */
export const EFFECTS = Object.freeze({
  sprintDrop: 0.15,
  sprintRoll: 2 * DEG,
  sprintTurn: Math.PI,
  slideFov: 1.1,
  slideRoll: 15 * DEG,
  ease: 0.12,
  /** The spring (Hz, damping ratio); the kicks' peaks (rad): a landing's per m/s over `from`, at most `max`. */
  punch: Object.freeze({ frequency: 2.5, damping: 0.6, land: 0.4 * DEG, from: 3, max: 5 * DEG, jump: 1 * DEG, grab: 1.5 * DEG }), // prettier-ignore
  /** A dip each `period` s at `run` m/s or faster: `height` down, `side` across. */
  bob: Object.freeze({ period: 0.4, height: 0.012, side: 0.006, run: 5 }),
  /** The sights' lens (`fov` degrees at a lens of `at`) and the time to raise them. */
  ads: Object.freeze({ fov: 55, at: 70, time: 0.25 }),
  /** Metres of screen shake per m/s of a landing over `from`. */
  shake: Object.freeze({ from: 10, per: 0.004 }),
});

/** The eye's height over the feet on the shooter model, m: Apex's, standing and crouched. */
export const CAMERA_EYE = Object.freeze({ stand: 1.524, crouch: 0.8128 });

/** What the effects and the follow cameras read of the player after a sim step: plain data. */
export interface CameraPlayer {
  /** M/s. */
  readonly velocity: Vec3;
  readonly grounded: boolean;
  /** Its eye over its feet, m, on the shooter model (`CAMERA_EYE`, by its duck); absent without the model. */
  readonly eye?: number;
  /** The shooter model's mode (`ground`, `air`, `mantle`, `climb`, `zipline`, `ladder`, `skydive`); else by `grounded`. */
  readonly mode: string;
  readonly sprinting: boolean;
  readonly sliding: boolean;
  /** Its slide's boost is not yet taken back. */
  readonly boosted: boolean;
  /** It aims down sights. */
  readonly aiming: boolean;
}

/** How much of each effect a camera takes, 0 to 1 (see the file comment). */
export interface EffectWeights {
  /** The sprint's drop. */
  readonly eye: number;
  readonly bob: number;
  readonly roll: number;
  /** The slide's wider lens. */
  readonly fov: number;
  /** The punch and the kick. */
  readonly punch: number;
  /** The sights' zoom. */
  readonly aim: number;
}

/** First person's: every effect. */
export const FIRST_EFFECTS: EffectWeights = Object.freeze({ eye: 1, bob: 1, roll: 1, fov: 1, punch: 1, aim: 1 });
/** None: the views, the orbit, the free cameras. */
export const NO_EFFECTS: EffectWeights = Object.freeze({ eye: 0, bob: 0, roll: 0, fov: 0, punch: 0, aim: 0 });

/** One frame of the effects (see the file comment). */
export interface EffectsFrame {
  /** The eye lowered, m. */
  readonly drop: number;
  /** The eye's bob, m: across (right) and up. */
  readonly bob: readonly [number, number];
  /** The bob's phase (rad: a dip each 2π) and how much of it plays, 0 to 1: the weapon's. */
  readonly bobPhase: number;
  readonly bobShare: number;
  /** Rad, + tips the picture's top right. */
  readonly roll: number;
  /** × the lens. */
  readonly fov: number;
  /** The punch and the kick, rad: + up, + left. */
  readonly pitch: number;
  readonly yaw: number;
  /** How far the sights are raised, 0 to 1, and their zoom (× three.js's `zoom`). */
  readonly aim: number;
  readonly zoom: number;
  /** Metres to add to the screen shake. */
  readonly shake: number;
}

/** The lens (vertical degrees) of Apex's field of view `h`: horizontal degrees at 4:3. */
export function apexFov(h: number): number {
  return (2 * Math.atan(Math.tan(((h / 2) * Math.PI) / 180) * 0.75) * 180) / Math.PI;
}

/** How far a shooter model's duck has gone down, 0 standing to 1 crouched, from its `motion` (WP 13.5's duck). */
export function crouchShare(motion: Readonly<Record<string, unknown>>): number {
  const [left, total] = [Number(motion.duckLeft) || 0, Number(motion.duckTotal) || 0];
  if (motion.duck === 'ducked') return 1;
  if (motion.duck === 'ducking') return total > 0 ? MathUtils.clamp(1 - left / total, 0, 1) : 1;
  if (motion.duck === 'unducking') return total > 0 ? MathUtils.clamp(left / total, 0, 1) : 0;
  return 0;
}

/** What the cameras read of the player actor `entity` (`actor`, and `motion` on the shooter model); null for another. */
export function cameraPlayer(entity: EntityData, aiming = false): CameraPlayer | null {
  const actor = entity.actor as { vx?: number; vy?: number; vz?: number; grounded?: boolean } | undefined;
  if (!actor) return null;
  const velocity: Vec3 = [actor.vx ?? 0, actor.vy ?? 0, actor.vz ?? 0];
  const grounded = actor.grounded === true;
  const motion = entity.motion as Readonly<Record<string, unknown>> | undefined;
  if (!motion) {
    const mode = grounded ? 'ground' : 'air';
    return { velocity, grounded, mode, sprinting: false, sliding: false, boosted: false, aiming };
  }
  const eye = CAMERA_EYE.stand + (CAMERA_EYE.crouch - CAMERA_EYE.stand) * crouchShare(motion);
  const sliding = motion.sliding === true;
  const boosted = sliding && Number(motion.slideBoost) > 0;
  return { velocity, grounded, eye, mode: String(motion.mode), sprinting: motion.sprinting === true, sliding, boosted, aiming }; // prettier-ignore
}

/** The effects' state (see the file comment). */
export interface CameraEffects {
  /** Reads the player after a sim step: its landings, jumps and grabs kick the view. */
  step(player: CameraPlayer | null): void;
  /** Moves the effects on by a rendered frame of `dt` real seconds, the view looking along `view.yaw`; its frame. */
  frame(dt: number, view: { readonly yaw: number }): EffectsFrame;
  /** Kicks the view `pitch` rad up and `yaw` rad left, on the punch's spring: a weapon's recoil. */
  kick(pitch: number, yaw?: number): void;
  /** Back to rest. */
  reset(): void;
}

/** The effects' springs and phases (see the file comment). */
export function createCameraEffects(): CameraEffects {
  const { punch, bob, ads } = EFFECTS;
  const omega = 2 * Math.PI * punch.frequency;
  const zoomed = Math.tan(((ads.at / 2) * Math.PI) / 180) / Math.tan(((ads.fov / 2) * Math.PI) / 180);
  let player: CameraPlayer | null = null;
  let [sprint, boost, drop, roll, slideRoll, aim, phase, share, shake] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  let [pitch, pitchV, yaw, yawV] = [0, 0, 0, 0];
  let lastYaw: number | null = null;
  /** A kick whose spring peaks about `peak` rad. */
  const kick = (up: number, left = 0) => {
    pitchV += 2 * up * omega;
    yawV += 2 * left * omega;
  };
  return {
    step(next) {
      const was = player;
      player = next;
      if (!next || !was) return;
      if (next.grounded && !was.grounded) {
        const speed = Math.max(0, -was.velocity[1]);
        kick(-Math.min(punch.max, punch.land * Math.max(0, speed - punch.from)));
        shake += EFFECTS.shake.per * Math.max(0, speed - EFFECTS.shake.from);
      } else if (!next.grounded && was.grounded && next.velocity[1] > 1) kick(punch.jump);
      if (next.mode === 'mantle' && was.mode !== 'mantle') kick(-punch.grab);
    },
    frame(dt, view) {
      const k = 1 - Math.exp(-dt / EFFECTS.ease);
      const p = player;
      const turn = lastYaw === null || dt <= 0 ? 0 : Math.atan2(Math.sin(view.yaw - lastYaw), Math.cos(view.yaw - lastYaw)) / dt; // prettier-ignore
      lastYaw = view.yaw;
      sprint += ((p?.sprinting && p.grounded ? 1 : 0) - sprint) * k;
      boost += ((p?.boosted ? 1 : 0) - boost) * k;
      drop += (EFFECTS.sprintDrop * sprint - drop) * k;
      const turned = -MathUtils.clamp(turn / EFFECTS.sprintTurn, -1, 1) * EFFECTS.sprintRoll * sprint;
      roll += (turned - roll) * k;
      const v = p?.velocity ?? [0, 0, 0];
      const speed = Math.hypot(v[0], v[2]);
      const right = poseRight({ yaw: view.yaw });
      const across = speed > 1e-3 ? (v[0] * right[0] + v[2] * right[2]) / speed : 0;
      slideRoll += (EFFECTS.slideRoll * across * boost - slideRoll) * k;
      aim = MathUtils.clamp(aim + (p?.aiming ? 1 : -1) * (dt / ads.time), 0, 1);
      const stepping = p?.grounded && p.mode === 'ground' && !p.sliding ? Math.min(speed / bob.run, 1) : 0;
      share += (stepping - share) * k;
      phase = share > 1e-4 ? (phase + (2 * Math.PI * dt) / bob.period) % (4 * Math.PI) : 0;
      for (let left = dt; left > 1e-9; left -= 1 / 240) {
        const h = Math.min(left, 1 / 240);
        pitchV += (-omega * omega * pitch - 2 * punch.damping * omega * pitchV) * h;
        yawV += (-omega * omega * yaw - 2 * punch.damping * omega * yawV) * h;
        [pitch, yaw] = [pitch + pitchV * h, yaw + yawV * h];
      }
      const shaken = shake;
      shake = 0;
      const raise = MathUtils.smoothstep(aim, 0, 1);
      return {
        drop,
        bob: [bob.side * Math.sin(phase / 2) * share, (-bob.height * (1 - Math.cos(phase)) * share) / 2],
        bobPhase: phase,
        bobShare: share,
        roll: roll + slideRoll,
        fov: 1 + (EFFECTS.slideFov - 1) * boost,
        pitch,
        yaw,
        aim,
        zoom: 1 + (zoomed - 1) * raise,
        shake: shaken,
      };
    },
    kick,
    reset() {
      player = null;
      lastYaw = null;
      [sprint, boost, drop, roll, slideRoll, aim, phase, share, shake] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      [pitch, pitchV, yaw, yawV] = [0, 0, 0, 0];
    },
  };
}

/** Whether `x` is too small to move a camera. */
const still = (x: number) => Math.abs(x) < 1e-9;

/** `pose` with the effects of `frame` on it, each part scaled by `weights` (see the file comment). */
export function applyEffects(pose: CameraPose, frame: EffectsFrame, weights: EffectWeights): CameraPose {
  const drop = frame.drop * weights.eye;
  const [across, up] = [frame.bob[0] * weights.bob, frame.bob[1] * weights.bob];
  const [pitch, yaw, roll] = [frame.pitch * weights.punch, frame.yaw * weights.punch, frame.roll * weights.roll];
  const fov = 1 + (frame.fov - 1) * weights.fov;
  const zoom = 1 + (frame.zoom - 1) * weights.aim;
  if ([drop, across, up, pitch, yaw, roll, fov - 1, zoom - 1].every(still)) return pose;
  const right = poseRight(pose);
  const [x, y, z] = pose.position;
  return makePose({
    ...pose,
    position: [x + right[0] * across, y - drop + up, z + right[2] * across],
    yaw: pose.yaw + yaw,
    pitch: MathUtils.clamp(pose.pitch + pitch, -Math.PI / 2, Math.PI / 2),
    roll: MathUtils.clamp(pose.roll + roll, -Math.PI / 2, Math.PI / 2),
    fov: MathUtils.clamp(pose.fov * fov, 1, 179),
    zoom: pose.zoom * zoom,
  });
}
