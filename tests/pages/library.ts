/**
 * @file The library page's module (tests/pages/library.html, PLAN.md WP 8.6): the clip library in the browser,
 * the Mocap Lab check (`my-3d2dge:tools/mocap-test.mjs`) rewritten as a smoke test. The engine's renderer draws a lit
 * scene with two figures side by side, the mannequin (`body:mannequin` on `build:mannequin`, the Quaternius set's
 * own body, engine/gfx/puppets/bodies/mannequin.ts) on the left and the humanoid (`body:humanoid` on `build:heroic`)
 * on the right, each a rigid-skinned puppet posed by an animator whose clip layer plays the clip; a third puppet of
 * the mannequin is posed by three.js's `AnimationMixer` instead.
 *
 * Clips come in as text through `import.meta.glob` (never a `fetch()`): a set's `_set.json` and the clip's own file,
 * read by the codec into a library of that one clip (`loadClipLibrary`).
 *
 * `window.__libraryPage`:
 * - `play({ dir, clip, moments })` plays `data/anim/sets/<dir>/<clip>.json` on both figures from its start (no fade,
 *   a one-shot holding its end), steps the sim at 60 Hz and, at `moments` moments spread from its start to its end,
 *   poses the puppets, draws a frame and shoots it: what the ID pass sees, and what `animCheck` finds in each
 *   figure's pose (values not finite, bones that changed length, feet below the floor, sockets out of reach).
 * - `mixer({ dir, clip })` plays the same clip's baked tracks as a three.js `AnimationClip` (retarget.ts `clipJSON`)
 *   on the mixer's puppet, every 60 Hz tick, against the clip layer without contact IK on the same build: the largest
 *   distance between a bone the mixer posed and the joint FK puts there (m); then draws the clip's middle frame,
 *   the mixer's puppet alone, for the ID pass.
 *
 * Invariants: `ready` turns true once the warm-up has run and the empty scene has drawn, never after an error; frames
 * are drawn by calling the page; the three puppets are registered with the warm-up before the first frame, so playing
 * a clip compiles nothing.
 *
 * @see tests/e2e/library.spec.ts
 */
import * as THREE from 'three/webgpu';
import { animCheck } from '../../engine/anim/check';
import { Animator } from '../../engine/anim/character';
import { ClipLayer } from '../../engine/anim/clip/layer';
import { loadClipLibrary, type ClipLibrary } from '../../engine/anim/clip/library';
import { clipJSON } from '../../engine/anim/clip/retarget';
import { parseClip } from '../../engine/anim/clip/validate';
import { jointPosition } from '../../engine/anim/fk';
import { JOINTS } from '../../engine/anim/skeleton';
import { createSettings } from '../../engine/core/settings';
import type { IdEntry } from '../../engine/gfx/idpass';
import { createMaterialLibrary } from '../../engine/gfx/materials/library';
import { defineMannequin } from '../../engine/gfx/puppets/bodies/mannequin';
import { compileBody } from '../../engine/gfx/puppets/compile';
import { createPuppet, type Puppet } from '../../engine/gfx/puppets/draw';
import { createRenderer, type FrameReport, type FrameView, type Gfx, type GfxError } from '../../engine/gfx/renderer';
import { shot } from '../../engine/gfx/shot';

/** One structured error record, as `window.__engine.errors` holds them (PLAN.md §8.3). */
interface ErrorRecord {
  code: string;
  message: string;
  fix: string;
}

/** A clip of the library: its set's directory under `data/anim/sets/` and its name, which is its file's. */
export interface ClipRef {
  dir: string;
  clip: string;
}

/** One moment `play` drew. */
export interface Moment {
  /** Clip seconds. */
  t: number;
  /** The frame drawn (`built`: the pipelines it compiled). */
  frame: FrameReport;
  /** What the ID pass saw, by puppet name (`mannequin`, `humanoid`). */
  seen: Pick<IdEntry, 'name' | 'px'>[];
  /** `animCheck`'s sentences about each figure's pose, by puppet name; empty when sound. */
  problems: Record<string, string[]>;
}

/** What `play` reports. */
export interface PlayShown {
  /** `SET/Clip`, as the clip layer names it. */
  clip: string;
  dur: number;
  moments: Moment[];
}

/** What `mixer` reports. */
export interface MixerShown {
  ticks: number;
  /** The largest distance between a bone the mixer posed and FK's joint, m. */
  worst: number;
  frame: FrameReport;
  seen: Pick<IdEntry, 'name' | 'px'>[];
}

/** Every file of the library, loaded on demand as text. */
const FILES = import.meta.glob<string>('../../data/anim/sets/*/*.json', { query: '?raw', import: 'default' });
/** The two figures: their puppet's name, body and build, and where each stands. */
const FIGURES = [
  { name: 'mannequin', body: 'body:mannequin', build: 'build:mannequin', x: -0.55 },
  { name: 'humanoid', body: 'body:humanoid', build: 'build:heroic', x: 0.55 },
] as const;
const DT = 1 / 60;

const message = document.querySelector<HTMLElement>('#msg');
const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
let info: Record<string, unknown> = { page: 'library' };
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

/** The text of `data/anim/sets/<dir>/<file>`. */
async function read(dir: string, file: string): Promise<string> {
  const load = FILES[`../../data/anim/sets/${dir}/${file}`];
  if (!load)
    throw new Error(`data/anim/sets/${dir}/${file} is not in the library: name a set directory and a clip file`);
  return load();
}

/** A library of the one clip `ref` names, with its set's header. */
async function libraryOf({ dir, clip }: ClipRef): Promise<ClipLibrary> {
  const header = JSON.parse(await read(dir, '_set.json')) as Record<string, unknown>;
  const loaded = parseClip(await read(dir, `${clip}.json`), `${dir}/${clip}`);
  return loadClipLibrary({ ...header, clips: { [clip]: loaded } });
}

/** Draws until a frame is drawn, waiting out any warm-up; resolves once the GPU has finished it. */
async function settle(gfx: Gfx, view: FrameView): Promise<FrameReport> {
  for (let tries = 0; tries < 10; tries++) {
    const report = gfx.frame(view);
    if (report.drawn) {
      await gfx.device.queue.onSubmittedWorkDone();
      return report;
    }
    if (gfx.warmup.running) await gfx.warmup.run(view).catch(() => undefined);
  }
  throw new Error('library page: no frame was drawn in 10 tries');
}

/** Starts the renderer, the scene and the figures, and publishes `__libraryPage`. */
async function start(): Promise<void> {
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
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#000000');
  scene.add(new THREE.HemisphereLight('#c8d4ff', '#3a3226', 1.2));
  const sun = new THREE.DirectionalLight('#fff2dd', 2.2);
  sun.castShadow = true;
  sun.position.set(-4, 10, 6);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 30 });
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun, sun.target);
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
  camera.position.set(0, 1.1, 5.4);
  camera.lookAt(0, 0.8, 0);
  const view: FrameView = { scene, camera };
  const materials = createMaterialLibrary();

  defineMannequin(JSON.parse(await read('quaternius', '_set.json')) as Parameters<typeof defineMannequin>[0]);
  const puppets = new Map<string, Puppet>();
  for (const { name, body, build } of FIGURES) {
    puppets.set(name, createPuppet(compileBody(body, build), { materials, name }));
  }
  const mixed = createPuppet(compileBody('body:mannequin', 'build:mannequin'), { materials, name: 'mixer' });
  for (const puppet of [...puppets.values(), mixed]) {
    scene.add(puppet.mesh);
    puppet.register(gfx.warmup);
  }
  /** Shows the figures, or the mixer's puppet alone. */
  const show = (mixer: boolean) => {
    for (const puppet of puppets.values()) puppet.mesh.visible = !mixer;
    mixed.mesh.visible = mixer;
  };
  const seen = async () =>
    (await shot(gfx, view, { metrics: false, thumbnail: false })).ids!.visible.map(({ name, px }) => ({ name, px }));

  const page = {
    gfx,
    view,
    three: THREE,
    async play({ dir, clip, moments = 4 }: ClipRef & { moments?: number }): Promise<PlayShown> {
      show(false);
      const library = await libraryOf({ dir, clip });
      const id = `${library.name}/${clip}`;
      const dur = library.clip(clip).dur;
      const figures = FIGURES.map(({ name, build, x }) => {
        const layer = new ClipLayer({ library, build });
        const animator = new Animator({ build, clock: 0 }).use('clips', layer);
        layer.play(id, { fade: 0, hold: true });
        return { name, layer, animator, at: new THREE.Vector3(x, 0, 0) };
      });
      const shown: Moment[] = [];
      const ticks = Math.round(dur / DT);
      let stepped = 0;
      for (let m = 0; m < moments; m++) {
        for (; stepped < Math.round((ticks * m) / Math.max(1, moments - 1)); stepped++) {
          for (const { animator, layer } of figures) {
            animator.step();
            layer.step({ groundSpeed: 0 });
          }
        }
        const problems: Record<string, string[]> = {};
        for (const { name, animator, at } of figures) {
          const { pose, skeleton } = animator.pose({ at }).body;
          puppets.get(name)!.setPose(pose);
          problems[name] = animCheck({ poses: [pose], skeleton }).problems.map((p) => p.message);
        }
        const frame = await settle(gfx, view);
        shown.push({ t: figures[0].layer.current?.t ?? NaN, frame, seen: await seen(), problems });
      }
      return { clip: id, dur, moments: shown };
    },
    async mixer({ dir, clip }: ClipRef): Promise<MixerShown> {
      const library = await libraryOf({ dir, clip });
      const { skeleton } = mixed.compiled;
      const three = THREE.AnimationClip.parse(clipJSON(library.bake(clip), skeleton));
      const mixer = new THREE.AnimationMixer(mixed.mesh);
      mixer.clipAction(three).play();
      const layer = new ClipLayer({ library, build: 'build:mannequin', ik: false });
      const animator = new Animator({ build: 'build:mannequin', clock: 0 }).use('clips', layer);
      layer.play(`${library.name}/${clip}`, { fade: 0, hold: true });
      const [bone, last] = [new THREE.Vector3(), Math.round(library.clip(clip).dur / DT)];
      let [worst, middle]: [number, Pick<MixerShown, 'frame' | 'seen'> | undefined] = [0, undefined];
      for (let tick = 0; tick <= last; tick++) {
        animator.pose();
        mixer.setTime(layer.current!.t);
        mixed.mesh.updateMatrixWorld(true);
        JOINTS.forEach((name, j) => {
          bone.setFromMatrixPosition(mixed.mesh.skeleton.bones[j + 1].matrixWorld);
          worst = Math.max(worst, bone.distanceTo(jointPosition(animator.body.world, name)));
        });
        if (tick === last >> 1) {
          show(true);
          middle = { frame: await settle(gfx, view), seen: await seen() };
          show(false);
        }
        animator.step();
        layer.step({ groundSpeed: 0 });
      }
      mixer.stopAllAction();
      return { ticks: last + 1, worst, ...middle! };
    },
  };
  show(false);
  await gfx.warmup.run(view);
  await settle(gfx, view);
  Object.assign(window, { __libraryPage: page });
  info = { page: 'library', ...gfx.info };
  if (message) message.hidden = true;
  signals.ready = true;
}

start().catch((error: unknown) => {
  const code = (error as { code?: string }).code ?? 'LIBRARY_PAGE_START';
  const fix = (error as { fix?: string }).fix ?? 'the console names the cause';
  fail({ code, message: String((error as Error).message ?? error), fix });
});
