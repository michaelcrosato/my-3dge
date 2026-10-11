/**
 * @file The blob body (PLAN.md WP 5.4, I-21): what a blob rig (engine/anim/blob.ts) wears, as data: parts on its
 * joints in the rig-body form that `createCrowd` draws (engine/gfx/puppets/crowd.ts, `RigBody`). `BLOB_BODY` is the
 * slime; `blobBody({ horns, ears, wings })` adds the source's features, as its cast varied them.
 *
 * - The body: a ball through the `body` joint's matrix, so it squashes as the rig squashes (the rig keeps its volume).
 * - The eyes: a white ellipsoid on each eye joint (1.25 × 1.6 × 1.25 units) and a pupil 0.9 units in front of it
 *   along the look (0.7 × 1 × 0.7 units); while the rig's `squint` flag is on, a dark slit instead (1.1 × 0.3 × 1.1).
 * - Horns, or cat ears: a cone on each side of the top, its base 0.45 of the width out and 0.7 of the height up from
 *   the centre (it follows the squash), leaning out by 0.35 of its height: 0.9 R tall in `horn`, ears 0.75 R in `dark`;
 *   0.3 R wide at the base.
 * - Wings: a flat box along each wing joint, root to tip, 0.9 R wide along the look and 0.25 units thick.
 * A blob shadow of 6 units under its root.
 *
 * Sizes are metres for a blob of `BLOB.radius` (R, 6.5 units); `createCrowd` scales the parts that do not stretch by
 * the rig's radius over R. The colours are the source's `Blob` defaults (its pink slime) and the horns' bone white.
 *
 * Invariants: data, built once; every slot a part names is in `slots`; parts on the left eye (+X at yaw 0) and the
 * left side come first, then the right, mirrored across the rig's x.
 *
 * Carried from `my-3d2dge:src/stress-world/30-crowd.js:140-160` (`slimeParts`), with the colours of
 * `my-3d2dge:engine/my-3d2dge.js:2590` (`Blob`'s `C`) and the cast's features of `src/stress-world/20-sim.js:101`
 * (`SLIME_PARTS`). Units ÷ 16 in metres.
 *
 * @example
 * BLOB_BODY.parts.length; // 7: the body, and on each eye a white, a pupil and a slit
 * blobBody({ wings: true }).parts.length; // 9
 * @see engine/gfx/puppets/crowd.test.ts
 * @see tests/e2e/crowd-render.spec.ts
 */
import type { RigBody, RigPart } from '../crowd';

/** The blob's radius the sizes are written for (engine/anim/blob.ts `BLOB.radius`), metres. */
export const BLOB_BODY_RADIUS = 6.5 / 16;

/** How far in front of its eye a pupil sits, along the look, metres; the eye joint turns 0.42 rad off the look. */
const PUPIL = 0.9 / 16;
const EYE_TURN = 0.42;

/** The features `blobBody` can add. */
export interface BlobFeatures {
  /** Horns: bone-white cones on top, leaning out. */
  horns?: boolean;
  /** Cat ears: shorter cones in the dark shade. */
  ears?: boolean;
  /** Bat wings on the wing joints, beating as the rig beats them. */
  wings?: boolean;
}

/** `part` on the right side: its joint's L turned R and its x negated. */
function right(part: RigPart): RigPart {
  const flip = (v: readonly [number, number, number] | undefined) => v && ([-v[0], v[1], v[2]] as const);
  return { ...part, on: part.on.replace(/L$/, 'R'), at: flip(part.at), toward: flip(part.toward) };
}

/** A blob body with `features` (see the file comment). */
export function blobBody(features: BlobFeatures = {}): RigBody {
  const R = BLOB_BODY_RADIUS;
  const left: RigPart[] = [
    { shape: 'ball', on: 'eyeL', size: [1.25 / 16, 1.6 / 16, 1.25 / 16], slot: 'eye', unless: 'squint' },
    {
      shape: 'ball',
      on: 'eyeL',
      at: [-Math.sin(EYE_TURN) * PUPIL, 0, Math.cos(EYE_TURN) * PUPIL],
      size: [0.7 / 16, 1 / 16, 0.7 / 16],
      slot: 'pupil',
      unless: 'squint',
    },
    { shape: 'ball', on: 'eyeL', size: [1.1 / 16, 0.3 / 16, 1.1 / 16], slot: 'pupil', when: 'squint' },
  ];
  if (features.horns || features.ears) {
    const tall = (features.horns ? 0.9 : 0.75) * R;
    const size = [0.3 * R, tall * Math.hypot(0.35, 1), 0.3 * R] as const;
    left.push({
      shape: 'cone',
      on: 'body',
      at: [0.45, 0.7, 0],
      toward: [0.35, 1, 0],
      size,
      slot: features.horns ? 'horn' : 'dark',
    });
  }
  if (features.wings) {
    left.push({
      shape: 'box',
      on: 'wingL',
      at: [0, 0.5, 0],
      size: [0.9 * R, 1, 0.25 / 16],
      stretch: true,
      slot: 'dark',
    });
  }
  const name = ['blob', features.horns && 'horns', features.ears && 'ears', features.wings && 'wings'];
  return {
    name: name.filter(Boolean).join('+'),
    description: 'A blob: a squashing ball with two eyes (a slit while squinting), and any horns, ears or wings.',
    slots: { base: '#c95f9a', dark: '#6d2658', eye: '#ffffff', pupil: '#2a0f24', horn: '#e8dcc0' },
    parts: [{ shape: 'ball', on: 'body', size: 1, stretch: true, slot: 'base' }, ...left, ...left.map(right)],
    shadow: { on: 'root', radius: 6 / 16 },
  };
}

/** The slime: a blob with eyes and nothing else. */
export const BLOB_BODY: RigBody = blobBody();
