/**
 * @file Texture quality measures (PLAN.md WP 2.3, §8.6, I-20): what the `tex` QA family (tools/qa/tex.ts) and the
 * unit tests check a bake against. `measureSeam` is the tileability check: for every channel of every map, the mean
 * difference across the wrap edge (column width − 1 against column 0, row height − 1 against row 0) minus the mean
 * difference of the neighbouring interior pairs (the columns, or rows, one texel inside each side of the edge), over
 * the channel's value range (255 for colour bytes, 1 for height and roughness); a texture tiles when the worst is at
 * most 0.02 (2%). `periodMismatch` checks the
 * generator itself repeats: the share of texels it writes differently one period over. `rangeProblems` checks every
 * value is in its range, and `mipProblems` that a mip chain is whole and keeps the map's mean.
 *
 * Why the neighbouring pairs: they are what the eye compares the seam with, and they share the edge's place in the
 * pattern's courses, which the generators keep off the edge (engine/gfx/textures/tile.ts), so a seam shows as the
 * edge differing from its neighbours rather than being lost in the pattern's own joints.
 *
 * Why the whole value range, not the range a texture happens to use: specks and knots make the edge's mean
 * difference vary by a few bytes from texture to texture, which is noise against a low-contrast texture's own range
 * but not a seam; a seam is a jump the eye sees against the full scale, and `periodMismatch` catches, exactly, a
 * generator that does not repeat at all.
 *
 * Invariants: pure functions of the bake (no three.js); a negative delta means the edge is smoother than its
 * neighbours.
 *
 * @example
 * import { bakeTexture } from './bake';
 * measureSeam(bakeTexture('texture:brick')).delta <= SEAM_LIMIT; // true
 * @see engine/gfx/textures/seams.test.ts
 */
import type { TextureBake, TextureSampler } from './bake';
import { newTexel } from './bake';
import { mipCount, SRGB_TO_LINEAR, type MipEncoding, type MipLevel } from './mips';

/** The largest seam delta a tiling texture may have: 2% of the value range. */
export const SEAM_LIMIT = 0.02;

/** The worst seam of a bake: where, by how much, and the numbers behind it. */
export interface SeamReport {
  /** (edge − inside) / range for the worst channel and axis. */
  delta: number;
  /** The map and channel: `map.r`, `heightMap`, `roughnessMap`, `emissiveMap.g`… */
  channel: string;
  /** `x` for the left–right edge, `y` for the bottom–top edge. */
  axis: 'x' | 'y';
  /** The mean difference across the wrap edge. */
  edge: number;
  /** The mean difference of the neighbouring interior pairs. */
  inside: number;
  /** The channel's value range: 255 for colour bytes, 1 for height and roughness. */
  range: number;
}

/** One channel of a bake: a name, the value at texel index t, and the channel's value range (255 or 1). */
interface Channel {
  name: string;
  at: (t: number) => number;
  range: number;
}

/** The channels of a bake: the colour's three, height, roughness, and the emissive's three when it glows. */
function channelsOf(bake: TextureBake): Channel[] {
  const rgb = (name: string, data: Uint8Array) =>
    ['r', 'g', 'b'].map((c, i) => ({ name: `${name}.${c}`, at: (t: number) => data[t * 4 + i], range: 255 }));
  return [
    ...rgb('map', bake.map),
    { name: 'heightMap', at: (t) => bake.heightMap[t], range: 1 },
    { name: 'roughnessMap', at: (t) => bake.roughnessMap[t], range: 1 },
    ...(bake.emissiveMap ? rgb('emissiveMap', bake.emissiveMap) : []),
  ];
}

/** The mean of |a − b| over the pairs `pairs` gives (index pairs). */
function meanDifference(channel: Channel, pairs: [number, number][]): number {
  let sum = 0;
  for (const [a, b] of pairs) sum += Math.abs(channel.at(a) - channel.at(b));
  return sum / pairs.length;
}

/** The worst seam of `bake` over its channels and both axes (see the file comment). Needs 3 texels on a side. */
export function measureSeam(bake: TextureBake): SeamReport {
  const { width: w, height: h } = bake;
  const index = (x: number, y: number) => y * w + x;
  const column = (a: number, b: number) =>
    Array.from({ length: h }, (_, y): [number, number] => [index(a, y), index(b, y)]);
  const row = (a: number, b: number) =>
    Array.from({ length: w }, (_, x): [number, number] => [index(x, a), index(x, b)]);
  const axes = [
    { axis: 'x' as const, edge: column(w - 1, 0), inside: [column(w - 2, w - 1), column(0, 1)] },
    { axis: 'y' as const, edge: row(h - 1, 0), inside: [row(h - 2, h - 1), row(0, 1)] },
  ];
  let worst: SeamReport = { delta: -Infinity, channel: 'map.r', axis: 'x', edge: 0, inside: 0, range: 0 };
  for (const channel of channelsOf(bake)) {
    const { range } = channel;
    for (const { axis, edge, inside } of axes) {
      const across = meanDifference(channel, edge);
      const near = (meanDifference(channel, inside[0]) + meanDifference(channel, inside[1])) / 2;
      const delta = (across - near) / range;
      if (delta > worst.delta) worst = { delta, channel: channel.name, axis, edge: across, inside: near, range };
    }
  }
  return worst.delta === -Infinity ? { ...worst, delta: 0 } : worst;
}

/** Whether two texels differ in any value. */
function differ(a: ReturnType<typeof newTexel>, b: ReturnType<typeof newTexel>): boolean {
  return (
    a.height !== b.height ||
    a.roughness !== b.roughness ||
    a.color.some((v, i) => v !== b.color[i]) ||
    a.emissive.some((v, i) => v !== b.emissive[i])
  );
}

/**
 * The share of texels (0–1) the sampler writes differently one period away: at (x + width, y), (x, y + height) and
 * (x − width, y − height). 0 for a periodic generator.
 */
export function periodMismatch(sampler: TextureSampler): number {
  const { width: w, height: h } = sampler;
  const [here, there] = [newTexel(), newTexel()];
  let mismatched = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      sampler.sample(x, y, here);
      const off = [
        [x + w, y],
        [x, y + h],
        [x - w, y - h],
      ].some(([ox, oy]) => differ(here, sampler.sample(ox, oy, there)));
      if (off) mismatched++;
    }
  }
  return mismatched / (w * h);
}

/** What `rangeProblems` counts. */
export interface RangeReport {
  /** Texels with a value outside its range (colours 0–255, height and roughness 0–1) or not a number. */
  count: number;
  /** The first, as a sentence. */
  first: string;
}

/** Every value the sampler writes checked against its range (see `RangeReport`). */
export function rangeProblems(sampler: TextureSampler): RangeReport {
  const texel = newTexel();
  const report: RangeReport = { count: 0, first: '' };
  const inRange = (v: number, max: number) => v >= 0 && v <= max;
  for (let y = 0; y < sampler.height; y++) {
    for (let x = 0; x < sampler.width; x++) {
      const { color, height, roughness, emissive } = sampler.sample(x, y, texel);
      const bad = [
        !color.every((v) => inRange(v, 255)) && `color [${color.join(', ')}]`,
        !emissive.every((v) => inRange(v, 255)) && `emissive [${emissive.join(', ')}]`,
        !inRange(height, 1) && `height ${height}`,
        !inRange(roughness, 1) && `roughness ${roughness}`,
      ].filter(Boolean);
      if (!bad.length) continue;
      report.count++;
      report.first ||= `texel (${x}, ${y}) has ${bad.join(' and ')}`;
    }
  }
  return report;
}

/** The mean of each colour channel of a level, decoded as `encoding` says (linear light for sRGB). */
function meanOf(level: MipLevel, encoding: MipEncoding): number[] {
  const sums = [0, 0, 0];
  const count = level.width * level.height;
  for (let t = 0; t < count; t++) {
    for (let c = 0; c < 3; c++) {
      const b = level.data[t * 4 + c];
      sums[c] += encoding === 'srgb' ? SRGB_TO_LINEAR[b] : b / 255;
    }
  }
  return sums.map((sum) => sum / count);
}

/**
 * The problems of a mip chain for a `width` × `height` map, one sentence each: the wrong number of levels, a level
 * of the wrong size or data length, the last level not 1 × 1, a colour or roughness level whose mean drifts from
 * level 0's by more than `tolerance` (in linear units), or a normal more than 3% off unit length.
 */
export function mipProblems(levels: readonly MipLevel[], encoding: MipEncoding, tolerance = 2 / 255): string[] {
  const problems: string[] = [];
  const [w0, h0] = [levels[0]?.width ?? 0, levels[0]?.height ?? 0];
  if (levels.length !== mipCount(w0, h0)) {
    problems.push(`${levels.length} levels; a ${w0} × ${h0} map has ${mipCount(w0, h0)}`);
  }
  const base = encoding === 'normal' ? [] : meanOf(levels[0], encoding);
  levels.forEach((level, i) => {
    const [w, h] = [Math.max(1, w0 >> i), Math.max(1, h0 >> i)];
    if (level.width !== w || level.height !== h || level.data.length !== w * h * 4) {
      problems.push(
        `level ${i} is ${level.width} × ${level.height} (${level.data.length} bytes); it must be ${w} × ${h}`,
      );
      return;
    }
    if (encoding === 'normal') {
      for (let t = 0; t < w * h; t++) {
        const v = [0, 1, 2].map((c) => level.data[t * 4 + c] / 127.5 - 1);
        const length = Math.hypot(v[0], v[1], v[2]);
        if (Math.abs(length - 1) > 0.03) {
          problems.push(`level ${i} texel ${t} has a normal of length ${length.toFixed(3)}`);
          break;
        }
      }
      return;
    }
    const drift = Math.max(...meanOf(level, encoding).map((mean, c) => Math.abs(mean - base[c])));
    if (drift > tolerance) problems.push(`level ${i}'s mean drifts ${drift.toFixed(4)} from level 0's`);
  });
  const last = levels[levels.length - 1];
  if (last && (last.width !== 1 || last.height !== 1))
    problems.push(`the last level is ${last.width} × ${last.height}, not 1 × 1`);
  return problems;
}
