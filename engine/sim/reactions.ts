/**
 * @file Reactions and secondary motion on a scene's bodies (PLAN.md WP 6.2, WP 7.8, ADR-0018 amendment 1): the two
 * components that put engine/anim's reactions and secondary motion on an entity.
 *
 * - **`reactions`** (`REACTION_FIELDS`): a body's reactions (engine/anim/reactions.ts `Reactions`: the flinch spring,
 *   the knockdown, the death and the get-up chosen by how it lies) as the plain data `Reactions.save()` writes, so
 *   the hash, captures and replays hold them. `reactTo(w, id, act)` runs `act` on an entity's reactions, adding the
 *   component at rest the first time, and saves them back. `stepReactions(state, dt)` steps them one tick and returns
 *   what the phase playing tells the body (`down`, `pose`), to lay over its body states. The system `actors.anim`
 *   steps an actor's (engine/sim/actors.ts); game code steps any other body's in its own rig system (a crowd body's
 *   states, engine/sim/crowdBodies.ts). The view draws an actor's flinch and how it lies (engine/gfx/puppets/actors.ts).
 * - **`secondary`** (`SECONDARY_FIELDS`): the secondary motion the view hangs on an actor's puppet (engine/anim/
 *   secondary.ts `Secondary`: hair, a cape, a tail) and its colour. The sim only carries it, as it carries a build or
 *   a stand-in's material: the view steps the chains, so none of their motion reaches the hash.
 *
 * Invariants: everything a reaction remembers is in its component (the `Reactions` here are scratch, loaded at every
 * call), so a capture restores it exactly; a body at rest (no flinch, nothing playing) steps for nothing.
 *
 * @example
 * import { Vector3 } from '../core/math';
 * import { createWorld } from './world';
 * const w = createWorld({ seed: 1 });
 * const id = w.spawn({});
 * reactTo(w, id, (r) => r.knockDown(new Vector3(0, 0, -1), 0)); // struck from the front: it falls onto its back
 * stepReactions(w.get(id).reactions, w.dt); // { down: 1 }: what the body is told while it falls
 * @see engine/sim/reactions.test.ts
 */
import { REACTIONS, Reactions, type ReactionBody, type ReactionState } from '../anim/reactions';
import type { EventMap } from '../core/events';
import { codeError } from '../core/log';
import { registry as sharedRegistry, type Registry } from '../core/registry';
import { defineSchema } from '../core/schema';
import { SIM_DT } from '../core/time';
import { defineComponent } from './state';
import type { World } from './world';

const AT_REST: ReactionState = new Reactions().save();

/** The component `reactions`' fields: `Reactions.save()`'s, at rest by default. */
export const REACTION_FIELDS = defineSchema({
  flinch: {
    type: 'array',
    items: { type: 'number' },
    default: AT_REST.flinch,
    description: 'The flinch: its lean right and forward (tilts’ tangents), then their speeds per second.',
  },
  playing: {
    type: 'string',
    enum: ['', ...Object.keys(REACTIONS)],
    default: '',
    description: 'The reaction playing (down, die, getUpBack, getUpFront), or empty for none.',
  },
  lying: {
    type: 'string',
    enum: ['up', 'down'],
    default: 'up',
    description: 'How the body lies while down: on its back (up) or on its face (down).',
  },
  lie: {
    type: 'number',
    default: AT_REST.lie,
    unit: 's',
    description: 'Seconds a knocked-down body lies before it gets up; −1 until it is told to.',
  },
  timeline: {
    type: 'array',
    items: { type: 'number' },
    default: AT_REST.timeline,
    description: 'The phase playing (−1: none) and the seconds into it.',
  },
});

/** The component `secondary`'s fields: what the view hangs on an actor's puppet. */
export const SECONDARY_FIELDS = defineSchema({
  hair: {
    type: 'string',
    enum: ['', 'long', 'ponytail'],
    default: '',
    description: 'Hair from the back of the head (engine/anim/secondary.ts HAIR: long or ponytail), or empty for none.',
  },
  cape: { type: 'boolean', default: false, description: 'A cape from the backs of the shoulders.' },
  tail: { type: 'boolean', default: false, description: 'A tail from the back of the pelvis.' },
  color: { type: 'string', default: '#7a2430', description: 'Their colour, a CSS hex colour.' },
});

/** The component `secondary`: the secondary motion the view hangs on an actor's puppet. */
export interface SecondaryComponent {
  hair: '' | 'long' | 'ponytail';
  cape: boolean;
  tail: boolean;
  color: string;
}

/** The components this module declares. */
export type ReactionComponents = { reactions: ReactionState; secondary: SecondaryComponent };

/** Declares the components `reactions` and `secondary` on `registry` (the shared one by default), once. */
export function defineReactionKinds(registry: Registry = sharedRegistry): void {
  if (registry.kinds().includes('component') && registry.has('component', 'reactions')) return;
  const reactions =
    'A body’s reactions (engine/anim/reactions.ts): its flinch, and the knockdown, death or get-up playing.';
  defineComponent('reactions', { description: reactions, fields: REACTION_FIELDS }, registry);
  const secondary = 'The secondary motion (hair, a cape, a tail) the view hangs on an actor’s puppet, and its colour.';
  defineComponent('secondary', { description: secondary, fields: SECONDARY_FIELDS }, registry);
}
defineReactionKinds();

/** Scratch reactions, one per step length: loaded from a component at every call, so they keep nothing. */
const scratch = new Map<number, Reactions>();
const reactionsAt = (dt: number) => {
  let reactions = scratch.get(dt);
  if (!reactions) scratch.set(dt, (reactions = new Reactions({ dt })));
  return reactions;
};
const NONE: ReactionBody = Object.freeze({});

/**
 * Runs `act` on entity `id`'s reactions (the component `reactions`, added at rest when it has none) and saves them
 * back; returns the component. Throws `SIM_BAD_ARGUMENT` for an id that does not live.
 */
export function reactTo<C extends object, E extends EventMap>(
  world: World<C, E>,
  id: number,
  act: (reactions: Reactions) => unknown,
): ReactionState {
  const w = world as unknown as World<ReactionComponents>;
  if (!w.has(id))
    throw codeError('SIM_BAD_ARGUMENT', { where: 'reactTo(w, id, act)', value: String(id), expected: 'a live id' });
  const state = w.get(id)?.reactions ?? w.add(id, 'reactions');
  const reactions = reactionsAt(w.dt).load(state);
  act(reactions);
  return Object.assign(state, reactions.save());
}

/** Steps reactions `state` one tick of `dt` s, in place; returns what the phase playing tells the body. */
export function stepReactions(state: ReactionState, dt: number = SIM_DT): ReactionBody {
  const [side, forward, sideSpeed, forwardSpeed] = state.flinch;
  if (state.playing === '' && side === 0 && forward === 0 && sideSpeed === 0 && forwardSpeed === 0) return NONE;
  const reactions = reactionsAt(dt).load(state);
  reactions.step();
  Object.assign(state, reactions.save());
  return reactions.body;
}
