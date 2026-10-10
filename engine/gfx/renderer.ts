/**
 * @file The WebGPU renderer's bootstrap (PLAN.md §6.7): WebGPU or nothing. `createRenderer` asks for a WebGPU adapter
 * before anything else and refuses to start without one (`GFX_NO_WEBGPU`, naming the fix). It then creates the device
 * itself and hands it to three.js's `WebGPURenderer`, so three.js never requests an adapter of its own and its WebGL 2
 * fallback has nothing to fall back from; `await renderer.init()` follows, then the backend assertion. Draw with
 * `render()`, never `renderAsync()` (deprecated since r181; docs/THREE-DELTA.md).
 *
 * Minimal on purpose (WP 0.8). WP 2.1 grows this file into the full renderer: the capability report with the adapter's
 * limits, the feature registry (optional features checked at startup, an advice code on every downgrade),
 * resolution modes, the warm-up, and `renderer.onError` routed to the log. `defineCodes` below is a local stand-in for
 * engine/core/log.ts's (WP 1.2), which replaces it; the call keeps the literal form `x docs` reads.
 *
 * Invariants: a `Gfx` exists only on the WebGPU backend; every failure to get there is a `GfxError` with its code and
 * fix, and nothing is drawn, configured or allocated on the GPU before the adapter check passes.
 *
 * @example
 * const refused = await requestWebGPU(undefined).catch((error: GfxError) => error.code); // 'GFX_NO_WEBGPU' in Node
 * @see tests/e2e/hello.spec.ts
 * @see engine/gfx/renderer.test.ts
 */
/// <reference types="@webgpu/types" />
import { REVISION, WebGPURenderer } from 'three/webgpu';

/** One code's text: the message (`{name}` marks a value), what to do about it, and more detail for docs/ERRORS.md. */
interface CodeText {
  template: string;
  fix: string;
  doc?: string;
}

/** Stand-in for engine/core/log.ts's `defineCodes` (WP 1.2 replaces it): returns the table as given, typed. */
function defineCodes<const T extends Record<string, CodeText>>(_area: string, codes: T): T {
  return codes;
}

/** The codes the renderer raises, with their fixes (collected into docs/ERRORS.md by `x docs`). */
export const GFX_CODES = defineCodes('gfx', {
  GFX_NO_WEBGPU: {
    template: 'WebGPU is unavailable: {reason}',
    fix: 'open the page in a browser with WebGPU and hardware acceleration on (Chrome or Edge 113+, Safari 26+); headless, launch Chromium with WEBGPU_FLAGS from tools/lib/browser.ts (PLAN.md §8.8)',
    doc: 'Raised at startup, before anything touches the GPU, when the browser has no `navigator.gpu`, gives no adapter or device, or three.js starts another backend than WebGPU. WebGPU is the only renderer: there is no WebGL fallback (PLAN.md §6.7), so nothing starts, and a page shows this message with its fix.',
  },
});

/** A code the renderer raises: a key of `GFX_CODES`. */
export type GfxCode = keyof typeof GFX_CODES;

/** A renderer failure: its code, the message from the code's template, and the code's fix. */
export class GfxError extends Error {
  override name = 'GfxError';
  /** The code, as docs/ERRORS.md lists it. */
  readonly code: GfxCode;
  /** What to do about it, from the code's `fix`. */
  readonly fix: string;

  /** Fills the code's template with `values` (`{reason}` → `values.reason`). */
  constructor(code: GfxCode, values: Record<string, string>) {
    const { template, fix } = GFX_CODES[code];
    super(template.replace(/\{(\w+)\}/g, (marker, name: string) => values[name] ?? marker));
    this.code = code;
    this.fix = fix;
  }
}

/** What the renderer reports about itself (the start of `__engine.info()`, PLAN.md §8.3). */
export interface GfxInfo {
  /** Always `WebGPU`: no other backend gets this far. */
  backend: 'WebGPU';
  /** The adapter's identity (on this platform: vendor `google`, architecture `swiftshader`). */
  adapter: { vendor: string; architecture: string; device: string; description: string };
  /** The adapter's features, sorted; the device has every one of them. */
  features: string[];
  /** three.js's revision: `182`. */
  three: string;
}

/** A started renderer: three.js's `WebGPURenderer`, the device it draws with, and its report. */
export interface Gfx {
  renderer: WebGPURenderer;
  device: GPUDevice;
  info: GfxInfo;
}

/**
 * Asks `gpu` (by default the browser's `navigator.gpu`) for an adapter; rejects with `GfxError` `GFX_NO_WEBGPU` when
 * there is no WebGPU or no adapter. Nothing is created on the GPU.
 */
export async function requestWebGPU(gpu: GPU | undefined = globalThis.navigator?.gpu): Promise<GPUAdapter> {
  if (!gpu) throw new GfxError('GFX_NO_WEBGPU', { reason: 'this browser has no navigator.gpu' });
  let adapter: GPUAdapter | null;
  try {
    adapter = await gpu.requestAdapter();
  } catch (error) {
    throw new GfxError('GFX_NO_WEBGPU', { reason: `navigator.gpu.requestAdapter() failed (${String(error)})` });
  }
  if (!adapter) throw new GfxError('GFX_NO_WEBGPU', { reason: 'navigator.gpu.requestAdapter() gave no adapter' });
  return adapter;
}

/**
 * Starts three.js's `WebGPURenderer` on `canvas`, on WebGPU only: the adapter check, a device with every feature the
 * adapter offers, `await renderer.init()`, then the backend assertion. Rejects with `GfxError` `GFX_NO_WEBGPU` at
 * the first step that fails. Draw with `renderer.render(scene, camera)` or `PostProcessing.render()`.
 */
export async function createRenderer(canvas: HTMLCanvasElement, options: { antialias?: boolean } = {}): Promise<Gfx> {
  const adapter = await requestWebGPU();
  const features = [...adapter.features].sort();
  let device: GPUDevice;
  try {
    device = await adapter.requestDevice({ requiredFeatures: features as GPUFeatureName[] });
  } catch (error) {
    throw new GfxError('GFX_NO_WEBGPU', { reason: `the adapter gave no device (${String(error)})` });
  }
  const renderer = new WebGPURenderer({ canvas, device, antialias: options.antialias ?? false });
  await renderer.init();
  if ((renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend !== true) {
    renderer.dispose();
    throw new GfxError('GFX_NO_WEBGPU', { reason: 'three.js started another backend than WebGPU' });
  }
  const { vendor, architecture, device: name, description } = adapter.info;
  return {
    renderer,
    device,
    info: {
      backend: 'WebGPU',
      adapter: { vendor, architecture, device: name, description },
      features,
      three: REVISION,
    },
  };
}
