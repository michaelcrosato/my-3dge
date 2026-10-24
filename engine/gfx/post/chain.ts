/**
 * @file Post-processing (PLAN.md WP 7.4, §6.7, I-46): `createPost` sets up, once, one `PostProcessing` chain (r182)
 * that every frame draws through, and draws the look the view settings name. The chain:
 * 1. the scene pass with the fixed MRT (engine/gfx/post/mrt.ts): colour, view normals with each object's flags (its
 *    tag as it is when the frame starts, `writeFlags`), depth;
 * 2. the shading (engine/gfx/post/shading.ts, WP 11.5: occlusion, reflections, bounce light, air) on the scene's light,
 *    the GPU's particles laid over it (engine/gfx/post/particles.ts, WP 11.3; a plain frame draws them straight), then
 *    `bloom` (three.js's `BloomNode`) added, never scoped; off at the `low` quality tier (WP 3.12), with advice
 *    `GFX_POST_NO_BLOOM` when a look asks for it there;
 * 3. the picture in display colours (`renderOutput`: the renderer's tone mapping and colour space), into a texture;
 * 4. `aa`, edge smoothing (engine/gfx/post/aa.ts: FXAA, SMAA or TRAA, as `post.aa` says), into a texture to read;
 * 5. the composite (engine/gfx/post/composite.ts): every other filter in one pass, gated by uniforms, in a fixed
 *    order, straight to the screen (the chain's colour transform is off: the composite ends in display colours).
 * Every filter is a uniform, so switching any filter, scope or look builds no pipeline and recompiles no material;
 * passes that are off do not run (bloom's, SMAA's), except in the warm-up's frame, which draws all of them. A plain
 * frame (`look:clean`) skips the chain's passes and draws the scene straight (`Post.plain`); the warm-up's frame draws
 * both ways (`Post.view` says how), so switching between them builds nothing.
 *
 * What it draws comes from the view settings `post.look`, `post.filters` and `post.show` (engine/gfx/post/settings.ts)
 * on the frames drawn through `post.view`: `createEngine` (engine/app/engine.ts) draws every frame and shot of its
 * pages through one chain, so `x set`, URL parameters and `__engine.set` reach them. A look's style is applied to the
 * style set given (`styles.setStyle`, WP 7.2); a look with style `''` puts back the set's own style and toon look;
 * without a style set a look draws only its filters, with advice `GFX_POST_NO_STYLES`. Each frame's pixel grid
 * (engine/gfx/post/grid.ts, WP 13.24): pixel art on the environment, or the whole screen's low resolution, snaps the
 * camera to its block grid for the frame and puts it back, the dithers' cells and the page's glide
 * (`gfx.resolution.shift`) following it; the art block and the ink's width follow the drawing buffer's lines. A look's
 * perspective variant (`perspective`) gives its filters and toon numbers while the camera is a perspective one.
 *
 * Use: `gfx.frame(post.view(frameView))` draws a frame through the chain; `post.attach(gfx.warmup)` once, before the
 * first warm-up, adds the chain's key part. Invariants: presentation only: nothing here reaches the sim or the hash;
 * the output graph is built once (`builds`), again only when the renderer's tone mapping or colour space changes,
 * which changes the warm-up's key; the camera is the same after a frame as before it.
 *
 * @example
 * // const post = createPost(gfx, { settings, styles });
 * // post.attach(gfx.warmup);
 * // post.use('look:hd-2d'); // the next frame draws it, building nothing
 * // gfx.frame(post.view(view.frame({ alpha, dt, aspect })));
 * @see tests/e2e/post.spec.ts
 */
import { Matrix4, PerspectiveCamera, PostProcessing, Scene, Vector2, type Camera, type PassNode, type ToneMapping, type WebGPURenderer } from 'three/webgpu'; // prettier-ignore
import { renderGroup, renderOutput, rtt, uniform, vec4 } from 'three/tsl';
import { bloom as bloomNode } from 'three/addons/tsl/display/BloomNode.js';
import { log as sharedLog, type Log } from '../../core/log';
import { registry as sharedRegistry, type Registry } from '../../core/registry';
import { createSettings, type Settings } from '../../core/settings';
import type { StyleSet } from '../materials/styles';
import type { ToonLook } from '../materials/toon';
import { qualityBudget, type QualityBudget, type QualitySetting } from '../quality';
import type { FrameView } from '../renderer';
import type { Resolution } from '../resolution';
import type { Warmup, WarmupPass } from '../warmup';
import { AA_CHOICE, aaKindFor, createAa, gateUpdates, type Aa, type AaKind } from './aa';
import { gpuParticlesFor, sceneTargetsFor, temporalAaFor, type FeatureReport, type TemporalAa } from '../features';
import { createComposite, POST_SHOW, type PostShow } from './composite';
import {
  createFilterUniforms,
  fixColor,
  fixLevels,
  isPlain,
  layerChain,
  writeFilters,
  type FilterChain,
  type FilterSpec,
} from './filters';
import { defineLooks, type LookEntry } from './looks';
import { clearMrt, createScenePass, FLAG_SLOTS, useSceneMrt, writeFlags } from './mrt';
import { createParticleLayer } from './particles';
import { definePostSettings } from './settings';
import { createShading } from './shading';
import { frameGrid, inkWidth } from './grid';

/** How `createPost` makes a chain. */
export interface PostOptions {
  /** The settings it reads (a store of its own by default). */
  settings?: Settings;
  /** The registry the looks are in (the shared one by default). */
  registry?: Registry;
  /** The style set a look's style is applied to; without it, looks change only filters (`GFX_POST_NO_STYLES`). */
  styles?: StyleSet;
  /** The edge smoothing (`AA_CHOICE` by default). */
  aa?: AaKind;
  /** The quality budget now (the setting `quality` on a desktop by default). */
  quality?: () => QualityBudget;
  log?: Log;
}

/** A post-processing chain (see the file comment). */
export interface Post {
  /** The look drawn now. */
  readonly look: LookEntry;
  /** The filters drawn now: the look's, with `post.filters` laid over them. */
  readonly chain: FilterChain;
  /** What the chain draws now. */
  readonly show: PostShow;
  /** The scene pass, whose `normal` texture r182's normal-based addons can read. */
  readonly scenePass: PassNode;
  /** How many times the output graph was built: 1, plus one per tone-mapping or colour-space change. */
  readonly builds: number;
  /**
   * Whether the last frame was plain and drew the scene straight, as the renderer does without a chain: every filter
   * off (`isPlain`), the picture shown, the materials in the style the chain was made with (the warm-up compiles the
   * others for the MRT alone). The chain's passes would leave the picture as it is, at the cost of the MRT's second
   * target and three full-screen passes: on SwiftShader through `createEngine` (WP 7.4's core proposal),
   * tests/e2e/parity.spec.ts's Box 4 replays, a frame drawn after each of 1,500 steps, took 193 s through the chain
   * against 118 s without it (at a load average of 36 to 41), and 108 to 110 s drawn straight against 119 s (at 5 to
   * 22).
   */
  readonly plain: boolean;
  /** The edge smoothing it was made with. */
  readonly aa: AaKind;
  /**
   * `frame` drawn through the chain: give it to `gfx.frame` or `shot`. It gives the warm-up the chain's two passes
   * (`WarmupView.passes`): the scene pass with its MRT on, where the entries and the material styles compile step by
   * step, then the target `render()` draws plain frames into. The warm frame draws the scene straight, and the chain's
   * passes over an empty scene, so it builds only those passes: on SwiftShader a pipeline's first draw costs time
   * again, and drawing the scene through the chain there too made each Stress Box page (the room, the hall, the fight)
   * about 1 s slower to start, for a picture a clean look never draws (gate G6's review). The first frame of another
   * look pays that instead, once, building nothing.
   */
  view(frame: FrameView): FrameView;
  /** Draws look `id` from the next frame (sets `post.look`). */
  use(id: string): void;
  /** Lays `filters` over the look from the next frame (sets `post.filters`); `{}` clears it. */
  set(filters: FilterSpec): void;
  /** Adds the chain's key part to `warmup`'s shader key; `dispose()` removes it. */
  attach(warmup: Warmup): { dispose(): void };
  /** Frees the chain's targets. */
  dispose(): void;
}

/** Chains made so far: each adds its key part under its own number. */
let chains = 0;

/** Makes the chain on `gfx.renderer` (see the file comment). */
export function createPost(
  gfx: { renderer: WebGPURenderer; features?: FeatureReport; resolution?: Pick<Resolution, 'shift'> },
  options: PostOptions = {},
): Post {
  const { renderer } = gfx;
  const registry = options.registry ?? sharedRegistry;
  definePostSettings(registry);
  const settings = options.settings ?? createSettings({ registry });
  const log = options.log ?? sharedLog;
  const styles = options.styles;
  const asked = options.aa ?? (settings.get<AaKind>('post.aa') || AA_CHOICE);
  const temporalAa = asked === 'traa' ? temporalAaFor(gfx.features) : null;
  const aaKind = aaKindFor(asked, temporalAa !== null); // feature:traa off: its advice said so
  const quality = options.quality ?? (() => qualityBudget(settings.get<QualitySetting>('quality'), false));
  defineLooks(registry);
  const serial = ++chains;
  const own = styles ? { style: styles.style, toon: styles.toon.values() as ToonLook } : null;

  // `view(frame)` gives the pass the frame's scene and camera; these stand in until the first frame.
  const scenePass = createScenePass(new Scene(), new PerspectiveCamera(), sceneTargetsFor(gfx.features, asked));
  const uniforms = createFilterUniforms();
  const invProj = uniform(new Matrix4()).setGroup(renderGroup);
  const bloomGate = uniform(0).setGroup(renderGroup);
  const aaGate = uniform(0).setGroup(renderGroup);
  const glow = bloomNode(scenePass.getTextureNode('output'), 0, 0.4, 0.9);
  let warming = false;
  const shading = createShading({ scenePass, features: gfx.features, warming: () => warming, log });
  const layer = gpuParticlesFor(gfx.features) ? createParticleLayer(scenePass) : null; // the GPU's particles
  const empty = new Scene();
  let bloomRuns = false;
  gateUpdates(glow, () => warming || bloomRuns);
  const processing = new PostProcessing(renderer);
  processing.outputColorTransform = false;

  let built: { tone: ToneMapping; space: string; aa: Aa; display: ReturnType<typeof rtt>; temporal: TemporalAa | null } | null = null; // prettier-ignore
  let builds = 0;
  /** (Re)builds the output graph for the renderer's tone mapping and colour space. */
  const build = () => {
    built?.aa.dispose();
    built?.display.renderTarget?.dispose();
    const shaded = shading.apply(scenePass.getTextureNode('output'));
    const lit = (layer ? layer.over(shaded) : shaded).add(glow.mul(bloomGate));
    const display = rtt(renderOutput(vec4(lit.rgb, 1), renderer.toneMapping, renderer.outputColorSpace));
    display.name = 'postDisplay'; // a WGSL identifier: r182 names the binding after it
    const runs = () => warming || aaGate.value > 0.5;
    let temporal: TemporalAa | null = null;
    const velocity = temporalAa ? scenePass.getTextureNode('velocity') : null;
    const aa = createAa(aaKind, display, aaGate, runs, (beauty) => {
      temporal = temporalAa!({ beauty, depth: scenePass.getTextureNode('depth'), velocity: velocity!, camera: scenePass.camera, runs }); // prettier-ignore
      return temporal.node;
    });
    processing.outputNode = createComposite({
      display: aa.texture,
      normals: scenePass.getTextureNode('normal'),
      depth: scenePass.getTextureNode('depth'),
      invProj,
      uniforms,
    });
    processing.needsUpdate = true;
    built = { tone: renderer.toneMapping, space: renderer.outputColorSpace, aa, display, temporal };
    builds++;
  };

  type Resolved = { id: string; over: unknown; look: LookEntry; chain: FilterChain; toon: ToonLook; variant?: Resolved }; // prettier-ignore
  let resolved: Resolved | null = null;
  /**
   * The look and chain the settings name now (the last ones while the settings are unchanged); for a `perspective`
   * camera, the look's variant's filters and toon numbers when it names one.
   */
  const resolve = (perspective = false): Resolved => {
    const base = resolveBase();
    if (!perspective || !base.look.perspective) return base;
    if (base.variant) return base.variant;
    const variant = registry.get('look', base.look.perspective) as LookEntry;
    base.variant = { ...base, chain: layerChain(variant.filters, fixColor(fixLevels(base.over as FilterSpec).spec).spec), toon: variant.toon }; // prettier-ignore
    return base.variant;
  };
  const resolveBase = (): Resolved => {
    const id = settings.get<string>('post.look');
    const over = settings.get('post.filters');
    if (resolved && resolved.id === id && resolved.over === over) return resolved;
    const look = registry.get('look', id) as LookEntry;
    const { spec: levelled, raised } = fixLevels(over as FilterSpec);
    for (const { name, levels } of raised) {
      log.warnOnce('GFX_POST_FEW_LEVELS', { where: `post.filters.${name}.levels`, levels }, name);
    }
    const { spec, dropped } = fixColor(levelled);
    if (dropped !== null) log.warnOnce('GFX_POST_BAD_COLOR', { color: JSON.stringify(dropped) }, dropped);
    resolved = { id, over, look, chain: layerChain(look.filters, spec), toon: look.toon };
    return resolved;
  };

  let applied: LookEntry | null = null;
  let appliedChain: FilterChain | null = null;
  let appliedToon: ToonLook | null = null;
  /** Writes the uniforms and the style when the look, its variant or the filters changed; returns the chain. */
  const sync = () => {
    const state = resolve((scenePass.camera as PerspectiveCamera).isPerspectiveCamera === true);
    if (state.chain !== appliedChain) writeFilters(uniforms, state.chain);
    appliedChain = state.chain;
    if (state.look !== applied && styles && own) {
      styles.setStyle(state.look.style || own.style, scenePass.scene);
    } else if (state.look !== applied && state.look.style) {
      log.warnOnce('GFX_POST_NO_STYLES', { look: state.look.id, style: state.look.style }, state.look.id);
    }
    if ((state.look !== applied || state.toon !== appliedToon) && styles && own) {
      styles.toon.set(state.look.style === 'toon' ? state.toon : own.toon);
    }
    applied = state.look;
    appliedToon = state.toon;
    const chain = state.chain;
    uniforms.frame.value.x = POST_SHOW.indexOf(settings.get<PostShow>('post.show'));
    const budget = quality();
    const wantsBloom = chain.bloom.scope === 'all' && chain.bloom.strength > 0;
    if (wantsBloom && !budget.bloom) {
      log.warnOnce('GFX_POST_NO_BLOOM', { tier: budget.tier, look: state.look.id }, state.look.id);
    }
    bloomRuns = wantsBloom && budget.bloom;
    bloomGate.value = bloomRuns ? 1 : 0;
    glow.strength.value = chain.bloom.strength;
    glow.threshold.value = chain.bloom.threshold;
    glow.radius.value = chain.bloom.radius;
    aaGate.value = chain.aa.scope === 'all' ? 1 : 0;
    shading.sync(chain, budget, state.look.id);
    return chain;
  };

  /**
   * How a frame draws the scene, for the warm-up: the scene pass with its MRT on, then what `render()` draws a plain
   * frame into. Entering the first makes the next frame the warm frame, which draws both ways.
   */
  const passes: readonly WarmupPass[] = [
    {
      target: scenePass.renderTarget,
      enter: () => {
        useSceneMrt(renderer, scenePass);
        warming = true;
      },
      leave: () => clearMrt(renderer),
    },
    {},
  ];

  const size = new Vector2();
  let frames = 0;
  let plain = false;
  /**
   * Draws the scene straight, as a plain frame does: in the set's own style, the only one a plain frame draws, so the
   * warm-up's frame builds those pipelines whatever look it draws (a page may start in a styled look, WP 7.8).
   */
  const straight = () => {
    const drawn = styles && own && styles.style !== own.style ? styles.style : null;
    if (drawn) styles!.setStyle(own!.style, scenePass.scene);
    renderer.render(scenePass.scene, scenePass.camera);
    if (drawn) styles!.setStyle(drawn, scenePass.scene);
  };
  /** Draws one frame: straight while the chain is plain, else through it; the warm-up's frame both ways. */
  const draw = () => {
    const chain = sync();
    // Straight only in the style the warm-up's frame drew: the warm-up compiles every other style for the MRT alone.
    plain = isPlain(chain) && uniforms.frame.value.x === 0 && (!styles || !own || styles.style === own.style);
    const particles = layer?.prepare(renderer, warming) ?? false;
    if (plain || warming) {
      clearMrt(renderer);
      straight();
      if (particles) layer!.straight(renderer);
      gfx.resolution?.shift(0, 0);
      if (!warming) return;
    }
    if (!built || built.tone !== renderer.toneMapping || built.space !== renderer.outputColorSpace) build();
    const camera = scenePass.camera as Camera;
    camera.updateMatrixWorld();
    invProj.value.copy(camera.projectionMatrixInverse);
    renderer.getDrawingBufferSize(size);
    const grid = frameGrid(chain, camera, { width: size.x, height: size.y });
    uniforms.pixel.value.y = grid.block;
    uniforms.outline.value.y = inkWidth(chain.outline, size.y);
    uniforms.frame.value.z = grid.cells[0];
    uniforms.frame.value.w = grid.cells[1];
    styles?.toon.grid.value.set(grid.cells[0], grid.cells[1], grid.block);
    gfx.resolution?.shift(grid.shift[0], grid.shift[1]);
    // After the snap: the shading reconstructs positions through the camera the scene pass draws with.
    shading.frame(camera, scenePass.scene, frames, size.y);
    built?.temporal?.follow(camera);
    uniforms.frame.value.y = frames++ / 60;
    const missed = writeFlags(scenePass);
    if (missed > 0) log.warnOnce('GFX_POST_FLAG_SLOTS', { missed, slots: FLAG_SLOTS }, 'slots');
    clearMrt(renderer);
    const scene = scenePass.scene;
    // The warm frame draws the chain's passes over an empty scene: the warm-up's first pass compiled the scene's.
    if (warming) scenePass.scene = empty;
    try {
      processing.render();
    } finally {
      scenePass.scene = scene;
      grid.restore();
      warming = false;
      layer?.done();
    }
  };

  return {
    get look() {
      return resolve().look;
    },
    get chain() {
      return resolve().chain;
    },
    get show() {
      return settings.get<PostShow>('post.show');
    },
    scenePass,
    get builds() {
      return builds;
    },
    get plain() {
      return plain;
    },
    aa: aaKind,
    view(frame) {
      scenePass.scene = frame.scene;
      scenePass.camera = frame.camera;
      layer?.view(frame.particles, frame.camera);
      return { ...frame, draw, passes };
    },
    use(id) {
      settings.set('post.look', id);
    },
    set(filters) {
      settings.set('post.filters', filters);
    },
    attach(warmup) {
      const part = warmup.keyPart(`post#${serial}`, () => `${aaKind}`);
      return { dispose: () => part.dispose() };
    },
    dispose() {
      built?.aa.dispose();
      built?.display.renderTarget?.dispose();
      glow.dispose();
      shading.dispose();
      layer?.dispose();
      scenePass.dispose();
      processing.dispose();
    },
  };
}
