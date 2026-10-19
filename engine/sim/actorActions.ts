/**
 * @file Actions on actors (PLAN.md WP 13.11; engine/anim/actions.ts, WP 8.7): the component `actions` holds an animated
 * actor's `Actions` as the plain data `Actions.save()` writes (`ACTIONS_FIELDS`), so the sim hashes, captures and
 * restores what plays and where. `actOn(w, id, act)` runs `act` on actor `id`'s actions (the component added at rest
 * the first time a call changes them): `actOn(w, id, (a) => a.play('roll'))`, `a.next()` for a beat held
 * `until: 'next'`, `a.finish()`, `a.cancel('walk')`; the call's own events (the beat it begins, its first marks, an
 * `end`) go out as `action` from the call, at once between steps and at the step's end inside one. An action's clip
 * beats play on the actor's clip layer (the component `clips`, engine/sim/actorClips.ts), saved back with it; an actor
 * without one cannot play them (`SIM_ACTION_NO_CLIPS`).
 *
 * The system `actors.anim` (engine/sim/actors.ts) steps an actor's actions before its animator, in id order
 * (`stepActorActions`): what the beat tells the body (its states, a move, a motion) is laid over the animator's input,
 * and each event goes out as `action` `{ id, type, phase, late }`: a beat's name as it begins, its own events (`grab`,
 * `pull`, `top`…), and `end`. The view poses the effectors, the flip and the squash on the actor's puppet from the same
 * data (engine/gfx/puppets/actors.ts).
 *
 * Invariants: everything an actor's actions are is the component (the `Actions` here are made afresh for every call
 * and every step, so nothing, not a call's events, outlives one), so a capture restores them exactly wherever it is
 * taken; an actor at rest, its channels eased back, steps for nothing; a call that changes nothing adds nothing.
 *
 * @example
 * import { createCharacter } from '../physics/character';
 * import { spawnActor } from './actors';
 * // in a scene with a physics world, the actions loaded (loadActions):
 * // const id = spawnActor(w, { at: [0, 0, 0], character: createCharacter(), anim: { build: 'build:adult' } });
 * // actOn(w, id, (a) => a.play('roll'));
 * // w.step(); w.get(id).actions.playing; // 'action:roll'
 * @see engine/sim/actorActions.test.ts
 */
import { Actions, type ActionsState } from '../anim/actions';
import { ACTION } from '../anim/actions-data';
import type { AnimatorInput } from '../anim/states';
import type { EventMap } from '../core/events';
import { codeError, defineCodes } from '../core/log';
import { registry as sharedRegistry, type Registry } from '../core/registry';
import { defineSchema } from '../core/schema';
import { clipLayerOf } from './actorClips';
import type { ActorComponents } from './actors';
import { defineComponent } from './state';
import type { World } from './world';

/** The codes this module raises. */
export const ACTOR_ACTION_CODES = defineCodes('sim', {
  SIM_ACTION_NO_CLIPS: {
    template: 'actor {id} cannot play action {action}: it plays clips ({clips}) and the actor has no clip layer',
    fix: 'give the actor clips first, with the sets those clips come from: addClips(w, id, { sets }) (engine/sim/actorClips.ts)',
    doc: 'Raised by `actOn` (engine/sim/actorActions.ts) when an action with a `clip` beat is played on an actor without the component `clips`: the beat would play nothing.',
  },
});

const AT_REST: ActionsState = new Actions().save();

/** The component `actions`' fields: `Actions.save()`'s, at rest by default. */
export const ACTIONS_FIELDS = defineSchema({
  playing: { type: 'string', default: '', description: 'The action playing, by id (`action:roll`); empty when none.' },
  beat: { type: 'integer', default: -1, minimum: -1, description: 'Its beat’s index; −1 at rest.' },
  t: {
    type: 'number',
    default: ACTION.out,
    unit: 's',
    description: 'Seconds into the beat; at rest, since the last action let go (up to `ACTION.out`).',
  },
  from: {
    type: 'array',
    items: { type: 'number' },
    default: AT_REST.from,
    description: 'The channels as the beat began (engine/anim/actions.ts `CHANNELS`): what they ease from.',
  },
  clip: { type: 'string', default: '', description: 'The clip its beats started (`SET/Clip`); empty when none.' },
});

/** The components this module declares. */
export type ActionComponents = { actions: ActionsState };

/** Declares the component `actions` on `registry` (the shared one by default), once. */
export function defineActionKinds(registry: Registry = sharedRegistry): void {
  if (registry.kinds().includes('component') && registry.has('component', 'actions')) return;
  const description = 'An actor’s actions (engine/anim/actions.ts): the one playing, its beat and its channels.';
  defineComponent('actions', { description, fields: ACTIONS_FIELDS }, registry);
}
defineActionKinds();

/** An entity with an animated actor, and its actions and clips when it has them. */
type ActionActor = Pick<ActorComponents, 'actor' | 'animator'> & Partial<ActionComponents> & { clips?: { state: unknown } }; // prettier-ignore

/** Fresh actions for actor `id` in `w`, on its clip layer when it has the component `clips`: they keep nothing. */
function actionsOf(w: World, id: number, entity: ActionActor): Actions {
  return new Actions({ dt: w.dt, clips: entity.clips ? clipLayerOf(w, id) : undefined });
}

/** Writes `actions` (and the clip layer it played on) back into `entity`'s components. */
function save(entity: ActionActor, actions: Actions): ActionsState {
  if (entity.clips && actions.clips) entity.clips.state = actions.clips.save();
  return Object.assign(entity.actions!, actions.save());
}

/**
 * Runs `act` on actor `id`'s actions (the component `actions`, added at rest when it has none and the call changes
 * them) and saves them back, with its clip layer, emitting the call's events as `action`; returns the component (a
 * state at rest when nothing changed on an actor without one). The `Actions` given to `act` are fresh: keep nothing
 * of them. Throws `SIM_BAD_ARGUMENT` for an id that is not an animated actor, and `SIM_ACTION_NO_CLIPS` for an action
 * that plays clips on an actor without them.
 */
export function actOn<C extends object, E extends EventMap>(
  world: World<C, E>,
  id: number,
  act: (actions: Actions) => unknown,
): ActionsState {
  const w = world as unknown as World<ActionComponents>;
  const entity = w.get(id) as ActionActor | undefined;
  if (!entity?.actor || !entity.animator)
    throw codeError('SIM_BAD_ARGUMENT', { where: 'actOn(w, id, act)', value: String(id), expected: 'an animated actor’s id' }); // prettier-ignore
  const actions = actionsOf(w as unknown as World, id, entity).load(entity.actions ?? AT_REST);
  const clipsBefore = entity.clips ? JSON.stringify(entity.clips.state) : '';
  try {
    act(actions);
  } catch (error) {
    const { code, values } = error as { code?: string; values?: Record<string, string> };
    if (code === 'ANIM_ACTION_NO_CLIPS') throw codeError('SIM_ACTION_NO_CLIPS', { id: String(id), action: values?.action ?? '?', clips: values?.clips ?? '?' }); // prettier-ignore
    throw error;
  }
  const state = actions.save();
  const clipsSame = !actions.clips || JSON.stringify(actions.clips.save()) === clipsBefore;
  if (!entity.actions && actions.events.length === 0 && clipsSame && JSON.stringify(state) === JSON.stringify(AT_REST)) return state; // prettier-ignore
  entity.actions ??= w.add(id, 'actions') as ActionsState;
  save(entity, actions);
  for (const { type, ...event } of actions.events) w.emit('action', { id, type, ...event });
  return entity.actions;
}

/**
 * Steps actor `entity`'s (id `id`) actions one tick, in place, and emits their events as `action`; returns what the
 * beat tells the body, to lay over its states. An actor at rest steps for nothing. The system `actors.anim` calls it.
 */
export function stepActorActions(world: World, id: number, entity: ActionActor): AnimatorInput {
  const state = entity.actions;
  if (!state || (state.playing === '' && state.t >= ACTION.out)) return {};
  const actions = actionsOf(world, id, entity).load(state);
  const events = actions.step();
  save(entity, actions);
  for (const { type, ...event } of events) world.emit('action', { id, type, ...event });
  return actions.body;
}
