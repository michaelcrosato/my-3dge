/**
 * @file Unit tests for the input buffer of engine/input/intents.ts (T1, WP 3.3): edges, buffering, `consume` and
 * auto-repeat in sim time. A press stays buffered for `BUFFER_STEPS` steps (9, the prototype's 0.15 s) until it is
 * consumed, a release is seen on its step only, a tap shorter than a step is pressed and released on the same step,
 * repeats come after `REPEAT_DELAY` steps then every `REPEAT_RATE`, and the buffer is plain data a component holds, so
 * a world hashes, captures and restores it.
 * @see engine/input/intents.ts
 */
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../core/registry';
import { defineComponent } from '../sim/state';
import { createWorld } from '../sim/world';
import {
  BUFFER_STEPS,
  buffered,
  consume,
  consumeAll,
  createInputBuffer,
  normalizeIntents,
  NO_INTENTS,
  released,
  repeated,
  REPEAT_DELAY,
  REPEAT_RATE,
  updateInputBuffer,
  type InputBuffer,
  type Intents,
} from './intents';

/** Feeds `steps` (held buttons per step; `tap:` names a tap) into a fresh buffer; returns it after each step. */
function run(steps: string[][], start = 1): InputBuffer[] {
  const buffer = createInputBuffer();
  let previous: Intents = NO_INTENTS;
  return steps.map((names, i) => {
    const b = names.filter((name) => !name.startsWith('tap:'));
    const p = names.filter((name) => name.startsWith('tap:')).map((name) => name.slice(4));
    previous = normalizeIntents({ b, p }, previous);
    return structuredClone(updateInputBuffer(buffer, previous, start + i));
  });
}

describe('the input buffer', () => {
  it('keeps the defaults of the prototype in steps at 60 Hz', () => {
    expect([BUFFER_STEPS, REPEAT_DELAY, REPEAT_RATE]).toEqual([9, 18, 5]);
  });

  it('buffers a press for BUFFER_STEPS steps, then forgets it', () => {
    const buffer = createInputBuffer();
    const seen: boolean[] = [];
    for (let tick = 10; tick <= 21; tick++) {
      updateInputBuffer(buffer, tick === 10 ? normalizeIntents({ p: ['jump'] }) : NO_INTENTS, tick);
      seen.push(buffered(buffer, 'jump'));
    }
    expect(seen).toEqual([true, true, true, true, true, true, true, true, true, true, false, false]);
    expect(buffered(buffer, 'jump', 20)).toBe(true);
    expect(buffered(buffer, 'dash')).toBe(false);
  });

  it('forgets a consumed press until the next one', () => {
    const buffer = createInputBuffer();
    updateInputBuffer(buffer, normalizeIntents({ p: ['jump'] }), 1);
    updateInputBuffer(buffer, NO_INTENTS, 2);
    consume(buffer, 'jump');
    expect(buffered(buffer, 'jump')).toBe(false);
    updateInputBuffer(buffer, NO_INTENTS, 3);
    expect(buffered(buffer, 'jump')).toBe(false);
    updateInputBuffer(buffer, normalizeIntents({ b: ['jump'] }), 4);
    expect(buffered(buffer, 'jump')).toBe(true);
    consume(buffer, 'dash'); // never pressed: nothing to use up
    updateInputBuffer(buffer, normalizeIntents({ p: ['dash', 'jump'] }), 5);
    consumeAll(buffer);
    expect([buffered(buffer, 'jump'), buffered(buffer, 'dash')]).toEqual([false, false]);
  });

  it('sees a release on its step only, and a tap shorter than a step as a press and a release', () => {
    const steps = run([['jump'], ['jump'], [], [], ['tap:jump'], ['jump', 'dash'], ['dash']]);
    expect(steps.map((buffer) => released(buffer, 'jump'))).toEqual([false, false, true, false, true, false, true]);
    expect(steps.map((buffer) => buffer.pressedAt.jump)).toEqual([1, 1, 1, 1, 5, 6, 6]);
    expect(steps[5].held).toEqual(['dash', 'jump']);
  });

  it('repeats a held button after REPEAT_DELAY steps, then every REPEAT_RATE', () => {
    const buffer = createInputBuffer();
    const fired: number[] = [];
    let previous: Intents = NO_INTENTS;
    for (let tick = 5; tick <= 40; tick++) {
      previous = normalizeIntents({ b: tick < 39 ? ['down'] : [] }, previous);
      updateInputBuffer(buffer, previous, tick);
      if (repeated(buffer, 'down')) fired.push(tick);
    }
    expect(fired).toEqual([5, 23, 28, 33, 38]);
    expect(repeated(buffer, 'up')).toBe(false);
    updateInputBuffer(buffer, normalizeIntents({ p: ['up'] }), 41);
    expect(repeated(buffer, 'up', 2, 1)).toBe(true); // a tap repeats once, on its step
  });

  it('is plain data a component holds, hashed, captured and restored with the world', () => {
    const registry = createRegistry();
    defineComponent(
      'controls',
      {
        description: 'Buttons.',
        fields: { buffer: { type: 'object', default: createInputBuffer(), description: 'B.' } },
      },
      registry,
    );
    const world = createWorld<{ controls: { buffer: InputBuffer } }>({ seed: 1, registry });
    const id = world.spawn({ controls: {} });
    world.systems.add('track', (w, intents) => {
      for (const e of w.query('controls')) updateInputBuffer(e.controls.buffer, intents, w.tick);
    });
    world.step(normalizeIntents({ b: ['jump'] }));
    const capture = world.capture();
    const hash = world.hash();
    world.step(normalizeIntents({ p: ['dash'] }));
    expect(world.get(id)?.controls?.buffer.released).toEqual(['dash', 'jump']);
    expect(world.hash()).not.toBe(hash);
    world.restore(capture);
    expect(world.hash()).toBe(hash);
    expect(world.get(id)?.controls?.buffer).toEqual({
      tick: 1,
      held: ['jump'],
      released: [],
      pressedAt: { jump: 1 },
      consumed: {},
    });
  });
});
