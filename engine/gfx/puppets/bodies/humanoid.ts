/**
 * @file The neutral humanoid body (PLAN.md WP 3.8, I-21): `body:humanoid`, the body every humanoid wears until a
 * game gives it its own, in the body grammar (engine/gfx/puppets/grammar.ts), which registers it. Legs in trousers
 * and boots, a shirt with short sleeves, a belt, a neck, a face, hair (a mass behind, a cap and a fringe) and two
 * eyes on the eye sockets; no weapon, no cape: those are props and outfits a game adds.
 *
 * Sizes follow my-3d2dge's puppet (`humanParts` and lab3d's `humanBody`): limbs in multiples of the limb radius
 * (`limbW` / 2), the torso of the torso radius (`torsoW`), the head of the skeleton's head radius, all / 16 to metres.
 * The builds' drawing fields come with them: `build:bulky` draws thicker (`limbW` 2.6, `torsoW` 4.2) and
 * `build:skeleton` thinner (the HD floor of 0.55 units for a limb, `torsoW` 2.6); chibi and heroic keep the defaults.
 * The source's torso, one capsule from the hips to the shoulders, is two here, riding spine1 and the chest, so it
 * bends with the back; the hand is a ball on the grip socket, the fist's centre.
 *
 * Invariants: data only (no imports at run time, so the grammar can register it); every slot it names is in
 * `slots`; parts written for the left side are in `mirror`.
 *
 * Carried from `my-3d2dge:src/stress-world/30-crowd.js:98-138` (`humanParts`, the sizing) and
 * `my-3d2dge:src/lab3d/40-characters.js:24-41` (`humanBody`, the parts as lines), with the default colours of
 * `my-3d2dge:engine/my-3d2dge.js:1749-1752` (`HUMAN_COLORS`).
 *
 * @example
 * HUMANOID_BODY.mirror?.length; // 8: the parts each side wears
 * @see engine/gfx/puppets/compile.test.ts
 * @see tests/e2e/puppets.spec.ts
 */
import type { BodySpec } from '../grammar';

/** The neutral humanoid (see the file comment). */
export const HUMANOID_BODY: BodySpec = {
  description: 'The neutral humanoid: trousers and boots, a short-sleeved shirt, a belt, a face, hair and eyes.',
  slots: {
    skin: '#f1c7a0',
    hair: '#3b2a2f',
    cloth: '#2f8f86',
    pants: '#3b3552',
    boot: '#6a4128',
    belt: '#e0a84a',
    eye: '#1a1320',
  },
  parts: [
    ['limb', 'thighL', 'thighR', [1.45, 'limb'], [1.45, 'limb'], 'pants', { on: 'pelvis' }],
    ['limb', ['off', 'thighL', 0, -0.019, 0.044], ['off', 'thighR', 0, 0.019, 0.044], [0.66, 'torso'], [0.66, 'torso'], 'belt', { on: 'pelvis' }], // prettier-ignore
    ['limb', ['off', 'spine0', 0, 0, 0.05], 'chest', [0.62, 'torso'], [0.68, 'torso'], 'cloth', { on: 'spine1' }],
    ['limb', 'chest', ['off', 'neck', 0, 0, -0.025], [0.68, 'torso'], [0.72, 'torso'], 'cloth'],
    ['limb', 'upperArmL', 'upperArmR', [1.2, 'limb'], [1.2, 'limb'], 'cloth', { on: 'chest' }],
    ['limb', 'neck', ['off', 'head', 0, 0, [0.4, 'head']], 0.047, 0.047, 'skin'],
    ['ball', ['off', 'head', [0.1, 'head'], 0, [0.95, 'head']], [0.9, 'head'], 'skin'],
    ['ball', ['off', 'head', [-0.32, 'head'], 0, [1.16, 'head']], [0.96, 'head'], 'hair'],
    ['ball', ['off', 'head', [-0.1, 'head'], 0, [1.62, 'head']], [0.72, 'head'], 'hair'],
    ['ball', ['off', 'head', [0.5, 'head'], 0, [1.5, 'head']], [0.42, 'head'], 'hair'],
  ],
  mirror: [
    ['limb', 'thighL', 'shinL', [1.45, 'limb'], [1.2, 'limb'], 'pants'],
    ['limb', 'shinL', ['lerp', 'shinL', 'footL', 0.62], [1.2, 'limb'], [1.05, 'limb'], 'pants'],
    ['limb', ['lerp', 'shinL', 'footL', 0.62], 'footL', [1.15, 'limb'], [1.05, 'limb'], 'boot'],
    ['limb', 'footL', 'toeL', [1, 'limb'], [0.85, 'limb'], 'boot'],
    ['limb', 'upperArmL', 'forearmL', [1.15, 'limb'], [1, 'limb'], 'cloth'],
    ['limb', 'forearmL', 'handL', [1, 'limb'], [0.9, 'limb'], 'skin'],
    ['ball', 'weaponL', [0.82, 'limb'], 'skin'],
    ['eye', 'eyeL', [0.124, 'head'], 'eye'],
  ],
  builds: {
    'build:bulky': { limbRadius: 0.08125, torsoRadius: 0.2625 },
    'build:skeleton': { limbRadius: 0.034375, torsoRadius: 0.1625 },
  },
};
