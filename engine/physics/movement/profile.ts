/**
 * @file Movement profiles (PLAN.md WP 13.3, docs/PLAYGROUND.md §3.2): the registry kind `movement`. A profile is data:
 * the character controller's settings it sets (`character`: the hull, steps, slopes, gravity, the jump and the
 * forgiving details, any of engine/physics/character.ts's `CHARACTER_FIELDS`) and, for the shooter model, that model's
 * numbers (`model`, engine/physics/movement/model.ts, whose defaults are Apex's). A profile without a model is the
 * platformer model of its `character` fields: engine/physics/feel.ts's controller, exactly.
 *
 * A character takes a profile by id, `createCharacter({ movement: 'movement:apex' })`, through `applyMovement`: the
 * profile's `character` under the spec's own fields (a scene's tuning wins), and the profile's model, filled, as
 * `movement`, a spec's `model` laid over it field by field (`model: { gaits: { run: 5 } }`). A profile with no model
 * leaves `movement` out, so its character is the very one its fields alone make, down to its hash. The two profiles
 * every registry gets are engine/physics/movement/profiles.ts's.
 *
 * Invariants: data only; a profile's `character` is checked where it is used (`createCharacter` names each problem)
 * and by engine/physics/movement/profile.test.ts for every profile defined.
 *
 * @example
 * import './profiles';
 * applyMovement({ movement: 'movement:platformer', speed: 5 }); // { speed: 5 }
 * getMovement('movement:apex').model?.gaits.sprint; // 6.604
 * @see engine/physics/movement/profile.test.ts
 */
import { codeError } from '../../core/log';
import { registry as sharedRegistry, type Entry, type Registry } from '../../core/registry';
import { defineSchema, isPlainObject, parse } from '../../core/schema';
import { MODEL_FIELDS, type MovementModel, type MovementModelSpec } from './model';

/** A profile's fields: what `defineMovement` takes. */
export const MOVEMENT_FIELDS = defineSchema({
  description: { type: 'string', default: '', description: 'What it moves like, and where its numbers come from.' },
  character: {
    type: 'object',
    default: {},
    description:
      'The character controller’s settings it sets (CHARACTER_FIELDS, engine/physics/character.ts): its hull, steps, slopes, gravity, jump and the forgiving details.',
  },
  model: {
    type: 'object',
    properties: MODEL_FIELDS,
    description:
      'The shooter model’s numbers (MODEL_FIELDS, engine/physics/movement/model.ts; an absent one is Apex’s); absent: the platformer model of `character`.',
  },
});

/** A movement profile, as the registry holds it. */
export type MovementProfile = Entry<typeof MOVEMENT_FIELDS> & { model?: MovementModel };

/** How a movement profile is written (`MOVEMENT_FIELDS`). */
export interface MovementSpec {
  description?: string;
  character?: Readonly<Record<string, unknown>>;
  model?: MovementModelSpec;
}

/** Declares the kind `movement` on `registry`, once. */
export function movementKind(registry: Registry = sharedRegistry): void {
  if (registry.kinds().includes('movement')) return;
  registry.defineKind('movement', {
    description:
      'How a character moves: the controller’s settings it sets and, for the shooter model, its numbers (speeds, accelerations, air control, the jump’s fatigue, the lurch, the fall stun). Taken with createCharacter({ movement: id }).',
    fields: MOVEMENT_FIELDS,
    defineWith: "defineMovement('movement:<name>', { character: { speed: 5 }, model: { gaits: { sprint: 7 } } })",
  });
}

/** Registers a movement profile (on the shared registry by default). Throws `CORE_BAD_SPEC` naming each problem. */
export function defineMovement(id: string, spec: MovementSpec, registry: Registry = sharedRegistry): MovementProfile {
  movementKind(registry);
  return registry.def('movement', id, spec as Record<string, unknown>) as MovementProfile;
}

/** The movement profile `id`. Throws `CORE_NO_ENTRY` naming the closest ids. */
export function getMovement(id: string, registry: Registry = sharedRegistry): MovementProfile {
  movementKind(registry);
  return registry.get('movement', id) as MovementProfile;
}

/** Every movement profile, sorted by id. */
export function listMovements(registry: Registry = sharedRegistry): MovementProfile[] {
  movementKind(registry);
  return registry.list('movement') as MovementProfile[];
}

/**
 * The character spec `spec` means once its profile is applied (see the file comment): unchanged without a
 * `movement`; with a profile's id, that profile's `character` under the spec's own fields and its model, the spec's
 * `model` over it, as `movement`, or no `movement` at all for a profile without a model. Nested settings merge field
 * by field, so a spec's `feel: { coyote: 0.1 }` keeps the profile's other forgiving details. A `movement` that is
 * already a model (a stored character's) stays as it is. Throws `CORE_BAD_SPEC` for a `model` with nothing to tune.
 */
export function applyMovement(
  spec: Readonly<Record<string, unknown>>,
  registry: Registry = sharedRegistry,
): Record<string, unknown> {
  const named = spec.movement;
  const bad = (problems: string) => codeError('CORE_BAD_SPEC', { where: 'createCharacter(spec)', problems });
  if (typeof named !== 'string') {
    if (spec.model !== undefined) throw bad('model tunes a profile’s model: give it with movement: "movement:<name>"');
    return { ...spec };
  }
  if (!named.startsWith('movement:')) {
    throw bad(`movement is ${JSON.stringify(named)}; it must name a profile, "movement:<name>" (node x describe movement lists them)`); // prettier-ignore
  }
  const profile = getMovement(named, registry);
  const { movement: _named, model: tuning, ...own } = spec;
  const merged = merge(profile.character as Record<string, unknown>, own);
  if (!profile.model) {
    if (tuning !== undefined) throw bad(`model: ${named} has no model to tune (it is the platformer model)`);
    return merged;
  }
  const model = isPlainObject(tuning) ? merge(profile.model as Record<string, unknown>, tuning) : profile.model;
  return { ...merged, movement: parse(MODEL_FIELDS, model, 'createCharacter(spec).model') };
}

/** `over` laid over `under`, plain objects field by field. */
function merge(under: Readonly<Record<string, unknown>>, over: Readonly<Record<string, unknown>>) {
  const out: Record<string, unknown> = { ...under };
  for (const [key, value] of Object.entries(over)) {
    const below = out[key];
    out[key] = isPlainObject(value) && isPlainObject(below) ? merge(below, value) : value;
  }
  return out;
}
