/**
 * @file The playground's HUD by camera mode (docs/PLAYGROUND.md §8.3, PLAN.md WP 13.25): what each of the five modes
 * shows over the game (`HUD_MODES`), and `showHud`, which the page (labs/playground/main.ts) runs each drawn frame:
 * - the camera and the look in use, top right, and the room the player is in on a scene's site, top left;
 * - the crosshair where the screen's centre aims a gun (first person and the shooter: `showsCrosshair`,
 *   labs/playground/weapons/hud.ts), never in the views that aim with the pointer;
 * - the prompts: what using the thing in reach does, with the key that uses it on the device used last (WP 13.16);
 * - the ammo: the weapon out and its rounds, the range's count (`weaponLine`, WP 13.20);
 * - the keys of the map in use, as its prompts give them (`keysLine`, labs/playground/controls.ts);
 * - the feel readout (`feelLine`): the player's speed over the ground and how he moves (the movement model's mode or
 *   gait), which the platformer, isometric and top-down show (where the view gives speed away least), and every mode
 *   with the view setting `playground.readout` at `on` (`off` hides it everywhere).
 * Photo mode hides it all (labs/playground/ui/photo.ts). Every line is a `[data-ui=hud]` element with its `data-id`
 * (`mode`, `room`, `use`, `weapon`, `keys`, `readout`), so tests read the HUD as text.
 *
 * Invariants: presentation only: it reads the frame's world and the devices' prompts, never changes the run.
 *
 * Game code, a page's: it imports only the engine's public API (engine/index.ts) and the playground's own files.
 *
 * @example
 * HUD_MODES.isometric.crosshair; // false: the pointer aims
 * feelLine({ actor: { vx: 3, vz: 4 }, motion: { mode: 'ground', gait: 'sprint' } }); // '5.0 m/s · sprint'
 * feelLine({ actor: { vx: 0, vz: 1 }, motion: { mode: 'air', gait: 'run' } }); // '1.0 m/s · air'
 * @see labs/playground/ui/hud.test.ts
 */
import type { Input, Overlay } from '../../../engine';
import { defineSettings } from '../../../engine/sim-api';
import { keysLine } from '../controls';
import { showsCrosshair, weaponLine, type WeaponsView } from '../weapons/hud';

/** The readout's view setting (see the file comment). */
export const HUD_SETTINGS = defineSettings({
  'playground.readout': {
    type: 'string',
    enum: ['auto', 'on', 'off'],
    default: 'auto',
    view: true,
    description:
      "The playground HUD's feel readout, the player's speed and how he moves (labs/playground/ui/hud.ts): 'auto' shows it in the platformer, isometric and top-down cameras, 'on' in every camera, 'off' in none.",
  },
});

/** What a camera mode's HUD shows (see the file comment). */
export interface HudMode {
  readonly crosshair: boolean;
  readonly prompts: boolean;
  readonly ammo: boolean;
  readonly keys: boolean;
  readonly readout: boolean;
}

/** Each camera mode's HUD, by the mode's name (labs/playground/views.ts). */
export const HUD_MODES: Readonly<Record<string, HudMode>> = Object.freeze({
  shooter: { crosshair: true, prompts: true, ammo: true, keys: true, readout: false },
  first: { crosshair: true, prompts: true, ammo: true, keys: true, readout: false },
  platformer: { crosshair: false, prompts: true, ammo: true, keys: true, readout: true },
  isometric: { crosshair: false, prompts: true, ammo: true, keys: true, readout: true },
  'top-down': { crosshair: false, prompts: true, ammo: true, keys: true, readout: true },
});

/** The player as the HUD reads him: where he is and how fast, how he moves, what he would use, his weapons. */
export type HudPlayer = {
  actor: { vx: number; vz: number };
  motion?: { mode: string; gait: string };
  interactor?: { prompt: string };
  weapons?: WeaponsView;
};

/** The feel readout's line: speed over the ground, m/s, and the mode (or, on the ground, the gait). */
export function feelLine(player: Pick<HudPlayer, 'actor' | 'motion'>): string {
  const speed = Math.hypot(player.actor.vx, player.actor.vz).toFixed(1);
  const how = player.motion ? (player.motion.mode === 'ground' ? player.motion.gait : player.motion.mode) : '';
  return how ? `${speed} m/s · ${how}` : `${speed} m/s`;
}

/** What one frame's HUD shows: the mode's name, the look, the room line, the player, and the readout setting. */
export interface HudFrame {
  readonly mode: string;
  readonly look: string;
  readonly where: string | null;
  readonly player: HudPlayer | undefined;
  readonly readout: string;
}

/** Shows `frame`'s HUD on `ui`, the prompts read from `input` (see the file comment); `hidden` clears it. */
export function showHud(ui: Overlay, input: Input | null, frame: HudFrame, hidden = false): void {
  const hud = HUD_MODES[frame.mode] ?? HUD_MODES.shooter;
  const line = (id: string, text: string | null | undefined, at: Parameters<Overlay['hud']>[2]) =>
    ui.hud(id, hidden ? null : (text ?? null), at);
  line('mode', `Camera: ${frame.mode} · Look: ${frame.look.replace(/^look:playground-/, '')}`, { at: 'top-right' });
  line('room', frame.where, { at: 'top-left' });
  const readout = frame.readout === 'on' || (frame.readout === 'auto' && hud.readout);
  line('readout', readout && frame.player ? feelLine(frame.player) : null, { at: 'top' });
  if (!input) return;
  const use = hud.prompts ? frame.player?.interactor?.prompt : undefined;
  line('use', use ? `${input.prompt('interact')}: ${use}` : null, { at: 'bottom', keys: true });
  const draw = `${input.prompt('weapon1')} ${input.prompt('weapon2')}`;
  line('weapon', hud.ammo && frame.player?.weapons ? weaponLine(frame.player.weapons, draw) : null, { at: 'bottom-right' }); // prettier-ignore
  const centre = input.bindings.map.aimWith === 'centre';
  ui.crosshair(!hidden && hud.crosshair && showsCrosshair(frame.player?.weapons, centre));
  line('keys', hud.keys ? keysLine(input) : null, { at: 'bottom', keys: true });
}
