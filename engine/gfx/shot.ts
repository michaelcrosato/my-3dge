/**
 * @file Shots (PLAN.md §8.5, §8.3's `shot`): what the frame draws, read back from the GPU as numbers and text, never
 * as a committed image. `shot(gfx, view, options)` draws the view the way the frame does (`view.draw`, a post pass,
 * or `render()`), into an RGBA8 render target instead of the canvas: the target is set as the renderer's output
 * target, so the scene goes through the same internal target, pipelines and output pass (tone mapping, colour space)
 * as the frame, and a shot at the drawing buffer's size (the default) matches the canvas pixel for pixel. It then
 * draws the ID pass (engine/gfx/idpass.ts) into a second target with no samples, reads both back with
 * `readRenderTargetPixelsAsync`, and returns what was asked: the pixels, the ID pass (`visible`, `unseen`), the look
 * metrics and their notes (engine/gfx/lookMetrics.ts), the 48 × 27 text thumbnail with its object map
 * (engine/gfx/thumbnail.ts), and numbered marks drawn on a copy of the pixels (`marked`, for `x shot --marks`).
 * `shotForJson` turns a result into plain JSON (pixels as base64), the shape `__engine.shot` returns and `x shot`
 * (tools/cmd/shot.ts) reads.
 *
 * r182's readback keeps WebGPU's row padding: `copyTextureToBuffer` aligns each row to 256 bytes and returns the
 * padded buffer, so a 48-pixel-wide read comes back in 64-pixel rows (PLAN.md §4.8). `readPixels` strips it
 * (`stripRowPadding`), as shardfall's capture does (`shardfall:crates/pav_render/src/capture.rs:31-71`), and reports
 * the padded layout it read (`readback`).
 *
 * This is the one module that reads the GPU back (ESLint allows `readRenderTargetPixelsAsync` here and in
 * engine/gfx/enhanced/timing.ts only), and what it reads goes to tools and tests, never to the sim (doctrine: WebGPU
 * only). A shot builds pipelines of its own on first use (the ID material, the output pass into RGBA8), counted in
 * `built`; it never changes what the next frame draws.
 *
 * @example
 * stripRowPadding(new Uint8Array(256 + 8), 2, 2).length; // 16: two rows of 2 RGBA pixels, the padding dropped
 * // const { ids, metrics, thumbnail } = await shot(gfx, { scene, camera });
 * @see engine/gfx/shot.test.ts
 * @see tests/e2e/shot.spec.ts
 */
import { RenderTarget, Vector2, type PerspectiveCamera, type WebGPURenderer } from 'three/webgpu';
import { codeError, defineCodes } from '../core/log';
import {
  decodeIds,
  drawMarks,
  listDrawables,
  marksOf,
  withIdScene,
  type IdPass,
  type IdTable,
  type Mark,
} from './idpass';
import { judgeLook, lookMetrics, type LookMetrics, type LookNote } from './lookMetrics';
import { advanceFrame, type PipelineCounter } from './pipelines';
import { thumbnail, type Thumbnail } from './thumbnail';
import type { Warmup, WarmupView } from './warmup';

/** The codes this module raises, with their fixes. */
export const SHOT_CODES = defineCodes('gfx', {
  GFX_BAD_SHOT_SIZE: {
    template: 'a shot must be at least 1 × 1 whole pixels, not {width} × {height}',
    fix: "pass size: { width, height } in whole pixels of at least 1, or leave it out to shoot at the drawing buffer's size",
  },
});

/** What to shoot and what to return. */
export interface ShotOptions {
  /** Draw the ID pass and return it (default true). */
  ids?: boolean;
  /** Measure the look and judge it (default true). */
  metrics?: boolean;
  /** Build the text thumbnail (default true). */
  thumbnail?: boolean;
  /** Number what the ID pass sees on a copy of the pixels, `marked` (default false; draws the ID pass). */
  marks?: boolean;
  /** Return the pixels (default false). */
  pixels?: boolean;
  /** The size in pixels; the drawing buffer's by default, which is what the frame draws. */
  size?: { width: number; height: number };
  /** The protagonist's name, for scenes where no object carries `userData.protagonist`. */
  protagonist?: string;
  /** How the notes name the frame ('the shot' by default). */
  where?: string;
}

/** The readback's padded layout: bytes per row as WebGPU copied them, and the buffer's length. */
export interface Readback {
  bytesPerRow: number;
  bytes: number;
}

/** What a shot returns: its size, the readback's layout, what was asked, pipelines built, and how long it took. */
export interface ShotResult {
  width: number;
  height: number;
  readback: Readback;
  /** Row-major RGBA, top row first (with `pixels`). */
  pixels?: Uint8Array;
  /** The pixels with the marks drawn on them (with `marks`). */
  marked?: Uint8Array;
  ids?: IdPass;
  marks?: Mark[];
  metrics?: LookMetrics;
  notes?: LookNote[];
  thumbnail?: Thumbnail;
  /** Pipelines the shot built (its own, on first use; never the frame's). */
  built: number;
  ms: number;
}

/** A shot as plain JSON: `pixels` and `marked` as base64 RGBA. */
export type ShotJson = Omit<ShotResult, 'pixels' | 'marked'> & { pixels?: string; marked?: string };

/** What a shot needs of the renderer (engine/gfx/renderer.ts's `Gfx`). */
export interface ShotGfx {
  renderer: WebGPURenderer;
  warmup: Pick<Warmup, 'running' | 'run'>;
  pipelines: PipelineCounter;
}

/** Bytes per row WebGPU copies for `width` pixels: aligned up to 256 (`copyTextureToBuffer`'s rule). */
export function rowBytes(width: number, bytesPerPixel = 4): number {
  return Math.ceil((width * bytesPerPixel) / 256) * 256;
}

/** Drops the row padding of a readback: `height` rows of `width` pixels from rows of `rowBytes(width)` bytes. */
export function stripRowPadding(data: Uint8Array, width: number, height: number, bytesPerPixel = 4): Uint8Array {
  const [stride, row] = [rowBytes(width, bytesPerPixel), width * bytesPerPixel];
  if (data.length < (height - 1) * stride + row)
    throw new Error(`stripRowPadding: ${data.length} bytes cannot hold ${height} rows of ${stride} bytes`);
  const out = new Uint8Array(row * height);
  for (let y = 0; y < height; y++) out.set(data.subarray(y * stride, y * stride + row), y * row);
  return out;
}

/** Reads an RGBA8 render target back: its pixels, top row first, without the padding, and the layout read. */
export async function readPixels(
  renderer: WebGPURenderer,
  target: RenderTarget,
  width: number,
  height: number,
): Promise<{ pixels: Uint8Array; readback: Readback }> {
  const data = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return {
    pixels: stripRowPadding(bytes, width, height),
    readback: { bytesPerRow: rowBytes(width), bytes: bytes.length },
  };
}

/** Base64 of bytes, in the browser and in Node. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

/** The result as plain JSON, for `__engine.shot` and `x shot`: the pixels as base64. */
export function shotForJson(result: ShotResult): ShotJson {
  const { pixels, marked, ...rest } = result;
  return { ...rest, ...(pixels ? { pixels: toBase64(pixels) } : {}), ...(marked ? { marked: toBase64(marked) } : {}) };
}

/** Each renderer's two targets: the frame's colours and the ID pass. */
const TARGETS = new WeakMap<WebGPURenderer, { colour: RenderTarget; ids: RenderTarget }>();

/** The targets of `renderer` at `width` × `height`. */
function targetsOf(renderer: WebGPURenderer, width: number, height: number) {
  let targets = TARGETS.get(renderer);
  if (!targets) {
    targets = { colour: new RenderTarget(width, height), ids: new RenderTarget(width, height) };
    targets.colour.texture.name = 'Shot.colour';
    targets.ids.texture.name = 'Shot.ids';
    TARGETS.set(renderer, targets);
  }
  for (const target of [targets.colour, targets.ids]) {
    if (target.width !== width || target.height !== height) target.setSize(width, height);
  }
  return targets;
}

/** Sets a perspective camera's aspect to `width / height` when a size was asked; returns how to put it back. */
function fitCamera(view: WarmupView, size: ShotOptions['size']): () => void {
  const camera = view.camera as PerspectiveCamera;
  if (!size || !camera.isPerspectiveCamera || camera.aspect === size.width / size.height) return () => undefined;
  const kept = camera.aspect;
  camera.aspect = size.width / size.height;
  camera.updateProjectionMatrix();
  return () => {
    camera.aspect = kept;
    camera.updateProjectionMatrix();
  };
}

/**
 * Shoots `view`: draws it as the frame does into a render target, draws the ID pass, reads both back, and returns
 * what `options` asks for (see the file comment). Waits for a running warm-up first. Throws `GFX_BAD_SHOT_SIZE`.
 */
export async function shot(gfx: ShotGfx, view: WarmupView, options: ShotOptions = {}): Promise<ShotResult> {
  const started = performance.now();
  const { renderer } = gfx;
  const { scene, camera } = view;
  const wantIds = (options.ids ?? true) || options.marks === true;
  if (gfx.warmup.running) await gfx.warmup.run(view);
  const buffer = renderer.getDrawingBufferSize(new Vector2());
  const { width, height } = options.size ?? buffer;
  if (!(Number.isInteger(width) && Number.isInteger(height) && width >= 1 && height >= 1))
    throw codeError('GFX_BAD_SHOT_SIZE', { width: String(width), height: String(height) });
  const before = gfx.pipelines.count().built;
  const targets = targetsOf(renderer, width, height);
  const putBack = fitCamera(view, options.size);
  let table: IdTable | undefined;
  try {
    const [output, current] = [renderer.getOutputRenderTarget(), renderer.getRenderTarget()];
    renderer.setOutputRenderTarget(targets.colour);
    try {
      advanceFrame(renderer);
      (view.draw ?? (() => renderer.render(scene, camera)))();
    } finally {
      // r182's output pass leaves the output target set as the render target: the next frame would draw into it.
      renderer.setOutputRenderTarget(output);
      renderer.setRenderTarget(current);
    }
    if (wantIds) {
      table = listDrawables(scene, camera, { protagonist: options.protagonist });
      const previous = renderer.getRenderTarget();
      withIdScene(renderer, scene, table, (root) => {
        renderer.setRenderTarget(targets.ids);
        try {
          renderer.render(root, camera);
        } finally {
          renderer.setRenderTarget(previous);
        }
      });
    }
  } finally {
    putBack();
  }
  const { pixels, readback } = await readPixels(renderer, targets.colour, width, height);
  const result: ShotResult = { width, height, readback, built: 0, ms: 0 };
  let decoded: ReturnType<typeof decodeIds> | undefined;
  if (table) {
    decoded = decodeIds((await readPixels(renderer, targets.ids, width, height)).pixels, width, height, table);
    if (options.ids ?? true) result.ids = decoded.pass;
  }
  const lookIds = decoded && { visible: decoded.pass.visible, protagonist: decoded.pass.protagonist };
  if (options.metrics ?? true) {
    result.metrics = lookMetrics(pixels, width, height, lookIds);
    result.notes = judgeLook(result.metrics, options.where ?? 'the shot', lookIds);
  }
  if (options.thumbnail ?? true) {
    const names = decoded?.pass.visible.map((entry) => entry.name) ?? [];
    result.thumbnail = thumbnail(pixels, width, height, decoded && { pixels: decoded.pixels, names });
  }
  if (options.marks && decoded) {
    result.marks = marksOf(decoded.pass);
    result.marked = pixels.slice();
    drawMarks(result.marked, width, height, result.marks);
  }
  if (options.pixels) result.pixels = pixels;
  result.built = gfx.pipelines.count().built - before;
  result.ms = Math.round(performance.now() - started);
  return result;
}
