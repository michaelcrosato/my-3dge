/**
 * @file The library's format checks (PLAN.md §10.2, WP 8.6), rewritten from `my-3d2dge:tools/mocap-test.mjs` for
 * every clip committed under `data/anim/sets/`, offline: each clip's text reads back to the same clip; mirrored twice,
 * it prints as the original (a twist of 0 may come back as −0, and a key's fields in another order); and every frame
 * at 30 fps decodes to finite points on its own source's rest body. Through the library, an edit swapped in plays (an
 * arm raised straight up puts the fist over the shoulder), `restore` brings the capture back, and a broken edit is
 * refused with a message that names the clip, the key, its time and the field, the clip unchanged.
 *
 * @see engine/anim/clip/lens.ts
 * @see engine/anim/clip/mirror.ts
 */
import { describe, expect, it } from 'vitest';
import { clipText } from '../../../../../engine/anim/clip/lens';
import { loadClipLibrary } from '../../../../../engine/anim/clip/library';
import { mirrorClip } from '../../../../../engine/anim/clip/mirror';
import { decodePose, keyAt, POINT_INDEX, type Clip } from '../../../../../engine/anim/clip/readable';
import { parseClip } from '../../../../../engine/anim/clip/validate';
import { SET_DIRS, setOf } from '../../../anim/clip-parity';

/** Each set's clips, by `<dir>/<name>`. */
const CLIPS = SET_DIRS.flatMap((dir) =>
  Object.entries(setOf(dir).clips).map(([name, clip]) => ({ dir, name, clip, set: setOf(dir) })),
);

/** The `[f, r, z]` of `point` in a decoded pose. */
const at = (points: Float32Array, point: string) => [
  ...points.subarray(POINT_INDEX[point] * 3, POINT_INDEX[point] * 3 + 3),
];

describe('every clip of the library', () => {
  it('is 1,218 clips in ten sets', () => {
    expect([SET_DIRS.length, CLIPS.length]).toEqual([10, 1218]);
  });

  it('reads its own text back to the same clip', () => {
    const read = (name: string, clip: Clip) => JSON.stringify(parseClip(clipText(clip), name));
    const changed = CLIPS.filter(({ name, clip }) => read(name, clip) !== JSON.stringify(clip));
    expect(changed.map(({ dir, name }) => `${dir}/${name}`)).toEqual([]);
  });

  it('mirrors twice to the original', () => {
    const changed = CLIPS.filter(({ clip }) => {
      const twice = mirrorClip(mirrorClip(clip));
      return clipText({ ...twice, clip: clip.clip }) !== clipText(clip);
    });
    expect(changed.map(({ dir, name }) => `${dir}/${name}`)).toEqual([]);
  });

  it('decodes every frame at 30 fps to finite points on its source’s rest body', () => {
    const points = new Float64Array(108);
    const broken: string[] = [];
    for (const { dir, name, clip, set } of CLIPS) {
      const rest = set.sources?.[clip.src ?? '']?.rest;
      if (!rest) {
        broken.push(`${dir}/${name}: no rest body for its src ${clip.src}`);
        continue;
      }
      for (let frame = 0; frame <= clip.dur * 30 + 1e-9; frame++) {
        decodePose(rest, keyAt(clip, frame / 30), points);
        if (points.every(Number.isFinite)) continue;
        broken.push(`${dir}/${name}: frame ${frame} is not finite`);
        break;
      }
    }
    expect(broken).toEqual([]);
  });
});

describe('editing a clip through the library', () => {
  const library = loadClipLibrary(setOf('quaternius'));

  it('plays the edit: the right arm raised straight up in every key puts the fist 40 cm over the shoulder', () => {
    const edited = { ...library.clip('Idle_Loop') };
    edited.keys = edited.keys.map((key) => ({ ...key, armR: [0, 0, 100, 0, 0] }));
    library.replace('Idle_Loop', clipText(edited));
    const raised = library.sample('Idle_Loop', 0.5);
    expect(at(raised, 'fistR')[2] - at(raised, 'shR')[2]).toBeGreaterThan(400);
    expect(library.edited('Idle_Loop')).toBe(true);
    library.restore('Idle_Loop');
    const back = library.sample('Idle_Loop', 0.5);
    expect(at(back, 'fistR')[2]).toBeLessThan(at(back, 'shR')[2]);
    expect(library.edited('Idle_Loop')).toBe(false);
  });

  it('refuses a broken edit, naming the clip, the key, its time and the missing field, and keeps the clip', () => {
    const before = library.text('Idle_Loop');
    expect(() => library.replace('Idle_Loop', '{"keys":[{"t":0,"hips":[0,0,100]}]}')).toThrow(
      /\[ANIM_CLIP_MISSING_FIELD\] clip "QUATERNIUS\/Idle_Loop": key 1 \(t 0\) has no "body"/,
    );
    expect([library.text('Idle_Loop'), library.edited('Idle_Loop')]).toEqual([before, false]);
  });
});
