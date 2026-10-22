/**
 * @file The gallery (PLAN.md WP 7.7): every registered entry of a kind with a `gallery` field (engine/core/gallery.ts)
 * filmed as a few frames, so a kind's twenty entries are reviewed on one contact sheet rather than twenty shots.
 * `galleryFrames(kind, id)` reads the entry's field into frames: one per state (`states`), per time (four, in the
 * middle of each quarter of its `duration`; a move's 0 is its swing's phases' ends, an emitter's its burst's
 * `burstLife`) and per view (`turntable` four, `front` one: a camera 25° up round what the stage draws,
 * `fitCamera`; a camera code as written).
 * The gallery's scene (engine/dev/galleryScene.ts) stages each frame through its recorded dev action `show`, and
 * engine/dev/galleryShoot.ts films them (`gallery.shoot`); `x gallery` (tools/cmd/gallery.ts) lays them out. A look's
 * frames draw the gallery's set in that look (`post.look`); an emitter's burst it where the subject would stand,
 * running it at its rate, and are shot that long after the burst.
 *
 * Deep links (`galleryRoute`): `#gallery/<kind>/<id>` on any page (engine/app/routes.ts) starts the gallery's scene
 * on the entry's first frame; `#gallery/<kind>` shows the kind's first entry, `#gallery` the first kind's. A wrong
 * kind or id warns, listing the valid ones (`DEV_GALLERY_UNKNOWN`), and shows the first instead, as my-3d2dge's
 * gallery did.
 *
 * Carried from `my-3d2dge:src/emberdeep/92-gallery.js` (the mechanism: reels of registered entries staged one at a
 * time, a deep link opening one so a tool can film it, a wrong name warning with the right ones).
 *
 * Invariants: frames are plain data, the same for the same entry; a kind takes part when its schema has the field,
 * and is staged by the kinds this module and the scene know (`GALLERY_STAGING`).
 *
 * @example
 * galleryFrames('prop', 'prop:crate').map((frame) => frame.label); // ['prop:crate 30°', 'prop:crate 120°', …]: four
 * galleryRoute('#gallery/prop/prop:crate'); // { kind: 'prop', id: 'prop:crate' }
 * @see engine/dev/gallery.test.ts
 */
import { galleryKinds, type Gallery } from '../core/gallery';
import { defineCodes, didYouMean, log as sharedLog, type Log } from '../core/log';
import { Box3, Vector3 } from '../core/math';
import { registry as sharedRegistry, type Registry } from '../core/registry';
import { getMove } from '../anim/moves-data';
import { SAMPLE_STATES } from '../anim/states';
import { formatCameraCode } from '../gfx/cameras/codes';
import { getEmitter } from '../gfx/fx/emitters';
import { ORBIT_FOV } from '../gfx/cameras/orbit';
import { GALLERY_AT, galleryScene } from './galleryScene';

/** The codes this module raises, with their fixes. */
export const GALLERY_CODES = defineCodes('dev', {
  DEV_GALLERY_UNKNOWN: {
    template: 'the gallery has no {what} {name}{suggestion}{instead}',
    fix: 'use one of: {names}',
    doc: 'Warned for a deep link (`#gallery/<kind>/<id>`, engine/dev/gallery.ts `galleryRoute`) naming a kind with no gallery or an entry its kind lacks; thrown by the gallery members for the same names. The message lists the valid names.', // prettier-ignore
  },
});

/** One frame of an entry: what the scene stages for it, how long it holds and plays, and where the camera stands. */
export interface GalleryFrame {
  /** What the sheet calls it: the entry, then its state, time and view. */
  readonly label: string;
  /** The state the scene stages (`show`): a body's state's name; '' for none. */
  readonly state: string;
  /** Sim steps between staging and the start of what plays: what settles, holds a state or walks. */
  readonly steps: number;
  /** Seconds it plays from then before the shot, a step and a frame drawn each 60th: a move's moment, an emitter's. */
  readonly at: number;
  /** The camera: an orbit azimuth (°) fitted round the subject, or a camera code drawn as written. */
  readonly view: number | string;
  /** View settings the frame is drawn with: a look's `post.look`. */
  readonly settings: Readonly<Record<string, string>>;
}

/** How the gallery films a kind: the sim steps a frame holds, its own length, its view settings, whether it bursts. */
interface Staging {
  steps(state: string): number;
  /** How long an entry plays when its `duration` is 0: a move's swing, an emitter's burst (`burstLife`), s. */
  length?(id: string, registry: Registry): number;
  /** The moments its frames show when its `duration` is 0, s; else four, one in each quarter's middle of its length. */
  moments?(id: string, registry: Registry): number[];
  settings?(id: string): Record<string, string>;
  burst?: boolean;
}

/** How long a figure holds a state before its frame: a sample state's own hold, a walk 0.8 s (mid-stride), else 1 s. */
const holdOf = (state: string) =>
  state === 'walk' ? 0.8 : ((SAMPLE_STATES as Readonly<Record<string, { seconds: number }>>)[state]?.seconds ?? 1);

/**
 * How long an emitter's burst plays in the gallery (s): while every particle of its longest-lived part still lives,
 * its own (with a count or a rate) and each layer's (its `set.life`, else its emitter's), the shortest life of each.
 */
export function burstLife(id: string, registry: Registry = sharedRegistry): number {
  const emitter = getEmitter(id, registry);
  const own = emitter.count > 0 || emitter.rate > 0 ? [emitter.life[0]] : [];
  const layers = emitter.layers.map((layer) => (layer.set.life ?? getEmitter(layer.emitter, registry).life)[0]);
  return Math.max(0.1, ...own, ...layers);
}

/** The kinds the gallery stages (engine/dev/galleryScene.ts), with how it films each. */
export const GALLERY_STAGING: Readonly<Record<string, Staging>> = {
  prop: { steps: () => 30 },
  material: { steps: () => 1 },
  body: { steps: (state) => Math.round(60 * holdOf(state)) },
  move: {
    steps: () => 0, // the swing starts at the first step after its staging: its frames' moments count from there
    length: (id, registry) => {
      const { wind, active, recover } = getMove(id, registry).time;
      return wind + active + recover;
    },
    moments: (id, registry) => {
      // Drawn back, struck (its trail whole), half followed through, at rest again.
      const { wind, active, recover } = getMove(id, registry).time;
      return [wind, wind + active, wind + active + recover / 2, wind + active + recover];
    },
  },
  look: { steps: () => 30, settings: (id) => ({ 'post.look': id }) },
  emitter: { steps: () => 1, length: (id, registry) => burstLife(id, registry), burst: true },
};

/** The orbit views of the camera words (engine/core/gallery.ts `GALLERY_CAMERAS`), azimuths in degrees. */
const VIEWS: Readonly<Record<string, readonly number[]>> = { turntable: [30, 120, 210, 300], front: [30] };

/** How far above the subject's horizon a fitted view stands (°). */
export const GALLERY_ELEVATION = 25;

/** Rounds to the millisecond, as frames and labels write times. */
const ms = (t: number) => Math.round(t * 1000) / 1000;

/** The kinds the gallery films: those whose schema has the `gallery` field and that it stages. */
export function galleryKindsOf(registry: Registry = sharedRegistry): string[] {
  return galleryKinds(registry).filter((kind) => Object.hasOwn(GALLERY_STAGING, kind));
}

/** Whether `kind` and `id` name an entry the gallery films; else the warning's values (see `DEV_GALLERY_UNKNOWN`). */
export function galleryProblem(kind: string, id: string | undefined, registry: Registry = sharedRegistry) {
  const kinds = galleryKindsOf(registry);
  if (!kinds.includes(kind)) {
    return { what: 'kind', name: JSON.stringify(kind), suggestion: didYouMean(kind, kinds), names: kinds.join(', ') };
  }
  const ids = registry.list(kind).map((entry) => entry.id);
  if (id === undefined || ids.includes(id)) return null;
  return { what: kind, name: JSON.stringify(id), suggestion: didYouMean(id, ids), names: ids.join(', ') };
}

/** The frames of entry `id` of `kind` (see the file comment); the kind must be one the gallery films. */
export function galleryFrames(kind: string, id: string, registry: Registry = sharedRegistry): GalleryFrame[] {
  const how = GALLERY_STAGING[kind];
  const { camera, duration, states } = (registry.get(kind, id) as unknown as { gallery: Gallery }).gallery;
  const length = duration || (how.length?.(id, registry) ?? 0);
  const quarters = [0, 1, 2, 3].map((k) => ms(((k + 0.5) * length) / 4));
  const times = !duration && how.moments ? how.moments(id, registry).map(ms) : length > 0 ? quarters : [0];
  const views: readonly (number | string)[] = Object.hasOwn(VIEWS, camera) ? VIEWS[camera] : [camera];
  const frames: GalleryFrame[] = [];
  for (const state of states.length ? states : ['']) {
    for (const t of times) {
      for (const view of views) {
        const turn = typeof view === 'number' && views.length > 1 ? `${view}°` : '';
        const label = [id, state, length > 0 ? `${t} s` : '', turn].filter(Boolean).join(' ');
        const settings = how.settings?.(id) ?? {};
        frames.push({ label, state, steps: how.steps(state), at: t, view, settings });
      }
    }
  }
  return frames;
}

/** A fitted view's lens, degrees: the orbit camera's (engine/gfx/cameras/orbit.ts). */
export const GALLERY_FOV = ORBIT_FOV;

/**
 * The camera code of a frame's view: a code as written, or a fixed camera (engine/gfx/cameras/fixed.ts) standing at
 * `azimuth` round `bounds` (the subject, as the stage draws it; azimuth from +Z toward +X, as an orbit's), 25° above
 * its middle and looking at it, far enough for its bounding sphere to fill the lens's height with a margin. A fixed
 * camera, not an orbit, since an orbit stands no nearer than 1 m and a switch's plate wants 0.3 m.
 */
export function fitCamera(view: number | string, bounds: Box3): string {
  if (typeof view === 'string') return view;
  const box = bounds.isEmpty() ? new Box3().setFromCenterAndSize(new Vector3(...GALLERY_AT), new Vector3(1, 1, 1)) : bounds; // prettier-ignore
  const target = box.getCenter(new Vector3());
  const radius = Math.max(0.05, box.getSize(new Vector3()).length() / 2);
  const distance = Math.max(0.3, (1.15 * radius) / Math.sin(((GALLERY_FOV / 2) * Math.PI) / 180));
  const [azimuth, elevation] = [view, GALLERY_ELEVATION].map((deg) => (deg * Math.PI) / 180);
  const out = [Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation)];
  const position = [target.x, target.y, target.z].map((v, k) => v + distance * out[k]) as [number, number, number];
  return formatCameraCode({ type: 'fixed', position, yaw: azimuth + Math.PI, pitch: -elevation, fov: GALLERY_FOV });
}

/** What a deep link names: the kind and the entry to show. */
export interface GalleryRoute {
  kind: string;
  id: string;
}

/**
 * Reads a deep link (see the file comment): null when `hash` is no gallery link, else the entry it shows, after
 * warning about a wrong kind or id (`DEV_GALLERY_UNKNOWN`), which shows the first instead. Declares the gallery's
 * scene on `registry` (galleryScene.ts).
 */
export function galleryRoute(
  hash: string,
  registry: Registry = sharedRegistry,
  log: Log = sharedLog,
): GalleryRoute | null {
  const [head, kindText, ...rest] = decodeURIComponent(hash.replace(/^#/, '')).split('/');
  if (head !== 'gallery') return null;
  galleryScene(registry);
  const kinds = galleryKindsOf(registry);
  if (!kinds.length) return null;
  let kind = kindText || kinds[0];
  const wrongKind = galleryProblem(kind, undefined, registry);
  if (wrongKind) {
    log.warnOnce('DEV_GALLERY_UNKNOWN', { ...wrongKind, instead: `; it shows ${kinds[0]} instead` }, `gallery:${kind}`);
    kind = kinds[0];
  }
  const asked = rest.join('/') || undefined;
  const wrongId = !wrongKind && asked !== undefined ? galleryProblem(kind, asked, registry) : null;
  const first = registry.list(kind)[0].id;
  if (wrongId) log.warnOnce('DEV_GALLERY_UNKNOWN', { ...wrongId, instead: `; it shows ${first} instead` }, `gallery:${kind}/${asked}`); // prettier-ignore
  const id = !wrongKind && !wrongId && asked !== undefined ? asked : first;
  return { kind, id };
}

/** The settings a page opened on `route` starts with: what the scene stages first, its first frame's view settings. */
export function galleryStart(route: GalleryRoute, registry: Registry = sharedRegistry): Record<string, string> {
  const [frame] = galleryFrames(route.kind, route.id, registry);
  return { 'gallery.kind': route.kind, 'gallery.subject': route.id, 'gallery.state': frame.state, ...frame.settings };
}
