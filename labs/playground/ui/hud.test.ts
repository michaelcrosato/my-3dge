/**
 * @file Unit tests for labs/playground/ui/hud.ts (WP 13.25): every camera mode has its HUD, the crosshair only where
 * the screen's centre aims; the feel readout reads the speed over the ground and how the player moves, and shows where
 * `playground.readout` and the mode say; hidden (photo mode), the HUD clears.
 * @see labs/playground/ui/hud.ts
 */
import { describe, expect, it } from 'vitest';
import type { Input, Overlay } from '../../../engine';
import { PLAYGROUND_CAMERAS } from '../views';
import { PISTOL } from '../weapons/guns';
import { feelLine, HUD_MODES, showHud } from './hud';

/** An overlay that keeps its lines and its crosshair. */
function lines() {
  const shown: Record<string, string | null> = {};
  let crosshair = false;
  const ui = { hud: (id: string, text: string | null) => void (shown[id] = text), crosshair: (on: boolean) => void (crosshair = on) }; // prettier-ignore
  return { ui: ui as unknown as Overlay, shown, crosshair: () => crosshair };
}

/** The input as the HUD reads it: prompts by action, a map that aims with the centre or the pointer. */
const input = (aimWith: string) =>
  ({ prompt: (action: string) => action.toUpperCase(), bindings: { map: { aimWith, lock: aimWith === 'centre', view: [] }, label: () => 'K' }, lastDevice: 'keyboard' }) as unknown as Input; // prettier-ignore

/** The player with a pistol out, sights down, on the ground at a sprint. */
const player = {
  actor: { vx: 0, vz: 6 },
  motion: { mode: 'ground', gait: 'sprint' },
  interactor: { prompt: 'Open' },
  weapons: { slots: [PISTOL.id], slot: 0, mags: [10], reload: -1, shots: 0, hits: 0, aim: 0 },
};

describe('the playground’s HUD', () => {
  it('has a HUD for every camera mode, the crosshair only where the centre aims', () => {
    for (const mode of PLAYGROUND_CAMERAS) expect(HUD_MODES[mode.name], mode.name).toBeDefined();
    expect(Object.entries(HUD_MODES).filter(([, hud]) => hud.crosshair).map(([name]) => name)).toEqual(['shooter', 'first']); // prettier-ignore
  });

  it('reads the speed over the ground and how he moves', () => {
    expect(feelLine(player)).toBe('6.0 m/s · sprint');
    expect(feelLine({ actor: { vx: 1, vz: 0 }, motion: { mode: 'zipline', gait: 'idle' } })).toBe('1.0 m/s · zipline');
    expect(feelLine({ actor: { vx: 0, vz: 0 } })).toBe('0.0 m/s'); // the platformer profile has no motion
  });

  it('shows the lines of the mode, the readout as the setting says, and clears all of it when hidden', () => {
    const frame = { mode: 'shooter', look: 'look:playground-cel', where: 'Room: hall', player, readout: 'auto' };
    const shooter = lines();
    showHud(shooter.ui, input('centre'), frame);
    expect(shooter.shown).toMatchObject({ mode: 'Camera: shooter · Look: cel', room: 'Room: hall', readout: null, use: 'INTERACT: Open' }); // prettier-ignore
    expect([shooter.shown.weapon?.startsWith('Pistol'), shooter.crosshair()]).toEqual([true, true]);
    const iso = lines();
    showHud(iso.ui, input('pointer'), { ...frame, mode: 'isometric' });
    expect([iso.shown.readout, iso.crosshair()]).toEqual(['6.0 m/s · sprint', false]);
    const forced = lines();
    showHud(forced.ui, input('centre'), { ...frame, readout: 'on' });
    expect(forced.shown.readout).toBe('6.0 m/s · sprint');
    showHud(forced.ui, input('centre'), frame, true);
    expect([Object.values(forced.shown).every((text) => text === null), forced.crosshair()]).toEqual([true, false]);
  });
});
