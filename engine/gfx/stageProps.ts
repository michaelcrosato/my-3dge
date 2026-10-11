/**
 * @file Props on the stage (PLAN.md WP 4.6 core proposal, ADR-0008 amendment 5; §6.4's view): every entity with the
 * component `sceneProp` (engine/sim/props.ts: a prop standing in a scene, its id and its pose) drawn as its prop
 * through the prop meshes (engine/gfx/props.ts: one instanced batch per prop part, so a hundred crates are one draw
 * call), where its pose is at the frame's alpha. The stage (engine/gfx/stage.ts) draws these instead of stand-ins.
 *
 * `capture(entities, dt)` after each sim step keeps each prop's last two poses (centre and turn) and returns the ids
 * it draws; `draw(alpha)` draws each `alpha` of the way from the one before to the last (the centre along the line,
 * the turn the shorter way round), at presentation time (the steps captured, `alpha` of a step on), on which the
 * flames dance; each prop is drawn under its entity id, so its flames keep their own phase. `lights()` lists this
 * frame's light spots in world space (the brazier's torch), for the light pool (WP 7.1).
 *
 * The prop meshes are made when the first prop arrives, with a batch for every registered prop, and added to the
 * stage's scene then: a stage with no prop has none, and its scene graph is the one it had before props. `register`
 * registers their batches with the warm-up and adds whether there are any to the shader key, so the frame after they
 * arrive warms up first instead of stalling.
 *
 * Invariants: presentation only (doctrine: WebGPU only): it reads the components and writes nothing back; equal
 * captures and alphas give equal matrices; every object it makes is under the prop meshes' root.
 *
 * @example
 * // const props = createStageProps({ scene: stage.scene, materials: library });
 * // const drawn = props.capture(world.query('sceneProp'), world.dt); // the ids drawn as props
 * // props.draw(0.5); // halfway between the last two steps
 * @see engine/gfx/stageProps.test.ts
 */
import { Quaternion, Vector3, type Material, type Scene } from 'three/webgpu';
import { registry as sharedRegistry, type Registry } from '../core/registry';
import type { EntityData } from '../sim/state';
import { createPropMeshes, type PropLight, type PropMeshes } from './props';
import type { Warmup } from './warmup';

/** What `createStageProps` takes. */
export interface StagePropsOptions {
  /** The scene the prop meshes join when the first prop arrives. */
  scene: Scene;
  /** Where the materials come from: the page's material library. */
  materials: { get(id: string): Material };
  /** Where the props are declared (the shared registry by default). */
  registry?: Registry;
}

/** A prop's pose: its centre (m) and its turn. */
interface Pose {
  p: [number, number, number];
  q: [number, number, number, number];
}

/** What the module keeps of one prop. */
interface Held {
  prop: string;
  before: Pose;
  after: Pose;
}

/** Props drawn on the stage (see the file comment). */
export interface StageProps {
  /** The prop meshes, made when the first prop arrives; null until then. */
  readonly meshes: PropMeshes | null;
  /** The props it draws, by entity id: their prop's id. */
  readonly props: ReadonlyMap<number, string>;
  /** Reads the props after a sim step of `dt` s (keeps the pose before for `draw`); returns the ids it draws. */
  capture(entities: Iterable<EntityData>, dt?: number): Set<number>;
  /** Draws every prop `alpha` (0 to 1) of the way from its pose a step ago to its last. */
  draw(alpha: number): void;
  /** The light spots of the last frame's props, in world space. */
  lights(): PropLight[];
  /** Registers the prop meshes with `warmup`, now or when they are made, and their presence in the shader key. */
  register(warmup: Pick<Warmup, 'register' | 'keyPart'>): { dispose(): void };
  /** Frees the prop meshes. */
  dispose(): void;
}

/** The pose a `sceneProp` holds, or null for data that holds none. */
function poseOf(data: Record<string, unknown>): Pose | null {
  const { x, y, z, q } = data;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null;
  const turn = Array.isArray(q) && q.length === 4 && q.every(Number.isFinite) ? (q as Pose['q']) : [0, 0, 0, 1];
  return { p: [x, y, z], q: [turn[0], turn[1], turn[2], turn[3]] };
}

/** Draws the scene's props (see the file comment). */
export function createStageProps(options: StagePropsOptions): StageProps {
  const registry = options.registry ?? sharedRegistry;
  const held = new Map<number, Held>();
  const ids = new Map<number, string>();
  const warmups = new Set<Pick<Warmup, 'register' | 'keyPart'>>();
  const registrations = new Map<Pick<Warmup, 'register' | 'keyPart'>, { dispose(): void }>();
  const [a, b, at] = [new Quaternion(), new Quaternion(), new Vector3()];
  let meshes: PropMeshes | null = null;
  let [time, step] = [0, 1 / 60];

  /** The prop meshes, made now if they are not yet, and registered with every warm-up so far. */
  function made(): PropMeshes {
    if (meshes) return meshes;
    meshes = createPropMeshes({ materials: options.materials, registry });
    options.scene.add(meshes.root);
    for (const warmup of warmups) registrations.set(warmup, meshes.register(warmup));
    return meshes;
  }

  const props: StageProps = {
    get meshes() {
      return meshes;
    },
    props: ids,
    capture(entities, dt) {
      if (dt !== undefined && dt > 0) [time, step] = [time + dt, dt];
      const seen = new Set<number>();
      for (const entity of entities) {
        const data = entity.sceneProp as Record<string, unknown> | undefined;
        const pose = data && typeof data.prop === 'string' ? poseOf(data) : null;
        if (!data || !pose || seen.has(entity.id)) continue;
        seen.add(entity.id);
        const last = held.get(entity.id);
        const prop = data.prop as string;
        held.set(entity.id, { prop, before: last && last.prop === prop ? last.after : pose, after: pose });
        ids.set(entity.id, prop);
      }
      for (const id of [...held.keys()]) {
        if (seen.has(id)) continue;
        held.delete(id);
        ids.delete(id);
      }
      if (held.size > 0) made();
      return seen;
    },
    draw(alpha) {
      if (!meshes) return;
      const k = Math.min(1, Math.max(0, alpha));
      meshes.begin(time - step + k * step);
      for (const [id, { prop, before, after }] of held) {
        const [p0, p1] = [before.p, after.p];
        at.set(p0[0] + (p1[0] - p0[0]) * k, p0[1] + (p1[1] - p0[1]) * k, p0[2] + (p1[2] - p0[2]) * k);
        a.fromArray(before.q).slerp(b.fromArray(after.q), k);
        meshes.add(prop, { position: at, rotation: a }, id);
      }
      meshes.end();
    },
    lights: () => meshes?.lights() ?? [],
    register(warmup) {
      warmups.add(warmup);
      if (meshes) registrations.set(warmup, meshes.register(warmup));
      const presence = warmup.keyPart('stage:props', () => (meshes ? 'props' : ''));
      return {
        dispose() {
          warmups.delete(warmup);
          registrations.get(warmup)?.dispose();
          registrations.delete(warmup);
          presence.dispose();
        },
      };
    },
    dispose() {
      for (const registration of registrations.values()) registration.dispose();
      registrations.clear();
      warmups.clear();
      meshes?.dispose();
      meshes = null;
      held.clear();
      ids.clear();
    },
  };
  return props;
}
