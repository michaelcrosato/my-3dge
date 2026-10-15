/**
 * @file The starter game's player: the character the keys move (the character controller's numbers: how it runs,
 * jumps and dashes) and the body it is drawn as, and `spawnPlayer`, which stands it in a scene. A game keeps its
 * cast here, one character a file, as the box keeps its hero, walkers, slimes and wisps (labs/box/cast/); its scenes
 * spawn them. `node x sim labs/game/scenes/play.ts --feel` measures how the player handles: response, top speed, the
 * jump's height and air time, the dash's reach.
 *
 * Game code, sim-side: it imports only engine/sim-api.ts.
 *
 * @example
 * playerCharacter(6).speed; // 6: m/s
 * playerCharacter(6).jumpSpeed; // 9: m/s at take-off, about 1.27 m up, over the arena's 0.75 m low walls
 * @see labs/game/scenes/play.ts
 */
import { createCharacter, spawnActor, type Character, type World } from '../../../engine/sim-api';

/** The player's take-off speed, m/s: about 1.27 m up under the controller's gravity, over a 0.75 m low wall. */
export const JUMP_SPEED = 9;

/** The body the player is drawn as: the humanoid in the chibi build, empty-handed. */
export const PLAYER_BODY = Object.freeze({ build: 'build:chibi', weapon: 'none' });

/** The player's character at `speed` m/s; createCharacter's defaults for the rest (its dash among them). */
export function playerCharacter(speed: number): Character {
  return createCharacter({ speed, jumpSpeed: JUMP_SPEED });
}

/** Stands the player in `w` (a scene with physics) at `at`, facing `yaw`: an actor the step's intents move. */
export function spawnPlayer<C extends object>(
  w: World<C>,
  at: readonly [number, number, number],
  speed: number,
  yaw = 0,
): number {
  const character = playerCharacter(speed);
  return spawnActor(w, { at: [at[0], at[1], at[2]], character, player: true, yaw, anim: { ...PLAYER_BODY } });
}
