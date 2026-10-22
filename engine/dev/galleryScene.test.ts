/**
 * @file Unit tests for the gallery's scene (engine/dev/galleryScene.ts; WP 7.7), in Node: it stages what its settings
 * name, in the middle (a prop on the floor, one with no body hung 1.2 m up, a material on a cube, the look's set); a
 * body's figure holds its state, and walks for `walk`; a move's figure swings it once from rest as a fight plays it
 * (its phase and share each step, the blade's trail while it strikes); `show` stages another between steps, the last
 * one's entities gone; a state's name is read as the humanoid takes it.
 * @see engine/dev/galleryScene.ts
 */
import { describe, expect, it } from 'vitest';
import { createSession } from '../sim/session';
import { figureState, GALLERY_SCENE, galleryScene } from './galleryScene';

galleryScene();

/** The gallery scene staging `subject` of `kind` in `state`, after `steps` steps. */
function staged(kind: string, subject: string, state = '', steps = 1) {
  const settings = { 'gallery.kind': kind, 'gallery.subject': subject, 'gallery.state': state };
  const session = createSession(GALLERY_SCENE, { seed: 1, settings });
  for (let k = 0; k < steps; k++) session.step({});
  return session;
}

type Row = Record<string, Record<string, unknown>> & { id: number };
const rows = (session: ReturnType<typeof staged>, ...names: string[]) => session.world.query(...names) as unknown as Row[]; // prettier-ignore

describe('the gallery scene', () => {
  it('stands a prop in the middle, on the floor, and one with no body 1.2 m up as on a wall', () => {
    const [crate] = rows(staged('prop', 'prop:crate', '', 30), 'sceneProp');
    expect([crate.sceneProp.prop, crate.sceneProp.x, crate.sceneProp.z, crate.sceneProp.y]).toEqual(['prop:crate', expect.closeTo(8, 3), expect.closeTo(8, 3), expect.closeTo(0.375, 2)]); // prettier-ignore
    const [lamp] = rows(staged('prop', 'prop:switch'), 'sceneProp');
    expect([lamp.sceneProp.body, lamp.sceneProp.y]).toEqual([-1, 1.2]);
  });

  it('shows a material on a 1 m cube, and the look’s set: a crate, a barrel, three cubes and a figure', () => {
    expect(rows(staged('material', 'material:brick'), 'gallerySwatch').map((e) => e.gallerySwatch)).toEqual([
      { x: 8, y: 0, z: 8, yaw: 0, size: 1, material: 'material:brick' },
    ]);
    const set = staged('look', 'look:cartoon');
    expect(rows(set, 'sceneProp').map((e) => e.sceneProp.prop)).toEqual(['prop:crate', 'prop:barrel']);
    expect(rows(set, 'gallerySwatch').map((e) => e.gallerySwatch.material)).toEqual(['material:stone', 'material:wood', 'material:brick']); // prettier-ignore
    expect(rows(set, 'actor').length).toBe(1);
  });

  it('holds a body’s state on its figure, walks it for walk, and swings a move once from rest', () => {
    const [kneel] = rows(staged('body', 'body:humanoid', 'kneel', 2), 'actor', 'animator', 'puppet');
    expect([kneel.puppet.body, kneel.animator.states, kneel.animator.weapon]).toEqual(['body:humanoid', { pose: 'kneel' }, 'sword']); // prettier-ignore
    const [walker] = rows(staged('body', 'body:humanoid', 'walk', 36), 'actor');
    expect(walker.actor.z as number).toBeGreaterThan(8.5); // forward, +Z, at walking pace
    const swing = (steps: number) => rows(staged('move', 'move:slash', '', steps), 'actor', 'animator')[0].animator.states; // prettier-ignore
    expect(swing(3)).toEqual({ body: { move: 'move:slash', phase: 'wind', u: expect.closeTo(0.625, 6) } }); // 0.05 s of 0.08
    expect(swing(9)).toEqual({ body: { move: 'move:slash', phase: 'active', u: expect.closeTo(0.7, 6) }, trail: 'blade' }); // prettier-ignore
    expect(swing(24)).toEqual({}); // its 0.4 s played: at rest again
  });

  it('stages another entry between steps with show, the last one’s entities gone', () => {
    const session = staged('prop', 'prop:crate');
    session.act('show', { kind: 'body', id: 'body:humanoid', state: 'idle' });
    session.step({});
    expect([rows(session, 'sceneProp').length, rows(session, 'actor').length]).toEqual([0, 1]);
    session.act('show', { kind: 'emitter', id: 'emitter:sparks' }); // the view bursts it: the stage is left empty
    session.step({});
    expect(session.world.count).toBe(0);
  });

  it('reads a state’s name as the humanoid takes it', () => {
    expect(figureState('run')).toEqual({ states: {}, move: [0, 1] });
    expect(figureState('dodge')).toEqual({ states: {}, move: null }); // the controller sets the dash and its speed
    expect(figureState('hurt')).toEqual({ states: { hurt: true }, move: null });
    expect(figureState('wave')).toEqual({ states: { pose: 'wave' }, move: null });
    expect(figureState('ready')).toEqual({ states: { stance: 'ready' }, move: null });
    expect(figureState('flail')).toBeNull();
  });
});
