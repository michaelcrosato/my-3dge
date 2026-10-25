/**
 * @file A GPU crowd's regions (PLAN.md WP 11.4): the CPU's half of its instance buffer (engine/gfx/enhanced/
 * crowdNodes.ts `crowdSource`), shared by its batches (engine/gfx/enhanced/crowds.ts). Each batch owns a region, a
 * whole number of blocks of 64 slots, the regions laid end to end in the order the batches were made.
 * - **Writes** go into a slot's 16 floats (the rows of a 3 × 4 matrix, then the colour), each value rounded to a float
 *   and kept only when it differs, as the instancing service's are; a slot that changed marks its region's range, and
 *   `flush` uploads each region's changed range alone, so a frame that changes nothing uploads nothing.
 * - **Room:** a region that fills up doubles, moving the regions after it; when the buffer has no room for that, the
 *   regions are packed again (each to its instances and a quarter more), and only when even that does not fit is the
 *   slot refused (`at` gives -1: the caller drops the instance). Moved regions are uploaded whole.
 * - **The layout** (`lay`): the blocks the cull covers (each with its batch and first slot), each region's start,
 *   instances, first block and blocks, and each batch's indirect arguments: its index or vertex count, then its first
 *   instance, the region's start.
 *
 * Invariants: a region's slots are a multiple of the block, its start the sum of the slots before it; the CPU's array
 * is the uploaded copy, so a value equal to it needs no upload; nothing is read back.
 *
 * @example
 * // const regions = createCrowdRegions(buffers); const region = regions.add(3, true);
 * // regions.writeMatrix(region, 0, matrix.elements); regions.writeColor(region, 0, [1, 0, 0]);
 * // region.shown = 1; regions.lay(); regions.flush();
 * @see engine/gfx/enhanced/crowds.test.ts
 */
import type { Matrix4 } from 'three/webgpu';
import type { InstanceColor } from '../instancing';
import { arrayOf, CROWD_ARGS, CROWD_BLOCK, upload, type CrowdBuffers } from './crowdNodes';

/** Floats a slot takes: four vec4. */
export const SLOT_FLOATS = 16;

/** One batch's part of the buffer: where it lies, its instances now and at the last `end`, its changed range. */
export interface CrowdRegion {
  readonly index: number;
  /** Indices (or vertices) a draw of its shape takes, and whether they are indices. */
  readonly draws: number;
  readonly indexed: boolean;
  start: number;
  slots: number;
  /** Instances written this frame so far. */
  count: number;
  /** Instances the last `end` showed. */
  shown: number;
  /** The slots changed since the last upload: from `low` to `high`, none while `high <= low`. */
  low: number;
  high: number;
  /** Bytes its last upload took. */
  uploaded: number;
  gone: boolean;
}

/** A GPU crowd's regions (see the file comment). */
export interface CrowdRegions {
  readonly list: readonly CrowdRegion[];
  /** Whether the layout changed since the last `lay`. */
  laid: boolean;
  /** Adds an empty region for a batch whose shape draws `draws` indices (or vertices, not `indexed`). */
  add(draws: number, indexed: boolean): CrowdRegion;
  /** The slots the regions take. */
  taken(): number;
  /** The float where slot `slot` of `region` starts, room made for it; -1 when the buffer has none. */
  at(region: CrowdRegion, slot: number): number;
  /** Writes slot `slot`'s matrix (column-major, from `offset`); false when the buffer has no room for it. */
  writeMatrix(region: CrowdRegion, slot: number, matrix: ArrayLike<number>, offset?: number): boolean;
  /** Writes slot `slot`'s colour (white when left out). */
  writeColor(region: CrowdRegion, slot: number, color: InstanceColor | undefined): void;
  /** Writes slot `slot`'s matrix and colour at once, as a batch's `add` does; false when the buffer has no room. */
  write(region: CrowdRegion, slot: number, matrix: ArrayLike<number>, offset: number, color: InstanceColor | undefined): boolean; // prettier-ignore
  /** Reads slot `slot`'s matrix into `out`. */
  matrixAt(region: CrowdRegion, slot: number, out: Matrix4): Matrix4;
  /** Writes the blocks, layout and arguments; returns the blocks the cull covers. */
  lay(): number;
  /** Uploads every region's changed range; returns the bytes. */
  flush(): number;
}

const WHITE = [1, 1, 1];
/** Slots rounded up to whole blocks, at least one. */
const blocksOf = (slots: number) => Math.max(1, Math.ceil(slots / CROWD_BLOCK)) * CROWD_BLOCK;

/** Makes a GPU crowd's regions over `buffers` (see the file comment). */
export function createCrowdRegions(buffers: CrowdBuffers): CrowdRegions {
  const { capacity } = buffers;
  const source = arrayOf<Float32Array>(buffers.source);
  const blocks = arrayOf<Uint32Array>(buffers.blocks);
  const layout = arrayOf<Uint32Array>(buffers.layout);
  const args = buffers.indirect.array as Uint32Array;
  const list: CrowdRegion[] = [];
  const taken = () => list.reduce((sum, region) => sum + region.slots, 0);
  /** The slots of `region` that hold instances worth keeping. */
  const kept = (region: CrowdRegion) => Math.min(region.slots, Math.max(region.count, region.shown));

  /** Packs every region again, each to its instances and a quarter more, `grower` to `need`; false if it cannot. */
  const repack = (grower: CrowdRegion, need: number): boolean => {
    const wanted = (region: CrowdRegion) =>
      region.gone ? 0 : blocksOf(Math.ceil((region === grower ? need : kept(region)) * 1.25));
    if (list.reduce((sum, region) => sum + wanted(region), 0) > capacity) return false;
    const old = source.slice(0, taken() * SLOT_FLOATS);
    let start = 0;
    for (const region of list) {
      const keep = region.gone ? 0 : kept(region);
      source.set(old.subarray(region.start * SLOT_FLOATS, (region.start + keep) * SLOT_FLOATS), start * SLOT_FLOATS);
      [region.start, region.slots, region.low, region.high] = [start, wanted(region), 0, keep];
      start += region.slots;
    }
    regions.laid = true;
    return true;
  };
  /** Gives `region` room for `need` slots, doubling it and moving the regions after it, else packing all again. */
  const room = (region: CrowdRegion, need: number): boolean => {
    if (need <= region.slots) return true;
    const slots = blocksOf(Math.max(need, region.slots * 2));
    const grow = slots - region.slots;
    const end = taken();
    if (end + grow > capacity) return repack(region, need);
    const from = region.start + region.slots;
    source.copyWithin((from + grow) * SLOT_FLOATS, from * SLOT_FLOATS, end * SLOT_FLOATS);
    for (const other of list.slice(region.index + 1)) [other.start, other.low, other.high] = [other.start + grow, 0, kept(other)]; // prettier-ignore
    [region.slots, regions.laid] = [slots, true];
    return true;
  };
  /** Writes `value` at float `to`; whether it changed. */
  const put = (to: number, value: number): boolean => {
    const v = Math.fround(value);
    if (source[to] === v) return false;
    source[to] = v;
    return true;
  };
  /** Marks `slot` of `region` changed. */
  const mark = (region: CrowdRegion, slot: number) => {
    region.low = Math.min(region.low, slot);
    region.high = Math.max(region.high, slot + 1);
  };
  /** Writes the matrix's three rows at float `to`; whether a value changed. */
  const rows = (to: number, m: ArrayLike<number>, o: number): boolean => {
    let changed = false;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) changed = put(to + r * 4 + c, m[o + c * 4 + r]) || changed;
    return changed;
  };
  /** Writes the colour (white when left out) at float `to`; whether a value changed. */
  const colour = (to: number, color: InstanceColor | undefined): boolean => {
    const rgb = !color ? WHITE : 'r' in color ? [color.r, color.g, color.b] : color;
    let changed = put(to + 15, 1);
    for (let k = 0; k < 3; k++) changed = put(to + 12 + k, rgb[k]) || changed;
    return changed;
  };

  const regions: CrowdRegions = {
    list,
    laid: true,
    add(draws, indexed) {
      const region: CrowdRegion = { index: list.length, draws, indexed, start: taken(), slots: 0, count: 0, shown: 0, low: Infinity, high: 0, uploaded: 0, gone: false }; // prettier-ignore
      list.push(region);
      regions.laid = true;
      return region;
    },
    taken,
    at: (region, slot) => (room(region, slot + 1) ? (region.start + slot) * SLOT_FLOATS : -1),
    writeMatrix(region, slot, m, o = 0) {
      const to = regions.at(region, slot);
      if (to < 0) return false;
      if (rows(to, m, o)) mark(region, slot);
      return true;
    },
    writeColor(region, slot, color) {
      const to = regions.at(region, slot);
      if (to >= 0 && colour(to, color)) mark(region, slot);
    },
    write(region, slot, m, o, color) {
      const to = slot < region.slots ? (region.start + slot) * SLOT_FLOATS : regions.at(region, slot);
      if (to < 0) return false;
      const moved = rows(to, m, o);
      if (colour(to, color) || moved) mark(region, slot);
      return true;
    },
    matrixAt(region, slot, out) {
      const f = (region.start + slot) * SLOT_FLOATS;
      const r = (k: number) => source[f + k];
      return out.set(r(0), r(1), r(2), r(3), r(4), r(5), r(6), r(7), r(8), r(9), r(10), r(11), 0, 0, 0, 1);
    },
    lay() {
      let block = 0;
      for (const region of list) {
        const first = block;
        const many = region.gone ? 0 : Math.ceil(region.shown / CROWD_BLOCK);
        for (let k = 0; k < many; k++, block++) {
          blocks[block * 2] = region.index;
          blocks[block * 2 + 1] = region.start + k * CROWD_BLOCK;
        }
        const [l, a] = [region.index * 4, region.index * CROWD_ARGS];
        [layout[l], layout[l + 1], layout[l + 2], layout[l + 3]] = [region.start, region.shown, first, many];
        args.fill(0, a, a + CROWD_ARGS);
        args[a] = region.draws;
        args[a + (region.indexed ? 4 : 3)] = region.start; // the first instance: drawIndexedIndirect's fifth word, drawIndirect's fourth
      }
      upload(buffers.blocks, 0, Math.max(1, block) * 2);
      upload(buffers.layout, 0, list.length * 4);
      upload(buffers.indirect, 0, list.length * CROWD_ARGS);
      regions.laid = false;
      return block;
    },
    flush() {
      let bytes = 0;
      for (const region of list) {
        region.uploaded = 0;
        if (region.high <= region.low) continue;
        const floats = (region.high - region.low) * SLOT_FLOATS;
        upload(buffers.source, (region.start + region.low) * SLOT_FLOATS, floats);
        region.uploaded = floats * 4;
        region.low = Infinity;
        region.high = 0;
        bytes += floats * 4;
      }
      return bytes;
    },
  };
  return regions;
}
