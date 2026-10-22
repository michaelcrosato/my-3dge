/**
 * @file The player's body, `body:player` (docs/PLAYGROUND.md §3.1, PLAN.md WP 13.2), in the body grammar
 * (engine/gfx/puppets/grammar.ts), worn on `build:adult` (engine/anim/builds.ts): a jacket with darker upper sleeves
 * and collar, cargo trousers with knee pads and a belt, boots with dark soles, gloves, short hair and a face, and a
 * small pack on the back. Every garment has two tones, so the cel look's bands and the pixel look's palette both read
 * it, and one accent (`accent`: the yoke and its shoulder caps, the pack's top flap and the cuffs) marks the player
 * from every camera: the caps and the flap face up, so the isometric and top-down cameras, which draw the player 11 to
 * 15 px tall, still show it (tests/e2e/playground.spec.ts counts it in every camera of both looks).
 *
 * Sizes are an adult's at 1.80 m: limbs in multiples of the body's `limbRadius`, the torso of its `torsoRadius`, the
 * head of the skeleton's head radius. Its slots are what the neighbours vary by seed (docs/PLAYGROUND.md §7.4): the
 * skin, the hair, the jacket's two tones, the trousers', the boots' and the accent.
 *
 * Invariants: data only; every slot it names is in `slots` and every slot in `slots` is worn; parts written for the
 * left side are in `mirror`. The page registers it (labs/playground/main.ts); the sim names it by id only.
 *
 * Game code, a page's: it imports only the engine's public API (engine/index.ts).
 *
 * @example
 * PLAYER_BODY.slots?.accent; // '#ff7f2a'
 * @see labs/playground/bodies/player.test.ts
 */
import { defineBody, type BodySpec } from '../../../engine';

/** The player's body (see the file comment). */
export const PLAYER_BODY: BodySpec = {
  description:
    'The playground player: a teal jacket with an orange yoke, charcoal cargo trousers with knee pads and a belt, boots, gloves, short hair and a pack.',
  limbRadius: 0.055,
  torsoRadius: 0.205,
  build: 'build:adult',
  slots: {
    skin: '#e3b48f',
    hair: '#2b1d16',
    jacket: '#2f6672',
    jacketDark: '#1d3f48',
    accent: '#ff7f2a',
    pants: '#41444d',
    pantsDark: '#2a2c32',
    boot: '#4d3424',
    sole: '#1c1a19',
    glove: '#26282c',
    pack: '#5d6442',
    eye: '#141018',
  },
  parts: [
    // the hips
    ['ball', 'pelvis', [[0.85, 'torso'], [0.6, 'torso'], [0.61, 'torso']], 'pants'], // prettier-ignore
    // the jacket: the waist, the chest, the shoulders' yoke and the collar
    ['limb', ['off', 'spine0', 0, 0, 0.06], 'chest', [0.66, 'torso'], [0.72, 'torso'], 'jacket', { on: 'spine1' }],
    ['limb', 'chest', ['off', 'neck', 0, 0, -0.03], [0.74, 'torso'], [0.7, 'torso'], 'jacket'],
    ['limb', 'upperArmL', 'upperArmR', [1.5, 'limb'], [1.5, 'limb'], 'accent', { on: 'chest' }],
    ['limb', ['off', 'neck', 0, 0, -0.02], ['off', 'neck', 0, 0, 0.05], [0.36, 'torso'], [0.32, 'torso'], 'jacketDark'],
    // the pack on the back, its top flap a few millimetres proud of it all round
    ['box', ['off', 'back', -0.06, 0, -0.16], ['off', 'back', -0.06, 0, 0.12], 0.28, 0.12, 'pack', { on: 'chest' }],
    ['box', ['off', 'back', -0.065, 0, 0.075], ['off', 'back', -0.065, 0, 0.125], 0.29, 0.125, 'accent', { on: 'chest' }], // prettier-ignore
    // the neck, the head, short hair and a face
    ['limb', 'neck', ['off', 'head', 0, 0, [0.4, 'head']], 0.052, 0.05, 'skin'],
    ['ball', ['off', 'head', [0.06, 'head'], 0, [0.92, 'head']], [0.88, 'head'], 'skin'],
    ['ball', ['off', 'head', [-0.18, 'head'], 0, [1.12, 'head']], [0.9, 'head'], 'hair'],
    ['ball', ['off', 'head', [0.18, 'head'], 0, [1.42, 'head']], [0.62, 'head'], 'hair'],
    ['ball', ['off', 'head', [0.86, 'head'], 0, [0.62, 'head']], [0.13, 'head'], 'skin'], // the nose
  ],
  mirror: [
    // the belt round the waist, a quarter each, its centre a little inside the hips and the jacket so it stands proud
    ['curve', ['off', 'pelvis', 0.119, 0, 0.015], ['off', 'pelvis', 0, -0.166, 0.015], 0.37, [0.4, 'limb'], [0.4, 'limb'], 'pantsDark'], // prettier-ignore
    ['curve', ['off', 'pelvis', 0, -0.166, 0.015], ['off', 'pelvis', -0.119, 0, 0.015], 0.37, [0.4, 'limb'], [0.4, 'limb'], 'pantsDark'], // prettier-ignore
    // the legs: thigh, knee pad, shin, then the boot and its sole
    ['limb', 'thighL', 'shinL', [1.5, 'limb'], [1.22, 'limb'], 'pants'],
    ['ball', ['off', 'shinL', [0.8, 'limb'], 0, 0], [0.95, 'limb'], 'pantsDark'],
    ['limb', 'shinL', ['lerp', 'shinL', 'footL', 0.66], [1.18, 'limb'], [1.02, 'limb'], 'pants'],
    ['limb', ['lerp', 'shinL', 'footL', 0.66], 'footL', [1.12, 'limb'], [1.04, 'limb'], 'boot'],
    ['limb', 'footL', 'toeL', [1.02, 'limb'], [0.86, 'limb'], 'boot'],
    ['box', ['off', 'footL', [-0.6, 'limb'], 0, -0.06], ['off', 'toeL', [0.9, 'limb'], 0, -0.045], [2.0, 'limb'], 0.02, 'sole', { on: 'footL' }], // prettier-ignore
    // the arms: the yoke's shoulder caps, the sleeves, dark above the elbow, the accent cuffs, gloves
    ['ball', 'upperArmL', [[1.9, 'limb'], [1.15, 'limb'], [1.8, 'limb']], 'accent', { on: 'chest' }], // prettier-ignore
    ['limb', 'upperArmL', 'forearmL', [1.24, 'limb'], [1.06, 'limb'], 'jacketDark'],
    ['limb', 'forearmL', ['lerp', 'forearmL', 'handL', 0.82], [1.06, 'limb'], [0.98, 'limb'], 'jacket'],
    ['limb', ['lerp', 'forearmL', 'handL', 0.82], ['lerp', 'forearmL', 'handL', 0.95], [1.04, 'limb'], [1.04, 'limb'], 'accent'], // prettier-ignore
    ['limb', ['lerp', 'forearmL', 'handL', 0.95], 'handL', [0.9, 'limb'], [0.86, 'limb'], 'glove'],
    ['ball', 'weaponL', [0.9, 'limb'], 'glove'],
    ['eye', 'eyeL', [0.11, 'head'], 'eye'],
  ],
};

/** `body:player`, registered with the shared registry once this module loads. */
export const PLAYER = defineBody('body:player', PLAYER_BODY);
