/**
 * @file The bot's seed sweep (PLAN.md WP 5.6, I-38): `sweepBot(scene, seeds, plan)` plays the bot's run
 * (engine/dev/bot.ts `runBot`) from a fresh session of the scene per seed (`1-20`, `5` for 1 to 5, `3,7,9`: `parseSeeds`),
 * and gives one row for the scene, its seeds' runs inside and their sums: how many arrived, stuck, stopped or ran out,
 * and the most steps a run took. Split from engine/dev/bot.ts at its line cap (WP 13.18).
 *
 * Invariants: each run starts from a fresh session of its own, so a seed's run is the same whatever runs beside it.
 *
 * @example
 * parseSeeds('3,7,9'); // [3, 7, 9]
 * @see engine/dev/bot.test.ts
 */
import { codeError } from '../core/log';
import { registry as sharedRegistry, type Registry } from '../core/registry';
import { show } from '../core/schema';
import { getScene, type Scene } from '../sim/scene';
import { createSession } from '../sim/session';
import { getLevel } from '../world/level/level';
import type { CompiledLevel } from '../world/level/types';
import { getSite, type Site } from '../world/site';
import { runBot, type BotPlan, type BotReport } from './bot';

/** Seeds as a sweep takes them: `1-20`, `5` (1 to 5), `3,7,9`, a count or a list; 1 to 500 whole numbers from 0. */
export function parseSeeds(seeds: unknown): number[] {
  const bad = () => codeError('SIM_BAD_ARGUMENT', { where: 'the bot sweep { seeds }', value: show(seeds), expected: 'seeds like 1-20, 5 or 3,7,9 (1 to 500 of them, whole numbers from 0)' }); // prettier-ignore
  const whole = (text: unknown) => (/^\s*\d+\s*$/.test(String(text)) ? Number(text) : NaN);
  const range = (a: number, b: number) => (b >= a && b - a < 500 ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : []); // prettier-ignore
  let list: number[] = [];
  if (Array.isArray(seeds)) list = seeds.map(whole);
  else if (typeof seeds === 'number') list = range(1, seeds);
  else if (typeof seeds === 'string' && seeds.includes('-'))
    list = range(...(seeds.split('-').map(whole) as [number, number])); // prettier-ignore
  else if (typeof seeds === 'string' && seeds.includes(',')) list = seeds.split(',').map(whole);
  else if (typeof seeds === 'string') list = range(1, whole(seeds));
  if (!list.length || list.length > 500 || list.some((seed) => !Number.isInteger(seed))) throw bad();
  return list;
}

/** One row of the bot's report: a scene, its seeds' runs and their sums. */
export interface BotRow {
  scene: string;
  level: string;
  seeds: number[];
  arrived: number;
  stuck: number;
  stopped: number;
  timeout: number;
  /** The most steps a run took. */
  worst: number;
  runs: (BotReport & { seed: number })[];
}

/** How a sweep starts each run: the scene's settings over its own, its registry and its level. */
export interface SweepOptions {
  settings?: Readonly<Record<string, unknown>>;
  registry?: Registry;
  /** The level (or site) the bot reads: the scene's own (`getSite(scene.site)`, else `getLevel(scene.level)`) when absent. */
  level?: CompiledLevel | Site;
}

/** Plays `plan` from a fresh session of `scene` per seed (see the file comment): one row for the scene. */
export function sweepBot(
  scene: Scene | string,
  seeds: unknown,
  plan: BotPlan = {},
  options: SweepOptions = {},
): BotRow {
  const registry = options.registry ?? sharedRegistry;
  const found = typeof scene === 'string' ? getScene(scene, registry) : scene;
  const levelId = found.site ?? found.level ?? '';
  if (!options.level && !levelId) throw codeError('SIM_BAD_ARGUMENT', { where: 'sweepBot(scene)', value: found.id, expected: 'a scene with a level or a site (defineScene({ level })), or { level } given' }); // prettier-ignore
  const level = options.level ?? (found.site ? getSite(found.site, registry) : getLevel(levelId, registry));
  const runs = parseSeeds(seeds).map((seed) => {
    const session = createSession(found, { seed, settings: options.settings, registry });
    return { seed, ...runBot(session, level, plan) };
  });
  const count = (status: BotReport['status']) => runs.filter((r) => r.status === status).length;
  const sums = {
    arrived: count('arrived'),
    stuck: count('stuck'),
    stopped: count('stopped'),
    timeout: count('timeout'),
  };
  return { scene: found.id, level: levelId, seeds: runs.map((r) => r.seed), ...sums, worst: Math.max(...runs.map((r) => r.steps)), runs }; // prettier-ignore
}
