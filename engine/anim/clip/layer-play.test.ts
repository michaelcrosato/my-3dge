/**
 * @file Tests for the clip layer's play options (WP 8.4; the rest of the layer is in layer.test.ts): `speed` (the
 * clip's time, its events and its end that much sooner), `at` (it starts there, past the events before it), `loop`
 * over the clip's own (a one-shot looped: its events every lap, no end, the body posed at the lap's time; a loop
 * played once with `hold`: one end, held at its last pose) and the layer's `blade` (the held blade's tip kept above
 * the floor, as retargetPose keeps it).
 */
import { describe, expect, it } from 'vitest';
import { MathUtils, Vector3 } from '../../core/math';
import { Animator } from '../character';
import { jointRotation, socketPosition } from '../fk';
import { createSkeleton } from '../skeleton';
import { REST, standing } from '../../../tests/unit/anim/clip-fixtures';
import { legsHeld } from './clipsets';
import { ClipLayer, type ClipLayerEvent } from './layer';
import { loadClipLibrary } from './library';
import type { ClipKey } from './readable';
import { RETARGET, retargetPose } from './retarget';

const raise = (t: number, up: number): ClipKey => ({ ...standing(t), armR: [20, 40, up, 10, 0] });
/** Crouched, the right arm ahead and the blade pointing down through the floor (retarget.test.ts's). */
const guard = (t: number): ClipKey => ({ ...standing(t), hips: [0, 0, 55], legL: [70, 0, -50, 100, 0], legR: [70, 0, -50, 100, 0], armR: [100, 0, -40, 0, 0], blade: [30, 30, -100] }); // prettier-ignore
// Swing's event and end fall between ticks at speeds 1 and 2 (0.19 s, 0.49 s), so float sums never move them a tick
const library = loadClipLibrary({
  set: 'TEST',
  sources: { A: { rest: REST } },
  clips: {
    Swing: { src: 'A', dur: 0.49, keys: [raise(0, -100), raise(0.25, 100), raise(0.49, -100)], events: [{ t: 0.19, name: 'step', side: 'L' }] }, // prettier-ignore
    Sway: { src: 'A', dur: 1, loop: true, keys: [standing(0), raise(0.5, -60), standing(1)] },
    Guard: { src: 'A', dur: 1, keys: [guard(0), guard(1)] },
  },
});
const heroic = createSkeleton('build:heroic');
const layerOf = (blade?: number) => new ClipLayer({ library, build: 'build:heroic', blade });
/** A heroic animator posed with `layer`, standing still at the origin. */
const heroOf = (layer: ClipLayer) => new Animator({ build: 'build:heroic', clock: 0 }).use('clips', layer);
/** `n` ticks of `layer`, the events of all of them. */
function run(layer: ClipLayer, n: number): ClipLayerEvent[] {
  return Array.from({ length: n }, () => [...layer.step()]).flat(); // `step` reuses its array
}
const step: ClipLayerEvent = { type: 'event', clip: 'TEST/Swing', name: 'step', side: 'L' };

describe('the play options', () => {
  it('holds the legs as a full clip’s fade shows, a masked one by its thighs, an added one not at all', () => {
    const held = (play: Record<string, unknown>, ticks = 30) => {
      const layer = layerOf().play('TEST/Sway', play);
      run(layer, ticks);
      return [legsHeld(layer), layer.current!.w];
    };
    expect(legsHeld(layerOf())).toBe(0); // idle
    const [half, w] = held({ fade: 0.2 }, 6);
    expect([half, w > 0.2 && w < 0.8]).toEqual([MathUtils.smoothstep(w, 0, 1), true]);
    expect([held({ mask: 'legL' })[0], held({ mask: 'arms' })[0], held({ additive: true })[0]]).toEqual([1, 0, 0]);
  });

  it('plays at `speed`: its time runs that much faster, its event and its end come at half the ticks', () => {
    const fast = layerOf().play('Swing', { fade: 0, speed: 2 });
    run(fast, 9);
    expect(fast.current).toMatchObject({ t: expect.closeTo((2 * 9) / 60, 9), rate: 2 });
    /** The tick (from 1) on which each kind of event first comes, Swing played at `speed`. */
    const ticks = (speed: number) => {
      const layer = layerOf().play('Swing', { fade: 0, speed });
      const at: Record<string, number> = {};
      for (let i = 1; i <= 40; i++) for (const e of layer.step()) at[e.type] ??= i;
      return at;
    };
    expect([ticks(1), ticks(2)]).toEqual([
      { event: 12, end: 30 }, // the first ticks past 0.19 s and 0.49 s
      { event: 6, end: 15 },
    ]);
  });

  it('starts at `at`, past an event before it', () => {
    const layer = layerOf().play('Swing', { fade: 0, at: 0.3 });
    expect(run(layer, 1)).toEqual([]);
    expect(layer.current!.t).toBeCloseTo(0.3 + 1 / 60, 9);
    expect(run(layer, 10)).toEqual([]); // 0.48 s: its step at 0.19 s is behind it
    expect(run(layer, 1)).toEqual([{ type: 'end', clip: 'TEST/Swing' }]);
  });

  it('loops a one-shot played with `loop`, and plays a loop once with `loop: false`, its last pose held', () => {
    const looped = layerOf().play('Swing', { fade: 0, loop: true });
    const hero = heroOf(looped);
    expect(run(looped, 75)).toEqual([step, step, step]); // at 0.19, 0.68 and 1.17 s, and no end
    hero.step().pose();
    const [swing, t] = [library.bake('Swing'), looped.current!.t]; // 1.25 s: 0.27 s into its third lap
    expect(hero.body.pose.equals(retargetPose({ ...swing, loop: true }, t, heroic))).toBe(true);
    expect(hero.body.pose.equals(retargetPose(swing, t, heroic))).toBe(false); // not its last pose
    const once = layerOf().play('Sway', { fade: 0, loop: false, hold: true });
    const held = heroOf(once);
    expect(run(once, 90)).toEqual([{ type: 'end', clip: 'TEST/Sway' }]);
    expect(once.current).toMatchObject({ t: 1, w: 1 }); // held at its end
    held.step().pose();
    const sway = library.bake('Sway');
    expect(held.body.pose.equals(retargetPose({ ...sway, loop: false }, 1, heroic))).toBe(true);
    expect(held.body.pose.equals(retargetPose(sway, 1.5, heroic))).toBe(false); // not where a second lap would be
  });

  it('keeps the held blade’s tip above the floor in a layer made with `blade`, as retargetPose does', () => {
    const length = 1.1;
    const [bare, armed] = [undefined, length].map((blade) => {
      const layer = layerOf(blade).play('Guard', { fade: 0 });
      const hero = heroOf(layer);
      layer.step();
      const { skeleton, world } = hero.step().pose().body;
      const grip = socketPosition(skeleton, world, 'weaponR');
      return new Vector3(0, 0, 1).applyQuaternion(jointRotation(world, 'handR')).multiplyScalar(length).add(grip).y;
    });
    expect(bare).toBeLessThan(-0.1); // the clip's blade goes through the floor
    expect(Math.abs(armed - RETARGET.bladeFloor)).toBeLessThan(1e-4); // its own margin over the floor
  });
});
