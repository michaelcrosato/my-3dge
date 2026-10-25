/**
 * @file The playground's attract mode (docs/PLAYGROUND.md §9.2, PLAN.md WP 13.26): the tour (labs/playground/tour.ts,
 * tests/replays/playground-tour.replay.json) playing in the page as `?replay=playground-tour` plays it, in real time
 * from step 0, the view stepping through the five cameras every `ATTRACT.cycle` seconds (blended, as T does) and
 * switching the look every second step, a banner (`[data-ui=attract]`) saying any key plays. A key, a click or a pad
 * button, or the tour's end, gives the page back: the playground again, on its title screen.
 *
 * The view setting `playground.attract`: `on` is the tour's page itself (`attractPage()` writes its address); `auto`
 * (the default) opens it after `ATTRACT.idle` seconds on the title screen with nothing pressed, unless automation
 * drives the browser (labs/playground/ui/frontEnd.ts); `off` never. The title screen's "Watch the tour" opens it too.
 *
 * Invariants: presentation only: the replay plays the run, and the cameras and looks are view state, so the tour's
 * goldens hold under every view the cycle shows (tests/e2e/playground-tour.spec.ts).
 *
 * Game code, a page's: it imports only the engine's public API (engine/index.ts) and the playground's own files.
 *
 * @example
 * attractPage('/labs/playground/'); // '/labs/playground/?replay=playground-tour&playground.attract=on&playground.title=off'
 * ATTRACT.cycle; // 8: seconds a view shows
 * @see tests/e2e/playground-tour.spec.ts
 */
import type { Engine } from '../../../engine';
import { defineSettings } from '../../../engine/sim-api';
import { cameraMode, nextCamera, nextLook } from '../views';

/** The attract mode's numbers: seconds on an idle title screen before it starts, and seconds a view shows. */
export const ATTRACT = Object.freeze({ idle: 60, cycle: 8 });

/** The tour's replay, as the page offers it (`?replay=<name>`). */
export const TOUR_REPLAY = 'playground-tour';

/** The attract mode's view setting (see the file comment). */
export const ATTRACT_SETTINGS = defineSettings({
  'playground.attract': {
    type: 'string',
    enum: ['auto', 'on', 'off'],
    default: 'auto',
    view: true,
    when: 'scene',
    description:
      "The playground's attract mode, the tour playing with the view cycling (labs/playground/ui/attract.ts): 'on' is the tour's page itself, 'auto' opens it after a minute on the title screen with nothing pressed unless automation drives the browser, 'off' never.",
  },
});

/** The tour's page at `path` (the playground's): its replay, the attract mode on, no title screen over it. */
export function attractPage(path: string): string {
  return `${path}?${new URLSearchParams({ replay: TOUR_REPLAY, 'playground.attract': 'on', 'playground.title': 'off' })}`; // prettier-ignore
}

/** The attract mode on a page (see the file comment). */
export interface Attract {
  /** Runs a drawn frame: `dt` real seconds, at the run's step `tick`. */
  frame(dt: number, tick: number): void;
  dispose(): void;
}

/** The camera and settings members, as the attract mode uses them. */
interface AttractInspector {
  camera: { get(): { code: string }; set(code: string, options?: { blend?: boolean }): { code: string } };
  set(path: string, value: unknown): unknown;
}

/**
 * Starts the attract mode in a page whose engine plays the tour: the banner in `root`, the view cycling from the look
 * `look`, until a key, a click, a pad button or the tour's `steps` call `leave` (the playground again, by default).
 */
export function createAttract(
  engine: Engine,
  root: HTMLElement,
  options: { steps: number; look: string; onView?(change: { camera?: string; look?: string }): void; leave?(): void },
): Attract {
  const inspector = engine.inspector as unknown as AttractInspector;
  const leave = options.leave ?? (() => location.assign(location.pathname));
  const banner = Object.assign(root.ownerDocument.createElement('div'), {
    className: 'ui-panel ui-box',
    textContent: 'The tour · press any key to play',
  });
  banner.dataset.ui = 'attract';
  Object.assign(banner.style, { left: '50%', bottom: '12%', transform: 'translateX(-50%)', padding: '6px 14px' });
  root.append(banner);
  let [shown, cycles, look, left] = [0, 0, options.look, false];
  const go = () => {
    if (left) return;
    left = true;
    leave();
  };
  const press = (event: Event) => {
    if (event.type === 'keydown' && (event as KeyboardEvent).repeat) return;
    go();
  };
  addEventListener('keydown', press);
  addEventListener('pointerdown', press);
  return {
    frame(dt, tick) {
      const pad = engine.input?.lastDevice === 'gamepad' && (engine.input.pressed('uiAccept') || engine.input.pressed('pause')); // prettier-ignore
      if (pad || tick >= options.steps) return go();
      shown += dt;
      if (shown < ATTRACT.cycle) return;
      shown = 0;
      cycles++;
      const code = inspector.camera.set(nextCamera(inspector.camera.get().code), { blend: true }).code;
      options.onView?.({ camera: cameraMode(code)?.name ?? code });
      if (cycles % 2 === 0) {
        look = nextLook(look);
        inspector.set('post.look', look);
        options.onView?.({ look });
      }
    },
    dispose() {
      removeEventListener('keydown', press);
      removeEventListener('pointerdown', press);
      banner.remove();
    },
  };
}
