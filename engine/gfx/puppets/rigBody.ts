/**
 * @file Rig bodies (PLAN.md WP 5.4, I-21): the data form in which a rig (a blob, a floater, a quadruped: engine/anim/)
 * wears its body, as `createCrowd` draws it (engine/gfx/puppets/crowd.ts `rig`). A rig body (`RigBody`) has material
 * slots, each a name with its colour, and parts, each a unit shape (compile.ts's file comment; any but the limb) on
 * one joint of the rig's pose (`RigJoints`: a matrix, a point or a list of points), placed and sized as `RigPart`
 * says. The bodies themselves are data in engine/gfx/puppets/bodies/ (`BLOB_BODY`, `FLOATER_BODY`, `QUADRUPED_BODY`).
 * Split from crowd.ts at its size cap (WP 11.4); crowd.ts re-exports the types, so its importers are as they were.
 *
 * Invariants: types only, no code: a rig body's problems are found when the crowd first draws it (`GFX_RIG_BODY`).
 *
 * @example
 * // const dot: RigBody = { name: 'dot', description: 'A ball.', slots: { skin: '#ffffff' },
 * //   parts: [{ shape: 'ball', on: 'core', size: 0.1, slot: 'skin' }] };
 * @see engine/gfx/puppets/crowd.test.ts
 */
import type { Matrix4, Vector3 } from 'three/webgpu';
import type { PieceShape } from './compile';

/** A unit shape a rig part draws: any but the limb. */
export type RigShape = Exclude<PieceShape, 'limb'>;

type Vec3 = readonly [number, number, number];

/**
 * One part of a rig body: a unit shape (compile.ts's file comment) on one joint of the rig's pose, a matrix, a point
 * or a list of points (one part on each). It sits at `at` in the joint's frame, through the joint's whole matrix,
 * points `toward` a direction and has a `size` in metres: it turns with the joint but keeps its size, scaled only by
 * the rig's `scale` (a blob's radius over its body's), unless it `stretch`es through the joint's scale too (a
 * squashing body), when its size is in the joint's units. `eye` parts are unlit (the body's glow material); a part
 * with a `material` of its own draws in a batch of its own; `when` and `unless` name the rig's flags (`squint`).
 */
export interface RigPart {
  /** Its unit shape; `eye` is drawn unlit. */
  readonly shape: RigShape;
  /** The joint it rides: a key of the rig's pose. */
  readonly on: string;
  /** Its origin in the joint's frame, through the joint's whole matrix (the joint's origin by default). */
  readonly at?: Vec3;
  /** Its size along x, y and z (one number for all three): metres, or with `stretch` the joint's units. */
  readonly size: number | Vec3;
  /** Where its +Y points, in the joint's frame (+Y by default). */
  readonly toward?: Vec3;
  /** Sized by the joint's scale too. */
  readonly stretch?: boolean;
  readonly slot: string;
  /** A material id of its own: drawn in a batch of its own, casting no shadow. */
  readonly material?: string;
  /** Drawn only while this flag of the rig is on. */
  readonly when?: string;
  /** Drawn only while this flag of the rig is off. */
  readonly unless?: string;
}

/** A rig body (see the file comment): its slots and parts, and the materials and shadow it is drawn with. */
export interface RigBody {
  /** Its name, for messages. */
  readonly name: string;
  readonly description: string;
  /** Material slots: each name with its hex colour. */
  readonly slots: Readonly<Record<string, string>>;
  readonly parts: readonly RigPart[];
  /** The lit parts' material (`material:puppet`) and the eyes' (`material:puppetGlow`). */
  readonly material?: string;
  readonly glowMaterial?: string;
  /** A blob shadow under joint `on`, `radius` metres before the rig's scale, when a floor is given. */
  readonly shadow?: Readonly<{ on: string; radius: number }>;
}

/** A rig's pose: each joint a world matrix, a point, or a list of points. */
export type RigJoints = Readonly<Record<string, Matrix4 | Vector3 | readonly Vector3[]>>;
