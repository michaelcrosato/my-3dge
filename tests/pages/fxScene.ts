/**
 * @file The fx page's scene (tests/pages/fx.ts, PLAN.md WP 6.4), without the GPU, so Node runs it too
 * (engine/gfx/fx/effects.test.ts): a small fight in a sim world that gives effects something to draw, and the view
 * that hands it to them.
 *
 * The sim (a world on a registry of its own): a runner circling the yard's middle (component `runner`, 3 m out at
 * 1.2 m/s); four attackers at the corners (component `attacker`), one per telegraph shape (arc, ring, line, cone),
 * each resting, then turning to the runner and winding its telegraph up for 40 ticks; as it goes off, the rules test
 * it (engine/world/telegraphs.ts): `hit` (with a knock away) when the runner is inside, `nearMiss` within a metre, and
 * `slam` under every ring. Every 45 ticks a turret in the north fires a bolt at the runner (component `bolt`, `shot`);
 * a bolt flies 1.5 s at 6 m/s and bursts (`explosion`). Every 150 ticks something falls at a spot drawn from the
 * world's stream `fx` (`slain`). Each rest is drawn from the same stream.
 *
 * The view (`draw(fx)`): it feeds the world's event trace to the effects, draws each winding attacker's telegraph
 * where it stands, each bolt, the runner's blade sweeping round him as a trail (its last 12 places, kept by the view)
 * and a brazier's fire at the yard's east side, running. It reads the world and never writes it.
 *
 * Invariants: the same seed gives the same world in Node and Chromium, with effects on or off; nothing the view does
 * reaches the hash.
 *
 * @see tests/e2e/fx.spec.ts
 */
import { createRegistry } from '../../engine/core/registry';
import type { Effects } from '../../engine/gfx/fx/effects';
import type { TrailSampleLike } from '../../engine/gfx/fx/ribbons';
import { defineComponent } from '../../engine/sim/state';
import { createWorld, type World } from '../../engine/sim/world';
import { getTelegraph, inTelegraph, nearMiss, type TelegraphPlace } from '../../engine/world/telegraphs';

interface Runner {
  x: number;
  z: number;
  angle: number;
}
interface Attacker {
  x: number;
  z: number;
  yaw: number;
  telegraph: string;
  /** Ticks into the wind-up; −1 resting. */
  t: number;
  /** Ticks of rest left. */
  rest: number;
}
interface Bolt {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  /** Ticks left. */
  left: number;
}
type Components = { runner: Runner; attacker: Attacker; bolt: Bolt };
/** The scene's world. */
export type FxWorld = World<Components>;

/** The scene's numbers: see the file comment. */
export const FX_SCENE = {
  radius: 3, // m: the runner's circle round the yard's middle
  speed: 1.2, // m/s
  middle: [6, 0, 4] as const, // the yard's middle
  wind: 40, // ticks of wind-up
  every: 45, // ticks between bolts
  boltSpeed: 6, // m/s
  boltTicks: 90,
  fall: 150, // ticks between falls
  brazier: [10.5, 0, 4] as const,
  turret: [6, 1, 0.5] as const,
} as const;

/** What the fx scene offers the page and the tests. */
export interface FxScene {
  readonly world: FxWorld;
  /** Hands this step's world to `fx` (see the file comment); call after each step, before `fx.frame`. */
  draw(fx: Effects): void;
}

/** The attackers: a corner and a telegraph each. */
const ATTACKERS = [
  { x: 1.5, z: 1.5, telegraph: 'telegraph:arc' },
  { x: 10.5, z: 1.5, telegraph: 'telegraph:ring' },
  { x: 1.5, z: 6.5, telegraph: 'telegraph:line' },
  { x: 10.5, z: 6.5, telegraph: 'telegraph:cone' },
] as const;

/** The fx scene with `seed`. */
export function createFxScene(options: { seed: number }): FxScene {
  const registry = createRegistry();
  const number = (description: string) => ({ type: 'number', default: 0, description }) as const;
  defineComponent(
    'runner',
    {
      description: 'The runner: where he is and his angle round the middle.',
      fields: { x: number('East, m.'), z: number('South, m.'), angle: number('Round the middle, rad.') },
    },
    registry,
  );
  defineComponent(
    'attacker',
    {
      description: 'An attacker: where it stands, its facing, its telegraph, its wind-up and its rest.',
      fields: {
        ...{ x: number('East, m.'), z: number('South, m.'), yaw: number('Facing, rad.') },
        telegraph: { type: 'string', default: 'telegraph:arc', description: 'Its telegraph.' },
        t: { type: 'integer', default: -1, description: 'Ticks into its wind-up; −1 resting.' },
        rest: { type: 'integer', default: 0, description: 'Ticks of rest left.' },
      },
    },
    registry,
  );
  defineComponent(
    'bolt',
    {
      description: 'A bolt in flight.',
      fields: {
        ...{ x: number('East, m.'), y: number('Up, m.'), z: number('South, m.') },
        ...{ vx: number('East, m/s.'), vz: number('South, m/s.') },
        left: { type: 'integer', default: 0, description: 'Ticks left.' },
      },
    },
    registry,
  );
  const world = createWorld<Components>({ seed: options.seed, registry });
  const stream = world.rng('fx');
  const [mx, , mz] = FX_SCENE.middle;

  world.systems.add(
    'fx.run',
    (w) => {
      for (const { runner } of w.query('runner')) {
        runner.angle += (FX_SCENE.speed / FX_SCENE.radius) * w.dt;
        runner.x = mx + Math.sin(runner.angle) * FX_SCENE.radius;
        runner.z = mz + Math.cos(runner.angle) * FX_SCENE.radius;
      }
    },
    { phase: 'ai' },
  );
  world.systems.add(
    'fx.attack',
    (w) => {
      const [hero] = w.query('runner');
      for (const { attacker: a } of w.query('attacker')) {
        if (a.t < 0) {
          if (--a.rest > 0) continue;
          [a.t, a.yaw] = [0, Math.atan2(hero.runner.x - a.x, hero.runner.z - a.z)];
        }
        if (++a.t < FX_SCENE.wind) continue;
        const t = getTelegraph(a.telegraph);
        const place: TelegraphPlace = { telegraph: a.telegraph, position: [a.x, 0, a.z], yaw: a.yaw, u: 1 };
        const at = [hero.runner.x, 0, hero.runner.z] as const;
        if (inTelegraph(t, place, at, 0.3)) {
          const [dx, dz] = [hero.runner.x - a.x, hero.runner.z - a.z];
          const d = Math.hypot(dx, dz) || 1;
          w.emit('hit', { position: [at[0], 1, at[2]], velocity: [(dx / d) * 2, 0, (dz / d) * 2], ground: 0 });
        } else if (nearMiss(t, place, at, 0.3)) w.emit('nearMiss', { position: [at[0], 1, at[2]] });
        if (t.shape === 'ring') w.emit('slam', { position: [a.x, 0, a.z], size: 1 });
        [a.t, a.rest] = [-1, stream.int(20, 60)];
      }
    },
    { phase: 'ai' },
  );
  world.systems.add(
    'fx.bolts',
    (w) => {
      const [hero] = w.query('runner');
      for (const { id, bolt } of w.query('bolt')) {
        [bolt.x, bolt.z] = [bolt.x + bolt.vx * w.dt, bolt.z + bolt.vz * w.dt];
        if (--bolt.left > 0) continue;
        w.emit('explosion', { position: [bolt.x, bolt.y, bolt.z], size: 0.6, ground: 0 });
        w.despawn(id);
      }
      if (w.tick % FX_SCENE.every === 0) {
        const [x, y, z] = FX_SCENE.turret;
        const [dx, dz] = [hero.runner.x - x, hero.runner.z - z];
        const d = Math.hypot(dx, dz) || 1;
        const [vx, vz] = [(dx / d) * FX_SCENE.boltSpeed, (dz / d) * FX_SCENE.boltSpeed];
        w.spawn({ bolt: { x, y, z, vx, vz, left: FX_SCENE.boltTicks } });
        w.emit('shot', { position: [x, y, z] });
      }
      if (w.tick % FX_SCENE.fall === 0) {
        w.emit('slain', { x: stream.range(2, 10), y: 0, z: stream.range(2, 6), size: 0.8 });
      }
    },
    { phase: 'rules' },
  );
  world.run((w) => {
    w.spawn({ runner: { x: mx, z: mz + FX_SCENE.radius, angle: 0 } });
    for (const a of ATTACKERS) w.spawn({ attacker: { ...a, yaw: 0, t: -1, rest: stream.int(1, 40) } });
  });

  const blade: TrailSampleLike[] = [];
  let spin = 0;
  return {
    world,
    draw(fx) {
      fx.feed(world.events.trace());
      for (const { attacker: a } of world.query('attacker')) {
        if (a.t < 0) continue;
        fx.telegraph({ telegraph: a.telegraph, position: [a.x, 0, a.z], yaw: a.yaw, u: a.t / FX_SCENE.wind });
      }
      for (const { bolt } of world.query('bolt')) fx.bolt([bolt.x, bolt.y, bolt.z]);
      const [hero] = world.query('runner');
      spin += 0.35;
      const [sx, sz] = [Math.sin(spin), Math.cos(spin)];
      const [x, z] = [hero.runner.x, hero.runner.z];
      blade.push({ base: [x + sx * 0.2, 1, z + sz * 0.2], tip: [x + sx * 0.9, 1.1, z + sz * 0.9] });
      if (blade.length > 12) blade.shift();
      fx.trail(blade, '#d8f2ff');
      fx.emit('emitter:fire', FX_SCENE.brazier, 'brazier');
    },
  };
}
