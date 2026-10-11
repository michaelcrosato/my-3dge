/**
 * @file Unit tests for engine/ui/overlay.ts (T1, PLAN.md WP 6.5's Done-when: "`ui.state()` snapshot tests pass", "the
 * overlay never changes the hash"), over a stand-in DOM (tests/unit/ui/fakeDom.ts): the overlay's state snapshotted
 * after a frame; its root follows the canvas; labels follow their anchors and hide when culled or turned off; damage
 * numbers carry their values, age through the CSS animation's clock, rise, expire and recycle the oldest past the
 * pool; HUD lines move, change and go; bad places and times are coded errors; and the box room steps to the same
 * hashes with an overlay following it every step as without. Layout (boxes, CSS) is tests/e2e/overlay.spec.ts's.
 * @see engine/ui/overlay.ts
 */
import { readFileSync } from 'node:fs';
import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import '../../labs/box/scenes/room';
import { asDom, fakePage, type FakeElement } from '../../tests/unit/ui/fakeDom';
import { createRunView } from '../app/view';
import { registry } from '../core/registry';
import { createMaterialLibrary } from '../gfx/materials/library';
import { createSession } from '../sim/scene';
import { defineLevel } from '../world/level/level';
import { DAMAGE_NUMBERS } from './labels';
import { createOverlay } from './overlay';

/** A 640 × 360 canvas at (10, 20) in a fresh fake page, and an overlay over it. */
function setup() {
  const page = fakePage({ left: 10, top: 20, width: 640, height: 360 });
  page.document.body.append(page.canvas);
  const { canvas } = asDom(page);
  return { page, ui: createOverlay({ canvas }) };
}

/** A camera 10 m back and 5 m up, looking at the origin, as a frame drew it. */
function camera(): PerspectiveCamera {
  const cam = new PerspectiveCamera(50, 640 / 360, 0.1, 100);
  cam.position.set(0, 5, 10);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return cam;
}

/** The live damage numbers' values. */
const values = (ui: ReturnType<typeof setup>['ui']) =>
  ui
    .state()
    .elements.filter((e) => e.kind === 'damage')
    .map((e) => e.value);

describe('createOverlay', () => {
  it('gives its elements as text, places and visibility after a frame (snapshot)', () => {
    const { ui } = setup();
    ui.label('Hero', { at: [0, 1, 0], id: 'hero' });
    ui.label('Behind', { at: [0, 5, 20] });
    ui.damage(12, { at: [0, 1.8, 0] });
    ui.damage('7', { at: [0.4, 1.8, 0], color: '#ff7a6a' });
    ui.hud('score', 'Score 120');
    ui.hud('hint', 'Space: jump', { at: 'bottom', keys: true });
    ui.crosshair(true);
    ui.update(camera(), 0.1);
    expect(ui.state()).toMatchInlineSnapshot(`
      {
        "elements": [
          {
            "at": [
              320,
              147.83,
            ],
            "box": null,
            "id": "hero",
            "kind": "label",
            "text": "Hero",
            "visible": true,
          },
          {
            "box": null,
            "id": "label:1",
            "kind": "label",
            "text": "Behind",
            "visible": false,
          },
          {
            "at": [
              320,
              111.95,
            ],
            "box": null,
            "kind": "damage",
            "text": "12",
            "value": "12",
            "visible": true,
          },
          {
            "at": [
              320,
              111.95,
            ],
            "box": null,
            "kind": "damage",
            "text": "7",
            "value": "7",
            "visible": true,
          },
          {
            "box": null,
            "id": "score",
            "kind": "hud",
            "text": "Score 120",
            "visible": true,
          },
          {
            "box": null,
            "id": "hint",
            "kind": "hud",
            "text": "Space: jump",
            "visible": true,
          },
          {
            "at": [
              320,
              180,
            ],
            "box": null,
            "kind": "crosshair",
            "text": "",
            "visible": true,
          },
        ],
        "size": [
          640,
          360,
        ],
        "touch": false,
      }
    `);
  });

  it('sits right after the canvas, sized to it, and follows it; one stylesheet for every overlay', () => {
    const { page, ui } = setup();
    const root = ui.root as unknown as FakeElement;
    expect(page.document.body.children.map((el) => el.className)).toEqual(['', 'ui-overlay']);
    ui.update(camera(), 0);
    expect([root.style.left, root.style.top, root.style.width, root.style.height]).toEqual([
      '10px',
      '20px',
      '640px',
      '360px',
    ]);
    page.canvas.rect = { left: 0, top: 0, width: 800, height: 450 };
    ui.update(camera(), 0);
    expect(ui.state().size).toEqual([800, 450]);
    const second = createOverlay(asDom(page));
    const sheets = () => page.document.head.children.filter((el) => el.id === 'ui-overlay-style').length;
    expect([sheets(), page.document.querySelectorAll('.ui-overlay').length]).toEqual([1, 2]);
    ui.dispose();
    expect([sheets(), page.document.querySelectorAll('.ui-overlay').length]).toEqual([1, 1]);
    second.dispose();
    expect([sheets(), page.document.querySelectorAll('.ui-overlay').length]).toEqual([0, 0]);
  });

  it('places labels where their anchors are each frame, and hides them when culled or turned off', () => {
    const { ui } = setup();
    const at = new Vector3(0, 0, 0);
    const hero = ui.label('Hero', { at, id: 'hero' });
    const follower = ui.label('Follower', { at: () => [at.x, at.y + 2, at.z], id: 'follower' });
    const placed = () => ui.state().elements.map((e) => [e.id, e.at, e.visible]);
    expect(placed()).toEqual([
      ['hero', undefined, false], // nothing shows before the first frame
      ['follower', undefined, false],
    ]);
    const cam = camera();
    ui.update(cam, 1 / 60);
    const [, first] = placed();
    at.set(2, 0, 0);
    ui.update(cam, 1 / 60);
    const moved = ui.state().elements[0].at!;
    expect(moved[0]).toBeGreaterThan(320); // right of the centre
    expect(placed()[1][1]).not.toEqual(first[1]);
    hero.visible = false;
    at.set(0, 0, 30); // behind the camera
    ui.update(cam, 1 / 60);
    expect(placed().map(([id, , visible]) => [id, visible])).toEqual([
      ['hero', false],
      ['follower', false],
    ]);
    hero.text = 'Gone';
    hero.remove();
    follower.at = [0, 0, 0];
    ui.update(cam, 1 / 60);
    expect(placed()).toEqual([['follower', [320, 180], true]]);
  });

  it('refuses an anchor that is not a point, when given or when a function returns one', () => {
    const { ui } = setup();
    expect(() => ui.label('x', { at: [1, 2] as never })).toThrow(/UI_BAD_POINT.*label "label:1"'s at is \[1,2\]/);
    ui.label('y', { at: () => ({ x: 1 }) as never, id: 'y' });
    expect(() => ui.update(camera(), 0)).toThrow(/UI_BAD_POINT.*label "y"'s at is \{"x":1\}/);
  });

  it('shows damage numbers with their values, aging, rising and gone after their life', () => {
    const { ui } = setup();
    const cam = camera();
    ui.damage(12, { at: [0, 1, 0] });
    ui.damage(30, { at: [5, 1, 0] });
    expect(values(ui)).toEqual(['12', '30']);
    const number = ui.root.querySelector<HTMLElement>('[data-ui=damage][data-value="12"]')!;
    ui.update(cam, 0.1);
    const y0 = ui.state().elements[0].at![1];
    expect(number.style.getPropertyValue('--ui-age')).toBe('0.1');
    ui.update(cam, 0.4);
    expect(number.style.getPropertyValue('--ui-age')).toBe('0.5');
    expect(ui.state().elements[0].at![1]).toBeLessThan(y0); // risen
    ui.update(cam, DAMAGE_NUMBERS.life - 0.5 + 1e-9);
    expect(values(ui)).toEqual([]);
    expect(ui.root.querySelectorAll('.ui-damage')).toHaveLength(2); // pooled, unmarked
  });

  it('keeps at most the pool, giving a new number the oldest one', () => {
    const { ui } = setup();
    const cam = camera();
    for (let i = 0; i < DAMAGE_NUMBERS.pool + 12; i++) {
      ui.damage(i, { at: [i % 7, 1, 0], stack: false });
      ui.update(cam, 0.01);
    }
    expect(ui.root.querySelectorAll('.ui-damage')).toHaveLength(DAMAGE_NUMBERS.pool);
    const live = values(ui).map(Number);
    expect(live.sort((a, b) => a - b)).toEqual(Array.from({ length: DAMAGE_NUMBERS.pool }, (_, i) => i + 12));
  });

  it('stacks quick hits near one spot in slots over the first one, as the prototype did', () => {
    const { ui } = setup();
    for (const value of [1, 2, 3]) ui.damage(value, { at: [value * 0.3, 1, 0] });
    ui.damage(4, { at: [5, 1, 0] });
    ui.update(camera(), 0);
    const numbers = ui.root.querySelectorAll<HTMLElement>('[data-ui=damage]');
    expect([...numbers].map((el) => el.style.getPropertyValue('--ui-slot'))).toEqual(['0', '1', '2', '0']);
    const at = ui.state().elements.map((e) => e.at);
    expect([at[1], at[2]]).toEqual([at[0], at[0]]); // risen from the first one's anchor
    expect(at[3]).not.toEqual(at[0]);
  });

  it('sets, moves, marks and removes HUD lines, and refuses an unknown place', () => {
    const { ui } = setup();
    ui.hud('score', 'Score 1', { at: 'top-right' });
    ui.hud('hint', 'Space: jump', { keys: true });
    ui.hud('score', 'Score 2', { at: 'bottom-left', color: '#ffb347' });
    const blocks = () =>
      (ui.root.querySelectorAll('.ui-hud-block') as unknown as FakeElement[]).map((b) => [
        b.dataset.at,
        b.children.map((line) => [line.textContent, line.hasAttribute('data-keyboard'), line.style.color]),
      ]);
    expect(blocks()).toEqual([
      ['top-left', [['Space: jump', true, '']]],
      ['top-right', []],
      ['bottom-left', [['Score 2', false, '#ffb347']]],
    ]);
    ui.hud('hint', null);
    ui.hud('score', '');
    expect(ui.state().elements).toEqual([]);
    expect(() => ui.hud('x', 'y', { at: 'middle' as never })).toThrow(
      '[UI_BAD_PLACE] hud "x" asks for the place "middle": use one of top-left, top, top-right, bottom-left, bottom, bottom-right',
    );
  });

  it('refuses a frame time that is not 0 or more seconds', () => {
    const { ui } = setup();
    for (const dt of [-1, NaN, Infinity]) expect(() => ui.update(camera(), dt)).toThrow(/UI_BAD_DT/);
  });
});

describe('the overlay and the sim', () => {
  const ROOM = 'labs/box/levels/room.txt';
  if (!registry.has('level', 'level:room')) defineLevel('level:room', { text: readFileSync(ROOM, 'utf8'), file: ROOM });

  /** The box room's hash after every step of 240, with an overlay following it each step or without one. */
  function run(withOverlay: boolean): { hashes: string[]; shown: string[] } {
    const session = createSession('box:room');
    const view = createRunView({ run: () => session, registry, materials: createMaterialLibrary() });
    const { ui } = setup();
    const hashes: string[] = [];
    for (let step = 0; step < 240; step++) {
      session.step({});
      view.stepped();
      const frame = view.frame({ alpha: 1, dt: 1 / 60, aspect: 640 / 360 });
      if (withOverlay) {
        for (const [id, mesh] of view.stage.standIns) {
          if (step === 0) ui.label(`mover ${id}`, { at: mesh.position, id: String(id) });
          if (step % 20 === id) ui.damage(step, { at: [mesh.position.x, 1.5, mesh.position.z] });
        }
        ui.hud('tick', `tick ${session.world.tick}`);
        ui.update(frame.camera, 1 / 60);
      }
      hashes.push(session.world.hash());
    }
    view.dispose();
    const shown = ui
      .state()
      .elements.filter((e) => e.visible)
      .map((e) => e.kind);
    return { hashes, shown };
  }

  it('never changes the hash: the room steps alike with an overlay following it every step', () => {
    const [on, off] = [run(true), run(false)];
    expect(on.shown).toEqual(expect.arrayContaining(['label', 'damage', 'hud']));
    expect(off.shown).toEqual([]);
    expect(on.hashes).toEqual(off.hashes);
  });
});
