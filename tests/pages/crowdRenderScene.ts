/**
 * @file The crowd-render page's scene (tests/pages/crowd-render.ts, PLAN.md WP 5.4), without the GPU, so Node runs it
 * too (tests/unit/crowd-render.test.ts): a sim world of wanderers, each crossing a square toward targets drawn from
 * the world's stream `crowd`, and the view that draws them through a crowd (engine/gfx/puppets/crowd.ts).
 *
 * The sim (a world on a registry of its own): component `wanderer` (its kind, its look, where it is, its velocity, its
 * target, and a rig's state as plain data) and, for walkers, `anim` (engine/anim/character.ts `ANIMATOR_FIELDS`).
 * Systems: `crowd.wander` (ai) steers each toward its target at its kind's speed; `crowd.anim` (anim) steps its rig:
 * a walker's animator (loaded from `anim` and saved back, as engine/sim/actors.ts does), a slime's blob (leaping on a
 * cycle of 36 ticks, some squinting), a wisp's floater (hovering at its height). Kinds: 4 walkers, 4 slimes and 2
 * wisps in every 10 spawned; walkers wear the humanoid (chibi) or the caped humanoid (`body:crowdCaped`, heroic),
 * slimes the source's five looks (`SLIME_LOOKS`).
 *
 * The view (`draw`): for each wanderer in id order, the crowd's `see`; only what it sees is posed (a walker's animator
 * at the band's level, a slime's or wisp's rig from its state) and drawn, with a blob shadow on the floor (y = 0). It
 * keeps rigs of its own, loaded from the components: it reads the sim, never writes it.
 *
 * Invariants: the same seed and count give the same world in Node and Chromium; nothing the view does reaches the
 * hash. The caped body is defined once on the shared registry.
 *
 * @see tests/e2e/crowd-render.spec.ts
 */
import { Vector3, type Camera } from 'three/webgpu';
import { Blob, BLOB } from '../../engine/anim/blob';
import { Animator, ANIMATOR_FIELDS, AnimatorPool, type AnimatorData } from '../../engine/anim/character';
import { Floater, type FloaterState } from '../../engine/anim/floater';
import { createRegistry, registry as shared } from '../../engine/core/registry';
import { blobBody } from '../../engine/gfx/puppets/bodies/blob';
import { HUMANOID_BODY } from '../../engine/gfx/puppets/bodies/humanoid';
import { compileBody, type CompiledBody } from '../../engine/gfx/puppets/compile';
import type { Crowd, RigBody } from '../../engine/gfx/puppets/crowd';
import { defineBody } from '../../engine/gfx/puppets/grammar';
import { defineComponent } from '../../engine/sim/state';
import { createWorld, type World } from '../../engine/sim/world';

/** The caped humanoid's id: the humanoid with a cape from its back. */
export const CAPED_ID = 'body:crowdCaped';
if (!shared.has('body', CAPED_ID)) {
  const cape = ['cape', 'back', ['off', 'back', -0.06, 0, -0.55], 0.34, 'cloth'] as const;
  defineBody(CAPED_ID, { ...HUMANOID_BODY, parts: [...(HUMANOID_BODY.parts ?? []), cape] });
}

/** The walkers' looks: compiled bodies, whose builds their animators share. */
export const WALKER_LOOKS: readonly CompiledBody[] = [
  compileBody('body:humanoid', 'build:chibi'),
  compileBody(CAPED_ID, 'build:heroic'),
];

/** The slimes' looks, as the source's cast varied them: plain twice, horns, cat ears, wings. */
export const SLIME_LOOKS: readonly RigBody[] = [
  blobBody(),
  blobBody(),
  blobBody({ horns: true }),
  blobBody({ ears: true }),
  blobBody({ wings: true }),
];

type Kind = 'walker' | 'slime' | 'wisp';
interface Wanderer {
  kind: Kind;
  look: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  tx: number;
  tz: number;
  rig: Record<string, number | boolean>;
}
type Components = { wanderer: Wanderer; anim: AnimatorData };
/** The scene's world. */
export type CrowdWorld = World<Components>;

/** Each kind's speed (m/s) and its share of every 10 spawned. */
const KINDS: readonly Kind[] = [
  'walker',
  'slime',
  'walker',
  'slime',
  'wisp',
  'walker',
  'slime',
  'walker',
  'slime',
  'wisp',
];
const SPEED: Record<Kind, number> = { walker: 1.4, slime: 1.1, wisp: 1.6 };

/** What a crowd scene offers the page. */
export interface CrowdScene {
  readonly world: CrowdWorld;
  /** The square's side, metres, centred on the origin. */
  readonly side: number;
  /** Spawns wanderers until there are `count`. */
  grow(count: number): void;
  /** Draws every wanderer the crowd sees (see the file comment); returns how many it drew. */
  draw(crowd: Crowd, camera: Camera): number;
}

/** A crowd scene with `seed`, its wanderers in a square of `side` metres. */
export function createCrowdScene(options: { seed: number; side: number }): CrowdScene {
  const registry = createRegistry();
  defineComponent(
    'wanderer',
    {
      description: 'A wanderer: its kind and look, where it is, its velocity, its target, and its rig’s state.',
      fields: {
        kind: { type: 'string', enum: ['walker', 'slime', 'wisp'], default: 'walker', description: 'Its kind.' },
        look: { type: 'integer', default: 0, description: 'Which of its kind’s looks it wears.' },
        x: { type: 'number', default: 0, description: 'East, metres.' },
        y: { type: 'number', default: 0, description: 'Up, metres.' },
        z: { type: 'number', default: 0, description: 'South, metres.' },
        vx: { type: 'number', default: 0, description: 'Its velocity east, m/s.' },
        vz: { type: 'number', default: 0, description: 'Its velocity south, m/s.' },
        tx: { type: 'number', default: 0, description: 'Its target east, metres.' },
        tz: { type: 'number', default: 0, description: 'Its target south, metres.' },
        rig: { type: 'object', default: {}, description: 'A slime’s blob state or a wisp’s floater state.' },
      },
    },
    registry,
  );
  defineComponent('anim', { description: 'A walker’s animator, as plain data.', fields: ANIMATOR_FIELDS }, registry);
  const world = createWorld<Components>({ seed: options.seed, registry });
  const half = options.side / 2;
  const stream = world.rng('crowd');
  const [blob, floater, pool] = [new Blob(), new Floater(), new AnimatorPool()];
  const [at, velocity, look] = [new Vector3(), new Vector3(), new Vector3()];

  world.systems.add(
    'crowd.wander',
    (w) => {
      for (const { wanderer: e } of w.query('wanderer')) {
        if (Math.hypot(e.tx - e.x, e.tz - e.z) < 0.5)
          [e.tx, e.tz] = [stream.range(-half, half), stream.range(-half, half)];
        const d = Math.hypot(e.tx - e.x, e.tz - e.z) || 1;
        [e.vx, e.vz] = [((e.tx - e.x) / d) * SPEED[e.kind], ((e.tz - e.z) / d) * SPEED[e.kind]];
        [e.x, e.z] = [e.x + e.vx * w.dt, e.z + e.vz * w.dt];
      }
    },
    { phase: 'ai' },
  );
  world.systems.add(
    'crowd.anim',
    (w) => {
      for (const { id, wanderer: e, anim } of w.query('wanderer')) {
        at.set(e.x, e.y, e.z);
        velocity.set(e.vx, 0, e.vz);
        if (anim) {
          const animator = pool.get(id, anim, { rng: w.rng.entity(id, 'anim'), dt: w.dt });
          animator.step({ position: at, velocity, yaw: Math.atan2(e.vx, e.vz) }).save(anim);
        } else if (e.kind === 'slime') {
          Object.assign(blob.state, e.rig);
          const move = { name: 'leap' as const, time: ((w.tick + id * 7) % 36) * w.dt };
          blob.step({ position: at, look: look.copy(velocity), move, squint: id % 7 === 0 });
          Object.assign(e.rig, blob.state);
        } else {
          Object.assign(floater.state, e.rig);
          floater.position.copy(at);
          floater.step({ position: at, velocity });
          e.y += floater.hover(e.y, 0) * w.dt;
          Object.assign(e.rig, floater.state);
        }
      }
    },
    { phase: 'anim' },
  );

  const viewPool = new AnimatorPool();
  const [viewBlob, viewFloater, ground] = [new Blob(), new Floater(), new Vector3()];
  return {
    world,
    side: options.side,
    grow(count) {
      world.run((w) => {
        for (let i = w.count; i < count; i++) {
          const kind = KINDS[i % KINDS.length];
          const [x, z] = [stream.range(-half, half), stream.range(-half, half)];
          const wanderer = { kind, look: 0, x, y: 0, z, tx: x, tz: z, rig: {} as Wanderer['rig'] };
          if (kind === 'walker') {
            wanderer.look = stream.int(0, WALKER_LOOKS.length - 1);
            w.spawn({ wanderer, anim: { build: WALKER_LOOKS[wanderer.look].skeleton.build.id } as AnimatorData });
            continue;
          }
          wanderer.look = kind === 'slime' ? stream.int(0, SLIME_LOOKS.length - 1) : 0;
          const rig = kind === 'slime' ? new Blob({ yaw: stream.range(-Math.PI, Math.PI) }).state : new Floater().state;
          wanderer.rig = { ...(rig as FloaterState | Blob['state']) };
          if (kind === 'wisp') wanderer.y = 1.25;
          w.spawn({ wanderer });
        }
      });
    },
    draw(crowd, camera) {
      crowd.begin(camera);
      let drawn = 0;
      for (const { id, wanderer: e, anim } of world.query('wanderer')) {
        if (anim) {
          const compiled = WALKER_LOOKS[e.look];
          const band = crowd.see(e.x, e.y + compiled.skeleton.offsets[1], e.z, compiled.reach);
          if (!band) continue;
          const animator: Animator = viewPool.get(id, anim, { dt: world.dt });
          animator.pose({ at: ground.set(e.x, e.y, e.z), yaw: Math.atan2(e.vx, e.vz), lod: band.pose });
          crowd.humanoid(compiled, animator.body.pose, { band, floor: 0 });
        } else if (e.kind === 'slime') {
          const band = crowd.see(e.x, e.y + BLOB.radius, e.z, BLOB.radius * 2.6);
          if (!band) continue;
          Object.assign(viewBlob.state, e.rig);
          viewBlob.position.set(e.x, e.y, e.z);
          crowd.blob(viewBlob, { band, floor: 0, body: SLIME_LOOKS[e.look] });
        } else {
          const band = crowd.see(e.x, e.y, e.z, 0.7);
          if (!band) continue;
          Object.assign(viewFloater.state, e.rig);
          viewFloater.position.set(e.x, e.y, e.z);
          crowd.floater(viewFloater, { band });
        }
        drawn++;
      }
      crowd.end();
      return drawn;
    },
  };
}
