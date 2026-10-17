/**
 * @file Copy as profile (PLAN.md WP 13.4, docs/PLAYGROUND.md §3.4): the feel panel's tuning as data. `tunedSpec(base,
 * overrides)` is a profile spec (engine/physics/movement/profile.ts's `MovementSpec`): the base profile's `character`
 * settings, and its model with the live settings off their defaults laid over it (engine/physics/movement/settings.ts
 * `movementOverrides`), keeping only the numbers that differ from Apex's, so the spec states what it changes, as a
 * profile should. `profileText` writes it as the `defineMovement` call a game pastes, and any camera settings that
 * differ after it as a settings preset, for `x set` or a page's query.
 *
 * Invariants: pure; the spec, defined, makes the character the panel was playing (profile.test.ts proves it); numbers
 * keep every digit.
 *
 * @example
 * import { getMovement } from '../../physics/movement/profile';
 * import '../../physics/movement/profiles';
 * tunedSpec(getMovement('movement:apex'), [['gaits', 'sprint', 8]]).model; // { gaits: { sprint: 8 } }
 * @see engine/dev/feel/profile.test.ts
 */
import { parse } from '../../core/schema';
import { MODEL_FIELDS, type MovementModel } from '../../physics/movement/model';
import type { MovementProfile, MovementSpec } from '../../physics/movement/profile';
import type { MovementOverride } from '../../physics/movement/settings';

/** Apex's model, every number at its default. */
const APEX = parse(MODEL_FIELDS, {}) as MovementModel;

/** `base` with `overrides` over its model, as a spec that states only what differs from Apex's numbers. */
export function tunedSpec(
  base: MovementProfile,
  overrides: readonly MovementOverride[],
  description?: string,
): MovementSpec {
  // prettier-ignore
  const model = { ...(base.model ?? APEX) } as Record<string, unknown>;
  for (const [group, key, value] of overrides) {
    if (group === undefined) model[key] = value;
    else model[group] = { ...(model[group] as object), [key]: value };
  }
  const changed: Record<string, unknown> = {};
  for (const [group, value] of Object.entries(model)) {
    const apex = (APEX as unknown as Record<string, unknown>)[group];
    if (typeof value === 'number') {
      if (!Object.is(value, apex)) changed[group] = value;
      continue;
    }
    const own = Object.entries(value as Record<string, number>).filter(([key, n]) => !Object.is(n, (apex as Record<string, number>)[key])); // prettier-ignore
    if (own.length) changed[group] = Object.fromEntries(own);
  }
  const spec: MovementSpec = { description: description ?? `${base.id}, as tuned in the feel panel.`, character: base.character }; // prettier-ignore
  return base.model || Object.keys(changed).length ? { ...spec, model: changed } : spec;
}

/** The `defineMovement` call of `spec` as `id`, then `camera`'s settings (path → value) as a preset when any differ. */
export function profileText(id: string, spec: MovementSpec, camera: Readonly<Record<string, unknown>> = {}): string {
  const call = `defineMovement(${JSON.stringify(id)}, ${JSON.stringify(spec, null, 2)});`;
  const preset = Object.keys(camera).length ? `\n// the camera settings that differ, a preset for x set or the query:\n// ${JSON.stringify(camera)}` : ''; // prettier-ignore
  return `${call}${preset}\n`;
}
