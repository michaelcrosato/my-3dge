/**
 * @file Unit tests for tiled lighting (engine/gfx/enhanced/lighting.ts): the split keeps shadow casters as ordinary
 * lights; the tile grid covers the drawing buffer and stops at the buffers made; the node makes its buffers once, so a
 * resize changes its uniforms, never its shader key, and each frame's compute pass covers the grid's tiles alone; only
 * the lights that shine are packed for the tiles, a pool's empty slots left out; a target past the buffers made says
 * so once a size. The picture is tests/e2e/enhanced.spec.ts's.
 */
import { PointLight, SpotLight, Vector2, type NodeFrame } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createLog } from '../../core/log';
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

  it('says once a size when a target is past the buffers made: its outer tiles draw the ordinary lights alone', () => {
    const printed: string[] = [];
    const log = createLog({ console: { warn: (line) => printed.push(line), error: () => {} } });
    const node = new PoolTiledLighting(log).createNode([new PointLight()]) as unknown as { updateBefore(frame: NodeFrame): void }; // prettier-ignore
    const frame = (width: number, height: number) =>
      ({ renderer: { getRenderTarget: () => ({ width, height }), compute: () => {} }, camera: { projectionMatrix: {}, matrixWorldInverse: {} } }) as unknown as NodeFrame; // prettier-ignore
    node.updateBefore(frame(TILED.width, TILED.height));
    expect(printed).toEqual([]);
    node.updateBefore(frame(6000, 3000));
    node.updateBefore(frame(6000, 3000));
    expect(printed).toEqual([expect.stringMatching(/GFX_TILES_PAST.*6000 × 3000 px target.*4096 × 4096/)]);
  });

  it("packs only the lights that shine for the tiles: a pool's empty slots are left out", () => {
    const [lamp, empty, torch] = [new PointLight('#ffffff', 2, 8), new PointLight('#ffffff', 0), new PointLight('#ff8000', 3, 6)]; // prettier-ignore
    lamp.position.set(1, 2, 3);
    torch.position.set(-4, 1, 0);
    for (const light of [lamp, empty, torch]) light.updateMatrixWorld();
    const node = new PoolTiledLighting().createNode([lamp, empty, torch]) as unknown as {
      updateLightsTexture(): void;
      _lightsCount: { value: number };
      _lightsTexture: { image: { data: Float32Array; width: number } };
    };
    node.updateLightsTexture();
    const { data, width } = node._lightsTexture.image;
    expect(node._lightsCount.value).toBe(2);
    expect([...data.subarray(0, 8)]).toEqual([1, 2, 3, 8, -4, 1, 0, 6]); // positions and reaches, the empty slot out
    const colour = [...data.subarray(width * 4 + 4, width * 4 + 8)]; // the torch's, second: its colour and decay
    expect(colour).toEqual([torch.color.r * 3, torch.color.g * 3, torch.color.b * 3, torch.decay].map(Math.fround));
  });
});
