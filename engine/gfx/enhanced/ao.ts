/**
 * @file Ambient occlusion (PLAN.md WP 11.5): r182's `GTAONode` addon (ground-truth ambient occlusion) over the post
 * chain's scene pass, its depth and its view normals (engine/gfx/post/mrt.ts), for the look's `ao` section
 * (engine/gfx/post/shading.ts lays it on the scene's light): creases, corners and the ground under things darken,
 * indoors most of all. It renders at half the picture's resolution, 16 samples, into a one-channel target cleared to
 * 1, so the background stays as it is. With `feature:ao` off, a look's `ao` draws nothing.
 *
 * Invariants: presentation only, never in the hash; its pass runs only in frames whose look asks for it (and the
 * warm-up's frame), through `gateUpdates` (engine/gfx/post/aa.ts); its camera is the chain's lens, which follows each
 * frame's camera (engine/gfx/post/shading.ts).
 *
 * @example
 * // engine/gfx/post/shading.ts, through engine/gfx/features.ts:
 * // const occlusion = createOcclusion({ depth, normal, camera: lens }); occlusion.set(1, 0.6);
 * AO.samples; // 16
 * @see engine/gfx/enhanced/ao.test.ts
 * @see tests/e2e/enhanced.spec.ts
 */
import type { Camera, Node, TextureNode } from 'three/webgpu';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { defineCodes } from '../../core/log';

/** Its advice code, raised by the feature registry when it is off. */
export const AO_CODES = defineCodes('gfx', {
  GFX_NO_AO: {
    template: '{feature} is off: {reason}; {downgrade}',
    fix: 'nothing to do for play; take the feature out of gfx.featuresOff if it is listed there',
    doc: "Advice from the feature registry (engine/gfx/features.ts) when ambient occlusion is off: a look's `ao` section draws nothing.",
  },
});

/** Its feature entry (engine/gfx/features.ts registers it). */
export const AO_FEATURE = {
  id: 'feature:ao',
  description:
    "Ambient occlusion (three.js's GTAONode): creases and corners darken where a look's ao section asks (engine/gfx/enhanced/ao.ts).",
  advice: 'GFX_NO_AO',
  downgrade: 'no ambient occlusion: creases and corners keep their light',
} as const;

/** The pass: its resolution (a share of the picture's) and samples. */
export const AO = { resolution: 0.5, samples: 16 } as const;

/** The occlusion pass (see the file comment). */
export interface Occlusion {
  /** The pass node: its `updateBefore` renders the occlusion (gate it). */
  readonly node: Node;
  /** The occlusion at a pixel, 0 (hidden) to 1 (open), in `.r`. */
  readonly texture: TextureNode;
  /** Sets how dark it gets (1 its full measure) and how far round a point it looks (m). */
  set(strength: number, radius: number): void;
  dispose(): void;
}

/** Makes the occlusion pass over `depth` and the view normals `normal`, seen by `camera` (see the file comment). */
export function createOcclusion(inputs: { depth: TextureNode; normal: TextureNode; camera: Camera }): Occlusion {
  const node = ao(inputs.depth, inputs.normal, inputs.camera);
  node.resolutionScale = AO.resolution;
  node.samples.value = AO.samples;
  return {
    node,
    texture: node.getTextureNode(),
    set(strength, radius) {
      node.scale.value = strength;
      node.radius.value = radius;
    },
    dispose: () => node.dispose(),
  };
}
