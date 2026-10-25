/**
 * @file The playground's player (docs/PLAYGROUND.md §3, PLAN.md WP 13.1–13.3): the character the keys move, the body
 * it is drawn as, and `spawnPlayer`, which stands it in a scene. It moves as in Apex Legends, on the profile
 * `movement:apex` (engine/physics/movement/profiles.ts): a medium legend's hull (1.83 m tall, 0.41 m in radius), its
 * steps, slopes, gravity and jump, and the shooter model at Apex's numbers (docs/PLAYGROUND.md §3.2). It starts
 * empty-handed, so holstered: every gait 1.15 times faster than with a weapon out. A scene may give it weapons to
 * carry (`weapons`, WP 13.20: the site's the pistol and the rifle, labs/playground/weapons/guns.ts), holstered until
 * drawn. It is drawn as `body:player` (labs/playground/bodies/player.ts, which the page registers) on `build:adult`,
 * 1.80 m standing. The setting `playground.movement` (the settings screen's movement profile, WP 13.25) moves it as the
 * Stress Box hero instead (`movement:platformer`, its feel exactly, untuned); it is read when the scene starts.
 *
 * Game code, sim-side: it imports only engine/sim-api.ts.
 *
 * @example
 * playerCharacter().characterGravity; // 19.05: m/s², Apex's 750 units/s²
 * playerCharacter().movement?.gaits.sprint; // 6.604: m/s with a weapon out, 260 units/s
 * playerCharacter({ speed: 5 }).movement?.gaits.run; // 5
 * @see labs/playground/scenes/gym.test.ts
 */
import {
  createCharacter,
  defineSettings,
  getMovement,
  spawnActor,
  weaponsFor,
  type Character,
  type World,
} from '../../../engine/sim-api';

/** The profiles the player may move by: Apex's, the default, and the Stress Box hero's. */
export const PLAYER_MOVEMENTS = ['movement:apex', 'movement:platformer'] as const;

/** The player's setting (see the file comment). */
export const PLAYER_SETTINGS = defineSettings({
  'playground.movement': {
    type: 'string',
    enum: [...PLAYER_MOVEMENTS],
    default: 'movement:apex',
    when: 'scene',
    description:
      "The profile the playground's player moves by (labs/playground/cast/player.ts): Apex Legends' movement as tuned, or the Stress Box hero's platformer feel (engine/physics/movement/profiles.ts); read when the scene starts.",
  },
});

/** The profile the player moves by. */
const APEX = getMovement('movement:apex');

/** Apex's gravity (m/s²): 750 units/s², an inch a unit (docs/PLAYGROUND.md §3.2). */
export const APEX_GRAVITY = APEX.character.characterGravity as number;

/** Apex's jump (m): 56 units. */
export const APEX_JUMP = Math.pow(APEX.character.jumpSpeed as number, 2) / (2 * APEX_GRAVITY);

/** Apex's run with a weapon out (m/s): 173.5 units/s; holstered, the player runs 1.15 times as fast. */
export const APEX_RUN = APEX.model!.gaits.run;

/** How the player is drawn: `body:player` on the adult build, empty-handed. */
export const PLAYER_LOOK = Object.freeze({ body: 'body:player', build: 'build:adult', weapon: 'none' });

/** What a scene may tune: the run with a weapon out (m/s) and the jump's height (m); and the profile, Apex's by default. */
export interface PlayerTuning {
  readonly speed?: number;
  readonly jump?: number;
  readonly movement?: (typeof PLAYER_MOVEMENTS)[number];
}

/**
 * The player's character: `movement:apex`, its run and its jump's height (a take-off of √(2 g h)) as tuned; on
 * another profile, that profile's own character, the tuning unused.
 */
export function playerCharacter(tuning: PlayerTuning = {}): Character {
  if (tuning.movement && tuning.movement !== 'movement:apex') return createCharacter({ movement: tuning.movement });
  const run = tuning.speed ?? APEX_RUN;
  const jump = tuning.jump ?? APEX_JUMP;
  return createCharacter({
    movement: 'movement:apex',
    speed: run,
    jumpSpeed: Math.sqrt(2 * APEX_GRAVITY * jump),
    model: { gaits: { run } },
  });
}

/**
 * Stands the player in `w` (a scene with physics) at `at`, facing `yaw`: an actor the step's intents move, carrying
 * `weapons` (ids, in slot order; none by default), holstered.
 */
export function spawnPlayer<C extends object>(
  w: World<C>,
  at: readonly [number, number, number],
  yaw = 0,
  tuning: PlayerTuning = {},
  weapons: readonly string[] = [],
): number {
  const movement = tuning.movement ?? (w.settings.get<string>('playground.movement') as PlayerTuning['movement']);
  const character = playerCharacter({ ...tuning, movement });
  const { body, build, weapon } = PLAYER_LOOK;
  const components: Record<string, object> = weapons.length ? { weapons: weaponsFor(weapons) } : {};
  return spawnActor(w, { at: [at[0], at[1], at[2]], character, player: true, yaw, body, anim: { build, weapon }, components }); // prettier-ignore
}
