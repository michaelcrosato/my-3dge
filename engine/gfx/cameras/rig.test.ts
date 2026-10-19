/**
 * @file Unit tests for the camera rig (engine/gfx/cameras/rig.ts): a switch cuts unless it asks for a blend; a blend
 * starts at the old camera's picture, is halfway at half its time, ends at the new one's and says what it moved; a view's
 * turn swings round its target; the effects reach the camera that takes them, mixed through a blend; the options from
 * the view settings `cam.*` give first person and the shooter the player's lens and the views whole zoom steps.
 * @see engine/gfx/cameras/rig.ts
 */
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../core/registry';
import { createSettings, defineSettings } from '../../core/settings';
import { BLEND_TIME } from './blend';
import { apexFov, EFFECTS, type CameraPlayer } from './effects';
import { poseTarget } from './pose';
import { CAMERA_SETTING_FIELDS, createCameraRig, rigOptions } from './rig';

const at = { follow: [0, 0, 0] as const };
const far = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((v, i) => v - b[i]));

describe('the camera rig', () => {
  it('cuts on a switch unless it asks for a blend', () => {
    const rig = createCameraRig('cam=iso');
    rig.update(at, 1 / 60);
    rig.set('cam3=first');
    expect(rig.update(at, 1 / 60).projection).toBe('perspective');
    expect(rig.blend().weight).toBe(1);
  });

  it('blends from the old camera’s picture to the new one’s over its time, saying what it moved', () => {
    const rig = createCameraRig('cam3=first');
    const first = rig.update(at, 1 / 60);
    rig.set('cam3=shoulder', { blend: true });
    expect(rig.update(at, 0)).toEqual(first);
    const half = rig.update(at, BLEND_TIME / 2);
    expect(rig.blend().weight).toBeCloseTo(0.5, 9);
    expect(rig.blend().move).toBeCloseTo(far(half.position, first.position), 6);
    const end = rig.update(at, BLEND_TIME);
    expect(end).toEqual(rig.camera.pose());
    expect(rig.blend().weight).toBe(1);
    expect(rig.firstShare()).toBe(0);
  });

  it('swings a view round its target when it turns', () => {
    const rig = createCameraRig('cam=iso');
    const before = rig.update(at, 1 / 60);
    const turning = rig.update({ ...at, turnSteps: 2 }, 1 / 60);
    expect(rig.blend().weight).toBeLessThan(0.1);
    expect(far(poseTarget(turning), poseTarget(before))).toBeLessThan(1e-6);
    for (let k = 0; k < 30; k++) rig.update(at, 1 / 60);
    expect(rig.pose().yaw).toBeCloseTo(before.yaw + Math.PI / 2, 6); // 90° round: Q and E's turn
  });

  it('gives first person the sprint’s drop, and the views none', () => {
    const sprint: CameraPlayer = { velocity: [0, 0, 7.6], grounded: true, mode: 'ground', sprinting: true, sliding: false, boosted: false, aiming: false }; // prettier-ignore
    const eye = { follow: [0, 0, 0] as const, eye: [0, 1.524, 0] as const };
    const first = createCameraRig('cam3=first');
    const iso = createCameraRig('cam=iso');
    for (let k = 0; k < 120; k++) {
      for (const rig of [first, iso]) {
        rig.step(sprint);
        rig.update(eye, 1 / 60);
      }
    }
    expect(first.pose().position[1]).toBeCloseTo(1.524 - EFFECTS.sprintDrop + first.effects()!.bob[1], 4);
    expect(iso.pose()).toEqual(iso.camera.pose());
    first.configure({ effects: false });
    expect(first.update(eye, 1 / 60).position[1]).toBeCloseTo(1.524, 6);
  });

  it('takes its options from the view settings: the player’s lens, the blend, whole zoom steps', () => {
    const registry = createRegistry();
    defineSettings(CAMERA_SETTING_FIELDS, registry);
    const settings = createSettings({ registry });
    settings.set('cam.wholeZoom', true);
    const options = rigOptions((path) => settings.get(path));
    expect(options).toEqual({ blend: BLEND_TIME, effects: true, lens: apexFov(90), zooms: [1, 2, 3, 4] });
    const rig = createCameraRig('cam3=shoulder', options);
    expect(rig.update(at, 1 / 60).fov).toBeCloseTo(apexFov(90), 9);
    const iso = createCameraRig('cam=iso', options);
    iso.update({ ...at, zoom: 1 }, 1 / 60);
    expect(iso.camera.pose().zoom).toBe(2);
  });
});
