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
 * zero normal with `w` = 1: the environment, never outlined from inside; the sky writes the same (`sceneMrt`).
 *
 * Each object's flags come from its tag (`setPart`, read by `flagsOf`). They live in a table the chain writes before
 * each frame (`writeFlags`), which the GPU reads at the object's slot (`createFlagTable` says why: a per-object uniform
 * missed tags set on objects that never move). A transparent object replaces the normal and flags under it: r182
 * blends only the first attachment.
 *
 * The warm-up (engine/gfx/warmup.ts) compiles for the render target the frame draws the scene into, but knows nothing
 * of MRT; r182's `PassNode.compileAsync` sets both. So the chain's warm-up pass for the scene pass's own target turns
 * this MRT on as it enters (`useSceneMrt`) and off as it leaves (`clearMrt`): every compile step for it, the material
 * styles' among them, builds the MRT variant the frame draws. The pass's target holds both attachments from the start
 * (`createScenePass`): r182's `MRTNode` writes only the outputs its target has textures for, so a compile made before
 * the chain first asked for `normal` built a one-attachment variant no frame drew (measured at gate G6's review).
 *
 * Invariants: presentation only (nothing here reaches the sim); a tag never changes a material; `packFlags` and
 * `unpackFlags` are inverse for every part, group 1..511 and pixel-art flag; a tag takes effect on the next frame,
 * whether or not the object moves; slot 0 is never given out and always holds the environment's flags.
 *
 * @example
 * packFlags('character', 7, false); // 1543: 7 + 512 + 1024
 * unpackFlags(-1031); // { part: 'object', group: 7, pixelArt: true }
 * // const scenePass = createScenePass(scene, camera); // colour, normals with flags, depth
 * // setPart(hero, 'character', { pixelArt: true });
 * // writeFlags(scenePass); // before each frame: the hero is pixel art from this frame on
 * @see engine/gfx/post/mrt.test.ts
 * @see tests/e2e/post.spec.ts
 */
import { dot, float, Fn, mrt, normalView, output, pass, renderGroup, select, uniform, uniformArray, vec3, vec4 } from 'three/tsl'; // prettier-ignore
import { Vector4 } from 'three/webgpu';
import type { Camera, Node, NodeBuilder, Object3D, PassNode, Scene, UniformArrayNode, WebGPURenderer } from 'three/webgpu'; // prettier-ignore

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

/**
 * The flags `object` is drawn with: its tag (`setPart`), or its nearest tagged ancestor's; untagged objects count as
 * characters when they are a puppet (`userData.body`) or the protagonist (`userData.protagonist`), as objects when they
 * stand for an entity (`userData.entity`), and as the environment otherwise. The group is the tag's, else the entity's
 * id, else 1 for the environment and the object's own id for the rest. The engine's instanced drawers tag their own
 * roots, each in one group: the prop meshes (engine/gfx/props.ts) as objects, a crowd's bodies
 * (engine/gfx/puppets/crowd.ts) as characters; a crowd's blob shadows stay the environment.
 */
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

/** Slots in a flag table: four to a `vec4`, 4,096 of them, 64 KiB (WebGPU's smallest uniform buffer limit). */
export const FLAG_SLOTS = 16384;

/** The flags of every object a scene pass draws, by slot (see the file comment). */
export interface FlagTable {
  /** The render-group uniform array the MRT reads: slot `s` is component `s % 4` of row `s / 4`. */
  readonly node: UniformArrayNode;
  /** `object`'s slot, given out on first use and kept for life; 0 when every slot is taken. */
  slotOf(object: Object3D): number;
  /** Writes the flags of every drawable object under `root` at its slot; returns how many had no slot. */
  write(root: Object3D): number;
}

/** Whether three.js draws `object` (a mesh, line, points or sprite). */
function drawable(object: Object3D): boolean {
  const o = object as Object3D & { isMesh?: boolean; isLine?: boolean; isPoints?: boolean; isSprite?: boolean };
  return o.isMesh === true || o.isLine === true || o.isPoints === true || o.isSprite === true;
}

/**
 * Makes an empty flag table: each drawable object gets a slot, for life, and `write` puts every object's flags at its
 * slot, in one render-group uniform array the GPU reads at the slot. Measured on r182 (WP 7.4's review): a per-object
 * uniform is refreshed only when r182's `NodeMaterialObserver` refreshes the object, which it skips for an object that
 * has not moved and whose material has no node property, unless it is the first one drawn with that compiled
 * material, so a tag set after such an object's first frame never reached the picture until it moved. The slot, the
 * one per-object value left, never changes, so a skipped refresh cannot leave it stale. A slot is freed when its
 * object is collected; past `FLAG_SLOTS` live objects, the rest draw as the environment and `write` counts them
 * (advice `GFX_POST_FLAG_SLOTS`, engine/gfx/post/chain.ts).
 */
export function createFlagTable(): FlagTable {
  const rows = Array.from({ length: FLAG_SLOTS / 4 }, () => new Vector4());
  rows[0].x = packFlags('environment', 1, false);
  const node = uniformArray(rows, 'vec4').setGroup(renderGroup) as unknown as UniformArrayNode;
  const slots = new WeakMap<Object3D, number>();
  const free: number[] = [];
  const collected = new FinalizationRegistry<number>((slot) => free.push(slot));
  let next = 1;
  const slotOf = (object: Object3D) => {
    let slot = slots.get(object);
    if (slot === undefined) {
      slot = free.pop() ?? (next < FLAG_SLOTS ? next++ : 0);
      if (slot === 0) return 0;
      slots.set(object, slot);
      collected.register(object, slot);
    }
    return slot;
  };
  return {
    node,
    slotOf,
    write(root) {
      let missed = 0;
      root.traverse((object) => {
        if (!drawable(object)) return;
        const slot = slotOf(object);
        if (slot === 0) return void missed++;
        const { part, group, pixelArt } = flagsOf(object);
        rows[slot >> 2].setComponent(slot & 3, packFlags(part, group, pixelArt));
      });
      return missed;
    },
  };
}

/** Whether `object` or an ancestor is drawn behind everything (`userData.background`: the sky's dome and backdrop). */
function behindEverything(object: Object3D | undefined): boolean {
  if (object === undefined) return false;
  return lookUp(object, (node) => (node.userData.background === true ? true : undefined)) === true;
}

/**
 * The MRT the scene pass draws: the colour, and the view normal with the object's packed flags (from `table`) in `w`.
 * Lines and points have no normals: they read as facing the camera, and keep their flags. What the frame draws behind
 * everything (`behindEverything`: engine/gfx/sky.ts's dome and backdrop) writes the cleared background's (0, 0, 0, 1),
 * so no filter finds an edge in it: the outline inked the dome's box edges across the sky (WP 13.2's review). That is
 * decided as the object's program is built, which holds because such an object's material is its own (it draws it at
 * the far plane) and r182 keys a program by material and geometry, never by object.
 */
function sceneMrt(table: FlagTable): Node {
  const slot = uniform(0);
  slot.onObjectUpdate(({ object }) => (object ? table.slotOf(object) : 0));
  const row = slot.div(4).floor();
  const lane = slot.sub(row.mul(4));
  const pick = (k: number) => select(lane.equal(k), float(1), float(0));
  const flags = dot(table.node.element(row.toInt()), vec4(pick(0), pick(1), pick(2), pick(3)));
  const normal = Fn((builder: NodeBuilder) =>
    behindEverything(builder.object)
      ? vec4(0, 0, 0, 1)
      : builder.geometry?.hasAttribute('normal')
        ? vec4(normalView, flags)
        : vec4(vec3(0, 0, 1), flags),
  )();
  return mrt({ output, normal });
}

/** Each scene pass's flag table. */
const tables = new WeakMap<PassNode, FlagTable>();

/** The scene pass: `scene` through `camera` into colour, normals with flags, and depth (the fixed MRT). */
export function createScenePass(scene: Scene, camera: Camera): PassNode {
  const scenePass = pass(scene, camera);
  const table = createFlagTable();
  tables.set(scenePass, table);
  scenePass.setMRT(sceneMrt(table) as ReturnType<typeof mrt>);
  scenePass.getTextureNode('normal'); // its attachment, before anything compiles for the target (see the file comment)
  return scenePass;
}

/**
 * Writes the flags of everything `scenePass` draws into its table, as they are now: call it before each frame, so a
 * tag takes effect on the next one. Returns how many objects had no slot (drawn as the environment).
 */
export function writeFlags(scenePass: PassNode): number {
  return tables.get(scenePass)?.write(scenePass.scene) ?? 0;
}

/** Turns the scene pass's MRT on for what the renderer compiles or draws next (the warm-up's compile steps). */
export function useSceneMrt(renderer: WebGPURenderer, scenePass: PassNode): void {
  renderer.setMRT(scenePass.getMRT());
}

/** Turns any MRT off, as the frame's own drawing expects. */
export function clearMrt(renderer: WebGPURenderer): void {
  if (renderer.getMRT() !== null) renderer.setMRT(null);
}
