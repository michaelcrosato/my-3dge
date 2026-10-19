/**
 * @file A game's own cameras (PLAN.md WP 13.8; doctrine: Common ground: a camera is a function of input and time): the
 * registry kind `camera`. `defineCamera(name, { create })` adds a camera mode without editing the engine: its code is
 * `cam3=<name>[,…]`, which `readCameraCode` and `createCamera` (engine/gfx/cameras/place.ts) hand to `create` with the
 * camera before it, so `__engine.camera.set`, the page's switches, blends and effects (engine/gfx/cameras/rig.ts) and
 * the feel kit's camera metrics all take it. `create` returns a camera: the engine's factories make one, and
 * `followCamera(type, state, steps, effects)` (engine/gfx/cameras/chase.ts) wraps a game's own pure steps.
 *
 * Invariants: a name is a word that no engine camera or view has (`CAMERA_NAMES`); entries are frozen; cameras are view
 * state, never the sim's.
 *
 * @example
 * import { createRegistry } from '../../core/registry';
 * const registry = createRegistry();
 * defineCamera('low', { description: 'The shooter, lower.', create: (_code, { from }) => createShoulderCamera({ pitch: 0.2, from }) }, registry); // prettier-ignore
 * cameraEntry('low', registry)?.description; // 'The shooter, lower.'
 * @see engine/gfx/cameras/define.test.ts
 */
import { registry as sharedRegistry, type Entry, type Registry } from '../../core/registry';
import { defineSchema } from '../../core/schema';
import { CAMERA_3D, FOLLOW_CAMERAS, VIEW_NAMES } from './codes';
import type { CameraPose } from './pose';

/** Every name the engine's cameras and views take: a game's camera takes another. */
export const CAMERA_NAMES: readonly string[] = Object.freeze([...VIEW_NAMES, ...CAMERA_3D, ...FOLLOW_CAMERAS]);

/** A game camera's fields. */
export const CAMERA_FIELDS = defineSchema({
  description: { type: 'string', default: '', description: 'What it shows, in words.' },
  create: {
    type: 'function',
    required: true,
    description: '(code, { from }) => a camera: made from its code (cam3=<name>[,…]) and the camera before it (`from`, its pose).', // prettier-ignore
  },
});

/** What `defineCamera` takes: `create` makes the camera from its code and the camera before it. */
export interface CameraKindSpec {
  readonly description?: string;
  readonly create: (code: string, options: { readonly from?: CameraPose }) => unknown;
}

/** Declares the kind `camera` on `registry` unless it has it. */
function cameraKind(registry: Registry): void {
  if (registry.kinds().includes('camera')) return;
  registry.defineKind('camera', {
    description: "A game's own camera mode: its code cam3=<name>[,…] and the function that makes it (engine/gfx/cameras/define.ts).", // prettier-ignore
    fields: CAMERA_FIELDS,
    defineWith: "defineCamera('<name>', { description, create })",
    check: (entry) => {
      const id = String(entry.id);
      if (!/^[a-z][a-zA-Z0-9]*$/.test(id)) return [`its name ${id} is not a word (letters and digits, a small letter first)`]; // prettier-ignore
      return CAMERA_NAMES.includes(id) ? [`${id} is an engine camera's name: choose another`] : [];
    },
  });
}

/** Adds a game's camera mode on `registry` (the shared one by default). Throws `CORE_BAD_SPEC` naming each problem. */
export function defineCamera(name: string, spec: CameraKindSpec, registry: Registry = sharedRegistry): Entry {
  cameraKind(registry);
  return registry.def('camera', name, spec as unknown as Record<string, unknown>);
}

/** The game camera named `name` on `registry`, or undefined. */
export function cameraEntry(name: string, registry: Registry = sharedRegistry): (Entry & CameraKindSpec) | undefined {
  if (!registry.kinds().includes('camera') || !registry.has('camera', name)) return undefined;
  return registry.get('camera', name) as Entry & CameraKindSpec;
}
