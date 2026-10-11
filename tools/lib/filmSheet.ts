/**
 * @file The contact sheet of `x film` (tools/cmd/film.ts, PLAN.md WP 3.11): frames laid out in columns, each labelled
 * in a 3 × 5 pixel font drawn in Node (no canvas, no font file), with the base's frames and a diff row (A in grey, each
 * differing pixel in magenta) when the film was compared.
 *
 * @example
 * const frame = { n: 1, tick: 60, width: 8, height: 8, rgba: new Uint8Array(8 * 8 * 4), visible: [] };
 * const sheet = contactSheet([frame, frame], { cols: 8 });
 * [sheet.width, sheet.height]; // [28, 30]: two frames and their labels, 4 px apart
 * @see tools/cmd/film.test.ts
 */
import { samePixel, type FilmFrame, type FrameDiff } from './filmCompare';

/** The sheet's colours (background, labels, "same") and the space around frames, in pixels. */
const [BACK, INK, GREEN, PAD] = [[27, 27, 36, 255], [200, 200, 224], [122, 216, 138], 4] as const;
/** The colour of a pixel that differs from the base's, on the sheet's diff row. */
export const MAGENTA = [255, 40, 220] as const;
/** The height of a label under a frame, in pixels: the 3 × 5 font at twice its size, with a margin. */
export const LABEL = 14;

/** The 3 × 5 font: each glyph's five rows of three bits (the left pixel highest), as three base-36 digits. */
const GLYPHS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ#.:-/=?,%()@_+><\'"';
const FONT =
  'odr8t3mw7mofi4po27o33mmqohbogf8odl9qbabl7yo13o10bcbi5pn133myi3xeg7iy5l7x8kql9g8kzl9pb66n0yi27i22i65hwthw2mnbiv1' +
  '0020sw0cg3ok2t4mma00kgbp429djo8o300715cdhw45t740hs0';

/** A contact sheet, or any RGBA image: its size and its pixels, row-major. */
export interface Sheet {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/** Draws `text` in upper case on `sheet` at `at`, each font pixel 2 × 2, cut before x `clip`; `?` for other glyphs. */
export function drawText(sheet: Sheet, at: [number, number], text: string, colour: readonly number[], clip = Infinity) {
  for (const [k, char] of [...text.toUpperCase().replace(/×/g, 'X')].entries()) {
    const glyph = GLYPHS.includes(char) ? GLYPHS.indexOf(char) : GLYPHS.indexOf('?');
    const bits = char === ' ' ? 0 : parseInt(FONT.slice(glyph * 3, glyph * 3 + 3), 36);
    for (let p = 0; p < 60; p++) {
      const [x, y] = [at[0] + (k * 4 + ((p >> 2) % 3)) * 2 + (p & 1), at[1] + Math.floor(p / 12) * 2 + ((p >> 1) & 1)];
      if (bits & (1 << (14 - (p >> 2))) && x < Math.min(clip, sheet.width) && y < sheet.height)
        sheet.rgba.set(colour, (y * sheet.width + x) * 4);
    }
  }
}

/** How to lay a sheet out: in `cols` columns; with the base's frames and the diffs, rows A, B and the diff. */
interface SheetOptions {
  cols: number;
  base?: readonly FilmFrame[];
  diffs?: readonly FrameDiff[];
}

/** Lays frames out in `cols` columns, each labelled; with the base's frames and the diffs, rows A, B and the diff. */
export function contactSheet(frames: readonly FilmFrame[], options: SheetOptions): Sheet {
  const [w, h, rows, cols] = [frames[0].width, frames[0].height, options.base ? 3 : 1, options.cols];
  const cell = h + LABEL + PAD;
  const width = Math.min(cols, frames.length) * (w + PAD) + PAD;
  const height = Math.ceil(frames.length / cols) * rows * cell + PAD;
  const sheet = { width, height, rgba: new Uint8Array(width * height * 4) };
  const { rgba } = sheet;
  for (let p = 0; p < rgba.length; p += 4) rgba.set(BACK, p);
  const blit = (frame: FilmFrame, x0: number, y0: number, other?: Uint8Array) => {
    for (let y = 0; y < Math.min(h, frame.height); y++) {
      for (let x = 0; x < Math.min(w, frame.width); x++) {
        const [q, to] = [(y * frame.width + x) * 4, ((y0 + y) * width + x0 + x) * 4];
        const grey = Math.round((frame.rgba[q] + frame.rgba[q + 1] + frame.rgba[q + 2]) / 9 + 20);
        if (!other) rgba.set(frame.rgba.subarray(q, q + 4), to);
        else rgba.set(samePixel(frame.rgba, other, q) ? [grey, grey, grey, 255] : [...MAGENTA, 255], to);
      }
    }
  };
  for (const [i, frame] of frames.entries()) {
    const [x0, y0] = [PAD + (i % cols) * (w + PAD), PAD + Math.floor(i / cols) * rows * cell];
    const label = (row: number, text: string, colour: readonly number[] = INK) =>
      drawText(sheet, [x0, y0 + row * cell + h + 2], text, colour, x0 + w);
    blit(frame, x0, y0);
    label(0, `${options.base ? 'A ' : ''}frame ${frame.n}, tick ${frame.tick}`);
    const [b, d] = [options.base?.[i], options.diffs?.[i]];
    if (b) blit(b, x0, y0 + cell);
    if (b) label(1, `B frame ${b.n}, tick ${b.tick}`);
    if (!d) continue;
    if (b && d.px >= 0) blit(frame, x0, y0 + 2 * cell, b.rgba);
    const top = Object.entries(d.objects).sort((p, q) => q[1] - p[1])[0]?.[0];
    const text = d.px < 0 ? `${d.size}` : d.px ? `${d.px} px differ: ${top}` : 'same';
    label(d.px < 0 && !b ? 1 : 2, text, d.px ? MAGENTA : GREEN);
  }
  return sheet;
}
