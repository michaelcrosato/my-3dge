/**
 * @file The steps fixture scene (PLAN.md WP 3.2): a course for the character controller, built by a scene script
 * because the level's stairs arrive in WP 4.2. Lanes run east (+X) on an 80 m wide floor (x 0 to 80, z 0 to 100,
 * no gaps), each starting at `x0` on the ground at its `z`:
 *
 * - `oneBox`: a floor that is one box (z 0 to 4); `merged`: 1 m tiles (z 4 to 8), 320 boxes in one body as level
 *   bodies are, the lane on a seam; beyond z 8, one slab under the rest;
 * - `steps`: one step per height in `STEP_HEIGHTS` (5 cm to 40 cm), its face at x 6;
 * - `slopes`: one ramp per angle in `SLOPE_ANGLES` (20° to 60°), from x 6 up to a plateau 2 m on;
 * - `ledge`: a platform 1.5 m high to walk off (coyote time), its edge at x 8;
 * - `oneWay`: a platform whose top is 2 m up (room to stand under it), solid only from above;
 * - `crate`: a 20 kg crate (0.6 m) to push, at x 6; `platform`: a kinematic slab moving east at 2 m/s;
 * - `wall`: a wall 4 m high, its face at x 8, to wall-jump from.
 *
 * The scene `steps` builds it and spawns `HERO` on the one-box floor; intents drive it (`move`, `jump`, `dash`). The
 * moving slab is a `shuttle`: a system in the phase `ai` (before the actors move) turns it round every 2 s.
 * `HERO` holds the box hero's starting values (PLAN.md Appendix C: the stress test's capsule and controller, walk 5
 * m/s, jump 9.375 m/s under 30 m/s², the dash 16.25 m/s for 0.2 s every 0.45 s), the rest shardfall's defaults.
 *
 * Game code: it imports only engine/sim-api.ts. Tests: engine/physics/character.test.ts and feel.test.ts drive the
 * controller over `buildCourse`; fixtures/scenes/steps/index.test.ts runs the scene. Try it:
 * `node x sim fixtures/scenes/steps --feel`.
 */
import {
  createCharacter,
  defineComponent,
  defineScene,
  physicsOf,
  spawnActor,
  type Physics,
  type World,
} from '../../../engine/sim-api';

/** The step heights of the `steps` lanes (m). */
export const STEP_HEIGHTS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4] as const;

/** The ramp angles of the `slopes` lanes (degrees). */
export const SLOPE_ANGLES = [20, 30, 40, 45, 50, 55, 60] as const;

/** The box hero's starting values (PLAN.md Appendix C); WP 3.10 tunes the box's own. */
export const HERO = createCharacter({
  capsule: { radius: 0.28125, height: 1.125 },
  offset: 0.01875,
  snap: 0.25,
  autostep: { height: 0.3, width: 0.125, dynamic: false },
  maxSlope: (50 * Math.PI) / 180,
  speed: 5,
  jumpSpeed: 9.375,
  characterGravity: 30,
  feel: { dash: { speed: 16.25, duration: 0.2, cooldown: 0.45 } },
});

/** A lane: where to start walking east, on the ground at `z`. */
export interface Lane {
  x0: number;
  y0: number;
  z: number;
}

/** The course's lanes and bodies. */
export interface Course {
  oneBox: Lane;
  merged: Lane;
  steps: Lane[];
  slopes: Lane[];
  ledge: Lane;
  oneWay: Lane & { body: number; top: number };
  crate: Lane & { body: number };
  platform: Lane & { body: number };
  wall: Lane;
}

/** A fixed box of `size` centred at `at`, as a collider. */
const box = (
  size: [number, number, number],
  at: [number, number, number],
  rotation?: [number, number, number, number],
) => ({
  shape: { type: 'box' as const, size },
  position: at,
  ...(rotation ? { rotation } : {}),
});

/** Builds the course in `physics` (in a fixed order, so the same ids every time) and returns its lanes. */
export function buildCourse(physics: Physics): Course {
  const lane = (z: number, x0 = 2, y0 = 0): Lane => ({ x0, y0, z });
  physics.addBody({ type: 'fixed', colliders: [box([80, 1, 4], [40, -0.5, 2])] });
  const tiles = [];
  for (let i = 0; i < 80; i++) for (let j = 0; j < 4; j++) tiles.push(box([1, 1, 1], [i + 0.5, -0.5, 4.5 + j]));
  physics.addBody({ type: 'fixed', colliders: tiles });
  const ground = [box([80, 1, 92], [40, -0.5, 54])];
  const steps = STEP_HEIGHTS.map((h, i) => {
    ground.push(box([4, h, 2], [8, h / 2, 12 + 3 * i]));
    return lane(12 + 3 * i);
  });
  const slopes = SLOPE_ANGLES.map((degrees, j) => {
    const [z, angle, run] = [37 + 4 * j, (degrees * Math.PI) / 180, 2];
    const [rise, length, thick] = [run * Math.tan(angle), run / Math.cos(angle), 0.4];
    const centre: [number, number, number] = [
      6 + run / 2 + (thick / 2) * Math.sin(angle),
      rise / 2 - (thick / 2) * Math.cos(angle),
      z,
    ];
    ground.push(box([length, thick, 3], centre, [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)]));
    ground.push(box([4, rise, 3], [6 + run + 2, rise / 2, z]));
    return lane(z);
  });
  ground.push(box([6, 1.5, 3], [5, 0.75, 66]));
  ground.push(box([1, 4, 6], [8.5, 2, 88]));
  physics.addBody({ type: 'fixed', colliders: ground });
  const oneWay = physics.addBody({ type: 'fixed', colliders: [box([4, 0.2, 3], [8, 1.9, 71])] });
  const crate = physics.addBody({
    position: [6, 0.3, 76],
    colliders: [{ shape: { type: 'box', size: [0.6, 0.6, 0.6] }, density: 20 / 0.216, friction: 0.5 }],
  });
  const platform = physics.addBody({
    type: 'kinematic',
    position: [4, 0.2, 82],
    velocity: [2, 0, 0],
    colliders: [box([3, 0.4, 3], [0, 0, 0])],
  });
  return {
    oneBox: lane(2),
    merged: lane(6),
    steps,
    slopes,
    ledge: lane(66, 3, 1.5),
    oneWay: { ...lane(71), body: oneWay, top: 2 },
    crate: { ...lane(76), body: crate },
    platform: { ...lane(82, 4, 0.4), body: platform },
    wall: lane(88),
  };
}

/** The fixture's component: a kinematic body driven back and forth along X. */
export const SHUTTLE = defineComponent('shuttle', {
  description: 'A kinematic body of the steps fixture, moving at speed along X and turning round every period.',
  fields: {
    body: { type: 'integer', default: -1, minimum: -1, description: 'The body it drives.' },
    speed: { type: 'number', default: 2, unit: 'm/s', description: 'Its speed.' },
    ticks: { type: 'integer', default: 120, minimum: 1, description: 'Steps between turns.' },
  },
});

type Components = { shuttle: { body: number; speed: number; ticks: number } };

/** Movers set their velocities before the actors move (the phase `ai`). */
function shuttle(w: World<Components>): void {
  for (const { shuttle: s } of w.query('shuttle')) {
    const out = Math.floor((w.tick - 1) / s.ticks) % 2 === 0;
    physicsOf(w).setBody(s.body, { velocity: [out ? s.speed : -s.speed, 0, 0] });
  }
}

export default defineScene<Components>('steps', {
  description:
    'A course for the character controller: one-box and tiled floors, steps of 5 to 40 cm, ramps of 20° to 60°, a ledge, a one-way platform, a crate, a moving slab and a wall; the box hero walks it by intents.',
  physics: true,
  setup(w) {
    const course = buildCourse(physicsOf(w));
    w.spawn({ shuttle: { body: course.platform.body } });
    w.systems.add('shuttle', shuttle, { phase: 'ai' });
    spawnActor(w, { at: [course.oneBox.x0, 0, course.oneBox.z], character: HERO });
  },
});
