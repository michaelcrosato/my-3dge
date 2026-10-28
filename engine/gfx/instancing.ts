/**
 * @file The instancing service (PLAN.md WP 3.8, §4.7, Appendix B; I-15, I-19): `createInstancedBatch({ name,
 * geometry, material })` draws many copies of one geometry with one shared material, in pages of three.js
 * `InstancedMesh`es, and is the one place that knows r182's instancing quirks (its `InstanceNode`, measured):
 * - **One render late.** `InstanceNode` copies the matrices and colours into a buffer per render object (the frame,
 *   the shadow map and the ID pass each hold one) and syncs the copy's version in its node update, which runs after
 *   the renderer uploads the object's buffers: a change after a quiet frame shows one frame late, and a pass drawn
 *   now and then (a shot's ID pass) shows the change before (tests/e2e/instancing.spec.ts). Importing this module
 *   moves the sync before the upload (`syncBeforeUpload`, engine/gfx/instanceSync.ts: an `updateBefore` running the
 *   node's own update, once per render). On a release other than r182 it changes nothing, and `createInstancedBatch` advises
 *   `GFX_INSTANCING_UNPINNED` once (r185's rewrite syncs every frame).
 * - **The uniform-buffer limit.** Up to 1,000 slots, r182 reads the matrices from a uniform buffer sized by the
 *   capacity (WebGPU's 64 KiB binding), compiling a shader per mesh (`instancePath`); above, from an instanced
 *   attribute, one shader for every size. Pages have more than 1,000 slots (`pageSlots`, 1,024 by default; fewer is
 *   `GFX_INSTANCE_PAGE`), so a page added while playing builds no pipeline. (Storage buffers name their binding
 *   after the node, so they would compile a shader per page.)
 * - **Usage and update ranges.** r182 skips the sync for `DynamicDrawUsage` above 1,000 slots (§4.7), so pages keep
 *   `StaticDrawUsage` (ESLint bans the other) and upload through update ranges: `end()` uploads only the pages that
 *   changed (writing the value a slot holds changes nothing; a page's count changing does), each over its whole used
 *   part, so a pass drawn less often than every frame catches up in one upload.
 * - **Colours before the first render.** A first `setColorAt()` after a mesh's first render never shows, so every
 *   page is made with its colours (white) and per-instance attributes before it is drawn; pages are never
 *   reallocated (the node keeps the arrays it saw first), only added, and live until `dispose()`.
 * - The instance-transformed position is `positionLocal` (Appendix B): outline pushes read `positionGeometry`.
 *
 * Invariants: every page shares the batch's geometry (a page with per-instance attributes wraps its attributes and
 * index) and material, has the same slot count and is hidden while empty; `end()` leaves untouched pages untouched;
 * nothing here reaches the sim. `dispose()` frees the pages; the geometry and material stay the caller's.
 *
 * Carried from `Batch`, `my-3d2dge:src/stress-world/30-crowd.js:20-67` (no dynamic usage, more than 1,000 slots so
 * every mesh shares one shader, one update range over the used slots each frame), paged instead of regrown.
 *
 * @example
 * instancePath(1000); // 'uniform': a mesh this size compiles a shader of its own
 * instancePath(PAGE_SLOTS); // 'attribute': one shader for every size above 1,000
 * // const crowd = createInstancedBatch({ name: 'crowd:balls', geometry: new SphereGeometry(1), material });
 * // crowd.begin(); crowd.add(matrix.elements, [1, 0.2, 0.1]); crowd.end(); scene.add(crowd.root);
 * @see engine/gfx/instancing.test.ts
 * @see tests/e2e/instancing.spec.ts
 */
import {
  BufferGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  type Material,
  type Matrix4,
} from 'three/webgpu';
import { codeError, defineCodes, log as sharedLog, type Log } from '../core/log';
import { INSTANCE_SYNC } from './instanceSync';
import type { Warmup } from './warmup';

export { INSTANCE_SYNC, syncBeforeUpload } from './instanceSync';

/** The codes the instancing service raises, with their fixes. */
export const INSTANCING_CODES = defineCodes('gfx', {
  GFX_INSTANCE_PAGE: {
    template: 'instanced batch {name} asks for pages of {slots} slots',
    fix: 'give pageSlots a whole number above 1000 (1024 by default): at 1,000 or fewer, r182 keeps the matrices in a uniform buffer and compiles a shader for every page',
    doc: 'Raised by `createInstancedBatch` (engine/gfx/instancing.ts) for a page size of 1,000 slots or fewer, or not a whole number. r182 puts up to 1,000 instance matrices in a uniform buffer sized by the mesh, so each such page would build pipelines of its own; above 1,000 every page shares one shader (PLAN.md §4.7).',
  },
  GFX_INSTANCE_ATTRIBUTE: {
    template: 'instanced batch {name}: {problem}',
    fix: 'name per-instance attributes in the attributes option with an item size of 1 to 4, not instanceMatrix, instanceColor or an attribute the geometry has ({names})',
    doc: 'Raised by `createInstancedBatch` and `setAttributeAt` (engine/gfx/instancing.ts) for a per-instance attribute with an item size outside 1–4, one named like an attribute the geometry has or like `instanceMatrix`/`instanceColor`, or one the batch was not made with.',
  },
  GFX_INSTANCING_UNPINNED: {
    template: 'the instancing service did not move the instance sync before the upload: {problems}',
    fix: "instanced meshes may show a change one frame late; check the new release's InstanceNode and update syncBeforeUpload in engine/gfx/instanceSync.ts (PINNED_REVISION in engine/gfx/pipelines.ts)",
    doc: "Advice from `createInstancedBatch` (engine/gfx/instancing.ts), once, when three.js is not r182 or its `InstanceNode` lacks the `update`/`getUpdateBeforeType` the fix wraps: r182 uploads an instance change one render late, and the service's fix was not applied (r185's rewrite syncs every frame, which also fixes it).",
  },
  GFX_INSTANCE_SLOT: {
    template: 'instanced batch {name} has no slot {slot}',
    fix: 'pass a whole slot number of at least 0; slots above the capacity add pages, so only negative or fractional slots fail',
    doc: 'Raised by the slot methods of an instanced batch (engine/gfx/instancing.ts) for a slot that is negative, fractional or not a number.',
  },
});

/** r182's threshold: up to this many slots, an instanced mesh's matrices go to a uniform buffer (a shader per mesh). */
export const UNIFORM_INSTANCE_LIMIT = 1000;

/** The default page size: above `UNIFORM_INSTANCE_LIMIT`, so every page shares one shader. */
export const PAGE_SLOTS = 1024;

/** Where r182 reads an instanced mesh's matrices from, for a mesh of `slots` slots (see the file comment). */
export function instancePath(slots: number): 'uniform' | 'attribute' {
  return slots <= UNIFORM_INSTANCE_LIMIT ? 'uniform' : 'attribute';
}

/** A colour: three.js's `Color` (linear `r`, `g`, `b`) or linear `[r, g, b]`. */
export type InstanceColor = { r: number; g: number; b: number } | ArrayLike<number>;

/** How `createInstancedBatch` makes a batch. */
export interface InstancedBatchOptions {
  /** The batch's name: pages are named `<name>/page0`, `<name>/page1`… (the ID pass and the inspector show them). */
  name: string;
  /** The shape every instance draws; shared by every page, never disposed here. */
  geometry: BufferGeometry;
  /** The material every page shares (an array draws the geometry's groups). */
  material: Material | Material[];
  /** Slots per page, above 1,000 (1,024 by default). */
  pageSlots?: number;
  /** Per-instance attributes by name, with their item sizes (1–4), filled with 0. */
  attributes?: Readonly<Record<string, number>>;
  castShadow?: boolean;
  receiveShadow?: boolean;
  renderOrder?: number;
  /** Whether three.js culls a page by its bounds (false by default: instances may be anywhere). */
  frustumCulled?: boolean;
  /** Where advice goes (the shared log by default). */
  log?: Log;
}

/** A batch's pages, slots and instances, and the pages and bytes its last `end()` uploaded. */
export type InstancedBatchStats = Record<'pages' | 'capacity' | 'count' | 'uploadedPages' | 'uploadedBytes', number>;

/**
 * An instanced batch (see the file comment). Writing: `begin()`, `add(matrix, colour)` per instance (or `setMatrixAt`,
 * `setColorAt`, `setAttributeAt` by slot, and `count`), then `end()`. Slot `s` lives on page `floor(s / pageSlots)`.
 * Per-instance attributes (`attributes: { tint: 3 }`) are instanced vertex attributes a node material reads by name
 * (`attribute('tint')`): palette rows, tints. Matrices are column-major (`Matrix4.elements`); colours linear RGB.
 */
export interface InstancedBatch {
  readonly name: string;
  /** The group holding the pages: add it to the scene. */
  readonly root: Group;
  /** The pages, in slot order. */
  readonly pages: readonly InstancedMesh[];
  readonly pageSlots: number;
  /** Slots on all pages so far. */
  readonly capacity: number;
  /** How many instances are drawn, slots 0 to count − 1; setting it adds pages as needed. */
  count: number;
  /** Starts writing a frame's instances from slot 0 (count 0). */
  begin(): void;
  /** Writes the next slot: 16 matrix elements from `offset`, and its colour (white when left out); returns the slot. */
  add(matrix: ArrayLike<number>, color?: InstanceColor, offset?: number): number;
  /** Sets slot `slot`'s matrix (a `Matrix4` or 16 elements), adding pages as needed. Throws `GFX_INSTANCE_SLOT`. */
  setMatrixAt(slot: number, matrix: Matrix4 | ArrayLike<number>): void;
  /** Writes slot `slot`'s matrix into `out`. */
  getMatrixAt(slot: number, out: Matrix4): Matrix4;
  /** Sets slot `slot`'s colour. Throws `GFX_INSTANCE_SLOT`. */
  setColorAt(slot: number, color: InstanceColor): void;
  /** Sets slot `slot`'s per-instance attribute `name`. Throws `GFX_INSTANCE_ATTRIBUTE`, `GFX_INSTANCE_SLOT`. */
  setAttributeAt(name: string, slot: number, values: ArrayLike<number>): void;
  /** Sets each page's count and the update ranges of the pages that changed (see the file comment). */
  end(): void;
  /** Draw calls a frame costs: one per non-empty page and material group, again per shadow map when casting. */
  drawCalls(shadowMaps?: number): number;
  stats(): InstancedBatchStats;
  /** Registers every page, present and future, with `warmup` as `id` (`batch:<name>` by default). */
  register(warmup: Pick<Warmup, 'register'>, id?: string): { dispose(): void };
  /** Frees the pages, removes the root from its parent and unregisters. */
  dispose(): void;
}

/** One page: its mesh, its arrays, how many slots it shows and whether it changed since the last `end()`. */
interface Page {
  mesh: InstancedMesh;
  matrices: Float32Array;
  colors: Float32Array;
  extras: Map<string, InstancedBufferAttribute>;
  wrapper: BufferGeometry | null;
  shown: number;
  dirty: boolean;
}

/** The colour a slot gets when none is given. */
const WHITE = [1, 1, 1];

/** Makes an instanced batch (see the file comment). Throws `GFX_INSTANCE_PAGE`, `GFX_INSTANCE_ATTRIBUTE`. */
export function createInstancedBatch(options: InstancedBatchOptions): InstancedBatch {
  const { name, geometry, material } = options;
  const slots = options.pageSlots ?? PAGE_SLOTS;
  if (!Number.isInteger(slots) || instancePath(slots) === 'uniform') {
    throw codeError('GFX_INSTANCE_PAGE', { name, slots });
  }
  const extraSizes = new Map(Object.entries(options.attributes ?? {}));
  const geometryNames = Object.keys(geometry.attributes);
  const attributeError = (problem: string) =>
    codeError('GFX_INSTANCE_ATTRIBUTE', { name, problem, names: geometryNames.join(', ') });
  for (const [key, size] of extraSizes) {
    if (!Number.isInteger(size) || size < 1 || size > 4) throw attributeError(`${key} has item size ${size}`);
    if (['instanceMatrix', 'instanceColor', ...geometryNames].includes(key)) throw attributeError(`${key} is taken`);
  }
  if (!INSTANCE_SYNC.patched) {
    (options.log ?? sharedLog).warnOnce('GFX_INSTANCING_UNPINNED', { problems: INSTANCE_SYNC.problems.join('; ') });
  }
  const root = new Group();
  root.name = name;
  const pages: Page[] = [];
  const meshes: InstancedMesh[] = [];
  const registrations = new Set<{ dispose(): void }>();
  let count = 0;
  let last = { uploadedPages: 0, uploadedBytes: 0 };

  /** A page's geometry: the batch's own, or a wrapper sharing its attributes with the per-instance ones added. */
  function pageGeometry(extras: Map<string, InstancedBufferAttribute>): BufferGeometry | null {
    if (!extras.size) return null;
    const wrapper = new BufferGeometry();
    wrapper.setIndex(geometry.getIndex());
    for (const [key, attribute] of Object.entries(geometry.attributes)) wrapper.setAttribute(key, attribute);
    for (const [key, attribute] of extras) wrapper.setAttribute(key, attribute);
    for (const group of geometry.groups) wrapper.addGroup(group.start, group.count, group.materialIndex);
    wrapper.boundingBox = geometry.boundingBox;
    wrapper.boundingSphere = geometry.boundingSphere;
    return wrapper;
  }

  /** Adds one page, with its colours and per-instance attributes made before it is ever drawn. */
  function addPage(): Page {
    const extras = new Map(
      [...extraSizes].map(([key, size]) => [key, new InstancedBufferAttribute(new Float32Array(slots * size), size)]),
    );
    const wrapper = pageGeometry(extras);
    const mesh = new InstancedMesh(wrapper ?? geometry, material, slots);
    const colors = new Float32Array(slots * 3).fill(1);
    mesh.instanceColor = new InstancedBufferAttribute(colors, 3);
    const { frustumCulled = false, castShadow = false, receiveShadow = false, renderOrder = 0 } = options;
    Object.assign(mesh, { name: `${name}/page${pages.length}`, count: 0, visible: false, frustumCulled });
    Object.assign(mesh, { castShadow, receiveShadow, renderOrder, userData: { batch: name, page: pages.length } });
    const matrices = mesh.instanceMatrix.array as Float32Array;
    const page: Page = { mesh, matrices, colors, extras, wrapper, shown: 0, dirty: false };
    pages.push(page);
    meshes.push(mesh);
    root.add(mesh);
    return page;
  }

  /** The page holding slot `slot` and the slot's index on it, adding pages up to it. Throws `GFX_INSTANCE_SLOT`. */
  function locate(slot: number): [Page, number] {
    if (!Number.isInteger(slot) || slot < 0) throw codeError('GFX_INSTANCE_SLOT', { name, slot });
    const p = Math.floor(slot / slots);
    while (pages.length <= p) addPage();
    return [pages[p], slot - p * slots];
  }

  /** Writes `n` values from `values[offset]` into `array[start]`; marks the page changed only when a value differs. */
  function write(page: Page, array: Float32Array, start: number, values: ArrayLike<number>, offset: number, n: number) {
    for (let k = 0; k < n; k++) {
      const value = Math.fround(values[offset + k]);
      if (array[start + k] === value) continue;
      array[start + k] = value;
      page.dirty = true;
    }
  }

  /** Writes slot `i`'s colour on `page` (white when left out). */
  function writeColor(page: Page, i: number, color: InstanceColor | undefined): void {
    const rgb = !color ? WHITE : 'r' in color ? [color.r, color.g, color.b] : color;
    write(page, page.colors, i * 3, rgb, 0, 3);
  }

  addPage();
  const batch: InstancedBatch = {
    name,
    root,
    pages: meshes,
    pageSlots: slots,
    get capacity() {
      return pages.length * slots;
    },
    get count() {
      return count;
    },
    set count(value: number) {
      if (value > 0) locate(Math.ceil(value) - 1);
      count = Math.max(0, Math.ceil(value));
    },
    begin() {
      count = 0;
    },
    add(matrix, color, offset = 0) {
      const slot = count;
      const [page, i] = locate(slot);
      write(page, page.matrices, i * 16, matrix, offset, 16);
      writeColor(page, i, color);
      count = slot + 1;
      return slot;
    },
    setMatrixAt(slot, matrix) {
      const [page, i] = locate(slot);
      write(page, page.matrices, i * 16, 'elements' in matrix ? matrix.elements : matrix, 0, 16);
    },
    getMatrixAt(slot, out) {
      const p = Math.floor(slot / slots);
      if (!Number.isInteger(slot) || slot < 0 || p >= pages.length)
        throw codeError('GFX_INSTANCE_SLOT', { name, slot });
      return out.fromArray(pages[p].matrices, (slot - p * slots) * 16);
    },
    setColorAt(slot, color) {
      const [page, i] = locate(slot);
      writeColor(page, i, color);
    },
    setAttributeAt(key, slot, values) {
      const size = extraSizes.get(key);
      if (size === undefined) throw attributeError(`it has no per-instance attribute ${key}`);
      const [page, i] = locate(slot);
      const attribute = page.extras.get(key)!;
      write(page, attribute.array as Float32Array, i * size, values, 0, size);
    },
    end() {
      let uploadedPages = 0;
      let uploadedBytes = 0;
      pages.forEach((page, p) => {
        const shown = Math.min(slots, Math.max(0, count - p * slots));
        const { mesh } = page;
        mesh.count = shown;
        mesh.visible = shown > 0;
        if (shown !== page.shown) page.dirty = true;
        page.shown = shown;
        if (!page.dirty) return;
        page.dirty = false;
        mesh.boundingSphere = null;
        mesh.boundingBox = null;
        if (!shown) return;
        const ranged = [mesh.instanceMatrix, mesh.instanceColor!, ...page.extras.values()];
        for (const attribute of ranged) {
          attribute.clearUpdateRanges();
          attribute.addUpdateRange(0, shown * attribute.itemSize);
          attribute.needsUpdate = true;
          uploadedBytes += shown * attribute.itemSize * 4;
        }
        uploadedPages++;
      });
      last = { uploadedPages, uploadedBytes };
    },
    drawCalls(shadowMaps = 0) {
      const groups = Array.isArray(material) ? Math.max(1, geometry.groups.length) : 1;
      const perPage = groups * (1 + (options.castShadow ? shadowMaps : 0));
      return pages.filter((page) => page.shown > 0).length * perPage;
    },
    stats() {
      return { pages: pages.length, capacity: pages.length * slots, count, ...last };
    },
    register(warmup, id = `batch:${name}`) {
      const entry = warmup.register(id, { objects: () => meshes });
      const registration = {
        dispose() {
          registrations.delete(registration);
          entry.dispose();
        },
      };
      registrations.add(registration);
      return registration;
    },
    dispose() {
      for (const registration of [...registrations]) registration.dispose();
      for (const page of pages) {
        page.mesh.dispose();
        page.wrapper?.dispose();
      }
      root.removeFromParent();
    },
  };
  return batch;
}
