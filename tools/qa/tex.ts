/**
 * @file The `tex` QA family (PLAN.md §8.6, WP 2.3, I-20): `node x qa tex` bakes every texture generator the shared
 * registry has, the engine's (engine/gfx/textures/v1.ts) and a game's (each `*.ts` module under `labs/<name>/textures/`
 * imported first), at its default size and at twice it, with seeds 1 and 2, and checks every
 * bake. It runs in T1 through `runQa` (tools/qa/tex.test.ts).
 *
 * Metrics, one violation per texture and metric, valued by the worst bake (larger is worse): `seamDelta`, the
 * tileability check (engine/gfx/textures/seams.ts: the mean difference across the wrap edge above that of the
 * neighbouring interior pairs, over the value range), a violation above 0.02; `period`, the share of texels the
 * generator writes differently one period over, above 0; `range`, texels with a colour outside 0–255, a height or
 * roughness outside 0–1, or NaN; `mips`, problems in the mip chains of the colour and normal maps (level
 * count and sizes, the mean kept); `unstableHash`, 1 when baking twice, or once under the sim's fdlibm swap, gives
 * another hash. A violation names the bake (seed and size), the numbers and the likely fix. Accepted exceptions go in
 * `tests/baselines/qa-tex.json`, each with its reason.
 *
 * Invariants: textures are checked in id order, bakes in a fixed order, so violations come in a fixed order; a
 * generator that throws gives one `bake` violation naming the error.
 *
 * @example
 * import { registry } from '../../engine/core/registry';
 * checkTextures(registry, ['texture:checker']).length; // 0
 * @see tools/qa/tex.test.ts
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registry as sharedRegistry, type Registry } from '../../engine/core/registry';
import { withSimMath } from '../../engine/core/simMath';
import { bakeTexture, textureSampler, type TextureBake } from '../../engine/gfx/textures/bake';
import { mipChain } from '../../engine/gfx/textures/mips';
import { measureSeam, mipProblems, periodMismatch, rangeProblems, SEAM_LIMIT } from '../../engine/gfx/textures/seams';
import { textureKind, type TextureEntry } from '../../engine/gfx/textures/texture';
import type { QaFamily, QaViolation } from '../cmd/qa';

/** A game's texture modules, `labs/<name>/textures/*.ts` (tests excluded), labs and files in name order. */
export function textureModules(root: string): string[] {
  const dirs: string[] = [];
  const labs = join(root, 'labs');
  if (existsSync(labs)) {
    for (const lab of readdirSync(labs).sort()) dirs.push(join('labs', lab, 'textures'));
  }
  return dirs.flatMap((dir) =>
    existsSync(join(root, dir))
      ? readdirSync(join(root, dir))
          .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
          .sort()
          .map((name) => join(dir, name))
      : [],
  );
}

/** The bakes each texture is checked at: seeds 1 and 2, its size and twice it. */
function variants(entry: TextureEntry): { seed: number; size: [number, number] }[] {
  const [w, h] = entry.size;
  const sizes: [number, number][] = [[w, h]];
  if (w * 2 <= 4096 && h * 2 <= 4096) sizes.push([w * 2, h * 2]);
  return [1, 2].flatMap((seed) => sizes.map((size) => ({ seed, size })));
}

/** The worst value of each metric over a texture's bakes, with the message of the worst. */
type Worst = Map<string, { value: number; message: string }>;

/** Records `value` for `metric` when it is a violation worse than the one recorded. */
function record(worst: Worst, metric: string, value: number, message: () => string): void {
  if (!(value > 0) && !Number.isNaN(value)) return;
  const known = worst.get(metric);
  if (!known || value > known.value) worst.set(metric, { value, message: message() });
}

/** Checks one bake of `entry`, recording its violations. */
function checkBake(registry: Registry, entry: TextureEntry, seed: number, size: [number, number], worst: Worst): void {
  const ref = { texture: entry.id, seed, size };
  const at = `seed ${seed} at ${size[0]} × ${size[1]}`;
  const bake: TextureBake = bakeTexture(ref, registry);
  const seam = measureSeam(bake);
  if (seam.delta > SEAM_LIMIT) {
    record(worst, 'seamDelta', seam.delta, () => {
      const edge = seam.axis === 'x' ? 'left–right' : 'bottom–top';
      return `${at}: ${seam.channel} differs by ${seam.edge.toFixed(3)} on average across the ${edge} wrap edge against ${seam.inside.toFixed(3)} for its neighbours, ${(seam.delta * 100).toFixed(1)}% of its range (the limit is ${SEAM_LIMIT * 100}%): hash wrapped cells (cellHash(wrapIndex(…))), use tileNoise, and keep joints off the edge with runningBond's phase (engine/gfx/textures/tile.ts)`;
    });
  }
  const sampler = textureSampler(ref, registry);
  const period = periodMismatch(sampler);
  record(worst, 'period', period, () => {
    return `${at}: ${(period * 100).toFixed(1)}% of texels differ one period over (x + width or y + height): the generator does not repeat; wrap every coordinate it hashes or looks up (wrapIndex, cellHash of wrapped cells, tileNoise)`;
  });
  const range = rangeProblems(sampler);
  record(worst, 'range', range.count, () => {
    return `${at}: ${range.count} texels out of range, first ${range.first}: colours are bytes 0–255, height and roughness 0–1`;
  });
  const chains = [
    { name: 'map', problems: mipProblems(mipChain(bake.map, bake.width, bake.height, 'srgb'), 'srgb') },
    { name: 'normalMap', problems: mipProblems(mipChain(bake.normalMap, bake.width, bake.height, 'normal'), 'normal') },
  ].filter((chain) => chain.problems.length);
  const problems = chains.reduce((sum, chain) => sum + chain.problems.length, 0);
  record(worst, 'mips', problems, () => {
    return `${at}: the ${chains[0].name} mip chain has ${problems} problem(s), first: ${chains[0].problems[0]}; engine/gfx/textures/mips.ts builds the chain`;
  });
  const again = bakeTexture(ref, registry).hash;
  const swapped = withSimMath(() => bakeTexture(ref, registry).hash);
  if (again !== bake.hash || swapped !== bake.hash) {
    record(worst, 'unstableHash', 1, () => {
      return `${at}: baking twice, or under the sim's fdlibm swap, gave another hash: look for Math.random, Math.sin/cos/pow on texel values, iteration over unordered data, or state kept between bakes`;
    });
  }
}

/** The violations of every texture on `registry` (or those of `ids`), in id order. */
export function checkTextures(registry: Registry = sharedRegistry, ids?: readonly string[]): QaViolation[] {
  textureKind(registry);
  const violations: QaViolation[] = [];
  for (const entry of registry.list('texture') as unknown as TextureEntry[]) {
    if (ids && !ids.includes(entry.id)) continue;
    const worst: Worst = new Map();
    try {
      for (const { seed, size } of variants(entry)) checkBake(registry, entry, seed, size, worst);
    } catch (error) {
      worst.set('bake', { value: 1, message: `baking it threw: ${(error as Error).message}` });
    }
    for (const [metric, { value, message }] of worst) violations.push({ id: entry.id, metric, value, message });
  }
  return violations;
}

/** The family: every texture of the shared registry, after importing the games' texture modules. */
const family: QaFamily = {
  async run({ root, only }) {
    for (const module of textureModules(root)) await import(pathToFileURL(join(root, module)).href);
    const ids = sharedRegistry.list('texture').map((entry) => entry.id);
    const kept = only.length ? ids.filter((id) => only.some((prefix) => id.startsWith(prefix))) : ids;
    return checkTextures(sharedRegistry, kept);
  },
};

export default family;
