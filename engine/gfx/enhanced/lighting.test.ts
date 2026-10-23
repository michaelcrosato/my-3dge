/**
 * @file Unit tests for tiled lighting (engine/gfx/enhanced/lighting.ts): the split keeps shadow casters as ordinary
 * lights; the tile grid covers the drawing buffer and stops at the buffers made; the node makes its buffers once, so a
 * resize changes its uniforms, never its shader key, and each frame's compute pass covers the grid's tiles alone. The
 * picture is tests/e2e/enhanced.spec.ts's.
 */
import { PointLight, SpotLight, Vector2, type NodeFrame } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { PoolTiledLighting, splitLights, TILED, tileGrid } from './lighting';

describe('tiled lighting', () => {
  it('tiles the point lights that cast no shadow; casters and other lights stay ordinary lights', () => {
    const caster = new PointLight();
    caster.castShadow = true;
    const [plain, spot] = [new PointLight(), new SpotLight()];
    const { tiled, material } = splitLights([caster, plain, spot]);
    expect(tiled).toEqual([plain]);
    expect(material).toEqual([caster, spot]);
  });

  it('covers the drawing buffer in 32 px tiles, up to the buffers made', () => {
    expect(tileGrid(1280, 720)).toEqual({ columns: 40, rows: 23, tiles: 920 });
    expect(tileGrid(33, 1)).toEqual({ columns: 2, rows: 1, tiles: 2 });
    expect(tileGrid(9000, 9000).tiles).toBe((TILED.width / TILED.tileSize) * (TILED.height / TILED.tileSize));
  });

  it('makes its buffers once: a resize keeps its shader key, and the compute pass covers the tiles in view', () => {
    const lights = [new PointLight(), new PointLight()];
    const node = new PoolTiledLighting().createNode(lights) as unknown as {
      customCacheKey(): string;
      updateBefore(frame: NodeFrame): void;
      tiles: { value: number };
    };
    const dispatched: number[] = [];
    let buffer = new Vector2(1280, 720);
    const frame = {
      renderer: { getRenderTarget: () => null, getDrawingBufferSize: (v: Vector2) => v.copy(buffer), compute: (_: unknown, n: number) => void dispatched.push(n) }, // prettier-ignore
      camera: { projectionMatrix: {}, matrixWorldInverse: {} },
    } as unknown as NodeFrame;
    node.updateBefore(frame);
    const key = node.customCacheKey();
    buffer = new Vector2(427, 240);
    node.updateBefore(frame);
    expect(node.customCacheKey()).toBe(key);
    expect(dispatched).toEqual([920, 14 * 8]);
    expect(node.tiles.value).toBe(112);
  });
});
