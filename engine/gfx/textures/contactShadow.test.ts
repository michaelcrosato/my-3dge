/**
 * @file Unit tests for the level floor bake and its contact shadows (engine/gfx/textures/contactShadow.ts), in Node on
 * the hall (labs/box/levels/hall.txt), baked as the box bakes it: the bake is reproducible (its golden hash, the same
 * twice and under the sim's fdlibm swap) and checks as a tiling texture; it lines up with the hall's wall cells,
 * WP 7.3's last Done-when: the floor mesh's UVs put every tile corner on a texel corner 16 texels apart, every wall,
 * low-wall and pillar cell's texels are at full shadow, the texels touching a cell's open sides are at full shadow
 * too, the shadow fades out within 5 texels of the cells and nowhere else, and moss grows only within reach of them;
 * the rune circle glows centred on the dais and inside its top; the shadow's bands; and `GFX_FLOOR_BAKE` for a
 * density the level cannot bake at.
 * @see engine/gfx/textures/contactShadow.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MeshBasicMaterial, type Mesh } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../core/registry';
import { withSimMath } from '../../core/simMath';
import { compileLevel } from '../../world/level/compile';
import { createLevelMeshes } from '../level/meshes';
import { bakeTexture, textureSampler } from './bake';
import { contactShadow, levelFloorTexture, type LevelFloorOptions } from './contactShadow';
import { toDataTextures } from './dataTexture';
import { measureSeam, rangeProblems, SEAM_LIMIT } from './seams';
import { defineTexture, textureKind } from './texture';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const hall = compileLevel(readFileSync(join(ROOT, 'labs', 'box', 'levels', 'hall.txt'), 'utf8'), { file: 'hall.txt' });
const reg = createRegistry();
textureKind(reg);

/** The hall's dusky flagstones (`my-3d2dge:src/stress-world/10-hall.js:204`), as the box bakes its floor. */
const HALL: LevelFloorOptions = {
  registry: reg,
  base: {
    texture: 'texture:flagstone',
    params: {
      stones: ['#4b4559', '#554f64', '#433e51', '#5d566c'],
      mortar: '#221e2b',
      hi: '#6f6782',
      lo: '#322d3e',
      speck: '#2a2634',
    },
  },
};
defineTexture('texture:hallFloor', levelFloorTexture(hall, HALL), reg);
defineTexture('texture:hallNoShadow', levelFloorTexture(hall, { ...HALL, shadows: false }), reg);
defineTexture('texture:hallBare', levelFloorTexture(hall, { ...HALL, shadows: false, moss: false }), reg);
const floor = bakeTexture('texture:hallFloor', reg);
const unshadowed = bakeTexture('texture:hallNoShadow', reg);

/** The golden hash of the hall's floor bake (seed 1). Change only with a written reason. */
const GOLDEN = '728b247daa6c7cb1';

const [W, H, TILE] = [1024, 704, 16];
/** The tile (col, row) whose square holds texel (x, y), by the floor mesh's UVs (checked below). */
const tileOf = (x: number, y: number) => [Math.floor(x / TILE), hall.rows - 1 - Math.floor(y / TILE)];
/** The glyph of tile (col, row), or '' outside the map. */
const glyphAt = (c: number, r: number) =>
  c < 0 || r < 0 || c >= hall.cols || r >= hall.rows ? undefined : hall.legend[hall.tiles[r * hall.cols + c]];
/** Blocks nobody walks on: they cover their tiles, and the floor bake leaves them at full shadow. */
const covers = (c: number, r: number) => {
  const glyph = glyphAt(c, r);
  return !!glyph && glyph.collider === 'box' && !glyph.nav.walkable;
};
/** Whether a block on tile (c, r) casts onto tile (tc, tr): a box whose top rises 0.25 m above that tile's floor. */
const casts = (c: number, r: number, tc: number, tr: number) => {
  const glyph = glyphAt(c, r);
  return !!glyph && glyph.collider === 'box' && glyph.top - hall.floor[tr * hall.cols + tc] >= 0.25;
};
/** The distance (texels) from texel (x, y)'s centre to the nearest block casting onto its tile, within `reach`. */
function nearestBlock(x: number, y: number, reach: number): number {
  const [c, r] = tileOf(x, y);
  const [mx, mz] = [x + 0.5, H - y - 0.5];
  let best = Infinity;
  for (let nr = r - 2; nr <= r + 2; nr++) {
    for (let nc = c - 2; nc <= c + 2; nc++) {
      if ((nc === c && nr === r) || !casts(nc, nr, c, r)) continue;
      const dx = Math.max(nc * TILE - mx, 0, mx - (nc + 1) * TILE);
      const dz = Math.max(nr * TILE - mz, 0, mz - (nr + 1) * TILE);
      best = Math.min(best, Math.hypot(dx, dz));
    }
  }
  return best <= reach ? best : Infinity;
}
/** How much darker texel t is than in the bake without shadows (the green channel's ratio, 1 when the same). */
const ratio = (t: number) => floor.map[t * 4 + 1] / Math.max(1, unshadowed.map[t * 4 + 1]);

describe("the hall's floor bake", () => {
  it('covers the hall at 16 texels per metre, reproducibly, and checks as a tiling texture', () => {
    expect([floor.width, floor.height, floor.density]).toEqual([W, H, 16]);
    expect(bakeTexture('texture:hallFloor', reg).hash).toBe(floor.hash);
    expect(withSimMath(() => bakeTexture('texture:hallFloor', reg).hash)).toBe(floor.hash);
    expect(floor.hash).toBe(GOLDEN);
    expect(measureSeam(floor).delta).toBeLessThanOrEqual(SEAM_LIMIT);
    expect(rangeProblems(textureSampler('texture:hallFloor', reg)).count).toBe(0);
  });

  it('puts every tile corner of the floor mesh on a texel corner, 16 texels a tile, north up', () => {
    const meshes = createLevelMeshes(hall, { materials: { get: () => new MeshBasicMaterial() } });
    const mesh = meshes.parts.find((part) => part.recipe === 'floor')!.mesh as Mesh;
    const { repeat } = toDataTextures(floor).map;
    const [position, uv] = [mesh.geometry.getAttribute('position'), mesh.geometry.getAttribute('uv')];
    expect(position.count).toBeGreaterThan(2000);
    for (let i = 0; i < position.count; i++) {
      // What the GPU samples, with RepeatWrapping: the fraction of u × repeat across, of v × repeat up.
      const s = uv.getX(i) * repeat.x;
      const t = uv.getY(i) * repeat.y;
      const [x, y] = [(s - Math.floor(s)) * W, (t - Math.floor(t)) * H];
      const [cornerX, cornerY] = [(position.getX(i) * TILE) % W, (H - ((position.getZ(i) * TILE) % H)) % H];
      expect(Math.abs(x - cornerX) + Math.abs(y - cornerY), `vertex ${i}: (${x}, ${y})`).toBeLessThan(1e-6);
    }
  });

  it('lines up with its wall cells: full shadow on them and at the foot of their open sides, none beyond', () => {
    const meshes = createLevelMeshes(hall, { materials: { get: () => new MeshBasicMaterial() } });
    const cells = meshes.parts.filter((part) => ['wall', 'lowWall', 'pillar'].includes(part.recipe));
    expect(cells.reduce((sum, part) => sum + part.cells.length, 0)).toBe(212 + 39 + 23);
    // Full shadow: 1 − the strength (0.4), times the tint on green (0.98), give or take the bytes' rounding.
    const full = (t: number) => Math.abs(ratio(t) - 0.6 * 0.98) < 0.03;
    const wrong: string[] = [];
    let [under, feet] = [0, 0];
    for (const part of cells) {
      for (const cell of part.cells) {
        const [c0, r0, c1, r1] = cell.tiles;
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            // Under the cell: every texel of its tiles.
            for (let y = H - (r + 1) * TILE; y < H - r * TILE; y++) {
              for (let x = c * TILE; x < (c + 1) * TILE; x++) {
                under++;
                if (!full(y * W + x))
                  wrong.push(`${part.recipe} (${c}, ${r}): texel (${x}, ${y}) at ${ratio(y * W + x)}`);
              }
            }
            // Its open sides: the texels touching it on a walkable tile it rises above.
            for (const [dc, dr] of [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ]) {
              const [nc, nr] = [c + dc, r + dr];
              if (covers(nc, nr) || !hall.walkable[nr * hall.cols + nc] || !casts(c, r, nc, nr)) continue;
              for (let k = 0; k < TILE; k++) {
                const x = dc === 1 ? nc * TILE : dc === -1 ? nc * TILE + TILE - 1 : nc * TILE + k;
                const y = H - 1 - (dr === 1 ? nr * TILE : dr === -1 ? nr * TILE + TILE - 1 : nr * TILE + k);
                feet++;
                if (!full(y * W + x)) wrong.push(`foot of (${c}, ${r}) at texel (${x}, ${y}): ${ratio(y * W + x)}`);
              }
            }
          }
        }
      }
    }
    expect([under, feet]).toEqual([(212 + 39 + 23 * 4) * TILE * TILE, expect.any(Number)]);
    expect(feet).toBeGreaterThan(5000);
    // Darker only within 5 texels (0.3125 m) of a casting block, or on a covered tile; never anywhere else.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const [c, r] = tileOf(x, y);
        if (covers(c, r)) continue;
        const d = nearestBlock(x, y, 5);
        const darker = ratio(y * W + x);
        if (d < 4.5 ? darker > 0.92 : d >= 5 && darker !== 1) wrong.push(`(${x}, ${y}) ${d} texels away: ${darker}`);
      }
    }
    expect(wrong.slice(0, 10)).toEqual([]);
  });

  it('grows moss only within reach of the walls, thinning away from them', () => {
    const bare = bakeTexture('texture:hallBare', reg);
    const near = [0, 0];
    const far = [0, 0];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = y * W + x;
        const [c, r] = tileOf(x, y);
        if (covers(c, r) || bare.emissiveMap?.[t * 4]) continue;
        const mossy = unshadowed.roughnessMap[t] === 1 && bare.roughnessMap[t] !== 1;
        const d = nearestBlock(x, y, 22);
        if (d === Infinity) expect(mossy, `(${x}, ${y})`).toBe(false);
        const bin = d < 4 ? near : d >= 14 && d < 22 ? far : null;
        if (bin) [bin[0], bin[1]] = [bin[0] + (mossy ? 1 : 0), bin[1] + 1];
      }
    }
    expect(near[0] / near[1]).toBeGreaterThan(0.25);
    expect(far[0] / far[1]).toBeLessThan(near[0] / near[1] / 2);
  });

  it('lays the rune circle on the dais, glowing, centred on it and inside its top', () => {
    const [dais] = hall.daises;
    const [cx, cy] = [dais.center[0] * TILE, H - dais.center[1] * TILE];
    const glow = floor.emissiveMap!;
    let [n, sx, sy, far] = [0, 0, 0, 0];
    for (let t = 0; t < W * H; t++) {
      if (!glow[t * 4] && !glow[t * 4 + 1] && !glow[t * 4 + 2]) continue;
      const [x, y] = [(t % W) + 0.5, Math.floor(t / W) + 0.5];
      [n, sx, sy, far] = [n + 1, sx + x, sy + y, Math.max(far, Math.hypot(x - cx, y - cy))];
    }
    expect(n).toBeGreaterThan(500);
    expect(Math.abs(sx / n - cx)).toBeLessThan(1);
    expect(Math.abs(sy / n - cy)).toBeLessThan(1);
    expect(far).toBeLessThan(dais.topRadius * TILE);
    expect(far).toBeGreaterThan(54);
  });
});

describe('contactShadow', () => {
  it('fades from 1 at the foot to 0 at the radius, in bands', () => {
    expect([0, 0.5, 1, 2.4, 2.6, 4.6, 5, 9].map((d) => contactShadow(d, 5, 5))).toEqual([1, 1, 0.8, 0.6, 0.4, 0, 0, 0]);
    expect(contactShadow(1, 5, 0)).toBeCloseTo(0.8, 10);
  });

  it('refuses a density the level cannot bake at, naming one that fits', () => {
    expect(() => levelFloorTexture(hall, { ...HALL, density: 15.5 })).toThrow(/GFX_FLOOR_BAKE.*15\.5 texels/);
    expect(() => levelFloorTexture(hall, { ...HALL, density: 100 })).toThrow(/6400 texels.*64 texels per metre fits/);
  });
});
