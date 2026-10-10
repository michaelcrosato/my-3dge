/**
 * @file Unit tests for engine/gfx/shot.ts in Node: WebGPU's 256-byte row alignment and its stripping (a 48-pixel-wide
 * readback comes back in 64-pixel rows and is returned without skew), the JSON form, and `shot`'s orchestration on a
 * stub renderer: the frame drawn through the output target, every target and the camera put back, the ID pass's
 * clear colour restored, the size checked. The GPU half is proven by tests/e2e/shot.spec.ts.
 */
import { BoxGeometry, Mesh, MeshBasicNodeMaterial, PerspectiveCamera, Scene, type RenderTarget } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { rowBytes, shot, shotForJson, stripRowPadding, toBase64, type ShotGfx } from './shot';

/** A padded readback of `width` × `height` pixels whose bytes say where they are: [x, y, 7, 255]. */
function padded(width: number, height: number): Uint8Array {
  const stride = rowBytes(width);
  const data = new Uint8Array((height - 1) * stride + width * 4).fill(0xee);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([x, y, 7, 255], y * stride + x * 4);
  return data;
}

describe('rowBytes and stripRowPadding', () => {
  it('aligns rows to 256 bytes as copyTextureToBuffer does', () => {
    expect([1, 48, 64, 65, 480].map((width) => rowBytes(width))).toEqual([256, 256, 256, 512, 2048]);
  });

  it('returns a 48-pixel-wide readback without padding or row skew', () => {
    const data = padded(48, 27);
    expect(data.length).toBe(26 * 256 + 48 * 4);
    const pixels = stripRowPadding(data, 48, 27);
    expect(pixels.length).toBe(48 * 27 * 4);
    for (const [x, y] of [
      [0, 0],
      [47, 0],
      [0, 1],
      [47, 26],
      [13, 20],
    ]) {
      const i = (y * 48 + x) * 4;
      expect([...pixels.subarray(i, i + 4)], `pixel ${x},${y}`).toEqual([x, y, 7, 255]);
    }
    expect(pixels.includes(0xee), 'no padding byte survives').toBe(false);
  });

  it('keeps unpadded rows as they are, and refuses a buffer too short', () => {
    const data = padded(64, 3);
    expect(stripRowPadding(data, 64, 3)).toEqual(data);
    expect(() => stripRowPadding(new Uint8Array(100), 48, 2)).toThrow('cannot hold 2 rows of 256 bytes');
  });
});

describe('shotForJson', () => {
  it('turns the pixels into base64 and keeps everything else', () => {
    const pixels = new Uint8Array([1, 2, 3, 255, 250, 0, 9, 128]);
    const json = shotForJson({
      width: 2,
      height: 1,
      readback: { bytesPerRow: 256, bytes: 8 },
      pixels,
      built: 1,
      ms: 3,
    });
    expect(json).toEqual({
      width: 2,
      height: 1,
      readback: { bytesPerRow: 256, bytes: 8 },
      pixels: toBase64(pixels),
      built: 1,
      ms: 3,
    });
    expect([...Buffer.from(json.pixels!, 'base64')]).toEqual([...pixels]);
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });
});

/** A stub of the renderer's surface `shot` uses, recording what it is asked. */
function stubGfx(width: number, height: number) {
  const calls: string[] = [];
  let renderTarget: RenderTarget | null = null;
  let output: RenderTarget | null = null;
  let clear: [number, number] = [0x123456, 1];
  const renderer = {
    autoClear: false,
    getDrawingBufferSize: (target: { set(x: number, y: number): unknown }) => target.set(width, height),
    getOutputRenderTarget: () => output,
    setOutputRenderTarget: (target: RenderTarget | null) => void (output = target),
    getRenderTarget: () => renderTarget,
    setRenderTarget: (target: RenderTarget | null) => void (renderTarget = target),
    getClearColor: (target: { setHex(hex: number): unknown }) => target.setHex(clear[0]),
    getClearAlpha: () => clear[1],
    setClearColor: (colour: number | { getHex(): number }, alpha: number) =>
      void (clear = [typeof colour === 'number' ? colour : colour.getHex(), alpha]),
    render: (root: Scene) => {
      const into = output ? `output ${output.texture.name}` : `target ${renderTarget?.texture.name ?? 'canvas'}`;
      calls.push(`render ${root.name || 'scene'} into ${into}, clear ${clear[1]}, autoClear ${renderer.autoClear}`);
      // r182's output pass leaves the output target set as the render target.
      if (output) renderTarget = output;
    },
    readRenderTargetPixelsAsync: async (target: RenderTarget, x: number, y: number, w: number, h: number) => {
      calls.push(`read ${target.texture.name} ${w}×${h}`);
      return new Uint8Array((h - 1) * rowBytes(w) + w * 4);
    },
  };
  const gfx = {
    renderer,
    warmup: { running: false, run: async () => ({}) },
    pipelines: { count: () => ({ built: 0, render: 0, compute: 0, shaders: 0, cached: null }) },
  } as unknown as ShotGfx;
  return { gfx, calls, state: () => ({ renderTarget, output, clear, autoClear: renderer.autoClear }) };
}

describe('shot, on a stub renderer', () => {
  const scene = new Scene();
  scene.add(new Mesh(new BoxGeometry(), new MeshBasicNodeMaterial()));
  scene.children[0].name = 'box';
  const camera = new PerspectiveCamera(50, 2, 0.1, 100);
  camera.position.set(0, 0, 5);

  it('draws the frame into the output target, then the ID pass, reads both, and puts everything back', async () => {
    const { gfx, calls, state } = stubGfx(48, 27);
    const result = await shot(gfx, { scene, camera });
    expect(calls).toEqual([
      'render scene into output Shot.colour, clear 1, autoClear false',
      'render IdPass.scene into target Shot.ids, clear 0, autoClear true',
      'read Shot.colour 48×27',
      'read Shot.ids 48×27',
    ]);
    expect(state()).toEqual({ renderTarget: null, output: null, clear: [0x123456, 1], autoClear: false });
    expect(result).toMatchObject({ width: 48, height: 27, readback: { bytesPerRow: 256, bytes: 26 * 256 + 192 } });
    // An all-transparent readback: the box is in view but covers nothing.
    expect(result.ids).toMatchObject({ objects: 1, visible: [], empty: 48 * 27, stray: 0 });
    expect(result.ids!.unseen).toEqual([{ id: scene.children[0].id, name: 'box', reason: 'covered' }]);
    expect(result.notes!.map((note) => note.id)).toEqual(['LOOK_BLANK']);
    expect(result.thumbnail!.map![0]).toBe('.'.repeat(48));
    expect(result.pixels).toBeUndefined();
  });

  it('shoots at another size with the camera fitted to it and put back, and checks the size', async () => {
    const { gfx, calls } = stubGfx(48, 27);
    let aspect = 0;
    const draw = () => void (aspect = camera.aspect);
    const result = await shot(
      gfx,
      { scene, camera, draw },
      { size: { width: 30, height: 10 }, ids: false, pixels: true },
    );
    expect(aspect).toBe(3);
    expect(camera.aspect).toBe(2);
    expect(calls).toEqual(['read Shot.colour 30×10']);
    expect(result.pixels!.length).toBe(30 * 10 * 4);
    expect(result.ids).toBeUndefined();
    await expect(shot(gfx, { scene, camera }, { size: { width: 0, height: 10 } })).rejects.toMatchObject({
      code: 'GFX_BAD_SHOT_SIZE',
    });
  });
});
