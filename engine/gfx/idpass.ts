/**
 * @file The ID pass (PLAN.md §8.5, I-28): every drawable object in a flat colour of its own, unlit, without
 * antialiasing, so a readback says which object covers each pixel and an agent reads "the hero covers 0 px" or "one
 * object covers 71%: the camera is inside a wall" as text. `listDrawables(scene, camera)` lists every mesh, line,
 * point cloud and sprite under the scene, in traversal order, with its name (or `<named ancestor>/<type>#<id>`), the
 * entity it stands for (`userData.entity` on it or an ancestor), whether it is the protagonist (`userData.protagonist`
 * on it or an ancestor, or the name `options.protagonist`), its ID colour, and why it cannot be seen when that is
 * known before drawing: `hidden` (it or an ancestor is invisible, its layers miss the camera's, an instanced mesh
 * with no instances) or `outside` (its bounds miss the view frustum). `withIdScene(renderer, scene, table, draw)`
 * hands `draw` a stand-in scene sharing the scene's children, with no background and the ID material as its
 * override material, and the clear colour transparent black; the scene itself is never touched. `decodeIds` turns
 * the RGBA readback into the result, `visible: [{ id, name, px, share, bbox, centre }]` (largest first) and
 * `unseen: [{ id, name, reason }]` (`hidden`, `outside`, or `covered`: in view, 0 px), so every object is reported.
 * `marksOf` numbers what the pass sees and `drawMarks` draws the numbers onto a frame, for `x shot --marks`
 * (shardfall's `see`, `shardfall:crates/pav_tools/src/agent_tools.rs:26-224`, marking only what is seen).
 *
 * The ID material is a `MeshBasicNodeMaterial` whose `fragmentNode` is the object's colour, a per-object uniform set
 * through `onObjectUpdate`, so lighting, fog, tone mapping and colour space never touch it; it is drawn double-sided
 * and discards the faces the object's own material culls, and three.js gives it the object's `positionNode`,
 * `transparent` and alpha test, so displaced, instanced and skinned geometry covers what it covers in the frame.
 * Colours are `idColour(n)`, an odd multiple of `n` modulo 2^24: distinct, never black, and far apart for neighbours.
 *
 * Invariants: GPU results never reach the sim; the pass changes nothing the frame draws (the stand-in scene and the
 * clear colour are put back); a pixel either is empty space (transparent black), belongs to exactly one object, or
 * is counted as `stray`. Sprites are drawn as their quads, unbillboarded; a material with `allowOverride: false`
 * keeps its own colours, and its pixels count as stray.
 *
 * @example
 * idColour(1); // 0x5bd1e9
 * @see engine/gfx/idpass.test.ts
 * @see tests/e2e/shot.spec.ts
 */
import {
  BackSide,
  Color,
  DoubleSide,
  FrontSide,
  Frustum,
  Matrix4,
  MeshBasicNodeMaterial,
  Scene,
  Vector3,
  type Camera,
  type InstancedMesh,
  type Material,
  type Mesh,
  type Object3D,
  type Sprite,
  type WebGPURenderer,
} from 'three/webgpu';
import { Discard, Fn, frontFacing, uniform, vec4 } from 'three/tsl';
import { STRAY } from './thumbnail';

/** Why a drawable object covers no pixel. */
export type UnseenReason = 'hidden' | 'outside' | 'covered';

/** A drawable object of the scene, as the ID pass knows it. */
export interface Drawable {
  object: Object3D;
  /** three.js's object id (unique in the page). */
  id: number;
  name: string;
  /** The ID colour, `0xrrggbb`. */
  colour: number;
  /** The sim entity it stands for, if any. */
  entity?: number;
  /** The protagonist's name when this object is (part of) the protagonist. */
  protagonist?: string;
  /** Why it cannot be seen, when known before drawing. */
  reason: 'hidden' | 'outside' | null;
}

/** The drawables of a scene, with their colours. */
export interface IdTable {
  drawables: Drawable[];
  /** ID colour → index in `drawables`. */
  byColour: Map<number, number>;
}

/** One visible object: its pixels, share of the frame, bounding box `[x0, y0, x1, y1]` (inclusive, from the top left). */
export interface IdEntry {
  id: number;
  name: string;
  px: number;
  share: number;
  bbox: [number, number, number, number];
  /** The object's pixel nearest the centroid of its pixels: where to point at it. */
  centre: [number, number];
  entity?: number;
  protagonist?: boolean;
}

/** One object drawn in no pixel, and why. */
export interface IdUnseen {
  id: number;
  name: string;
  reason: UnseenReason;
  entity?: number;
  protagonist?: boolean;
}

/** The ID pass's result: every drawable object, visible or not. */
export interface IdPass {
  width: number;
  height: number;
  /** Drawable objects in the scene. */
  objects: number;
  /** The objects covering at least one pixel, largest first. */
  visible: IdEntry[];
  /** The others, in scene order. */
  unseen: IdUnseen[];
  /** Pixels of empty space. */
  empty: number;
  /** Pixels in a colour the pass did not assign. */
  stray: number;
  /** The protagonist and the pixels it covers; null when the scene has none. */
  protagonist: { name: string; px: number } | null;
}

/** A numbered mark on what the ID pass sees, for the legend. */
export interface Mark {
  n: number;
  id: number;
  name: string;
  px: number;
  /** Where the mark is drawn: the object's `centre`. */
  at: [number, number];
}

/** The ID colour of the `n`-th drawable (1-based): an odd multiple modulo 2^24, so distinct and never 0. */
export function idColour(n: number): number {
  return Math.imul(n, 0x5bd1e9) & 0xffffff;
}

type Drawn = Object3D & { isMesh?: boolean; isLine?: boolean; isPoints?: boolean; isSprite?: boolean };

/** The first ancestor (or `object`) for which `test` gives a value. */
function lookUp<T>(object: Object3D, test: (node: Object3D) => T | undefined): T | undefined {
  for (let node: Object3D | null = object; node; node = node.parent) {
    const found = test(node);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Lists the scene's drawable objects with their colours, and why the hidden and out-of-view ones cannot be seen. */
export function listDrawables(scene: Object3D, camera: Camera, options: { protagonist?: string } = {}): IdTable {
  scene.updateMatrixWorld();
  if (camera.parent === null) camera.updateMatrixWorld();
  const frustum = new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    camera.coordinateSystem,
  );
  const drawables: Drawable[] = [];
  const byColour = new Map<number, number>();
  scene.traverse((node) => {
    const object = node as Drawn;
    if (!(object.isMesh || object.isLine || object.isPoints || object.isSprite)) return;
    const named = object.parent && lookUp(object.parent, (up) => (up.name ? up.name : undefined));
    const name = object.name || `${named ? `${named}/` : ''}${object.type}#${object.id}`;
    const instanced = object as unknown as InstancedMesh;
    const hidden =
      lookUp(object, (up) => (up.visible ? undefined : true)) === true ||
      !object.layers.test(camera.layers) ||
      (instanced.isInstancedMesh === true && instanced.count === 0);
    const inView = object.isSprite
      ? frustum.intersectsSprite(object as unknown as Sprite)
      : frustum.intersectsObject(object as unknown as Mesh);
    const colour = idColour(drawables.length + 1);
    const drawable: Drawable = {
      object,
      id: object.id,
      name,
      colour,
      reason: hidden ? 'hidden' : inView ? null : 'outside',
    };
    const entity = lookUp(object, (up) => (typeof up.userData.entity === 'number' ? up.userData.entity : undefined));
    if (entity !== undefined) drawable.entity = entity;
    const protagonist = lookUp(object, (up) =>
      up.userData.protagonist === true || (options.protagonist !== undefined && up.name === options.protagonist)
        ? up.name || name
        : undefined,
    );
    if (protagonist !== undefined) drawable.protagonist = protagonist;
    byColour.set(colour, drawables.length);
    drawables.push(drawable);
  });
  return { drawables, byColour };
}

/** A renderer's ID material, its stand-in scene, and the table the material reads while a pass runs. */
interface IdKit {
  material: MeshBasicNodeMaterial;
  scene: Scene;
  current: Map<Object3D, Drawable>;
}

const KITS = new WeakMap<WebGPURenderer, IdKit>();

/** The ID material and stand-in scene of `renderer`, made on first use. */
function kitOf(renderer: WebGPURenderer): IdKit {
  const known = KITS.get(renderer);
  if (known) return known;
  const current = new Map<Object3D, Drawable>();
  const sideOf = (object: Object3D) => {
    const material = (object as Mesh).material as Material | Material[] | undefined;
    return (Array.isArray(material) ? material[0] : material)?.side ?? FrontSide;
  };
  const colour = uniform(new Vector3());
  colour.onObjectUpdate(({ object }) => {
    const value = object ? (current.get(object)?.colour ?? 0) : 0;
    colour.value.set(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
  });
  const side = uniform(FrontSide as number);
  side.onObjectUpdate(({ object }) => void (side.value = object ? sideOf(object) : FrontSide));
  const material = new MeshBasicNodeMaterial({ side: DoubleSide, fog: false });
  material.name = 'IdPass.material';
  material.lights = false;
  material.forceSinglePass = true;
  material.fragmentNode = Fn(() => {
    Discard(side.equal(FrontSide).and(frontFacing.not()));
    Discard(side.equal(BackSide).and(frontFacing));
    return vec4(colour, 1);
  })();
  const scene = new Scene();
  scene.name = 'IdPass.scene';
  scene.overrideMaterial = material;
  const kit = { material, scene, current };
  KITS.set(renderer, kit);
  return kit;
}

/**
 * Runs `draw(root)` with `root` a stand-in for `scene` that draws the ID pass: it shares the scene's children, has
 * no background, and overrides every material with the ID material reading `table`; the clear colour is transparent
 * black meanwhile. Draw `root` into an RGBA8 target with no samples, then read it back and `decodeIds`.
 */
export function withIdScene(
  renderer: WebGPURenderer,
  scene: Object3D,
  table: IdTable,
  draw: (root: Scene) => void,
): void {
  const kit = kitOf(renderer);
  for (const drawable of table.drawables) kit.current.set(drawable.object, drawable);
  // r182 keeps the clear colour as a Color4, which three/webgpu does not export; a Color takes its r, g and b.
  const clear = renderer.getClearColor(new Color() as unknown as Parameters<WebGPURenderer['getClearColor']>[0]);
  const alpha = renderer.getClearAlpha();
  const autoClear = renderer.autoClear;
  // Shared, not moved: each child keeps `scene` as its parent, so its world matrix is unchanged.
  kit.scene.children = scene.children;
  try {
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = true;
    draw(kit.scene);
  } finally {
    kit.scene.children = [];
    kit.current.clear();
    renderer.setClearColor(clear, alpha);
    renderer.autoClear = autoClear;
  }
}

/** Decodes an ID-pass readback (RGBA, top row first) into the result, and each pixel's visible object (1-based). */
export function decodeIds(
  rgba: Uint8Array,
  width: number,
  height: number,
  table: IdTable,
): { pass: IdPass; pixels: Uint32Array } {
  const { drawables, byColour } = table;
  const count = drawables.length;
  const total = width * height;
  const owner = new Uint32Array(total);
  const px = new Uint32Array(count);
  const sum = new Float64Array(count * 2);
  const box = new Int32Array(count * 4).fill(-1);
  let empty = 0;
  let stray = 0;
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    if (key === 0 && rgba[i + 3] === 0) {
      empty++;
      continue;
    }
    const index = byColour.get(key);
    if (index === undefined) {
      owner[p] = STRAY;
      stray++;
      continue;
    }
    owner[p] = index + 1;
    const [x, y] = [p % width, Math.floor(p / width)];
    sum[index * 2] += x;
    sum[index * 2 + 1] += y;
    const b = index * 4;
    if (px[index]++ === 0) box.set([x, y, x, y], b);
    // Rows come top to bottom: the first pixel has the smallest y, the latest the largest.
    [box[b], box[b + 2], box[b + 3]] = [Math.min(box[b], x), Math.max(box[b + 2], x), y];
  }
  // Each object's pixel nearest the centroid of its pixels.
  const best = new Float64Array(count).fill(Infinity);
  const centre = new Int32Array(count * 2);
  for (let p = 0; p < total; p++) {
    const index = owner[p] - 1;
    if (index < 0 || owner[p] === STRAY) continue;
    const [x, y] = [p % width, Math.floor(p / width)];
    const d = (x - sum[index * 2] / px[index]) ** 2 + (y - sum[index * 2 + 1] / px[index]) ** 2;
    if (d < best[index]) [best[index], centre[index * 2], centre[index * 2 + 1]] = [d, x, y];
  }
  const share = (n: number) => Math.round((n / total) * 10_000) / 10_000;
  const tags = (d: Drawable) => ({
    ...(d.entity !== undefined ? { entity: d.entity } : {}),
    ...(d.protagonist !== undefined ? { protagonist: true } : {}),
  });
  const order = drawables.map((_, i) => i).filter((i) => px[i] > 0);
  order.sort((a, b) => px[b] - px[a] || a - b);
  const visible: IdEntry[] = order.map((i) => ({
    id: drawables[i].id,
    name: drawables[i].name,
    px: px[i],
    share: share(px[i]),
    bbox: [box[i * 4], box[i * 4 + 1], box[i * 4 + 2], box[i * 4 + 3]],
    centre: [centre[i * 2], centre[i * 2 + 1]],
    ...tags(drawables[i]),
  }));
  const unseen: IdUnseen[] = drawables
    .map((d, i) => ({ d, i }))
    .filter(({ i }) => px[i] === 0)
    .map(({ d }) => ({ id: d.id, name: d.name, reason: d.reason ?? 'covered', ...tags(d) }));
  const rank = new Uint32Array(count);
  order.forEach((i, k) => (rank[i] = k + 1));
  const pixels = owner.map((value) => (value === 0 || value === STRAY ? value : rank[value - 1]));
  const lead = drawables.find((d) => d.protagonist !== undefined);
  const protagonist = lead
    ? {
        name: lead.protagonist!,
        px: drawables.reduce((n, d, i) => n + (d.protagonist === lead.protagonist ? px[i] : 0), 0),
      }
    : null;
  return { pass: { width, height, objects: count, visible, unseen, empty, stray, protagonist }, pixels };
}

/** Numbers the visible objects, largest first: at most `max` (40), each covering at least `minPx` (4) pixels. */
export function marksOf(pass: IdPass, options: { max?: number; minPx?: number } = {}): Mark[] {
  const { max = 40, minPx = 4 } = options;
  return pass.visible
    .filter((entry) => entry.px >= minPx)
    .slice(0, max)
    .map((entry, i) => ({ n: i + 1, id: entry.id, name: entry.name, px: entry.px, at: entry.centre }));
}

/** The digits 0–9 in a 3 × 5 pixel font, each 15 bits row by row, separated by spaces. */
const DIGITS =
  '111101101101111 010110010010111 111001111100111 111001111001111 101101111001001 111100111001111 111100111101111 111001001001001 111101111101111 111101111001111'.split(
    ' ',
  );
const MARK_COLOUR = [255, 230, 120];
const INK = [10, 10, 14];

/**
 * Draws each mark onto a frame of RGBA bytes (top row first): a ring around `at` and the number in a dark box above
 * it (below it at the top edge), at 2 × scale. Pixels outside the frame are skipped.
 */
export function drawMarks(rgba: Uint8Array, width: number, height: number, marks: readonly Mark[]): void {
  const put = (x: number, y: number, colour: number[], alpha = 1) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (Math.round(y) * width + Math.round(x)) * 4;
    for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(rgba[i + c] * (1 - alpha) + colour[c] * alpha);
    rgba[i + 3] = 255;
  };
  for (const { n, at } of marks) {
    const [cx, cy] = at;
    for (let dy = -9; dy <= 9; dy++) {
      for (let dx = -9; dx <= 9; dx++) {
        const d = Math.hypot(dx, dy);
        if (d >= 5.5 && d <= 7.5) put(cx + dx, cy + dy, MARK_COLOUR);
        else if (d > 7.5 && d <= 8.5) put(cx + dx, cy + dy, INK, 0.7);
      }
    }
    const text = String(n);
    const [scale, glyph] = [2, 8];
    const textWidth = text.length * glyph - 2;
    const left = Math.round(cx - textWidth / 2);
    const top = cy - 12 - 5 * scale >= 2 ? cy - 12 - 5 * scale : cy + 12;
    for (let y = top - 2; y < top + 5 * scale + 2; y++)
      for (let x = left - 2; x < left + textWidth + 2; x++) put(x, y, INK, 0.8);
    [...text].forEach((digit, k) => {
      const bits = DIGITS[Number(digit)];
      for (let bit = 0; bit < 15; bit++) {
        if (bits[bit] !== '1') continue;
        const [gx, gy] = [left + k * glyph + (bit % 3) * scale, top + Math.floor(bit / 3) * scale];
        for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) put(gx + sx, gy + sy, MARK_COLOUR);
      }
    });
  }
}
