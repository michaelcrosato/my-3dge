/**
 * @file The playground's player (docs/PLAYGROUND.md §3, PLAN.md WP 13.1, WP 13.2): the character the keys move, the
 * body it is drawn as, and `spawnPlayer`, which stands it in a scene. Until WP 13.3 gives the playground Apex's
 * movement model (`movement:apex`), the player runs on today's character controller with four of Apex's numbers
 * (docs/PLAYGROUND.md §3.2): its gravity, its jump's height, its run speed and its hull, a capsule 1.83 m tall and
 * 0.41 m in radius, so the gym's heights and gaps already read as they will. It is drawn as `body:player`
 * (labs/playground/bodies/player.ts, which the page registers) on `build:adult`, 1.80 m standing.
 *
 * Game code, sim-side: it imports only engine/sim-api.ts.
 *
 * @example
 * playerCharacter().characterGravity; // 19.05: m/s², Apex's 750 units/s²
 * playerCharacter().jumpSpeed; // 7.355…: m/s at take-off, 1.42 m up
 * playerCharacter().capsule; // { radius: 0.41, height: 1.01 }: 1.83 m standing
 * @see labs/playground/scenes/gym.test.ts
 */
import { createCharacter, spawnActor, type Character, type World } from '../../../engine/sim-api';

/** Apex's gravity (m/s²): 750 units/s², an inch a unit (docs/PLAYGROUND.md §3.2). */
export const APEX_GRAVITY = 19.05;

/** Apex's jump (m): 56 units. */
export const APEX_JUMP = 1.42;

/** Apex's run with a weapon out (m/s): 173.5 units/s. */
export const APEX_RUN = 4.41;

/** Apex's hull for its medium legends (m): 72 units standing and 32 across, as a capsule (docs/PLAYGROUND.md §3.2). */
export const APEX_CAPSULE = Object.freeze({ radius: 0.41, height: 1.83 - 2 * 0.41 });

/** How the player is drawn: `body:player` on the adult build, empty-handed. */
export const PLAYER_LOOK = Object.freeze({ body: 'body:player', build: 'build:adult', weapon: 'none' });

/** What a scene may tune: the run speed (m/s) and the jump's height (m). */
export interface PlayerTuning {
  readonly speed?: number;
  readonly jump?: number;
}

/** The player's character: Apex's gravity, a take-off of √(2 g h) for the jump's height, the run speed. */
export function playerCharacter(tuning: PlayerTuning = {}): Character {
  const jump = tuning.jump ?? APEX_JUMP;
  return createCharacter({
    speed: tuning.speed ?? APEX_RUN,
    jumpSpeed: Math.sqrt(2 * APEX_GRAVITY * jump),
    characterGravity: APEX_GRAVITY,
    capsule: { ...APEX_CAPSULE },
  });
}

/** Stands the player in `w` (a scene with physics) at `at`, facing `yaw`: an actor the step's intents move. */
export function spawnPlayer<C extends object>(
  w: World<C>,
  at: readonly [number, number, number],
  yaw = 0,
  tuning: PlayerTuning = {},
): number {
  const character = playerCharacter(tuning);
  const { body, build, weapon } = PLAYER_LOOK;
  return spawnActor(w, { at: [at[0], at[1], at[2]], character, player: true, yaw, body, anim: { build, weapon } });
}
