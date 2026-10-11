/**
 * @file Post-processing (PLAN.md WP 7.4, §6.7, I-46): `createPost` sets up, once, one `PostProcessing` chain (r182)
 * that every frame draws through, and draws the look the view settings name. The chain:
 * 1. the scene pass with the fixed MRT (engine/gfx/post/mrt.ts): colour, view normals with each object's flags,
 *    depth;
 * 2. `bloom` (three.js's `BloomNode`) on the scene's light, added before anything else and never scoped; off at the
 *    `low` quality tier (WP 3.12), with advice `GFX_POST_NO_BLOOM` when a look asks for it there;
 * 3. the picture in display colours (`renderOutput`: the renderer's tone mapping and colour space), drawn into a
 *    texture;
 * 4. `aa`, edge smoothing (engine/gfx/post/aa.ts), into a texture the composite can read at any pixel;
 * 5. the composite (engine/gfx/post/composite.ts): every other filter in one pass, gated by uniforms, in a fixed
 *    order, straight to the screen (the chain's colour transform is off: the composite ends in display colours).
 * Every filter is a uniform, so switching any filter, scope or look builds no pipeline and recompiles no material;
 * passes that are off do not run (bloom's, SMAA's), except in the warm-up's frame, which draws all of them.
 *
 * What it draws comes from three view settings (doctrine: Agent-operable; `x set`, URL parameters, `__engine.set`):
 * `post.look` (a `look` id, engine/gfx/post/looks.ts), `post.filters` (part of a filter chain laid over the look's,
 * filter by filter and field by field) and `post.show` (`picture`, or what the MRT holds: `parts`, `normals`,
 * `groups`). A look's style is applied to the style set given (`styles.setStyle`, WP 7.2); a look with style `''`
 * puts back the style the set had when the chain was made, and its toon look. Pixel art on the environment, or
 * the whole screen's low resolution, snaps the camera to its block grid for the frame (`snapBlock`,
 * engine/gfx/post/snap.ts) and puts it back.
 *
 * Use: `gfx.frame(post.view(frameView))` draws a frame through the chain; `post.attach(gfx.warmup)` once, before the
 * first warm-up, registers the MRT's compile step and the chain's key part.
 *
 * Invariants: presentation only: nothing here reaches the sim or the hash (the settings are view settings); the
 * output graph is built once (`builds`), again only when the renderer's tone mapping or colour space changes, which
 * changes the warm-up's key; the camera is the same after a frame as before it.
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
import { defineCodes, log as sharedLog, type Log } from '../../core/log';
import { registry as sharedRegistry, type Registry } from '../../core/registry';
import { createSettings, defineSettings, type Settings } from '../../core/settings';
import type { Field } from '../../core/schema';
import type { StyleSet } from '../materials/styles';
import type { ToonLook } from '../materials/toon';
import { QUALITY_SETTINGS, qualityBudget, type QualityBudget, type QualitySetting } from '../quality';
import type { FrameView } from '../renderer';
import type { Warmup } from '../warmup';
import { AA_CHOICE, createAa, gateUpdates, type Aa, type AaKind } from './aa';
import { createComposite, POST_SHOW, type PostShow } from './composite';
import {
  createFilterUniforms,
  FILTER_FIELDS,
  fixLevels,
  layerChain,
  partialSchema,
  scopeMask,
  writeFilters,
  type FilterChain,
  type FilterSpec,
} from './filters';
import { defineLooks, type LookEntry } from './looks';
import { clearMrt, createScenePass, PART_BITS, useSceneMrt, WARM_MRT_ID } from './mrt';
import { snapToBlocks } from './snap';

/** The codes this module raises, with their fixes. */
export const POST_CODES = defineCodes('gfx', {
  GFX_POST_NO_BLOOM: {
    template: 'bloom is off at the {tier} quality tier: {look} draws without its glow',
    fix: "raise the view setting quality to 'medium' or 'high' to see the glow; nothing else about the look changes",
    doc: 'Advice from the post chain (engine/gfx/post/chain.ts): the look asks for bloom, which the quality tier turns off (WP 3.12).',
  },
  GFX_POST_FEW_LEVELS: {
    template: '{where} asks for {levels} levels per channel; the chain draws 8',
    fix: 'posterize with 0 (off) or 8 levels and more: fewer shift the hue of dull colours (shardfall measured a grey floor turning pink)',
    doc: 'Advice from the post chain when `post.filters` sets 1–7 levels; looks are checked when they are defined.',
  },
});

/** The view settings the chain reads (see the file comment). */
export const POST_SETTINGS = {
  'post.look': {
    type: 'string',
    default: 'look:clean',
    view: true,
    description: "The look drawn: a 'look' id (look:clean, look:hd-2d, look:palette/game-boy, …).",
  },
  'post.filters': {
    type: 'object',
    default: {},
    view: true,
    properties: partialSchema(FILTER_FIELDS),
    description: 'Filters laid over the look, field by field: { "pixel": { "scope": "environment", "size": 6 } }.',
  },
  'post.show': {
    type: 'string',
    enum: POST_SHOW,
    default: 'picture',
    view: true,
    description: "What the chain draws: the 'picture', or what its MRT holds: 'parts', 'normals' or 'groups'.",
  },
} as const satisfies Record<string, Field>;
defineSettings(POST_SETTINGS);

/** Declares the chain's settings and the quality setting on `registry`, unless it has them. */
function defineOn(registry: Registry): void {
  if (registry === sharedRegistry) return;
  if (!registry.has('setting', 'post.look')) defineSettings(POST_SETTINGS, registry);
  if (!registry.has('setting', 'quality')) defineSettings(QUALITY_SETTINGS, registry);
}

/** How `createPost` makes a chain. */
export interface PostOptions {
  /** The settings it reads (a store of its own by default). */
  settings?: Settings;
  /** The registry the looks are in (the shared one by default). */
  registry?: Registry;
  /** The style set a look's style is applied to; without it, looks change only filters. */
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
  /** The edge smoothing it was made with. */
  readonly aa: AaKind;
  /** `frame` drawn through the chain: give it to `gfx.frame` or `shot`. */
  view(frame: FrameView): FrameView;
  /** Draws look `id` from the next frame (sets `post.look`). */
  use(id: string): void;
  /** Lays `filters` over the look from the next frame (sets `post.filters`); `{}` clears it. */
  set(filters: FilterSpec): void;
  /** Registers the MRT's compile step and the chain's key part with `warmup`; `dispose()` removes them. */
  attach(warmup: Warmup): { dispose(): void };
  /** Frees the chain's targets. */
  dispose(): void;
}

/**
 * The block grid the camera snaps to for `chain`: pixel art's when it covers the environment and snaps (characters
 * and objects in pixel art move on their own, and a snapping camera would make a sharp world jump), else the whole
 * screen's low resolution; 1 for none.
 */
export function snapBlock(chain: FilterChain): number {
  if (chain.pixel.snap && (scopeMask(chain.pixel.scope) & PART_BITS.environment) !== 0) return chain.pixel.size;
  return chain.screen.scope === 'all' ? chain.screen.pixelate : 1;
}

/** Chains made so far: each registers its warm-up entry and key part under its own number. */
let chains = 0;

/** Makes the chain on `gfx.renderer` (see the file comment). */
export function createPost(gfx: { renderer: WebGPURenderer }, options: PostOptions = {}): Post {
  const { renderer } = gfx;
  const registry = options.registry ?? sharedRegistry;
  defineOn(registry);
  const settings = options.settings ?? createSettings({ registry });
  const log = options.log ?? sharedLog;
  const styles = options.styles;
  const aaKind = options.aa ?? AA_CHOICE;
  const quality = options.quality ?? (() => qualityBudget(settings.get<QualitySetting>('quality'), false));
  defineLooks(registry);
  const serial = ++chains;
  const own = styles ? { style: styles.style, toon: styles.toon.values() as ToonLook } : null;

  // `view(frame)` gives the pass the frame's scene and camera; these stand in until the first frame.
  const scenePass = createScenePass(new Scene(), new PerspectiveCamera());
  const uniforms = createFilterUniforms();
  const invProj = uniform(new Matrix4()).setGroup(renderGroup);
  const bloomGate = uniform(0).setGroup(renderGroup);
  const aaGate = uniform(0).setGroup(renderGroup);
  const glow = bloomNode(scenePass.getTextureNode('output'), 0, 0.4, 0.9);
  let warming = false;
  let bloomRuns = false;
  gateUpdates(glow, () => warming || bloomRuns);
  const processing = new PostProcessing(renderer);
  processing.outputColorTransform = false;

  let built: { tone: ToneMapping; space: string; aa: Aa; display: ReturnType<typeof rtt> } | null = null;
  let builds = 0;
  /** (Re)builds the output graph for the renderer's tone mapping and colour space. */
  const build = () => {
    built?.aa.dispose();
    built?.display.renderTarget?.dispose();
    const colour = scenePass.getTextureNode('output');
    const lit = colour.add(glow.mul(bloomGate));
    const display = rtt(renderOutput(vec4(lit.rgb, 1), renderer.toneMapping, renderer.outputColorSpace));
    display.name = 'postDisplay'; // a WGSL identifier: r182 names the binding after it
    const aa = createAa(aaKind, display, aaGate, () => warming || aaGate.value > 0.5);
    processing.outputNode = createComposite({
      display: aa.texture,
      normals: scenePass.getTextureNode('normal'),
      depth: scenePass.getTextureNode('depth'),
      invProj,
      uniforms,
    });
    processing.needsUpdate = true;
    built = { tone: renderer.toneMapping, space: renderer.outputColorSpace, aa, display };
    builds++;
  };

  let resolved: { id: string; over: unknown; look: LookEntry; chain: FilterChain } | null = null;
  /** The look and chain the settings name now (the last ones while the settings are unchanged). */
  const resolve = () => {
    const id = settings.get<string>('post.look');
    const over = settings.get('post.filters');
    if (resolved && resolved.id === id && resolved.over === over) return resolved;
    const look = registry.get('look', id) as LookEntry;
    const { spec, raised } = fixLevels(over as FilterSpec);
    for (const { name, levels } of raised) {
      log.warnOnce('GFX_POST_FEW_LEVELS', { where: `post.filters.${name}.levels`, levels }, name);
    }
    resolved = { id, over, look, chain: layerChain(look.filters, spec) };
    return resolved;
  };

  let applied: LookEntry | null = null;
  let appliedChain: FilterChain | null = null;
  /** Writes the uniforms and the style when the look or the filters changed; returns the chain. */
  const sync = () => {
    const state = resolve();
    if (state.chain !== appliedChain) writeFilters(uniforms, state.chain);
    appliedChain = state.chain;
    if (state.look !== applied && styles && own) {
      styles.setStyle(state.look.style || own.style, scenePass.scene ?? undefined);
      styles.toon.set(state.look.style === 'toon' ? state.look.toon : own.toon);
    }
    applied = state.look;
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
    return chain;
  };

  const size = new Vector2();
  let frames = 0;
  /** Draws one frame through the chain. */
  const draw = () => {
    const chain = sync();
    if (!built || built.tone !== renderer.toneMapping || built.space !== renderer.outputColorSpace) build();
    const camera = scenePass.camera as Camera;
    camera.updateMatrixWorld();
    invProj.value.copy(camera.projectionMatrixInverse);
    uniforms.frame.value.y = frames++ / 60;
    renderer.getDrawingBufferSize(size);
    const block = snapBlock(chain);
    const restore = block > 1 ? snapToBlocks(camera, block, { width: size.x, height: size.y }) : null;
    clearMrt(renderer);
    try {
      processing.render();
    } finally {
      restore?.();
      warming = false;
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
    aa: aaKind,
    view(frame) {
      scenePass.scene = frame.scene;
      scenePass.camera = frame.camera;
      return { ...frame, draw, target: scenePass.renderTarget };
    },
    use(id) {
      settings.set('post.look', id);
    },
    set(filters) {
      settings.set('post.filters', filters);
    },
    attach(warmup) {
      const entry = warmup.register(`${WARM_MRT_ID}#${serial}`, {
        objects: () => {
          if (renderer.getRenderTarget() === scenePass.renderTarget) {
            useSceneMrt(renderer, scenePass);
            warming = true;
          }
          return [];
        },
      });
      const part = warmup.keyPart(`post#${serial}`, () => `${aaKind}`);
      return { dispose: () => (entry.dispose(), part.dispose()) };
    },
    dispose() {
      built?.aa.dispose();
      built?.display.renderTarget?.dispose();
      glow.dispose();
      scenePass.dispose();
      processing.dispose();
    },
  };
}
