/**
 * @file The acceptance of the eval task box-sound (evals/box-sound/prompt.md), run by `node x evals` in the attempt's
 * copy: `sfx:boxSquelch` renders every variant audible, below full scale and under half a second; the box's sound map
 * plays it for `slam` at the thud's 0.8 and keeps the thud for a landing; and the fight replay's timeline has it at
 * every pounce's landing, the same 77 sounds, its world the replay's golden.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getSfx, renderSfx } from '../../engine';
import { peak } from '../../engine/audio/dsp/measure';
import '../../labs/box/scenes/fight';
import { HALL_LEVEL } from '../../labs/box/scenes/hall';
import '../../labs/box/sounds/effects';
import { soundOf } from '../../labs/box/sounds/events';
import { FIGHT_TIMELINE, soundTimeline } from '../../tests/pages/boxAudioTimeline';

const world = { tick: 7, events: { trace: () => [] }, get: () => ({ actor: { x: 2, y: 0, z: 3 } }) };
const record = (type: string, payload: unknown) => ({ seq: 1, type, payload, listeners: 0, failed: 0 });

describe('sfx:boxSquelch', () => {
  it('renders every variant audible, below full scale and under half a second', () => {
    const squelch = getSfx('sfx:boxSquelch');
    expect(squelch.variants).toBeGreaterThan(1);
    for (let variant = 0; variant < squelch.variants; variant++) {
      const samples = renderSfx(squelch, { variant });
      expect([peak(samples) > 0.01, peak(samples) < 1, samples.length < 0.5 * 44_100]).toEqual([true, true, true]);
    }
  });

  it('is what a pounce’s landing plays, at the thud’s 0.8; a landing still thuds', () => {
    expect(soundOf(record('slam', { position: [5, 1, 6], size: 0.6 }), world, null)).toMatchObject({ sfx: 'sfx:boxSquelch', vol: 0.8, position: [5, 1, 6] }); // prettier-ignore
    expect(soundOf(record('land', { id: 1, speed: 4 }), world, null)).toMatchObject({ sfx: 'sfx:boxThud', vol: 0.5 });
  });

  it('is heard at every pounce’s landing in the fight replay, the run and its 77 sounds as they were', () => {
    const text = readFileSync(FIGHT_TIMELINE.replay, 'utf8');
    const timeline = soundTimeline(text, HALL_LEVEL);
    const golden = (JSON.parse(text) as { hashes: Record<string, Record<string, string>> }).hashes['linux-x64'];
    const slams = timeline.events.filter((sound) => sound.type === 'slam');
    expect([timeline.worldHash, timeline.events.length]).toEqual([golden['600'], 77]);
    expect(slams.length).toBeGreaterThan(0);
    expect(slams.every((sound) => sound.sfx === 'sfx:boxSquelch')).toBe(true);
  }, 300_000);
});
