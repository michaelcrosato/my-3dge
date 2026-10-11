/**
 * @file The floater body (PLAN.md WP 5.4, I-21): what a floater rig (engine/anim/floater.ts) wears, as data, in the
 * rig-body form `createCrowd` draws (engine/gfx/puppets/crowd.ts, `RigBody`): the wisp. A glowing core and a halo
 * round it, both through the `core` joint's matrix, so they swell with the rig and turn and bank with it, and a small
 * glowing mote on each of the rig's motes. No blob shadow: a wisp hovers.
 *
 * The core (3.2 units) and the motes (0.7 units) are drawn unlit, with the body's glow material; the halo (4.6
 * units) with `material:puppetHalo` (defined here): unlit, see-through at 35 %, writing no depth, so the core shows
 * through it. The source drew its halo additively at 40 % of its colour; the material registry has no additive
 * blending, and plain blending at 35 % reads the same over the floor.
 *
 * Invariants: data, apart from defining the halo's material on a registry (`floaterMaterials`, the shared one on
 * import); every slot a part names is in `slots`.
 *
 * Carried from `my-3d2dge:src/stress-world/30-crowd.js:161-170` (`WISP` and `wispParts`), units ÷ 16 in metres; the
 * dying pop and the hit flash are the game's.
 *
 * @example
 * FLOATER_BODY.parts.map((part) => part.on); // ['core', 'core', 'motes']
 * @see engine/gfx/puppets/crowd.test.ts
 * @see tests/e2e/crowd-render.spec.ts
 */
import { registry as sharedRegistry, type Registry } from '../../../core/registry';
import { defineMaterial, materialKind, type MaterialSpec } from '../../materials/material';
import type { RigBody } from '../crowd';

/** The halo's material: unlit, see-through, writing no depth. */
export const PUPPET_HALO_MATERIAL: MaterialSpec = {
  description: 'A glow’s halo: unlit and see-through, writing no depth; white, multiplied by the instance colour.',
  vertexColors: true,
  unlit: true,
  transparent: true,
  opacity: 0.35,
  depthWrite: false,
};

/** Defines `material:puppetHalo` on `registry` (the shared one by default) unless it has it. */
export function floaterMaterials(registry: Registry = sharedRegistry): void {
  materialKind(registry);
  if (!registry.has('material', 'material:puppetHalo'))
    defineMaterial('material:puppetHalo', PUPPET_HALO_MATERIAL, registry);
}
floaterMaterials();

/** The wisp (see the file comment). */
export const FLOATER_BODY: RigBody = {
  name: 'floater',
  description: 'A wisp: a glowing core in a halo, swelling as it charges, and glowing motes orbiting it.',
  slots: { core: '#c78bff', halo: '#7a4ac0', mote: '#e3c8ff' },
  parts: [
    { shape: 'eye', on: 'core', size: 3.2 / 16, stretch: true, slot: 'core' },
    { shape: 'ball', on: 'core', size: 4.6 / 16, stretch: true, slot: 'halo', material: 'material:puppetHalo' },
    { shape: 'eye', on: 'motes', size: 0.7 / 16, slot: 'mote' },
  ],
};
