/**
 * @file Outline shells (PLAN.md WP 7.2, §4.1, §6.7, Appendix B): the inverted hull, carried from `outlineMat`
 * (`my-3d2dge:src/stress-world/00-setup.js:96-116`). A shell is the same mesh again, back faces only, in one flat
 * colour, each vertex pushed `width` pixels outward on the screen, so the part's silhouette gains a line of that
 * width. `createOutline({ color, width, mode })` makes the material; `outline.shell(mesh)` adds a shell to a mesh as
 * its child, and `outline.batch(batch)` shells every page of an instanced batch (engine/gfx/instancing.ts), each page's
 * shell sharing its instance matrices: call `sync()` after the batch's `end()`, and `register(warmup)` once.
 *
 * The push (`material.positionNode`, so the ID pass and every pass that copies it draw the shell where the frame
 * does): its direction is the vertex's normal (`mode: 'normal'`, for round parts) or the way from the part's centre
 * (`'centre'`, for boxes, whose face normals would split the hull at the corners), both taken from the geometry
 * (`positionGeometry`, `normalGeometry`) and turned by the instance's own matrix. The prototype pushed along
 * `positionLocal`, which r182 has already moved by the instance, so instanced boxes were pushed away from the batch's
 * origin instead of their own centres (§4.1); ESLint now bans that name here. Measured on r182: the instance's
 * matrix lives inside its `InstanceNode`, which the push reads from the vertex stage's stack (the one reader of that
 * internal), and the node moves what `positionNode` returns by the instance afterwards, so the push returns the
 * geometry's vertex plus the offset taken back through the instance's turn. On a release where the node is missing,
 * advice `GFX_OUTLINE_UNPINNED` says so once, and instanced shells are pushed as if their instances stood unturned at
 * the batch's origin. The offset is solved in view space, parallel to the picture, so it is `width` pixels of the
 * target drawn into (`screenSize`) at any depth and in either projection.
 *
 * Invariants: `width` and `color` are uniforms (changing them builds nothing); shells cast and receive no shadows,
 * have no fog and carry `userData.outline`; a skinned mesh gets no shell (`GFX_OUTLINE_TARGET`), since the push
 * reads the vertex before skinning.
 *
 * @example
 * const outline = createOutline({ color: '#1a1420', width: 2, mode: 'centre' });
 * outline.width; // 2
 * outline.material.side; // 1: BackSide, the hull's inside
 * @see engine/gfx/materials/outline.test.ts
 * @see tests/e2e/materials-v2.spec.ts
 */
import {
  cameraProjectionMatrix,
  cameraWorldMatrix,
  cross,
  float,
  Fn,
  int,
  max,
  modelViewMatrix,
  modelWorldMatrixInverse,
  normalGeometry,
  positionGeometry,
  screenSize,
  step,
  transformNormal,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import {
  BackSide,
  Color,
  InstancedMesh,
  InstanceNode,
  MeshBasicNodeMaterial,
  Mesh,
  type Node,
  type NodeBuilder,
  type Object3D,
} from 'three/webgpu';
import { codeError, defineCodes, log as sharedLog, type Log } from '../../core/log';
import type { InstancedBatch } from '../instancing';
import type { Warmup } from '../warmup';

/** The codes this module raises, with their fixes. */
export const OUTLINE_CODES = defineCodes('gfx', {
  GFX_OUTLINE_UNPINNED: {
    template: 'outline shells cannot find the instance matrix of {object}',
    fix: "instanced shells are pushed as if their instances stood unturned at the origin; check the new release's InstanceNode (instanceMatrixNode, and whether it still moves positionNode's result) and update instanceMatrixOf and pushNode in engine/gfx/materials/outline.ts",
    doc: "Advice from an outline shell's push (engine/gfx/materials/outline.ts), once, when an instanced mesh's vertex stage holds no r182 `InstanceNode` with an `instanceMatrixNode`: the push reads the instance's matrix there, so on another three.js release instanced shells are pushed the wrong way.",
  },
  GFX_OUTLINE_TARGET: {
    template: 'outline shells cannot outline {object}: {problem}',
    fix: 'give shells to meshes and instanced batches; outline a skinned mesh with the edge outline filter (WP 7.4) instead',
    doc: "Raised by `outline.shell` (engine/gfx/materials/outline.ts) for an object that is not a mesh, or a skinned mesh: the shell's push reads the vertex before skinning.",
  },
});

/** How a shell's vertices are pushed: along their normals, or away from the part's centre. */
export const OUTLINE_MODES = ['normal', 'centre'] as const;

/** An outline mode (see `OUTLINE_MODES`). */
export type OutlineMode = (typeof OUTLINE_MODES)[number];

/** How `createOutline` makes an outline. */
export interface OutlineOptions {
  /** The line's colour, hex ('#141018' by default). */
  color?: string;
  /** The line's width in pixels of the target drawn into (1 by default). */
  width?: number;
  /** 'normal' (default) for round parts, 'centre' for boxes. */
  mode?: OutlineMode;
  /** Where advice goes (the shared log by default). */
  log?: Log;
}

/** The shells of an instanced batch's pages (see the file comment). */
export interface OutlineShells {
  /** One shell per page so far, in page order. */
  readonly shells: readonly InstancedMesh[];
  /** Matches the shells to the pages: one per page, each showing as many instances as its page, when its page shows. */
  sync(): void;
  /** Registers every shell, present and future, with `warmup` as `id` (`outline:<batch>` by default). */
  register(warmup: Pick<Warmup, 'register'>, id?: string): { dispose(): void };
  /** Removes the shells; the batch and the material stay. */
  dispose(): void;
}

/** An outline: its material and the shells it gives (see the file comment). */
export interface Outline {
  readonly material: MeshBasicNodeMaterial;
  readonly mode: OutlineMode;
  /** The width in pixels (a uniform). */
  width: number;
  /** The colour (a uniform). */
  readonly color: Color;
  /** Adds a shell to `mesh` as its child and returns it. Throws `GFX_OUTLINE_TARGET`. */
  shell(mesh: Mesh): Mesh;
  /** Shells every page of `batch`, inside the batch's root. */
  batch(batch: InstancedBatch): OutlineShells;
  /** Frees the material. */
  dispose(): void;
}

/** The vertex stage's stack, as r182 keeps it on the builder's context. */
interface VertexStack {
  nodes?: readonly unknown[];
}

/**
 * The instance matrix of the mesh `builder` draws, read off r182's `InstanceNode` in the vertex stage (see the file
 * comment); null when the object is not instanced, or when the node is missing (advised once).
 */
function instanceMatrixOf(builder: NodeBuilder, log: Log): Node | null {
  const object = builder.object as Object3D & { isInstancedMesh?: boolean };
  if (!object.isInstancedMesh) return null;
  const stack = (builder as unknown as { context: { vertex?: VertexStack } }).context.vertex;
  const node = stack?.nodes?.find((entry): entry is InstanceNode => entry instanceof InstanceNode);
  if (node?.instanceMatrixNode) return node.instanceMatrixNode;
  log.warnOnce('GFX_OUTLINE_UNPINNED', { object: object.name || object.type }, 'outline');
  return null;
}

/** `v` taken back through the linear part of `matrix` (columns a, b, c): (b×c·v, c×a·v, a×b·v) / det. */
function unturn(matrix: Node, v: Node): Node {
  const [a, b, c] = [0, 1, 2].map((i) => matrix.element(int(i)).xyz);
  const [bc, ca, ab] = [cross(b, c), cross(c, a), cross(a, b)];
  return vec3(bc.dot(v), ca.dot(v), ab.dot(v)).div(a.dot(bc));
}

/**
 * The push (see the file comment): the vertex, moved `width` pixels outward on the screen. r182 moves what
 * `positionNode` returns by the instance afterwards (its `InstanceNode` assigns after the material's position), so for
 * an instanced mesh the push returns the geometry's vertex plus the offset taken back through the instance's turn.
 */
function pushNode(mode: OutlineMode, width: Node, log: Log): Node {
  return Fn((builder: NodeBuilder) => {
    const matrix = instanceMatrixOf(builder, log);
    const away = mode === 'centre' ? positionGeometry : normalGeometry;
    const place = matrix ? matrix.mul(vec4(positionGeometry, 1)).xyz : positionGeometry;
    const direction = matrix
      ? mode === 'centre'
        ? matrix.mul(vec4(away, 0)).xyz
        : transformNormal(away, matrix)
      : away;
    const view = modelViewMatrix.mul(vec4(place, 1));
    const clip = cameraProjectionMatrix.mul(view);
    const towards = cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(direction, 0)));
    // The screen's way for the direction at this vertex (the derivative of the projection), in pixels.
    const screen = towards.xy.mul(clip.w).sub(clip.xy.mul(towards.w)).mul(screenSize);
    const length = screen.length();
    const unit = screen.div(max(length, 1e-9)).mul(step(1e-9, length));
    const ndc = unit.mul(width).mul(2).div(screenSize);
    const offset = vec3(
      ndc.x.mul(clip.w).div(cameraProjectionMatrix.element(int(0)).x),
      ndc.y.mul(clip.w).div(cameraProjectionMatrix.element(int(1)).y),
      float(0),
    );
    const local = modelWorldMatrixInverse.mul(cameraWorldMatrix.mul(vec4(offset, 0))).xyz;
    return positionGeometry.add(matrix ? unturn(matrix, local) : local);
  })() as unknown as Node;
}

/** Makes an outline (see the file comment). */
export function createOutline(options: OutlineOptions = {}): Outline {
  const mode = options.mode ?? 'normal';
  const log = options.log ?? sharedLog;
  const width = uniform(options.width ?? 1);
  const material = new MeshBasicNodeMaterial({ color: options.color ?? '#141018', side: BackSide, fog: false });
  material.name = `outline:${mode}`;
  material.positionNode = pushNode(mode, width, log);

  /** Marks `shell` as `of`'s outline, drawn without shadows. */
  const asShell = <T extends Object3D>(shell: T, of: Object3D): T => {
    shell.name = `${of.name || of.type}/outline`;
    shell.castShadow = false;
    shell.receiveShadow = false;
    shell.userData = { ...of.userData, outline: true };
    return shell;
  };

  const outline: Outline = {
    material,
    mode,
    get width() {
      return width.value;
    },
    set width(value: number) {
      width.value = value;
    },
    color: material.color,
    shell(mesh) {
      const target = mesh as Mesh & { isMesh?: boolean; isSkinnedMesh?: boolean; isInstancedMesh?: boolean };
      const object = target?.name || target?.type || String(target);
      if (!target?.isMesh) throw codeError('GFX_OUTLINE_TARGET', { object, problem: 'it is not a mesh' });
      if (target.isSkinnedMesh) throw codeError('GFX_OUTLINE_TARGET', { object, problem: 'it is skinned' });
      const shell = target.isInstancedMesh
        ? shellOf(target as unknown as InstancedMesh, material)
        : asShell(new Mesh(target.geometry, material), target);
      if (target.isInstancedMesh) asShell(shell, target);
      target.add(shell);
      return shell;
    },
    batch(batch) {
      const shells: InstancedMesh[] = [];
      const registered = new Set<{ dispose(): void }>();
      const group = {
        shells,
        sync() {
          batch.pages.forEach((page, i) => {
            shells[i] ??= asShell(shellOf(page, material), page);
            if (shells[i].parent !== batch.root) batch.root.add(shells[i]);
            shells[i].count = page.count;
            shells[i].visible = page.visible;
          });
        },
        register(warmup: Pick<Warmup, 'register'>, id = `outline:${batch.name}`) {
          const entry = warmup.register(id, { objects: () => shells });
          const handle = {
            dispose() {
              entry.dispose();
              registered.delete(handle);
            },
          };
          registered.add(handle);
          return handle;
        },
        dispose() {
          for (const handle of [...registered]) handle.dispose();
          for (const shell of shells) shell.removeFromParent();
          shells.length = 0;
        },
      };
      group.sync();
      return group;
    },
    dispose() {
      material.dispose();
    },
  };
  return outline;
}

/** A shell for an instanced mesh: its geometry and its instance matrices (shared, not copied), no instance colours. */
function shellOf(page: InstancedMesh, material: MeshBasicNodeMaterial): InstancedMesh {
  const shell = new InstancedMesh(page.geometry, material, page.instanceMatrix.count);
  shell.instanceMatrix = page.instanceMatrix;
  shell.count = page.count;
  shell.frustumCulled = page.frustumCulled;
  shell.renderOrder = page.renderOrder;
  return shell;
}
