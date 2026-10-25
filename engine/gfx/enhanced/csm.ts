/**
 * @file Cascaded shadows (PLAN.md WP 11.5): the sky's sun casts through r182's `CSMShadowNode` addon, over
 * `CASCADES.count` cascades that split the view's first `CASCADES.far` m, each its own `CASCADES.map`² shadow map. One
 * map stretched over a whole site (the playground's block is over 100 m across) gives a few centimetres a texel at
 * best; the cascades give the near ones to what stands near the camera. With `feature:cascadedShadows` off, the sun
 * casts one 2,048² map over the level, as before (engine/gfx/sky.ts).
 *
 * r182's node takes the camera of the first build and keeps it; the engine's frames change cameras (five camera codes,
 * orthographic ones among them; r182's frustum split handles both), so `follow(camera)`, each frame (the sky's
 * `update`), hands it the frame's camera and splits the cascades again when that camera or its projection changed;
 * but only after that first build, since r182 makes its cascades only while it has no camera (`CSMShadowNode.js:493`):
 * handed one earlier (a sky shown before its sun casts), it made none and every sunlit material failed to build. The
 * cascades' placeholder lights join the sun's parent on the first frame (r182); they are no lights to the warm-up's
 * key.
 *
 * Each cascade's shadow is a clone of the sun's (`CSMShadowNode.js:172`), and `LightShadow.copy` leaves the shadow's
 * filter behind, so the sun's shadow makes clones that take the engine's filter again (engine/gfx/shadows.ts
 * `snapShadow`: its noise follows the frame's pixel grid, WP 13.24) until `dispose`.
 *
 * Invariants: presentation only, never in the hash; the sun keeps its `castShadow`, which the shadow budget sets
 * (engine/gfx/shadows.ts); `dispose` gives the sun back its own shadow.
 *
 * @example
 * // engine/gfx/sky.ts, through engine/gfx/features.ts: const cascades = cascadeSun(sun);
 * // cascades.follow(camera); // each frame
 * CASCADES.count; // 3
 * @see engine/gfx/enhanced/csm.test.ts
 * @see tests/e2e/enhanced.spec.ts
 */
import type { Camera, DirectionalLight } from 'three/webgpu';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { defineCodes } from '../../core/log';
import { snapShadow } from '../shadows';

/** Its advice code, raised by the feature registry when it is off. */
export const CSM_CODES = defineCodes('gfx', {
  GFX_NO_CASCADED_SHADOWS: {
    template: '{feature} is off: {reason}; {downgrade}',
    fix: 'nothing to do for play; take the feature out of gfx.featuresOff if it is listed there',
    doc: "Advice from the feature registry (engine/gfx/features.ts) when cascaded shadows are off: the sky's sun casts one shadow map over the whole level.",
  },
});

/** Its feature entry (engine/gfx/features.ts registers it). */
export const CSM_FEATURE = {
  id: 'feature:cascadedShadows',
  description:
    "Cascaded shadows: the sky's sun casts over three cascades of the view, each its own shadow map, sharp near the camera across a whole site (engine/gfx/enhanced/csm.ts).",
  advice: 'GFX_NO_CASCADED_SHADOWS',
  downgrade: "the sky's sun casts one shadow map over the whole level, coarser near the camera",
} as const;

/** The cascades: how many, how far they reach (m), the margin behind them toward the sun (m), each map's size (px). */
export const CASCADES = { count: 3, far: 90, margin: 60, map: 1024 } as const;

/** A sun casting through cascades (see the file comment). */
export interface CascadedSun {
  readonly node: CSMShadowNode;
  /** Each frame: gives the cascades the frame's camera, splitting them again when it or its projection changed. */
  follow(camera: Camera): void;
  /** Gives the sun back its own shadow. */
  dispose(): void;
}

/** Makes `sun` cast through cascades (see the file comment). */
export function cascadeSun(sun: DirectionalLight): CascadedSun {
  sun.shadow.mapSize.set(CASCADES.map, CASCADES.map);
  const clone = sun.shadow.clone;
  sun.shadow.clone = function cascade(this: typeof sun.shadow) {
    const made = clone.call(this);
    snapShadow(made);
    return made;
  };
  const node = new CSMShadowNode(sun, {
    cascades: CASCADES.count,
    maxFar: CASCADES.far,
    mode: 'practical',
    lightMargin: CASCADES.margin,
  });
  sun.shadow.shadowNode = node;
  let split: { camera: Camera; projection: string } | null = null;
  return {
    node,
    follow(camera) {
      if (node.mainFrustum === null) return; // r182 makes the cascades at its first build, with that build's camera
      node.camera = camera;
      const projection = camera.projectionMatrix.elements.join();
      if (split?.camera !== camera || split.projection !== projection) node.updateFrustums();
      split = { camera, projection };
    },
    dispose() {
      sun.shadow.shadowNode = undefined;
      sun.shadow.clone = clone;
      node.dispose();
    },
  };
}
