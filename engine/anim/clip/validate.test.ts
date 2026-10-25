/**
 * @file Tests reading clips in and checking them (engine/anim/clip/validate.ts, WP 8.2). Offline: `parseClip` as the
 * source parses (comments, sorting, `dur`, the header's order, the input untouched), format 2's fields, every parse
 * error naming the key, its time and the field with its fix, `parseClipSet`, each validator warning on a crafted
 * clip, and the error metrics. With the checkouts (else deferred: no source): every curated clip parses to itself and
 * every shardfall set parses unchanged, and the validator finds the v1 pop where the plan says it is (HERO `Victory`).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { busy, clipOf, curatedClips, legacy, REST, standing } from '../../../tests/unit/anim/clip-fixtures';
import { readLegacySet } from '../../../tools/anim/legacy-readable';
import { requireSource } from '../../../tools/lib/source';
import { decodePose, type Clip, type ClipKey } from './readable';
import { parseClip, parseClipSet, poseError, poseMeanError, validateClip, type ClipWarning } from './validate';

/** A clip's text with `keys`, as an agent might write it. */
const text = (keys: unknown[]) => JSON.stringify({ dur: 1, keys });
/** The message `parseClip` throws for `input`. */
function thrown(input: string | object, name?: string): string {
  try {
    parseClip(input, name);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('parseClip did not throw');
}

describe('parseClip', () => {
  it('reads text as the source does: comment lines, keys sorted by time, dur from the last key, header order kept', () => {
    const source = `// a hand-written clip\n{"clip": "Wave", "loop": false, "keys": [\n${JSON.stringify(standing(1))},\n  // the first pose\n${JSON.stringify(standing(0))}]}`;
    const clip = parseClip(source);
    expect(clip.keys.map((k) => k.t)).toEqual([0, 1]);
    expect(clip.dur).toBe(1);
    expect(Object.keys(clip)).toEqual(['clip', 'loop', 'keys', 'dur']);
  });

  it('copies an object without changing it', () => {
    const input = clipOf([standing(1), standing(0)], { dur: 2 });
    const before = JSON.stringify(input);
    const clip = parseClip(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(clip.keys.map((k) => k.t)).toEqual([0, 1]);
    expect(clip.keys[0]).not.toBe(input.keys[1]);
    expect(clip.keys[0]).toEqual(input.keys[1]);
  });

  it('reads every format-2 field', () => {
    const key: ClipKey = { ...busy(0), handL: [10, -5, 30], handR: [0, 0, 0], rollL: 5, rollR: -3, yaw: 45 };
    const clip = {
      ...clipOf([{ ...key, spine: [5, 10, 0], gripL: 0, gripR: 100 }, busy(0.5)]),
      ...{ speed: 140, fps: 30, via: 'source', fit: [12.5, 80] },
      events: [
        { t: 0.2, name: 'step', side: 'L' },
        { t: 0.4, name: 'land' },
      ],
      contacts: [{ part: 'footL', from: 0, to: 0.3 }],
      props: ['sword:R', 'box:LR'],
    };
    expect(parseClip(clip)).toEqual(clip);
  });

  it('names the key, its time and the field, and the fix, when a key is broken', () => {
    const noHips = { ...standing(0.5), hips: undefined };
    expect(thrown(text([standing(0), noHips]), 'Idle')).toBe(
      '[ANIM_CLIP_MISSING_FIELD] clip "Idle": key 2 (t 0.5) has no "hips": add "hips": [forward, right, up] in % of standing hip height; every key needs hips, body, chest, head, armL, armR, legL and legR',
    );
    expect(thrown(text([{ ...standing(0.25), armL: [0, 0, -100] }]))).toBe(
      '[ANIM_CLIP_BAD_FIELD] the clip: key 1 (t 0.25): "armL" is [0,0,-100]: make "armL" 5 numbers: [forward, out, up, bend, twist]',
    );
    expect(thrown(text([{ ...standing(0), footR: [1, 'x', 0] }]))).toMatch(/key 1 \(t 0\): "footR" is \[1,"x",0\]/);
    expect(thrown(text([{ ...standing(0), gripL: 120 }]))).toMatch(/"gripL" is 120: make "gripL" a number from 0/);
    expect(thrown(text([{ ...standing(0), armr: [0, 0, -100, 0, 0] }]))).toMatch(
      /^\[ANIM_CLIP_UNKNOWN_FIELD\] the clip: key 1 \(t 0\) has no field "armr" \(did you mean "armR" or "armL"\?\): use only the key fields t, hips,/,
    );
    expect(thrown(text([standing(0), { hips: [0, 0, 100] }]))).toBe(
      '[ANIM_CLIP_NO_TIME] the clip: key 2 has no time "t": give every key its time in seconds from the start of the clip, such as "t": 0.5',
    );
    expect(thrown(text([3]))).toMatch(/^\[ANIM_CLIP_BAD_KEY\] the clip: key 1 is 3, not a key pose/);
  });

  it('refuses a clip without keys, text that is not JSON, and a bad or unknown header field', () => {
    expect(thrown('{"dur": 1, "keys": []}', 'Empty')).toMatch(
      /^\[ANIM_CLIP_NO_KEYS\] clip "Empty" has no key poses: give it/,
    );
    expect(thrown('{"dur": 1, "keys": [}')).toMatch(/^\[ANIM_CLIP_NOT_JSON\] the clip is not JSON: /);
    expect(thrown('42', 'Number')).toMatch(/^\[ANIM_CLIP_NO_KEYS\] clip "Number" has no key poses: give it/); // JSON, but no object
    expect(thrown(clipOf([standing(0)], { loop: 'yes' as unknown as boolean }))).toBe(
      '[ANIM_CLIP_BAD_HEADER] clip "Test": "loop" is "yes": make "loop" true or false',
    );
    expect(thrown({ ...clipOf([standing(0)]), lop: true })).toMatch(
      /^\[ANIM_CLIP_UNKNOWN_HEADER\] clip "Test" has no field "lop" \(did you mean "loop"\?\): use only the fields clip, src/,
    );
    const bad = (header: object) => thrown({ ...clipOf([standing(0)]), ...header });
    expect(bad({ events: [{ t: 0.1 }] })).toMatch(/"events" is \[\{"t":0.1\}\]: make "events" a list of/);
    expect(bad({ contacts: [{ part: 'footL', from: 0.5, to: 0.2 }] })).toMatch(/"contacts" is/);
    expect(bad({ contacts: [{ part: 'footL', from: 0.2, to: 0.5, extra: 1 }] })).toMatch(/"contacts" is/); // a field it has no check for
    expect(bad({ contacts: [{ part: 'elbowL', from: 0.2, to: 0.5 }] })).toMatch(/"contacts" is/); // one field of three wrong
    expect(thrown('{"clip": "Wave", "dur": 1, "keys": []}')).toMatch(
      /^\[ANIM_CLIP_NO_KEYS\] clip "Wave" has no key poses/,
    ); // named by its own clip
    expect(bad({ props: ['sword'] })).toMatch(/"props" is \["sword"\]: make "props" a list of "<prop>:<hands>"/);
    expect(bad({ via: 'v3' })).toMatch(/"via" is "v3"/);
  });
});

describe('parseClipSet', () => {
  const set = {
    set: 'DEMO',
    title: 'Demo',
    legend: ['hips [forward, right, up]'],
    format: 2,
    fps: 30,
    sources: { LIB: { label: 'A library', rest: REST } },
    body: null,
    fit: { Idle: [3, 9] },
    clips: { Idle: clipOf([standing(0)], { clip: 'Idle', src: 'LIB' }) },
  };

  it('reads a set and each of its clips', () => {
    expect(parseClipSet(JSON.stringify(set))).toEqual(set);
  });

  it('names the set and the clip in its errors', () => {
    const message = (input: object) => {
      try {
        parseClipSet(input);
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect(message({ ...set, clips: { Idle: { ...set.clips.Idle, src: 'NONE' } } })).toBe(
      '[ANIM_CLIP_BAD_HEADER] clip "DEMO/Idle": "src" is "NONE": make "src" one of the set’s sources (LIB)',
    );
    expect(message({ ...set, clips: { Idle: { ...set.clips.Idle, keys: [{ t: 0 }] } } })).toMatch(
      /^\[ANIM_CLIP_MISSING_FIELD\] clip "DEMO\/Idle": key 1 \(t 0\) has no "hips"/,
    );
    expect(message({ clips: {} })).toMatch(/^\[ANIM_CLIP_BAD_HEADER\] set "": "set" is missing/);
    expect(message({ ...set, legend: 'one line' })).toMatch(/set "DEMO": "legend" is "one line": make "legend" a list/);
  });
});

describe('validateClip', () => {
  const codes = (clip: Clip) => validateClip(clip).map((w: ClipWarning) => [w.code, w.key, w.field]);

  it('finds nothing wrong with a clean clip', () => {
    expect(validateClip(clipOf([standing(0), busy(0.5), standing(1)]))).toEqual([]);
  });

  it('warns when a limb turns round between keys, so its in-between collapses', () => {
    const clip = clipOf([standing(0), { ...standing(1), armL: [10, 0, 100, 0, 0] }]);
    const [warning] = validateClip(clip);
    expect(warning).toEqual({
      code: 'ANIM_CLIP_LIMB_COLLAPSE',
      key: 1,
      t: 0,
      field: 'armL',
      message: expect.stringMatching(
        /^\[ANIM_CLIP_LIMB_COLLAPSE\] clip "Test": "armL" turns 174° between key 1 \(t 0\) and key 2 \(t 1\): add a key/,
      ),
    });
  });

  it('warns about the v1 pop: a twist jumping past 120° while the bend is over 140°', () => {
    const bent = (t: number, twist: number): ClipKey => ({ ...standing(t), armR: [50, 0, -50, 150, twist] });
    expect(codes(clipOf([bent(0, 0), bent(0.1, 130), bent(0.2, 140)]))).toEqual([['ANIM_CLIP_TWIST_POP', 1, 'armR']]);
    const straightish = (t: number, twist: number): ClipKey => ({ ...standing(t), armR: [50, 0, -50, 90, twist] });
    expect(codes(clipOf([straightish(0, 0), straightish(0.1, 170)]))).toEqual([]);
  });

  it('warns about a knee bent past 165°, or bent and turned backward', () => {
    const knee = (bend: number, twist: number) => clipOf([{ ...standing(0), legL: [0, 0, -100, bend, twist] }]);
    expect(codes(knee(170, 0))).toEqual([['ANIM_CLIP_KNEE_RANGE', 1, 'legL']]);
    expect(validateClip(knee(40, 530))[0].message).toMatch(/"legL" bends 40° with the knee turned 170° from forward/);
    expect(codes(knee(20, 180))).toEqual([]);
    expect(codes(knee(150, 100))).toEqual([]);
  });

  it('warns about an angle past ±540° and hips below the floor', () => {
    const clip = clipOf([{ ...standing(0), body: [600, 0, 0], yaw: -545, hips: [0, 0, -5] }]);
    expect(codes(clip)).toEqual([
      ['ANIM_CLIP_BELOW_FLOOR', 1, 'hips'],
      ['ANIM_CLIP_ANGLE_RANGE', 1, 'body'],
      ['ANIM_CLIP_ANGLE_RANGE', 1, 'yaw'],
    ]);
  });
});

describe('the error metrics', () => {
  it('measure the worst and the average distance between body points, the finger helpers left out', () => {
    const a = decodePose(REST, busy(0), new Float64Array(108));
    const b = Float64Array.from(a);
    b[3 * 14 + 2] += 50; // indexL, a finger helper: not counted
    expect(poseError(a, b)).toBe(0);
    b[2] += 3; // the pelvis, 3 mm up
    b[3 * 5] += 4; // the head, 4 mm forward
    expect(poseError(a, b)).toBe(4);
    expect(poseMeanError(a, b)).toBeCloseTo(7 / 32, 12);
  });
});

describe('the libraries (they need the source checkouts)', () => {
  it('parses every curated clip to itself', (context) => {
    const { sets } = legacy(context);
    for (const [setName, name, clip] of curatedClips(sets)) {
      expect(parseClip(JSON.parse(JSON.stringify(clip)), `${setName}/${name}`)).toEqual(
        JSON.parse(JSON.stringify(clip)),
      );
    }
  });

  it('parses all 11 shardfall sets unchanged, format 1 plus speed, title and legend', (context) => {
    const anim = join(requireSource('shardfall', context), 'anim');
    const sets = ['quaternius', 'mesh2motion', 'cmu', 'style100'].map((name) => `${name}.json`);
    const files = [...sets, ...readdirSync(join(anim, '100style')).map((f) => `100style/${f}`)];
    let clips = 0;
    for (const file of files) {
      const raw = readFileSync(join(anim, file), 'utf8');
      const set = parseClipSet(raw);
      expect(set).toEqual(JSON.parse(raw));
      clips += Object.keys(set.clips).length;
    }
    expect(clips).toBe(102 + 177 + 60 + 878);
  });

  it('finds the v1 pop in HERO Victory at 1.2–1.27 s, and no limb collapse in the curated library', (context) => {
    const { source, sets } = legacy(context);
    const victory = readLegacySet(source, 'hero').clips.Victory as unknown as Clip;
    const pops = validateClip(victory).filter((w) => w.code === 'ANIM_CLIP_TWIST_POP');
    expect(pops.map((w) => [w.field, w.t])).toEqual([
      ['armR', 1.2],
      ['armR', 1.233],
    ]);
    const collapses = curatedClips(sets)
      .flatMap(([, , clip]) => validateClip(clip))
      .filter((w) => w.code === 'ANIM_CLIP_LIMB_COLLAPSE');
    expect(collapses).toEqual([]);
  });
});
