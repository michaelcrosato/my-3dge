/**
 * @file The agent eye (PLAN.md WP 12.3, §5.8; doctrine: Verifiable without a display): what a camera sees, worked out
 * from the physics shapes with no GPU, so an agent asks "is X in view from camera C" in Node. `look(queries, camera,
 * owners)` casts one ray a cell of a coarse raster (`EYE_SIZE`, 96 × 54 by default, the page's 16:9) from the three.js
 * camera as it is placed, through the cell's middle between its near and far planes (unprojected through its
 * matrices, as `Vector3.unproject` does, so the lens, the zoom, an orthographic frustum and a classic view's height
 * boost, engine/gfx/cameras/boost.ts, come out as the frame draws them), and names the body it strikes
 * (engine/physics/queries.ts `raycast`, which sensors never block) by the entity one of whose components holds it as
 * its `body` (an actor's, a prop's, a platform's), the level's when none does (`ownersOf`).
 *
 * Given what the view draws (`faces`: engine/dev/eyeFaces.ts `drawnFaces` of its scene), a ray passes through a body
 * where no drawn face shows at the point it struck (a storey or a roof the cutaway hides, a wall it cut down,
 * engine/gfx/storeyCut.ts and cutaway.ts, a ceiling from above, a prop on a storey cut off, a collider's air round a
 * chair's legs) and on to what lies behind, up to `MARCHES` times, so the eye sees what the picture shows; an actor's
 * body always counts, standing for his puppet, which the GPU poses (from inside his body, he fills the picture: the
 * puppet is slimmer, but the eye cannot know its shape); any other body the camera stands inside never does. The view lists what it sees, most cells first
 * (`visible`), the raster as indices into it (`cells`, −1 for nothing), and `seen(view, entity)` answers for one.
 * `asciiOf(view)` draws it as text with a legend, after Pavilion Lite's `ascii` (shardfall
 * `pavilion-lite/src/tools.rs:743-866`): `@` the player, the level's walls `#` and floors `.` (a surface whose normal
 * is at least `FLOOR_UP` up), a space nothing, a letter per kind of thing, its first free one (upper case an actor's).
 *
 * `__engine.eye({ cols, rows })` looks through the view's camera as last placed, what it draws counted, in a page or
 * headless (`createHeadless({ view: true })`: `camera.set` places it and runs its cutaways, `camera.advance` moves it
 * on as a page's frames do), past the player's body in first person, as the view hides it; `node x eye <scene>`
 * (tools/cmd/eye.ts) prints it. It sees bodies: what the
 * view draws without one (the sky, a decal, an effect) it cannot see, a collider can differ from its mesh (a railing's
 * whole tile), and what covers less than a cell can fall between its rays. tests/e2e/eye.spec.ts holds its answers to
 * the ID pass's on the box's cameras.
 *
 * Invariants: read-only: it casts through the read-only queries and reads components and the view's objects, never
 * writes any; pure in the bodies, the camera's matrices, the boxes and the size; view state, never the sim's.
 *
 * @example
 * // const view = look(queryViewOf(world), camera, ownersOf(world.query()), { faces: drawnFaces(stage.scene) });
 * // seen(view, 1); // true: entity 1, the player, covers at least one cell
 * // asciiOf(view).map; // ['#####', '#.@.#', …], and its legend { '@': 'the player', '#': 'the level: a wall', … }
 * @see engine/dev/eye.test.ts
 */
import { codeError } from '../core/log';
import { Matrix4, Vector3 } from '../core/math';
import type { QueryView } from '../sim/queryView';
import type { EntityData } from '../sim/state';
import { drawnFaces, type EyeFaces, type EyeObject } from './eyeFaces';
import { defineMember } from './members';

/** The raster's size by default (cells across and down): the page's 16:9 at a tenth of 960 × 540. */
export const EYE_SIZE = { cols: 96, rows: 54 } as const;

/** How far up a surface's normal points for the picture to draw it as floor (0.7: the walkable slope's, 45.57°). */
export const FLOOR_UP = 0.7;

/** How many times a ray passes through what the view does not draw before it gives up; how far past each it starts (m). */
export const [MARCHES, PAST] = [16, 1e-3];

/** three.js's `WebGPUCoordinateSystem`, the view's cameras' (engine/gfx/cameras/place.ts): depth from 0 to 1. */
export const WEBGPU_COORDINATES = 2001;

/** How the eye looks: the raster's cells across and down (`EYE_SIZE`), a body to look past, and what the view draws. */
export interface EyeOptions {
  cols?: number;
  rows?: number;
  /** A body no ray strikes: the player's in first person, whose eye stands inside it, as the view hides it. */
  exclude?: number;
  /** What the view draws (`drawnFaces`): a ray passes through the level where no drawn face shows at its hit. */
  faces?: EyeFaces;
}

/** What the eye reads of a three.js camera as placed: its matrices and its depth's convention. */
export interface EyeCamera {
  readonly matrixWorld: Matrix4;
  readonly projectionMatrixInverse: Matrix4;
  /** `WEBGPU_COORDINATES` (depth 0 to 1), else WebGL's (−1 to 1). */
  readonly coordinateSystem: number;
  readonly reversedDepth?: boolean;
  updateMatrixWorld(): void;
}

/** Who holds a body: its entity, a name for the legend, and whether it is the player or an actor. */
export interface EyeOwner {
  entity: number;
  /** Its kind, as the legend names it: a prop's id without `prop:`, `actor`, else its first component's name. */
  kind: string;
  player: boolean;
  actor: boolean;
}

/** One thing the eye sees: its key (`entity:7`, `level`), its kind, its entity, and the cells it covers. */
export interface EyeThing {
  key: string;
  kind: string;
  entity?: number;
  player?: boolean;
  actor?: boolean;
  cells: number;
  /** Its cells over the raster's. */
  share: number;
}

/** What a camera sees (see the file comment). */
export interface EyeView {
  cols: number;
  rows: number;
  /** Row by row from the top, each cell's thing as an index into `visible`; −1 where its ray struck nothing. */
  cells: Int32Array;
  /** Per cell, 1 where the surface struck faces up (`FLOOR_UP`): a floor, else a wall or nothing. */
  floors: Uint8Array;
  /** What it sees, most cells first (ties by key). */
  visible: EyeThing[];
  /** The cells whose ray struck nothing. */
  empty: number;
}

/** Each body held by an entity's component (its `body`, a whole number), by body id; the first holder wins. */
export function ownersOf(entities: readonly EntityData[]): Map<number, EyeOwner> {
  const owners = new Map<number, EyeOwner>();
  for (const entity of entities) {
    const parts = Object.entries(entity).filter(([name]) => name !== 'id') as [string, Record<string, unknown>][];
    const prop = parts.find(([name]) => name === 'sceneProp')?.[1].prop;
    const actor = parts.find(([name]) => name === 'actor')?.[1];
    const kind = typeof prop === 'string' ? prop.replace(/^prop:/, '') : actor ? 'actor' : (parts[0]?.[0] ?? 'entity');
    for (const [, component] of parts) {
      const body = component?.body;
      if (typeof body !== 'number' || !Number.isInteger(body) || body < 0 || owners.has(body)) continue;
      owners.set(body, { entity: entity.id, kind, player: actor?.player === true, actor: actor !== undefined });
    }
  }
  return owners;
}

/** The options `options` asks for, checked: whole numbers of cells from 1 to 1,024 (`SIM_BAD_ARGUMENT`). */
function sizeOf(options: EyeOptions): { cols: number; rows: number } {
  const { cols = EYE_SIZE.cols, rows = EYE_SIZE.rows } = options;
  for (const [name, value] of Object.entries({ cols, rows })) {
    if (!Number.isInteger(value) || value < 1 || value > 1024) {
      throw codeError('SIM_BAD_ARGUMENT', { where: `eye({ ${name} })`, value: String(value), expected: 'a whole number of cells from 1 to 1024' }); // prettier-ignore
    }
  }
  return { cols, rows };
}

/** What `camera`, as placed, sees of the bodies `queries` reach, named by `owners` (see the file comment). */
export function look(
  queries: Pick<QueryView, 'raycast'>,
  camera: EyeCamera,
  owners: ReadonlyMap<number, EyeOwner>,
  options: EyeOptions = {},
): EyeView {
  const { cols, rows } = sizeOf(options);
  const { faces, exclude } = options;
  camera.updateMatrixWorld();
  const unproject = (v: Vector3) => v.applyMatrix4(camera.projectionMatrixInverse).applyMatrix4(camera.matrixWorld);
  const [zNear, zFar] = camera.reversedDepth ? [1, 0] : [camera.coordinateSystem === WEBGPU_COORDINATES ? 0 : -1, 1];
  const [from, to, dir] = [new Vector3(), new Vector3(), new Vector3()];
  const things = new Map<string, EyeThing>();
  const keys: string[] = new Array(cols * rows);
  const floors = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const [x, y] = [((c + 0.5) / cols) * 2 - 1, 1 - ((r + 0.5) / rows) * 2];
      unproject(from.set(x, y, zNear));
      let reach = unproject(to.set(x, y, zFar)).distanceTo(from);
      if (reach <= 1e-9) continue;
      dir.copy(to).sub(from).divideScalar(reach);
      let skip = exclude;
      for (let k = 0; k < MARCHES && reach > 0; k++) {
        const ray = { maxDistance: reach, solid: k === 0, ...(skip === undefined ? {} : { exclude: skip }) };
        const hit = queries.raycast(from.toArray(), dir.toArray(), ray);
        if (!hit) break;
        const owner = owners.get(hit.body);
        if (k === 0 && hit.distance < PAST && skip === undefined && !owner?.actor) {
          [skip, k] = [hit.body, -1]; // the camera stands inside it: the frame draws it from inside, which culls it
          continue;
        }
        const face = owner?.actor || !faces ? hit.normal : faces.faceAt(hit.point, dir); // an actor's puppet is skinned: his body stands for it
        if (face) {
          const key = owner ? `entity:${owner.entity}` : 'level';
          let thing = things.get(key);
          if (!thing) {
            thing = owner ? { key, kind: owner.kind, entity: owner.entity, ...(owner.player ? { player: true } : {}), ...(owner.actor ? { actor: true } : {}), cells: 0, share: 0 } : { key, kind: 'level', cells: 0, share: 0 }; // prettier-ignore
            things.set(key, thing);
          }
          thing.cells++;
          keys[r * cols + c] = key;
          if (!owner && face.y >= FLOOR_UP) floors[r * cols + c] = 1;
          break;
        }
        from.copy(hit.point).addScaledVector(dir, PAST);
        reach -= hit.distance + PAST;
      }
    }
  }
  const visible = [...things.values()].sort((a, b) => b.cells - a.cells || (a.key < b.key ? -1 : 1));
  for (const thing of visible) thing.share = thing.cells / (cols * rows);
  const index = new Map(visible.map((thing, i) => [thing.key, i]));
  const cells = new Int32Array(cols * rows).fill(-1);
  for (let i = 0; i < keys.length; i++) if (keys[i] !== undefined) cells[i] = index.get(keys[i])!;
  return { cols, rows, cells, floors, visible, empty: cells.filter((i) => i < 0).length };
}

/** Whether `view` sees `entity` in at least one cell. */
export function seen(view: Pick<EyeView, 'visible'>, entity: number): boolean {
  return view.visible.some((thing) => thing.entity === entity);
}

/** `view` as text, a character a cell, and its legend (see the file comment). */
export function asciiOf(view: EyeView): { map: string[]; legend: Record<string, string> } {
  const legend: Record<string, string> = {};
  const letters = new Map<string, string>(); // a kind (an actor's apart) to its letter
  const charOf = (thing: EyeThing): string => {
    if (thing.player) return ((legend['@'] = 'the player'), '@');
    if (thing.key === 'level') return '#';
    const kindKey = `${thing.kind}${thing.actor ? '+' : ''}`;
    const known = letters.get(kindKey);
    if (known) return known;
    const pool = [...thing.kind.replace(/[^a-z0-9]/gi, ''), ...'0123456789&$%*!?~'];
    const pick = pool.map((ch) => (thing.actor ? ch.toUpperCase() : ch.toLowerCase())).find((ch) => !(ch in legend) && ch !== '#') ?? '?'; // prettier-ignore
    legend[pick] = thing.actor ? `${thing.kind} (an actor)` : thing.kind;
    letters.set(kindKey, pick);
    return pick;
  };
  const chars = view.visible.map(charOf);
  const map: string[] = [];
  for (let r = 0; r < view.rows; r++) {
    let line = '';
    for (let c = 0; c < view.cols; c++) {
      const i = view.cells[r * view.cols + c];
      const ch = i < 0 ? ' ' : chars[i] === '#' && view.floors[r * view.cols + c] ? '.' : chars[i];
      if (ch === '#') legend['#'] = 'the level: a wall';
      if (ch === '.') legend['.'] = 'the level: a floor';
      line += ch;
    }
    map.push(line.trimEnd());
  }
  return { map, legend: Object.fromEntries(Object.entries(legend).sort(([a], [b]) => (a < b ? -1 : 1))) };
}

/** The eye's answer as plain data, for `__engine.eye` and `x eye`: the raster as text, its legend and what it sees. */
export interface EyeJson {
  cols: number;
  rows: number;
  map: string[];
  legend: Record<string, string>;
  visible: EyeThing[];
  empty: number;
}

/** `view` as plain data (see `EyeJson`). */
export function eyeJson(view: EyeView): EyeJson {
  const { map, legend } = asciiOf(view);
  return { cols: view.cols, rows: view.rows, map, legend, visible: view.visible, empty: view.empty };
}

/** What the `eye` member needs of its host: the view's camera as placed, its kind, its scene, the sim's queries. */
interface EyeHost {
  view?: {
    readonly drawn: EyeCamera;
    readonly stage: { readonly scene: EyeObject };
    cameraInfo(): { type: string };
    queries(): QueryView | undefined;
  } | null;
  session: { readonly world: { query(): readonly EntityData[] } };
}

defineMember('eye', {
  help: 'What the camera, as last placed, sees of the bodies, with no GPU (the agent eye), passing where the view draws nothing: the raster as text with a legend, and each thing it sees with its cells.', // prettier-ignore
  args: {
    options: { type: 'object', default: {}, description: '{ cols, rows }: the raster’s cells across and down (96 × 54).' }, // prettier-ignore
  },
  impl(h, options: Pick<EyeOptions, 'cols' | 'rows'>) {
    const host = h as unknown as EyeHost;
    const view = host.view;
    if (!view) throw codeError('APP_NO_VIEW', { member: 'eye' });
    const queries = view.queries();
    if (!queries) throw codeError('SIM_BAD_ARGUMENT', { where: '__engine.eye()', value: 'a scene without physics', expected: 'a scene with physics: the eye casts at its bodies' }); // prettier-ignore
    const owners = ownersOf(host.session.world.query());
    const player = [...owners].find(([, owner]) => owner.player)?.[0];
    const inside = view.cameraInfo().type === 'first' && player !== undefined; // first person's eye is in his body
    const faces = drawnFaces(view.stage.scene);
    return eyeJson(look(queries, view.drawn, owners, { ...options, faces, ...(inside ? { exclude: player } : {}) }));
  },
});
