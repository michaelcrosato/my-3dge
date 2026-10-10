/**
 * @file Unit tests for the virtual device, its play scripts and `__engine.input` (T1, WP 3.3), headless in Node: taps
 * last one step and holds and axes until changed, bad values and bad scripts are named, `input.play` steps the sim
 * through the session with the device's state under each line, and `input.record()` is a replay that plays back to
 * the same hash, with a body that buffers its jump in sim time.
 * @see engine/input/devices/virtual.ts
 * @see engine/input/devices/inspector.ts
 * @see engine/input/script.ts
 */
import { describe, expect, it } from 'vitest';
import { createHeadless } from '../../app/headless';
import { createRegistry } from '../../core/registry';
import { defineScene } from '../../sim/scene';
import { playReplay } from '../../sim/replay';
import { defineComponent } from '../../sim/state';
import { buffered, consume, createInputBuffer, updateInputBuffer, type InputBuffer } from '../intents';
import { names, numbers, parseScript } from '../script';
import './inspector';
import { createVirtualDevice, playScript, virtualIntents } from './virtual';

describe('the virtual device', () => {
  it('taps for one step, holds and pushes axes until changed', () => {
    const device = createVirtualDevice();
    device.press('jump');
    device.hold('sprint');
    device.axis('look', [0.5, -0.1]);
    device.axis('game:mode', 'stealth');
    expect(device.touched).toBe(true);
    expect(device.take()).toEqual({
      held: ['sprint'],
      taps: ['jump'],
      axes: { look: [0.5, -0.1], 'game:mode': 'stealth' },
    });
    expect(device.touched).toBe(false);
    device.hold('sprint', false);
    device.axis('look', null);
    expect(device.take()).toEqual({ held: [], taps: [], axes: { 'game:mode': 'stealth' } });
    device.clear();
    expect(device.peek()).toEqual({ held: [], taps: [], axes: {} });
  });

  it('names a bad action, axis or value', () => {
    const device = createVirtualDevice();
    expect(() => device.press('')).toThrow(/INPUT_BAD_VIRTUAL.*press: "" is no action name/);
    expect(() => device.axis('mvoe', [0, 1])).toThrow(/axis\("mvoe"\): no such axis/);
    expect(() => device.axis('move', [0, NaN])).toThrow(/is not 2 finite numbers/);
    expect(() => device.axis('cam', '1')).toThrow(/is not a finite number/);
  });

  it('turns its stick by the heading, as keys are', () => {
    const intents = virtualIntents({ held: [], taps: [], axes: { move: [0, 1], cam: Math.PI } }, 0);
    const move = intents.move as number[];
    expect(move[0]).toBeCloseTo(0, 12);
    expect(move[1]).toBeCloseTo(-1, 12);
    expect(intents.cam).toBe(Math.PI);
  });

  it('plays a script line by line on top of what it holds, tapping on each line’s first step', () => {
    const device = createVirtualDevice();
    device.hold('block');
    device.press('wave');
    const steps: Record<string, unknown>[] = [];
    const ran = playScript(device, '# go\n2 move=0,1 hold=sprint tap=jump\n1 game:charge=2', (intents) =>
      steps.push(intents as Record<string, unknown>),
    );
    expect(ran).toBe(3);
    expect(steps.map((step) => [step.b, step.p, step.move, step['game:charge']])).toEqual([
      [['block', 'sprint'], ['wave', 'jump'], [0, 1], undefined],
      [['block', 'sprint'], [], [0, 1], undefined],
      [['block'], [], undefined, 2],
    ]);
    expect(() => playScript(device, '2 move=0\n1 hop=x\nx', () => {})).toThrow(
      /INPUT_BAD_SCRIPT.*line 1: move: "0" is not 2 numbers; line 2: unknown key "hop".*line 3 starts with "x"/,
    );
  });

  it('parses the grammar both scripts share', () => {
    expect(parseScript('3 a=1,2 n=x,y # c', { a: numbers(2), n: names })).toEqual([
      { count: 3, line: 1, values: { a: [1, 2], n: ['x', 'y'] } },
    ]);
    expect(() => parseScript('1 a', { a: numbers(1) })).toThrow(/a needs a value/);
    expect(() => parseScript('1 n=x,,y', { n: names })).toThrow(/holds an empty name/);
  });
});

describe('__engine.input', () => {
  /** A scene whose hero walks by the intents and jumps on a buffered press, landing after 30 steps. */
  function heroScene() {
    const registry = createRegistry();
    defineComponent(
      'hero',
      {
        description: 'The hero.',
        fields: {
          x: { type: 'number', default: 0, description: 'East, m.' },
          z: { type: 'number', default: 0, description: 'North, m.' },
          air: { type: 'integer', default: 0, description: 'Steps left in the air.' },
          jumps: { type: 'integer', default: 0, description: 'Jumps made.' },
          input: { type: 'object', default: createInputBuffer(), description: 'Its buttons.' },
        },
      },
      registry,
    );
    type Hero = { x: number; z: number; air: number; jumps: number; input: InputBuffer };
    const scene = defineScene<{ hero: Hero }>(
      'test:hero',
      {
        setup: (w) => void w.spawn({ hero: {} }),
        step: (w, intents) => {
          for (const e of w.query('hero')) {
            const hero = e.hero;
            updateInputBuffer(hero.input, intents, w.tick);
            hero.x += (intents.move?.[0] ?? 0) * w.dt;
            hero.z += (intents.move?.[1] ?? 0) * w.dt;
            if (hero.air > 0) hero.air--;
            else if (buffered(hero.input, 'jump')) {
              consume(hero.input, 'jump');
              hero.air = 30;
              hero.jumps++;
            }
          }
        },
      },
      registry,
    );
    return { registry, scene };
  }

  it('drives the virtual device, steps through the session, and records a replay that plays back', async () => {
    const { registry, scene } = heroScene();
    const engine = await createHeadless({ scene, registry });
    const input = engine.input as Record<string, (...args: unknown[]) => unknown>;
    expect(Object.keys(input).sort()).toEqual(['axis', 'hold', 'play', 'press', 'record', 'state']);
    input.axis('move', [0, 1]);
    expect(input.press('jump')).toEqual({ held: [], taps: ['jump'], axes: { move: [0, 1] } });
    expect(input.play('20')).toEqual({ steps: 20, tick: 20 });
    expect(input.play('5 tap=jump')).toEqual({ steps: 5, tick: 25 }); // in the air: buffered, used on landing
    input.axis('move', null);
    input.hold('crouch');
    expect(input.state()).toEqual({ held: ['crouch'], taps: [], axes: {} });
    input.play('15');
    const state = engine.get(1) as unknown as { hero: { z: number; jumps: number } };
    expect(state.hero.jumps).toBe(1); // the second press came 11 steps before the landing, past the 9-step window
    expect(state.hero.z).toBeCloseTo(25 / 60, 12);
    const replay = input.record() as { inputs: [number, Record<string, unknown>][] };
    expect(replay.inputs).toEqual([
      [0, { move: [0, 1], p: ['jump'] }],
      [20, { p: ['jump'] }],
      [25, { b: ['crouch'], move: null }],
    ]);
    const played = playReplay(replay, { registry, checkpoints: [40] });
    expect(played.hashes['40']).toBe((engine.hash as () => string)());
    expect(() => input.play('1 jmp=1')).toThrow(/INPUT_BAD_SCRIPT/);
    expect(() => input.press(3)).toThrow(/DEV_BAD_ARGS/);
  });

  it('keeps one device per engine', async () => {
    const { registry, scene } = heroScene();
    const a = (await createHeadless({ scene, registry })).input as Record<string, (...args: unknown[]) => unknown>;
    const b = (await createHeadless({ scene, registry })).input as Record<string, (...args: unknown[]) => unknown>;
    a.hold('crouch');
    expect(b.state()).toEqual({ held: [], taps: [], axes: {} });
  });
});
