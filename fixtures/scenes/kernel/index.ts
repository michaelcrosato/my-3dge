/**
 * @file The kernel fixture scene (PLAN.md WP 1.5, §6.5 item 9): a few scripted movers, no physics, that chase targets
 * on an orbit and follow the mover ahead of them, steering with `Math.sin`, `Math.cos` and `Math.pow` on float64
 * state fed back every step. Without the fdlibm swap such state parts between Node and Chromium within a few hundred
 * steps (§4.7), so its replays' one set of goldens, holding in both, proves the swap end to end. It exercises the rest
 * of the kernel too: intents (the pilot follows `move`, `boost` doubles its speed, `spawn` presses add a mover), named
 * RNG streams, spawns and despawns, a timer, events (`lap`, `lost`, `pulse`, `spawned`), settings (one `view`) and
 * dev actions (`nudge`, `spawn`).
 *
 * Game-like code: it uses only what a game would. The public API barrels arrive with WP 1.6, so for now it imports
 * the engine modules directly; WP 1.6 switches these imports to engine/sim-api.ts.
 *
 * Tests: tests/replays/kernel-*.replay.json (`node x replay tests/replays --browser sim`), engine/sim/replay.test.ts.
 * Try it: `node x sim fixtures/scenes/kernel --steps 600 --set kernel.movers=12`.
 */
import { held, pressed } from '../../../engine/input/intents';
import { defineSettings } from '../../../engine/core/settings';
import { defineScene } from '../../../engine/sim/scene';
import { defineComponent } from '../../../engine/sim/state';
import type { World } from '../../../engine/sim/world';

/** The kernel's settings. */
export const KERNEL_SETTINGS = defineSettings({
  'kernel.movers': {
    type: 'integer',
    default: 6,
    minimum: 0,
    maximum: 1000,
    when: 'scene',
    description: 'Movers spawned when the scene starts; the first is the pilot, steered by intents.',
  },
  'kernel.speed': {
    type: 'number',
    default: 1.5,
    minimum: 0,
    maximum: 20,
    unit: 'm/s',
    description: 'Cruise speed of a mover.',
  },
  'kernel.turn': {
    type: 'number',
    default: 2.5,
    minimum: 0,
    maximum: 20,
    unit: 'rad/s',
    description: 'How fast a mover turns toward its target.',
  },
  'kernel.radius': {
    type: 'number',
    default: 6,
    minimum: 1,
    maximum: 100,
    unit: 'm',
    description: 'Radius of the orbit the targets follow; a mover farther than twice it from the centre is lost.',
  },
  'kernel.trail': {
    type: 'integer',
    default: 30,
    minimum: 0,
    maximum: 600,
    view: true,
    description: 'Steps of trail a view draws behind each mover: view only, so never hashed or replayed.',
  },
});

/** The kernel's components: every mover, and the one the intents steer. */
export const KERNEL_COMPONENTS = [
  defineComponent('mover', {
    description: 'A kernel mover: where it is, where it heads, how fast, and its orbit phase.',
    fields: {
      x: { type: 'number', default: 0, unit: 'm', description: 'East.' },
      z: { type: 'number', default: 0, unit: 'm', description: 'North.' },
      heading: { type: 'number', default: 0, unit: 'rad', description: 'Yaw: forward is (sin, cos).' },
      speed: { type: 'number', default: 0, unit: 'm/s', description: 'Speed this step.' },
      phase: { type: 'number', default: 0, unit: 'rad', description: 'Where its target is on the orbit.' },
      laps: { type: 'integer', default: 0, description: 'Whole turns of the phase.' },
    },
  }),
  defineComponent('pilot', {
    description: 'The mover the intents steer.',
    fields: {
      steer: { type: 'boolean', default: false, description: 'Whether a move intent is steering it.' },
      heading: { type: 'number', default: 0, unit: 'rad', description: 'The heading the move intent asks for.' },
      boost: { type: 'number', default: 1, description: 'Speed factor: 2 while boost is held.' },
    },
  }),
];

/** The kernel's components, typed. */
type Kernel = {
  mover: { x: number; z: number; heading: number; speed: number; phase: number; laps: number };
  pilot: { steer: boolean; heading: number; boost: number };
};
/** The kernel's events. */
type KernelEvents = {
  lap: { id: number; laps: number };
  lost: { id: number };
  pulse: { movers: number };
  spawned: { id: number };
};
type W = World<Kernel, KernelEvents>;

const TAU = 2 * Math.PI;

/** Spawns a mover somewhere on the orbit's disc, from the `spawn` stream. */
function spawnMover(w: W, pilot = false): number {
  const r = w.rng('spawn');
  const angle = r.next() * TAU;
  const distance = w.settings.get<number>('kernel.radius') * (0.3 + 0.5 * r.next());
  const mover = {
    x: distance * Math.sin(angle),
    z: distance * Math.cos(angle),
    heading: r.next() * TAU - Math.PI,
    phase: r.next() * TAU,
  };
  return w.spawn(pilot ? { mover, pilot: {} } : { mover });
}

/** Turns each mover toward its target (the pilot toward its intent) and toward the mover ahead; sets its speed. */
function steer(w: W): void {
  const radius = w.settings.get<number>('kernel.radius');
  const turn = w.settings.get<number>('kernel.turn');
  const cruise = w.settings.get<number>('kernel.speed');
  const movers = w.query('mover');
  movers.forEach((e, i) => {
    const m = e.mover;
    const lead = movers[(i + movers.length - 1) % movers.length].mover;
    let desired = e.pilot?.steer ? e.pilot.heading : 0;
    if (!e.pilot?.steer) {
      const tx = radius * Math.sin(m.phase) + 0.25 * lead.x;
      const tz = radius * Math.cos(1.5 * m.phase + e.id) + 0.25 * lead.z;
      desired = Math.atan2(tx - m.x, tz - m.z);
    }
    m.heading += w.dt * (turn * Math.sin(desired - m.heading) + 0.5 * Math.sin(lead.heading - m.heading));
    m.speed = cruise * Math.pow(1 + 0.5 * Math.sin(3 * m.phase), 1.5) * (e.pilot?.boost ?? 1);
  });
}

/** Moves each mover along its heading and advances its phase, which feels where it is; a whole turn is a lap. */
function move(w: W): void {
  for (const e of w.query('mover')) {
    const m = e.mover;
    m.x += m.speed * Math.sin(m.heading) * w.dt;
    m.z += m.speed * Math.cos(m.heading) * w.dt;
    const before = Math.floor(m.phase / TAU);
    m.phase += w.dt * (1 + 0.3 * Math.cos(0.5 * m.x) * Math.sin(0.5 * m.z));
    if (Math.floor(m.phase / TAU) > before) {
      m.laps++;
      w.emit('lap', { id: e.id, laps: m.laps });
    }
  }
}

/** Despawns movers that strayed past twice the orbit's radius. */
function bounds(w: W): void {
  const limit = 2 * w.settings.get<number>('kernel.radius');
  for (const e of w.query('mover')) {
    if (Math.sqrt(e.mover.x * e.mover.x + e.mover.z * e.mover.z) <= limit) continue;
    w.despawn(e.id);
    w.emit('lost', { id: e.id });
  }
}

/** Every 2.5 s: jolts one mover's phase, chosen and sized by the `pulse` stream. */
function pulse(w: W): void {
  const r = w.rng('pulse');
  const movers = w.query('mover');
  if (movers.length) movers[r.int(0, movers.length - 1)].mover.phase += 0.1 * r.next();
  w.emit('pulse', { movers: movers.length });
}

/** A nudge's arguments: the entity and how far to move it. */
type Nudge = { id: number; dx?: number; dz?: number };

/** The kernel fixture scene. */
export default defineScene<Kernel, KernelEvents>('kernel', {
  description: 'A few scripted movers, no physics, steering with sin, cos and pow on float64 state: the swap proof.',
  setup(w) {
    const count = w.settings.get<number>('kernel.movers');
    for (let i = 0; i < count; i++) spawnMover(w, i === 0);
    w.systems.add('steer', steer, { phase: 'ai' });
    w.systems.add('move', move, { phase: 'physics' });
    w.systems.add('bounds', bounds, { phase: 'rules' });
    w.timers.every(2.5, () => pulse(w));
  },
  step(w, intents) {
    for (const e of w.query('mover', 'pilot')) {
      const [x, z] = intents.move ?? [0, 0];
      e.pilot.steer = x !== 0 || z !== 0;
      if (e.pilot.steer) e.pilot.heading = Math.atan2(x, z);
      e.pilot.boost = held(intents, 'boost') ? 2 : 1;
    }
    if (pressed(intents, 'spawn')) w.emit('spawned', { id: spawnMover(w) });
  },
  actions: {
    nudge(w, args) {
      const { id, dx = 0, dz = 0 } = args as Nudge;
      const mover = w.get(id)?.mover;
      if (!mover) throw new Error(`kernel nudge: there is no mover ${id}`);
      mover.x += dx;
      mover.z += dz;
    },
    spawn(w) {
      w.emit('spawned', { id: spawnMover(w) });
    },
  },
});
