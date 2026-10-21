/**
 * @file The playground's views (docs/PLAYGROUND.md §4, §5; PLAN.md WP 13.1): its five camera modes and its two looks,
 * in the order the keys step through them: the maps' view actions (labs/playground/controls.ts, WP 13.9) cycle the
 * cameras (T, `nextCamera`), swap the shooter's shoulder (X, `swapShoulder`) and turn isometric by 90° (Q and E,
 * `turnView`), and P (`LOOK_KEY`) switches the looks, live, on the page (labs/playground/main.ts), each camera switch
 * blended; the menu (labs/playground/menu.ts) links each.
 *
 * Each mode is its rig (WP 13.8, engine/gfx/cameras/): the shooter over the shoulder (`cam3=shoulder`), first person
 * at the eye (`cam3=first`), the platformer's orbit and follow (`cam3=follow`), isometric (`cam=iso`) and top-down
 * straight down, north up (`cam=overhead`); a switch blends. Cameras and looks are view state: they never reach the
 * sim or the hash.
 *
 * Invariants: every mode's code is a camera code (`cam=` or `cam3=`) and every look a registered look id
 * (labs/playground/looks/); `nextCamera` and `nextLook` step round in order from any code or id, an unknown one
 * starting the cycle at its first.
 *
 * Game code, a page's: it imports nothing; labs/playground/views.test.ts checks the codes and ids.
 *
 * @example
 * nextCamera('cam3=shoulder,0,0,3.8'); // 'cam3=first': a code with its numbers opens its mode
 * swapShoulder('cam3=shoulder,0,0,3.8'); // 'cam3=shoulder,0,0,3.8,-1': over the left shoulder
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
  { name: 'shooter', code: 'cam3=shoulder', label: 'Third-person shooter: over the shoulder (X swaps it)' },
  { name: 'first', code: 'cam3=first', label: 'First person: through the eyes' },
  { name: 'platformer', code: 'cam3=follow', label: 'Third-person platformer: orbit and follow' },
  { name: 'isometric', code: 'cam=iso', label: 'Isometric: orthographic, 45° round and 30° down' },
  { name: 'top-down', code: 'cam=overhead', label: 'Top-down "2D": straight down, north up, whole-number zooms' },
];

/** The two looks, in the order P switches them; the cel look is the page's default. */
export const PLAYGROUND_LOOKS: readonly string[] = ['look:playground-cel', 'look:playground-pixel'];

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

/** The shooter camera's code `code` over the other shoulder (`cam3=shoulder,<yaw>,<pitch>,<distance>[,-1]`); another code as it is. */
export function swapShoulder(code: string): string {
  const parts = code.split(',');
  if (parts[0] !== 'cam3=shoulder' || parts.length < 4) return code;
  return parts.length === 5 ? parts.slice(0, 4).join(',') : `${code},-1`;
}

/** A classic view's code `code` turned round its target by `steps` × 90° (`cam=iso,<turn>,<zoom>`); another code as it is. */ // prettier-ignore
export function turnView(code: string, steps: number): string {
  const [head, turn = '0', zoom = '1', ...target] = code.split(',');
  if (!head.startsWith('cam=') || !/^cam=[a-z]+$/.test(head)) return code;
  const turned = (((Number(turn) + steps * 90) % 360) + 360) % 360;
  return [head, String(turned), zoom, ...target].join(',');
}

/** The look after `id` (the first after an unknown id). */
export function nextLook(id: string): string {
  return PLAYGROUND_LOOKS[(PLAYGROUND_LOOKS.indexOf(id) + 1) % PLAYGROUND_LOOKS.length];
}
