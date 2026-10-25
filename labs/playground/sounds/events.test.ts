/**
 * @file Unit tests for the playground's sound events (labs/playground/sounds/events.ts) and effects (effects.ts): each
 * event plays what the file comment says, where it says (steps by the surface and the gait, a slide's none; blows by
 * the move's limb or the struck prop's make; a shot by its weapon's `sound` and an impact by what it struck, none at a
 * thing; a door by how it opens); props sound as their biggest part's make; the reader reads each event once and a
 * new world from its first; the coverage the WP asks for: every event every playground replay emits sounds (but a
 * slide's steps and a hit that downs its thing, whose fall sounds), every kind of the cast's own events, its movements
 * and its seat's beats has a sound, and every effect named is defined; and the house replay's timeline, read in Node
 * after every step, is the recorded run's and gives its golden (`SITE_TIMELINE`), the one Chromium must give too
 * (tests/e2e/playground-audio.spec.ts).
 * @see labs/playground/sounds/events.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getSfx, type TraceRecord } from '../../../engine';
import { createPlayback } from '../../../engine/app/playback';
import { createSession } from '../../../engine/sim/session';
import { getAction } from '../../../engine/sim-api';
import { SITE_TIMELINE, soundTimeline } from '../../../tests/pages/playgroundAudioTimeline';
import '../bodies/player';
import { DOG_MODES } from '../cast/dog';
import { GYM } from '../scenes/gym';
import { HILL } from '../scenes/hill';
import '../scenes/site';
import './effects';
import { createSoundReader, levelGround, propMake, soundsOf, SOUND_EVENTS, terrainGround, timelineHash, type PlaygroundGround, type SoundWorld } from './events'; // prettier-ignore
import { SITE_GROUND } from './ground';

const ROOT = join(import.meta.dirname, '..', '..', '..');

/** A traced event. */
const record = (seq: number, type: string, payload: unknown): TraceRecord => ({ seq, type, payload, listeners: 0, failed: 0 }); // prettier-ignore

/** The entities the unit world holds (see `world`). */
const ENTITIES: Record<number, unknown> = {
  1: { actor: { x: 2, y: 0, z: 3 }, motion: { gait: 'sprint' } }, // the player, sprinting, on wood
  2: { actor: { x: 12, y: 0, z: 3 } }, // a neighbour on the grass (no movement model)
  3: { sceneProp: { prop: 'prop:door', x: 5, y: 1, z: 5 }, door: { hinge: [5, 0, 5], slide: [0, 0, 0], tilt: false } },
  4: { sceneProp: { prop: 'prop:pane', x: 6, y: 1.5, z: 5 }, door: { hinge: [6, 0.5, 5], slide: [0.75, 0, 0], tilt: false } }, // prettier-ignore
  5: { sceneProp: { prop: 'prop:playground-target', x: 20, y: 1, z: 4 }, thing: {} },
  6: { sceneProp: { prop: 'prop:playground-dummy', x: 21, y: 0.75, z: 4 }, thing: {} },
  7: { actor: { x: 1, y: 0, z: 1 }, motion: { gait: 'slide' } }, // sliding
  8: { sceneProp: { prop: 'prop:crate', x: 3, y: 0.375, z: 8 } },
};

/** Wood west of x = 10, grass east of it; no rooms. */
const GROUND: PlaygroundGround = { surface: (x) => (x < 10 ? 'wood' : 'grass'), room: () => null };

/** A world at step 7 holding `ENTITIES`, whose trace is `records`. */
const world = (records: TraceRecord[]): SoundWorld => ({ tick: 7, events: { trace: () => records }, get: (id) => ENTITIES[id] }); // prettier-ignore

/** What event `type` with `payload` plays in the unit world: [effect, gain, pitch, position] each. */
const play = (type: string, payload: unknown) =>
  soundsOf(record(1, type, payload), world([]), GROUND).map(({ sfx, vol, pitch, position }) => [sfx, vol, pitch, position]); // prettier-ignore

/** The effects events of `type` play, one `key` value each, from entity 2. */
const voices = (type: string, key: string, values: readonly string[]) => values.map((value) => play(type, { id: 2, [key]: value })[0]?.[0]); // prettier-ignore

describe('the playground’s sound events', () => {
  it('play the body’s steps by the surface and the gait, its landings and the movements it begins', () => {
    expect(play('footstep', { id: 1, side: 'L', speed: 6.6 })).toEqual([['sfx:stepWood', 1, 1.03, [2, 0, 3]]]);
    expect(play('footstep', { id: 2, side: 'R', speed: 1.2 })).toEqual([['sfx:stepGrass', 0.55, 1, [12, 0, 3]]]);
    expect(play('footstep', { id: 7, side: 'L', speed: 6, gait: 'slide' })).toEqual([]); // a slide's feet make none
    expect(play('footstep', { id: 2, side: 'L', speed: 1.2, gait: 'crouch', at: [8, 0, 3] })).toEqual([
      ['sfx:stepWood', 0.3, 0.96, [8, 0, 3]],
    ]); // where and how it stepped, not where it is now // prettier-ignore
    expect(play('jump', { id: 2 })).toEqual([['sfx:stepGrass', 0.8, 1.01, [12, 0, 3]]]);
    expect(play('land', { id: 1, speed: 4.5 })).toEqual([['sfx:landBody', 0.5, 1, [2, 0, 3]], ['sfx:stepWood', 0.8, 1.01, [2, 0, 3]]]); // prettier-ignore
    expect(voices('move', 'what', ['mantle', 'climb', 'ladder', 'zipline', 'skydive', 'slide', 'crouch', 'stand'])).toEqual(['sfx:mantle', 'sfx:climbGrip', 'sfx:ladderRung', 'sfx:zipAttach', 'sfx:swish', 'sfx:slide', 'sfx:crouchCloth', 'sfx:crouchCloth']); // prettier-ignore
    expect(play('move', { id: 1, what: 'fly' })).toEqual([]);
    expect(play('dash', { id: 1 })).toEqual([['sfx:swish', 0.8, 1, [2, 1, 3]]]);
    expect(play('launch', { id: 1 })).toEqual([['sfx:launch', 1, 1, [2, 0, 3]]]);
  });

  it('play the hands’ grabs and swishes, and a blow by its limb on a body or a thing, else by the prop’s make', () => {
    expect(play('pickup', { id: 1, target: 8 })).toEqual([['sfx:grab', 0.6, 1, [2, 1, 3]]]);
    expect(play('use', { id: 1, target: 3 })).toEqual([['sfx:grab', 0.35, 1, [5, 1, 5]]]);
    expect(play('throw', { id: 1, target: 8 })).toEqual([['sfx:swish', 0.7, 1, [2, 1.2, 3]]]);
    expect(play('melee', { id: 1, move: 'move:kick', target: 2 })).toEqual([['sfx:swish', 0.9, 1, [2, 1, 3]]]);
    expect(play('melee', { id: 1, move: 'move:cross', target: -1 })).toEqual([['sfx:swish', 0.6, 1, [2, 1, 3]]]);
    expect(play('strike', { id: 1, target: 2, move: 'move:kick' })).toEqual([['sfx:kickHit', 1, 1, [12, 1, 3]]]);
    expect(play('strike', { id: 1, target: 6, move: 'move:cross' })).toEqual([['sfx:punchHit', 0.8, 1, [21, 0.75, 4]]]); // prettier-ignore
    expect(play('strike', { id: 1, target: 3, move: 'move:breach' })).toEqual([['sfx:impactWood', 1, 1, [5, 1, 5]]]);
  });

  it('play a shot by its weapon, and an impact by what it struck: a body, a prop, the ground, a wall; none at a thing', () => {
    // prettier-ignore
    const shot = { id: 1, weapon: 'weapon:playground-rifle', from: [2, 1.5, 3], body: 9, hit: true };
    const rifle = ['sfx:rifleShot', 0.8, 1, [2, 1.5, 3]];
    expect(play('gunshot', { ...shot, to: [12, 1, 3], normal: [-1, 0, 0], target: 2 })).toEqual([rifle, ['sfx:impactBody', 0.6, 1, [12, 1, 3]]]); // prettier-ignore
    expect(play('gunshot', { ...shot, to: [20, 1, 4], normal: [-1, 0, 0], target: 5 })).toEqual([rifle]); // its thingHit
    expect(play('gunshot', { ...shot, to: [3, 0.375, 7.625], normal: [0, 0, -1], target: 8 })[1]?.[0]).toBe('sfx:impactWood'); // prettier-ignore
    expect(play('gunshot', { ...shot, to: [15, 0, 3], normal: [0, 1, 0], target: -1 })[1]).toEqual(['sfx:impactDirt', 0.6, 1, [15, 0, 3]]); // prettier-ignore
    expect(play('gunshot', { ...shot, to: [8, 0, 3], normal: [0, 1, 0], target: -1 })[1]?.[0]).toBe('sfx:impactWood'); // a floor
    expect(play('gunshot', { ...shot, to: [8, 1, 3], normal: [1, 0, 0], target: -1 })[1]?.[0]).toBe(
      'sfx:impactConcrete',
    ); // a wall
    expect(play('gunshot', { ...shot, weapon: 'weapon:playground-pistol', to: [80, 1.5, 3], normal: null, target: -1 })).toEqual([['sfx:pistolShot', 0.8, 1, [2, 1.5, 3]]]); // prettier-ignore
    expect(['reload', 'dry', 'draw', 'holster'].map((type) => play(type, { id: 1, weapon: 'weapon:playground-rifle' })[0])).toEqual([['sfx:reload', 0.7, 1, [2, 1.2, 3]], ['sfx:dryFire', 0.6, 1, [2, 1.2, 3]], ['sfx:drawGun', 0.6, 1, [2, 1, 3]], ['sfx:holsterGun', 0.6, 1, [2, 1, 3]]]); // prettier-ignore
  });

  it('play the house’s doors by how they open, its switches and its breakages, and the things by their make', () => {
    expect(play('door', { id: 3, open: true, locked: false })).toEqual([['sfx:doorOpen', 0.8, 1, [5, 1, 5]]]);
    expect([play('door', { id: 3, open: false, locked: false })[0][0], play('door', { id: 3, open: false, locked: true })[0][0]]).toEqual(['sfx:doorClose', 'sfx:doorLocked']); // prettier-ignore
    expect(play('door', { id: 4, open: true, locked: false })).toEqual([['sfx:windowSlide', 0.8, 1, [6, 1.5, 5]]]);
    expect(play('switch', { id: 3, on: true, group: 'room:hall', door: -1 })).toEqual([['sfx:switchClick', 0.7, 1, [5, 1, 5]]]); // prettier-ignore
    expect(play('splinters', { id: 3, prop: 'prop:door', position: [5, 1, 5], ground: 0 })).toEqual([['sfx:doorBreak', 1, 1, [5, 1, 5]]]); // prettier-ignore
    expect(play('glass', { id: 4, prop: 'prop:pane', position: [6, 1.5, 5], ground: 0.5 })[0][0]).toBe(
      'sfx:glassBreak',
    );
    expect(play('shatter', { id: 8, prop: 'prop:crate', position: [3, 0.375, 8], ground: 0 })[0][0]).toBe('sfx:impactWood'); // prettier-ignore
    const popper = { id: 5, thing: 'thing:playground-popper' };
    expect(play('thingHit', { ...popper, outcome: 'hit', hp: 1 })).toEqual([['sfx:impactMetal', 0.8, 1, [20, 1, 4]]]);
    expect(play('thingHit', { ...popper, outcome: 'down', hp: 0 })).toEqual([]); // its thingDown sounds it
    expect(play('thingDown', { ...popper, outcome: 'down' })).toEqual([['sfx:impactMetal', 0.8, 0.8, [20, 1, 4]]]);
    expect(play('thingDown', { id: 6, thing: 'thing:playground-dummy', outcome: 'down' })).toEqual([['sfx:bodyFall', 0.9, 1, [21, 0.75, 4]]]); // prettier-ignore
    expect(play('thingUp', popper)).toEqual([['sfx:impactMetal', 0.35, 1, [20, 1, 4]]]);
  });

  it('play people’s voices and bodies, the dog’s and the seat’s beats; any other event plays nothing', () => {
    expect(play('damage', { target: 2, source: 1, amount: 18, hp: 82, killed: false, at: [12, 1.5, 3], dir: [1, 0, 0], stop: 0 })).toEqual([['sfx:playgroundGrunt', 0.8, 1, [12, 1.5, 3]]]); // prettier-ignore
    expect(play('ragdoll', { id: 2, dead: false })).toEqual([['sfx:bodyFall', 1, 1, [12, 0, 3]]]);
    expect(play('getUp', { id: 2, lying: 'back' })).toEqual([['sfx:playgroundGrunt', 0.5, 1, [12, 1, 3]]]);
    expect(voices('neighbour', 'what', ['look', 'aside', 'shoved', 'startle', 'flinch', 'fall', 'sit', 'rise'])).toEqual(['sfx:playgroundHm', 'sfx:playgroundHm', 'sfx:playgroundHey', 'sfx:playgroundGasp', 'sfx:crouchCloth', 'sfx:swish', 'sfx:playgroundSigh', 'sfx:playgroundGrunt']); // prettier-ignore
    expect(play('neighbour', { id: 2, what: 'look' })[0][3]).toEqual([12, 1.6, 3]); // its head
    expect(voices('dog', 'what', ['follow', 'sit', 'chase', 'fetch', 'drop', 'wait'])).toEqual(['sfx:playgroundTags', 'sfx:playgroundHuff', 'sfx:playgroundBark', 'sfx:playgroundHuff', 'sfx:playgroundBounce', 'sfx:playgroundWhine']); // prettier-ignore
    expect(voices('action', 'type', ['lower', 'seated', 'rise', 'end'])).toEqual(['sfx:crouchCloth', 'sfx:playgroundCreak', 'sfx:playgroundCreak', 'sfx:crouchCloth']); // prettier-ignore
    expect([play('lap', { laps: 1 }), play('neighbour', { id: 2, what: 'dance' }), play('footstep', null)]).toEqual([[], [], []]); // prettier-ignore
    expect(SOUND_EVENTS).toContain('gunshot');
  });

  it('hear a prop as its biggest part’s make: the dummy’s pad, the target’s plate, a door’s planks, a pane', () => {
    const props = ['prop:playground-dummy', 'prop:playground-target', 'prop:door', 'prop:pane', 'prop:playground-rock', 'prop:playground-sofa', 'prop:crate']; // prettier-ignore
    expect(props.map(propMake)).toEqual(['soft', 'metal', 'wood', 'glass', 'concrete', 'soft', 'wood']);
  });
});

describe('the sound reader', () => {
  it('reads each event once, a new world from its first, and counts the events that left the trace unread', () => {
    const reader = createSoundReader(GROUND);
    const records = [record(1, 'footstep', { id: 1, side: 'L', speed: 6.6 }), record(2, 'lap', { laps: 1 })];
    const w = world(records);
    expect(reader.read(w).map((s) => [s.step, s.type, s.sfx])).toEqual([[7, 'footstep', 'sfx:stepWood']]);
    expect(reader.read(w)).toEqual([]);
    records.push(record(3, 'jump', { id: 2 }));
    expect(reader.read(w).map((s) => s.type)).toEqual(['jump']);
    expect(reader.read(world(records)).map((s) => s.type)).toEqual(['footstep', 'jump']); // a new world: from its first
    const lost = [record(1, 'launch', { id: 1 })];
    const kept = world(lost);
    const counting = createSoundReader(GROUND);
    counting.read(kept);
    lost.splice(0, 1, record(5, 'launch', { id: 1 })); // 2 to 4 left the trace before a read
    expect([counting.read(kept).length, counting.missed, reader.missed]).toEqual([1, 3, 0]);
    expect(timelineHash([])).toBe('09612b07b5ecb5a5');
  });
});

/** Each scene's ground but the site's (the site's scenes, `playground:site-*`, stand on `SITE_GROUND`). */
const GROUNDS: Record<string, PlaygroundGround> = { 'playground:gym': levelGround(GYM), 'playground:hill': terrainGround(HILL) }; // prettier-ignore

describe('the coverage (WP 13.22’s Done-when)', () => {
  it('every event every playground replay emits sounds, but a slide’s steps and a hit that downs its thing', () => {
    const [types, unheard, effects] = [new Set<string>(), [] as string[], new Set<string>()];
    // the tour is the other replays played in turn (labs/playground/tour.ts): their events are its events
    const replays = readdirSync(join(ROOT, 'tests/replays')).filter((name) => name.startsWith('playground-') && name !== 'playground-tour.replay.json'); // prettier-ignore
    for (const file of replays) {
      const playback = createPlayback(JSON.parse(readFileSync(join(ROOT, 'tests/replays', file), 'utf8')));
      const { scene, seed, settings } = playback.replay;
      const session = createSession(scene, { seed, settings });
      const ground = GROUNDS[scene] ?? SITE_GROUND;
      let seen = 0;
      const read = () => {
        const w = session.world;
        for (const r of w.events.trace().filter((item) => item.seq > seen)) {
          const sounds = soundsOf(r, w, ground);
          const p = r.payload as { gait?: string; outcome?: string };
          const quiet = (r.type === 'footstep' && p.gait === 'slide') || (r.type === 'thingHit' && p.outcome === 'down'); // prettier-ignore
          types.add(r.type);
          if (!sounds.length && !quiet) unheard.push(`${file} step ${w.tick}: ${r.type} ${JSON.stringify(r.payload)}`);
          for (const s of sounds) effects.add(s.sfx);
        }
        seen = w.events.trace().at(-1)?.seq ?? seen;
      };
      read();
      while (!playback.done) {
        playback.step(session);
        read();
      }
    }
    expect(unheard).toEqual([]);
    expect([...types].filter((type) => !SOUND_EVENTS.includes(type))).toEqual([]);
    expect(types.size).toBeGreaterThan(20);
    for (const sfx of effects) expect(getSfx(sfx).id, sfx).toBe(sfx); // each one defined
  }, 120_000);

  it('every kind of the cast’s own events, of the movements it begins and of its seat’s beats has a sound', () => {
    const source = readFileSync(join(ROOT, 'labs/playground/cast/neighbours.ts'), 'utf8');
    const whats = [...source.matchAll(/what: ([^}]+)\}/g)].flatMap((m) =>
      [...m[1].matchAll(/'(\w+)'/g)].map((w) => w[1]),
    );
    expect(new Set(whats)).toEqual(new Set(['fall', 'flinch', 'startle', 'shoved', 'look', 'rise', 'sit', 'aside']));
    expect(voices('neighbour', 'what', whats)).not.toContain(undefined);
    const dog = [...DOG_MODES.filter((mode) => mode !== 'carry'), 'fetch', 'drop']; // carrying begins as `fetch`, ends as `drop`
    expect(voices('dog', 'what', dog)).not.toContain(undefined);
    const moves = ['mantle', 'climb', 'ladder', 'zipline', 'skydive', 'slide', 'crouch', 'stand']; // physics/character.ts `MoveEntered`
    expect(voices('move', 'what', moves)).not.toContain(undefined);
    const beats = [...getAction('action:sit').beats.map((beat) => beat.name), 'end'];
    expect(voices('action', 'type', beats)).not.toContain(undefined);
  });

  it('the house replay’s timeline, read after every step, is the recorded run’s and gives its golden', () => {
    const text = readFileSync(join(ROOT, SITE_TIMELINE.replay), 'utf8');
    const { events, hash, worldHash, missed } = soundTimeline(text, SITE_GROUND);
    const golden = (JSON.parse(text) as { steps: number; hashes: Record<string, Record<string, string>> }).hashes['linux-x64']; // prettier-ignore
    expect(worldHash).toBe(golden['780']);
    expect(missed).toBe(0);
    expect(events.every((e) => e.position !== null && e.vol > 0)).toBe(true);
    expect([events.length, hash]).toEqual([SITE_TIMELINE.sounds, SITE_TIMELINE.hash]);
  }, 60_000);
});
