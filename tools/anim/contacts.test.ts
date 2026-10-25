/**
 * @file Tests for contact and event detection (tools/anim/contacts.ts, WP 8.8) on captures made from the rest body's
 * standing pose, frame by frame: feet on the floor and lifted, a step and a landing; the treadmill under an in-place
 * walk and an in-place ladder; a hand on a rung while the body climbs past it, an idle's still hands (no contact), a
 * hand flat on the floor, a hand the body hangs from overhead, but not one raised overhead with the feet on the floor
 * nor one drifting slowly past `HOLD_REACH`; and a strike's `hit`, timed by the runtime's own rule.
 */
import { describe, expect, it } from 'vitest';
import { busy, clipOf, REST, standing } from '../../tests/unit/anim/clip-fixtures';
import type { Capture } from '../../engine/anim/clip/encode';
import { strikeTime } from '../../engine/anim/clip/library';
import { POINT_INDEX, samplePose } from '../../engine/anim/clip/readable';
import { AIRBORNE, detectContacts, HOLD_REACH, STILL, treadmill } from './contacts';

const FPS = 30;
const STAND = samplePose(REST, clipOf([standing(0)]), 0);
const FOOT = (s: string) => [`ankle${s}`, `ball${s}`, `toe${s}`];
const HAND = (s: string) => [`wrist${s}`, `knuck${s}`, `fist${s}`, `index${s}`, `pinky${s}`];

/** A capture of `n` frames: the standing pose, each frame's points moved by `move(f)` (`{ point: [df, dr, dz] }`). */
function capture(n: number, move: (f: number) => Record<string, number[]>, loop = false): Capture {
  const data = new Float32Array(n * 108);
  for (let f = 0; f < n; f++) {
    data.set(STAND, f * 108);
    for (const [name, d] of Object.entries(move(f)))
      for (let j = 0; j < 3; j++) data[f * 108 + POINT_INDEX[name] * 3 + j] += d[j];
  }
  return { name: 'Test', n, dur: (n - 1) / FPS, loop, fps: FPS, data, move: null };
}
/** `points` all moved by `d`. */
const all = (points: string[], d: number[]) => Object.fromEntries(points.map((p) => [p, d]));
const detect = (cap: Capture, tags: string[] = []) => detectContacts(cap, REST, clipOf([standing(0)]), tags);

describe('the feet', () => {
  it('hold the floor while they stand on it, and step where one comes down again', () => {
    // the left foot lifted 100 mm from frame 10 to frame 19
    const cap = capture(31, (f) => (f >= 10 && f < 20 ? all(FOOT('L'), [0, 0, 100]) : {}));
    const { contacts, events } = detect(cap);
    expect(contacts.filter((c) => c.part.startsWith('foot'))).toEqual([
      { part: 'footL', from: 0, to: 0.3 },
      { part: 'footR', from: 0, to: 1 },
      { part: 'footL', from: 0.667, to: 1 },
    ]);
    expect(events).toEqual([{ t: 0.667, name: 'step', side: 'L' }]);
  });

  it('land after a flight of AIRBORNE or more, and a foot far below the floor stands on nothing', () => {
    const air = Math.ceil(AIRBORNE * FPS) + 2;
    const cap = capture(40, (f) => (f < air ? all([...FOOT('L'), ...FOOT('R')], [0, 0, 300]) : {}));
    expect(detect(cap).events).toEqual([
      { t: +(air / FPS).toFixed(3), name: 'land', side: 'L' },
      { t: +(air / FPS).toFixed(3), name: 'land', side: 'R' },
    ]);
    expect(detect(capture(10, () => all([...FOOT('L'), ...FOOT('R')], [0, 0, -150]))).contacts).toEqual([]);
  });
});

describe('the treadmill', () => {
  it('is the floor sliding back under an in-place walk, nothing under a clip that travels or stands', () => {
    // a 1 s cycle: each foot planted 18 frames, sliding back at 1 m/s, then 12 frames forward through the air, the
    // right half a cycle behind the left; the hands swing against them
    const foot = (g: number) => (g < 18 ? [300 - 1000 * (g / FPS), 0, 0] : [-300 + 50 * (g - 18), 0, 80]);
    const swing = (f: number, k: number) => [150 * Math.sin((2 * Math.PI * (f + k)) / 30), 0, 0];
    const walk = capture(
      31,
      (f) => ({
        ...all(FOOT('L'), foot(f % 30)),
        ...all(FOOT('R'), foot((f + 15) % 30)),
        ...all(HAND('L'), swing(f, 15)),
        ...all(HAND('R'), swing(f, 0)),
      }),
      true,
    );
    const [vf, vr, vz] = treadmill(walk, REST);
    expect([Math.round(vf / 10) * 10, Math.round(vr), vz]).toEqual([-1000, 0, 0]);
    expect(treadmill({ ...walk, loop: false }, REST)).toEqual([0, 0, 0]);
    expect(
      treadmill(
        capture(31, () => ({}), true),
        REST,
      ),
    ).toEqual([0, 0, 0]);
  });
});

describe('the hands', () => {
  /** An in-place ladder: the left hand grips a rung sinking at 0.5 m/s for 15 frames, then reaches back up. */
  const ladder = capture(
    31,
    (f) => ({
      ...all(HAND('L'), f <= 15 ? [0, 0, 600 - 500 * (f / FPS)] : [0, 0, 350 + 15 * (f - 15)]),
      ...all(FOOT('L'), [0, 0, 400 - 500 * ((f % 16) / FPS)]),
      ...all(FOOT('R'), [0, 0, 400 - 500 * (((f + 8) % 16) / FPS)]),
    }),
    true,
  );

  it("hold a rung the body climbs past, and an idle's still hands hold nothing", () => {
    expect(treadmill(ladder, REST).map(Math.round)).toEqual([0, 0, -500]);
    const grips = detect(ladder).contacts.filter((c) => c.part === 'handL');
    expect(grips).toHaveLength(1);
    expect(grips[0].from).toBe(0);
    expect(grips[0].to).toBeGreaterThanOrEqual(0.433);
    expect(detect(capture(31, () => ({}))).contacts.filter((c) => c.part.startsWith('hand'))).toEqual([]);
  });

  it('hold the floor they lie still on, and a hold above the head the body hangs from (a hang)', () => {
    const down = STAND[POINT_INDEX.knuckR * 3 + 2] - 30;
    const flat = capture(31, () => all(HAND('R'), [0, 0, -down]));
    expect(detect(flat).contacts.filter((c) => c.part === 'handR')).toEqual([{ part: 'handR', from: 0, to: 1 }]);
    const up = STAND[POINT_INDEX.headTop * 3 + 2] - STAND[POINT_INDEX.knuckL * 3 + 2] + 200;
    const body = Object.keys(POINT_INDEX);
    // the whole body 300 mm up, its feet off the floor, the left hand above the head: it hangs from that hand
    const hang = capture(31, () => ({ ...all(body, [0, 0, 300]), ...all(HAND('L'), [0, 0, up + 300]) }));
    expect(detect(hang).contacts.filter((c) => c.part === 'handL')).toEqual([{ part: 'handL', from: 0, to: 1 }]);
    // the same hand raised with the feet on the floor holds nothing: an aim, a wave
    const raised = capture(31, () => all(HAND('L'), [0, 0, up]));
    expect(detect(raised).contacts.filter((c) => c.part === 'handL')).toEqual([]);
  });

  it('hold nothing off the floor where the hand drifts on slowly, past HOLD_REACH; on the floor it may slide', () => {
    const drift = STILL / 2; // mm/s: slow enough for a hold, every frame
    expect(drift * 1).toBeGreaterThan(HOLD_REACH); // over the second
    const up = STAND[POINT_INDEX.headTop * 3 + 2] - STAND[POINT_INDEX.knuckL * 3 + 2] + 200;
    const body = Object.keys(POINT_INDEX);
    // the body hanging from its left hand, as in the hang above, the hand drifting along at `speed`
    const hang = (speed: number) => capture(31, (f) => ({ ...all(body, [0, 0, 300]), ...all(HAND('L'), [(speed * f) / FPS, 0, up + 300]) })); // prettier-ignore
    expect(detect(hang(drift)).contacts.filter((c) => c.part === 'handL')).toEqual([]);
    expect(detect(hang(HOLD_REACH / 2)).contacts.filter((c) => c.part === 'handL')).toEqual([{ part: 'handL', from: 0, to: 1 }]); // prettier-ignore
    const down = STAND[POINT_INDEX.knuckR * 3 + 2] - 30;
    const pushing = capture(31, (f) => all(HAND('R'), [(drift * f) / FPS, 0, -down])); // a hand pushing on the floor
    expect(detect(pushing).contacts.filter((c) => c.part === 'handR')).toEqual([{ part: 'handR', from: 0, to: 1 }]);
  });
});

describe('the strike', () => {
  it("is a hit in a clip tagged attack, at the runtime's strike time, on the side that reaches", () => {
    const clip = clipOf([standing(0), { ...busy(0.5), t: 0.5 }, standing(1)], { dur: 1 });
    const cap = capture(31, () => ({}));
    const hit = detectContacts(cap, REST, clip, ['attack']).events.find((e) => e.name === 'hit');
    expect(hit?.t).toBe(Math.round(strikeTime(clip, REST) * 1000) / 1000);
    expect(hit?.side).toBe('R'); // busy's right arm punches forward
    expect(detectContacts(cap, REST, clip, ['walk']).events.some((e) => e.name === 'hit')).toBe(false);
  });
});
