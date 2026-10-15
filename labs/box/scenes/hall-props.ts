/**
 * @file The hall with its props, Box 3 (PLAN.md §9.0, WP 4.6): the hall with a hero (labs/box/scenes/hall.ts) and its
 * props, standing in the scene through `spawnProp` (their bodies in the physics world, the page drawing them through
 * the instanced prop meshes): the level's own, a brazier's fire on each of its 30 stands (`levelProps`), and
 * `box.hallProps.count` crates and barrels, 10 to 300, on the first of `HALL_SPOTS`. The hero pushes them by walking
 * into them (the controller shares his momentum with what he walks into) and shoves with `attack` (the third-person
 * map's J, the left mouse button, the pad's west button): every prop within `SHOVE.reach` of him, in the arc
 * `SHOVE.half` either side of where he faces and level with him, is hit (`hitProp`: its hook knocks a crate or a
 * barrel away from him, each twist drawn from the sim stream `knock`), and he thrusts both hands forward for
 * `SHOVE.time` (his animator's pose `cast`), before he can shove again.
 *
 * `HALL_SPOTS` are carried from the prototype's (`my-3d2dge:src/stress-world/20-sim.js:141-171`, `PROP_SPOTS`): 300
 * spots chosen once from a fixed seed (21, never the run's), each in the middle half of a random floor or gallery tile
 * at least 2 tiles in from the walls, none within 3.75 m of the hero's start or 0.5 m of the dais's base; 60% are
 * crates, and every fifth spot, when it and the one before are both crates, stacks on that one (12.2 units up, a
 * jitter of a unit). Units are the prototype's sixteenths of a metre (PLAN.md Appendix C); yaw is drawn for every spot.
 * They are computed when the module loads, outside the sim's maths, so only exact operations (no `Math.hypot`) choose
 * them, and they are the same in Node and in every browser.
 *
 * Settings (`box.hallProps.*`, read when the scene starts, so they change play and go in replays): how many crates and
 * barrels stand. The hero's are the hall's (`box.hall.*`).
 *
 * Game code, sim-side: it imports only engine/sim-api.ts and the box's own files. Components: `hallSwing`, the hero's
 * shove (whose it is, its ticks left).
 *
 * Tests: labs/box/scenes/hall-props.test.ts, tests/replays/box-3-knock.replay.json (`node x replay
 * tests/replays/box-3-*.replay.json --browser page`), tests/e2e/box-hall.spec.ts, tests/e2e/parity.spec.ts.
 *
 * @example
 * // node x sim labs/box/scenes/hall-props --steps 600 --set box.hallProps.count=300
 * // http://127.0.0.1:5173/labs/box/?scene=hall-props&cam3=chase (J shoves)
 * HALL_SPOTS.length; // 300
 */
import {
  angDiff,
  defineComponent,
  defineScene,
  defineSettings,
  floorHeight,
  hitProp,
  levelProps,
  pressed,
  Rng,
  spawnProp,
  type ActorComponent,
  type AnimatorComponent,
  type PropPlacement,
  type ScenePropComponent,
  type World,
} from '../../../engine/sim-api';
import { HALL_LEVEL, HALL_START, setupHall } from './hall';
import { boxSounds } from '../sounds/events';

/** The prototype's units per metre (PLAN.md Appendix C). */
const UNITS = 16;

/** The scene's settings: how many crates and barrels. */
export const HALL_PROPS_SETTINGS = defineSettings({
  'box.hallProps.count': {
    type: 'integer',
    default: 100,
    minimum: 10,
    maximum: 300,
    when: 'scene',
    description: 'How many crates and barrels stand in the hall, on the first of its seeded spots.',
  },
});

/** The 300 spots of the hall's crates and barrels (see the file comment), as placements on the floor or a stack. */
export const HALL_SPOTS: readonly PropPlacement[] = (() => {
  const rng = new Rng(21);
  const { cols, rows, map, tile } = HALL_LEVEL;
  const [cx, cz] = HALL_LEVEL.daises[0].center;
  const clear = HALL_LEVEL.daises[0].baseRadius + 8 / UNITS;
  const out: PropPlacement[] = [];
  for (let tries = 0; out.length < 300 && tries < 20000; tries++) {
    const [col, row] = [2 + Math.floor(rng.next() * (cols - 4)), 2 + Math.floor(rng.next() * (rows - 4))];
    if (!'.='.includes(map[row][col])) continue;
    const x = (col + 0.25 + rng.next() * 0.5) * tile;
    const z = (row + 0.25 + rng.next() * 0.5) * tile;
    const [sx, sz, dx, dz] = [x - HALL_START[0], z - HALL_START[2], x - cx, z - cz];
    const far = 60 / UNITS;
    if (sx * sx + sz * sz < far * far || dx * dx + dz * dz < clear * clear) continue; // exact everywhere
    const prop = rng.next() < 0.6 ? 'prop:crate' : 'prop:barrel';
    const last = out[out.length - 1];
    if (out.length % 5 === 4 && last?.prop === 'prop:crate' && prop === 'prop:crate') {
      const [jx, jz] = [((rng.next() - 0.5) * 2) / UNITS, ((rng.next() - 0.5) * 2) / UNITS];
      out.push({
        prop,
        at: [last.at[0] + jx, last.at[1] + 12.2 / UNITS, last.at[2] + jz],
        yaw: rng.next() * Math.PI * 2,
      });
    } else out.push({ prop, at: [x, floorHeight(HALL_LEVEL, x, z), z], yaw: rng.next() * Math.PI * 2 });
  }
  return out;
})();

/** The hero's shove: how far it reaches (m), how wide (rad either side), how high (m from his middle), how long (s). */
export const SHOVE = Object.freeze({ reach: 31 / UNITS, half: 1.35, height: 22 / UNITS, time: 0.3 });

/** The scene's own component: the hero's shove, whose it is and its ticks left. */
export const HALL_SWING = defineComponent('hallSwing', {
  description: 'The hero’s shove in the hall with its props: whose it is, and its ticks left (0: he may shove).',
  fields: {
    hero: { type: 'integer', default: -1, minimum: -1, description: 'The hero who shoves, by id.' },
    left: { type: 'integer', default: 0, minimum: 0, description: 'Ticks left of the shove.' },
  },
});

type Components = {
  actor: ActorComponent;
  animator: AnimatorComponent;
  hallSwing: { hero: number; left: number };
  sceneProp: ScenePropComponent;
};

/** Whether a shove from `hero` (his feet and heading) reaches the prop centred at `p` (see `SHOVE`). */
export function inShove(
  hero: Readonly<{ x: number; y: number; z: number; yaw: number }>,
  p: Readonly<{ x: number; y: number; z: number }>,
): boolean {
  const [dx, dz] = [p.x - hero.x, p.z - hero.z];
  if (Math.abs(p.y - (hero.y + 0.5)) >= SHOVE.height || Math.hypot(dx, dz) > SHOVE.reach) return false;
  return Math.abs(angDiff(hero.yaw, Math.atan2(dx, dz))) <= SHOVE.half;
}

/** The hero shoves: every prop his shove reaches is hit, from his feet (see the file comment); returns the ids hit. */
export function shove(w: World<Components>, hero: number): number[] {
  const { actor } = w.get(hero) as { actor: ActorComponent };
  const hit: number[] = [];
  for (const { id, sceneProp } of w.query('sceneProp')) {
    if (!inShove(actor, sceneProp)) continue;
    hitProp(w, id, [actor.x, actor.y, actor.z], { spin: w.rng('knock').range(-0.5, 0.5) });
    hit.push(id);
  }
  return hit;
}

/** The hall with its props. */
export const hallProps = defineScene<Components>('box:hall-props', {
  description:
    'Box 3: the hall and the hero with its props: a fire on every brazier, and crates and barrels he pushes and shoves.',
  level: 'level:hall',
  sounds: boxSounds(HALL_LEVEL),
  physics: true,
  setup(w) {
    w.spawn({ hallSwing: { hero: setupHall(w), left: 0 } });
    for (const placement of levelProps(HALL_LEVEL)) spawnProp(w, placement);
    const count = w.settings.get<number>('box.hallProps.count');
    for (const placement of HALL_SPOTS.slice(0, count)) spawnProp(w, placement);
  },
  step(w, intents) {
    for (const { hallSwing } of w.query('hallSwing')) {
      const { animator } = w.get(hallSwing.hero) as { animator: AnimatorComponent };
      if (hallSwing.left > 0 && --hallSwing.left === 0) delete animator.states.pose;
      if (hallSwing.left > 0 || !pressed(intents, 'attack')) continue;
      shove(w, hallSwing.hero);
      hallSwing.left = Math.round(SHOVE.time / w.dt);
      animator.states.pose = 'cast';
    }
  },
});

export default hallProps;
