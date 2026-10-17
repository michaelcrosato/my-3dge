/**
 * @file The playground's views (docs/PLAYGROUND.md §4, §5; PLAN.md WP 13.1): its five camera modes and its two looks,
 * in the order the keys step through them, and the keys: T (`CAMERA_KEY`) cycles the cameras and P (`LOOK_KEY`)
 * switches the looks, live, on the page (labs/playground/main.ts); the menu (labs/playground/menu.ts) links each.
 *
 * Until WP 13.8 gives the playground its own rigs (`cam3=shoulder`, `cam3=follow`, `cam=overhead`), each mode is the
 * nearest camera today's codes reach: the shooter is the chase camera, the platformer the orbit camera, and top-down
 * the classic top-down view. Cameras and looks are view state: they never reach the sim or the hash.
 *
 * Invariants: every mode's code is a camera code (`cam=` or `cam3=`) and every look a registered look id
 * (labs/playground/looks/); `nextCamera` and `nextLook` step round in order from any code or id, an unknown one
 * starting the cycle at its first.
 *
 * Game code, a page's: it imports nothing; labs/playground/views.test.ts checks the codes and ids.
 *
 * @example
 * nextCamera('cam3=chase,0,-20.63,5.5'); // 'cam3=first': a code with its numbers opens its mode
 * nextLook('look:playground-cel'); // 'look:playground-pixel'
 * @see labs/playground/views.test.ts
 */

/** A camera mode: its name, the camera code that opens it, and what it is for. */
export interface CameraMode {
  readonly name: string;
  readonly code: string;
  readonly label: string;
}

/** The five camera modes, in the order T steps through them; the shooter is the page's default. */
export const PLAYGROUND_CAMERAS: readonly CameraMode[] = [
  {
    name: 'shooter',
    code: 'cam3=chase',
    label: 'Third-person shooter: behind the shoulder (the chase camera for now)',
  },
  { name: 'first', code: 'cam3=first', label: 'First person: through the eyes' },
  {
    name: 'platformer',
    code: 'cam3=orbit',
    label: 'Third-person platformer: orbit and follow (the orbit camera for now)',
  },
  { name: 'isometric', code: 'cam=iso', label: 'Isometric: orthographic, 45° round and 30° down' },
  { name: 'top-down', code: 'cam=topdown', label: 'Top-down "2D": looking down (the classic top-down view for now)' },
];

/** The two looks, in the order P switches them; the cel look is the page's default. */
export const PLAYGROUND_LOOKS: readonly string[] = ['look:playground-cel', 'look:playground-pixel'];

/** The key that cycles the camera modes: T, as docs/PLAYGROUND.md §3.3 binds it. */
export const CAMERA_KEY = 'KeyT';

/** The key that switches the looks: P, which no action map binds. */
export const LOOK_KEY = 'KeyP';

/** The camera mode a code opens, by its type and view (`cam3=chase` of `cam3=chase,0,-20.63,5.5`); else undefined. */
export function cameraMode(code: string): CameraMode | undefined {
  const head = code.split(',')[0];
  return PLAYGROUND_CAMERAS.find((mode) => mode.code === head);
}

/** The code of the camera mode after the one `code` opens (the first after an unknown code). */
export function nextCamera(code: string): string {
  const at = PLAYGROUND_CAMERAS.findIndex((mode) => mode === cameraMode(code));
  return PLAYGROUND_CAMERAS[(at + 1) % PLAYGROUND_CAMERAS.length].code;
}

/** The look after `id` (the first after an unknown id). */
export function nextLook(id: string): string {
  return PLAYGROUND_LOOKS[(PLAYGROUND_LOOKS.indexOf(id) + 1) % PLAYGROUND_LOOKS.length];
}
