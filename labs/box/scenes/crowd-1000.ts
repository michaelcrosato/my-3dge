/**
 * @file The crowd, Box 4 (PLAN.md §9.0, WP 5.7): the hall with a hero (labs/box/scenes/hall.ts) filling with
 * `box.crowd.count` walkers, slimes and wisps (labs/box/cast/{walker,slime,wisp}.ts) that chase him, round the walls and
 * pillars and up the stairs after him. `box:crowd-1000` is this file's scene; `box:crowd-100` and `box:crowd-5000`
 * (crowd-100.ts, crowd-5000.ts) are its presets for 100 and 5,000, and `setupCrowd(w)` is the setup they share.
 *
 * - **The crowd.** Each member is an entity with a crowd agent (`crowdMember`: CROWD_AGENT_FIELDS, its body in the
 *   physics world, engine/physics/crowd.ts) and its kind's own component (`crowdWalker`, `crowdSlime`, `crowdWisp`).
 *   Setup queues them all, drawn from the stream `spawn`: the kind by `box.crowd.mix` (mixed: half walkers, three in
 *   ten slimes, the rest wisps), then a spot on an open tile of the hall's floor (not the dais, the stairs or a
 *   gallery) at least `SPAWN.away` from the hero, within the middle of its tile. The crowd's queue lets at most
 *   `CROWD_LIMITS.spawnLimit` (25) bodies in a step, as shardfall's load ramps do, so 1,000 are in after 40 steps.
 * - **The chase** (the system `crowd.steer`, phase `ai`): the hero's feet and the flow field toward his tile on the
 *   crowd's grid (`CROWD_GRID`: the hall under the climb a crowd body manages, so the field leads up the stairs and never
 *   up a gallery's face), and each living member steered by its kind; the crowd's choices while it plays come from
 *   the stream `crowd`.
 * - **The crowd's step** (the system `crowd.update`, phase `readback`): `updateCrowd` (the queue, the readback, the
 *   grounded test over the hall's floor), the removed despawned, lost bodies rescued (`rescueLost`).
 *
 * Settings (`box.crowd.*`, read when the scene starts, so they change play and go in replays): how many (0 to 5,000;
 * the perf ladder sets it, tests/baselines/perf/box-crowd-1000.json) and the mix. The hero's are the hall's
 * (`box.hall.*`).
 *
 * Game code, sim-side: it imports only engine/sim-api.ts and the box's own files.
 *
 * Tests: labs/box/scenes/crowd-1000.test.ts, labs/box/cast/crowd.test.ts.
 *
 * @example
 * // node x sim labs/box/scenes/crowd-1000 --steps 600 --set box.crowd.mix=slimes
 * // node x perf labs/box --scene crowd-1000 --ladder
 * CROWD_TILES.length; // the hall's open floor tiles a member may start on
 */
import {
  CROWD_AGENT_FIELDS,
  NavGrid,
  Vector3,
  defineComponent,
  defineScene,
  defineSettings,
  floorHeight,
  physicsOf,
  rescueLost,
  setVelocity,
  updateCrowd,
  type CrowdAgent,
  type World,
} from '../../../engine/sim-api';
import { SLIME, makeSlime, steerSlime, type SlimeData } from '../cast/slime';
import { WALKER, makeWalker, steerWalker, type Chase, type WalkerData } from '../cast/walker';
import { WISP, makeWisp, steerWisp, type WispData } from '../cast/wisp';
import { HALL_LEVEL, HALL_START, setupHall } from './hall';

/** The crowd's settings: how many, and the mix. */
export const CROWD_SETTINGS = defineSettings({
  'box.crowd.count': {
    type: 'integer',
    default: 1000,
    minimum: 0,
    maximum: 5000,
    when: 'scene',
    description: 'How many walkers, slimes and wisps fill the hall: queued at the start, 25 entering a step.',
  },
  'box.crowd.mix': {
    type: 'string',
    enum: ['mixed', 'walkers', 'slimes', 'wisps'],
    default: 'mixed',
    when: 'scene',
    description: 'Who fills the hall: mixed (half walkers, three in ten slimes, two in ten wisps) or one kind alone.',
  },
});

/** A crowd mix: the share of walkers, and of walkers and slimes together; the rest are wisps. */
export const MIXES = Object.freeze({
  mixed: [0.5, 0.8],
  walkers: [1, 1],
  slimes: [0, 1],
  wisps: [0, 0],
} as const);

/** A member's crowd agent (engine/physics/crowd.ts): its body, its make and what the last readback saw. */
export const CROWD_MEMBER = defineComponent('crowdMember', {
  description: 'A member of the box’s crowd: its crowd agent (CROWD_AGENT_FIELDS); its kind is its other component.',
  fields: CROWD_AGENT_FIELDS,
});

/** The scene's components. */
export type CrowdComponents = {
  crowdMember: CrowdAgent;
  crowdWalker: WalkerData;
  crowdSlime: SlimeData;
  crowdWisp: WispData;
};

/**
 * The crowd's walkable grid: the hall under a climb of 6 cm, what a crowd body manages (Rapier 0.21 steps a capsule
 * up 7 cm and a ball 8.5 cm, measured in WP 5.2), so the stairs' gentle rise is walkable and their sides are not.
 */
export const CROWD_GRID = new NavGrid(HALL_LEVEL, { climb: 0.06 });

/** The tiles a member may start on: the hall's open floor, at height 0 (no dais, stairs or gallery). */
export const CROWD_TILES: readonly number[] = [...CROWD_GRID.open.keys()].filter(
  (i) => CROWD_GRID.open[i] && HALL_LEVEL.floor[i] === 0,
);

/** Where members start: at least `away` m from the hero (the prototype's 80 units), `tries` draws, `jitter` in a tile. */
export const SPAWN = Object.freeze({ away: 5, tries: 40, jitter: 0.3 });

/** The floor's height under (x, z), m. */
const floor = (x: number, z: number) => floorHeight(HALL_LEVEL, x, z);

/** Queues one member, drawn from the stream `spawn` (see the file comment). */
function queue(w: World<CrowdComponents>, mix: readonly [number, number]): void {
  const rng = w.rng('spawn');
  const roll = rng.next();
  const at = new Vector3();
  for (let k = 0; k < SPAWN.tries; k++) {
    CROWD_GRID.center(CROWD_TILES[rng.int(0, CROWD_TILES.length - 1)], at);
    at.x += rng.range(-SPAWN.jitter, SPAWN.jitter);
    at.z += rng.range(-SPAWN.jitter, SPAWN.jitter);
    const [dx, dz] = [at.x - HALL_START[0], at.z - HALL_START[2]];
    if (dx * dx + dz * dz >= SPAWN.away * SPAWN.away) break;
  }
  const feet = { x: at.x, y: floor(at.x, at.z), z: at.z };
  if (roll < mix[0]) {
    w.spawn({ crowdMember: { ...WALKER.agent, ...feet }, crowdWalker: makeWalker(rng, rng.range(-Math.PI, Math.PI)) });
  } else if (roll < mix[1]) {
    w.spawn({ crowdMember: { ...SLIME.agent, ...feet }, crowdSlime: makeSlime(rng) });
  } else {
    w.spawn({ crowdMember: { ...WISP.agent, ...feet }, crowdWisp: makeWisp(rng) });
  }
}

const wanted = new Vector3();

/** The system `crowd.steer`: every living member steered by its kind toward the hero (see the file comment). */
function steer(w: World<CrowdComponents>, hero: number): void {
  const actor = (w.get(hero) as { actor?: { x: number; y: number; z: number } } | undefined)?.actor;
  if (!actor) return;
  const physics = physicsOf(w);
  let cell = CROWD_GRID.cellAt(actor.x, actor.z);
  if (cell < 0 || !CROWD_GRID.open[cell]) cell = CROWD_GRID.nearestOpen(actor.x, actor.z);
  const chase: Chase = {
    hero: { x: actor.x, y: actor.y, z: actor.z },
    field: CROWD_GRID.flowField(cell),
    floor,
    time: w.time,
    dt: w.dt,
    gravity: w.settings.get<number>('physics.gravity'),
    rng: w.rng('crowd'),
  };
  for (const e of w.query('crowdMember')) {
    const agent = e.crowdMember;
    if (agent.state !== 'alive') continue;
    if (e.crowdSlime) steerSlime(physics, agent, e.crowdSlime, chase);
    else if (e.crowdWalker) setVelocity(physics, agent, steerWalker(agent, e.crowdWalker, chase, wanted), w);
    else if (e.crowdWisp) setVelocity(physics, agent, steerWisp(agent, e.crowdWisp, chase, wanted), w);
  }
}

/** The system `crowd.update`: the crowd's queue and readback, the removed despawned, lost bodies rescued. */
function update(w: World<CrowdComponents>): void {
  const physics = physicsOf(w);
  const members = w.query('crowdMember');
  const { removed } = updateCrowd(
    physics,
    members.map((e) => e.crowdMember),
    w,
    { floor },
  );
  for (const i of removed) w.despawn(members[i].id);
  rescueLost(physics, HALL_LEVEL);
}

/** The crowd's setup: the hall and its hero, `box.crowd.count` members queued, the crowd's systems; the hero's id. */
export function setupCrowd(w: World<CrowdComponents>): number {
  const hero = setupHall(w);
  const count = w.settings.get<number>('box.crowd.count');
  const mix = MIXES[w.settings.get<keyof typeof MIXES>('box.crowd.mix')];
  for (let i = 0; i < count; i++) queue(w, mix);
  w.systems.add('crowd.steer', (world) => steer(world, hero), { phase: 'ai' });
  w.systems.add('crowd.update', update, { phase: 'readback' });
  return hero;
}

/** The crowd at 1,000. */
export const crowd1000 = defineScene<CrowdComponents>('box:crowd-1000', {
  description:
    'Box 4: the hall with its hero and a crowd of 1,000 walkers, slimes and wisps, 25 entering a step, that chase him round the pillars and up the stairs.',
  level: 'level:hall',
  physics: true,
  settings: { 'box.crowd.count': 1000 },
  setup(w) {
    setupCrowd(w);
  },
});

export default crowd1000;
