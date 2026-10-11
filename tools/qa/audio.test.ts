/**
 * @file The `audio` QA family in T1 (tools/qa/audio.ts, PLAN.md §8.6, WP 9.4): every engine sound passes against
 * tests/baselines/qa-audio.json in under 5 s of CPU time (the WP's Done-when, held so on a loaded machine too); the
 * metrics read known numbers off the fixture sounds and synthetic buffers (peak, DC, clicks, leading silence, spectral
 * centroid); on a registry with seeded faults, each check fires once for its sound, valued by its worst render and
 * naming it; a game's sound modules are found under `labs/<name>/sounds/`; `--only` works through `runQa`.
 * @see tools/qa/audio.ts
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { renderSfx, defineSfx } from '../../engine/audio/data/sfx';
import { defineSong } from '../../engine/audio/data/song';
import { createRegistry } from '../../engine/core/registry';
import { defineFixtureSounds, FIXTURE_SFX } from '../../fixtures/sounds';
import { runQa } from '../cmd/qa';
import { ROOT } from '../x';
import { checkSounds, findClicks, soundMetrics, soundModules, spectralCentroid } from './audio';

const RATE = 44100;
const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the audio QA family', () => {
  it('passes every engine sound against its baseline in under 5 s of CPU time', async () => {
    // CPU time, the work the budget is about: wall-clock time is stretched by whatever else the machine runs.
    const start = process.cpuUsage();
    const result = await runQa(ROOT, 'audio');
    const { user, system } = process.cpuUsage(start);
    const ms = (user + system) / 1000;
    expect(result.failures).toEqual([]);
    expect(ms).toBeLessThan(5000);
  });

  it('keeps only the ids --only names', async () => {
    const result = await runQa(ROOT, 'audio', ['song:boss']);
    expect(result.failures).toEqual([]);
    expect(result.violations).toBe(0);
  });

  it("finds a game's sound modules under labs/<name>/sounds/", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'qa-audio-')));
    temporary.push(root);
    for (const file of ['labs/box/sounds/hits.ts', 'labs/box/sounds/hits.test.ts', 'labs/box/sounds/a.ts']) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), '');
    }
    expect(soundModules(root)).toEqual(['labs/box/sounds/a.ts', 'labs/box/sounds/hits.ts']);
  });
});

describe('the metrics', () => {
  const registry = createRegistry();
  defineFixtureSounds(registry);

  it('read the fixture tone: 0.5 s, peak 0.5, no DC, no click, no lead, its centroid at 441 Hz', () => {
    const metrics = soundMetrics(renderSfx('sfx:fixtureTone', { registry }), RATE);
    expect(metrics.seconds).toBe(0.5);
    expect(metrics.peak).toBeCloseTo(0.5, 3);
    expect(Math.abs(metrics.dc)).toBeLessThan(1e-4);
    expect(metrics.clicks).toEqual([]);
    expect(metrics.lead).toBeLessThan(0.001);
    expect(metrics.centroid).toBeGreaterThan(430);
    expect(metrics.centroid).toBeLessThan(452);
  });

  it('put the chord between its notes and the noise higher, and call silence 0 Hz', () => {
    const chord = spectralCentroid(renderSfx('sfx:fixtureChord', { registry }), RATE);
    expect(chord).toBeGreaterThan(441);
    expect(chord).toBeLessThan(661.5);
    const noise = spectralCentroid(renderSfx('sfx:fixtureNoise', { registry }), RATE);
    expect(noise).toBeGreaterThan(chord);
    expect(spectralCentroid(new Float32Array(3000), RATE)).toBe(0);
  });

  it('find a step into or out of silence, and the end of a buffer cut while loud, each once', () => {
    const steady = Float32Array.from({ length: 4410 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 441 * i) / RATE));
    expect(findClicks(steady, RATE)).toEqual([4410]); // it stops mid-wave: the jump to silence after the end
    const faded = steady.map((x, i) => x * Math.min(1, (4410 - i) / 441, i / 441));
    expect(findClicks(faded, RATE)).toEqual([]);
    const gap = faded.slice();
    gap.fill(0, 2025, 2425); // a 9 ms hole cut into the tone at its crests
    expect(findClicks(gap, RATE)).toEqual([2025, 2425]);
    const square = Float32Array.from({ length: 4410 }, (_, i) => (Math.floor(i / 50) % 2 ? -0.4 : 0.4));
    expect(
      findClicks(
        square.map((x, i) => x * Math.min(1, i / 441, (4410 - i) / 441)),
        RATE,
      ),
    ).toEqual([]);
  });

  it('measure DC and the leading silence', () => {
    const late = new Float32Array(RATE).fill(0.2, 8820);
    const metrics = soundMetrics(late, RATE);
    expect(metrics.lead).toBeCloseTo(0.2, 6);
    expect(metrics.dc).toBeCloseTo(0.16, 6);
  });
});

describe('the checks', () => {
  /** A registry with the fixture sounds and one faulty sound per check. */
  function faulty() {
    const registry = createRegistry();
    defineFixtureSounds(registry);
    defineSfx(
      'sfx:loud',
      { voices: [{ wave: 'sine', freq: 220, vol: 0.8, dur: 0.2 }], layers: [{ sfx: 'sfx:loud2' }] },
      registry,
    );
    defineSfx('sfx:loud2', { voices: { wave: 'sine', freq: 220, vol: 0.7, dur: 0.2 } }, registry);
    defineSfx('sfx:late', { voices: { wave: 'triangle', freq: 330, at: 0.2, dur: 0.1 } }, registry);
    defineSfx('sfx:hush', { voices: { wave: 'sine', freq: 330, vol: 0, dur: 0.1 } }, registry);
    defineSfx('sfx:long', { voices: { wave: 'sine', freq: 330, vol: 0.2, dur: 12 } }, registry);
    defineSfx('sfx:rumble', { voices: { wave: 'sine', freq: 20, vol: 0.3, dur: 0.5 } }, registry);
    defineSfx('sfx:whine', { voices: { wave: 'sine', freq: 18000, vol: 0.3, dur: 0.2 } }, registry);
    defineSfx('sfx:snap', { voices: { wave: 'square', freq: 220, attack: 0, vol: 0.3, dur: 0.1 } }, registry);
    defineSong(
      'song:calm',
      { tracks: [{ notes: 'C4 - E4 - G4 - E4 - C4 - E4 - G4 - - -', wave: 'triangle' }] },
      registry,
    );
    return registry;
  }

  it('fire once per sound and metric, valued by the worst render and naming it', () => {
    const registry = faulty();
    const faults = ['sfx:loud', 'sfx:late', 'sfx:hush', 'sfx:long', 'sfx:rumble', 'sfx:whine', 'sfx:snap'];
    const found = checkSounds(registry, [...faults, ...Object.keys(FIXTURE_SFX), 'song:fixtureDemo', 'song:calm']);
    const pairs = found.map((violation) => `${violation.id} ${violation.metric}`);
    expect(pairs).toEqual([
      'sfx:hush silence',
      'sfx:late silence',
      'sfx:long duration',
      'sfx:loud clipping',
      'sfx:rumble centroid',
      'sfx:snap clicks',
      'sfx:whine centroid',
    ]);
    const loud = found.find((violation) => violation.id === 'sfx:loud');
    expect(loud?.value).toBeGreaterThan(1.4);
    expect(loud?.message).toMatch(/variant \d: peak 1\.\d+ .*lower the vol/);
    expect(found.find((violation) => violation.id === 'sfx:late')?.value).toBeCloseTo(0.2, 2);
    expect(found.find((violation) => violation.id === 'sfx:long')?.value).toBeCloseTo(12, 1);
    expect(found.find((violation) => violation.id === 'sfx:hush')?.message).toMatch(/silent throughout/);
    expect(found.find((violation) => violation.id === 'sfx:rumble')?.message).toMatch(/below/);
    expect(found.find((violation) => violation.id === 'sfx:whine')?.message).toMatch(/above/);
  });

  it('reports a sound that cannot render as one render violation', () => {
    const registry = createRegistry();
    defineSfx('sfx:orphan', { layers: [{ sfx: 'sfx:nowhere' }] }, registry);
    const found = checkSounds(registry, ['sfx:orphan']);
    expect(found.map((violation) => violation.metric)).toEqual(['render']);
    expect(found[0].message).toMatch(/sfx:nowhere/);
  });
});
