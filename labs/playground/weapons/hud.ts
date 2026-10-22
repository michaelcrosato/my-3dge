/**
 * @file The firearms' HUD line (docs/PLAYGROUND.md §7.2, PLAN.md WP 13.20): what the page (labs/playground/main.ts)
 * shows of the player's weapons (engine/sim/weapons.ts's component `weapons`) each frame: the weapon out and its
 * rounds, or that it reloads, or holstered; and the range's count, his hits and his accuracy, the share of his shots
 * that struck a standing target or a person (`weaponLine`). `showsCrosshair` says when the screen's centre aims a
 * weapon: first person and the shooter, a weapon out, its sights not up (they are the aim then).
 *
 * Invariants: pure: it reads the component's plain data and never changes it.
 *
 * Game code, a page's: it imports only the engine's APIs and the playground's own files.
 *
 * @example
 * import { PISTOL } from './guns';
 * weaponLine({ slots: [PISTOL.id], slot: 0, mags: [8], reload: -1, shots: 4, hits: 3, aim: 0 }); // 'Pistol 8/10 · Hits 3 of 4 (75%)'
 * weaponLine({ slots: [PISTOL.id], slot: -1, mags: [10], reload: -1, shots: 0, hits: 0, aim: 0 }); // 'Holstered: 1 2 draw'
 * @see labs/playground/weapons/range.test.ts
 */
import { getWeapon } from '../../../engine/sim-api';
import { PISTOL, RIFLE } from './guns';

/** What the line reads of the component `weapons`. */
export type WeaponsView = Readonly<{ slots: readonly string[]; slot: number; mags: readonly number[]; reload: number; shots: number; hits: number; aim: number }>; // prettier-ignore

/** The guns' names on the HUD. */
const NAMES: Readonly<Record<string, string>> = { [PISTOL.id]: 'Pistol', [RIFLE.id]: 'Rifle' };

/** The HUD's line for the player's weapons (see the file comment); `draw` names the keys that draw them. */
export function weaponLine(weapons: WeaponsView, draw = '1 2'): string {
  const count = weapons.shots > 0 ? ` · Hits ${weapons.hits} of ${weapons.shots} (${Math.round((100 * weapons.hits) / weapons.shots)}%)` : ''; // prettier-ignore
  if (weapons.slot < 0) return `Holstered: ${draw} draw${count}`;
  const id = weapons.slots[weapons.slot];
  const name = NAMES[id] ?? id;
  const rounds = weapons.reload >= 0 ? 'reloading' : `${weapons.mags[weapons.slot]}/${getWeapon(id).magazine}`;
  return `${name} ${rounds}${count}`;
}

/** Whether the crosshair shows: a camera that aims with its centre, a weapon out, its sights not up. */
export function showsCrosshair(weapons: WeaponsView | undefined, centre: boolean): boolean {
  return centre && !!weapons && weapons.slot >= 0 && weapons.aim < 0.5;
}
