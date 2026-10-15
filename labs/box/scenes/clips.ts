/**
 * @file Clip mode, the animation library in the box (PLAN.md §10, WP 8.9; the Mocap Lab's clip mode,
 * `my-3d2dge:src/mocap.game.js`): the room (labs/box/levels/room.txt) as a physics level, the hero at its spawn and the
 * mannequin beside him, both playing a clip of the library through the clip layer in their animators (engine/sim
 * actorClips.ts), over the procedural rig. The mannequin is the figure the Quaternius clips were measured on
 * (`body:mannequin` on `build:mannequin`); the hero plays the clip retargeted to his build, and stays the player: he
 * walks under it (`box.clips.mask=upper` keeps his legs' own walk).
 *
 * Settings (`box.clips.*`, read every step, so a change plays at once and goes in replays): the clip, named
 * `<set>/<clip>` as `node x anim show` and `node x anim find` name it (a change crossfades to it from the pose on
 * screen); its rate; frame stepping (`box.clips.frame`, a frame of its bake at 30 a second, as `x anim bake` counts
 * them, held; -1 plays); the mirror and the mask. A one-shot holds its end 0.8 s, then plays again, as the Lab's did.
 * When the scene starts: who plays (`box.clips.cast`) and contact IK (`box.clips.ik`).
 *
 * The library's sets come from the registry (`defineClipSet`, the kind `clipset`): the box page registers every set
 * under data/anim/sets/ before it opens this scene (labs/box/main.ts), and so do tests/pages/replay.ts and the Node
 * hosts, `x sim`, `x replay` and tests (tools/anim/library.ts `defineLibrary`). Without them the setup fails with
 * `CORE_NO_ENTRY`, naming `defineClipSet`. Clips that travel play in place (their root motion is the layer's `root`,
 * which a game moves the body by). Its machine interface: `node x anim show <set>/<clip>` prints the clip this plays,
 * `__engine.describe('clipset')` and `node x describe clipset` list the sets, and the inspector shows each figure's
 * component `clips` (what plays, its time and weight) and its animator's layers (`__engine.anim(id)`).
 *
 * Game code, sim-side: it imports only engine/sim-api.ts and the box's own files.
 *
 * Tests: labs/box/scenes/clips.test.ts (every clip on the mannequin headless; `x anim show` and the setting select the
 * same clip, frame for frame; tests/replays/box-8-clips.replay.json's goldens), tests/e2e/box-clips.spec.ts (one clip
 * of each set in the page; `BOX_CLIPS=all` plays them all, a long run), tests/e2e/parity.spec.ts (the replay's
 * goldens while the page renders; live play replayed in Node).
 *
 * @example
 * // labs/box/?scene=clips&box.clips.clip=cmu/Cartwheel&cam=threequarter
 * // __engine.set('box.clips.clip', 'style100/Old_Walk'); __engine.set('box.clips.frame', 12)
 * // node x set box.clips.clip quaternius/Sword_Attack (in an x inspect session)
 * CLIPS_START; // [3.5, 0, 2.5]: the hero's spawn in the room; the mannequin stands 1.5 m east of him
 */
import {
  addLevelBodies,
  BAKE_FPS,
  clipLayerOf,
  clipSetIds,
  createCharacter,
  defineComponent,
  defineScene,
  defineSetBuild,
  defineSettings,
  getClipSet,
  physicsOf,
  playClip,
  seekClip,
  spawnActor,
  type ClipPlay,
  type World,
} from '../../../engine/sim-api';
import { HERO_BODY, heroCharacter } from '../cast/hero';
import { ROOM_HERO_LEVEL } from './room-hero';
import { boxSounds } from '../sounds/events';

/** The scene's settings (see the file comment). */
export const CLIPS_SETTINGS = defineSettings({
  'box.clips.clip': {
    type: 'string',
    default: 'quaternius/Dance_Loop',
    description:
      'The clip the figures play, <set>/<clip> as node x anim show names it (node x anim find lists them): a change crossfades to it.',
  },
  'box.clips.speed': {
    type: 'number',
    default: 1,
    minimum: 0,
    maximum: 2,
    description: 'The rate it plays at: 1 as captured, 0.5 at half speed, 0 holds it.',
  },
  'box.clips.frame': {
    type: 'integer',
    default: -1,
    minimum: -1,
    maximum: 100_000,
    description:
      'Frame stepping: the frame of its bake held (from 0, 30 a second, as x anim bake counts them); -1 plays.',
  },
  'box.clips.mirror': {
    type: 'boolean',
    default: false,
    description: 'Whether it plays mirrored, left and right swapped.',
  },
  'box.clips.mask': {
    type: 'string',
    enum: ['full', 'upper'],
    default: 'full',
    description: 'The joints it plays: the whole body, or the upper body over the legs’ own walk.',
  },
  'box.clips.cast': {
    type: 'string',
    enum: ['both', 'mannequin', 'hero'],
    default: 'both',
    when: 'scene',
    description: 'Who plays it: the mannequin (the figure the Quaternius clips were measured on), the hero, or both.',
  },
  'box.clips.ik': {
    type: 'boolean',
    default: true,
    when: 'scene',
    description: 'Whether the figures plant their feet and lift their bodies over the floor (contact IK).',
  },
});

/** Clip mode's own state: how long the one-shot playing has held its end, in steps. */
export const CLIPS_MODE = defineComponent('clipsMode', {
  description: 'The box’s clip mode (labs/box/scenes/clips.ts): how long the one-shot playing has held its end.',
  fields: { held: { type: 'integer', default: 0, minimum: 0, description: 'Steps the one-shot has held its end.' } },
});

/** Where the hero starts: the room's spawn `@`, as in the room with a hero. */
export const CLIPS_START = ROOM_HERO_LEVEL.spawns.find((spawn) => spawn.name === 'hero')!.position;
/** How far east of him the mannequin stands, m. */
const BESIDE = 1.5;
/** How long a one-shot holds its end before it plays again, s (the Lab's). */
const HOLD = 0.8;
/** The crossfade to a new clip, s (the Lab's). */
const FADE = 0.18;

/** The play the settings ask of a clip that loops (`loop`) or not. */
function wantedPlay(w: World, loop: boolean): ClipPlay {
  const frame = w.settings.get<number>('box.clips.frame');
  const mask = w.settings.get<'full' | 'upper'>('box.clips.mask');
  return {
    speed: frame >= 0 ? 0 : w.settings.get<number>('box.clips.speed'),
    mirror: w.settings.get<boolean>('box.clips.mirror'),
    mask,
    walk: true,
    hold: !loop,
    fade: FADE,
  };
}

/** Whether two plays differ in what the settings set. */
const differs = (a: ClipPlay, b: ClipPlay) =>
  a.speed !== b.speed || a.mirror !== b.mirror || a.mask !== b.mask || a.hold !== b.hold;

/** The clip the figures start with, as the settings ask, faded in and at its frame: `SET/Clip` resolved at the step. */
function firstPlay(w: World): { clip: string } & ClipPlay {
  const frame = w.settings.get<number>('box.clips.frame');
  const at = frame >= 0 ? frame / BAKE_FPS : 0;
  return { clip: clipNamed(w.settings.get<string>('box.clips.clip')), ...wantedPlay(w, true), fade: 0, at, hold: undefined }; // prettier-ignore
}

/**
 * The clip `named` (`<set>/<clip>`, or a clip name only one set has), as `x anim show` reads it; a bare name more
 * than one set has throws, naming them, where the layer would take the first's.
 */
function clipNamed(named: string): string {
  if (named.includes('/')) return named;
  const owners = clipSetIds().filter((id) => Object.hasOwn(getClipSet(id).clips, named));
  if (owners.length < 2) return named;
  const sets = owners.map((id) => id.slice('clipset:'.length)).join(' and ');
  throw new Error(
    `box.clips.clip: ${named} is in ${sets}: name it as <set>/${named} (x anim find ${named} lists them)`,
  );
}

/** Each step, ahead of the actors: each figure plays the clip the settings name, as they ask (see the file comment). */
function playSettings(w: World): void {
  const named = clipNamed(w.settings.get<string>('box.clips.clip'));
  const frame = w.settings.get<number>('box.clips.frame');
  const [mode] = w.query('clipsMode') as unknown as { clipsMode: { held: number } }[];
  let ended = false;
  for (const { id } of w.query('clips') as unknown as { id: number }[]) {
    const layer = clipLayerOf(w, id);
    const [library, name] = layer.resolve(named); // ANIM_UNKNOWN_CLIP names the closest clips
    const { dur, loop = false } = library.clip(name);
    const clip = `${library.name}/${name}`;
    const play = wantedPlay(w, loop);
    const top = layer.current;
    const fresh = !top || top.stopping > 0 || top.clip !== clip;
    if (fresh) playClip(w, id, clip, top ? play : { ...play, fade: 0 });
    else if (differs(top.play, play)) playClip(w, id, clip, play); // the same clip takes the new play, at its time
    if (frame >= 0) {
      if (fresh || top.t !== Math.min(frame / BAKE_FPS, dur)) seekClip(w, id, frame / BAKE_FPS);
    } else if (!fresh && !loop && top.t >= dur) ended = true;
  }
  // a one-shot holds its end, then every figure plays it again
  mode.clipsMode.held = ended ? mode.clipsMode.held + 1 : 0;
  if (mode.clipsMode.held * w.dt < HOLD) return;
  mode.clipsMode.held = 0;
  for (const { id } of w.query('clips') as unknown as { id: number }[]) seekClip(w, id, 0);
}

/** Clip mode: the hero and the mannequin playing the library's clips in the room. */
export const clips = defineScene('box:clips', {
  description:
    'Clip mode: the hero and the mannequin play any clip of the animation library through the clip layer, in the room.',
  level: 'level:room',
  sounds: boxSounds(ROOM_HERO_LEVEL),
  physics: true,
  setup(w) {
    addLevelBodies(physicsOf(w), ROOM_HERO_LEVEL);
    defineSetBuild('build:mannequin', 'clipset:quaternius'); // CORE_NO_ENTRY until the sets are registered
    const clips = { sets: clipSetIds(), ik: w.settings.get<boolean>('box.clips.ik'), play: firstPlay(w) };
    const cast = w.settings.get<string>('box.clips.cast');
    const [x, y, z] = CLIPS_START;
    if (cast !== 'mannequin') {
      spawnActor(w, { at: [x, y, z], character: heroCharacter(), player: true, anim: { ...HERO_BODY }, clips });
    }
    if (cast !== 'hero') {
      const anim = { build: 'build:mannequin' };
      const at = [x + BESIDE, y, z] as const;
      spawnActor(w, { at, character: createCharacter(), player: false, anim, body: 'body:mannequin', clips });
    }
    w.spawn({ clipsMode: { held: 0 } });
  },
  step: playSettings,
});

export default clips;
