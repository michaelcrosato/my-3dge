/**
 * @file The `tex` QA family (PLAN.md §8.6, WP 2.3, WP 7.3, I-20): `node x qa tex` bakes every texture generator the
 * shared registry has, the engine's (engine/gfx/textures/v1.ts, v2.ts) and a game's (each `*.ts` module under
 * `labs/<name>/textures/` imported first), at its default size and at twice it, with seeds 1 and 2, and checks every
 * bake; then, under each `prop` entry's id (WP 4.5; a game's props under `labs/<name>/props/` imported first), the
 * textures its parts' materials name, baked as each material bakes them (its parameters and size), and a `reference`
 * violation for a part naming a material no entry defines. It runs in T1 through `runQa` (tools/qa/tex.test.ts).
 *
 * It also writes the contact sheet, `out/qa/tex/sheet.png` (WP 7.3): every texture checked, at seed 1 and its default
 * size, as its colour, normal and emissive maps side by side, each tiled 2 × 2 into 128 px (nearest texels, its
 * shape kept) so a seam shows as a line through the middle, labelled with its id and size, three textures to a row
 * (1,208 px wide). Look at it when a metric points at a texture, or hand it to the `visual-reviewer`.
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
 * import { bakeTexture } from '../../engine/gfx/textures/bake';
 * checkTextures(registry, ['texture:checker']).length; // 0
 * textureSheet([bakeTexture('texture:checker')]).width; // 408: one texture's three panels
 * @see tools/qa/tex.test.ts
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registry as sharedRegistry, type Registry } from '../../engine/core/registry';
import { withSimMath } from '../../engine/core/simMath';
import { bakeTexture, textureSampler, type TextureBake } from '../../engine/gfx/textures/bake';
import { mipChain } from '../../engine/gfx/textures/mips';
import { measureSeam, mipProblems, periodMismatch, rangeProblems, SEAM_LIMIT } from '../../engine/gfx/textures/seams';
import { textureKind, type TextureEntry } from '../../engine/gfx/textures/texture';
import { materialKind, textureRefOf, type MapRef } from '../../engine/gfx/materials/material';
import { propLooks } from '../../engine/gfx/props';
import { propKind, type Prop } from '../../engine/world/props/prop';
import { drawText, type Sheet } from '../lib/filmSheet';
import type { QaFamily, QaViolation } from '../cmd/qa';
import { labModules } from './geo';
import { encodePng } from '../cmd/shot';

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

/** The bakes each texture is checked at: seeds 1 and 2, its size (or `size`) and twice it. */
function variants(entry: TextureEntry, size?: readonly number[] | null): { seed: number; size: [number, number] }[] {
  const [w, h] = size ?? entry.size;
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

/** Checks one bake of `entry` (with `params`), recording its violations. */
function checkBake(
  registry: Registry,
  entry: TextureEntry,
  seed: number,
  size: [number, number],
  worst: Worst,
  params: Record<string, unknown> = {},
): void {
  const ref = { texture: entry.id, seed, size, params };
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

/** The violations of the textures a prop's parts' materials name, baked as they bake them, as the prop's id. */
function checkProp(registry: Registry, prop: Prop): QaViolation[] {
  const worst: Worst = new Map();
  const maps = new Map<string, { ref: MapRef; where: string }>();
  for (const part of prop.parts) {
    for (const material of [part.material, part.top].filter(Boolean)) {
      const where = `part ${part.name}'s ${material}`;
      if (!registry.has('material', material)) {
        const message = `${where} is not defined, so it draws as material:default: define it, or name one of node x describe material`;
        record(worst, 'reference', (worst.get('reference')?.value ?? 0) + 1, () => message);
        continue;
      }
      const ref = textureRefOf(registry.get('material', material).map);
      if (ref) maps.set(JSON.stringify([ref.texture, ref.params, ref.size]), { ref, where });
    }
  }
  for (const { ref, where } of maps.values()) {
    const entry = registry.get('texture', ref.texture) as unknown as TextureEntry;
    const found: Worst = new Map();
    try {
      for (const { seed, size } of variants(entry, ref.size)) checkBake(registry, entry, seed, size, found, ref.params);
    } catch (error) {
      found.set('bake', { value: 1, message: `baking it threw: ${(error as Error).message}` });
    }
    for (const [metric, { value, message }] of found)
      record(worst, metric, value, () => `${where} (${ref.texture}), ${message}`);
  }
  return [...worst].map(([metric, { value, message }]) => ({ id: prop.id, metric, value, message }));
}

/** The violations of the textures of every prop on `registry` (or those of `ids`), in id order, as the props' ids. */
export function checkPropTextures(registry: Registry = sharedRegistry, ids?: readonly string[]): QaViolation[] {
  propKind(registry);
  materialKind(registry);
  propLooks(registry);
  return (registry.list('prop') as unknown as Prop[])
    .filter((prop) => !ids || ids.includes(prop.id))
    .flatMap((prop) => checkProp(registry, prop));
}

/** A contact sheet's panel side, the space between panels and textures, and the label's height, in pixels. */
const [PANEL, GAP, LABEL] = [128, 4, 16];
/** Textures per row of the sheet. */
const PER_ROW = 3;

/**
 * The contact sheet of `bakes`: per texture its colour, normal and emissive maps (black when nothing glows), each
 * tiled 2 × 2 and scaled by nearest texels to fit a 128 px panel, keeping its shape (row 0 of a map at the bottom,
 * as it is drawn), and a label.
 */
export function textureSheet(bakes: readonly TextureBake[]): Sheet {
  const block = 3 * PANEL + 2 * GAP;
  const cols = Math.max(1, Math.min(PER_ROW, bakes.length));
  const width = cols * block + (cols + 1) * 2 * GAP;
  const height = Math.ceil(bakes.length / PER_ROW) * (PANEL + LABEL + 2 * GAP) + 2 * GAP;
  const sheet: Sheet = { width, height, rgba: new Uint8Array(width * height * 4) };
  for (let p = 0; p < sheet.rgba.length; p += 4) sheet.rgba.set([27, 27, 36, 255], p);
  for (const [i, bake] of bakes.entries()) {
    const [x0, y0] = [
      2 * GAP + (i % PER_ROW) * (block + 2 * GAP),
      2 * GAP + Math.floor(i / PER_ROW) * (PANEL + LABEL + 2 * GAP),
    ];
    const maps = [bake.map, bake.normalMap, bake.emissiveMap];
    // Two periods each way, scaled to fit the panel and keep the texture's shape. Panel rows count down from the top
    // and map rows up from the bottom, so the panel's bottom row shows row 0 and its top row the map's top.
    const scale = PANEL / (2 * Math.max(bake.width, bake.height));
    const [pw, ph] = [Math.round(2 * bake.width * scale), Math.round(2 * bake.height * scale)];
    for (const [k, map] of maps.entries()) {
      for (let y = 0; y < ph; y++) {
        const ty = Math.floor((ph - 1 - y) / scale) % bake.height;
        for (let x = 0; x < pw; x++) {
          const tx = Math.floor(x / scale) % bake.width;
          const at = ((y0 + y) * width + x0 + k * (PANEL + GAP) + x) * 4;
          const from = (ty * bake.width + tx) * 4;
          sheet.rgba.set(map ? [map[from], map[from + 1], map[from + 2], 255] : [0, 0, 0, 255], at);
        }
      }
    }
    const name = `${bake.texture.replace(/^texture:/, '')} ${bake.width}x${bake.height}`;
    drawText(sheet, [x0, y0 + PANEL + 3], name, [200, 200, 224], x0 + block);
  }
  return sheet;
}

/** The family: every texture of the shared registry, then every prop's, after importing a game's modules; and the
 * sheet of the textures. */
const family: QaFamily = {
  async run({ root, only }) {
    for (const module of [...textureModules(root), ...labModules(root, 'props')]) {
      await import(pathToFileURL(join(root, module)).href);
    }
    const keep = (id: string) => !only.length || only.some((prefix) => id.startsWith(prefix));
    const ids = sharedRegistry.list('texture').map((entry) => entry.id);
    propKind(sharedRegistry);
    const props = sharedRegistry.list('prop').map((entry) => entry.id);
    const kept = ids.filter(keep);
    const violations = [
      ...checkTextures(sharedRegistry, kept),
      ...checkPropTextures(sharedRegistry, props.filter(keep)),
    ];
    const bakes = kept.flatMap((id) => {
      try {
        return [bakeTexture(id, sharedRegistry)];
      } catch {
        return []; // a generator that throws is already a `bake` violation
      }
    });
    if (bakes.length) {
      const sheet = textureSheet(bakes);
      mkdirSync(join(root, 'out', 'qa', 'tex'), { recursive: true });
      writeFileSync(join(root, 'out', 'qa', 'tex', 'sheet.png'), encodePng(sheet.width, sheet.height, sheet.rgba));
    }
    return violations;
  },
};

export default family;
