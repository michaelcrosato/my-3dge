/**
 * @file The ID pass's marks (PLAN.md §8.5, I-28; split from engine/gfx/idpass.ts after G9, ADR-0014 amendment 17):
 * `marksOf` numbers what the pass sees, largest first, and `drawMarks` draws the numbers onto a frame, for `x shot
 * --marks` (shardfall's `see`, `shardfall:crates/pav_tools/src/agent_tools.rs:26-224`, marking only what is seen).
 *
 * Invariants: pure functions of the pass and the frame's bytes; a mark is drawn inside the frame or skipped.
 *
 * @example
 * const pass = { visible: [{ id: 7, name: 'floor', px: 20, centre: [4, 2] }] } as unknown as IdPass;
 * marksOf(pass); // [{ n: 1, id: 7, name: 'floor', px: 20, at: [4, 2] }]
 * @see engine/gfx/idpass.test.ts
 */
import type { IdPass } from './idpass';

/** A numbered mark on what the ID pass sees, for the legend. */
export interface Mark {
  n: number;
  id: number;
  name: string;
  px: number;
  /** Where the mark is drawn: the object's `centre`. */
  at: [number, number];
}

/** Numbers the visible objects, largest first: at most `max` (40), each covering at least `minPx` (4) pixels. */
export function marksOf(pass: IdPass, options: { max?: number; minPx?: number } = {}): Mark[] {
  const { max = 40, minPx = 4 } = options;
  return pass.visible
    .filter((entry) => entry.px >= minPx)
    .slice(0, max)
    .map((entry, i) => ({ n: i + 1, id: entry.id, name: entry.name, px: entry.px, at: entry.centre }));
}

/** The digits 0–9 in a 3 × 5 pixel font, each 15 bits row by row, separated by spaces. */
const DIGITS =
  '111101101101111 010110010010111 111001111100111 111001111001111 101101111001001 111100111001111 111100111101111 111001001001001 111101111101111 111101111001111'.split(
    ' ',
  );
const MARK_COLOUR = [255, 230, 120];
const INK = [10, 10, 14];

/**
 * Draws each mark onto a frame of RGBA bytes (top row first): a ring around `at` and the number in a dark box above
 * it (below it at the top edge), at 2 × scale. Pixels outside the frame are skipped.
 */
export function drawMarks(rgba: Uint8Array, width: number, height: number, marks: readonly Mark[]): void {
  const put = (x: number, y: number, colour: number[], alpha = 1) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (Math.round(y) * width + Math.round(x)) * 4;
    for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(rgba[i + c] * (1 - alpha) + colour[c] * alpha);
    rgba[i + 3] = 255;
  };
  for (const { n, at } of marks) {
    const [cx, cy] = at;
    for (let dy = -9; dy <= 9; dy++) {
      for (let dx = -9; dx <= 9; dx++) {
        const d = Math.hypot(dx, dy);
        if (d >= 5.5 && d <= 7.5) put(cx + dx, cy + dy, MARK_COLOUR);
        else if (d > 7.5 && d <= 8.5) put(cx + dx, cy + dy, INK, 0.7);
      }
    }
    const text = String(n);
    const [scale, glyph] = [2, 8];
    const textWidth = text.length * glyph - 2;
    const left = Math.round(cx - textWidth / 2);
    const top = cy - 12 - 5 * scale >= 2 ? cy - 12 - 5 * scale : cy + 12;
    for (let y = top - 2; y < top + 5 * scale + 2; y++)
      for (let x = left - 2; x < left + textWidth + 2; x++) put(x, y, INK, 0.8);
    [...text].forEach((digit, k) => {
      const bits = DIGITS[Number(digit)];
      for (let bit = 0; bit < 15; bit++) {
        if (bits[bit] !== '1') continue;
        const [gx, gy] = [left + k * glyph + (bit % 3) * scale, top + Math.floor(bit / 3) * scale];
        for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) put(gx + sx, gy + sy, MARK_COLOUR);
      }
    });
  }
}
