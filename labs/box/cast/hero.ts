/**
 * @file The box's hero (PLAN.md §9.0, WP 3.10): who the player walks, dashes and jumps as from Box 2 on. `HERO` is
 * his character (engine/physics/character.ts's settings: the controller's capsule, his speeds and timings),
 * `HERO_BODY` his animator's make (engine/anim/character.ts: the build and what his right hand holds), and
 * `spawnHero(w, at, tuning)` spawns him as a player actor (engine/sim/actors.ts) with both, so the controller moves
 * him, the animator steps his body with the sim, and the page draws him as the neutral humanoid.
 *
 * His numbers are the stress test's hero (`my-3d2dge:src/stress-world/20-sim.js:29, 113, 242-301`), in SI units
 * (PLAN.md Appendix C: 16 units a metre), as starting values (§9.0: similar, not identical; tuning changes them
 * freely). Where the prototype set a value they override the controller's defaults (shardfall's); where it set none
 * (coyote time, the variable jump, the capsule, steps and snapping) the defaults stand:
 * - walk 80 u/s → 5 m/s; take-off 150 u/s → 9.375 m/s; gravity 480 u/s² → 30 m/s², so the apex is
 *   9.375² / (2 · 30) ≈ 1.46 m, enough to jump onto the room's 0.75 m low wall and not its 3 m walls;
 * - fall capped at 600 u/s → 37.5 m/s;
 * - one rate, 900 u/s² → 56.25 m/s², for speeding up, stopping and turning (the prototype's `approach`), and 420 u/s²
 *   in the air, a share of 420 / 900 of it;
 * - the dash: 260 u/s → 16.25 m/s for 0.2 s, then 0.45 s before the next (the prototype also eased the dash's
 *   speed down to half: the controller's dash keeps its speed, so it reaches 3.25 m where the prototype's reached
 *   2.7 m); a jump pressed up to 0.12 s before landing still jumps.
 *
 * His body: the default build (`build:chibi`, as the prototype's hero), empty-handed (`weapon: 'none'`).
 *
 * His fight (Box 5, WP 6.7): `HERO_FIGHT`, with a sword: his combo, the thrust out of a dash, his bolt, his hits.
 *
 * Game code, sim-side: it imports only engine/sim-api.ts.
 *
 * @example
 * HERO.speed; // 5: m/s
 * HERO.jumpSpeed ** 2 / (2 * HERO.characterGravity!); // 1.46…: the apex, m
 * heroCharacter({ speed: 6 }).speed; // 6: a scene's setting, over the hero's own
 * @see labs/box/cast/hero.test.ts
 */
import {
  createCharacter,
  spawnActor,
  type ActorSpec,
  type Character,
  type HitShape,
  type World,
} from '../../../engine/sim-api';

/** The prototype's units per metre (PLAN.md Appendix C). */
const UNITS = 16;

/** The hero's numbers as the prototype wrote them, in its units and seconds (see the file comment). */
export const PROTOTYPE = Object.freeze({
  speed: 80,
  jump: 150,
  gravity: 480,
  maxFall: 600,
  acceleration: 900,
  airAcceleration: 420,
  dashSpeed: 260,
  dashTime: 0.2,
  dashCooldown: 0.45,
  buffer: 0.12,
});

/** What a scene may tune of the hero: his walk, take-off and dash speeds, m/s. */
export interface HeroTuning {
  speed?: number;
  jumpSpeed?: number;
  dashSpeed?: number;
}

/** The hero's character with `tuning` over his own numbers. Throws `CORE_BAD_SPEC` for a value out of range. */
export function heroCharacter(tuning: HeroTuning = {}): Character {
  const p = PROTOTYPE;
  const rate = p.acceleration / UNITS;
  return createCharacter({
    speed: tuning.speed ?? p.speed / UNITS,
    jumpSpeed: tuning.jumpSpeed ?? p.jump / UNITS,
    characterGravity: p.gravity / UNITS,
    maxFall: p.maxFall / UNITS,
    acceleration: rate,
    deceleration: rate,
    skid: rate,
    feel: {
      buffer: p.buffer,
      airControl: p.airAcceleration / p.acceleration,
      dash: { speed: tuning.dashSpeed ?? p.dashSpeed / UNITS, duration: p.dashTime, cooldown: p.dashCooldown },
    },
  });
}

/** The hero's character, untuned. */
export const HERO: Character = heroCharacter();

/** The hero's animator: the default build, empty-handed. */
export const HERO_BODY = Object.freeze({ build: 'build:chibi', weapon: 'none' }) satisfies ActorSpec['anim'];

/** Spawns the hero, the player, with his feet at `at` facing `yaw` (rad); returns his id. */
export function spawnHero<C extends object>(
  w: World<C>,
  at: readonly [number, number, number],
  yaw = 0,
  tuning: HeroTuning = {},
): number {
  return spawnActor(w, { at: [...at], character: heroCharacter(tuning), player: true, yaw, anim: { ...HERO_BODY } });
}

/** What one of the hero's hits does: its cone, hit points, push (m/s), lunge (m/s) and whether it is a big one. */
export interface HeroHit {
  readonly shape: HitShape;
  readonly damage: number;
  readonly knockback: number;
  readonly push: number;
  readonly big: boolean;
}

/** One of the prototype's hits (`HIT`): reach and push in its units, width in rad; from his feet to 1.5 m up. */
const hit = (range: number, halfAngle: number, damage: number, knockback: number, push: number, big = false) =>
  Object.freeze({
    shape: Object.freeze({ range: range / UNITS, halfAngle, yMin: 0, yMax: 24 / UNITS }),
    damage,
    knockback: knockback / UNITS,
    push: push / UNITS,
    big,
  }) satisfies HeroHit;

/**
 * The hero's fight (Box 5, WP 6.7), with a sword. Attack runs his combo, a slash, a backslash and a spin, each press
 * within `window` of the last hit's end flowing into the next; out of a dash it is the thrust instead, cutting the
 * dash. Each hit lands on what its cone holds (`hits`): the prototype's ranges and widths, wider than the blade's
 * measured sweep (engine/anim/moves.ts `measureMove`: a slash's tip reaches 1.13 m), so the walkers waiting on their
 * ring round him are in reach, and from his feet to 1.5 m up, so a slash meets a wisp hovering at his head as well as
 * a slime at his knees. A hit takes its hit points and pushes the body away; the big ones (the spin, the thrust) throw
 * it up a little and stop time a moment longer; one that kills throws the body up (`kill`: high after a big one) and
 * on with its push. He lunges into each strike (`push`). Skill fires a bolt ahead of him (`bolt`). A foe's blow
 * flinches him, pushes him away, and then he cannot be hit for a moment (`hurt`). The numbers are the prototype's
 * (`my-3d2dge:src/stress-world/20-sim.js:107-112, 134-135, 268-274, 303-316, 324-342`: `HIT`, the combo, the thrust,
 * `hurtHero`, `fireBolt`, `damageEnemy`), in metres and seconds, as starting values.
 */
export const HERO_FIGHT = Object.freeze({
  /** What his right hand holds. */
  weapon: 'sword',
  /** His combo's moves, in order, and how long after a hit ends a press still flows into the next (s). */
  combo: Object.freeze(['move:slash', 'move:backslash', 'move:spin']),
  window: 0.3,
  /** The move attack runs out of a dash. */
  thrust: 'move:thrust',
  /** What each move's hit does, by move. */
  hits: Object.freeze<Record<string, HeroHit>>({
    'move:slash': hit(27, 1.35, 12, 130, 70),
    'move:backslash': hit(27, 1.35, 12, 130, 70),
    'move:spin': hit(34, Math.PI, 22, 230, 40, true),
    'move:thrust': hit(38, 0.45, 20, 220, 130, true),
  }),
  /** A big hit's throw (m/s up), a killing hit's (small and big) and how much faster across the ground it goes. */
  launch: 70 / UNITS,
  kill: Object.freeze({ small: 95 / UNITS, big: 170 / UNITS, carry: 1.3 }),
  /** The hit-stop a hit asks for (s), small and big. */
  stop: Object.freeze({ small: 0.045, big: 0.06 }),
  /** His bolt: speed (m/s), life (s), hit points, push (m/s), radius (m), start (m ahead, up), how often (s), his cast (s). */
  bolt: Object.freeze({
    speed: 260 / UNITS,
    life: 1.2,
    damage: 9,
    knockback: 70 / UNITS,
    radius: 3 / UNITS,
    ahead: 8 / UNITS,
    up: 11 / UNITS,
    cooldown: 0.3,
    cast: 0.18,
  }),
  /** His hit points. */
  health: 100,
  /** When a foe hits him: his flinch (s), the push (m/s), the time he cannot be hit after (s), the hit-stop (s). */
  hurt: Object.freeze({ flinch: 0.22, knockback: 170 / UNITS, safe: 0.8, stop: 0.05 }),
});
