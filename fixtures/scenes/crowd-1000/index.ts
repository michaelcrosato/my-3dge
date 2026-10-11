/**
 * @file The crowd-1000 fixture scene (PLAN.md WP 5.1): 1,000 crowd agents (engine/physics/crowd.ts) pushing toward a
 * point in a walled arena, so the crowd's step is timed against a budget (`node x perf fixtures/scenes/crowd-1000
 * --budget`, tests/baselines/perf/crowd-1000.json) and proven against golden hashes in Node and in Chromium
 * (tests/replays/crowd-1000.replay.json).
 *
 * - Setup queues `crowd1000.agents` agents on spots drawn from the stream `spawn`, 8 to 20 m from the centre, and the
 *   crowd's spawn queue lets 25 in a step. Each is drawn from the same stream: a wisp (a flyer, hovering 1.25 m up)
 *   one time in 25, else a slime (a ball) one time in four, else a walker (a capsule).
 * - Each step (the phase `ai`) every living agent wants to go to the centre at `crowd1000.speed`, and to stand within
 *   half a metre of it: the crowd packs into a disc and keeps pushing, contacts everywhere.
 * - `blast` (pressed) bursts at the centre: agents within `BLAST.kill` die and are thrown out and up (the kill
 *   launch), those within `BLAST.reach` are knocked away and up. Corpses slide to a stop and are removed 1.6 s after
 *   their deaths; each agent removed is replaced by one queued on the ring 21 m out.
 * - Dev actions: `thin` sends every tenth living agent away (the despawn queue); `roundtrip` takes the physics world's
 *   capture and restores it in place from its text form, so the replay proves a crowd restores and continues exactly.
 *
 * Systems: `push` (phase `ai`) sets the velocities; `crowd` (phase `readback`) runs `updateCrowd`, despawns removed
 * agents, queues their replacements and rescues lost bodies. Events: `killed` and `removed`, `{ body }`.
 *
 * Game code: it imports only engine/sim-api.ts. Tests: fixtures/scenes/crowd-1000/index.test.ts. Try it: `node x sim
 * fixtures/scenes/crowd-1000 --steps 600`.
 */
import {
  addLevelBodies,
  compileLevel,
  CROWD_AGENT_FIELDS,
  defineComponent,
  defineScene,
  defineSettings,
  floorHeight,
  killAgent,
  knockback,
  launch,
  physicsOf,
  pressed,
  rescueLost,
  setVelocity,
  updateCrowd,
  type CrowdAgent,
  type World,
} from '../../../engine/sim-api';

/** The scene's settings. */
export const CROWD_1000_SETTINGS = defineSettings({
  'crowd1000.agents': {
    type: 'integer',
    default: 1000,
    minimum: 0,
    maximum: 5000,
    when: 'scene',
    description: 'Agents queued when the scene starts.',
  },
  'crowd1000.speed': { type: 'number', default: 3, minimum: 0, maximum: 20, unit: 'm/s', description: 'Their speed.' },
});

/** The arena: 48 × 48 m, walled (3 m), 46 × 46 m inside. */
export const ARENA = compileLevel(
  [
    '---',
    'description: The walled arena of the crowd-1000 fixture.',
    '---',
    '#'.repeat(48),
    ...Array.from({ length: 46 }, () => `#${'.'.repeat(46)}#`),
    '#'.repeat(48),
  ].join('\n'),
  { file: 'crowd-1000.txt' },
);

/** The point the crowd pushes toward (x, z): the arena's centre. */
export const CENTRE = [24, 24] as const;
/** Where agents queue in setup (m from the centre), and where replacements queue. */
export const SPAWN = { near: 8, far: 20, edge: 21 } as const;
/** A wisp's height above the floor (m) and how fast it climbs to it (per second). */
const HOVER = { height: 1.25, rate: 6 };
/** The blast: who dies (m), who is knocked (m), how hard (m/s), how high (m/s) and the kill launch (m/s, ×). */
export const BLAST = { kill: 2, reach: 5, push: 4, toss: 4.375, killToss: 5.9375, carry: 1.3 } as const;

/** The agents' makes: the prototype's walker, slime and wisp, in metres. */
const MAKES = {
  walker: {},
  slime: { shape: 'ball', radius: 0.375 },
  wisp: { shape: 'ball', radius: 0.3125, flyer: true, acceleration: 12 },
} as const satisfies Record<string, Partial<CrowdAgent>>;

/** The fixture's agents: crowd agents (CROWD_AGENT_FIELDS). */
export const PUSHER = defineComponent('pusher', {
  description: 'An agent of the crowd-1000 fixture: a crowd agent pushing toward the arena’s centre.',
  fields: CROWD_AGENT_FIELDS,
});

type Components = { pusher: CrowdAgent };
type CrowdWorld = World<Components>;

/** The fixture's events, for listeners (`w.events.on('killed', …)`). */
export type CrowdEvents = { killed: { body: number }; removed: { body: number } };

/** Queues an agent `near` to `far` m from the centre, its make, bearing and distance drawn from the stream `spawn`. */
function queue(w: CrowdWorld, near: number, far: number): void {
  const rng = w.rng('spawn');
  const roll = rng.next();
  const make = roll < 0.04 ? MAKES.wisp : roll < 0.28 ? MAKES.slime : MAKES.walker;
  const [bearing, distance] = [rng.range(0, 2 * Math.PI), rng.range(near, far)];
  const [x, z] = [CENTRE[0] + distance * Math.cos(bearing), CENTRE[1] + distance * Math.sin(bearing)];
  w.spawn({ pusher: { ...make, x, y: floorHeight(ARENA, x, z), z } });
}

/** Every living agent wants the centre (the phase `ai`); a wisp also its hover height. */
function push(w: CrowdWorld): void {
  const physics = physicsOf(w);
  const speed = w.settings.get<number>('crowd1000.speed');
  for (const { pusher: a } of w.query('pusher')) {
    if (a.state !== 'alive') continue;
    const [dx, dz] = [CENTRE[0] - a.x, CENTRE[1] - a.z];
    const d = Math.sqrt(dx * dx + dz * dz);
    const k = d < 0.5 ? 0 : speed / d;
    const up = a.flyer ? (floorHeight(ARENA, a.x, a.z) + HOVER.height - a.y) * HOVER.rate : 0;
    setVelocity(physics, a, [dx * k, up, dz * k], w);
  }
}

/** The crowd's step (the phase `readback`): queues, corpses, readback; replacements for the removed; the rescue. */
function crowd(w: CrowdWorld): void {
  const physics = physicsOf(w);
  const list = w.query('pusher');
  const floor = (x: number, z: number) => floorHeight(ARENA, x, z);
  const bodies = list.map((e) => e.pusher.body);
  const { removed } = updateCrowd(
    physics,
    list.map((e) => e.pusher),
    w,
    { floor },
  );
  for (const i of removed) {
    w.despawn(list[i].id);
    w.emit('removed', { body: bodies[i] });
    queue(w, SPAWN.edge, SPAWN.edge);
  }
  rescueLost(physics, ARENA);
}

/** The blast at the centre: deaths and kill launches within `BLAST.kill`, knockback and tosses within `BLAST.reach`. */
function blast(w: CrowdWorld): void {
  const physics = physicsOf(w);
  for (const { pusher: a } of w.query('pusher')) {
    if (a.state !== 'alive') continue;
    const [dx, dz] = [a.x - CENTRE[0], a.z - CENTRE[1]];
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d >= BLAST.reach) continue;
    const [ux, uz] = d > 1e-6 ? [dx / d, dz / d] : [1, 0];
    knockback(physics, a, [ux * BLAST.push, 0, uz * BLAST.push]);
    if (d >= BLAST.kill) {
      launch(physics, a, BLAST.toss);
      continue;
    }
    killAgent(physics, a);
    launch(physics, a, BLAST.killToss, BLAST.carry);
    w.emit('killed', { body: a.body });
  }
}

export default defineScene<Components>('crowd-1000', {
  description:
    '1,000 crowd agents pushing toward the centre of a walled arena; blast kills and throws the middle and knocks the ring back, corpses are removed after 1.6 s and replaced; thin sends every tenth away; roundtrip restores the physics world in place.',
  physics: true,
  setup(w) {
    addLevelBodies(physicsOf(w), ARENA);
    for (let n = w.settings.get<number>('crowd1000.agents'), i = 0; i < n; i++) queue(w, SPAWN.near, SPAWN.far);
    w.systems.add('push', push, { phase: 'ai' });
    w.systems.add('crowd', crowd, { phase: 'readback' });
  },
  step(w, intents) {
    if (pressed(intents, 'blast')) blast(w);
  },
  actions: {
    thin(w) {
      const alive = w.query('pusher').filter((e) => e.pusher.state === 'alive');
      for (let i = 9; i < alive.length; i += 10) alive[i].pusher.state = 'leaving';
    },
    roundtrip(w) {
      const physics = physicsOf(w);
      const capture = physics.capture();
      physics.restore({ ...capture, snapshot: Array.from(capture.snapshot) });
    },
  },
});
