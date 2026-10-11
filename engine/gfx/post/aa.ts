/**
 * @file Edge smoothing (PLAN.md WP 7.4): the `aa` filter, from three.js's TSL display nodes, `FXAANode` or
 * `SMAANode`, whichever measures better (`AA_CHOICE`). It smooths the picture after bloom and before the composite,
 * so pixel art's blocks, dither, halftone dots and ASCII glyphs stay crisp, and draws into a texture the composite
 * reads at any pixel. Switching it is a uniform (`gate`): the edge pass always runs and copies the picture through
 * when it is off; SMAA's own three passes run only while it is on, in the warm-up's frame, or in a frame that set them up
 * (`gateUpdates`).
 *
 * The measurement (tests/e2e/post.spec.ts, "the edge smoothing that measures better"; the Stress Box's room through
 * the iso camera at 480 × 270, against the same frame drawn at 4 × 4 the size and averaged down, on this container's
 * SwiftShader): on the edges the unsmoothed frame misses, the mean luma error fell from 16.1 levels to 8.4 with FXAA
 * and to 10.7 with SMAA (`AA_MEASURED`). FXAA was chosen: it comes nearer the supersampled edges, runs as one pass
 * instead of three, and needs none of SMAA's lookup images, which r182 decodes from data URLs after the first
 * frames.
 *
 * Invariants: the output has the picture's size and colours; with the gate off it is the picture, texel for texel.
 *
 * @example
 * AA_KINDS; // ['fxaa', 'smaa']
 * AA_CHOICE; // 'fxaa'
 * @see engine/gfx/post/chain.ts
 * @see tests/e2e/post.spec.ts
 */
import { Fn, If, rtt, uv } from 'three/tsl';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import type { Node, NodeBuilder, NodeFrame, TextureNode, UniformNode } from 'three/webgpu';

/** The edge smoothing three.js r182 offers as TSL display nodes. */
export const AA_KINDS = ['fxaa', 'smaa'] as const;

/** An edge smoothing. */
export type AaKind = (typeof AA_KINDS)[number];

/** The one the chain uses: the one that measured better (see the file comment). */
export const AA_CHOICE: AaKind = 'fxaa';

/**
 * What decided it (tests/e2e/post.spec.ts): the mean absolute error, in 0–255 luma levels, over the pixels where the
 * unsmoothed frame differs from the supersampled one by more than 8, of the unsmoothed frame and of each smoothing,
 * and the full-screen passes each adds.
 */
export const AA_MEASURED = {
  where: 'the box room, cam=iso zoomed 1.6, 480 × 270, against 4 × 4 supersampling (tests/e2e/post.spec.ts)',
  none: 16.1,
  fxaa: 8.4,
  smaa: 10.7,
  passes: { fxaa: 1, smaa: 3 },
} as const;

/** The smoothing's output, and its passes' gate for `updateBefore`. */
export interface Aa {
  /** The smoothed picture as a texture (the picture itself while the gate is off). */
  texture: TextureNode;
  /** Frees the textures it made. */
  dispose(): void;
}

/**
 * Wraps a node's `updateBefore` so its passes run only while `runs()` holds, and in any frame that set it up again.
 * r182's `BloomNode` and `SMAANode` mark their pass materials for a rebuild in every `setup` (which runs whenever a
 * material holding them is built: a shot into a new target builds the chain's materials again), so a pass skipped
 * then would build its pipelines in the first frame it runs: they run in the frame that set them up instead.
 */
export function gateUpdates(node: Node, runs: () => boolean): void {
  const update = node.updateBefore.bind(node);
  const setup = node.setup.bind(node);
  let stale = true;
  node.setup = (builder: NodeBuilder) => {
    stale = true;
    return setup(builder);
  };
  node.updateBefore = (frame: NodeFrame) => {
    if (!runs() && !stale) return undefined;
    stale = false;
    return update(frame);
  };
}

/** Smooths `display` with `kind`, while `gate` is above 0.5; SMAA's passes run only while `runs()` (see above). */
export function createAa(kind: AaKind, display: TextureNode, gate: UniformNode<number>, runs: () => boolean): Aa {
  const smoothing = kind === 'fxaa' ? fxaa(display) : smaa(display);
  if (kind === 'smaa') gateUpdates(smoothing, runs);
  const out = Fn(() => {
    const colour = display.sample(uv()).toVar();
    If(gate.greaterThan(0.5), () => {
      colour.assign(smoothing);
    });
    return colour;
  })();
  const texture = rtt(out);
  texture.name = `postAa_${kind}`; // a WGSL identifier: r182 names the binding after it
  return {
    texture,
    dispose: () => {
      texture.renderTarget?.dispose();
      (smoothing as Node & { dispose?: () => void }).dispose?.();
    },
  };
}
