/**
 * @file The house part of the public sim API (PLAN.md §6.1, Phase 13, WP 13.16): every name sim-side game code takes
 * for using things (the `interact` action's use and prompt, carrying and throwing, a strike), doors, windows and other
 * breakable props, switches, and the time of day (WP 13.23), re-exported whole by engine/sim-api.ts, so that file
 * stays under its line cap, as
 * engine/sim/movementApi.ts and engine/sim/siteApi.ts do (ADR-0025 amendment 19). Game code imports these names from
 * engine/sim-api.ts (or engine/index.ts), never from here: the public-API rule rejects any other engine path.
 *
 * Invariants: the same as engine/sim-api.ts's: a flat list of `export … from` lines, one name per line, grouped by
 * area and append-only; the house's later WPs append their names. Only sim-side modules are re-exported, and each
 * name is documented where it is declared.
 *
 * @example
 * // labs/playground/scenes/site.ts
 * // import { addDoor, addInteraction, addSwitch } from '../../../engine/sim-api';
 * @see engine/sim-api.ts
 */

// Use (WP 13.16): the system `interact` (a player's use of the thing in reach and in view, with its prompt; carrying
// and throwing a light prop), the kinds `usable` and `strikable`, and the body-to-entity lookup.
export { addInteraction } from './interact';
export { defineUsable } from './interact';
export { defineStrikable } from './interact';
export { strikeEntity } from './interact';
export { USE_REACH } from './interact';
export { CARRY_MASS } from './interact';
export { THROW_SPEED } from './interact';
export type { UsableSpec } from './interact';
export type { InteractorComponent } from './interact';
export type { StrikeForce } from './interact';
export { propOfBody } from './props';
export type { SpawnPropOptions } from './props';
export type { PropHealthComponent } from './props';
export type { PropLightComponent } from './props';

// Doors (WP 13.16): hung on a hinge or sliding, opened away from the user, locked, blocked, burst open and broken.
export { addDoor } from './doors';
export { addLevelDoors } from './doors';
export { useDoor } from './doors';
export { strikeDoor } from './doors';
export { breakDoor } from './doors';
export { DOOR_SWING } from './doors';
export type { DoorSpec } from './doors';
export type { DoorComponent } from './doors';

// Windows and breakables (WP 13.16): props with health and their breaking, a level's window panes, a bolt's strike.
export { addLevelWindows } from './breakables';
export { addBreakables } from './breakables';
export { damageProp } from './breakables';
export { breakProp } from './breakables';
export { strikeBody } from './breakables';
export { BREAK_SPEED } from './breakables';

// Switches (WP 13.16): a room's lights and the garage door, as sim state the view reads.
export { addSwitch } from './switches';
export { switchGroup } from './switches';
export { flipSwitch } from './switches';
export type { SwitchSpec } from './switches';
export type { SwitchComponent } from './switches';

// Strikes (WP 13.19): a strikable entry by entity (the move a melee plays on it: a door's kick), what takes one, and
// whose a body is (a prop's or an actor's, WP 13.20).
export type { StrikeEntry } from './interact';
export { strikeEntry } from './interact';
export { takesStrike } from './interact';
export { entityOfBody } from './props';

// Light and time (WP 13.23): the world's clock, and the light groups it switches at dusk and dawn.
export { setDaytime } from './lights';
export { daytimeOf } from './lights';
export { lightsAtDusk } from './lights';
export { litAt } from './lights';
export { DUSK } from './lights';
export { DAWN } from './lights';
export type { DaytimeComponent } from './lights';
export type { DuskComponent } from './lights';
