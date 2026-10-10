/**
 * @file Unit tests for camera codes (`engine/gfx/cameras/codes.ts`): every canonical code round-trips through its data
 * and through a camera, a camera's code rebuilds its pose to the code's rounding, the accepted spellings, every
 * malformed code refused with each problem named, and the description in words.
 */
import { describe, expect, it } from 'vitest';
import { describeCamera, formatCameraCode, parseCameraCode, type FreeSpec } from './codes';
import { createFixedCamera } from './fixed';
import { createFlyCamera } from './fly';
import { createOrbitCamera } from './orbit';
import { createCamera } from './place';
import type { Camera, CameraPose } from './pose';
import { createViewCamera } from './presets';

const DEG = Math.PI / 180;

/** Canonical codes: each is what formatting its own data writes. */
const CANONICAL = [
  'cam=iso',
  'cam=threequarter',
  'cam=topdown',
  'cam=brawler',
  'cam=side',
  'cam=iso,45,2',
  'cam=iso,45,2,persp',
  'cam=topdown,0,1.5,1,0.5,-2',
  'cam=brawler,315,0.75,persp',
  'cam=30,40,1,0.5,1',
  'cam=30,40,1.25,1,1.2,3,-4',
  'cam=200,12.5,1,0.5,1,persp',
  'cam3=orbit',
  'cam3=orbit,35,32,17',
  'cam3=orbit,350,10,5,1,0.8,2',
  'cam3=fly',
  'cam3=fly,1,1.7,-4,90,-10,70',
  'cam3=fixed',
  'cam3=fixed,0,3,-6,-179.5,-17.19,50',
];

/** Codes whose camera's state is all in the code, so the camera writes the same code back. */
const WHOLE = CANONICAL.filter((code) => !['cam3=orbit', 'cam3=fly', 'cam3=fixed'].includes(code));

/** Two poses equal to a code's rounding (0.001 m, 0.01°). */
function samePose(a: CameraPose, b: CameraPose) {
  expect(a.projection).toBe(b.projection);
  a.position.forEach((v, i) => expect(Math.abs(v - b.position[i])).toBeLessThan(0.01));
  expect(Math.abs(Math.sin((a.yaw - b.yaw) / 2))).toBeLessThan(1e-3);
  expect(Math.abs(a.pitch - b.pitch)).toBeLessThan(1e-3);
  for (const key of ['fov', 'zoom', 'boost', 'frustumSize'] as const) expect(a[key]).toBeCloseTo(b[key], 2);
}

describe('round trips', () => {
  it.each(CANONICAL)('%s: formatCameraCode(parseCameraCode(code)) is the code', (code) => {
    expect(formatCameraCode(parseCameraCode(code))).toBe(code);
  });

  it.each(WHOLE)('%s: the camera it makes writes it back', (code) => {
    expect(createCamera(code).code()).toBe(code);
  });

  it("a camera's code rebuilds its pose, to the code's rounding", () => {
    const follow = [1.2345, 0, -6.789] as const;
    const cameras: Camera[] = [
      createViewCamera({ view: 'iso', turn: 3 * (Math.PI / 4), zoom: 1.5 }),
      createViewCamera({ view: 'threequarter', projection: 'perspective', target: [1.23456, 0.5, -2.34567] }),
      createViewCamera({ view: 'custom', azimuth: 1.234567, elevation: 0.7654321, boost: 1.17, height: 0.75 }),
      createViewCamera({ view: 'custom', azimuth: -2, elevation: 0.3, boost: 1.4, target: [0.1, 1.2, 3.4], zoom: 2 }),
      createOrbitCamera({ azimuth: -1.11111, elevation: 0.55555, distance: 12.3456 }),
      createOrbitCamera({ azimuth: 4, elevation: 1.2, distance: 3, target: [7.777, 1, -2.222] }),
      createFlyCamera({ position: [1.11111, 2.22222, 3.33333], yaw: 4.4, pitch: -0.666, fov: 66.666 }),
      createFixedCamera({ position: [-9.87654, 3.21, 0.0004], yaw: -3.1, pitch: 1.2, fov: 33.333 }),
    ];
    for (const camera of cameras) {
      camera.update({ follow, look: [0.123, -0.0456], zoom: 1, turnSteps: 1 }, 0.25);
      const twin = createCamera(camera.code());
      twin.update({ follow }, 0);
      camera.update({ follow }, 60); // both settled on the followed point
      twin.update({ follow }, 60);
      expect(twin.type).toBe(camera.type);
      samePose(twin.pose(), camera.pose());
      expect(twin.code()).toBe(camera.code());
    }
  });
});

describe('parseCameraCode', () => {
  it('reads the key, a leading ?, or a bare value, and gives SI data', () => {
    expect(parseCameraCode('?cam=iso')).toEqual({ type: 'view', view: 'iso' });
    expect(parseCameraCode('iso,90,2')).toEqual({ type: 'view', view: 'iso', turn: 90 * DEG, zoom: 2 });
    expect(parseCameraCode('cam=iso,ortho')).toEqual({ type: 'view', view: 'iso', projection: 'orthographic' });
    expect(parseCameraCode(' orbit ')).toEqual({ type: 'orbit' });
    expect(parseCameraCode('30,40,1,0.5,1')).toEqual({
      type: 'view',
      view: 'custom',
      azimuth: 30 * DEG,
      elevation: 40 * DEG,
      zoom: 1,
      boost: 1,
      height: 0.5,
    });
    const fixed = parseCameraCode('cam3=fixed,1,2,3,270,-10') as FreeSpec;
    expect(fixed).toMatchObject({ type: 'fixed', position: [1, 2, 3] });
    expect(fixed.yaw).toBeCloseTo(270 * DEG, 12);
    expect(formatCameraCode(fixed)).toBe('cam3=fixed,1,2,3,-90,-10,70'); // the heading wrapped, the default lens written
    expect(formatCameraCode(parseCameraCode('cam=iso,405,1'))).toBe('cam=iso,45,1');
  });

  it('names an unknown camera with the closest names', () => {
    expect(() => parseCameraCode('cam=isso')).toThrow(
      /\[GFX_UNKNOWN_CAMERA\] "isso" is not a camera \(did you mean "iso"\?\)/,
    );
    expect(() => parseCameraCode('cam3=chase')).toThrow(/"chase" is not a camera.*use one of iso, threequarter/);
  });

  it.each([
    ['cam=iso,,2', /it has an empty part/],
    ['cam=', /it has an empty part/],
    ['cam=iso,45', /a view \(iso\[, turn, zoom\[, x, y, z\]\]\) takes 0, 2, 5 numbers, not 1/],
    ['cam=iso,45,x', /part 3 \(x\) is not a number/],
    ['cam=orbit', /orbit is a 3D camera: write cam3=orbit/],
    ['cam3=iso', /the view iso belongs in cam=/],
    ['cam3=30,40,1,0.5,1', /a custom view belongs in cam=/],
    ['cam3=orbit,10,95,5', /elevation is 95; it must be from 0 to 90/],
    ['cam3=fly,0,0,0,0,0,persp', /,persp belongs to cam= views/],
    ['cam=30,40,0,1,1', /zoom is 0; it must be from 0.1 to 10/],
    ['cam=custom,1', /a custom view is written as numbers/],
    ['cam3=fixed,0,0,0,0,100', /pitch is 100/],
    ['cam3=fly,0,0', /a fly camera \(fly\[, x, y, z, yaw, pitch\[, fov\]\]\) takes 0, 5, 6 numbers, not 2/],
  ])('refuses %s', (code, problem) => {
    expect(() => parseCameraCode(code)).toThrow(/^\[GFX_BAD_CAMERA_CODE\] /);
    expect(() => parseCameraCode(code)).toThrow(problem);
  });

  it('lists every problem at once', () => {
    expect(() => parseCameraCode('cam3=orbit,1,200,0')).toThrow(/elevation is 200.*; distance is 0/);
  });
});

describe('describeCamera', () => {
  it('puts each camera in words, as the prototype did', () => {
    expect(describeCamera(parseCameraCode('cam=iso'))).toBe('Isometric view, orthographic, zoom 1x, following');
    expect(createCamera('cam=threequarter,45,2,persp').describe()).toBe(
      'Three-quarter view, perspective, 40° field of view, height boost 1.35x, zoom 2x, turned 45°, following',
    );
    expect(createCamera('cam=topdown,0,1,1,0,2').describe()).toBe(
      'Top-down view, orthographic, height boost 1.3x, zoom 1x, fixed on (1, 0, 2)',
    );
    expect(createCamera('cam=30,40,1,0.5,1.2').describe()).toBe(
      'Custom view (turned 30°, tilted 40°), orthographic, height boost 1.2x, zoom 1x, following',
    );
    expect(createCamera('cam3=orbit,35,32,17').describe()).toBe(
      'Orbit camera (perspective, 35° field of view), 17 m from its target, turned 35°, tilted 32°, following',
    );
    expect(createCamera('cam3=fly,1,1.7,-4,90,-10,70').describe()).toBe(
      'Fly camera (perspective, 70° field of view) at (1, 1.7, -4), heading 90°, pitch -10°',
    );
    expect(describeCamera({ type: 'fixed' })).toBe('Fixed camera (perspective, 70° field of view)');
  });
});
