/**
 * @file Look metrics (PLAN.md §8.5): how a frame looks, as numbers an agent reads without seeing it, and the notes
 * they raise, each a number plus a suggested fix. `lookMetrics(rgba, width, height, ids?)` measures a frame of
 * row-major RGBA bytes: coverage against empty space (the share of pixels that differ from the commonest colour by
 * more than 6 in some channel), the Rec. 709 luma mean and its P5 to P95 spread, the dark and blown-out shares, the
 * colour counts (exact colours, and the palette: 5-bit colours holding at least 0.1% of the frame), the flat share
 * (the commonest 5-bit colour), 1-pixel checkerboard dithering, edge density (pixels whose luma differs from the
 * right or lower neighbour by more than 0.1), the mean colour and the four commonest colours; with the ID pass
 * (engine/gfx/idpass.ts), the largest object's share and whether the protagonist is visible. `judgeLook(metrics,
 * where)` turns them into notes against `LOOK_LIMITS`: a blank frame fails, every other note warns.
 *
 * Pure and DOM-free: the page measures its shot (engine/gfx/shot.ts) and `x shot` measures a screenshot with the same
 * function, so Node tests cover it. Carried from `my-3d2dge:tools/check.mjs:40-50` (coverage, palette, flat,
 * checker, spread) and `my-3d2dge:tools/check.mjs:96-104` (the look notes, their limits and their fixes), retuned
 * for 3D frames (luma in [0, 1], the dark, blown-out and one-object notes added).
 *
 * Invariants: every share is in [0, 1], rounded to 4 decimals; the same bytes give the same metrics.
 *
 * @example
 * const metrics = lookMetrics(new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]), 2, 1); // coverage 0.5
 * judgeLook(metrics, 'a 2 × 1 frame').map((note) => note.id); // ['LOOK_FEW_COLOURS', 'LOOK_FLAT', 'LOOK_BLOWN']
 * @see engine/gfx/lookMetrics.test.ts
 */

/** What the ID pass tells the metrics: the visible objects with their shares, and the protagonist, if any. */
export interface LookIds {
  visible: readonly { name: string; share: number }[];
  protagonist: { name: string; px: number } | null;
}

/** The look metrics of one frame. */
export interface LookMetrics {
  width: number;
  height: number;
  /** Distinct RGBA colours. */
  colors: number;
  /** 5-bit colours that hold at least 0.1% of the pixels each. */
  palette: number;
  /** True when every pixel has the same colour. */
  blank: boolean;
  /** The commonest colour, `#rrggbb`. */
  background: string;
  /** The share of pixels that differ from the background by more than 6 in some channel. */
  coverage: number;
  /** The share of the commonest 5-bit colour. */
  flat: number;
  /** The share of 2 × 2 windows that are 1-pixel checkerboards (dithering). */
  checker: number;
  /** Rec. 709 luma of the 8-bit values, in [0, 1]: mean, 5th and 95th percentiles, and P95 − P5. */
  lumaMean: number;
  lumaP5: number;
  lumaP95: number;
  spread: number;
  /** The shares of pixels with luma under 0.05 (dark) and over 0.95 (blown out). */
  dark: number;
  blown: number;
  /** Edge density: the share of pixels whose luma differs from the right or lower neighbour by more than 0.1. */
  edges: number;
  /** The mean colour, `#rrggbb`. */
  meanColor: string;
  /** The four commonest colours at 3 bits per channel (each the centre of its bin), with their shares. */
  histogram: string;
  /** The object covering the most pixels (ID pass); null without the ID pass or when nothing is visible. */
  largest: string | null;
  /** Its share of the frame; null like `largest`. */
  largestShare: number | null;
  /** Whether the protagonist covers any pixel; null without the ID pass or without a protagonist. */
  protagonist: boolean | null;
}

/** A note on a frame: its id, whether it fails, the number and its limit, and the sentence with the fix. */
export interface LookNote {
  id: string;
  level: 'fail' | 'warn';
  value: number;
  limit: number;
  message: string;
}

/** The limits the notes use (shares in [0, 1], luma spread in [0, 1], the palette in colours). */
export const LOOK_LIMITS = {
  /** Coverage under this: almost nothing is drawn. */
  empty: 0.005,
  /** Coverage under this: the frame is almost empty (check.mjs: 6%). */
  sparse: 0.06,
  /** Fewer palette colours than this: flat shading (check.mjs: 40). */
  palette: 40,
  /** One 5-bit colour over this share: a flat expanse (check.mjs: 40%). */
  flat: 0.4,
  /** Checkerboard windows over this share: dithering (check.mjs: 6%). */
  checker: 0.06,
  /** Luma spread under this: low contrast (check.mjs: 70 of 255). */
  spread: 0.27,
  /** Near-black pixels over this share. */
  dark: 0.5,
  /** Blown-out pixels over this share. */
  blown: 0.05,
  /** One object over this share: the camera is inside or against it (§8.5). */
  oneObject: 0.7,
} as const;

/** A pixel counts as background when no channel differs from the background colour by more than this. */
const BACKGROUND_TOLERANCE = 6;
/** Neighbouring lumas further apart than this make an edge. */
const EDGE_STEP = 0.1;

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
const round = (value: number) => Math.round(value * 10_000) / 10_000;
const percent = (share: number, digits = 0) => `${(share * 100).toFixed(digits)}%`;

/** Measures a frame of row-major RGBA bytes (4 a pixel), with the ID pass's objects when given. */
export function lookMetrics(rgba: Uint8Array, width: number, height: number, ids?: LookIds): LookMetrics {
  const pixels = width * height;
  if (pixels === 0 || rgba.length < pixels * 4)
    throw new Error(`lookMetrics: ${rgba.length} bytes for ${width}×${height}`);
  const counts = new Map<number, number>();
  const bins5 = new Map<number, number>();
  const bins3 = new Map<number, number>();
  const key5 = new Int32Array(pixels);
  const luma = new Float32Array(pixels);
  const lumaBuckets = new Uint32Array(256);
  const sum = [0, 0, 0];
  let lumaSum = 0;
  let dark = 0;
  let blown = 0;
  for (let p = 0, i = 0; p < pixels; p++, i += 4) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const key = ((r << 16) | (g << 8) | b) * 256 + rgba[i + 3];
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const k5 = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    key5[p] = k5;
    bins5.set(k5, (bins5.get(k5) ?? 0) + 1);
    const k3 = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    bins3.set(k3, (bins3.get(k3) ?? 0) + 1);
    const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    luma[p] = l;
    lumaBuckets[Math.min(255, Math.round(l * 255))]++;
    lumaSum += l;
    if (l < 0.05) dark++;
    if (l > 0.95) blown++;
    sum[0] += r;
    sum[1] += g;
    sum[2] += b;
  }
  let backgroundKey = 0;
  let backgroundCount = -1;
  for (const [key, count] of counts) if (count > backgroundCount) [backgroundKey, backgroundCount] = [key, count];
  const background = [(backgroundKey / 2 ** 24) & 255, (backgroundKey / 2 ** 16) & 255, (backgroundKey / 256) & 255];
  let covered = 0;
  let edges = 0;
  for (let p = 0, i = 0; p < pixels; p++, i += 4) {
    if ([0, 1, 2].some((c) => Math.abs(rgba[i + c] - background[c]) > BACKGROUND_TOLERANCE)) covered++;
    const x = p % width;
    const right = x + 1 < width && Math.abs(luma[p] - luma[p + 1]) > EDGE_STEP;
    const below = p + width < pixels && Math.abs(luma[p] - luma[p + width]) > EDGE_STEP;
    if (right || below) edges++;
  }
  let checker = 0;
  let windows = 0;
  for (let y = 0; y + 1 < height; y += 2) {
    for (let x = 0; x + 1 < width; x += 2) {
      const p = y * width + x;
      const [a, b, c, d] = [key5[p], key5[p + 1], key5[p + width], key5[p + width + 1]];
      windows++;
      if (a !== b && a === d && b === c) checker++;
    }
  }
  let top5 = 0;
  let palette = 0;
  for (const count of bins5.values()) {
    top5 = Math.max(top5, count);
    if (count >= pixels * 0.001) palette++;
  }
  const percentile = (p: number) => {
    let seen = 0;
    for (let bucket = 0; bucket < 256; bucket++) {
      seen += lumaBuckets[bucket];
      if (seen >= p * pixels) return bucket / 255;
    }
    return 1;
  };
  const centre = (bits: number) => (bits << 5) + 16;
  const histogram = [...bins3.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 4)
    .map(([bin, count]) => {
      const colour = hex(centre(bin >> 6), centre((bin >> 3) & 7), centre(bin & 7));
      return `${colour} ${(Math.round((count / pixels) * 1000) / 10).toFixed(1)}%`;
    })
    .join(', ');
  const [lumaP5, lumaP95] = [round(percentile(0.05)), round(percentile(0.95))];
  const largest = ids?.visible.reduce<LookIds['visible'][number] | null>(
    (best, entry) => (best === null || entry.share > best.share ? entry : best),
    null,
  );
  return {
    width,
    height,
    colors: counts.size,
    palette,
    blank: counts.size <= 1,
    background: hex(background[0], background[1], background[2]),
    coverage: round(covered / pixels),
    flat: round(top5 / pixels),
    checker: round(checker / Math.max(1, windows)),
    lumaMean: round(lumaSum / pixels),
    lumaP5,
    lumaP95,
    spread: round(lumaP95 - lumaP5),
    dark: round(dark / pixels),
    blown: round(blown / pixels),
    edges: round(edges / pixels),
    meanColor: hex(sum[0] / pixels, sum[1] / pixels, sum[2] / pixels),
    histogram,
    largest: largest?.name ?? null,
    largestShare: largest ? round(largest.share) : null,
    protagonist: ids?.protagonist ? ids.protagonist.px > 0 : null,
  };
}

/**
 * The notes on `metrics`, `where` naming the frame in each sentence (`tests/pages/shot.html from cam iso`), and the
 * ID pass's objects, when measured, naming the protagonist: a blank frame fails (and is the only note); the others
 * warn, each with its number, its limit and a fix.
 */
export function judgeLook(metrics: LookMetrics, where = 'the frame', ids?: LookIds): LookNote[] {
  const L = LOOK_LIMITS;
  const size = `${metrics.width}×${metrics.height}`;
  if (metrics.blank) {
    const message = `${where} drew a blank frame: all ${size} pixels are ${metrics.background}. Draw before signalling ready, and check that the camera sees the scene`;
    return [{ id: 'LOOK_BLANK', level: 'fail', value: metrics.coverage, limit: 0, message }];
  }
  const notes: LookNote[] = [];
  const warn = (id: string, value: number, limit: number, message: string) =>
    notes.push({ id, level: 'warn', value, limit, message });
  if (metrics.coverage < L.empty) {
    warn(
      'LOOK_EMPTY',
      metrics.coverage,
      L.empty,
      `${where} drew almost nothing: ${percent(metrics.coverage, 2)} of ${size} differs from the background ${metrics.background}; check the camera and the scene's scale`,
    );
  } else if (metrics.coverage < L.sparse) {
    warn(
      'LOOK_SPARSE',
      metrics.coverage,
      L.sparse,
      `${where} is almost empty: ${percent(metrics.coverage, 1)} of the frame differs from the background ${metrics.background} (aim for ${percent(L.sparse)}+); move the camera closer or frame the subject`,
    );
  }
  if (metrics.palette < L.palette) {
    warn(
      'LOOK_FEW_COLOURS',
      metrics.palette,
      L.palette,
      `only ${metrics.palette} distinct colours in ${where} (aim for ${L.palette}+): light with a key and a fill light, give materials texture or vertex colour, add props`,
    );
  }
  if (metrics.flat > L.flat) {
    warn(
      'LOOK_FLAT',
      metrics.flat,
      L.flat,
      `${percent(metrics.flat)} of ${where} is one flat colour (limit ${percent(L.flat)}): fill it with a sky or backdrop, textured ground or props`,
    );
  }
  if (metrics.checker > L.checker) {
    warn(
      'LOOK_DITHER',
      metrics.checker,
      L.checker,
      `${percent(metrics.checker)} of ${where} is 1-pixel checkerboard dithering (limit ${percent(L.checker)}): blend transparency instead of dithering it`,
    );
  }
  if (metrics.spread < L.spread) {
    warn(
      'LOOK_LOW_CONTRAST',
      metrics.spread,
      L.spread,
      `low contrast in ${where}: luma spread ${metrics.spread} (aim for ${L.spread}+): darker shadows, brighter highlights`,
    );
  }
  if (metrics.dark > L.dark) {
    warn(
      'LOOK_DARK',
      metrics.dark,
      L.dark,
      `${percent(metrics.dark)} of ${where} is near black (limit ${percent(L.dark)}): add a fill or hemisphere light, or raise the exposure`,
    );
  }
  if (metrics.blown > L.blown) {
    warn(
      'LOOK_BLOWN',
      metrics.blown,
      L.blown,
      `${percent(metrics.blown)} of ${where} is blown out (limit ${percent(L.blown)}): lower the light intensities or the exposure`,
    );
  }
  if (metrics.largestShare !== null && metrics.largestShare > L.oneObject) {
    warn(
      'LOOK_ONE_OBJECT',
      metrics.largestShare,
      L.oneObject,
      `one object covers ${percent(metrics.largestShare)} of ${where}: ${metrics.largest} (limit ${percent(L.oneObject)}); the camera may be inside or against it`,
    );
  }
  if (metrics.protagonist === false) {
    warn(
      'LOOK_NO_PROTAGONIST',
      0,
      1,
      `the protagonist ${ids?.protagonist?.name ?? ''} covers 0 px in ${where}: move the camera, or read why from the ID pass (it lists the protagonist as unseen, with the reason)`.replace(
        '  ',
        ' ',
      ),
    );
  }
  return notes;
}
