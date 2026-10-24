/**
 * @file What an actor reads of a step's intents (PLAN.md WP 3.2, WP 13.3, WP 13.9; split from engine/sim/actors.ts at
 * its cap, WP 13.16): `intentsOf(actor, intents)` is the step's intents for a player, else its AI's (`actor.intents`,
 * its presses from the edges of the buttons it held, `actor.held`); `motionInput(actor, wants, controls)` is what an
 * actor on a movement model (engine/physics/movement/) takes of them: the sprint, walk and crouch buttons as a player's
 * controls (`input.sprint`, `input.crouch`) say, the use press (unless a use took it, `used`: engine/sim/interact.ts),
 * the view, the keys' frame and what it faces (the aim's point, else the view), whether a melee swings (no mantle
 * then: engine/sim/melee.ts) and whether he aims down a weapon's sights (a walk then: engine/sim/weapons.ts).
 *
 * Invariants: pure but for an AI actor's own button edges, which `intentsOf` keeps in its component.
 *
 * @example
 * // const wants = intentsOf(actor, intents); // a player's: the step's own
 * // const input = motionInput(actor, wants, { holdSprint: false, toggleCrouch: false });
 * @see engine/sim/actors.test.ts
 */
import { held, normalizeIntents, pressed, type Intents } from '../input/intents';
import type { CharacterInput } from '../physics/character';
import type { ActorComponent } from './actors';

/** The intents an actor acts on this step: the step's for a player, else its AI's (with presses from `b`'s edges). */
export function intentsOf(actor: ActorComponent, intents: Intents): Intents {
  if (actor.player) return intents;
  const own = normalizeIntents(actor.intents, normalizeIntents({ b: actor.held }));
  const { p: _pressed, ...rest } = actor.intents;
  [actor.held, actor.intents] = [[...(own.b ?? [])], rest];
  return own;
}

/** A player's controls (the settings `input.sprint` and `input.crouch`): a held sprint, a toggled crouch. */
export interface Controls {
  readonly holdSprint: boolean;
  readonly toggleCrouch: boolean;
}

/**
 * The shooter model's input from `wants`: the sprint, walk and crouch buttons, the view, the keys' frame and what it
 * faces; `used`, a use took the step's press (no ride); `swinging`, a melee swings (no mantle: engine/sim/melee.ts);
 * `aiming`, he aims down a weapon's sights, so walks (Apex walks only then: engine/sim/weapons.ts).
 */
export function motionInput(
  actor: ActorComponent,
  wants: Intents,
  controls: Controls,
  used = false,
  swinging = false,
  aiming = false,
): CharacterInput {
  const [aimX, , aimZ] = wants.aim ?? [];
  const aimed = aimX !== undefined && Math.hypot(aimX - actor.x, aimZ! - actor.z) > 0.05;
  const face = aimed ? Math.atan2(aimX - actor.x, aimZ! - actor.z) : wants.look?.[0];
  const frame = wants.cam ?? wants.look?.[0];
  const toggle = actor.player && controls.toggleCrouch;
  return {
    sprint: held(wants, 'sprint'),
    sprintPressed: pressed(wants, 'sprint'),
    ...(actor.player && controls.holdSprint ? { sprintHold: true } : {}),
    walk: held(wants, 'walk') || aiming,
    crouch: !toggle && held(wants, 'crouch'),
    crouchToggle: pressed(wants, 'crouchToggle') || (toggle && pressed(wants, 'crouch')),
    usePressed: pressed(wants, 'interact') && !used, // a use took the press (engine/sim/interact.ts): no ride
    ...(wants.look ? { view: wants.look[0], pitch: wants.look[1] } : {}),
    ...(frame !== undefined ? { frame } : {}),
    ...(face !== undefined ? { face } : {}),
    ...(swinging ? { swinging } : {}),
  };
}
