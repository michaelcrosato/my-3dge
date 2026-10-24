/**
 * @file The inspector member `stats()` and the meter behind it (PLAN.md §8.3, §8.7, WP 5.5; doctrine: Verifiable):
 * performance as counters, never frames per second. `stats()` gives the mean milliseconds of the last 60 sim steps
 * (`simMs`) and of their `physics` and `anim` phases (`physicsMs`, `animMs`; the phases of engine/sim/systems.ts),
 * the mean CPU milliseconds of the last 60 drawn frames (`renderMs`), the GPU's (`gpuMs`, where the device has
 * timestamp queries: engine/gfx/enhanced/timing.ts; absent elsewhere), and the renderer's counts: the last frame's
 * draw calls, triangles and compute dispatches, the textures and geometries alive on the GPU, the pipelines built
 * since startup and those built after the warm-up (0, or a frame stalled: §8.7). The split is the prototype
 * benchmark's (physics, logic and drawing): the step's logic is `simMs - physicsMs - animMs`. Means, not medians: a
 * browser's clock reads in steps of 0.1 ms (with jitter), so a cheap step reads 0 most times, and only the mean of
 * the readings comes out right; a pause lifts the mean for one second (60 samples) at most.
 *
 * A meter (`createStatsMeter`) collects them. The engine times each step and each frame through it (`time('sim',
 * run)`, `time('render', run)`) and hands the world its `probe`, which runs each system and adds its time to its
 * phase's total for the step under way (a step timed outside `time('sim', …)` is not counted). The counts are read
 * from `counts()`, the renderer's (engine/gfx/renderer.ts `stats()`), when `stats()` is called; without a renderer
 * (headless) they are null, and so is a timing with no sample yet: nothing was drawn, so nothing was counted. The
 * member reads the meter its host carries (`StatsHost.meter`); a host without one throws `DEV_NO_METER`.
 *
 * Invariants: the meter reads a clock and never the sim's state, and nothing it measures reaches the sim, so the hash
 * is the same with or without it; the probe runs each system exactly once, as the world would.
 *
 * @example
 * let t = 0;
 * const meter = createStatsMeter({ now: () => t });
 * meter.time('sim', () => meter.probe({ phase: 'physics' }, () => (t += 2)));
 * meter.read().physicsMs; // 2, and simMs 2: the step was all physics
 * @see engine/dev/stats.test.ts
 */
import { codeError, defineCodes } from '../core/log';
import type { GfxStats } from '../gfx/renderer';
import { defineMember, type InspectorHost } from './members';

/** The codes this module raises, with their fixes. */
export const STATS_CODES = defineCodes('dev', {
  DEV_NO_METER: {
    template: '__engine.stats() has no meter to read on this host ({runtime})',
    fix: 'start the engine with createEngine or createHeadless (engine/app), which time its steps and frames; a host made by hand carries a meter from createStatsMeter() as `meter`',
    doc: 'Raised by `__engine.stats()` (engine/dev/stats.ts) on an inspector whose host was made without a stats meter, such as a test host built by hand.',
  },
});

/** How many steps or frames the means cover: the last second at 60 Hz. */
export const STATS_WINDOW = 60;

/** What the meter times: the whole sim step, its `physics` and `anim` phases, and a drawn frame's CPU side. */
export const TIMED_PARTS = ['sim', 'physics', 'anim', 'render'] as const;
/** One timed part. */
export type TimedPart = (typeof TIMED_PARTS)[number];

/** The renderer's counts the meter reports (engine/gfx/renderer.ts `GfxStats`), and its GPU time where it has one. */
export type RenderCounts = Pick<
  GfxStats,
  | 'drawCalls'
  | 'triangles'
  | 'computeCalls'
  | 'textures'
  | 'geometries'
  | 'pipelines'
  | 'pipelinesAfterWarmUp'
  | 'gpuMs'
>;

/** The count fields of `EngineStats`, in report order. */
export const COUNT_KEYS = [
  'drawCalls',
  'triangles',
  'computeCalls',
  'textures',
  'geometries',
  'pipelines',
  'pipelinesAfterWarmUp',
] as const satisfies readonly (keyof RenderCounts)[];

/** What `__engine.stats()` returns: means in milliseconds, then the renderer's counts (null when not measured). */
export interface EngineStats {
  /** The mean of the last 60 sim steps, whole; null before the first. */
  simMs: number | null;
  /** The mean time of those steps' `physics` phase (the Rapier step); 0 for a scene without physics. */
  physicsMs: number | null;
  /** The mean time of those steps' `anim` phase (characters, timelines, animators). */
  animMs: number | null;
  /** The mean CPU time of the last 60 drawn frames (the view's update and the draw calls' encoding); null headless. */
  renderMs: number | null;
  /** The GPU's mean time a frame over the last 60 read, from timestamp queries; absent without them, null before one. */
  gpuMs?: number | null;
  /** Steps timed since the engine started. */
  steps: number;
  /** Frames timed since the engine started. */
  frames: number;
  /** The last frame's draw calls; null without a renderer. */
  drawCalls: number | null;
  /** The last frame's triangles. */
  triangles: number | null;
  /** The last frame's compute dispatches. */
  computeCalls: number | null;
  /** Textures alive on the GPU. */
  textures: number | null;
  /** Geometries alive on the GPU. */
  geometries: number | null;
  /** Render and compute pipelines built since startup. */
  pipelines: number | null;
  /** Pipelines built after the warm-up: 0, or a frame stalled (null before the first warm-up). */
  pipelinesAfterWarmUp: number | null;
}

/** A system as the probe sees it: its phase, of engine/sim/systems.ts's `PHASES`. */
export interface ProbedSystem {
  readonly phase: string;
}

/** The meter: times steps, phases and frames, and reads them back as `EngineStats`. */
export interface StatsMeter {
  /** Runs `run` and records its time as one `part` sample (`sim` also records the step's phases); returns its result. */
  time<T>(part: 'sim' | 'render', run: () => T): T;
  /** The world's probe (`createWorld({ probe })`): runs one system, adding its time to its phase's total. */
  readonly probe: (system: ProbedSystem, run: () => void) => void;
  /** The means and counts now. */
  read(): EngineStats;
  /** Forgets every sample (the counts are the renderer's, read live). */
  reset(): void;
}

/** How a meter is made: its clock (ms), its window, and the renderer's counts (absent headless). */
export interface StatsMeterOptions {
  now?: () => number;
  window?: number;
  counts?: () => RenderCounts | null;
}

/** An inspector host that carries a meter (engine/app/headless.ts gives every engine's host one). */
export interface StatsHost extends InspectorHost {
  readonly meter?: StatsMeter;
}

/** Milliseconds as a report shows them: 4 decimals. */
const round = (ms: number) => Math.round(ms * 1e4) / 1e4;

/** Makes a meter (see the file comment). */
export function createStatsMeter(options: StatsMeterOptions = {}): StatsMeter {
  const now = options.now ?? (() => performance.now());
  const size = options.window ?? STATS_WINDOW;
  const samples = Object.fromEntries(TIMED_PARTS.map((part) => [part, [] as number[]])) as Record<TimedPart, number[]>;
  const phases = { physics: 0, anim: 0 };
  let [steps, frames] = [0, 0];
  const push = (part: TimedPart, ms: number) => {
    const list = samples[part];
    list.push(ms);
    if (list.length > size) list.shift();
  };
  return {
    time(part, run) {
      if (part === 'sim') phases.physics = phases.anim = 0;
      const started = now();
      try {
        return run();
      } finally {
        push(part, now() - started);
        if (part === 'sim') {
          push('physics', phases.physics);
          push('anim', phases.anim);
          steps++;
        } else frames++;
      }
    },
    probe(system, run) {
      const { phase } = system;
      if (phase !== 'physics' && phase !== 'anim') return run();
      const started = now();
      try {
        run();
      } finally {
        phases[phase] += now() - started;
      }
    },
    read() {
      const counts = options.counts?.() ?? null;
      const mean = (part: TimedPart) => {
        const list = samples[part];
        return list.length ? round(list.reduce((sum, ms) => sum + ms, 0) / list.length) : null;
      };
      return {
        simMs: mean('sim'),
        physicsMs: mean('physics'),
        animMs: mean('anim'),
        renderMs: mean('render'),
        ...(counts?.gpuMs !== undefined ? { gpuMs: counts.gpuMs } : {}),
        steps,
        frames,
        ...(Object.fromEntries(COUNT_KEYS.map((key) => [key, counts ? counts[key] : null])) as Pick<
          EngineStats,
          (typeof COUNT_KEYS)[number]
        >),
      };
    },
    reset() {
      for (const part of TIMED_PARTS) samples[part].length = 0;
      [steps, frames] = [0, 0];
    },
  };
}

/** The meter `host` carries; throws `DEV_NO_METER` without one. */
export function meterOf(host: InspectorHost): StatsMeter {
  const { meter } = host as StatsHost;
  if (!meter) throw codeError('DEV_NO_METER', { runtime: host.runtime });
  return meter;
}

defineMember('stats', {
  help: "Performance counters, never fps: mean sim, physics, anim and render ms of the last 60 steps or frames, and the GPU's (gpuMs, with timestamp queries); the last frame's draw calls, triangles and compute calls; textures, geometries and pipelines (after warm-up).",
  impl: (host) => meterOf(host).read(),
});
