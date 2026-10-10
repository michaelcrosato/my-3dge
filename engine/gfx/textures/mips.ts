/**
 * @file Mipmaps on the CPU (PLAN.md WP 2.3, I-20): the full chain of a baked map down to 1 × 1, each level an
 * area-weighted box filter of the one above, computed in the right space for what the map holds. Colour maps
 * (`srgb`) are averaged in linear light, then encoded back to sRGB bytes, so a minified brick wall keeps its
 * brightness instead of darkening as averaging sRGB bytes would; `linear` maps (roughness) are averaged as they
 * are; `normal` maps are decoded to vectors, averaged and renormalised. Levels are filtered from the float level
 * above, never from its rounded bytes, so rounding never accumulates down the chain.
 *
 * Why on the CPU: three.js r182 generates mipmaps on the GPU with a render pipeline of its own, which would be built
 * after the warm-up, on the frame a texture first shows (a stall the pipeline budget counts, PLAN.md §8.7); a
 * texture with its levels in `mipmaps` builds none. The bake is also hashable this way.
 *
 * Invariants: level sizes halve and round down to 1 (WebGPU's), `mipCount(w, h)` levels in all; sRGB encoding is a
 * lookup by threshold (no `Math.pow` per texel), the exact inverse of the decoding table; alpha is averaged linearly.
 *
 * @example
 * const chain = mipChain(new Uint8Array(16).fill(255), 2, 2, 'srgb');
 * chain.map((level) => [level.width, level.height]); // [[2, 2], [1, 1]]
 * mipCount(48, 16); // 6: 48, 24, 12, 6, 3, 1 across
 * @see engine/gfx/textures/mips.test.ts
 */

/** What a map holds, which says how its levels are averaged. */
export type MipEncoding = 'srgb' | 'linear' | 'normal';

/** One level: RGBA bytes, row 0 at the bottom. */
export interface MipLevel {
  data: Uint8Array;
  width: number;
  height: number;
}

/** The sRGB transfer function, byte to linear. */
const decode = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** Each sRGB byte's linear value. */
export const SRGB_TO_LINEAR: Float32Array = Float32Array.from({ length: 256 }, (_, b) => decode(b / 255));

/** The linear value halfway between sRGB bytes b and b + 1, for encoding by threshold. */
const THRESHOLDS = Float64Array.from({ length: 255 }, (_, b) => decode((b + 0.5) / 255));

/** A linear value as the nearest sRGB byte. */
export function linearToSrgbByte(value: number): number {
  let low = 0;
  let high = 255;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (value < THRESHOLDS[mid]) high = mid;
    else low = mid + 1;
  }
  return low;
}

/** The number of levels of a `width` × `height` texture's full chain. */
export function mipCount(width: number, height: number): number {
  return Math.floor(Math.log2(Math.max(width, height))) + 1;
}

/** RGBA bytes decoded to floats in the space they are averaged in. */
function decodeLevel(data: Uint8Array, encoding: MipEncoding): Float32Array {
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const alpha = (i & 3) === 3;
    const b = data[i];
    out[i] = alpha
      ? b / 255
      : encoding === 'srgb'
        ? SRGB_TO_LINEAR[b]
        : encoding === 'normal'
          ? b / 127.5 - 1
          : b / 255;
  }
  return out;
}

/** Floats encoded back to RGBA bytes (normals renormalised first). */
function encodeLevel(values: Float32Array, encoding: MipEncoding): Uint8Array {
  const out = new Uint8Array(values.length);
  const clampByte = (v: number) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));
  for (let i = 0; i < values.length; i += 4) {
    if (encoding === 'normal') {
      const [x, y, z] = [values[i], values[i + 1], values[i + 2]];
      const length = Math.sqrt(x * x + y * y + z * z) || 1;
      out[i] = clampByte((x / length) * 127.5 + 127.5);
      out[i + 1] = clampByte((y / length) * 127.5 + 127.5);
      out[i + 2] = clampByte((z / length) * 127.5 + 127.5);
    } else {
      for (let c = 0; c < 3; c++) {
        const v = values[i + c];
        out[i + c] = encoding === 'srgb' ? linearToSrgbByte(v) : clampByte(v * 255);
      }
    }
    out[i + 3] = clampByte(values[i + 3] * 255);
  }
  return out;
}

/** The weights of an area-weighted box filter from `from` texels to `to` (to ≤ from), per destination texel. */
function weights(from: number, to: number): { start: number; weights: number[] }[] {
  const ratio = from / to;
  return Array.from({ length: to }, (_, i) => {
    const [lo, hi] = [i * ratio, (i + 1) * ratio];
    const start = Math.floor(lo);
    const list: number[] = [];
    for (let j = start; j < Math.ceil(hi); j++) list.push((Math.min(hi, j + 1) - Math.max(lo, j)) / ratio);
    return { start, weights: list };
  });
}

/** One float level filtered down to `to` = [width, height]. */
function downsample(values: Float32Array, width: number, height: number, to: readonly [number, number]): Float32Array {
  const [w2, h2] = to;
  const across = weights(width, w2);
  const up = weights(height, h2);
  const rows = new Float32Array(w2 * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < w2; x++) {
      const { start, weights: list } = across[x];
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let k = 0; k < list.length; k++) sum += list[k] * values[(y * width + start + k) * 4 + c];
        rows[(y * w2 + x) * 4 + c] = sum;
      }
    }
  }
  const out = new Float32Array(w2 * h2 * 4);
  for (let y = 0; y < h2; y++) {
    const { start, weights: list } = up[y];
    for (let x = 0; x < w2; x++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let k = 0; k < list.length; k++) sum += list[k] * rows[((start + k) * w2 + x) * 4 + c];
        out[(y * w2 + x) * 4 + c] = sum;
      }
    }
  }
  return out;
}

/**
 * The full mip chain of an RGBA map, level 0 (`data` itself) first, down to 1 × 1: each level the area-weighted box
 * filter of the float level above, averaged as `encoding` says (see the file comment).
 */
export function mipChain(data: Uint8Array, width: number, height: number, encoding: MipEncoding): MipLevel[] {
  const levels: MipLevel[] = [{ data, width, height }];
  let values = decodeLevel(data, encoding);
  let [w, h] = [width, height];
  while (w > 1 || h > 1) {
    const next: [number, number] = [Math.max(1, w >> 1), Math.max(1, h >> 1)];
    values = downsample(values, w, h, next);
    [w, h] = next;
    levels.push({ data: encodeLevel(values, encoding), width: w, height: h });
  }
  return levels;
}
