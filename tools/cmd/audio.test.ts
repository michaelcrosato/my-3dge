/**
 * @file Tests for `x audio` (tools/cmd/audio.ts): a sound's metrics within 20 lines, its WAV and spectrogram on
 * request (a valid 16-bit PCM file; a picture whose brightest row is the tone's pitch), usage errors naming the
 * closest; a replay's sound events read from the sim events that name an `sfx`, at their step's time, variants in
 * turn, bad ones reported, each of a list a scene's `sounds` gives one event (a shot and where it strikes); their
 * mix, the sum of the rendered effects, judged for clipping; a real replay played
 * against its goldens; and the box fight's sounds through its scene's `sounds`, the page's timeline step for step.
 * @see tools/cmd/audio.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderSfx } from '../../engine/audio/data/sfx';
import { createRegistry } from '../../engine/core/registry';
import { defineScene } from '../../engine/sim/scene';
import { createSession } from '../../engine/sim/session';
import { defineFixtureSounds } from '../../fixtures/sounds';
import '../../labs/box/scenes/fight';
import { HALL_LEVEL } from '../../labs/box/scenes/hall';
import '../../labs/box/sounds/effects';
import { FIGHT_TIMELINE, soundTimeline } from '../../tests/pages/boxAudioTimeline';
import { dispatch, ROOT } from '../x';
import { mixSoundEvents, replaySoundEvents } from '../lib/replaySounds';
import { encodeWav, SPECTROGRAM, spectrogram } from './audio';

/** Runs `node x audio …` in this repository; resolves to the exit code and printed lines. */
async function audio(...args: string[]): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const code = await dispatch(['audio', ...args], { print: (line) => lines.push(line) });
  return { code, lines };
}

/** The report a run wrote. */
const report = (target: string) => JSON.parse(readFileSync(join(ROOT, 'out', 'audio', target, 'report.json'), 'utf8'));

describe('x audio <id>', () => {
  it('prints the metrics within 20 lines and writes the WAV and spectrogram asked for', async () => {
    const { code, lines } = await audio('sfx:jump', '--wav', '--spectrogram');
    expect(code).toBe(0);
    expect(lines.length).toBeLessThanOrEqual(20);
    expect(lines[0]).toMatch(/^x audio: ok: sfx:jump variant 0: 0\.140 s, peak 0\.300 \(-10\.5 dBFS\), within/);
    const { metrics, artifacts } = report('sfx-jump');
    expect(metrics).toMatchObject({ seconds: 0.14, samples: 6174, peak: 0.3, clicks: 0, hash: '90cfd6d1706db427' });
    expect(artifacts.map((artifact: { path: string }) => artifact.path)).toEqual([
      'out/audio/sfx-jump/sound.wav',
      'out/audio/sfx-jump/spectrogram.png',
    ]);
    const wav = readFileSync(join(ROOT, 'out/audio/sfx-jump/sound.wav'));
    expect(wav.length).toBe(44 + 6174 * 2);
    expect(existsSync(join(ROOT, 'out/audio/sfx-jump/spectrogram.png'))).toBe(true);
  });

  it('renders a song at an intensity, and refuses a bad id, variant or intensity with exit 2', async () => {
    expect((await audio('song:victory', '--intensity', '0.5')).code).toBe(0);
    const typo = await audio('sfx:jmup');
    expect(typo.code).toBe(2);
    expect(typo.lines.join('\n')).toMatch(/no sfx or song "sfx:jmup": did you mean sfx:jump\?/);
    expect((await audio('sfx:jump', '--variant', '9')).lines.join('\n')).toMatch(/variants 0 to 3; 9 is not/);
    expect((await audio('song:victory', '--intensity', '2')).code).toBe(2);
    expect((await audio('song:victory', '--variant', '1')).lines.join('\n')).toMatch(/--variant is not for song/);
    expect((await audio('sfx:jump', '--intensity', '1')).code).toBe(2);
    expect((await audio()).code).toBe(2);
    expect((await audio('sfx:jump', '--replay', 'tests/replays/kernel-movers.replay.json')).code).toBe(2);
  });
});

describe('encodeWav', () => {
  it('writes a 16-bit mono PCM file, clamping to full scale', () => {
    const wav = encodeWav(Float32Array.from([0, 0.5, -1, 2]), 22050);
    expect(wav.toString('latin1', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(4)).toBe(36 + 8);
    expect(wav.toString('latin1', 8, 16)).toBe('WAVEfmt ');
    expect([wav.readUInt16LE(20), wav.readUInt16LE(22), wav.readUInt32LE(24), wav.readUInt16LE(34)]).toEqual([
      1, 1, 22050, 16,
    ]);
    expect(wav.toString('latin1', 36, 40)).toBe('data');
    expect([0, 1, 2, 3].map((i) => wav.readInt16LE(44 + 2 * i))).toEqual([0, 16384, -32767, 32767]);
  });
});

describe('spectrogram', () => {
  it("draws a tone as its brightest row, at the tone's pitch on the log scale", () => {
    const registry = createRegistry();
    defineFixtureSounds(registry);
    const { width, height, rgba } = spectrogram(renderSfx('sfx:fixtureTone', { registry }), 44100);
    expect([width, height]).toEqual([SPECTROGRAM.width, SPECTROGRAM.height]);
    const column = width / 2;
    const brightness = (y: number) => rgba[(y * width + column) * 4] + rgba[(y * width + column) * 4 + 1];
    const brightest = Array.from({ length: height }, (_, y) => y).reduce((a, b) =>
      brightness(b) > brightness(a) ? b : a,
    );
    const expected = height * (1 - Math.log(441 / SPECTROGRAM.low) / Math.log(22050 / SPECTROGRAM.low));
    expect(Math.abs(brightest - expected)).toBeLessThanOrEqual(2);
  });
});

describe('a replay’s sound events', () => {
  /** A registry with the fixture sounds and a scene that emits sound events: blips, a loud chord, a bad one. */
  function chirps() {
    const registry = createRegistry();
    defineFixtureSounds(registry);
    defineScene(
      'chirps',
      {
        setup: (w) => w.emit('start', { sfx: 'sfx:fixtureBlip' }),
        step: (w) => {
          if (w.tick % 30 === 0) w.emit('blip', { sfx: 'sfx:fixtureBlip', vol: 0.5 });
          if (w.tick === 45) w.emit('lap', { laps: 1 }); // no sfx: not a sound event
          if (w.tick === 50) w.emit('hit', { sfx: 'sfx:fixtureBlep' });
          if (w.tick === 60)
            for (let i = 0; i < 3; i++) w.emit('chord', { sfx: 'sfx:fixtureTone', vol: 0.8, variant: 0 });
        },
      },
      registry,
    );
    const session = createSession('chirps', { seed: 3, registry });
    for (let k = 0; k < 90; k++) session.step({});
    const replay = { ...session.record(), hashes: { 'linux-x64': { 90: session.world.hash() } } };
    return { registry, replay };
  }

  it('are the events naming an sfx, at their step, variants in turn, with the bad ones reported', () => {
    const { registry, replay } = chirps();
    const timeline = replaySoundEvents(replay, registry);
    expect(timeline.events.map((event) => [event.step, event.type, event.sfx, event.variant])).toEqual([
      [0, 'start', 'sfx:fixtureBlip', 0],
      [30, 'blip', 'sfx:fixtureBlip', 1],
      [60, 'blip', 'sfx:fixtureBlip', 2],
      [60, 'chord', 'sfx:fixtureTone', 0],
      [60, 'chord', 'sfx:fixtureTone', 0],
      [60, 'chord', 'sfx:fixtureTone', 0],
      [90, 'blip', 'sfx:fixtureBlip', 3],
    ]);
    expect(timeline.events[1]).toMatchObject({ time: 0.5, vol: 0.5 });
    expect(timeline.problems).toEqual([
      'step 50, event hit: "sfx:fixtureBlep" is not an sfx entry: did you mean sfx:fixtureBlip?',
    ]);
    expect(timeline.hashes['90']).toBe(replay.hashes['linux-x64'][90]);
  });

  it("are each of the sounds in a list a scene's sounds gives one event, in its order", () => {
    const registry = createRegistry();
    defineFixtureSounds(registry);
    const pair = [{ sfx: 'sfx:fixtureBlip' }, { sfx: 'sfx:fixtureTone', vol: 0.3 }];
    defineScene(
      'pairs',
      {
        setup: () => {},
        step: (w) => void (w.tick === 10 && w.emit('shot', { at: [1, 0, 2] })),
        sounds: (record) => (record.type === 'shot' ? pair : null),
      },
      registry,
    );
    const session = createSession('pairs', { seed: 1, registry });
    for (let k = 0; k < 20; k++) session.step({});
    const replay = { ...session.record(), hashes: { 'linux-x64': { 20: session.world.hash() } } };
    const timeline = replaySoundEvents(replay, registry);
    expect(timeline.events.map((event) => [event.step, event.type, event.sfx, event.vol])).toEqual([
      [10, 'shot', 'sfx:fixtureBlip', 1],
      [10, 'shot', 'sfx:fixtureTone', 0.3],
    ]);
    expect(timeline.problems).toEqual([]);
  });

  it('mix into the sum of the rendered effects, which the chord pushes past full scale', () => {
    const { registry, replay } = chirps();
    const { events } = replaySoundEvents(replay, registry);
    const { mix, spans } = mixSoundEvents(events, 1.5, registry);
    expect(spans[1]).toEqual([22050, 22050 + 8820]);
    const blip = renderSfx('sfx:fixtureBlip', { variant: 1, registry });
    expect(mix.length).toBe(Math.max(66150, 44100 * 1.5 + blip.length));
    expect(mix[22050 + 100]).toBeCloseTo(0.5 * blip[100], 6);
    const tone = renderSfx('sfx:fixtureTone', { registry });
    expect(Math.max(...mix.subarray(44100, 44100 + tone.length).map(Math.abs))).toBeGreaterThan(1.1);
  });
});

describe('x audio --replay', () => {
  it('plays a replay against its goldens and mixes its sound events, none here', async () => {
    const { code, lines } = await audio('--replay', 'tests/replays/kernel-movers.replay.json');
    expect(code).toBe(0);
    expect(lines.length).toBeLessThanOrEqual(20);
    expect(lines[0]).toMatch(/^x audio: ok: tests\/replays\/kernel-movers\.replay\.json: 0 sound events in \d+ steps/);
    expect(lines.join('\n')).toMatch(/goldens: match \(linux-x64\)/);
  });

  it("finds the box fight's sounds through its scene's sounds hook: the page's timeline, step for step", () => {
    const text = readFileSync(join(ROOT, FIGHT_TIMELINE.replay), 'utf8');
    const read = (events: readonly { step: number; sfx: string; vol: number }[]) =>
      events.map(({ step, sfx, vol }) => [step, sfx, vol]);
    const node = replaySoundEvents(JSON.parse(text));
    expect(node.problems).toEqual([]);
    expect(read(node.events)).toEqual(read(soundTimeline(text, HALL_LEVEL).events));
    expect(node.events).toHaveLength(FIGHT_TIMELINE.sounds);
  });

  it('refuses a missing file with exit 2', async () => {
    expect((await audio('--replay', 'tests/replays/nowhere.replay.json')).code).toBe(2);
  });
});
