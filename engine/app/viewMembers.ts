/**
 * @file The view's inspector members (PLAN.md §8.3, WP 2.7): `ready`, `render`, `shot`, `camera.get`, `camera.set`,
 * `camera.advance`, `scene.dump`, `fx.stats` (WP 11.3) and `replay`, registered from here as entries of the registry
 * kind `inspectorMember` (engine/dev/members.ts), so `window.__engine` in a page and `createHeadless` in Node list the
 * same members. Headless, `render` and `shot` throw `DEV_NO_RENDERER` (they need a GPU); `camera`, `scene.dump` and
 * `fx.stats` need the scene's view (`createHeadless({ view: true })`, else `APP_NO_VIEW`); `ready` and `replay` work
 * everywhere.
 *
 * The members work on an `AppHost`: the inspector's host plus the view, the ready flag and the drawing
 * (engine/app/headless.ts makes it headless, engine/app/engine.ts in a page). Cameras and view settings are view
 * state: switching them is never recorded and never changes the hash. `replay` starts the replay's run and steps
 * it through the session, so the run records itself (`input.record()` gives it back).
 *
 * Invariants: this module registers on the shared registry when it loads, after engine/dev/members.ts declares the
 * kind (it imports it); results are plain data or promises of plain data.
 *
 * @example
 * // __engine.camera.set('cam=topdown').describe; // what the camera shows, in words
 * // __engine.scene.dump({ filter: 'wall', depth: 2 }); // the walls, one line each
 * // await __engine.replay(text, { every: true }); // { hashes, hash, steps, frames, scene }
 * @see engine/app/viewMembers.test.ts
 */
import { codeError } from '../core/log';
import { defineMember, type InspectorHost } from '../dev/members';
import type { StatsHost } from '../dev/stats';
import type { FrameReport } from '../gfx/renderer';
import type { ShotJson, ShotOptions } from '../gfx/shot';
import type { PlayIntoOptions, PlayResult } from './playback';
import type { RunView } from './view';

/** What the view's members work on: the inspector's host, plus the view, the drawing and the stats meter. */
export interface AppHost extends StatsHost {
  /** True once the engine is up (a page: its first frame drawn); never after a startup error. */
  readonly ready: boolean;
  /** The scene's view, or null (headless without `view: true`). */
  readonly view: RunView | null;
  /** Draws `frames` frames of the current state now; resolves with the last one's report. */
  render(frames: number): Promise<FrameReport>;
  /** Shoots the view (engine/gfx/shot.ts) as plain JSON. */
  shot(options: ShotOptions): Promise<ShotJson>;
  /** Plays a replay's text from step 0 (engine/app/playback.ts). */
  replay(text: string, options: PlayIntoOptions): Promise<PlayResult>;
}

/** `host` as the app made it. */
const app = (host: InspectorHost) => host as AppHost;

/** The host's view; throws `APP_NO_VIEW` naming `member` when it has none. */
function viewOf(host: InspectorHost, member: string): RunView {
  const { view } = app(host);
  if (!view) throw codeError('APP_NO_VIEW', { member });
  return view;
}

defineMember('ready', {
  help: 'Whether the engine is up: a page once its first frame is drawn, headless at once; false after a startup error.',
  value: true,
  impl: (h) => app(h).ready,
});

defineMember('render', {
  help: "Draws n frames of the current state now, without stepping; resolves with the last frame's report (drawn, built, alpha).",
  needs: 'renderer',
  args: { n: { type: 'integer', default: 1, minimum: 1, maximum: 600, description: 'How many frames.' } },
  impl: (h, n: number) => app(h).render(n),
});

defineMember('shot', {
  help: 'Renders the view into a target and reads it back: the ID pass, look metrics, thumbnail, marks or pixels as asked; resolves with plain JSON.',
  needs: 'renderer',
  args: {
    options: {
      type: 'object',
      default: {},
      description:
        'What to read back (engine/gfx/shot.ts ShotOptions): ids, metrics, thumbnail, marks, pixels (booleans), width and height.',
    },
  },
  impl: (h, options: ShotOptions) => app(h).shot(options),
});

defineMember('camera.get', {
  help: 'The camera: its code (cam=iso), what it shows in words, its type, heading and pose.',
  impl: (h) => viewOf(h, 'camera.get').cameraInfo(),
});

defineMember('camera.set', {
  help: 'Switches to the camera a code names (cam=topdown, cam=iso,45,2, cam3=shoulder, cam3=fly) at once, or blending over cam.blend seconds with { blend: true } as the page\'s live switches do; view only, never recorded; returns camera.get().', // prettier-ignore
  args: {
    code: { type: 'string', required: true, description: 'A camera code: cam=<view>[,…] or cam3=<type>[,…].' },
    options: { type: 'object', default: {}, description: '{ blend }: true blends into it (the view setting cam.blend’s seconds) instead of cutting.' }, // prettier-ignore
  },
  impl: (h, code: string, options: { blend?: boolean }) => viewOf(h, 'camera.set').setCamera(code, options),
});

defineMember('camera.advance', {
  help: "Moves the camera on by n frames of 1/60 s, drawing nothing and never stepping, as a page's frames move it: headless, where no frames run, it catches up with a player a dev action moved and a follow camera swings out; view only, never recorded; returns camera.get().", // prettier-ignore
  args: { n: { type: 'integer', default: 60, minimum: 1, maximum: 600, description: 'How many frames.' } },
  impl: (h, n: number) => viewOf(h, 'camera.advance').advance(n),
});

defineMember('scene.dump', {
  help: 'The view as a text tree, one object a line: name, type, hidden, position, size, material, triangles, entity.',
  args: {
    options: {
      type: 'object',
      default: {},
      description:
        '{ depth, filter }: the deepest level shown (the scene is 0), and a text names or types must contain.',
    },
  },
  impl: (h, options: { depth?: number; filter?: string }) => viewOf(h, 'scene.dump').dump(options),
});

defineMember('fx.stats', {
  help: "The effects' counts: the CPU pool's particles (live, born, dropped), the GPU's ring's while it has one (WP 11.3: its recycled too), sprites, decals, ribbons, draw calls and events played.", // prettier-ignore
  impl: (h) => viewOf(h, 'fx.stats').stage.fx.effects.stats(),
});

defineMember('replay', {
  help: "Plays a replay (its file's text) from step 0 here, drawing a frame after each step in a page; resolves with its hashes, as x replay checks them.",
  args: {
    text: { type: 'string', required: true, description: "The replay file's text (JSON), as x replay reads it." },
    options: {
      type: 'object',
      default: {},
      description:
        "{ every, until, draw, views }: hash every step; stop after until steps (with the state and trace); draw every n-th step (0: never); [[step, { cam, blend, set, shot }]] view changes (blend: as the page's live switch; shot: shoot there, the result's shots).",
    },
  },
  impl: (h, text: string, options: PlayIntoOptions) => app(h).replay(text, options),
});
