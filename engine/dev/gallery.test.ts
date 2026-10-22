/**
 * @file Unit tests for the gallery's frames and deep links (engine/dev/gallery.ts; WP 7.7), in Node: each kind's
 * entries give the frames their `gallery` field asks for (a prop's turntable, a body's states, a move's moments, an
 * emitter's times after its burst, a look's set in that look); a deep link names an entry, a kind's first or the first
 * kind's, and a wrong name warns with the valid ones and shows the first; a fitted camera frames the subject's bounds.
 * @see engine/dev/gallery.ts
 */
import { describe, expect, it } from 'vitest';
import '../anim/moves-data';
import { createLog } from '../core/log';
import { Box3, Vector3 } from '../core/math';
import { registry } from '../core/registry';
import { parseCameraCode } from '../gfx/cameras/codes';
import '../gfx/fx/emitters';
import '../gfx/materials/material';
import '../gfx/post/looks';
import '../gfx/puppets/grammar';
import '../world/props/prop';
import { burstLife, fitCamera, galleryFrames, galleryKindsOf, galleryRoute, galleryStart } from './gallery';

/** A log that keeps its advice to itself. */
const quiet = () => createLog({ console: { warn: () => {}, error: () => {} } });

describe('the gallery’s frames', () => {
  it('films the six kinds that need review', () => {
    expect(galleryKindsOf()).toEqual(['body', 'emitter', 'look', 'material', 'move', 'prop']);
  });

  it('turns a prop round, and shows a material and a look once, the look drawn in itself', () => {
    expect(galleryFrames('prop', 'prop:crate').map((f) => [f.label, f.view, f.steps])).toEqual([
      ['prop:crate 30°', 30, 30],
      ['prop:crate 120°', 120, 30],
      ['prop:crate 210°', 210, 30],
      ['prop:crate 300°', 300, 30],
    ]);
    expect(galleryFrames('material', 'material:brick')).toEqual([
      { label: 'material:brick', state: '', steps: 1, at: 0, view: 30, settings: {} },
    ]);
    expect(galleryFrames('look', 'look:cartoon').map((f) => [f.label, f.settings])).toEqual([['look:cartoon', { 'post.look': 'look:cartoon' }]]); // prettier-ignore
  });

  it('stands a body in each of its states, held as long as each needs', () => {
    const frames = galleryFrames('body', 'body:humanoid');
    expect(frames.map((f) => [f.state, f.steps])).toEqual([
      ['idle', 36],
      ['walk', 48],
      ['run', 36],
      ['guard', 30],
      ['cast', 30],
      ['kneel', 60],
      ['hurt', 12],
      ['knockedDown', 60],
    ]);
    expect(frames[2].label).toBe('body:humanoid run');
  });

  it('shoots a move at its phases’ ends, and an emitter in each quarter of its burst', () => {
    expect(galleryFrames('move', 'move:slash').map((f) => [f.label, f.state, f.at])).toEqual([
      ['move:slash 0.08 s', '', 0.08], // drawn back: the wind-up's end
      ['move:slash 0.18 s', '', 0.18], // struck, its trail whole: the strike's end
      ['move:slash 0.29 s', '', 0.29], // half through the follow-through
      ['move:slash 0.4 s', '', 0.4], // at rest again
    ]);
    expect(galleryFrames('emitter', 'emitter:sparks').map((f) => [f.label, f.at])).toEqual([
      ['emitter:sparks 0.05 s', 0.05], // while every spark lives (0.4 to 1 s each)
      ['emitter:sparks 0.15 s', 0.15],
      ['emitter:sparks 0.25 s', 0.25],
      ['emitter:sparks 0.35 s', 0.35],
    ]);
    // A burst of layers lasts while its longest-lived layer does: the explosion's smoke, the shot's three sparks.
    expect(['emitter:explosion', 'emitter:shot', 'emitter:snow'].map((id) => burstLife(id))).toEqual([2.2, 0.1, 6]);
  });
});

describe('the gallery’s deep links', () => {
  it('names an entry, a kind’s first entry, or the first kind’s, and the settings its page starts with', () => {
    expect(galleryRoute('#gallery/prop/prop:crate')).toEqual({ kind: 'prop', id: 'prop:crate' });
    expect(galleryRoute('#gallery/material')).toEqual({ kind: 'material', id: registry.list('material')[0].id });
    expect(galleryRoute('#gallery')).toEqual({ kind: 'body', id: 'body:humanoid' });
    expect(galleryRoute('#scene=room')).toBeNull();
    expect(galleryStart({ kind: 'look', id: 'look:cartoon' })).toEqual({
      'gallery.kind': 'look',
      'gallery.subject': 'look:cartoon',
      'gallery.state': '',
      'post.look': 'look:cartoon',
    });
  });

  it('warns about a wrong kind or id with the valid names, and shows the first instead', () => {
    const log = quiet();
    expect(galleryRoute('#gallery/props/prop:crate', registry, log)).toEqual({ kind: 'body', id: 'body:humanoid' });
    expect(galleryRoute('#gallery/prop/prop:crat', registry, log)).toEqual({ kind: 'prop', id: 'prop:banner' });
    expect(log.advice.map((a) => a.message)).toEqual([
      'the gallery has no kind "props" (did you mean "prop"?); it shows body instead',
      'the gallery has no prop "prop:crat" (did you mean "prop:crate", "prop:chair" or "prop:chest"?); it shows prop:banner instead',
    ]);
    expect(log.advice[0].fix).toBe('use one of: body, emitter, look, material, move, prop');
  });
});

describe('a fitted camera', () => {
  /** Where a fixed camera's code stands and the point 1 m along its line of sight. */
  const sight = (code: string) => {
    const spec = parseCameraCode(code) as { type: string; position: number[]; yaw: number; pitch: number; fov: number };
    const look = [Math.sin(spec.yaw) * Math.cos(spec.pitch), Math.sin(spec.pitch), Math.cos(spec.yaw) * Math.cos(spec.pitch)]; // prettier-ignore
    return { ...spec, ahead: (d: number) => spec.position.map((v, k) => v + d * look[k]) };
  };

  it('stands 25° up at its azimuth, looking at the subject’s middle from far enough to hold it', () => {
    const box = new Box3(new Vector3(7.5, 0, 7.5), new Vector3(8.5, 1, 8.5)); // a 1 m cube in the middle
    const camera = sight(fitCamera(30, box));
    const distance = (1.15 * Math.sqrt(3)) / 2 / Math.sin((17.5 * Math.PI) / 180);
    expect([camera.type, camera.fov]).toEqual(['fixed', 35]);
    camera.ahead(distance).forEach((v, k) => expect(v).toBeCloseTo([8, 0.5, 8][k], 2)); // it looks at the middle
    expect(camera.position[2]).toBeGreaterThan(8); // from the front (+Z), a little to the east (30° toward +X)
    expect(Math.atan2(camera.position[1] - 0.5, Math.hypot(camera.position[0] - 8, camera.position[2] - 8))).toBeCloseTo((25 * Math.PI) / 180, 3); // prettier-ignore
  });

  it('comes as near as a small thing needs, holds the middle when nothing is drawn; a code is drawn as written', () => {
    const plate = new Box3(new Vector3(7.95, 1.15, 7.99), new Vector3(8.05, 1.25, 8.01)); // a switch's plate
    const near = sight(fitCamera(30, plate));
    expect(Math.hypot(near.position[0] - 8, near.position[1] - 1.2, near.position[2] - 8)).toBeLessThan(0.6);
    const empty = sight(fitCamera(120, new Box3()));
    empty.ahead(Math.hypot(...empty.position.map((v, k) => v - [8, 0, 8][k]))).forEach((v, k) => expect(v).toBeCloseTo([8, 0, 8][k], 2)); // prettier-ignore
    expect(fitCamera('cam=iso', plate)).toBe('cam=iso');
  });
});
