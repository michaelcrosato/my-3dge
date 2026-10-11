/**
 * @file The one fixed MRT of post-processing (PLAN.md WP 7.4, §6.7, I-46): the scene pass draws, once per frame and
 * always the same way, the colour (`output`) and the view normals (`normal`), whose spare channel `w` carries what
 * the composite needs to know about each pixel's object: its outline group, its part of the scene (a character, an
 * object or the environment) and whether it is drawn as pixel art. It is set up once, when the chain is made
 * (`createScenePass`), and never changes, so no filter toggle recompiles a material; r182's normal-based addons
 * (`SSRNode`, §4.8) can read the same target. This is the one module that calls `mrt()` and `setMRT()` (ESLint).
 *
 * Packing, as shardfall packs it (`shardfall:crates/pav_render/src/shaders/scene.wgsl:267-277`): the group folded into
 * 1..511, +512 on characters, +1024 on characters and objects, negative for pixel art. The packed value stays within
 * ±2,047, integers a half-float target holds exactly (r182's `pass()` targets are `HalfFloatType`); shardfall folded
 * groups into 1..1023 and had no characters bit, so telling characters from objects takes the 512 bit here. The
 * target is cleared to (0, 0, 0, 1), as r182 clears every attachment after the first, so the background reads as a
 * zero normal with `w` = 1: the environment, never outlined from inside.
 *
 * Each object's flags are a per-object uniform set through `onObjectUpdate` from its tag: `setPart(object, part)`, on
 * it or its nearest tagged ancestor; untagged objects count as characters when they are a puppet (`userData.body`) or
 * the protagonist (`userData.protagonist`), as objects when they stand for an entity (`userData.entity`), and as the
 * environment otherwise. The group is the tag's, else the entity's id, else 1 for the environment and the object's own
 * id for the rest. A transparent object replaces the normal and flags under it: r182 blends only the first attachment.
 *
 * The warm-up (engine/gfx/warmup.ts) compiles for the render target the frame draws the scene into, but knows nothing
 * of MRT; r182's `PassNode.compileAsync` sets both. So the chain registers the warm-up entry `WARM_MRT_ID`, which
 * sorts before every other id, and whose `objects()` turns this MRT on while the warm-up compiles for the scene pass's
 * own target (`useSceneMrt`): every later compile step, the material styles' among them, builds the MRT variant the
 * frame draws. The chain's draw turns it off again before drawing (`clearMrt`).
 *
 * Invariants: presentation only (nothing here reaches the sim); a tag never changes a material; `packFlags` and
 * `unpackFlags` are inverse for every part, group 1..511 and pixel-art flag.
 *
 * @example
 * packFlags('character', 7, false); // 1543: 7 + 512 + 1024
 * unpackFlags(-1031); // { part: 'object', group: 7, pixelArt: true }
 * // const scenePass = createScenePass(scene, camera); // colour, normals with flags, depth
 * // setPart(hero, 'character', { pixelArt: true });
 * @see engine/gfx/post/mrt.test.ts
 * @see tests/e2e/post.spec.ts
 */
import { Fn, mrt, normalView, output, pass, uniform, vec3, vec4 } from 'three/tsl';
import type { Camera, Node, NodeBuilder, Object3D, PassNode, Scene, WebGPURenderer } from 'three/webgpu';

/** The parts of the scene a filter can be scoped to. */
export const PARTS = ['character', 'object', 'environment'] as const;

/** A part of the scene: a character (puppets, the hero), an object (props, entities) or the environment. */
export type Part = (typeof PARTS)[number];

/** Each part's bit in a filter's scope mask (engine/gfx/post/filters.ts). */
export const PART_BITS: Readonly<Record<Part, number>> = { character: 1, object: 2, environment: 4 };

/** Groups fold into 1..511; the bits above carry the part and the sign the pixel-art flag. */
export const GROUPS = 511;

/** The packed value's bits: +512 on characters, +1024 on characters and objects. */
export const FLAG_BITS = { character: 512, actor: 1024 } as const;

/** The warm-up entry that turns the MRT on for the compile steps: `!` sorts before every other id. */
export const WARM_MRT_ID = '!post-mrt';

/** What `setPart` records on an object (`userData.post`). */
export interface PostTag {
  part: Part;
  /** The outline group: pixels of different groups are outlined where they meet; folded into 1..511. */
  group?: number;
  /** Drawn as pixel art when the pixel filter is on, whatever its scope. */
  pixelArt?: boolean;
}

/** A tag as the composite reads it. */
export interface Flags {
  part: Part;
  group: number;
  pixelArt: boolean;
}

/** `n` folded into the groups 1..511 (0 and below stay 0, the background's). */
export function foldGroup(n: number): number {
  return n >= 1 ? ((Math.floor(n) - 1) % GROUPS) + 1 : 0;
}

/** The packed value of a part, group and pixel-art flag (see the file comment). */
export function packFlags(part: Part, group: number, pixelArt: boolean): number {
  const g = foldGroup(group) || 1;
  const value =
    g + (part === 'character' ? FLAG_BITS.character + FLAG_BITS.actor : part === 'object' ? FLAG_BITS.actor : 0);
  return pixelArt ? -value : value;
}

/** The part, group and pixel-art flag of a packed value; 0 or 1 (the cleared background) is the environment. */
export function unpackFlags(w: number): Flags {
  const a = Math.round(Math.abs(w));
  const part: Part =
    a >= FLAG_BITS.character + FLAG_BITS.actor ? 'character' : a >= FLAG_BITS.actor ? 'object' : 'environment';
  return { part, group: a % FLAG_BITS.character, pixelArt: w < 0 };
}

/** Tags `object` (and what it holds) with a part of the scene, an outline group and the pixel-art flag. */
export function setPart(object: Object3D, part: Part, options: Omit<PostTag, 'part'> = {}): Object3D {
  object.userData.post = { part, ...options } satisfies PostTag;
  return object;
}

/** The first value `read` finds on `object` or its ancestors. */
function lookUp<T>(object: Object3D, read: (node: Object3D) => T | undefined): T | undefined {
  for (let node: Object3D | null = object; node; node = node.parent) {
    const value = read(node);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** The flags `object` is drawn with (see the file comment). */
export function flagsOf(object: Object3D): Flags {
  const tag = lookUp(object, (node) => node.userData.post as PostTag | undefined);
  const entity = lookUp(object, (node) =>
    typeof node.userData.entity === 'number' ? node.userData.entity : undefined,
  );
  const actor = lookUp(object, (node) =>
    node.userData.protagonist === true || node.userData.body !== undefined ? true : undefined,
  );
  const part: Part = tag?.part ?? (actor ? 'character' : entity !== undefined ? 'object' : 'environment');
  const group = foldGroup(tag?.group ?? entity ?? (part === 'environment' ? 1 : object.id)) || 1;
  return { part, group, pixelArt: tag?.pixelArt === true };
}

/** The MRT the scene pass draws: the colour, and the view normal with the object's packed flags in `w`. */
function sceneMrt(): Node {
  const flags = uniform(0);
  flags.onObjectUpdate(({ object }) => {
    if (!object) return 1;
    const { part, group, pixelArt } = flagsOf(object);
    return packFlags(part, group, pixelArt);
  });
  // Lines and points have no normals: they read as facing the camera, and keep their flags.
  const normal = Fn((builder: NodeBuilder) =>
    builder.geometry?.hasAttribute('normal') ? vec4(normalView, flags) : vec4(vec3(0, 0, 1), flags),
  )();
  return mrt({ output, normal });
}

/** The scene pass: `scene` through `camera` into colour, normals with flags, and depth (the fixed MRT). */
export function createScenePass(scene: Scene, camera: Camera): PassNode {
  const scenePass = pass(scene, camera);
  scenePass.setMRT(sceneMrt() as ReturnType<typeof mrt>);
  return scenePass;
}

/** Turns the scene pass's MRT on for what the renderer compiles or draws next (the warm-up's compile steps). */
export function useSceneMrt(renderer: WebGPURenderer, scenePass: PassNode): void {
  renderer.setMRT(scenePass.getMRT());
}

/** Turns any MRT off, as the frame's own drawing expects. */
export function clearMrt(renderer: WebGPURenderer): void {
  if (renderer.getMRT() !== null) renderer.setMRT(null);
}
