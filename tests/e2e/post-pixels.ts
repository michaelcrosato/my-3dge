/**
 * @file Pixel arithmetic for the post-processing T2 (tests/e2e/post.spec.ts): shots as RGBA bytes, which pixels
 * changed, the parts view read back as a part per pixel, the pixels near a part or another part, the ID pass as
 * compared, the edge error that chose the edge smoothing and the reference it is measured against. Pure functions
 * of their arguments, no page.
 *
 * Invariants: colours compare by channel, a pixel "changed" when a channel moved by more than `DIFF` levels; parts
 * are 0 a character, 1 an object, 2 the environment (the background included).
 */
import type { IdEntry } from '../../engine/gfx/idpass';

/** A channel moving by more than this many levels changes a pixel. */
export const DIFF = 8;

/** A shot as the page returns it. */
export interface Shot {
  width: number;
  height: number;
  pixels?: string;
  ids?: { visible: IdEntry[] };
}

/** A shot's pixels. */
export function rgba(shot: Shot | string): Uint8Array {
  return new Uint8Array(Buffer.from(typeof shot === 'string' ? shot : shot.pixels!, 'base64'));
}

/** Whether pixel `p` differs between `a` and `b` by more than `diff` in some channel. */
export function differs(a: Uint8Array, b: Uint8Array, p: number, diff = DIFF): boolean {
  return [0, 1, 2].some((c) => Math.abs(a[p * 4 + c] - b[p * 4 + c]) > diff);
}

/** The share of pixels that differ. */
export function changedShare(a: Uint8Array, b: Uint8Array): number {
  let n = 0;
  for (let p = 0; p < a.length / 4; p++) if (differs(a, b, p)) n++;
  return n / (a.length / 4);
}

/** The parts view as a part per pixel: 0 a character, 1 an object, 2 the environment (the background included). */
export function partsOf(shot: Shot): Uint8Array {
  const px = rgba(shot);
  const out = new Uint8Array(shot.width * shot.height);
  for (let p = 0; p < out.length; p++) out[p] = px[p * 4] > 128 ? 0 : px[p * 4 + 1] > 128 ? 1 : 2;
  return out;
}

/** Whether each pixel has another part within `r` pixels. */
export function borderOf(parts: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const near = new Uint8Array(parts.length);
  const mark = (x: number, y: number) => {
    for (let yy = Math.max(0, y - r); yy <= Math.min(height - 1, y + r); yy++)
      near.fill(1, yy * width + Math.max(0, x - r), yy * width + Math.min(width, x + r + 1));
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if ((x > 0 && parts[p - 1] !== parts[p]) || (y > 0 && parts[p - width] !== parts[p])) mark(x, y);
    }
  }
  return near;
}

/** Whether each pixel has a pixel of `part` within `r` pixels. */
export function nearPart(parts: Uint8Array, width: number, height: number, part: number, r: number): Uint8Array {
  const near = new Uint8Array(parts.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (parts[y * width + x] !== part) continue;
      for (let yy = Math.max(0, y - r); yy <= Math.min(height - 1, y + r); yy++)
        near.fill(1, yy * width + Math.max(0, x - r), yy * width + Math.min(width, x + r + 1));
    }
  }
  return near;
}

/** A pixel's luma. */
export function lumaAt(px: Uint8Array, p: number): number {
  return 0.2126 * px[p * 4] + 0.7152 * px[p * 4 + 1] + 0.0722 * px[p * 4 + 2];
}

/** The ID pass's visible list, as compared: name, pixels and bounding box. */
export function idsOf(shot: Shot): string[] {
  return shot.ids!.visible.map((entry) => `${entry.name}:${entry.px}:${entry.bbox.join(',')}`).sort();
}

/** Mean absolute luma error against the reference, over the pixels where `none` misses it by more than 8. */
export function edgeError(shot: Uint8Array, none: Uint8Array, reference: Uint8Array): number {
  const luma = (px: Uint8Array, p: number) => 0.2126 * px[p * 4] + 0.7152 * px[p * 4 + 1] + 0.0722 * px[p * 4 + 2];
  let sum = 0;
  let n = 0;
  for (let p = 0; p < none.length / 4; p++) {
    if (Math.abs(luma(none, p) - luma(reference, p)) <= 8) continue;
    sum += Math.abs(luma(shot, p) - luma(reference, p));
    n++;
  }
  return sum / Math.max(1, n);
}

/** `big`, drawn at `by` × `by` the size of a `width` × `height` shot, averaged down to that size. */
export function averageDown(big: Uint8Array, width: number, height: number, by: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let dy = 0; dy < by; dy++)
          for (let dx = 0; dx < by; dx++) sum += big[((y * by + dy) * width * by + x * by + dx) * 4 + c];
        out[(y * width + x) * 4 + c] = Math.round(sum / (by * by));
      }
    }
  }
  return out;
}
