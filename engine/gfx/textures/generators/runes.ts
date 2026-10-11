/**
 * @file The rune generator (`texture:runes`, PLAN.md WP 7.3): flagstones (engine/gfx/textures/generators/
 * flagstone.ts, every one of its parameters, in the hall's dusky palette) with a rune circle inlaid at the middle of
 * each `cell`: an outer and an inner ring, spokes between them, a rune in each sector between the spokes, and a
 * bright disc at the centre. The circle is the texture's emissive map: rings and spokes glow faintly in the inlay's
 * colour, the runes and the disc brightly; materials light it with `emissive` and `emissiveIntensity`. The inlay sits
 * a little below the stones and is smoother than them.
 *
 * `runeCircle(options)` is the circle itself, as marks at whole-texel offsets from a centre on a texel corner, and
 * `paintRune` writes a mark onto a texel; the level floor bake (engine/gfx/textures/contactShadow.ts) puts a circle on
 * each dais with them.
 *
 * Carried from the hall floor's rune circle (`my-3d2dge:src/stress-world/10-hall.js:205-216`: rings at 43 and 54
 * texels, sixteen spokes, the bright centre, the colours and the glow, 0.45 on the lines and 1 on the runes),
 * rewritten: periodic (one circle per cell), y up, no trigonometry (spoke directions from half-angle square roots and
 * rotations, the same bits in every runtime), straight one-texel spokes instead of wedges, and drawn runes (eight
 * 5 × 5 glyphs after the Elder Futhark, one hashed per sector) where the prototype scattered dithered texels.
 *
 * Invariants: tiles at whole cells and whole flagstone rows (`tile`); the circle is clipped to its cell; a sector gets
 * a rune only when the band between the rings and the gap between spokes hold one.
 *
 * @example
 * RUNES.size; // [128, 128]: one circle on eight by eight flagstones
 * runeCircle({ radius: 54, inner: 43, spokes: 16 })(53, 0); // 1: on the outer ring (texel centre 53.5 out)
 * @see engine/gfx/textures/generators/v2.test.ts
 */
import type { Rgb } from '../../../core/color';
import { cellHash, palette, wrapIndex } from '../tile';
import { textureSpec, type Texel } from '../types';
import { FLAGSTONE } from './flagstone';

/** Eight runes, 5 × 5, top row first (`#` inlaid): tiwaz, algiz, thurisaz, othala, dagaz, raido, gebo, sowilo. */
const GLYPHS: readonly (readonly string[])[] = [
  ['..#..', '.###.', '#.#.#', '..#..', '..#..'],
  ['#.#.#', '.###.', '..#..', '..#..', '..#..'],
  ['#....', '##...', '#.#..', '##...', '#....'],
  ['..#..', '.#.#.', '..#..', '.#.#.', '#...#'],
  ['#...#', '##.##', '#.#.#', '##.##', '#...#'],
  ['###..', '#..#.', '###..', '#.#..', '#..#.'],
  ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  ['..#..', '.#...', '..#..', '...#.', '..#..'],
];
/** A rune's side, in texels. */
const GLYPH = 5;

/** What a texel of a rune circle is: nothing, a faint line (ring or spoke), or a bright rune or the centre. */
export type RuneMark = 0 | 1 | 2;

/** The shape of a rune circle, in texels. */
export interface RuneCircleOptions {
  /** The outer ring's radius. */
  radius: number;
  /** The inner ring's radius. */
  inner: number;
  /** The number of spokes: 4, 8, 16 or 32. */
  spokes: number;
  /** Picks each sector's rune. */
  seed?: number;
}

/**
 * Unit directions every π/`spokes` round from +x (spokes at even indices, the sectors' bisectors at odd ones), from
 * square roots and rotations only: half-angle steps from π/2 down to π/spokes, then repeated rotation.
 */
function directions(spokes: number): [number, number][] {
  let [c, s] = [0, 1];
  for (let angle = 2; angle < spokes; angle *= 2) [c, s] = [Math.sqrt((1 + c) / 2), Math.sqrt((1 - c) / 2)];
  const out: [number, number][] = [[1, 0]];
  for (let k = 1; k < 2 * spokes; k++) {
    const [x, y] = out[k - 1];
    out.push([x * c - y * s, x * s + y * c]);
  }
  return out;
}

/**
 * A rune circle: `mark(i, j)` is the mark of the texel whose centre lies (i + ½, j + ½) texels from the circle's
 * centre (i, j whole numbers; the centre on a texel corner). Precomputed over the circle's box, so a lookup is cheap.
 */
export function runeCircle(options: RuneCircleOptions): (i: number, j: number) => RuneMark {
  const { radius, inner, spokes, seed = 1 } = options;
  if (![4, 8, 16, 32].includes(spokes)) throw new RangeError(`a rune circle has 4, 8, 16 or 32 spokes, got ${spokes}`);
  const half = Math.ceil(radius) + 1;
  const side = 2 * half;
  const marks = new Uint8Array(side * side);
  const dirs = directions(spokes);
  for (let j = -half; j < half; j++) {
    for (let i = -half; i < half; i++) {
      const [ox, oy] = [i + 0.5, j + 0.5];
      const d = Math.sqrt(ox * ox + oy * oy);
      let mark: RuneMark = 0;
      if (d < 3 && inner > 6)
        mark = 2; // the bright centre, when the inner ring leaves room for it
      else if (Math.abs(d - radius) < 0.8 || Math.abs(d - inner) < 0.6) mark = 1;
      else if (d > inner && d < radius) {
        for (let k = 0; k < 2 * spokes && !mark; k += 2) {
          const [x, y] = dirs[k];
          // Within half a texel of the spoke, one side open: a spoke along a row of texel corners takes one row.
          const off = x * oy - y * ox;
          if (ox * x + oy * y > 0 && off > -0.5 && off <= 0.5) mark = 1;
        }
      }
      marks[(j + half) * side + i + half] = mark;
    }
  }
  // A rune at the middle of each sector, when the band and the chord between spokes hold one with a texel to spare.
  const mid = (radius + inner) / 2;
  const chord = 2 * mid * dirs[1][1];
  if (radius - inner >= GLYPH + 2 && chord >= GLYPH + 4) {
    for (let k = 1; k < 2 * spokes; k += 2) {
      const glyph = GLYPHS[Math.floor(cellHash(k, 0, seed, 21) * GLYPHS.length)];
      const [left, bottom] = [Math.round(mid * dirs[k][0] - GLYPH / 2), Math.round(mid * dirs[k][1] - GLYPH / 2)];
      for (let r = 0; r < GLYPH; r++) {
        for (let c = 0; c < GLYPH; c++) {
          if (glyph[GLYPH - 1 - r][c] !== '#') continue;
          const [i, j] = [left + c, bottom + r];
          if (i >= -half && i < half && j >= -half && j < half) marks[(j + half) * side + i + half] = 2;
        }
      }
    }
  }
  return (i, j) =>
    i < -half || i >= half || j < -half || j >= half ? 0 : (marks[(j + half) * side + i + half] as RuneMark);
}

/** The colours of a rune circle and how brightly its lines glow (its runes and centre glow at 1). */
export interface RuneTones {
  rune: Rgb;
  glow: Rgb;
  lineGlow: number;
}

/** Writes `mark` onto `texel` (nothing for 0): the inlay's colour, its glow, a little below the stone, smoother. */
export function paintRune(texel: Texel, mark: RuneMark, tones: RuneTones): void {
  if (!mark) return;
  const [color, strength] = mark === 1 ? [tones.rune, tones.lineGlow] : [tones.glow, 1];
  for (let c = 0; c < 3; c++) {
    texel.color[c] = color[c];
    texel.emissive[c] = color[c] * strength;
  }
  texel.height = 0.35;
  texel.roughness = 0.45;
}

/** The least common multiple of two positive whole numbers. */
const lcm = (a: number, b: number): number => {
  let [x, y] = [a, b];
  while (y) [x, y] = [y, x % y];
  return (a / x) * b;
};

const STONES = FLAGSTONE.params as NonNullable<typeof FLAGSTONE.params>;

/** The rune generator's spec. */
export const RUNES = textureSpec({
  description:
    'A rune circle inlaid in flagstones, its emissive map: two rings, spokes, a rune in each sector and a bright centre.',
  params: {
    ...STONES,
    stones: { ...STONES.stones, default: ['#4b4559', '#554f64', '#433e51', '#5d566c'] },
    mortar: { ...STONES.mortar, default: '#221e2b' },
    hi: { ...STONES.hi, default: '#6f6782' },
    lo: { ...STONES.lo, default: '#322d3e' },
    speck: { ...STONES.speck, default: '#2a2634' },
    rune: {
      type: 'string',
      default: '#2f7f82',
      description: 'The inlay of the rings and spokes, hex; it glows faintly.',
    },
    glow: { type: 'string', default: '#6fd6cc', description: 'The runes and the centre, hex; they glow brightly.' },
    lineGlow: {
      type: 'number',
      default: 0.45,
      minimum: 0,
      maximum: 1,
      description: 'How brightly the rings and spokes glow, as a share of their colour.',
    },
    radius: {
      type: 'number',
      default: 54,
      minimum: 8,
      maximum: 2000,
      unit: 'texels',
      description: "The outer ring's radius (clipped to the cell).",
    },
    inner: {
      type: 'number',
      default: 43,
      minimum: 4,
      maximum: 2000,
      unit: 'texels',
      description: "The inner ring's radius, less than the outer's.",
    },
    spokes: { type: 'integer', enum: [4, 8, 16, 32], default: 16, description: 'The spokes between the rings.' },
    cell: {
      type: 'integer',
      default: 128,
      minimum: 16,
      maximum: 4096,
      unit: 'texels',
      description: 'The distance between circles, across and up: one circle at the middle of each cell (even).',
    },
  },
  size: [128, 128],
  tile: (params) => {
    const cell = params.cell % 2 ? 2 * params.cell : params.cell;
    return [lcm(cell, params.stone), lcm(cell, 2 * params.stone)];
  },
  create(context) {
    const { params, seed } = context;
    const stones = FLAGSTONE.create(context);
    const [rune, glow] = palette([params.rune, params.glow], 'texture:runes');
    const tones = { rune, glow, lineGlow: params.lineGlow };
    const cell = params.cell % 2 ? 2 * params.cell : params.cell;
    const radius = Math.min(params.radius, cell / 2 - 1.5);
    const mark = runeCircle({ radius, inner: Math.min(params.inner, radius - 2), spokes: params.spokes, seed });
    return (x, y, texel) => {
      stones(x, y, texel);
      const [i, j] = [wrapIndex(x, cell) - cell / 2, wrapIndex(y, cell) - cell / 2];
      paintRune(texel, mark(i, j), tones);
    };
  },
});
