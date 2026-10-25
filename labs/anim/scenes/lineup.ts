/**
 * @file The Animation Lab's scene, `lab:lineup` (PLAN.md WP 10.8; my-3d2dge's animlab, `src/starter/60-animlab.js`: its
 * lineup, its timeline and its frozen key poses): the humanoid body on every build in a row, chibi to adult, and the
 * mannequin when its build is registered (the clip library's rest body), all told the same thing from one clock, so
 * the lineup stays in step:
 * - `lab.anim.play`: a sample state, a pose or a stance as engine/anim/states.ts and poses.ts name them (`idle`,
 *   `cheer`, `ready`…), `walk` or `run` (each figure walks forward and is put back where it started), a move
 *   (`move:jab`…) swung again and again, a rest of `REST` s between swings, its blade's trail drawn while it strikes,
 *   or a clip of the library (`clip:cmu/Cartwheel`: retargeted to every build, looped; the page registers the sets);
 * - `lab.anim.time`: timeline scrubbing, a move held that many seconds from its start (−1 plays), so its wind-up,
 *   strike and recovery can be stepped through frame by frame; `lab.anim.speed`: the rate a move plays at.
 * The page (labs/anim/main.ts) draws the move's phases as a timeline and the figures' bones over them.
 *
 * Game code, sim-side: it imports only engine/sim-api.ts. The same job without the page: `node x gallery move` (each
 * move on the humanoid, filmed at its phases), `node x sheet` (a body's states as a contact sheet) and `node x sim`
 * on labs/anim/scenes/lineup.ts (`--set lab.anim.play=move:jab`: the lineup headless).
 *
 * @example
 * // labs/anim/?lab.anim.play=move:jab&lab.anim.time=0.3
 * LINEUP_BUILDS; // ['build:chibi', 'build:heroic', 'build:bulky', 'build:skeleton', 'build:adult', 'build:mannequin']
 * @see labs/anim/scenes/lineup.test.ts
 */
import {
  addClips,
  Attack,
  clipSetIds,
  createCharacter,
  defineComponent,
  defineScene,
  defineSettings,
  physicsOf,
  placeActor,
  playClip,
  POSES,
  SAMPLE_STATES,
  spawnActor,
  STANCES,
  stopClip,
  type AnimatorInput,
  type AttackState,
  type World,
} from '../../../engine/sim-api';

/** The builds in the row, left to right; the mannequin's only with `lab.anim.mannequin`. */
export const LINEUP_BUILDS = ['build:chibi', 'build:heroic', 'build:bulky', 'build:skeleton', 'build:adult', 'build:mannequin']; // prettier-ignore
/** Where the row stands: the middle of the stage's ground, as the gallery stands its subject (m). */
export const LINEUP_AT = [8, 0, 8] as const;
/** How far apart the figures stand (m). */
export const LINEUP_GAP = 1.2;
/** How long a figure rests between two swings of a move (s). */
export const REST = 0.5;
/** How far a walking figure goes before it is put back where it started (m). */
const WALK_SPAN = 3;
/** The words the controller sets every step, which a sample state leaves to it (engine/sim/actors.ts). */
const CONTROLLED = ['position', 'velocity', 'yaw', 'air', 'dash'];

/** Every name `lab.anim.play` takes besides a move's id: walk and run, the sample states, the poses and the stances. */
export const LINEUP_STATES = [...new Set(['walk', 'run', ...Object.keys(SAMPLE_STATES), ...Object.keys(POSES), ...Object.keys(STANCES)])]; // prettier-ignore

/** The scene's settings (see the file comment). */
export const LINEUP_SETTINGS = defineSettings({
  'lab.anim.play': {
    type: 'string',
    default: 'idle',
    description:
      'What the lineup plays: a state, a pose or a stance (idle, cheer, ready…), walk or run, a move (move:jab…), or a library clip (clip:<set>/<clip>).',
  },
  'lab.anim.time': {
    type: 'number',
    default: -1,
    minimum: -1,
    maximum: 10,
    description: 'A move held that many seconds from its start (timeline scrubbing); -1 plays it.',
  },
  'lab.anim.mannequin': {
    type: 'boolean',
    default: false,
    when: 'scene',
    description: "Whether the row ends with the mannequin (build:mannequin, which the clip library's page registers).",
  },
  'lab.anim.speed': {
    type: 'number',
    default: 1,
    minimum: 0,
    maximum: 2,
    description: 'The rate a move plays at: 1 as authored, 0.25 at a quarter speed.',
  },
});

/** The component `labFigure`: a figure's place in the row, what it last played, and its swing. */
interface FigureData {
  x: number;
  played: string;
  attack: AttackState | null;
  rest: number;
}

interface Components {
  labFigure: FigureData;
  actor: { intents: Record<string, unknown>; z: number };
  animator: { states: AnimatorInput };
}

/** The component `labFigure` (see `FigureData`). */
export const LAB_FIGURE = defineComponent('labFigure', {
  description: "A figure in the Animation Lab's lineup (labs/anim/scenes/lineup.ts): its place and its swing.",
  fields: {
    x: { type: 'number', default: 0, unit: 'm', description: 'Where it stands across the row (east).' },
    played: { type: 'string', default: '', description: 'What it played last step.' },
    attack: { type: 'any', default: null, description: 'Its swing as it plays (engine/anim/attack.ts), or null.' },
    rest: { type: 'number', default: 0, unit: 's', description: 'How long it rests before its next swing.' },
  },
});

/** What a figure is told for `play` when it is no move: its states, and whether it walks (and how fast). */
function told(play: string): { states: AnimatorInput; walk: number } {
  if (play === 'walk' || play === 'run') return { states: {}, walk: play === 'walk' ? 0.4 : 1 };
  const sample = (SAMPLE_STATES as Readonly<Record<string, { states: AnimatorInput }>>)[play];
  if (sample) {
    const states = Object.fromEntries(Object.entries(sample.states).filter(([word]) => !CONTROLLED.includes(word)));
    return { states: states as AnimatorInput, walk: 0 };
  }
  if (Object.hasOwn(POSES, play)) return { states: { pose: play as keyof typeof POSES }, walk: 0 };
  if (Object.hasOwn(STANCES, play)) return { states: { stance: play as keyof typeof STANCES }, walk: 0 };
  return { states: {}, walk: 0 };
}

/** Swings `move` a step on for a figure (or holds it at `time`): the body states its swing gives. */
function swing(figure: FigureData, move: string, dt: number, time: number): AnimatorInput {
  const attack = new Attack(move);
  if (time >= 0) {
    attack.start();
    attack.update(time);
  } else if (figure.attack && figure.played === move) {
    attack.load(figure.attack);
    if (attack.busy) attack.update(dt);
    else if ((figure.rest -= dt) <= 0) [figure.rest] = [REST, attack.start()];
  } else attack.start();
  figure.attack = attack.save();
  const states: AnimatorInput = {};
  const { body } = attack;
  if (body) states.body = { move, phase: body.phase, u: body.u } as AnimatorInput['body'];
  const trail = attack.busy ? attack.trail(true) : undefined;
  if (trail) states.trail = trail;
  return states;
}

/** The scene's step: each figure told what `lab.anim.play` names, from one clock. */
function tell(w: World): void {
  const [play, time, speed] = [
    w.settings.get<string>('lab.anim.play'),
    w.settings.get<number>('lab.anim.time'),
    w.settings.get<number>('lab.anim.speed'),
  ];
  const move = play.startsWith('move:');
  const clip = play.startsWith('clip:') ? play.slice('clip:'.length) : null;
  const plain = move || clip ? null : told(play);
  for (const e of w.query('labFigure') as unknown as ({ id: number; clips?: object } & Components)[]) {
    const figure = e.labFigure;
    if (figure.played !== play) {
      placeActor(w, e.id, [figure.x, LINEUP_AT[1], LINEUP_AT[2]], 0);
      [figure.attack, figure.rest] = [null, REST];
      if (clip && !e.clips) addClips(w, e.id, { sets: clipSetIds(), ik: true });
      if (clip) playClip(w, e.id, clip, { loop: true, walk: true, fade: 0.2 });
      else if (e.clips) stopClip(w, e.id, 0.2);
    }
    if (clip) {
      [e.animator.states, e.actor.intents, figure.played] = [{}, {}, play];
      continue;
    }
    e.animator.states = move ? swing(figure, play, w.dt * speed, time) : { ...(plain?.states ?? {}) };
    e.actor.intents = plain?.walk ? { move: [0, plain.walk] } : {};
    figure.played = play;
    if (plain?.walk && e.actor.z > LINEUP_AT[2] + WALK_SPAN) placeActor(w, e.id, [figure.x, LINEUP_AT[1], LINEUP_AT[2]], 0); // prettier-ignore
  }
}

/** The Animation Lab's lineup (see the file comment). */
export const lineup = defineScene('lab:lineup', {
  description:
    "The Animation Lab's lineup: the humanoid on every build and the mannequin, told one state, pose, stance or move from one clock.",
  physics: true,
  setup(w) {
    physicsOf(w).addBody({
      type: 'fixed',
      colliders: [{ shape: { type: 'box', size: [40, 1, 40] }, position: [LINEUP_AT[0], -0.5, LINEUP_AT[2]] }],
    });
    const builds = LINEUP_BUILDS.filter((build) => build !== 'build:mannequin' || w.settings.get<boolean>('lab.anim.mannequin')); // prettier-ignore
    builds.forEach((build, i) => {
      const x = LINEUP_AT[0] + (i - (builds.length - 1) / 2) * LINEUP_GAP;
      const body = build === 'build:mannequin' ? 'body:mannequin' : 'body:humanoid';
      const labFigure: FigureData = { x, played: '', attack: null, rest: REST };
      const at = [x, LINEUP_AT[1], LINEUP_AT[2]] as const;
      spawnActor(w, { at, character: createCharacter(), player: false, anim: { build, weapon: 'sword' }, body, components: { labFigure } }); // prettier-ignore
    });
  },
  step: (w) => tell(w),
});
