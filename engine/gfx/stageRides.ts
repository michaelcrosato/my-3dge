/**
 * @file Rides on the stage (PLAN.md WP 13.7): every entity holding the component `zipline`, `ladder` or `launcher`
 * (engine/sim/rides.ts) drawn from it. A zipline is its cable between its anchors, a pole under each anchor (down to
 * its foot, unless it has none or is a balloon's line) with a pulley block on top, and a balloon over a balloon's
 * upper anchor;
 * a ladder its two rails and a rung every `RUNG` metres up to its top; a launcher a jump pad's disc flush with its
 * top, or a trampoline's frame on four legs with its mat. Rides stand still, so each is built once, when it first
 * appears (again when its component changes), and removed when its entity goes. Its `root` joins the stage's scene
 * when the first ride arrives, so a stage without rides keeps the graph it had before them.
 *
 * Every mesh is named `<component>#<id>/<part>` and carries `userData.entity` and `userData.component`, so the ID pass
 * and the inspector say which ride it is. `register` registers the meshes with the warm-up and adds the drawn kinds to
 * the shader key, so the frame after a ride arrives warms up first instead of stalling.
 *
 * Invariants: presentation only (doctrine: WebGPU only): it reads the components and writes nothing back; equal
 * components give equal meshes; every object it makes is under `root`; materials are the library's.
 *
 * @example
 * // const rides = createStageRides({ scene: stage.scene, materials: library }); // joins the scene with its first ride
 * // rides.capture(world.query('zipline', …)); // the ids it draws
 * @see engine/gfx/stageRides.test.ts
 */
import { BufferGeometry, Group, Mesh, Quaternion, SphereGeometry, Vector3, type Material, type Object3D } from 'three/webgpu'; // prettier-ignore
import type { EntityData } from '../sim/state';
import { boxGeometry } from './geometry/box';
import { frustumGeometry } from './geometry/frustum';
import type { Warmup } from './warmup';

/** A rung every this many metres up a ladder. */
export const RUNG = 0.3;

/** The materials each part takes, from the library. */
const LOOK = {
  cable: 'material:default',
  pole: 'material:default',
  balloon: 'material:glow',
  ladder: 'material:planks',
  pad: 'material:glow',
  frame: 'material:default',
  mat: 'material:checker',
} as const;

/** What `createStageRides` takes. */
export interface StageRidesOptions {
  /** The scene `root` joins when the first ride arrives: a stage with none keeps the graph it had. */
  scene: Object3D;
  /** Where the materials come from: the page's material library. */
  materials: { get(id: string): Material };
}

/** The rides on a stage (see the file comment). */
export interface StageRides {
  /** Every ride's meshes. */
  readonly root: Group;
  /** Builds the rides among `entities` that are new or changed, removes those gone; returns the ids it draws. */
  capture(entities: Iterable<EntityData>): Set<number>;
  /** Registers the meshes with `warmup` (see the file comment); `dispose()` undoes it. */
  register(warmup: Pick<Warmup, 'register' | 'keyPart'>): { dispose(): void };
  /** Frees the geometries it made and empties `root`. */
  dispose(): void;
}

/** A point, metres. */
type P = readonly number[];

/** A part to build: its geometry, its material key, where its origin goes and how it turns. */
interface Part {
  name: string;
  geometry: BufferGeometry;
  look: keyof typeof LOOK;
  at: P;
  turn?: Quaternion;
}

/** A cylinder of `radius` from `a` to `b`. */
function rod(name: string, look: Part['look'], a: P, b: P, radius: number): Part {
  const along = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const height = Math.max(along.length(), 1e-3);
  const geometry = frustumGeometry({
    radiusBottom: radius,
    radiusTop: radius,
    height,
    radialSegments: 8,
    smooth: true,
  });
  const turn = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), along.normalize());
  return { name, geometry, look, at: a, turn };
}

/** A box of `size` whose bottom's middle stands at `at`, turned `yaw` about +Y. */
function block(name: string, look: Part['look'], at: P, size: P, yaw = 0): Part {
  const geometry = boxGeometry({ width: size[0], height: size[1], depth: size[2] });
  return { name, geometry, look, at, turn: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw) };
}

/** A zipline's parts (see the file comment). */
function ziplineParts(c: Record<string, unknown>): Part[] {
  const [from, to, feet] = [c.from as P, c.to as P, c.feet as P];
  const parts = [rod('cable', 'cable', from, to, 0.02)];
  [from, to].forEach((anchor, k) => {
    if (!c.poles || c.balloon || feet[k] === undefined || anchor[1] - feet[k] <= 0.05) return;
    parts.push(rod(`pole${k}`, 'pole', [anchor[0], feet[k], anchor[2]], anchor, 0.06));
    parts.push(block(`pulley${k}`, 'pole', [anchor[0], anchor[1] - 0.1, anchor[2]], [0.2, 0.2, 0.2]));
  });
  if (c.balloon) {
    const top = from[1] > to[1] ? from : to;
    const geometry = new SphereGeometry(2.5, 16, 12);
    parts.push({ name: 'balloon', geometry, look: 'balloon', at: [top[0], top[1] + 2.5, top[2]] });
  }
  return parts;
}

/** A ladder's parts (see the file comment). */
function ladderParts(c: Record<string, unknown>): Part[] {
  const [foot, top, normal, width] = [c.foot as P, c.top as number, c.normal as P, c.width as number];
  const yaw = Math.atan2(normal[0], normal[1]);
  const [ax, az] = [normal[1], -normal[0]]; // along the face
  const height = top - foot[1];
  const parts: Part[] = [];
  for (const side of [-1, 1]) {
    const at = [foot[0] + ax * side * (width / 2), foot[1], foot[2] + az * side * (width / 2)];
    parts.push(block(`rail${side < 0 ? 0 : 1}`, 'ladder', at, [0.06, height + 0.4, 0.06], yaw));
  }
  for (let k = 1, y = RUNG; y < height + 0.2; k++, y += RUNG) {
    parts.push(block(`rung${k}`, 'ladder', [foot[0], foot[1] + y - 0.02, foot[2]], [width, 0.04, 0.04], yaw));
  }
  return parts;
}

/** A launcher's parts (see the file comment). */
function launcherParts(c: Record<string, unknown>): Part[] {
  const [at, size] = [c.at as P, c.size as P];
  if (c.mesh === 'pad') {
    const radius = Math.min(size[0], size[1]) / 2;
    const geometry = frustumGeometry({ radiusBottom: radius, radiusTop: radius * 0.9, height: 0.06, radialSegments: 16, smooth: true }); // prettier-ignore
    return [{ name: 'pad', geometry, look: 'pad', at: [at[0], at[1] - 0.04, at[2]] }];
  }
  const parts = [block('mat', 'mat', [at[0], at[1] - 0.03, at[2]], [size[0] - 0.2, 0.04, size[1] - 0.2])];
  for (const [dx, dz, w, d] of [
    [0, -1, size[0], 0.1],
    [0, 1, size[0], 0.1],
    [-1, 0, 0.1, size[1]],
    [1, 0, 0.1, size[1]],
  ]) {
    // prettier-ignore
    parts.push(block(`rim${dx}${dz}`, 'frame', [at[0] + (dx * (size[0] - 0.1)) / 2, at[1] - 0.08, at[2] + (dz * (size[1] - 0.1)) / 2], [w, 0.1, d])); // prettier-ignore
  }
  for (const [dx, dz] of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ]) {
    // prettier-ignore
    parts.push(block(`leg${dx}${dz}`, 'frame', [at[0] + (dx * (size[0] - 0.2)) / 2, 0, at[2] + (dz * (size[1] - 0.2)) / 2], [0.08, Math.max(at[1] - 0.08, 0.01), 0.08])); // prettier-ignore
  }
  return parts;
}

/** The kinds of ride it draws, by component, with their parts. */
const KINDS = { zipline: ziplineParts, ladder: ladderParts, launcher: launcherParts } as const;

/** The components it draws rides from: the stage reads these entities beside those it places. */
export const RIDE_KINDS: readonly string[] = Object.freeze(Object.keys(KINDS));

/** Makes the rides of a stage (see the file comment). */
export function createStageRides(options: StageRidesOptions): StageRides {
  const root = new Group();
  root.name = 'rides';
  const built = new Map<number, { key: string; group: Group }>();
  const drawn = new Set<string>();
  const free = (group: Group) => {
    group.traverse((object) => (object as Mesh).isMesh && (object as Mesh).geometry.dispose());
    group.removeFromParent();
  };
  return {
    root,
    capture(entities) {
      const seen = new Set<number>();
      for (const entity of entities) {
        const kind = (Object.keys(KINDS) as (keyof typeof KINDS)[]).find((name) => entity[name] !== undefined);
        if (!kind) continue;
        seen.add(entity.id);
        const component = entity[kind] as Record<string, unknown>;
        const key = `${kind}:${JSON.stringify(component)}`;
        if (built.get(entity.id)?.key === key) continue;
        const old = built.get(entity.id);
        if (old) free(old.group);
        const group = new Group();
        group.name = `${kind}#${entity.id}`;
        for (const part of KINDS[kind](component)) {
          const mesh = new Mesh(part.geometry, options.materials.get(LOOK[part.look]));
          Object.assign(mesh, { name: `${kind}#${entity.id}/${part.name}`, castShadow: true, receiveShadow: true });
          Object.assign(mesh.userData, { entity: entity.id, component: kind });
          mesh.position.set(part.at[0], part.at[1], part.at[2]);
          if (part.turn) mesh.quaternion.copy(part.turn);
          group.add(mesh);
          drawn.add(part.look);
        }
        group.updateMatrixWorld(true);
        root.add(group);
        if (!root.parent) options.scene.add(root);
        built.set(entity.id, { key, group });
      }
      for (const [id, { group }] of built) {
        if (seen.has(id)) continue;
        free(group);
        built.delete(id);
      }
      return seen;
    },
    register(warmup) {
      const objects = (): Object3D[] => [...built.values()].flatMap(({ group }) => group.children);
      const registrations = [
        warmup.register('stage:rides', { objects }),
        warmup.keyPart('stage:rides', () => [...drawn].sort().join(';')),
      ];
      return { dispose: () => registrations.forEach((registration) => registration.dispose()) };
    },
    dispose() {
      for (const { group } of built.values()) free(group);
      built.clear();
      root.clear();
    },
  };
}
