/**
 * @file Unit tests for the pixel grid a frame draws on (engine/gfx/post/grid.ts): the art block giving 240 to 360
 * lines, the block the camera snaps to (pixel art's, one drawn pixel included, or the screen's low resolution), the
 * ink's width scaled with the lines, and a frame's grid: the snap's cells, the glide only where `smooth` asks, the
 * camera put back.
 */
import { OrthographicCamera, PerspectiveCamera } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { chainOf } from './filters';
import { ART_LINES, artBlock, frameGrid, inkWidth, pixelBlock, QUAD, snapBlock } from './grid';

describe('artBlock', () => {
  it('takes the largest whole block giving at least 240 lines, at most 360 from 480 lines up', () => {
    expect([200, 270, 300, 540, 720, 1080, 1440, 2160].map(artBlock)).toEqual([1, 1, 1, 2, 3, 4, 6, 9]);
    for (let lines = 480; lines <= 2400; lines++) {
      const kept = lines / artBlock(lines);
      expect(kept >= ART_LINES.least && kept <= ART_LINES.most, `${lines} lines`).toBe(true);
    }
  });
});

describe('snapBlock', () => {
  it('is pixel art’s block on the environment, one drawn pixel too, else the screen’s low resolution, else none', () => {
    expect(snapBlock(chainOf())).toBe(0);
    expect(snapBlock(chainOf({ pixel: { scope: 'all', size: 6 } }))).toBe(6);
    expect(snapBlock(chainOf({ pixel: { scope: 'objects+environment', size: 5 } }))).toBe(5);
    expect(snapBlock(chainOf({ pixel: { scope: 'characters+objects', size: 5 } }))).toBe(0);
    expect(snapBlock(chainOf({ pixel: { scope: 'all', size: 6, snap: false } }))).toBe(0);
    expect(snapBlock(chainOf({ screen: { scope: 'all', pixelate: 3 } }))).toBe(3);
    const auto = chainOf({ pixel: { scope: 'all', size: 0 } });
    expect([snapBlock(auto, 270), snapBlock(auto, 1080), pixelBlock(auto, 1080)]).toEqual([1, 4, 4]);
  });
});

describe('inkWidth', () => {
  it('keeps the width, or scales it with the lines in whole pixels, at least 1', () => {
    const fixed = chainOf({ outline: { scope: 'all', width: 2 } }).outline;
    expect([inkWidth(fixed, 270), inkWidth(fixed, 1080)]).toEqual([2, 2]);
    const scaled = chainOf({ outline: { scope: 'all', width: 1, lines: 270 } }).outline;
    expect([135, 270, 540, 720, 1080].map((lines) => inkWidth(scaled, lines))).toEqual([1, 1, 2, 3, 4]);
  });
});

describe('frameGrid', () => {
  const iso = () => {
    const camera = new OrthographicCamera(-4.8, 4.8, 2.7, -2.7, 0.1, 100);
    camera.position.set(0.513, 10, 10);
    camera.lookAt(0.513, 0, 0);
    camera.updateMatrixWorld();
    return camera;
  };
  const SIZE = { width: 480, height: 270 };

  it("snaps the pixel look's camera to one drawn pixel, its cells for the dithers, its glide only when smooth", () => {
    const camera = iso();
    const still = frameGrid(chainOf({ pixel: { scope: 'all', size: 0 } }), camera, SIZE);
    expect([still.block, still.cells[0], still.snap, still.shift]).toEqual([1, 26, 1, [0, 0]]);
    still.restore();
    const smooth = frameGrid(chainOf({ pixel: { scope: 'all', size: 0, smooth: true } }), camera, SIZE);
    expect(smooth.shift[0]).toBeCloseTo(0.35, 10);
    smooth.restore();
    expect(camera.position.x).toBe(0.513);
  });

  it('moves a gliding one-pixel snap by whole 2 × 2 quads: even cells, the glide within a drawn pixel', () => {
    const camera = iso();
    camera.position.x = 0.533; // 26.65 pixels across: 27 by itself, 26 by quads
    camera.updateMatrixWorld();
    const still = frameGrid(chainOf({ pixel: { scope: 'all', size: 0 } }), camera, SIZE);
    expect([still.cells[0], still.shift[0]]).toEqual([27, 0]);
    still.restore();
    const smooth = frameGrid(chainOf({ pixel: { scope: 'all', size: 0, smooth: true } }), camera, SIZE);
    expect([smooth.cells[0], smooth.snap, QUAD]).toEqual([26, 1, 2]);
    expect(smooth.shift[0]).toBeCloseTo(-0.65, 10);
    expect(camera.position.x).toBeCloseTo(0.52, 10); // 13 quads of 0.04 m
    smooth.restore();
    const big = frameGrid(chainOf({ pixel: { scope: 'all', size: 3, smooth: true } }), camera, SIZE);
    expect([big.cells[0], big.snap]).toEqual([9, 3]); // a block of 3 keeps its own snap: 8.88 blocks
    big.restore();
  });

  it('leaves the camera where it is without a snap, the cells and the glide at 0', () => {
    const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 100);
    camera.position.set(0.513, 1.5, 0);
    const grid = frameGrid(chainOf({ pixel: { scope: 'all', size: 0, snap: false, smooth: true } }), camera, SIZE);
    expect([grid.block, grid.cells, grid.snap, grid.shift]).toEqual([1, [0, 0], 0, [0, 0]]);
    grid.restore();
    expect(camera.position.x).toBe(0.513);
  });
});
