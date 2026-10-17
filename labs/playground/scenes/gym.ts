/**
 * @file The gym, `playground:gym` (docs/PLAYGROUND.md §2.3, PLAN.md WP 13.1): the playground's first scene, the
 * calibrated features of labs/playground/levels/gym.ts as a physics level, and the player (labs/playground/cast/
 * player.ts) at the spawn `@` at its north end, facing the features to the south. The step's intents move the player
 * by Apex's model (`movement:apex`): `move` runs, `jump` jumps, `sprint` sprints (held, or a press that keeps it),
 * `walk` walks and `crouch` crouch-walks.
 *
 * Settings (`playground.gym.*`, read when the scene starts, so they change play and go in replays): the player's run
 * speed and jump height, Apex's by default (docs/PLAYGROUND.md §3.2). Its dev action `place` (`{ at, yaw, speed }`)
 * puts the player somewhere, at rest or moving `speed` m/s where it faces: where a feel course
 * (labs/playground/courses/) starts. The crawl's slab and bar stand on their walls and posts as fixed props.
 *
 * The level's text is computed from the gym's features (labs/playground/levels/gym.ts), so sim-side code reads no
 * file; the page registers the same text for the view (labs/playground/main.ts).
 *
 * Game code, sim-side: it imports only engine/sim-api.ts and the playground's own files.
 *
 * @example
 * // node x sim labs/playground/scenes/gym --steps 600 --feel
 * // node x shot labs/playground --scene gym --cam iso
 * GYM_START; // [20.25, 0, 3.25]: the spawn, at the gym's north end
 * @see labs/playground/scenes/gym.test.ts
 */
import { addLevelBodies, compileLevel, defineScene, defineSettings, physicsOf, placeActor, spawnProp, type ActorComponents } from '../../../engine/sim-api'; // prettier-ignore
import { APEX_JUMP, APEX_RUN, spawnPlayer } from '../cast/player';
import { GYM_PROPS, GYM_TEXT } from '../levels/gym';

/** The gym, compiled: its colliders for the physics, its tiles and spawn for the scene. */
export const GYM = compileLevel(GYM_TEXT, { file: 'labs/playground/levels/gym.ts', name: 'gym' });

/** Where the player starts: the spawn `@` the gym's map marks. */
export const GYM_START = GYM.spawns.find((spawn) => spawn.name === 'hero')!.position;

/** The gym's settings: each reachable through `x set`, URL parameters and `__engine.set`. */
export const GYM_SETTINGS = defineSettings({
  'playground.gym.speed': {
    type: 'number',
    default: APEX_RUN,
    minimum: 1,
    maximum: 20,
    unit: 'm/s',
    when: 'scene',
    description:
      "The player's run speed in the gym with a weapon out: Apex's by default; empty-handed it is 1.15 times faster.",
  },
  'playground.gym.jump': {
    type: 'number',
    default: APEX_JUMP,
    minimum: 0.1,
    maximum: 5,
    unit: 'm',
    when: 'scene',
    description: "How high the player jumps in the gym: Apex's 1.42 m by default.",
  },
});

/** The gym: its features, and the player at its north end. */
export const gym = defineScene('playground:gym', {
  description:
    "The playground's gym: calibrated features to measure the player's movement against (docs/PLAYGROUND.md §2.3).",
  level: 'level:gym',
  physics: true,
  setup(w) {
    addLevelBodies(physicsOf(w), GYM);
    const speed = w.settings.get<number>('playground.gym.speed');
    const jump = w.settings.get<number>('playground.gym.jump');
    spawnPlayer(w, [GYM_START[0], GYM_START[1], GYM_START[2]], 0, { speed, jump }); // first: the player is entity 1
    for (const { prop, at, yaw } of GYM_PROPS) spawnProp(w, { prop, at: [...at], yaw });
  },
  actions: {
    /** Puts the player at `at`, facing `yaw`, at rest or moving `speed` m/s that way: a feel course's start. */
    place(w, args) {
      const { at, yaw = 0, speed = 0 } = (args ?? {}) as { at?: [number, number, number]; yaw?: number; speed?: number }; // prettier-ignore
      const player = (w.query('actor') as unknown as (ActorComponents & { id: number })[]).find((e) => e.actor.player);
      if (!player || !at) return;
      placeActor(w, player.id, at, yaw);
      [player.actor.vx, player.actor.vz] = [speed * Math.sin(yaw), speed * Math.cos(yaw)];
    },
  },
});

export default gym;
