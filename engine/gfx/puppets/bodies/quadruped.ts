/**
 * @file The quadruped body (PLAN.md WP 13.21; docs/PLAYGROUND.md §7.4): what a quadruped rig (engine/anim/quadruped.ts)
 * wears, as data, in the rig-body form `createCrowd` draws (engine/gfx/puppets/crowd.ts, `RigBody`): the dog. Every
 * part is a ball, an ellipsoid or a cone on one of the rig's joints:
 * - **The torso** on `torso`: a deep chest and the hips, a barrel between them (a tucked waist), a pale belly under
 *   it and a pale patch on its chest.
 * - **The neck** along its bone, **the head** on `head`: its skull, the snout in two (wide at its base, narrow at its
 *   nose) and the dark nose, two dark eyes, and the ears on `earL` and `earR`, flat cones.
 * - **The legs** along their bones, thick at the top and thinner to the paw (the hind thigh thickest); a ball on each
 *   paw; **the tail** along its three links, the last pale.
 * A blob shadow under its torso. The colours are Biscuit's (the town dog's coat, skin and pale patches), its eyes
 * and nose the quadruped preset's.
 *
 * Invariants: data, built once; every slot a part names is in `slots`; sizes in metres (the bones' `stretch` parts in
 * their bone's units: a bone's matrix is scaled by its length along +Y, so 0.5 reaches each end).
 *
 * Carried from shardfall@fa2dab6 `crates/pav_core/src/rig.rs:560-571` (the legs: thick at the top, a paw) and
 * `:651-677` (the chest, the waist, the belly, the neck, the head, the snout, the nose, the ears, the eyes), with
 * the colours of `crates/pav_core/src/arpg/scene.rs:974-981` (Biscuit) and `puppet.rs:318-333`; the capsules there
 * are ellipsoids and balls here.
 *
 * @example
 * QUADRUPED_BODY.parts.filter((part) => part.on === 'head').length; // 6: the skull, the snout's two, the nose, the eyes
 * @see engine/gfx/puppets/crowd.test.ts
 */
import type { RigBody, RigPart } from '../crowd';

/** A part on bone `on`: an ellipsoid end to end, `radius` m thick, in `slot`. */
const along = (on: string, radius: number, slot: string): RigPart => ({ shape: 'ball', on, size: [radius, 0.55, radius], stretch: true, slot }); // prettier-ignore

/** The dog (see the file comment). */
export const QUADRUPED_BODY: RigBody = {
  name: 'quadruped',
  description: 'A dog: a deep chest, a tucked waist, a head on a raised neck with a snout and ears, four legs, a tail.',
  slots: { coat: '#d8aa6a', skin: '#c89a5a', pale: '#f2e2c8', eye: '#2a1e14', nose: '#1e1612' },
  parts: [
    { shape: 'ball', on: 'torso', at: [0, 0.012, 0.173], size: 0.137, slot: 'coat' },
    { shape: 'ball', on: 'rump', size: 0.113, slot: 'coat' },
    { shape: 'ball', on: 'torso', at: [0, 0.006, -0.016], size: [0.112, 0.115, 0.2], slot: 'coat' },
    { shape: 'ball', on: 'torso', at: [0, -0.05, 0.014], size: [0.08, 0.075, 0.15], slot: 'pale' },
    { shape: 'ball', on: 'torso', at: [0, -0.02, 0.215], size: [0.085, 0.1, 0.08], slot: 'pale' },
    along('neck', 0.072, 'coat'),
    { shape: 'ball', on: 'head', size: 0.094, slot: 'skin' },
    { shape: 'ball', on: 'head', at: [0, -0.008, 0.06], size: 0.056, slot: 'skin' },
    { shape: 'ball', on: 'head', at: [0, -0.018, 0.105], size: [0.042, 0.038, 0.052], slot: 'skin' },
    { shape: 'ball', on: 'head', at: [0, -0.019, 0.148], size: 0.02, slot: 'nose' },
    ...[1, -1].map((side): RigPart => ({ shape: 'ball', on: 'head', at: [side * 0.037, 0.034, 0.072], size: 0.017, slot: 'eye' })), // prettier-ignore
    ...['earL', 'earR'].map((on): RigPart => ({ shape: 'cone', on, size: [0.026, 0.08, 0.011], slot: 'skin' })),
    ...['fl0', 'fr0'].map((on) => along(on, 0.04, 'skin')),
    ...['fl1', 'fr1'].map((on) => along(on, 0.026, 'skin')),
    ...['hl0', 'hr0'].map((on) => along(on, 0.05, 'coat')),
    ...['hl1', 'hr1'].map((on) => along(on, 0.03, 'skin')),
    ...['hl2', 'hr2'].map((on) => along(on, 0.024, 'skin')),
    { shape: 'ball', on: 'paws', at: [0, 0.026, 0], size: 0.028, slot: 'skin' },
    along('tail0', 0.03, 'coat'),
    along('tail1', 0.024, 'coat'),
    along('tail2', 0.018, 'pale'),
  ],
  shadow: { on: 'torso', radius: 0.3 },
};
