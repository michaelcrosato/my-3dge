/**
 * @file The playground's photo mode (docs/PLAYGROUND.md §8.3, PLAN.md WP 13.25): the run paused, the free camera (the
 * engine's fly camera, a bare `cam3=fly`, which starts from the camera on screen: engine/gfx/cameras/fly.ts) flown with
 * the map's move keys, the jump key climbing and the crouch key sinking, the sprint key fast; turned by dragging the
 * mouse over the game (`PHOTO.drag` rad a pixel); its lens narrowed and widened with the wheel, as ever; the HUD
 * hidden; the looks switched with P, as ever. Leaving puts the camera back as it was.
 *
 * `createPhoto(canvas, input, camera)` makes it closed. `enter()` switches to the free camera and shows the hint (a
 * `[data-ui=photo]` element in `parent` naming the keys of the map in use); `leave()` switches back and hides it; each
 * drawn frame `cameraInput()` is what the front end hands the engine (`createEngine({ cameraInput })`): the keys' move
 * and the drag's look, nothing while closed.
 *
 * Invariants: presentation only: a camera is view state, so photo mode never reaches the run or the hash, and the run
 * stays paused under it (the front end's).
 *
 * Game code, a page's: it imports only the engine's public API (engine/index.ts) and the playground's own files.
 *
 * @example
 * // browser: photo mode needs a page
 * // const photo = createPhoto(ui.root, canvas, engine.input, camera); photo.enter();
 * // document.querySelector('[data-ui=photo]').textContent; // 'Photo mode · WASD: fly · Space C: up, down · …'
 * @see tests/e2e/playground.spec.ts
 */
import type { CameraInput, Input } from '../../../engine';

/** How the drag turns the camera: radians a CSS pixel. */
export const PHOTO = Object.freeze({ drag: 0.004 });

/** The camera member, as photo mode uses it. */
export interface PhotoCamera {
  get(): { code: string };
  set(code: string): { code: string };
}

/** Photo mode (see the file comment). */
export interface Photo {
  readonly open: boolean;
  enter(): void;
  leave(): void;
  cameraInput(): CameraInput | undefined;
  dispose(): void;
}

/** Makes photo mode, closed: its hint in `parent`, its drag over `canvas`. */
export function createPhoto(
  parent: HTMLElement,
  canvas: HTMLElement,
  input: Pick<Input, 'held' | 'prompt'>,
  camera: () => PhotoCamera | null,
): Photo {
  const hint = Object.assign(parent.ownerDocument.createElement('div'), { className: 'ui-panel ui-box', hidden: true });
  hint.dataset.ui = 'photo';
  Object.assign(hint.style, { left: '50%', top: '8px', transform: 'translateX(-50%)', padding: '4px 10px' });
  parent.append(hint);
  let previous: string | null = null;
  let dragging = false;
  const look: [number, number] = [0, 0];
  const down = (event: PointerEvent) => void (previous !== null && ((dragging = true), event.preventDefault()));
  const up = () => void (dragging = false);
  const move = (event: PointerEvent) => {
    if (!dragging || previous === null) return;
    look[0] += event.movementX * PHOTO.drag;
    look[1] -= event.movementY * PHOTO.drag;
  };
  canvas.addEventListener('pointerdown', down);
  addEventListener('pointerup', up);
  addEventListener('pointermove', move);
  const axis = (plus: string, minus: string) => Number(input.held(plus)) - Number(input.held(minus));
  return {
    get open() {
      return previous !== null;
    },
    enter() {
      const member = camera();
      if (!member || previous !== null) return;
      previous = member.get().code;
      member.set('cam3=fly');
      const key = (action: string) => input.prompt(action);
      const fly = ['forward', 'left', 'back', 'right'].map(key).join('');
      hint.textContent = `Photo mode · ${fly}: fly · ${key('jump')} ${key('crouch')}: up, down · ${key('sprint')}: fast · drag: look · wheel: zoom · P: look · Esc: leave`; // prettier-ignore
      hint.hidden = false;
    },
    leave() {
      if (previous === null) return;
      camera()?.set(previous);
      [previous, dragging, hint.hidden] = [null, false, true];
    },
    cameraInput() {
      if (previous === null) return undefined;
      const turned: [number, number] = [look[0], look[1]];
      [look[0], look[1]] = [0, 0];
      const moved: [number, number, number] = [axis('right', 'left'), axis('forward', 'back'), axis('jump', 'crouch')];
      return { move: moved, fast: input.held('sprint'), look: turned };
    },
    dispose() {
      canvas.removeEventListener('pointerdown', down);
      removeEventListener('pointerup', up);
      removeEventListener('pointermove', move);
      hint.remove();
    },
  };
}
