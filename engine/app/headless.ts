/**
 * @file The engine without a page (PLAN.md §8.3, §6.9, WP 1.6; doctrine: Verifiable): `createHeadless({ scene, seed,
 * settings })` starts a scene as a recorded session (engine/sim/scene.ts) and returns its inspector, the same object a
 * page publishes as `window.__engine` minus a renderer: members that need one throw `DEV_NO_RENDERER`. `x sim` runs
 * scenes through it, and tests drive the sim with the same calls an agent makes in a page.
 *
 * Time: a headless engine has a frame clock over the run's settings, like a page, but no frames. `step(n, intents)`
 * hands the clock n single steps and runs what it returns at once, inside the session, so the steps are recorded and
 * `headlessHost(h).session.record()` is the run as a replay. `pause`, `resume` and `timeScale` set the clock's
 * settings as in a page (no real time passes headless, so only `step` runs steps). `seed(n)` starts the scene again
 * with seed n, a new session and clock, keeping every setting that differs from what a fresh start gives.
 *
 * Invariants: everything runs synchronously after the promise resolves (the fdlibm swap holds only through
 * synchronous entry points); runs share nothing but the registry; the inspector holds only its members, so the run
 * behind it is reached through `headlessHost(h)` (tools only).
 *
 * @example
 * import { createRegistry } from '../core/registry';
 * import { defineScene } from '../sim/scene';
 * const demo = defineScene('demo', { setup: (w) => void w.spawn() }, createRegistry());
 * const h = await createHeadless({ scene: demo, seed: 3 });
 * h.step(60); // 60: the tick after the steps
 * h.entities(); // [{ id: 1, components: [] }]
 * @see engine/app/headless.test.ts
 */
import type { EventMap } from '../core/events';
import { codeError, defineCodes, log as sharedLog, type Log } from '../core/log';
import { registry as sharedRegistry, sameValue, type Registry } from '../core/registry';
import { isPlainObject } from '../core/schema';
import { createSettings, defineSettings, type SettingValue } from '../core/settings';
import { createClock, TIME_SETTINGS, type Clock } from '../core/time';
import { createInspector, type Inspector } from '../dev/inspector';
import type { InspectorHost } from '../dev/members';
import { createSession, getScene, type Scene, type Session } from '../sim/scene';
import type { AnyComponents } from '../sim/state';

/** The codes this module raises, with their fixes. */
export const HEADLESS_CODES = defineCodes('app', {
  APP_NOT_HEADLESS: {
    template: 'headlessHost was given {value}, not a headless engine',
    fix: 'pass the object createHeadless resolved to',
  },
});

/** How a headless engine starts. */
export interface HeadlessOptions<C extends object = AnyComponents, E extends EventMap = EventMap> {
  /** The scene: an id on the registry, or the scene `defineScene` returned. */
  scene: string | Scene<C, E>;
  /** The seed every sim RNG stream derives from (1). */
  seed?: number;
  /** Setting values over the scene's, path → value (`x sim --set`). */
  settings?: Readonly<Record<string, unknown>>;
  /** Where scenes, components and settings are declared (the shared registry). */
  registry?: Registry;
  /** Where errors and advice are recorded (the shared log). */
  log?: Log;
}

/** A headless engine: `__engine`'s members, over a scene running in this process. */
export type Headless = Inspector;

/** The run behind each headless engine, for tools that need more than the members. */
const hosts = new WeakMap<object, InspectorHost>();

/** The settings of `session` that differ from a fresh start of its scene: what a restart keeps. */
function changedSettings(session: Session, registry: Registry): Record<string, SettingValue> {
  const fresh = createSettings({ registry });
  fresh.override(session.scene.settings, 'fresh');
  const now = session.settings.values();
  const changed = Object.keys(now).filter((path) => !sameValue(now[path], fresh.get(path)));
  return Object.fromEntries(changed.map((path) => [path, now[path]]));
}

/**
 * Starts a scene headless, in this process, and returns its inspector: the members a page's `window.__engine` has
 * (`step`, `hash`, `state`, `set`…; `help()` lists them all), minus a renderer. Throws `CORE_NO_ENTRY` for an unknown
 * scene id and `CORE_BAD_SETTING` for a bad setting.
 */
export async function createHeadless<C extends object = AnyComponents, E extends EventMap = EventMap>(
  options: HeadlessOptions<C, E>,
): Promise<Headless> {
  const registry = options.registry ?? sharedRegistry;
  const scene =
    typeof options.scene === 'string' ? getScene(options.scene, registry) : (options.scene as unknown as Scene);
  const timed = registry.kinds().includes('setting') && registry.has('setting', 'time.hz');
  if (!timed) defineSettings(TIME_SETTINGS, registry); // the clock reads them: a test registry may lack them
  const start = (seed: number, settings: Readonly<Record<string, unknown>> | undefined) => {
    const session = createSession(scene, { seed, settings, registry, log: options.log });
    return { session, clock: createClock({ settings: session.settings, log: options.log }) };
  };
  let run: { session: Session; clock: Clock } = start(options.seed ?? 1, options.settings);
  const host: InspectorHost = {
    registry,
    members: sharedRegistry,
    log: options.log ?? sharedLog,
    get clock() {
      return run.clock;
    },
    get session() {
      return run.session;
    },
    runtime: typeof window === 'undefined' ? 'node' : 'browser',
    renderer: false,
    adapter: null,
    features: [],
    downgrades: [],
    step(n, intents) {
      run.clock.step(n);
      const { steps } = run.clock.advance(0); // no real time passes headless: only the single steps run
      const script = Array.isArray(intents) ? intents : undefined;
      const later = isPlainObject(intents) ? { ...intents, p: undefined } : intents;
      for (let k = 0; k < steps; k++) run.session.step(script ? (script[k] ?? {}) : k === 0 ? intents : later);
    },
    restart(seed) {
      run = start(seed, changedSettings(run.session, registry));
    },
  };
  const inspector = createInspector(host);
  hosts.set(inspector, host);
  return inspector;
}

/** The run behind a headless engine: its session (world, settings, recording) and clock. Tools only. */
export function headlessHost(headless: Headless): InspectorHost {
  const host = hosts.get(headless);
  if (!host) throw codeError('APP_NOT_HEADLESS', { value: typeof headless });
  return host;
}
