/**
 * @file Tests the repacker (tools/anim/repack.ts, WP 8.3) on small sets built here: file names slugged from clip
 * names, a set split and joined back (exactly, key order included, once its keys are in `text()`'s order), the
 * clips' order kept through `_set.json`'s `fit`, the errors that name their fix, `catalog.tsv`, the `alt` tags,
 * writing a directory and the command line; and plain JSON sets as shardfall writes them (with the shardfall checkout,
 * else deferred: its 980 clips round-trip exactly too, for WP 8.10). The committed sets are checked by
 * tests/unit/data/anim/sets/sets.test.ts.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { clipText } from '../../engine/anim/clip/lens';
import type { Clip } from '../../engine/anim/clip/readable';
import type { ClipSet } from '../../engine/anim/clip/validate';
import { busy, REST, standing } from '../../tests/unit/anim/clip-fixtures';
import { requireSource } from '../lib/source';
import {
  CATALOG_COLUMNS,
  CATALOG_FILE,
  catalogTsv,
  clipSlug,
  joinSet,
  main,
  readPlainSet,
  readSetDir,
  SET_FILE,
  setDirName,
  type SetFiles,
  splitSet,
  tagAlternates,
  writeSetDir,
} from './repack';

/** A small set in shardfall's shape: a title, a legend, a loop with a `speed`, a name with spaces, format 2's fields. */
function demoSet(): ClipSet {
  const walk: Clip = {
    clip: 'Walk_Loop',
    src: 'LIB',
    dur: 1,
    loop: true,
    speed: 140,
    tags: ['walk'],
    desc: 'a walk',
    keys: [standing(0), busy(0.5), standing(1)],
  };
  const bow: Clip = {
    clip: 'Bow Pull Back',
    src: 'LIB',
    orig: 'OTHER/Bow_Pull',
    dur: 0.5,
    loop: false,
    tags: ['bow', 'attack'],
    desc: 'draws\tthe bow',
    events: [{ t: 0.4, name: 'hit' }],
    keys: [standing(0), { ...busy(0.5), handR: [10, 0, 5], gripR: 80 }],
  };
  const still: Clip = { clip: 'Still', dur: 0, keys: [standing(0)] };
  return {
    set: 'DEMO',
    title: 'Demo',
    format: 2,
    credit: 'made here',
    legend: ['one line'],
    fps: 30,
    sources: { LIB: { rest: REST, label: 'the library' } },
    body: null,
    fit: { Walk_Loop: [3, 9], 'Bow Pull Back': [5, 20] },
    clips: { Walk_Loop: walk, 'Bow Pull Back': bow, Still: still },
  };
}

const temp: string[] = [];
afterAll(() => {
  for (const dir of temp) rmSync(dir, { recursive: true, force: true });
});

describe('clipSlug and setDirName', () => {
  it('keep letters, digits, _ and -, turn every other run into _, and trim it from the ends', () => {
    expect(clipSlug('Walk_Loop')).toBe('Walk_Loop');
    expect(clipSlug('Bow Pull Back')).toBe('Bow_Pull_Back');
    expect(clipSlug('Two-hand Blast')).toBe('Two-hand_Blast');
    expect(clipSlug(" Rock 'n' Roll! ")).toBe('Rock_n_Roll');
    expect(clipSlug('ClimbUp_1m_RM')).toBe('ClimbUp_1m_RM');
  });

  it('refuse a name with nothing to keep, and name a set’s directory in lower case', () => {
    expect(() => clipSlug('!?')).toThrow(/rename the clip/);
    expect(setDirName('STYLE100_BACK')).toBe('style100_back');
  });
});

describe('splitSet and joinSet', () => {
  it('split a set into _set.json, catalog.tsv and one text() file per clip, and join it back', () => {
    const set = demoSet();
    const files = splitSet(set);
    expect(Object.keys(files).sort()).toEqual(
      [SET_FILE, CATALOG_FILE, 'Walk_Loop.json', 'Bow_Pull_Back.json', 'Still.json'].sort(),
    );
    expect(files['Bow_Pull_Back.json']).toBe(`${clipText(set.clips['Bow Pull Back'] as Clip)}\n`);
    expect(JSON.parse(files[SET_FILE] ?? '')).toEqual({ ...set, clips: undefined });
    const joined = joinSet(files);
    expect(joined).toEqual(set);
    expect(set).toEqual(demoSet());
    // Exact, key order included, once each key's fields are in text()'s order (busy() writes its blade last).
    expect(JSON.stringify(joined)).not.toBe(JSON.stringify(set));
    expect(Object.keys(joined.clips.Walk_Loop?.keys[1] ?? {}).indexOf('blade')).toBe(9);
    expect(JSON.stringify(joinSet(splitSet(joined)))).toBe(JSON.stringify(joined));
  });

  it('keep the clips in the order _set.json’s fit lists them, then the others by file name', () => {
    const set = demoSet();
    const reordered = { ...set, fit: { 'Bow Pull Back': [5, 20], Walk_Loop: [3, 9] } } as ClipSet;
    const files = splitSet(reordered);
    expect(Object.keys(joinSet(files).clips)).toEqual(['Walk_Loop', 'Bow Pull Back', 'Still']);
    expect(Object.keys(JSON.parse(files[SET_FILE] ?? '{}').fit)).toEqual(['Walk_Loop', 'Bow Pull Back']);
    const added = { ...files, 'Added.json': `${clipText({ clip: 'Added', dur: 0, keys: [standing(0)] })}\n` };
    expect(Object.keys(joinSet(added).clips)).toEqual(['Walk_Loop', 'Bow Pull Back', 'Added', 'Still']);
  });

  it('name each clip in its file when the set leaves it out, and refuse one filed under another name', () => {
    const set = demoSet();
    const { clip: _, ...unnamed } = set.clips.Still as Clip;
    const files = splitSet({ ...set, clips: { ...set.clips, Still: unnamed as Clip } });
    expect(JSON.parse(files['Still.json'] ?? '{}').clip).toBe('Still');
    expect(() => splitSet({ ...set, clips: { ...set.clips, Other: set.clips.Still as Clip } })).toThrow(
      /DEMO\/Other.*"clip": "Still".*rename/,
    );
  });

  it('refuse two clips whose file names clash, even in case only; _set.json is never a clip’s', () => {
    const set = demoSet();
    const twin = { ...(set.clips.Still as Clip), clip: 'still' };
    expect(() => splitSet({ ...set, clips: { ...set.clips, still: twin } })).toThrow(
      /"still" and "Still".*still\.json.*rename one/,
    );
    const odd = { ...(set.clips.Still as Clip), clip: '_set' };
    expect(Object.keys(splitSet({ ...set, fit: {}, clips: { _set: odd } })).sort()).toEqual(
      [SET_FILE, CATALOG_FILE, 'set.json'].sort(),
    );
  });

  it('refuse a clip file not named by its clip, a missing _set.json, and a clip that does not parse', () => {
    const files = splitSet(demoSet());
    const { 'Walk_Loop.json': walk = '', ...others } = files;
    const moved: SetFiles = { ...others, 'Walk.json': walk };
    expect(() => joinSet(moved, 'demo')).toThrow(/demo\/Walk\.json holds "Walk_Loop".*Walk_Loop\.json/);
    const { [SET_FILE]: _, ...headless } = files;
    expect(() => joinSet(headless, 'demo')).toThrow(/demo has no _set\.json/);
    const broken = { ...files, 'Still.json': '{"clip": "Still", "keys": [{"t": 0}]}' };
    expect(() => joinSet(broken, 'demo')).toThrow(/ANIM_CLIP_MISSING_FIELD.*demo\/Still\.json/);
  });
});

describe('catalog.tsv', () => {
  it('is three comment lines, the columns, then a row per clip in set order, trailing empty fields left off', () => {
    const lines = catalogTsv(demoSet()).split('\n');
    expect(lines[0]).toMatch(/^# DEMO's clips, generated by tools\/anim\/repack\.ts/);
    expect(lines.slice(0, 3).every((line) => line.startsWith('# ') && line.length <= 120)).toBe(true);
    expect(lines[3]?.split('\t')).toEqual([...CATALOG_COLUMNS]);
    expect(lines.slice(4)).toEqual([
      'Walk_Loop\t1\ttrue\t140\twalk\ta walk\tLIB\t\t\t3/9',
      'Bow Pull Back\t0.5\tfalse\t\tbow attack\tdraws the bow\tLIB\tOTHER/Bow_Pull\t\t5/20',
      'Still\t0',
      '',
    ]);
  });
});

describe('tagAlternates', () => {
  it('tags each clip made from another set’s clip alt, last and once, and leaves the set unchanged', () => {
    const set = demoSet();
    const tagged = tagAlternates(tagAlternates(set));
    expect(tagged.clips['Bow Pull Back']?.tags).toEqual(['bow', 'attack', 'alt']);
    expect(tagged.clips.Walk_Loop?.tags).toEqual(['walk']);
    expect(tagged.clips.Still?.tags).toBeUndefined();
    expect(set).toEqual(demoSet());
  });
});

describe('writeSetDir and readSetDir', () => {
  it('write a set’s files, remove the files it no longer has, and read them back', () => {
    const dir = mkdtempSync(join(tmpdir(), 'repack-'));
    temp.push(dir);
    writeFileSync(join(dir, 'Gone.json'), '{}\n');
    const files = splitSet(demoSet());
    expect(writeSetDir(dir, files)).toEqual({ written: Object.keys(files).sort(), removed: ['Gone.json'] });
    expect(readdirSync(dir).sort()).toEqual(Object.keys(files).sort());
    expect(readSetDir(dir)).toEqual(files);
    expect(writeSetDir(dir, files)).toEqual({ written: [], removed: [] });
    expect(readFileSync(join(dir, 'Still.json'), 'utf8')).toBe(files['Still.json']);
  });
});

describe('the command line', () => {
  it('repacks plain JSON sets into <root>/<set>/, and with --check exits 1 once a file differs', () => {
    const root = mkdtempSync(join(tmpdir(), 'repack-cli-'));
    temp.push(root);
    const path = join(root, 'demo.json');
    writeFileSync(path, JSON.stringify(demoSet()));
    const printed: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((line: string) => void printed.push(line));
    try {
      expect(main([path], root)).toBe(0);
      expect(readSetDir(join(root, 'demo'))).toEqual(splitSet(demoSet()));
      expect(main([path, '--check'], root)).toBe(0);
      writeFileSync(join(root, 'demo', 'Still.json'), '{}\n');
      expect(main(['--check', path], root)).toBe(1);
    } finally {
      log.mockRestore();
    }
    expect(printed).toEqual(['demo: 5 files, 5 written, 0 removed', 'demo: ok', 'demo: 1 file differs: Still.json']);
  });
});

describe('plain JSON sets, as shardfall writes them', () => {
  it('read through the codec’s parser, refusing an unknown field with the closest name', () => {
    const set = demoSet();
    expect(JSON.stringify(readPlainSet(JSON.stringify(set, null, 1)))).toBe(JSON.stringify(set));
    expect(() => readPlainSet(JSON.stringify({ ...set, credits: 'x' }))).toThrow(/credits.*credit/);
  });

  const SHARDFALL_SETS = ['anim/quaternius.json', 'anim/style100.json'].concat(
    ['back', 'backrun', 'idle', 'run', 'side', 'siderun'].map((gait) => `anim/100style/style100_${gait}.json`),
  );
  it('split and join back to the same object and text(), clip for clip (needs the shardfall checkout)', (context) => {
    const source = requireSource('shardfall', context);
    let clips = 0;
    for (const path of SHARDFALL_SETS) {
      const original = JSON.parse(readFileSync(join(source, path), 'utf8')) as ClipSet;
      const joined = joinSet(splitSet(readPlainSet(readFileSync(join(source, path), 'utf8'))), path);
      expect(JSON.stringify(joined), path).toBe(JSON.stringify(original));
      for (const [name, clip] of Object.entries(original.clips)) {
        expect(clipText(joined.clips[name] as Clip), `${path}: ${name}`).toBe(clipText(clip));
        clips += 1;
      }
    }
    expect(clips).toBe(102 + 878);
  });
});
