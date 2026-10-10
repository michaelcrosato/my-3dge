/**
 * @file Unit tests for the classic views (`engine/gfx/cameras/presets.ts`): each view's position, look direction and
 * orthographic frame size, the perspective lens framing the same height, zoom steps, 45° turns (never for the side
 * view), the follow's snap, lag and fixed target, custom views, and the errors that name the fix.
 */
import { describe, expect, it } from 'vitest';
import { PIXEL_LINES } from '../resolution';
import { VIEW_NAMES } from './codes';
import { frameSize, poseForward, poseTarget, type Vec3 } from './pose';
import {
  createViewCamera,
  ORTHO_DISTANCE,
  stepView,
  stepZoom,
  VIEW_FOV,
  VIEW_LAG,
  VIEW_LIFT,
  VIEW_PRESETS,
  viewPose,
  viewState,
} from './presets';

const DEG = Math.PI / 180;
const close = (a: readonly number[], b: readonly number[], digits = 9) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

describe('the classic views', () => {
  it("keep the 2D engine's angles, scales and boosts", () => {
    expect(VIEW_PRESETS.iso).toMatchObject({ azimuth: 45 * DEG, elevation: 30 * DEG, boost: 1 });
    expect(VIEW_PRESETS.iso.pixelsPerMetre).toBeCloseTo(16 * Math.SQRT2, 12);
    expect(VIEW_PRESETS.threequarter).toMatchObject({
      azimuth: 0,
      elevation: 55 * DEG,
      pixelsPerMetre: 24,
      boost: 1.35,
    });
    expect(VIEW_PRESETS.topdown).toMatchObject({ elevation: 80 * DEG, boost: 1.3 });
    expect(VIEW_PRESETS.brawler).toMatchObject({ elevation: 25 * DEG, boost: 1 });
    expect(VIEW_PRESETS.side).toMatchObject({ elevation: 0, flat: true });
  });

  it('stand at their azimuth and elevation round the target, look at it, and frame PIXEL_LINES lines', () => {
    const target: Vec3 = [3, 0, -2];
    for (const view of VIEW_NAMES) {
      const preset = VIEW_PRESETS[view];
      const pose = createViewCamera({ view, target }).pose();
      expect(pose.projection).toBe('orthographic');
      expect(pose.distance).toBe(ORTHO_DISTANCE);
      close(poseTarget(pose), target);
      const back = pose.position.map((v, i) => (v - target[i]) / ORTHO_DISTANCE);
      const c = Math.cos(preset.elevation);
      close(back, [Math.sin(preset.azimuth) * c, Math.sin(preset.elevation), Math.cos(preset.azimuth) * c]);
      close(
        poseForward(pose),
        back.map((v) => -v),
      );
      expect(pose.boost).toBe(preset.boost);
      expect(pose.frustumSize).toBeCloseTo(PIXEL_LINES / preset.pixelsPerMetre, 12);
    }
  });

  it('iso: the camera at +X +Z, 30° up, looking toward −X −Z; ortho frames 330 lines at 16√2 px/m', () => {
    const pose = createViewCamera({ view: 'iso', target: [0, 0, 0] }).pose();
    expect(pose.position[0]).toBeGreaterThan(0);
    expect(pose.position[2]).toBeCloseTo(pose.position[0], 9);
    expect(pose.pitch).toBeCloseTo(-30 * DEG, 12);
    expect(pose.yaw).toBeCloseTo(-135 * DEG, 12);
    expect(frameSize(pose, 16 / 9).height).toBeCloseTo(330 / (16 * Math.SQRT2), 12);
    expect(frameSize({ ...pose, zoom: 2 }, 16 / 9).height).toBeCloseTo(330 / (32 * Math.SQRT2), 12);
  });

  it('perspective: as far back as the lens frames the same height at the target; zoom narrows the lens', () => {
    const ortho = createViewCamera({ view: 'threequarter', target: [0, 0, 0], zoom: 1.5 }).pose();
    const persp = createViewCamera({
      view: 'threequarter',
      target: [0, 0, 0],
      zoom: 1.5,
      projection: 'perspective',
    }).pose();
    expect(persp.projection).toBe('perspective');
    expect(persp.fov).toBe(VIEW_FOV);
    expect(persp.distance).toBeCloseTo(PIXEL_LINES / 24 / 2 / Math.tan(20 * DEG), 9);
    expect(frameSize(persp, 1).height).toBeCloseTo(frameSize(ortho, 1).height, 9);
    close(poseForward(persp), poseForward(ortho), 12);
  });

  it('the side view stays orthographic and never turns; others turn in 45° steps', () => {
    const side = createViewCamera({ view: 'side', projection: 'perspective', turn: Math.PI / 4, target: [0, 0, 0] });
    expect(side.pose().projection).toBe('orthographic');
    expect(side.yaw()).toBeCloseTo(Math.PI, 12); // still looking along −Z
    const iso = createViewCamera({ view: 'iso', target: [0, 0, 0] });
    const turned = iso.update({ turnSteps: 2 });
    expect(turned.yaw).toBeCloseTo(-45 * DEG, 12); // azimuth 135°: from the +X −Z side it looks toward −X +Z
    expect(iso.update({ turnSteps: 6 }).yaw).toBeCloseTo(-135 * DEG, 12); // a full turn
    expect(iso.code()).toBe('cam=iso,0,1,0,0,0');
  });
});

describe('stepView', () => {
  it('snaps to the first follow, then lags with a time constant of VIEW_LAG seconds', () => {
    let state = viewState({ view: 'brawler' });
    expect(viewPose(state).position).toEqual(viewPose({ ...state, target: [0, VIEW_LIFT, 0] }).position);
    state = stepView(state, { follow: [1, 0, 1] }, 1 / 60);
    expect(state.target).toEqual([1, VIEW_LIFT, 1]);
    state = stepView(state, { follow: [2, 0, 1] }, VIEW_LAG);
    expect(state.target?.[0]).toBeCloseTo(1 + (1 - Math.exp(-1)), 12);
    // the same real time in many frames moves the target as far
    let small = viewState({ view: 'brawler', target: undefined });
    small = stepView(small, { follow: [1, 0, 1] }, 0);
    for (let i = 0; i < 18; i++) small = stepView(small, { follow: [2, 0, 1] }, VIEW_LAG / 18);
    expect(small.target?.[0]).toBeCloseTo(state.target?.[0] ?? 0, 12);
  });

  it('a fixed view ignores the follow; a view that starts on a target lags from it', () => {
    const fixed = createViewCamera({ view: 'topdown', target: [5, 0, 5] });
    fixed.update({ follow: [0, 0, 0] }, 1);
    close(poseTarget(fixed.pose()), [5, 0, 5]);
    const started = createViewCamera({ view: 'topdown', start: [5, 0, 5] });
    started.update({ follow: [0, 0, 0] }, VIEW_LAG);
    expect(poseTarget(started.pose())[0]).toBeCloseTo(5 * Math.exp(-1), 9);
  });

  it('zoom steps through VIEW_ZOOMS and stops at either end', () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -2)).toBe(0.5);
    expect(stepZoom(3, 1)).toBe(3);
    expect(stepZoom(0.5, -1)).toBe(0.5);
    expect(stepZoom(1.1, 0)).toBe(1.25); // between steps: the next one up
    expect(stepZoom(9, -1)).toBe(2.5);
    const view = createViewCamera({ view: 'iso' });
    expect(view.update({ zoom: 2 }).zoom).toBe(1.5);
  });

  it('returns a new state and leaves the old one as it was (pure)', () => {
    const state = viewState({ view: 'iso' });
    const copy = structuredClone(state);
    const next = stepView(state, { follow: [1, 2, 3], zoom: 1, turnSteps: 1 }, 0.1);
    expect(next).not.toBe(state);
    expect(state).toEqual(copy);
  });
});

describe('custom views and errors', () => {
  it('a custom view takes its azimuth, elevation, boost and height; its turn folds into its code', () => {
    const custom = createViewCamera({ view: 'custom', azimuth: 30 * DEG, elevation: 40 * DEG, boost: 1.2, height: 1 });
    custom.update({ follow: [0, 0, 0] });
    close(poseTarget(custom.pose()), [0, 1, 0]);
    expect(custom.pose()).toMatchObject({ boost: 1.2, pitch: -40 * DEG });
    expect(custom.code()).toBe('cam=30,40,1,1,1.2');
    custom.update({ turnSteps: 1 });
    expect(custom.code()).toBe('cam=75,40,1,1,1.2');
    expect(createViewCamera({ view: 'custom' }).pose().pitch).toBeCloseTo(-40 * DEG, 12); // the prototype's default
  });

  it('refuses an unknown view with the closest, angles on a preset, and numbers out of range', () => {
    expect(() => createViewCamera({ view: 'isso' as 'iso' })).toThrow(
      /\[GFX_UNKNOWN_CAMERA\] "isso" is not a camera \(did you mean "iso"\?\)/,
    );
    expect(() => createViewCamera({ view: 'iso', azimuth: 1 })).toThrow(/azimuth belong to custom views/);
    expect(() => createViewCamera({ view: 'iso', zoom: 0 })).toThrow(/\[GFX_BAD_CAMERA\] the iso view: zoom is 0/);
    expect(() => createViewCamera({ view: 'custom', elevation: 2 })).toThrow(/elevation is 2; it must be from 0/);
    expect(() => createViewCamera({ view: 'iso', target: [0, 0] as unknown as Vec3 })).toThrow(/target is \[0,0\]/);
  });
});
