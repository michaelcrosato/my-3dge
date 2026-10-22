/**
 * @file Filming the gallery (PLAN.md WP 7.7): the inspector members `gallery.list(kind?)`, `gallery.frames(kind, id)`
 * and `gallery.shoot(kind, id, size?)` (registered here, so `__engine.gallery` and `help()` list them), and the live
 * driver a deep link's page runs (`createGalleryDriver`). `gallery.shoot` films an entry's frames
 * (engine/dev/gallery.ts) on a page showing the gallery's scene: each frame staged through the scene's dev action
 * `show` (recorded), its steps run, an emitter burst and run at its rate (engine/gfx/fx/effects.ts) and its seconds
 * drawn, the camera fitted round what the stage draws (`fitCamera` over the props', puppets' and stand-ins' bounds, or
 * an emitter's live particles'), then shot (engine/gfx/shot.ts): the pixels and what the ID pass saw. A frame that shows the same staging as the one
 * before (a turntable's next view, an emitter's later moment) goes on from it instead of staging again.
 *
 * The driver fits the camera of the entry's first frame once the stage has drawn it (an emitter's once its burst has
 * spread), and plays a move's swing and an emitter's burst again every half second after its length (the swing staged
 * anew through `show`), running an emitter at its rate between bursts, so the link shows them live; the first
 * `gallery.shoot` stops it, the stage being the shots' from then.
 *
 * Invariants: the stage changes only through the scene's recorded dev action; cameras and the look are view state,
 * and the look `gallery.shoot` set is put back when it ends; members throw `DEV_GALLERY_UNKNOWN` for a name the
 * gallery lacks and `DEV_GALLERY_CLOSED` off the gallery's scene.
 *
 * @example
 * // a page at labs/box/#gallery/prop/prop:crate:
 * // await __engine.gallery.shoot('prop', 'prop:crate', { width: 160, height: 90 }); // { burst: false, frames: [4 shots] }
 * @see tests/e2e/gallery.spec.ts
 */
import { codeError, defineCodes } from '../core/log';
import { Box3, Vector3 } from '../core/math';
import type { Registry } from '../core/registry';
import type { Gallery } from '../core/gallery';
import { getEmitter } from '../gfx/fx/emitters';
import type { ShotJson, ShotOptions } from '../gfx/shot';
import type { Stage } from '../gfx/stage';
import { fitCamera, galleryFrames, galleryKindsOf, galleryProblem, GALLERY_STAGING, type GalleryRoute } from './gallery'; // prettier-ignore
import { GALLERY_AT, GALLERY_SCENE } from './galleryScene';
import { defineMember, type InspectorHost } from './members';

/** The codes this module raises, with their fixes. */
export const GALLERY_SHOOT_CODES = defineCodes('dev', {
  DEV_GALLERY_CLOSED: {
    template: 'gallery.{member} films the gallery scene, but the page shows {scene}',
    fix: 'open the page on the gallery: add #gallery/<kind>/<id> to its URL (engine/dev/gallery.ts)',
    doc: 'Thrown by `gallery.shoot` (engine/dev/galleryShoot.ts) on a page showing another scene than dev:gallery: only the gallery scene stages entries.', // prettier-ignore
  },
});

/** The view a gallery films through: the run's stage and its camera (engine/app/view.ts). */
export interface GalleryView {
  readonly stage: Stage;
  setCamera(code: string): unknown;
}

/** What `gallery.shoot` needs of its host beyond the inspector's: the run's view, and drawing (engine/app/headless.ts). */
interface GalleryHost extends InspectorHost {
  readonly view: GalleryView | null;
  render(frames: number): Promise<unknown>;
  shot(options: ShotOptions): Promise<ShotJson>;
}

/** One filmed frame: its label, the tick, the camera, the shot's size, its pixels (base64) and what the ID pass saw. */
export interface GalleryShot {
  label: string;
  tick: number;
  camera: string;
  width: number;
  height: number;
  pixels: string;
  visible: NonNullable<ShotJson['ids']>['visible'];
}

/** Where an emitter bursts: where the subject would stand, half a metre up. */
const BURST_AT = [GALLERY_AT[0], GALLERY_AT[1] + 0.5, GALLERY_AT[2]] as const;

/**
 * The most an emitter's frame takes in, across (m): a burst's 3; an effect spread over an area wider than 1 m (rain,
 * snow, fireflies), a 1.2 m patch of it, so its drops are drops and not specks.
 */
export const BURST_REACH = { burst: 3, patch: 1.2 } as const;

/**
 * What emitter `id`'s frame is fitted round: its live particles (engine/gfx/fx/effects.ts), above the floor and at
 * most its reach (`BURST_REACH`) across round their middle; 1 m round the burst when none lives.
 */
function burstBounds(stage: Stage, id: string, registry: Registry): Box3 {
  const live = stage.fx.effects.bounds();
  if (!live) return new Box3().setFromCenterAndSize(new Vector3(...BURST_AT), new Vector3(1, 1, 1));
  const [min, max] = [new Vector3(...live.min), new Vector3(...live.max)];
  [min.y, max.y] = [Math.max(0, min.y), Math.max(0.1, max.y)]; // what has fallen through the floor is out of sight
  const { area } = getEmitter(id, registry);
  const reach = Math.max(area[0], area[2]) > 1 ? BURST_REACH.patch : BURST_REACH.burst;
  const box = new Box3(min, max);
  return new Box3().setFromCenterAndSize(
    box.getCenter(new Vector3()),
    box.getSize(new Vector3()).clampScalar(0, reach),
  );
}

/** The bounds of what the stage draws for the subject: its props, puppets and stand-ins (the ground left out). */
export function subjectBounds(stage: Stage): Box3 {
  const box = new Box3();
  const roots = [stage.props.meshes?.root, stage.actors.root, ...stage.standIns.values()];
  for (const root of roots) if (root) box.union(new Box3().setFromObject(root, true));
  return box;
}

/** Throws `DEV_GALLERY_UNKNOWN` unless `kind` (and `id`) name what the gallery films. */
function check(registry: Registry, kind: string, id?: string): void {
  const problem = galleryProblem(kind, id, registry);
  if (problem) throw codeError('DEV_GALLERY_UNKNOWN', { ...problem, instead: '' });
}

/** The deep link's driver in this page, if any: `gallery.shoot` stops it, since the stage is the shots' from then. */
let driving: { stopped: boolean } | null = null;

/** Films entry `id` of `kind` (see the file comment). */
async function shoot(h: GalleryHost, kind: string, id: string, size?: { width: number; height: number }) {
  check(h.registry, kind, id);
  if (h.session.scene.id !== GALLERY_SCENE || !h.view)
    throw codeError('DEV_GALLERY_CLOSED', { member: 'shoot', scene: h.session.scene.id });
  if (driving) driving.stopped = true;
  const { stage } = h.view;
  const { effects } = stage.fx;
  const burst = GALLERY_STAGING[kind].burst === true;
  const before = new Map<string, unknown>();
  const shots: GalleryShot[] = [];
  let staged: { key: string; at: number } | null = null;
  try {
    for (const frame of galleryFrames(kind, id, h.registry)) {
      const key = JSON.stringify([frame.state, frame.settings]);
      if (!staged || staged.key !== key || frame.at < staged.at) {
        for (const [path, value] of Object.entries(frame.settings)) {
          if (!before.has(path)) before.set(path, h.session.settings.get(path));
          h.session.set(path, value);
        }
        h.session.act('show', { kind, id, state: frame.state });
        h.step(frame.steps, {});
        if (burst) {
          effects.reset();
          effects.burst(id, BURST_AT);
        }
        staged = { key, at: 0 };
      }
      const played = Math.round((frame.at - staged.at) * 60); // a step and a frame a 60th: a swing, a burst
      for (let k = 0; k < played; k++) {
        if (burst) effects.emit(id, BURST_AT, 'gallery');
        h.step(1, {});
        await h.render(1);
      }
      if (played === 0) await h.render(1);
      staged.at = frame.at;
      const camera = fitCamera(frame.view, burst ? burstBounds(stage, id, h.registry) : subjectBounds(stage));
      h.view.setCamera(camera);
      const shot = await h.shot({ pixels: true, ids: true, metrics: false, thumbnail: false, ...(size ? { size } : {}) }); // prettier-ignore
      const { width, height, pixels = '', ids } = shot;
      shots.push({ label: frame.label, tick: h.session.world.tick, camera, width, height, pixels, visible: ids?.visible ?? [] }); // prettier-ignore
    }
  } finally {
    for (const [path, value] of before) h.session.set(path, value);
  }
  return { kind, id, burst, frames: shots };
}

const KIND = { type: 'string', required: true, description: 'A kind the gallery films: prop, material, emitter, look, body or move.' } as const; // prettier-ignore
const ID = { type: 'string', required: true, description: 'An entry of the kind, by id (prop:crate).' } as const;

defineMember('gallery.list', {
  help: 'The kinds the gallery films with their entry counts, or one kind’s entries (engine/dev/gallery.ts).',
  args: { kind: { type: 'string', description: 'A kind: its entries’ ids; every kind when absent.' } },
  impl: (h, kind?: string) => {
    if (kind === undefined) return galleryKindsOf(h.registry).map((name) => ({ kind: name, count: h.registry.list(name).length })); // prettier-ignore
    check(h.registry, kind);
    return h.registry.list(kind).map((entry) => entry.id);
  },
});

defineMember('gallery.frames', {
  help: 'An entry’s gallery frames: what each stages, holds and plays, and its camera (engine/dev/gallery.ts).',
  args: { kind: KIND, id: ID },
  impl: (h, kind: string, id: string) => {
    check(h.registry, kind, id);
    return galleryFrames(kind, id, h.registry);
  },
});

defineMember('gallery.shoot', {
  help: 'Films an entry’s gallery frames on the gallery’s page: each shot’s pixels and what its ID pass saw.',
  args: {
    kind: KIND,
    id: ID,
    size: { type: 'object', description: 'The shots’ size in pixels, { width, height }; the canvas’s when absent.' },
  },
  needs: 'renderer',
  impl: (h, kind: string, id: string, size?: { width: number; height: number }) => shoot(h as GalleryHost, kind, id, size), // prettier-ignore
});

/** A deep link's live gallery: called once per drawn frame (see the file comment). */
export interface GalleryDriver {
  frame(dt: number): void;
}

/** The run a driver plays in: its view, and the recorded session it stages through (engine/app/headless.ts). */
export interface GalleryRun {
  readonly view: GalleryView | null;
  readonly host: { readonly session: { act(name: string, args?: unknown): void } };
}

/** The driver of a page opened on `route` (see the file comment), playing in `run`. */
export function createGalleryDriver(route: GalleryRoute, run: () => GalleryRun, registry: Registry): GalleryDriver {
  const [frame] = galleryFrames(route.kind, route.id, registry);
  const how = GALLERY_STAGING[route.kind];
  const burst = how.burst === true;
  const { duration } = (registry.get(route.kind, route.id) as unknown as { gallery: Gallery }).gallery;
  const length = duration || (how.length?.(route.id, registry) ?? 0);
  let [fitted, since] = [false, burst ? Infinity : 0];
  const state = (driving = { stopped: false });
  return {
    frame(dt) {
      const { view, host } = run();
      if (!view || state.stopped) return;
      const { stage } = view;
      since += dt;
      if (length > 0 && since >= length + 0.5) {
        since = 0; // again: the burst, or the swing staged anew (recorded, as gallery.shoot stages it)
        if (!burst) host.session.act('show', { kind: route.kind, id: route.id, state: frame.state });
        else {
          stage.fx.effects.reset();
          stage.fx.effects.burst(route.id, BURST_AT);
        }
      }
      if (burst) stage.fx.effects.emit(route.id, BURST_AT, 'gallery');
      if (fitted || (burst && since < length / 2)) return; // an emitter is framed once its particles have spread
      view.setCamera(fitCamera(frame.view, burst ? burstBounds(stage, route.id, registry) : subjectBounds(stage)));
      fitted = true;
    },
  };
}
