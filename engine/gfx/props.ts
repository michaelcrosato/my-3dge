/**
 * @file Props drawn (PLAN.md WP 4.5, §6.1): `createPropMeshes({ materials })` draws the `prop` entries
 * (engine/world/props/prop.ts) through the instancing service (engine/gfx/instancing.ts), one batch per prop part
 * (`prop:crate/mesh`, its pages `…/page0` in the ID pass), so a hundred crates are one draw call. Each frame:
 * `begin(time)`, `add(id, pose, key)` per prop, `end()`. A pose is the prop's centre and turn: its body's
 * (`physics.readBody(id)`) or, for a prop without one, `propPose(placement)`; the meshes stand `propCentre` below it,
 * so a knocked crate's mesh is wherever its body is.
 *
 * - **Parts.** A part's geometry is built once (`buildPropPart`), placed in the prop's frame (`partMatrix`) and
 *   drawn with the material library's materials, tinted per instance.
 * - **Flames.** A part with `flame.tongues` is drawn as that many tongues round its origin, each its tint round a
 *   core of `flame.core`, rising, swaying and leaning on their own sines (`tongueMatrices`). Each prop dances from its
 *   own phase, drawn once per `key` (an entity id) from the visual streams (`fxRng`: never hashed).
 * - **Lights.** `lights()` lists the light spots of this frame's props in world space, flickering (`FLICKER`) when
 *   the prop's light does: what the light pool (WP 7.1) places its lights at.
 * - **Looks.** The props' texture and materials (`PROP_MATERIALS`) are defined on the shared registry when the module
 *   loads, and on another when a prop mesh set is made over it (`propLooks`).
 * - **Post-processing.** The root is tagged an object (`setPart`, engine/gfx/post/mrt.ts), in one outline group.
 *
 * Carried from `my-3d2dge:src/stress-world/30-crowd.js:293-329` (`crateTex`, `barrelTex`'s lids, `drawProps`: every
 * prop where its body is) and `src/stress-world/10-hall.js:409-436` (`animateBraziers`' tongues, `FLICKER`).
 *
 * Invariants: presentation only: it reads poses and entries and writes nothing back; equal inputs and streams give
 * equal matrices; a batch is made for each prop of `props` (every prop by default) before the warm-up, and for
 * another prop when first added (re-warming); geometries are this module's, materials the library's.
 *
 * @example
 * import { createMaterialLibrary } from './materials/library';
 * const props = createPropMeshes({ materials: createMaterialLibrary() });
 * props.begin(0);
 * props.add('prop:crate', { position: [2, 0.375, 3] });
 * props.add('prop:brazier', { position: [5, 0.75, 3] }, 7);
 * props.end();
 * props.drawCalls(1); // 3: the crate and its shadow, the flames
 * props.lights()[0].tag; // 'torch'
 * props.dispose();
 * @see engine/gfx/props.test.ts
 * @see tests/e2e/props.spec.ts
 */
import { Color, Euler, Group, Matrix4, Quaternion, Vector3, type BufferGeometry, type Material } from 'three/webgpu';
import { registry as sharedRegistry, type Registry } from '../core/registry';
import { RngStreams, type Rng } from '../core/rng';
import { getProp, propCentre, propKind, type Prop, type PropPart } from '../world/props/prop';
import { buildGeometry } from './geometry/geometry';
import { sidesThenTops } from './geometry/groups';
import { createInstancedBatch, type InstancedBatch } from './instancing';
import type { MaterialLibrary } from './materials/library';
import { defineMaterial } from './materials/material';
import { setPart } from './post/mrt';
import { defineTexture, textureKind } from './textures/texture';
import { palette, wrapIndex } from './textures/tile';
import { textureSpec } from './textures/types';
import type { Warmup } from './warmup';

/** A flame's flicker at time `t` (s): about 0.77 to 1.03, the 2D hall's (my-3d2dge's `FLICKER`). */
export const FLICKER = (t: number): number =>
  0.9 + Math.sin(t * 13) * 0.05 + Math.sin(t * 29) * 0.04 + Math.sin(t * 7.3) * 0.04;

/** The crate's face generator: see the file comment. */
export const CRATE_TEXTURE = textureSpec({
  description:
    "A crate's face: a dark edge, a frame with a nail in each corner, planks across between, and a diagonal brace.",
  params: {
    side: { type: 'integer', default: 12, minimum: 8, maximum: 256, unit: 'texels', description: 'One face.' },
    planks: {
      type: 'array',
      items: { type: 'string' },
      default: ['#9d6a3f', '#8f5f37', '#a87547'],
      description: 'The plank tones, hex, bottom up.',
    },
    frame: { type: 'string', default: '#6e4528', description: 'The frame, hex.' },
    line: { type: 'string', default: '#4a2e1c', description: 'The edge and the gaps between planks, hex.' },
    brace: { type: 'string', default: '#c08a55', description: 'The brace, hex.' },
    nail: { type: 'string', default: '#2e2420', description: 'The nails, hex.' },
  },
  size: [12, 12],
  tile: ({ side }) => [side, side],
  create({ params }) {
    const planks = palette(params.planks, 'texture:crate planks');
    const [frame, line, brace, nail] = palette([params.frame, params.line, params.brace, params.nail], 'texture:crate');
    const n = params.side;
    return (tx, ty, texel) => {
      const [x, y] = [wrapIndex(tx, n), wrapIndex(ty, n)];
      const edge = (v: number, d: number) => v === d || v === n - 1 - d;
      let [color, height, roughness] = [planks[Math.floor((y - 2) / 3) % planks.length], 0.7, 0.8];
      if (edge(x, 0) || edge(y, 0)) [color, height, roughness] = [line, 0.2, 0.9];
      else if (edge(x, 1) && edge(y, 1)) [color, height, roughness] = [nail, 0.9, 0.4];
      else if (edge(x, 1) || edge(y, 1)) [color, height] = [frame, 1];
      else if (x === y) [color, height] = [brace, 1];
      else if (x === y + 1) [color, height] = [frame, 1];
      else if ((y - 2) % 3 === 2) [color, height, roughness] = [line, 0.2, 0.9];
      texel.color[0] = color[0];
      texel.color[1] = color[1];
      texel.color[2] = color[2];
      texel.height = height;
      texel.roughness = roughness;
    };
  },
});

/** Round the barrel's twelve sides (m): `geometry:frustum` measures its side's u along them. */
const BARREL_ROUND = 24 * 0.375 * Math.sin(Math.PI / 12);

/**
 * The props' materials, by id: `material:crate` (texture:crate, my-3d2dge's `crateTex`, a 0.75 m face per tile),
 * `material:barrelStaves` (texture:staves wrapped exactly once round the twelve-sided barrel, a stave per side),
 * `material:barrelLid`, `material:flame` (unlit white, so tints show), and the library's (WP 10.3) `material:iron`
 * and `material:cloth`.
 */
export const PROP_MATERIALS: Readonly<Record<string, Record<string, unknown>>> = {
  'material:crate': {
    description: "A crate's faces: framed planks, a brace and nails (texture:crate), one face every 0.75 m.",
    map: 'texture:crate',
    roughness: 0.8,
  },
  'material:barrelStaves': {
    description: "A barrel's side: texture:staves wrapped once round prop:barrel's 12 sides, a stave per side.",
    map: { texture: 'texture:staves', repeat: [1 / BARREL_ROUND, 1 / 0.875] },
    roughness: 0.75,
  },
  'material:barrelLid': { description: "A barrel's lids: plain dark oak.", color: '#7a5030', roughness: 0.8 },
  'material:flame': {
    description: 'Flames, unlit white, so each tongue shows its tint: what prop parts with flame tongues use.',
    unlit: true,
  },
  'material:iron': {
    description: 'Dark wrought iron (texture:metal): the library props’ straps, bands, brackets and lanterns.',
    map: 'texture:metal',
    color: '#5a5e66',
    roughness: 0.55,
    metalness: 0.6,
  },
  'material:cloth': {
    description: 'Woven cloth, white so a part’s tint is its dye: banners and hems.',
    roughness: 0.95,
  },
};

/** Defines the props' texture and materials on `registry`, unless it has them. */
export function propLooks(registry: Registry): void {
  textureKind(registry);
  if (registry.has('texture', 'texture:crate')) return;
  defineTexture('texture:crate', CRATE_TEXTURE, registry);
  for (const [id, spec] of Object.entries(PROP_MATERIALS)) defineMaterial(id, spec, registry);
}
propLooks(sharedRegistry);

/** Builds `part`'s geometry (the caller's), with its tops and bottoms a group of their own when it has a `top`. */
export function buildPropPart(part: PropPart, registry: Registry = sharedRegistry): BufferGeometry {
  const geometry = buildGeometry({ geometry: part.geometry, params: { ...part.params } }, registry);
  return part.top ? sidesThenTops(geometry) : geometry;
}

const ONE = new Vector3(1, 1, 1);

/** Where `part` stands in its prop's frame (the base at the origin). */
export function partMatrix(part: PropPart, out = new Matrix4()): Matrix4 {
  const [x, y, z] = part.rotation;
  const turn = new Quaternion().setFromEuler(new Euler(x, y, z, 'XYZ'));
  return out.compose(new Vector3(...part.position), turn, ONE);
}

const LEAN_AXIS = new Vector3(0, 0, 1);
const lean = new Quaternion();
const at = new Vector3();
const scale = new Vector3();

/** Tongue `k`'s outer flame and core in its part's frame at `t` (s): the 2D hall's dance, in metres. */
export function tongueMatrices(t: number, k: number, flame: PropPart['flame'], outer: Matrix4, core: Matrix4): void {
  const a = k * 2.1 + t * 0.6;
  const h = flame.height * (1 + (Math.sin(t * 9 + k * 2) * 2.2 + Math.sin(t * 17 + k) * 1.2) / 7);
  const sway = Math.sin(t * 6 + k * 1.7) * flame.sway;
  const [x, z] = [Math.cos(a) * flame.ring, Math.sin(a) * flame.ring];
  lean.setFromAxisAngle(LEAN_AXIS, -sway * 3);
  outer.compose(at.set(x + sway * 0.5, 0, z), lean, scale.set(1, h, 1));
  core.compose(at.set(x + sway * 0.3, 0, z), lean, scale.set(0.55, h * 0.65, 0.55));
}

/** A prop's pose: its centre (its body's origin) and its turn. */
export interface PropMeshPose {
  position: Readonly<{ x: number; y: number; z: number }> | readonly [number, number, number];
  rotation?: Readonly<{ x: number; y: number; z: number; w: number }> | readonly [number, number, number, number];
}

/** A prop's light this frame, in world space, as three.js's `PointLight` takes it. */
export interface PropLight {
  prop: string;
  tag: string;
  position: [number, number, number];
  color: string;
  intensity: number;
  distance: number;
  decay: number;
}

/** What `createPropMeshes` takes. */
export interface PropMeshesOptions {
  /** Where the materials come from: the page's material library. */
  materials: Pick<MaterialLibrary, 'get'>;
  /** The registry of the props, geometries and materials; the shared one by default. */
  registry?: Registry;
  /** The props to make batches for at once, before a warm-up; every prop of the registry by default. */
  props?: readonly string[];
  /** The visual streams the phases are drawn from: the sim world's (`(...keys) => w.fxRng(...keys)`); seed 1's. */
  fxRng?: (...keys: readonly (string | number)[]) => Rng;
  /** Slots per page of each batch (1,024; above 1,000: engine/gfx/instancing.ts). */
  pageSlots?: number;
}

/** The props of a scene, drawn: see the file comment. */
export interface PropMeshes {
  /** Every batch's root, under one group (`props`). */
  readonly root: Group;
  /** The batches, one per prop part, in the order they were made. */
  batches(): InstancedBatch[];
  /** Starts a frame at presentation time `time` (s): the flames dance and the lights flicker on it. */
  begin(time: number): void;
  /** Draws prop `id` at `pose`; `key` (an entity id) names it for its phase, else its place among this frame's. */
  add(id: string, pose: PropMeshPose, key?: string | number): void;
  /** Ends the frame: uploads what changed. */
  end(): void;
  /** The light spots of this frame's props; see the file comment. */
  lights(): PropLight[];
  /** The draw calls of the props shown, with `shadowMaps` shadow maps (casting parts again in each). */
  drawCalls(shadowMaps?: number): number;
  /** Registers every batch, and those made later, with the warm-up; dispose to stop. */
  register(warmup: Pick<Warmup, 'register'>): { dispose(): void };
  /** Frees the batches and geometries, and leaves the scene. */
  dispose(): void;
}

/** A part's batch and what drawing it needs. */
interface PartDraw {
  part: PropPart;
  batch: InstancedBatch;
  geometry: BufferGeometry;
  /** From the prop's centre to the part's frame. */
  local: Matrix4;
  tint: Color;
  core: Color;
}

/** Makes the prop meshes; see the file comment. */
export function createPropMeshes(options: PropMeshesOptions): PropMeshes {
  const registry = options.registry ?? sharedRegistry;
  propKind(registry);
  propLooks(registry);
  const root = new Group();
  root.name = 'props';
  setPart(root, 'object', { group: root.id });
  const draws = new Map<string, { prop: Prop; parts: PartDraw[]; drawn: number }>();
  const warmups = new Map<Pick<Warmup, 'register'>, { dispose(): void }[]>();
  const phases = new Map<string, number>();
  const streams = new RngStreams(1);
  const fx = options.fxRng ?? ((...keys) => streams.stream(...keys));
  const [pose, world, outer, core, toCentre] = [0, 1, 2, 3, 4].map(() => new Matrix4());
  const [turn, place, light] = [new Quaternion(), new Vector3(), new Vector3()];
  let time = 0;
  let lights: PropLight[] = [];

  /** The part draw of `part` of `prop`: its batch, made now. */
  function partDraw(prop: Prop, part: PropPart): PartDraw {
    const geometry = buildPropPart(part, registry);
    const { materials } = options;
    const material: Material | Material[] = part.top
      ? [materials.get(part.material), materials.get(part.top)]
      : materials.get(part.material);
    const batch = createInstancedBatch({
      name: `${prop.id}/${part.name}`,
      geometry,
      material,
      castShadow: part.shadow,
      receiveShadow: true,
      pageSlots: options.pageSlots,
    });
    root.add(batch.root);
    for (const [warmup, held] of warmups) held.push(batch.register(warmup));
    const local = new Matrix4().makeTranslation(0, -propCentre(prop), 0).multiply(partMatrix(part));
    return { part, batch, geometry, local, tint: new Color(part.tint), core: new Color(part.flame.core) };
  }

  /** The draw of prop `id` (the fallback's for a missing id), its batches made on first use. */
  function drawOf(id: string) {
    const prop = getProp(id, registry);
    let draw = draws.get(prop.id);
    if (!draw) {
      draw = { prop, parts: prop.parts.map((part) => partDraw(prop, part)), drawn: 0 };
      draws.set(prop.id, draw);
    }
    return draw;
  }

  /** The phase (s) of the prop `id` named `key`: drawn once from its visual stream. */
  function phaseOf(id: string, key: string | number): number {
    const name = `${id}#${key}`;
    let phase = phases.get(name);
    if (phase === undefined) phases.set(name, (phase = fx('prop', id, key).range(0, 9)));
    return phase;
  }

  for (const id of options.props ?? registry.list('prop').map((entry) => entry.id)) drawOf(id);

  const props: PropMeshes = {
    root,
    batches: () => [...draws.values()].flatMap((draw) => draw.parts.map((part) => part.batch)),
    begin(t) {
      time = t;
      lights = [];
      for (const draw of draws.values()) {
        draw.drawn = 0;
        for (const { batch } of draw.parts) batch.begin();
      }
    },
    add(id, { position, rotation }, key) {
      const draw = drawOf(id);
      const { prop } = draw;
      const name = key ?? draw.drawn;
      draw.drawn++;
      if (Array.isArray(position)) place.fromArray(position);
      else place.copy(position as Vector3);
      if (!rotation) turn.identity();
      else if (Array.isArray(rotation)) turn.fromArray(rotation);
      else turn.copy(rotation as Quaternion);
      pose.compose(place, turn, ONE);
      for (const { part, batch, local, tint, core: coreTint } of draw.parts) {
        world.multiplyMatrices(pose, local);
        if (!part.flame.tongues) {
          batch.add(world.elements, tint);
          continue;
        }
        const t = time + phaseOf(prop.id, name);
        for (let k = 0; k < part.flame.tongues; k++) {
          tongueMatrices(t, k, part.flame, outer, core);
          batch.add(outer.premultiply(world).elements, tint);
          batch.add(core.premultiply(world).elements, coreTint);
        }
      }
      const spot = prop.light;
      if (!spot.tag) return;
      toCentre.makeTranslation(0, -propCentre(prop), 0).premultiply(pose);
      const [x, y, z] = light.fromArray(spot.position).applyMatrix4(toCentre).toArray();
      const glow = spot.flicker ? FLICKER(time + phaseOf(prop.id, name)) : 1;
      const { tag, color, distance, decay } = spot;
      lights.push({
        prop: prop.id,
        tag,
        position: [x, y, z],
        color,
        intensity: spot.intensity * glow,
        distance,
        decay,
      });
    },
    end() {
      for (const batch of props.batches()) batch.end();
    },
    lights: () => lights.map((spot) => ({ ...spot, position: [...spot.position] })),
    drawCalls: (shadowMaps = 0) => props.batches().reduce((sum, batch) => sum + batch.drawCalls(shadowMaps), 0),
    register(warmup) {
      const held = props.batches().map((batch) => batch.register(warmup));
      warmups.set(warmup, held);
      return {
        dispose() {
          warmups.delete(warmup);
          for (const registration of held.splice(0)) registration.dispose();
        },
      };
    },
    dispose() {
      for (const held of warmups.values()) for (const registration of held.splice(0)) registration.dispose();
      warmups.clear();
      for (const draw of draws.values()) {
        for (const { batch, geometry } of draw.parts) {
          batch.dispose();
          geometry.dispose();
        }
      }
      draws.clear();
      root.removeFromParent();
    },
  };
  return props;
}
