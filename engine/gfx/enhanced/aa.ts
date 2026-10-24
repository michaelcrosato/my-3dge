/**
 * @file Temporal edge smoothing, TRAA (PLAN.md WP 11.5): r182's `TRAANode` addon as the chain's `aa` filter when the
 * view setting `post.aa` is `traa` (engine/gfx/post/aa.ts, read when the chain is made). Each frame the camera is
 * moved by a sub-pixel step of a Halton sequence while the scene pass draws, and the picture is blended with the last
 * frames', reprojected through the scene pass's `velocity` target (engine/gfx/post/mrt.ts, made only for it): a still
 * picture gathers many samples a pixel, a moving one keeps fewer.
 *
 * Deterministic: the jitter is the sequence's next step on each frame the filter runs, never a clock or a random
 * draw, so the same frames drawn give the same pictures (tests count on it). r182 moves the camera it was given in
 * hooks the post chain calls around every frame it draws; here the jitter follows the chain's camera (`follow`), and
 * is applied only while the filter runs, so a look without `aa` draws its camera as it is.
 *
 * Two of r182's habits are changed, measured on the box's room (tests/e2e/post.spec.ts): its motion target took the
 * jitter for motion and its history drifted every frame (r182 gives the motion its unjittered projection only in
 * materials built while a jitter is on, and the engine builds them in the warm-up, before any), so the motion reads a
 * steady projection, the camera's without the jitter, set before anything is built (`STEADY`) and kept each frame;
 * and where no surface was drawn the motion target holds the clear colour (r182 clears every target with the scene's
 * background), which the smoothing took for motion, so it reads none there.
 *
 * Invariants: presentation only, never in the hash; the camera is as it was after each frame (r182 clears the offset
 * when the chain's frame ends).
 *
 * @example
 * // engine/gfx/post/chain.ts, through engine/gfx/features.ts, for post.aa = 'traa':
 * // const temporal = createTemporalAa({ beauty: display, depth, velocity, camera, runs }); temporal.follow(camera);
 * TRAA.jitter; // 'halton'
 * @see engine/gfx/enhanced/aa.test.ts
 * @see tests/e2e/post.spec.ts
 */
import { Matrix4, type Camera, type Node, type TextureNode } from 'three/webgpu';
import { select, velocity as motion, vec4 } from 'three/tsl';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { defineCodes } from '../../core/log';

/** Its advice code, raised by the feature registry when it is off. */
export const TRAA_CODES = defineCodes('gfx', {
  GFX_NO_TRAA: {
    template: '{feature} is off: {reason}; {downgrade}',
    fix: 'nothing to do for play; take the feature out of gfx.featuresOff if it is listed there',
    doc: "Advice from the feature registry (engine/gfx/features.ts) when temporal edge smoothing is off: the chain smooths edges with FXAA even where post.aa asks for 'traa'.",
  },
});

/** Its feature entry (engine/gfx/features.ts registers it). */
export const TRAA_FEATURE = {
  id: 'feature:traa',
  description:
    "Temporal edge smoothing (three.js's TRAANode): the camera jittered a sub-pixel each frame, the frames blended, where post.aa is 'traa' (engine/gfx/enhanced/aa.ts).",
  advice: 'GFX_NO_TRAA',
  downgrade: "edges are smoothed by FXAA where post.aa asks for 'traa'",
} as const;

/** The jitter: r182's Halton sequence, a step a frame the filter runs. */
export const TRAA = { jitter: 'halton' } as const;

/** What the smoothing reads: the picture (a rendered texture), the scene pass's depth and motion, the camera. */
export interface TemporalInputs {
  beauty: TextureNode;
  depth: TextureNode;
  velocity: TextureNode;
  camera: Camera;
  /** Whether the filter runs this frame: the jitter applies only then. */
  runs: () => boolean;
}

/** The smoothing (see the file comment). */
export interface TemporalAa {
  /** The smoothed picture (its passes run in `updateBefore`: gate them). */
  readonly node: Node;
  /** Each frame, before the chain draws: the camera the scene pass draws through. */
  follow(camera: Camera): void;
  dispose(): void;
}

/** r182's node as this module drives it. */
type Driven = Node & { camera: Camera; setViewOffset(w: number, h: number): void; clearViewOffset(): void; dispose(): void }; // prettier-ignore

/** r182's motion node (`velocity`), whose projection a material takes when it is built. */
const MOTION = motion as unknown as { setProjectionMatrix(projection: Matrix4 | null): void };

/** The projection the motion target reads: the camera's without the jitter (see the file comment). */
export const STEADY = new Matrix4();
MOTION.setProjectionMatrix(STEADY); // before any material that writes the motion target is built

/** The motion at a texel, as the smoothing loads it: none where no surface was drawn (see the file comment). */
function stillWhereEmpty(velocity: TextureNode, depth: TextureNode) {
  return { load: (at: Node) => select(depth.load(at).r.lessThan(1), velocity.load(at), vec4(0)) };
}

/** Makes the smoothing (see the file comment). */
export function createTemporalAa(inputs: TemporalInputs): TemporalAa {
  const velocity = stillWhereEmpty(inputs.velocity, inputs.depth) as unknown as TextureNode;
  const node = traa(inputs.beauty, inputs.depth, velocity, inputs.camera) as unknown as Driven;
  const [jitter, clear] = [node.setViewOffset.bind(node), node.clearViewOffset.bind(node)];
  let jittered = false;
  node.setViewOffset = (width, height) => {
    jittered = inputs.runs();
    STEADY.copy(node.camera.projectionMatrix); // the camera as placed, before the jitter
    if (jittered) jitter(width, height);
    MOTION.setProjectionMatrix(STEADY); // r182 hands the motion a projection of its own
  };
  node.clearViewOffset = () => {
    if (jittered) clear();
    MOTION.setProjectionMatrix(STEADY); // r182 takes it away
    jittered = false;
  };
  return {
    node,
    follow(camera) {
      node.camera = camera;
    },
    dispose: () => node.dispose(),
  };
}
