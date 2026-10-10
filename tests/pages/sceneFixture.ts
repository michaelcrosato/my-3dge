/**
 * @file The scene page's fixture (tests/pages/scene.html): a small scene as plain data, and `buildScene`, which turns
 * a description into three.js objects. The fixture has what the renderer's tests need: a lit floor with a crate and a
 * ball, a shadow-casting key light and two pools that start hidden, registered with the warm-up by the page: `sparks`,
 * an `InstancedMesh` with no instances yet, and `flags`, a mesh inside a hidden group, each with a material nothing
 * else in the scene uses, so showing one without a warm-up would build pipelines.
 *
 * Materials are three.js's classic ones with their usual parameters (r182 draws them as node materials). Later WPs
 * replace this with their own fixture descriptions (WP 2.3's materials, WP 2.4's level meshes), drawn on this page.
 *
 * Invariants: the description is plain data (numbers, strings, arrays); building it twice gives two equal scenes.
 * Sizes in metres, +Y up (ADR-0004).
 */
import {
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three/webgpu';

/** A position or size, in metres. */
type Vec3 = [number, number, number];

/** A material as data: its kind and the classic parameters. */
export interface MaterialSpec {
  kind: 'standard' | 'lambert';
  color: number;
  roughness?: number;
  metalness?: number;
  emissive?: number;
}

/** A shape: a box of `size`, a sphere of radius `size[0]`, or a plane of `size[0]` × `size[1]`. */
export interface ShapeSpec {
  shape: 'box' | 'sphere' | 'plane';
  size: number[];
  material: MaterialSpec;
}

/** One mesh in the scene. */
export interface MeshSpec extends ShapeSpec {
  name: string;
  position: Vec3;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

/** A pool: hidden until shown. With `capacity`, an `InstancedMesh` with no instances; else a mesh in a hidden group. */
export interface PoolSpec extends ShapeSpec {
  name: string;
  capacity?: number;
  position: Vec3;
}

/** A light: the sky's and ground's colours, or a directional key light. */
export type LightSpec =
  | { kind: 'hemisphere'; sky: number; ground: number; intensity: number }
  | { kind: 'directional'; color: number; intensity: number; position: Vec3; castShadow?: boolean };

/** A scene as data. */
export interface SceneDescription {
  background: number;
  camera: { fov: number; near: number; far: number; position: Vec3; target: Vec3 };
  lights: LightSpec[];
  meshes: MeshSpec[];
  pools: PoolSpec[];
}

/** The fixture scene. */
export const FIXTURE: SceneDescription = {
  background: 0x1d2430,
  camera: { fov: 50, near: 0.1, far: 100, position: [0, 4, 9], target: [0, 0.6, 0] },
  lights: [
    { kind: 'hemisphere', sky: 0xbcd2ff, ground: 0x2a2018, intensity: 0.8 },
    { kind: 'directional', color: 0xffffff, intensity: 1.8, position: [4, 7, 3], castShadow: true },
  ],
  meshes: [
    {
      name: 'floor',
      shape: 'plane',
      size: [14, 14],
      position: [0, 0, 0],
      material: { kind: 'standard', color: 0x5a6070, roughness: 0.9 },
      receiveShadow: true,
    },
    {
      name: 'crate',
      shape: 'box',
      size: [1.2, 1.2, 1.2],
      position: [-1.6, 0.6, 0],
      material: { kind: 'standard', color: 0xb07a3c, roughness: 0.7 },
      castShadow: true,
    },
    {
      name: 'ball',
      shape: 'sphere',
      size: [0.7],
      position: [1.5, 0.7, 0.4],
      material: { kind: 'standard', color: 0x3c8fd9, roughness: 0.3, metalness: 0.2 },
      castShadow: true,
    },
  ],
  pools: [
    {
      name: 'sparks',
      shape: 'sphere',
      size: [0.12],
      capacity: 64,
      position: [0, 1.6, 0],
      material: { kind: 'standard', color: 0xffd27a, emissive: 0xff9a2a, roughness: 0.5 },
    },
    {
      name: 'flags',
      shape: 'box',
      size: [0.6, 0.9, 0.05],
      position: [0, 0.9, -2],
      material: { kind: 'lambert', color: 0xd94a3c, emissive: 0x200000 },
    },
  ],
};

/** The geometry of a shape. */
function geometryOf({ shape, size }: ShapeSpec): BufferGeometry {
  if (shape === 'sphere') return new SphereGeometry(size[0], 24, 16);
  if (shape === 'plane') return new PlaneGeometry(size[0], size[1]).rotateX(-Math.PI / 2);
  return new BoxGeometry(size[0], size[1], size[2]);
}

/** The material of a shape. */
function materialOf({ material }: ShapeSpec): Material {
  const { kind, color, roughness, metalness, emissive } = material;
  if (kind === 'lambert') return new MeshLambertMaterial({ color, emissive: emissive ?? 0 });
  return new MeshStandardMaterial({
    color,
    roughness: roughness ?? 1,
    metalness: metalness ?? 0,
    emissive: emissive ?? 0,
  });
}

/** A built scene: the scene, its camera, the meshes by name, and each pool's mesh and the object that hides it. */
export interface BuiltScene {
  scene: Scene;
  camera: PerspectiveCamera;
  meshes: Record<string, Mesh>;
  pools: Record<string, { mesh: Mesh | InstancedMesh; root: Object3D }>;
}

/** Builds `description` into three.js objects. */
export function buildScene(description: SceneDescription): BuiltScene {
  const scene = new Scene();
  scene.background = new Color(description.background);
  const { fov, near, far, position, target } = description.camera;
  const camera = new PerspectiveCamera(fov, 16 / 9, near, far);
  camera.position.set(...position);
  camera.lookAt(...target);
  for (const light of description.lights) {
    if (light.kind === 'hemisphere') {
      scene.add(new HemisphereLight(light.sky, light.ground, light.intensity));
      continue;
    }
    const key = new DirectionalLight(light.color, light.intensity);
    key.position.set(...light.position);
    key.castShadow = light.castShadow ?? false;
    scene.add(key);
  }
  const meshes: BuiltScene['meshes'] = {};
  for (const spec of description.meshes) {
    const mesh = new Mesh(geometryOf(spec), materialOf(spec));
    mesh.name = spec.name;
    mesh.position.set(...spec.position);
    mesh.castShadow = spec.castShadow ?? false;
    mesh.receiveShadow = spec.receiveShadow ?? false;
    meshes[spec.name] = mesh;
    scene.add(mesh);
  }
  const pools: BuiltScene['pools'] = {};
  for (const spec of description.pools) {
    if (spec.capacity) {
      const mesh = new InstancedMesh(geometryOf(spec), materialOf(spec), spec.capacity);
      mesh.name = spec.name;
      mesh.count = 0;
      mesh.position.set(...spec.position);
      pools[spec.name] = { mesh, root: mesh };
      scene.add(mesh);
      continue;
    }
    const root = new Group();
    root.name = `${spec.name}:group`;
    root.visible = false;
    const mesh = new Mesh(geometryOf(spec), materialOf(spec));
    mesh.name = spec.name;
    mesh.position.set(...spec.position);
    root.add(mesh);
    pools[spec.name] = { mesh, root };
    scene.add(root);
  }
  return { scene, camera, meshes, pools };
}
