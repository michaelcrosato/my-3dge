/**
 * @file The post page's module (tests/pages/post.html, PLAN.md WP 7.4): the post-processing chain
 * (engine/gfx/post/chain.ts) over the Stress Box's room as the app draws it (engine/app/view.ts: the stage, the
 * movers' stand-ins, the iso camera), stepped by a live session, with two characters (capsules tagged `character`),
 * a glowing orb (an object, for bloom) and the material styles attached to the warm-up, so looks that change the
 * style are warm too. The canvas is 480 × 270 CSS px. Every frame draws through the chain (`post.view`), applying
 * the current style first (`styles.apply`).
 *
 * The chain's settings are declared (`definePostSettings`) before the URL is read, so URL parameters reach the chain,
 * and `window.__engine.shot` shoots the frame as the chain draws it (engine/gfx/shot.ts), so `node x shot` reports
 * the look metrics and the ID pass of any look and filters: `node x shot tests/pages/post.html --set
 * post.look=look:game-boy`, or `--set 'post.filters={"pixel":{"scope":"environment","size":6}}'`.
 *
 * `window.__postPage`:
 * - `setLook(id, filters)` sets `post.look` and `post.filters`, draws a frame and reports it: the pipelines it built,
 *   the chain's build count, and how many of the scene's materials changed version since the warm-up;
 * - `shoot({ ids, pixels })` shoots the frame as drawn (engine/gfx/shot.ts: pixels as base64, the ID pass);
 * - `parts()` shoots `post.show=parts` (characters red, objects green, the environment blue) and puts it back;
 * - `run(steps, every, looks)` steps the session, drawing after each step and switching to the next look every
 *   `every` steps; returns the hashes every 60 steps and the pipelines each frame built;
 * - `shootPlain()` shoots the frame drawn plainly, without the chain;
 * - `pixelArt(on)` tags every mesh drawn as a character (the capsules and the room's own stand-ins, which are
 *   characters through `userData`) as pixel art with `setPart(…, { pixelArt: true })`, keeping its group, or puts
 *   their own tags back;
 * - `withoutStyles(id)` draws look `id` through a chain of its own made without a style set, then disposes it;
 * - `slide(fractions, snap)` shoots the pixel filter with the camera moved across by each fraction of a block;
 * - `measureAa()` shoots the frame unsmoothed, with FXAA and with SMAA (each a chain of its own) and drawn plainly at
 *   4 × 4 the size, for the comparison that chose the edge smoothing.
 *
 * Invariants: `ready` turns true once the warm-up and the first frame are done, never after an error; frames are
 * drawn only when the page is called; the session's state is only stepped by `run`.
 *
 * @see tests/e2e/post.spec.ts
 */
import * as THREE from 'three/webgpu';
import roomText from '../../labs/box/levels/room.txt?raw';
import '../../labs/box/scenes/room';
import { createRunView } from '../../engine/app/view';
import { registry } from '../../engine/core/registry';
import { createSettings } from '../../engine/core/settings';
import { createMaterialLibrary } from '../../engine/gfx/materials/library';
import { createStyleSet } from '../../engine/gfx/materials/styles';
import { createPost, definePostSettings, type Post } from '../../engine/gfx/post/chain';
import type { FilterSpec } from '../../engine/gfx/post/filters';
import { flagsOf, setPart } from '../../engine/gfx/post/mrt';
import { blockSize } from '../../engine/gfx/post/snap';
import { createRenderer, type FrameReport, type FrameView, type Gfx, type GfxError } from '../../engine/gfx/renderer';
import { shot, shotForJson, type ShotJson, type ShotOptions } from '../../engine/gfx/shot';
import { createSession } from '../../engine/sim/scene';
import { defineLevel } from '../../engine/world/level/level';

/** One structured error record, as `window.__engine.errors` holds them (PLAN.md §8.3). */
interface ErrorRecord {
  code: string;
  message: string;
  fix: string;
}

/** The camera: the box's iso view, zoomed in so the characters and objects cover more of the picture. */
export const CAMERA = 'cam=iso,0,1.6';

/** The pixel filter's block size in the slide test, px. */
export const SLIDE_BLOCK = 6;

const message = document.querySelector<HTMLElement>('#msg');
const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
let info: Record<string, unknown> = { page: 'post' };
const signals = { ready: false, errors: [] as ErrorRecord[], info: () => info };
Object.assign(window, { __engine: signals });

/** Records the page's one error and shows it. */
function fail(record: ErrorRecord): void {
  signals.errors.push(record);
  if (message) {
    message.textContent = `${record.code}: ${record.message}\nFix: ${record.fix}`;
    message.hidden = false;
  }
  console.error(`[${record.code}] ${record.message}. Fix: ${record.fix}`);
}

/** Starts the renderer, the room, the chain; warms up and publishes `__postPage`. */
async function start(): Promise<void> {
  // The chain's settings are declared before the URL is read, so `?post.look=…` (`x shot --set`) reaches the chain.
  definePostSettings(registry);
  const settings = createSettings();
  settings.fromUrl(location.search);
  let gfx: Gfx;
  try {
    gfx = await createRenderer(canvas, { settings });
  } catch (error) {
    const { code, message, fix } = error as GfxError;
    if (code && fix) return fail({ code, message, fix });
    throw error;
  }
  gfx.renderer.shadowMap.enabled = true;
  if (!registry.has('level', 'level:room')) defineLevel('level:room', { text: roomText }, registry);
  const library = createMaterialLibrary();
  const styles = createStyleSet({ library });
  const session = createSession('box:room', { seed: 1 });
  const view = createRunView({ run: () => session, registry, materials: library, cam: CAMERA });
  const scene = view.stage.scene;
  view.stage.register(gfx.warmup);

  // Two characters and a glowing orb, tagged for the chain's parts.
  const body = new THREE.CapsuleGeometry(0.45, 1.3, 6, 16);
  for (const [name, x, z, material] of [
    ['hero', 5.5, 3.5, 'material:planks'],
    ['villager', 12.5, 8.5, 'material:barrel'],
  ] as const) {
    const character = new THREE.Mesh(body, library.get(material));
    character.name = name;
    character.position.set(x, 1.1, z);
    character.castShadow = character.receiveShadow = true;
    scene.add(setPart(character, 'character'));
  }
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.45, 32, 16), library.get('material:glow'));
  orb.name = 'orb';
  orb.position.set(8.5, 1.4, 9.5);
  scene.add(setPart(orb, 'object'));

  const post = createPost(gfx, { settings, styles });
  post.attach(gfx.warmup);
  styles.attach(gfx.warmup, scene);
  const aspect = () => canvas.clientWidth / Math.max(1, canvas.clientHeight);
  let slideBy = 0;
  /** The frame's view, through the chain, with the camera moved across by `slideBy` metres. */
  const viewNow = (through: Post = post): FrameView => {
    const frame = view.frame({ alpha: 1, dt: 1 / 60, aspect: aspect() });
    if (slideBy !== 0) {
      frame.camera.position.add(new THREE.Vector3().setFromMatrixColumn(frame.camera.matrixWorld, 0).multiplyScalar(slideBy)); // prettier-ignore
      frame.camera.updateMatrixWorld();
    }
    return through.view(frame);
  };
  await gfx.warmup.run(viewNow());

  /** The version of every material the scene draws (or may draw through the styles), by uuid. */
  const versions = () => {
    const out = new Map<string, number>();
    scene.traverse((object) => {
      const material = (object as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      for (const m of material ? [material].flat() : []) out.set(m.uuid, m.version);
    });
    for (const id of styles.ids) {
      const [entry, style] = id.split('@');
      const m = styles.get(entry, style as never);
      out.set(m.uuid, m.version);
    }
    return out;
  };
  let warmVersions = new Map<string, number>();
  /** The meshes `pixelArt(true)` tagged, each with the tag it had. */
  let artTags: [THREE.Object3D, unknown][] = [];

  /** Draws until a frame is drawn, waiting out any warm-up; resolves once the GPU has finished it. */
  const settle = async (through: Post = post): Promise<FrameReport> => {
    for (let tries = 0; tries < 10; tries++) {
      styles.apply(scene);
      const frameView = viewNow(through);
      const report = gfx.frame(frameView);
      if (report.drawn) {
        await gfx.device.queue.onSubmittedWorkDone();
        return report;
      }
      if (gfx.warmup.running) await gfx.warmup.run(frameView).catch(() => undefined);
    }
    throw new Error('post page: no frame was drawn in 10 tries');
  };
  /** How many materials changed version since the warm-up (a recompile bumps it). */
  const recompiled = () => {
    let changed = 0;
    for (const [uuid, version] of versions())
      if (warmVersions.has(uuid) && warmVersions.get(uuid) !== version) changed++;
    return changed;
  };

  const page = {
    gfx,
    post,
    scene,
    settings,
    three: THREE,
    looks: () => registry.list('look').map((look) => look.id),
    /** Draws look `id` with `filters` laid over it (see the file comment). */
    async setLook(id: string, filters: FilterSpec = {}) {
      settings.set('post.look', id);
      settings.set('post.filters', filters);
      const frame = await settle();
      return { frame, builds: post.builds, recompiled: recompiled(), style: styles.style, stats: gfx.stats() };
    },
    /** Shoots the frame as the chain draws it now. */
    async shoot(options: { ids?: boolean; pixels?: boolean } = {}): Promise<ShotJson> {
      await settle();
      const result = await shot(gfx, viewNow(), {
        ids: options.ids ?? false,
        pixels: options.pixels ?? true,
        metrics: false,
        thumbnail: false,
      });
      return shotForJson(result);
    },
    /** The parts view's pixels (see the file comment). */
    async parts(): Promise<ShotJson> {
      settings.set('post.show', 'parts');
      try {
        return await page.shoot();
      } finally {
        settings.set('post.show', 'picture');
      }
    },
    /** Steps the session (see the file comment). */
    async run(steps: number, every: number, looks: string[]) {
      const hashes: Record<string, string> = { 0: session.world.hash() };
      const built: number[] = [];
      let turn = 0;
      for (let k = 1; k <= steps; k++) {
        if (k % every === 0) settings.set('post.look', looks[turn++ % looks.length]);
        session.step();
        view.stepped();
        built.push((await settle()).built);
        if (k % 60 === 0) hashes[k] = session.world.hash();
      }
      return { hashes, built, switched: turn };
    },
    /** Tags every character as pixel art, or puts their own tags back (see the file comment). */
    pixelArt(on: boolean) {
      if (on && artTags.length === 0) {
        scene.traverse((object) => {
          if ((object as THREE.Mesh).isMesh && flagsOf(object).part === 'character')
            artTags.push([object, object.userData.post]);
        });
        for (const [object] of artTags) setPart(object, 'character', { group: flagsOf(object).group, pixelArt: true });
      } else if (!on) {
        for (const [object, tag] of artTags) {
          if (tag === undefined) delete object.userData.post;
          else object.userData.post = tag;
        }
        artTags = [];
      }
      return artTags.length;
    },
    /** Draws look `id` through a chain without a style set (see the file comment); returns the frame's report. */
    async withoutStyles(id: string): Promise<FrameReport> {
      const bare = createPost(gfx, { settings });
      const attached = bare.attach(gfx.warmup);
      settings.set('post.look', id);
      settings.set('post.filters', {});
      try {
        await gfx.warmup.run(viewNow(bare));
        return await settle(bare);
      } finally {
        attached.dispose();
        bare.dispose();
        settings.set('post.look', 'look:clean');
      }
    },
    /** Shoots the frame drawn plainly, without the chain. */
    async shootPlain(): Promise<ShotJson> {
      await settle();
      const frame = view.frame({ alpha: 1, dt: 1 / 60, aspect: aspect() });
      return shotForJson(await shot(gfx, frame, { ids: false, pixels: true, metrics: false, thumbnail: false }));
    },
    /**
     * The pixel filter (`SLIDE_BLOCK` px, every part) shot with the camera moved across by each fraction of a block;
     * `snap` as the filter's.
     */
    async slide(fractions: number[], snap: boolean) {
      settings.set('post.look', 'look:clean');
      settings.set('post.filters', { pixel: { scope: 'all', size: SLIDE_BLOCK, outline: false, snap } });
      await settle();
      const buffer = gfx.renderer.getDrawingBufferSize(new THREE.Vector2());
      const [across] = blockSize(view.drawn, SLIDE_BLOCK, { width: buffer.x, height: buffer.y });
      const shots: string[] = [];
      try {
        for (const fraction of fractions) {
          slideBy = fraction * across;
          shots.push((await page.shoot()).pixels!);
        }
      } finally {
        slideBy = 0;
        settings.set('post.filters', {});
      }
      return shots;
    },
    /** The edge smoothing comparison (see the file comment). */
    async measureAa() {
      settings.set('post.look', 'look:clean');
      settings.set('post.filters', {});
      const out: Record<string, ShotJson> = {};
      out.none = await page.shoot();
      settings.set('post.filters', { aa: { scope: 'all' } });
      for (const kind of ['fxaa', 'smaa'] as const) {
        const chain = kind === post.aa ? post : createPost(gfx, { settings, styles, aa: kind });
        const attached = chain === post ? null : chain.attach(gfx.warmup);
        // SMAA reads the picture in its own passes too, so its chain sets bloom up twice in its first frame: a
        // second warm-up builds what the second set-up asks for.
        if (attached) for (const _ of [1, 2]) await gfx.warmup.run(viewNow(chain));
        await settle(chain);
        out[kind] = shotForJson(await shot(gfx, viewNow(chain), { ids: false, pixels: true, metrics: false, thumbnail: false })); // prettier-ignore
        attached?.dispose();
        if (chain !== post) chain.dispose();
      }
      settings.set('post.filters', {});
      const frame = view.frame({ alpha: 1, dt: 1 / 60, aspect: aspect() });
      const { width, height } = out.none;
      const size = { width: width * 4, height: height * 4 };
      out.reference = shotForJson(await shot(gfx, frame, { size, ids: false, pixels: true, metrics: false, thumbnail: false })); // prettier-ignore
      return out;
    },
  };
  const first = await settle();
  if (first.built > 0) throw new Error(`post page: the first frame built ${first.built} pipelines`);
  warmVersions = versions();
  Object.assign(window, { __postPage: page });
  Object.assign(signals, {
    /** `x shot`'s entry: the frame as the chain draws it now, with the ID pass and the look metrics. */
    shot: async (options: ShotOptions = {}): Promise<ShotJson> => {
      await settle();
      return shotForJson(await shot(gfx, viewNow(), options));
    },
  });
  info = { page: 'post', ...gfx.info };
  if (message) message.hidden = true;
  signals.ready = true;
}

start().catch((error: unknown) => {
  const code = (error as { code?: string }).code ?? 'POST_PAGE_START';
  const fix = (error as { fix?: string }).fix ?? 'the console names the cause';
  fail({ code, message: String((error as Error).message ?? error), fix });
});
