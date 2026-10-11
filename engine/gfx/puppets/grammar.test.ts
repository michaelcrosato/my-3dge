/**
 * @file Unit tests for the body grammar (engine/gfx/puppets/grammar.ts): the kind `body` and its stand-in
 * `body:humanoid`, mirroring (names, points, parts and their `on` bone), and every problem a definition names: an
 * unknown part type, the wrong number of arguments, a point that is no joint or socket, a slot the body lacks, a size
 * that is not positive, a count outside 1–64, bad options, colours and builds. The fixture `body:everyPart`
 * (fixtures/bodies/everyPart.ts) defines cleanly.
 * @see engine/gfx/puppets/grammar.ts
 */
import { describe, expect, it } from 'vitest';
import { defineEveryPart, EVERY_PART } from '../../../fixtures/bodies/everyPart';
import { createLog } from '../../core/log';
import { createRegistry, registry as sharedRegistry } from '../../core/registry';
import { HUMANOID_BODY } from './bodies/humanoid';
import {
  defineBody,
  getBody,
  mirrorName,
  mirrorPart,
  mirrorPoint,
  pointProblem,
  type BodyPart,
  type BodySpec,
} from './grammar';

/** Defining `spec` on a fresh registry: the error's message, or '' when it defines. */
function problems(spec: BodySpec): string {
  try {
    defineBody('body:test', spec, createRegistry());
    return '';
  } catch (error) {
    return String((error as Error).message);
  }
}

const slots = { skin: '#ffccaa' };

describe('the kind', () => {
  it('registers body:humanoid on the shared registry, and on any other on first use', () => {
    const humanoid = getBody('body:humanoid');
    expect(humanoid.slots.skin).toBe('#f1c7a0');
    expect(humanoid.mirror).toHaveLength(HUMANOID_BODY.mirror!.length);
    expect(sharedRegistry.kinds()).toContain('body');
    const reg = createRegistry();
    expect(getBody('body:humanoid', reg).parts).toEqual(HUMANOID_BODY.parts);
  });

  it('stands body:humanoid in for a missing id, with a warning naming the id', () => {
    const printed: string[] = [];
    const reg = createRegistry({
      log: createLog({ console: { warn: (line) => printed.push(line), error: () => {} } }),
    });
    expect(getBody('body:humanoidd', reg).id).toBe('body:humanoid');
    expect(printed[0]).toMatch(/CORE_UNKNOWN_ID.*body:humanoidd/);
  });

  it('defines a body with its defaults, and refuses a second definition of the same id', () => {
    const reg = createRegistry();
    const body = defineBody('body:stick', { slots, parts: [['limb', 'thighL', 'shinL', 0.05, 0.04, 'skin']] }, reg);
    expect([body.material, body.glowMaterial, body.limbRadius, body.torsoRadius]).toEqual([
      'material:puppet',
      'material:puppetGlow',
      0.0625,
      0.1875,
    ]);
    expect(body.mirror).toEqual([]);
    expect(() => defineBody('body:stick', { slots }, reg)).toThrow(/CORE_DUPLICATE_ID/);
  });

  it('defines the fixture body, with one part of every type', () => {
    const body = defineEveryPart(createRegistry());
    const types = new Set([...body.parts, ...body.mirror].map((part) => part[0]));
    expect([...types].sort()).toEqual(['ball', 'blade', 'box', 'cape', 'cone', 'curve', 'eye', 'hair', 'limb']);
    expect(body.mirror).toHaveLength(EVERY_PART.mirror!.length);
  });
});

describe('mirroring', () => {
  it('swaps the sides of names that have both, and keeps the others', () => {
    expect([mirrorName('thighL'), mirrorName('handR'), mirrorName('eyeL'), mirrorName('weaponR')]).toEqual([
      'thighR',
      'handL',
      'eyeR',
      'weaponL',
    ]);
    expect([mirrorName('pelvis'), mirrorName('headTop'), mirrorName('back')]).toEqual(['pelvis', 'headTop', 'back']);
  });

  it('negates right offsets in [f, r, u] and off, and mirrors lerp ends', () => {
    expect(mirrorPoint([0.1, 0.2, 0.3])).toEqual([0.1, -0.2, 0.3]);
    expect(mirrorPoint([0, [0.5, 'limb'], 0])).toEqual([0, [-0.5, 'limb'], 0]);
    expect(mirrorPoint(['off', 'shinL', 0.01, 0.02, 0.03])).toEqual(['off', 'shinR', 0.01, -0.02, 0.03]);
    expect(mirrorPoint(['lerp', 'shinL', 'footL', 0.6])).toEqual(['lerp', 'shinR', 'footR', 0.6]);
  });

  it('mirrors a part: its points and its on bone, never its sizes or slot', () => {
    const left: BodyPart = ['limb', 'thighL', ['off', 'shinL', 0, 0.02, 0], 0.07, 0.06, 'pants', { on: 'thighL' }];
    expect(mirrorPart(left)).toEqual([
      'limb',
      'thighR',
      ['off', 'shinR', 0, -0.02, 0],
      0.07,
      0.06,
      'pants',
      { on: 'thighR' },
    ]);
    expect(mirrorPart(['hair', 'eyeL', 0.1, 3, 0.1, 0.01, 'skin'])).toEqual([
      'hair',
      'eyeR',
      0.1,
      3,
      0.1,
      0.01,
      'skin',
    ]);
    expect(mirrorPart(['curve', 'handL', [0, 0.3, 0], 0.3, 0.02, 0.01, 'skin'])[3]).toBe(0.3);
  });
});

describe('problems', () => {
  it('accepts every point form', () => {
    const points = [
      'shinL',
      'weaponR',
      [0, 0.1, 1],
      ['lerp', 'shinL', 'footL', 0.5],
      ['off', 'head', 0, 0, [1, 'head']],
    ];
    for (const point of points) expect(pointProblem(point)).toBeNull();
  });

  it('names an unknown part type, with the nearest one', () => {
    expect(problems({ slots, parts: [['limbb', 'thighL', 'shinL', 0.05, 0.04, 'skin']] as never })).toMatch(
      /parts\[0\]: limbb is no part type.*did you mean "limb"/,
    );
  });

  it('names a part with the wrong number of arguments', () => {
    expect(problems({ slots, parts: [['ball', 'head', 0.1]] as never })).toMatch(
      /parts\[0\] \(ball\): has 2 arguments, needs 3/,
    );
  });

  it('names a point that is no joint or socket, with the nearest name', () => {
    expect(problems({ slots, mirror: [['limb', 'thighL', 'shinn', 0.05, 0.04, 'skin']] })).toMatch(
      /mirror\[0\] \(limb\), argument 2: "shinn" is no joint or socket.*did you mean "shinL"/,
    );
    expect(problems({ slots, parts: [['ball', ['lerp', 'head', 'neck'] as never, 0.1, 'skin']] })).toMatch(
      /write \['lerp', a, b, t\]/,
    );
    expect(problems({ slots, parts: [['ball', [0, 0] as never, 0.1, 'skin']] })).toMatch(/is no point/);
  });

  it('names a slot the body lacks, a size that is not positive and a count outside 1–64', () => {
    expect(problems({ slots, parts: [['ball', 'head', 0.1, 'skn']] })).toMatch(
      /argument 3: slot "skn" is not in slots.*did you mean "skin"/,
    );
    expect(problems({ slots, parts: [['ball', 'head', 0, 'skin']] })).toMatch(/argument 2: 0 is no size/);
    expect(problems({ slots, parts: [['ball', 'head', [0.5, 'leg'] as never, 'skin']] })).toMatch(/is no size/);
    expect(problems({ slots, parts: [['hair', 'head', 0.1, 65, 0.1, 0.01, 'skin']] })).toMatch(/count 65 is not 1–64/);
  });

  it('names bad options, colours and builds', () => {
    expect(problems({ slots, parts: [['ball', 'head', 0.1, 'skin', { on: 'eyeL' }]] })).toMatch(
      /its options \{"on":"eyeL"\} are not \{ on: a joint or 'root' \}/,
    );
    expect(problems({ slots: { skin: 'pink' } })).toMatch(/slot skin is "pink"; write colours as hex strings/);
    expect(problems({ slots, builds: { 'build:bulky': { limbRadius: -1 } } })).toMatch(
      /builds.build:bulky: give only limbRadius and torsoRadius/,
    );
  });

  it('lists every problem of a body in one error', () => {
    const message = problems({
      slots,
      parts: [
        ['ball', 'head', 0.1, 'skn'],
        ['limb', 'thighL', 'shinn', 0.05, 0.04, 'skin'],
      ],
    });
    expect(message).toMatch(/CORE_BAD_SPEC/);
    expect(message).toMatch(/parts\[0\].*parts\[1\]/s);
  });
});
