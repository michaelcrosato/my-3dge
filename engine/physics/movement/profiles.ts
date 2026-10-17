/**
 * @file The movement profiles every game gets (PLAN.md WP 13.3, docs/PLAYGROUND.md §3.2), registered on the shared
 * registry when this module loads (engine/physics/character.ts loads it):
 * - `movement:apex`, Apex Legends' movement: its medium legends' hull, steps and slopes, gravity, jump and grace period,
 *   and the shooter model at its defaults, which are Apex's numbers (engine/physics/movement/model.ts). Its sources are
 *   er-apex's settings (`umiiii/er-apex`, `deps/er-apex-move/src/params.rs`: Fuse's, a medium legend) and an Apex
 *   console-variable dump (`240hz/ApexConfigs`), converted at 1 u = 0.0254 m.
 * - `movement:platformer`, the Stress Box hero's feel (a dash, a wall jump, a variable jump): the character controller's
 *   own defaults, so a character on it is the one `createCharacter()` makes, down to its hash.
 *
 * Invariants: data only; `movement:platformer` sets nothing.
 *
 * @example
 * import { getMovement } from './profile';
 * getMovement('movement:apex').character; // { capsule: { radius: 0.4064, height: 1.016 }, … }
 * @see engine/physics/movement/profile.test.ts
 */
import { registry as sharedRegistry } from '../../core/registry';
import { defineMovement, movementKind, type MovementSpec } from './profile';

/** Apex's gravity: 750 u/s². */
const GRAVITY = 19.05;

/** The profiles, by id. */
export const MOVEMENT_PROFILES: Readonly<Record<string, MovementSpec>> = {
  'movement:apex': {
    description:
      'Apex Legends: run 4.41 m/s, sprint 6.60 (×1.15 holstered), Quake air strafing, a 1.42 m jump with fatigue, the lurch, the bunny-hop cost and the fall stun, on a medium legend’s 1.83 m hull.',
    character: {
      capsule: { radius: 0.4064, height: 1.8288 - 2 * 0.4064 }, // 16 u wide, 72 u tall
      autostep: { height: 0.5588 }, // 22 u
      stepFrom: 'contact', // a slide or a sprint steps up a stair, never stopping dead at it
      stayOnGround: true, // over a ramp's crest it keeps to the ground, as Source's StayOnGround snaps it
      maxSlope: 0.7953988301841436, // acos(0.7): walkable while the floor's normal is at least 0.7 up (45.57°)
      slideSlope: 0.7953988301841436,
      characterGravity: GRAVITY,
      maxFall: 88.9, // 3,500 u/s, Source's sv_maxvelocity: a 20 m fall lands at 28 m/s, so the full stun is reachable
      speed: 4.4069, // the run, for what reads the platformer fields (the feel meter's top speed)
      jumpSpeed: Math.sqrt(2 * GRAVITY * 1.4224), // a 56 u jump: 7.36 m/s
      feel: { coyote: 0.2, variableJump: 1, airControl: 0, dash: { speed: 0 } }, // jump_graceperiod; no cut, no dash
    },
    model: {},
  },
  'movement:platformer': {
    description:
      'The Stress Box hero: run 6 m/s with momentum and a skid, a 1.35 m variable jump with coyote time and a buffer, a dash, under 32 m/s² (the character controller’s defaults).',
  },
};

movementKind(sharedRegistry);
for (const [id, spec] of Object.entries(MOVEMENT_PROFILES)) {
  if (!sharedRegistry.has('movement', id)) defineMovement(id, spec);
}
