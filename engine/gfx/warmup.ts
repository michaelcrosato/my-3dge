/**
 * @file The warm-up registry (PLAN.md §8.7, I-18): every GPU pipeline is built before play needs it, so no frame
 * stalls on one. Pools and batches register the objects they will show (`register(id, { objects })`); `run(view)`
 * makes each drawable without showing it, compiles the scene with three.js's `compileAsync` one step per entry with
 * progress, then draws one warm frame through the view's own `draw`, which builds what `compileAsync` cannot reach
 * (the shadow, post and output passes). `key(scene)` is the scene's shader key: fog, environment, background, shadow
 * map, tone mapping, output colour space, the lights as r182's `LightsNode` keys them (id and `castShadow`), the
 * registered ids, and the parts other modules add (`keyPart`, the post filters of WP 7.4). The frame re-runs the
 * warm-up whenever the key changes (engine/gfx/renderer.ts), so toggling fog, shadows, a filter or a light rebuilds
 * at a moment of the engine's choosing, never in the middle of a frame.
 *
 * Measured on r182 (WP 2.1): `compileAsync` compiles for the render target set on the renderer, and `render()` draws
 * a scene into an internal half-float target whenever it converts colours for the screen, so a plain `compileAsync`
 * built 4 pipelines `render()` never used and missed 4 it did. The warm-up therefore compiles for the target the
 * frame really draws the scene into: `view.target` when given (a post pass's `renderTarget`), else a 1 × 1 stand-in
 * with the internal target's attachments, which shares its render context; the warm frame catches the rest.
 *
 * Drawable without showing: each registered object, and each hidden ancestor of it, is made visible, and the
 * topmost one made visible is scaled to nothing; an `InstancedMesh` with no instances gets one, at zero scale; every
 * object in the scene is drawn without frustum culling, so what is behind the camera is built too. All of it is put
 * back afterwards, in reverse order. Carried from `my-3d2dge:src/stress-world/50-frame.js:29-47` (`warmUp()`) as the
 * idea for a registry.
 *
 * Invariants: one warm-up runs at a time (a second `run` returns the first's promise); entries and key parts are kept
 * in id order; the report counts the pipelines this warm-up built (counted at the device, engine/gfx/pipelines.ts).
 *
 * @example
 * // const warmup = createWarmup({ renderer, counter: countPipelines(device) });
 * // warmup.register('pool:sparks', { objects: () => [sparks.mesh] });
 * // const report = await warmup.run({ scene, camera }, { onProgress: ({ done, total }) => bar(done / total) });
 * @see tests/e2e/renderer.spec.ts
 * @see engine/gfx/warmup.test.ts
 */
import {
  ColorManagement,
  Matrix4,
  RenderTarget,
  type Camera,
  type ColorSpace,
  type InstancedMesh,
  type Object3D,
  type Scene,
  type WebGPURenderer,
} from 'three/webgpu';
import { codeError, defineCodes } from '../core/log';
import { advanceFrame, type PipelineCounter } from './pipelines';

/** The codes this module raises, with their fixes. */
export const WARMUP_CODES = defineCodes('gfx', {
  GFX_DUPLICATE_WARMUP: {
    template: 'the warm-up already has an entry {id}',
    fix: 'dispose the first registration (register returns { dispose }), or register the second under another id',
  },
});

/** What a pool or batch registers: the objects it may show, each made drawable for the warm-up. */
export interface WarmupEntry {
  objects(): readonly Object3D[];
}

/** What a warm-up draws: the scene, its camera, how the frame draws it, and what it draws the scene into. */
export interface WarmupView {
  scene: Scene;
  camera: Camera;
  /** The frame's own drawing (a post pass's `render()`); `renderer.render(scene, camera)` by default. */
  draw?: () => void;
  /** The render target the scene is drawn into (a post pass's `renderTarget`); what `render()` uses by default. */
  target?: RenderTarget | null;
}

/** Progress, after each step: steps done of the total, and the step just done. */
export interface WarmupProgress {
  done: number;
  total: number;
  step: string;
}

/** What one warm-up did. */
export interface WarmupReport {
  /** Which warm-up this was: 1 for the first. */
  count: number;
  /** The shader key it warmed. */
  key: string;
  /** The registered ids it warmed, in order. */
  entries: string[];
  /** Pipelines `compileAsync` built. */
  compiled: number;
  /** Pipelines the warm frame built. */
  drawn: number;
  /** Both together. */
  built: number;
  /** How long it took, in milliseconds. */
  ms: number;
}

/** A renderer's warm-up registry. */
export interface Warmup {
  /** Registers a pool or batch's objects under `id`; `dispose()` removes them. Changes the shader key. */
  register(id: string, entry: WarmupEntry): { dispose(): void };
  /** Adds a part to the shader key (a filter chain's name, a light budget); `dispose()` removes it. */
  keyPart(name: string, part: () => string): { dispose(): void };
  /** The shader key of `scene` now: when it differs from the last warm-up's, pipelines may be missing. */
  key(scene: Scene): string;
  /** Builds every pipeline the view needs; resolves with what it built. */
  run(view: WarmupView, options?: { onProgress?: (progress: WarmupProgress) => void }): Promise<WarmupReport>;
  /** The last finished warm-up's report; null before the first. */
  readonly last: WarmupReport | null;
  /** Whether a warm-up is running. */
  readonly running: boolean;
  /** Pipelines built during warm-ups, all of them, the running one's so far included. */
  readonly built: number;
  /** The device's pipeline count when the first warm-up started; null before. */
  readonly start: number | null;
}

/** A scale of nothing, for an instance that must be drawn but not seen. */
const ZERO = new Matrix4().makeScale(0, 0, 0);

/** Makes `object` drawable inside `scene` without showing it; returns how to put it back. */
function makeDrawable(object: Object3D, scene: Object3D): () => void {
  const undo: (() => void)[] = [];
  let topmost: Object3D | null = null;
  for (let node: Object3D | null = object; node && node !== scene; node = node.parent) {
    if (node.visible) continue;
    const hidden = node;
    hidden.visible = true;
    topmost = hidden;
    undo.push(() => void (hidden.visible = false));
  }
  if (topmost) {
    const shrunk = topmost;
    const scale = shrunk.scale.clone();
    shrunk.scale.set(0, 0, 0);
    undo.push(() => void shrunk.scale.copy(scale));
  }
  const mesh = object as InstancedMesh;
  if (mesh.isInstancedMesh && mesh.count === 0) {
    const kept = new Matrix4();
    mesh.getMatrixAt(0, kept);
    const upload = (matrix: Matrix4) => {
      mesh.setMatrixAt(0, matrix);
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.needsUpdate = true;
    };
    mesh.count = 1;
    upload(ZERO);
    undo.push(() => {
      mesh.count = 0;
      upload(kept);
    });
  }
  return () => undo.reverse().forEach((step) => step());
}

/** Draws every object of `scene` without frustum culling; returns how to put it back. */
function unculled(scene: Scene): () => void {
  const culled: Object3D[] = [];
  scene.traverse((object) => {
    if (!object.frustumCulled) return;
    object.frustumCulled = false;
    culled.push(object);
  });
  return () => culled.forEach((object) => void (object.frustumCulled = true));
}

/** The kind of a scene's background or environment, as it changes shaders: none, colour, texture or cube texture. */
function kindOf(value: unknown): string {
  const thing = value as { isColor?: boolean; isCubeTexture?: boolean; isTexture?: boolean } | null;
  if (!thing) return 'none';
  return thing.isColor ? 'color' : thing.isCubeTexture ? 'cube' : thing.isTexture ? 'texture' : 'node';
}

/** Makes the warm-up registry of `renderer`, counting builds with `counter`. */
export function createWarmup(options: { renderer: WebGPURenderer; counter: PipelineCounter }): Warmup {
  const { renderer, counter } = options;
  const entries = new Map<string, WarmupEntry>();
  const parts = new Map<string, () => string>();
  let standIn: RenderTarget | null = null;
  let running: Promise<WarmupReport> | null = null;
  let last: WarmupReport | null = null;
  let built = 0;
  let start: number | null = null;
  /** The device's pipeline count when the running warm-up began. */
  let began: number | null = null;
  const sorted = <T>(map: Map<string, T>) => [...map.keys()].sort();
  const builtNow = () => counter.count().built;

  /** The target the frame draws the scene into, when it is not the canvas. */
  const targetOf = (view: WarmupView): RenderTarget | null => {
    if (view.target !== undefined) return view.target;
    if (!renderer.needsFrameBufferTarget) return null;
    standIn ??= new RenderTarget(1, 1, {
      type: renderer.getOutputBufferType(),
      depthBuffer: renderer.depth,
      stencilBuffer: renderer.stencil,
      samples: renderer.samples,
      colorSpace: ColorManagement.workingColorSpace as ColorSpace,
    });
    return standIn;
  };

  const warmup: Warmup = {
    register(id, entry) {
      if (entries.has(id)) throw codeError('GFX_DUPLICATE_WARMUP', { id });
      entries.set(id, entry);
      return { dispose: () => void entries.delete(id) };
    },
    keyPart(name, part) {
      parts.set(name, part);
      return { dispose: () => void parts.delete(name) };
    },
    key(scene) {
      const lights: string[] = [];
      scene.traverseVisible((object) => {
        if ((object as { isLight?: boolean }).isLight) lights.push(`${object.id}${object.castShadow ? 's' : ''}`);
      });
      const fog = scene.fog ? ((scene.fog as { isFogExp2?: boolean }).isFogExp2 ? 'exp2' : 'linear') : 'none';
      const { shadowMap } = renderer;
      return [
        `fog:${fog}`,
        `env:${kindOf(scene.environment)}`,
        `bg:${kindOf(scene.background)}`,
        `shadows:${shadowMap.enabled ? shadowMap.type : 'off'}`,
        `tone:${renderer.toneMapping}`,
        `out:${renderer.outputColorSpace}`,
        `lights:${lights.join(',')}`,
        `entries:${sorted(entries).join(',')}`,
        ...sorted(parts).map((name) => `${name}:${parts.get(name)!()}`),
      ].join('|');
    },
    run(view, { onProgress } = {}) {
      running ??= warm(view, onProgress).finally(() => (running = null));
      return running;
    },
    get last() {
      return last;
    },
    get running() {
      return running !== null;
    },
    get built() {
      return built + (began === null ? 0 : builtNow() - began);
    },
    get start() {
      return start;
    },
  };

  /** One warm-up: compile step by step, draw the warm frame, put everything back, report. */
  async function warm(view: WarmupView, onProgress?: (progress: WarmupProgress) => void): Promise<WarmupReport> {
    const { scene, camera } = view;
    const startedAt = performance.now();
    const before = builtNow();
    start ??= before;
    began = before;
    const key = warmup.key(scene);
    const ids = sorted(entries);
    const total = ids.length + 2;
    const undo = [unculled(scene)];
    const progress = (done: number, step: string) => onProgress?.({ done, total, step });
    try {
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(targetOf(view));
      try {
        await renderer.compileAsync(scene, camera);
        progress(1, 'scene');
        for (const [i, id] of ids.entries()) {
          for (const object of entries.get(id)!.objects()) undo.push(makeDrawable(object, scene));
          await renderer.compileAsync(scene, camera);
          progress(i + 2, id);
        }
      } finally {
        renderer.setRenderTarget(previous);
      }
      const compiled = builtNow() - before;
      advanceFrame(renderer);
      (view.draw ?? (() => renderer.render(scene, camera)))();
      progress(total, 'frame');
      const done = builtNow() - before;
      last = {
        count: (last?.count ?? 0) + 1,
        key,
        entries: ids,
        compiled,
        drawn: done - compiled,
        built: done,
        ms: performance.now() - startedAt,
      };
      return last;
    } finally {
      undo.reverse().forEach((step) => step());
      built += builtNow() - before;
      began = null;
    }
  }

  return warmup;
}
