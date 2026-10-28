/**
 * @file The gallery's scene, `dev:gallery` (PLAN.md WP 7.7), sim-side: one entry of a kind with a `gallery` field
 * (engine/core/gallery.ts) staged in the middle of an empty stage (`GALLERY_AT`; engine/gfx/stage.ts draws 16 × 16 m
 * of ground and its lights round the origin's quarter), on a floor, the way play stages it, so the view draws it as
 * it draws a game (engine/dev/gallery.ts films it):
 * - a prop where it stands: on the floor, or 1.2 m up when it has no body (a switch, a lamp, a sconce);
 * - a material on a 1 m cube (the stage's stand-in for the component `gallerySwatch`);
 * - a body as a figure, an actor with a sword on the build the body is made for (its `build`, else the heroic one),
 *   in a state: a sample state (engine/anim/states.ts), a pose or a stance (engine/anim/poses.ts), or `walk` and
 *   `run`, walking and running forward;
 * - a move as the humanoid figure swinging it once from rest, as a game plays a move (`Attack`, engine/anim/attack.ts),
 *   its blade's trail drawn while it strikes;
 * - a look's set, which every look draws: a crate, a barrel, a stone, a wooden and a brick cube and a figure;
 * - an emitter's stage empty: the view bursts it (engine/gfx/fx/effects.ts), as the sim cannot name an emitter.
 * The recorded settings `gallery.kind`, `gallery.subject` and `gallery.state` stage the first entry (a deep link,
 * engine/app/routes.ts); its dev action `show` `{ kind, id, state }` stages another between steps, the last one's
 * entities removed. A figure's states, walk and swing are its component `galleryFigure`, told to it each step.
 *
 * Invariants: sim-side and reproducible (the bot's rules: engine/dev/bot.ts); the stage holds only the subject, so
 * every entity in it is the subject's; a kind with no staging here stages nothing.
 *
 * @example
 * import { createSession } from '../sim/session';
 * galleryScene();
 * const session = createSession(GALLERY_SCENE, { seed: 1, settings: { 'gallery.kind': 'prop', 'gallery.subject': 'prop:crate' } }); // prettier-ignore
 * session.step({});
 * session.world.query('sceneProp').length; // 1: the crate, in the middle
 * @see engine/dev/galleryScene.test.ts
 */
import { registry as sharedRegistry, type Registry } from '../core/registry';
import { copyValue } from '../core/schema';
import { defineSettings } from '../core/settings';
import { POSES, STANCES } from '../anim/poseNames';
import { Attack, type AttackState } from '../anim/attack';
import { SAMPLE_STATES, type AnimatorInput } from '../anim/states';
import { physicsOf } from '../physics/binding';
import { createCharacter } from '../physics/character';
import { removeActor, spawnActor, type ActorComponents } from '../sim/actors';
import { removeProp, spawnProp } from '../sim/props';
import { defineScene } from '../sim/scene';
import { defineComponent } from '../sim/state';
import type { World } from '../sim/world';
import { getProp } from '../world/props/prop';

/** The gallery scene's id. */
export const GALLERY_SCENE = 'dev:gallery';

/** Where the subject stands: the middle of an empty stage's ground (engine/gfx/stage.ts: 16 × 16 m from the origin). */
export const GALLERY_AT = [8, 0, 8] as const;

/** How high a prop without a body hangs, as on a wall (m). */
const HUNG = 1.2;

/** The words the controller sets every step, which a figure's states leave to it (engine/sim/actors.ts). */
const CONTROLLED = ['position', 'velocity', 'yaw', 'air', 'dash'];

/** A figure's way forward for the states it walks in (intents' `move`, world [x, z]). */
const WALKS: Readonly<Record<string, readonly [number, number]>> = { walk: [0, 0.4], run: [0, 1] };

/** A figure's state by name: what it is told and how far forward it walks; null for a name it does not know. */
export function figureState(name: string): { states: AnimatorInput; move: [number, number] | null } | null {
  if (Object.hasOwn(WALKS, name)) return { states: {}, move: [...WALKS[name]] };
  const sample = (SAMPLE_STATES as Readonly<Record<string, { states: AnimatorInput }>>)[name];
  if (sample) {
    const states = Object.fromEntries(Object.entries(sample.states).filter(([word]) => !CONTROLLED.includes(word)));
    return { states: states as AnimatorInput, move: null };
  }
  if (Object.hasOwn(POSES, name)) return { states: { pose: name as keyof typeof POSES }, move: null };
  if (Object.hasOwn(STANCES, name)) return { states: { stance: name as keyof typeof STANCES }, move: null };
  return null;
}

/** Every name `figureState` knows: walk and run, the sample states, the poses and the stances. */
export const FIGURE_STATES = [
  ...new Set([...Object.keys(WALKS), ...Object.keys(SAMPLE_STATES), ...Object.keys(POSES), ...Object.keys(STANCES)]),
];

/** The component `galleryFigure`: what a figure is told each step, and the swing it plays. */
interface FigureComponent {
  states: AnimatorInput;
  move: [number, number] | null;
  /** The move it swings once from where it is staged ('' none), and its attack's state as it plays (null before). */
  swing: string;
  attack: AttackState | null;
}

/** What a figure is told that plays no swing. */
const told = (states: AnimatorInput, move: [number, number] | null = null): FigureComponent => ({ states, move, swing: '', attack: null }); // prettier-ignore

type GalleryEntity = Partial<ActorComponents> & { id: number; galleryFigure?: FigureComponent };

/** The build body `id` is made for (its entry's `build`), else the heroic build: what its figure stands on. */
function buildOf(id: string): string {
  const known = sharedRegistry.kinds().includes('body') && sharedRegistry.has('body', id);
  return (known && (sharedRegistry.get('body', id) as unknown as { build: string }).build) || 'build:heroic';
}

/** Stands a figure of body `body` told `told`, facing +Z: an actor with a sword, on the body's build. */
function figure(w: World, body: string, told: FigureComponent, at: readonly [number, number, number] = GALLERY_AT) {
  const character = createCharacter();
  const anim = { build: buildOf(body), weapon: 'sword' } as const;
  spawnActor(w, { at, character, player: false, anim, body, components: { galleryFigure: told } });
}

/** The look's set: a crate, a barrel, three cubes and a figure, round the middle. */
function lookSet(w: World): void {
  const [x, , z] = GALLERY_AT;
  spawnProp(w, { prop: 'prop:crate', at: [x - 1.3, 0, z + 0.2], yaw: 0.4 });
  spawnProp(w, { prop: 'prop:barrel', at: [x + 1.3, 0, z - 0.2], yaw: 0 });
  for (const [k, material] of ['material:stone', 'material:wood', 'material:brick'].entries())
    w.spawn({ gallerySwatch: { x: x - 1 + k, y: 0, z: z - 1.4, yaw: 0, size: 0.8, material } });
  figure(w, 'body:humanoid', told({}), [x, 0, z + 0.6]);
}

/** How each kind is staged, by kind (see the file comment). */
const STAGES: Readonly<Record<string, (w: World, id: string, state: string) => void>> = {
  prop: (w, id) => {
    const y = getProp(id).body.type === 'none' ? HUNG : 0;
    spawnProp(w, { prop: id, at: [GALLERY_AT[0], y, GALLERY_AT[2]], yaw: 0 });
  },
  material: (w, id) => void w.spawn({ gallerySwatch: { x: GALLERY_AT[0], y: 0, z: GALLERY_AT[2], yaw: 0, size: 1, material: id } }), // prettier-ignore
  body: (w, id, state) => {
    const named = figureState(state);
    figure(w, id, told(named?.states ?? {}, named?.move ?? null));
  },
  move: (w, id) => figure(w, 'body:humanoid', { ...told({}), swing: id }),
  look: (w) => lookSet(w),
};

/** Removes everything the stage holds: props, actors and swatches. */
function clear(w: World): void {
  for (const e of w.query('sceneProp') as unknown as { id: number }[]) removeProp(w, e.id);
  for (const e of w.query('actor') as unknown as { id: number }[]) removeActor(w, e.id);
  for (const e of w.query('gallerySwatch') as unknown as { id: number }[]) w.despawn(e.id);
}

/** Stages `id` of `kind` in `state` (see the file comment); a kind with no staging stages nothing. */
function show(w: World, kind: string, id: string, state: string): void {
  clear(w);
  if (id && Object.hasOwn(STAGES, kind)) STAGES[kind](w, id, state);
}

/**
 * The system `scene` of the gallery: each figure told its states and its walk, and its swing played a step on, as a
 * game plays a move (labs/box/scenes/fight-hero.ts): its phase and share in `body`, the blade's trail while it strikes.
 */
function tell(w: World): void {
  for (const e of w.query('galleryFigure') as unknown as GalleryEntity[]) {
    const figure = e.galleryFigure!;
    const states = copyValue(figure.states);
    if (figure.swing) {
      const attack = new Attack(figure.swing);
      if (figure.attack) attack.load(figure.attack);
      else attack.start();
      attack.update(w.dt);
      figure.attack = attack.save();
      const { body } = attack;
      if (body) states.body = { move: figure.swing, phase: body.phase, u: body.u } as AnimatorInput['body'];
      const trail = attack.busy ? attack.trail(true) : undefined;
      if (trail) states.trail = trail;
    }
    e.animator!.states = states;
    e.actor!.intents = figure.move ? { move: [figure.move[0], figure.move[1]] } : {};
  }
}

/** Declares the gallery's settings, its component and its scene on `registry`, unless it has them. */
export function galleryScene(registry: Registry = sharedRegistry): void {
  if (registry.kinds().includes('scene') && registry.has('scene', GALLERY_SCENE)) return;
  const string = (description: string) => ({ type: 'string', default: '', when: 'scene', description }) as const;
  defineSettings(
    {
      'gallery.kind': string('The kind whose entry the gallery scene stages when it starts (dev:gallery).'),
      'gallery.subject': string('The entry it stages, by id; none when empty.'),
      'gallery.state': string("The entry's state: a body's state's name; '' for none."),
    },
    registry,
  );
  const number = (description: string) => ({ type: 'number', default: 0, unit: 'm', description }) as const;
  defineComponent(
    'gallerySwatch',
    {
      description: "A material shown on a cube in the gallery's stage (engine/dev/galleryScene.ts): a stand-in.",
      fields: {
        ...{ x: number('Its middle, east.'), y: number('Its bottom.'), z: number('Its middle, south.') },
        yaw: { type: 'number', default: 0, unit: 'rad', description: 'Its turn about +Y.' },
        size: { type: 'number', default: 1, minimum: 0, unit: 'm', description: 'Its side.' },
        material: { type: 'string', default: 'material:default', description: 'The material it shows.' },
      },
    },
    registry,
  );
  defineComponent(
    'galleryFigure',
    {
      description: "What a figure in the gallery's stage is told each step: its body states, its walk and its swing.",
      fields: {
        states: { type: 'object', default: {}, description: 'The body states it holds (engine/anim/states.ts).' },
        move: { type: 'any', default: null, description: 'The way it walks, world [x, z], or null to stand.' },
        swing: {
          type: 'string',
          default: '',
          description: "The move it swings once from where it is staged; '' none.",
        },
        attack: { type: 'any', default: null, description: "The swing's attack as it plays (engine/anim/attack.ts)." },
      },
    },
    registry,
  );
  defineScene(
    GALLERY_SCENE,
    {
      description: "The gallery's stage (engine/dev/gallery.ts): one entry of a kind with a gallery field, staged in the middle of an empty stage.", // prettier-ignore
      physics: true,
      setup(w) {
        const [x, , z] = GALLERY_AT;
        physicsOf(w).addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [16, 1, 16] }, position: [x, -0.5, z] }] }); // prettier-ignore
        const at = (path: string) => w.settings.get<string>(`gallery.${path}`);
        show(w, at('kind'), at('subject'), at('state'));
      },
      step: tell,
      actions: {
        /** Stages `id` of `kind` in `state` instead of what the stage holds. */
        show(w, args) {
          const { kind = '', id = '', state = '' } = (args ?? {}) as { kind?: string; id?: string; state?: string };
          show(w, String(kind), String(id), String(state));
        },
      },
    },
    registry,
  );
}
galleryScene();
