/**
 * @file The harness page's module (`tests/pages/harness.html`), the page `tests/e2e/harness.spec.ts` checks the e2e
 * fixture on: it draws with raw WebGPU, signals ready through `window.__engine`, and with `?throw` throws on purpose
 * from `explode` below.
 *
 * Invariants: every frame clears the 64×48 canvas to `CLEAR` and draws a `TRIANGLE`-coloured triangle over its
 * centre: once at startup, then once per animation frame (which only the virtual clock runs). The type declarations
 * above `explode` vanish from the served JavaScript, which moves the throw to another line there, so the fixture
 * naming this file's line proves it applied the source map.
 */
/// <reference types="@webgpu/types" />

/** One structured error record, as `window.__engine.errors` holds them (PLAN.md §8.3). */
interface ErrorRecord {
  code: string;
  message: string;
}

/** The ready-or-error signal this page publishes as `window.__engine`, plus its frame count for the spec. */
interface HarnessSignals {
  ready: boolean;
  errors: ErrorRecord[];
  frames: number;
  info(): { backend: string; adapter: string };
}

/** The clear colour, RGBA in [0, 1], written to the canvas as is (an 8-bit format without sRGB encoding). */
const CLEAR = { r: 0.1, g: 0.2, b: 0.3, a: 1 };

/** The triangle's colour; `SHADER` writes the same numbers. */
const TRIANGLE = [1, 0.5, 0, 1] as const;

const SHADER = /* wgsl */ `
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var corners = array<vec2f, 3>(vec2f(0.0, 0.8), vec2f(-0.8, -0.8), vec2f(0.8, -0.8));
  return vec4f(corners[i], 0.0, 1.0);
}
@fragment fn fs() -> @location(0) vec4f {
  return vec4f(${TRIANGLE.join(', ')});
}`;

const signals: HarnessSignals = { ready: false, errors: [], frames: 0, info: () => ({ backend: 'none', adapter: '' }) };
Object.assign(window, { __engine: signals });

/** Throws on purpose, for the fixture's source-mapping check. */
function explode(): never {
  throw new Error('harness: thrown on purpose'); // thrown here: harness.spec.ts looks for this line
}

/** Starts WebGPU, draws the first frame, keeps drawing on animation frames, and signals ready. */
async function start(): Promise<void> {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) {
    signals.errors.push({ code: 'GFX_NO_WEBGPU', message: 'no WebGPU adapter: launch Chromium with WEBGPU_FLAGS' });
    return;
  }
  const device = await adapter.requestDevice();
  const canvas = document.querySelector('canvas');
  const context = canvas?.getContext('webgpu');
  if (!context) throw new Error('harness: no canvas, or it gave no WebGPU context');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  const module = device.createShaderModule({ code: SHADER });
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
  });
  const draw = () => {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: CLEAR },
      ],
    });
    pass.setPipeline(pipeline);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
    signals.frames++;
  };
  const loop = () => {
    draw();
    requestAnimationFrame(loop);
  };
  draw();
  requestAnimationFrame(loop);
  await device.queue.onSubmittedWorkDone();
  signals.info = () => ({ backend: 'WebGPU', adapter: adapter.info.architecture });
  signals.ready = true;
}

if (new URLSearchParams(location.search).has('throw')) explode();
start().catch((error: unknown) => signals.errors.push({ code: 'HARNESS_START', message: String(error) }));

// A module, not a script: its names stay out of the global scope of the TypeScript program.
export {};
