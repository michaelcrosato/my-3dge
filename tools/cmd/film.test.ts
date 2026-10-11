/**
 * @file Unit tests for `x film`'s Node half (tools/cmd/film.ts), without a browser: the step script (every verb, the
 * whole run filmed when the script never shoots, the errors), the comparison of two frames (no difference between
 * equal frames; a change attributed to the object it touched, whether it was recoloured or moved, with the
 * thumbnail's map deciding between overlapping boxes; empty space; frames of another size), the verdict (a
 * difference on unchanged sources fails, on changed sources it warns; a base without the page or scene is "no
 * baseline", never a failure), the contact sheet's layout, labels and diff row, the thumbnail baselines, the
 * temporary worktree, and the usage errors raised before any browser starts. The browser half is proven by
 * `node x film labs/box --scene room --steps "step 60" --compare HEAD` (WP 3.11's Verify). The comparison and the
 * thumbnails are tools/lib/filmCompare.ts, the sheet tools/lib/filmSheet.ts.
 * @see tools/cmd/film.ts
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { IdEntry } from '../../engine/gfx/idpass';
import { thumbnail } from '../../engine/gfx/thumbnail';
import { dispatch, loadCommand, ROOT } from '../x';
import {
  checkFilmThumbs,
  compareFilmThumbs,
  compareFrames,
  EMPTY,
  judgeCompare,
  type FilmFrame,
} from '../lib/filmCompare';
import { contactSheet, drawText, LABEL, MAGENTA } from '../lib/filmSheet';
import { addWorktree, hasFile, parseSteps, removeWorktree, resolveRef, sameSources, SHOT, simSteps } from './film';

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A new empty directory, removed after the test. */
function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'x-film-')));
  temporary.push(dir);
  return dir;
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=x@x', '-c', 'user.name=x', ...args], { cwd, stdio: 'pipe', encoding: 'utf8' });

/** A temporary git repository with `files` committed, and a node_modules/ (ignored) holding three/. */
function repository(files: Record<string, string>): string {
  const root = tempDir();
  git(root, 'init', '-q');
  for (const [path, text] of Object.entries({ '.gitignore': 'node_modules/\nout/\n', ...files })) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  mkdirSync(join(root, 'node_modules', 'three'), { recursive: true });
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'fixture');
  return root;
}

describe('parseSteps', () => {
  it('films the whole run when the script never shoots: the first frame, then each step in up to 8 even parts', () => {
    const film = parseSteps('step 60');
    expect(film.filter((s) => s.verb === 'shot')).toHaveLength(9);
    expect(film.flatMap((s) => (s.verb === 'step' ? s.args : []))).toEqual(['8', '7', '8', '7', '8', '7', '8', '7']);
    expect(parseSteps('step 2')).toEqual([SHOT, simSteps(1), SHOT, simSteps(1), SHOT]);
    const hold = { verb: 'hold', member: 'input.hold', args: ['sprint', true] };
    expect(parseSteps('hold sprint step')).toEqual([SHOT, hold, simSteps(1), SHOT]);
  });

  it('reads every verb as the __engine call it makes; spaces, semicolons and new lines separate them', () => {
    const script = 'hold sprint; axis move 0,1 rec 3 2\npress jump step shot release sprint axis move none\n'.concat(
      'axis cam 0.5 cam topdown cam cam3=orbit set box.room.speed=3 set a=b=c',
    );
    const call = (verb: string, member: string, ...args: unknown[]) => ({ verb, member, args });
    expect(parseSteps(script)).toEqual([
      call('hold', 'input.hold', 'sprint', true),
      call('axis', 'input.axis', 'move', [0, 1]),
      ...[SHOT, simSteps(2), SHOT, simSteps(2), SHOT],
      call('press', 'input.press', 'jump'),
      ...[simSteps(1), SHOT],
      call('release', 'input.hold', 'sprint', false),
      call('axis', 'input.axis', 'move', null),
      call('axis', 'input.axis', 'cam', 0.5),
      call('cam', 'camera.set', 'cam=topdown'),
      call('cam', 'camera.set', 'cam3=orbit'),
      call('set', 'set', 'box.room.speed', '3'),
      call('set', 'set', 'a', 'b=c'),
    ]);
  });

  it('names a step it cannot read, with the closest verb or the form it takes', () => {
    expect(() => parseSteps('stpe 3')).toThrow('there is no step "stpe": did you mean step?');
    expect(() => parseSteps('wobble')).toThrow('there is no step "wobble": steps are step, shot, rec, press');
    expect(() => parseSteps('press')).toThrow('press takes <action>');
    expect(() => parseSteps('press step 3')).toThrow('press takes <action>');
    expect(() => parseSteps('rec')).toThrow('rec takes <n> [every], whole numbers ≥ 1');
    expect(() => parseSteps('step 0')).toThrow('step takes [n], whole numbers ≥ 1');
    expect(() => parseSteps('axis move up')).toThrow('axis takes <name> <x,y|none>');
    expect(() => parseSteps('axis step 1')).toThrow('axis takes <name> <x,y|none>');
    expect(() => parseSteps('axis move 1,,2')).toThrow('axis takes <name> <x,y|none>');
    expect(() => parseSteps('set speed')).toThrow('set takes <key=value>');
    expect(() => parseSteps(' ; \n')).toThrow('--steps has no steps');
  });
});

/** An object of a test frame: its name, colour, and the pixels it covers. */
interface Part {
  name: string;
  colour: number[];
  covers: (x: number, y: number) => boolean;
}

const ground: Part = { name: 'ground', colour: [40, 120, 40], covers: () => true };
const wall: Part = { name: 'wall', colour: [90, 90, 90], covers: (x, y) => x >= 20 && y < 10 };
/** A pillar `w` pixels wide from column `x`, rows 5–14. */
const pillar = (x = 5, w = 5, colour = [200, 0, 0]): Part => ({
  name: 'pillar',
  colour,
  covers: (px, py) => px >= x && px < x + w && py >= 5 && py < 15,
});

/**
 * A 40 × 20 frame of `parts`, the first in front, as the ID pass sees it: each visible object's exact pixel count
 * and box, and the thumbnail with its map. Pixels no part covers are transparent black (empty space).
 */
function frame(n: number, parts: Part[], size: [number, number] = [40, 20]): FilmFrame {
  const [width, height] = size;
  const rgba = new Uint8Array(width * height * 4);
  const owners = new Uint32Array(width * height);
  const seen = parts.map(() => ({ px: 0, bbox: [Infinity, Infinity, -1, -1] as IdEntry['bbox'] }));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = parts.findIndex((part) => part.covers(x, y));
      if (k < 0) continue;
      const s = seen[k];
      s.px++;
      s.bbox = [Math.min(s.bbox[0], x), Math.min(s.bbox[1], y), Math.max(s.bbox[2], x), Math.max(s.bbox[3], y)];
      rgba.set([...parts[k].colour, 255], (y * width + x) * 4);
      owners[y * width + x] = k + 1;
    }
  }
  const visible = parts
    .map(({ name }, k) => ({
      id: k + 1,
      name,
      px: seen[k].px,
      share: seen[k].px / (width * height),
      bbox: seen[k].bbox,
    }))
    .filter((e) => e.px > 0)
    .map((e) => ({ ...e, centre: [e.bbox[0], e.bbox[1]] as [number, number] }));
  const ids = { pixels: owners, names: parts.map((part) => part.name) };
  return { n, tick: n * 10, width, height, rgba, visible, thumbnail: thumbnail(rgba, width, height, ids) };
}

/** The same frame without the thumbnail's map, as a page without an ID pass would give it. */
const unmapped = (f: FilmFrame): FilmFrame => ({ ...f, thumbnail: thumbnail(f.rgba, f.width, f.height) });

describe('compareFrames', () => {
  const room = (n: number, front = pillar()) => frame(n, [front, wall, ground]);

  it('finds no difference between equal frames', () => {
    expect(compareFrames(room(0), room(0))).toEqual({ n: 0, tick: 0, px: 0, objects: {}, changed: [] });
  });

  it('attributes a recoloured object every pixel it changed: its box is the smallest that holds them', () => {
    expect(compareFrames(room(1), room(1, pillar(5, 5, [0, 0, 200])))).toEqual({
      ...{ n: 1, tick: 10, px: 50, objects: { pillar: 50 }, changed: [] },
    });
  });

  it('gives a moved object the pixels it left and took, though what it covered and uncovered changed too', () => {
    const diff = compareFrames(room(2), room(2, pillar(17)));
    expect(diff.px).toBe(100);
    expect(diff.objects).toEqual({ pillar: 100 });
    expect(diff.changed).toEqual([
      { name: 'pillar', a: '50 px at 5,5,9,14', b: '50 px at 17,5,21,14' },
      { name: 'wall', a: '200 px at 20,0,39,9', b: '190 px at 20,0,39,9' },
      { name: 'ground', a: '550 px at 0,0,39,19', b: '560 px at 0,0,39,19' },
    ]);
  });

  it("lets the thumbnail's map decide between overlapping boxes, and names empty space", () => {
    const pole: Part = { name: 'pole', colour: [250, 250, 0], covers: (x, y) => x === y + 21 && y >= 1 && y <= 9 };
    const repainted = { ...wall, colour: [30, 30, 140] };
    const [a, b] = [frame(3, [pole, wall, ground]), frame(3, [pole, repainted, ground])];
    // 200 wall pixels less the pole's 9; 72 of them lie inside the pole's box [22,1,30,9].
    expect(compareFrames(a, b).objects).toEqual({ wall: 191 });
    expect(compareFrames(unmapped(a), unmapped(b)).objects).toEqual({ wall: 119, pole: 72 });
    const sky = frame(4, [pillar()]);
    const night = { ...sky, rgba: sky.rgba.map((v, i) => (i % 4 === 2 && sky.rgba[i + 1] === 0 ? 90 : v)) };
    expect(compareFrames(sky, night).objects).toEqual({ [EMPTY]: 750 });
  });

  it('reports a frame of another size, or one the base lacks, without comparing pixels', () => {
    const small = frame(5, [ground], [20, 20]);
    expect(compareFrames(room(5), small)).toMatchObject({ px: -1, objects: {}, size: '40×20 against 20×20' });
    expect(compareFrames(room(5), undefined)).toMatchObject({ px: -1, size: 'missing in the base' });
  });
});

describe('judgeCompare', () => {
  const room = (n: number, front = pillar()) => frame(n, [front, wall, ground]);
  const same = [compareFrames(room(0), room(0)), compareFrames(room(1), room(1))];
  const moved = [same[0], compareFrames(room(1), room(1, pillar(17)))];

  it('says "same" when every frame matches', () => {
    expect(judgeCompare({ ref: 'HEAD', diffs: same, unchanged: true })).toEqual({
      ...{ verdict: 'same', failures: [], warnings: [], objects: [] },
    });
  });

  it('fails a difference when the sources are unchanged (the film does not repeat), and warns otherwise', () => {
    const failed = judgeCompare({ ref: 'HEAD', diffs: moved, unchanged: true });
    expect(failed.verdict).toBe('differs');
    expect(failed.failures.map((f) => f.id)).toEqual(['FILM_NOT_REPEATABLE']);
    expect(failed.failures[0].message).toContain("although this tree's sources are HEAD's");
    const changed = judgeCompare({ ref: 'HEAD', diffs: moved, unchanged: false });
    expect(changed.failures).toEqual([]);
    expect(changed.warnings).toHaveLength(1);
    expect(changed.warnings[0]).toMatchObject({ id: 'FILM_CHANGED' });
    expect(changed.warnings[0].message).toContain('1 of 2 frames differ from HEAD (100 px): pillar 100 px');
    expect(changed.objects).toEqual([{ name: 'pillar', px: 100, frames: [1], coverage: 'changed' }]);
    const diffs = [compareFrames(room(2), room(2, pillar(5, 5, [9, 9, 9])))];
    const recoloured = judgeCompare({ ref: 'v1', diffs, unchanged: false });
    expect(recoloured.objects).toEqual([{ name: 'pillar', px: 50, frames: [2], coverage: 'same' }]);
  });

  it('reports "no baseline" as a warning, a deferred proof rather than a failure', () => {
    const none = judgeCompare({ ref: 'HEAD', none: 'HEAD has no scene "new" in labs/box', unchanged: true });
    const message = 'no baseline: HEAD has no scene "new" in labs/box; the comparison is a deferred proof';
    const warnings = [{ id: 'FILM_NO_BASELINE', message }];
    expect(none).toEqual({ verdict: 'no baseline', failures: [], warnings, objects: [] });
  });
});

describe('the contact sheet', () => {
  const room = (n: number, front = pillar()) => frame(n, [front, wall, ground]);
  /** The RGB of the sheet's pixel (x, y). */
  const at = (sheet: { width: number; rgba: Uint8Array }, x: number, y: number) => [
    ...sheet.rgba.subarray((y * sheet.width + x) * 4, (y * sheet.width + x) * 4 + 3),
  ];

  it('lays frames out in columns, each with its label under it', () => {
    const sheet = contactSheet([room(0), room(1), room(2)], { cols: 2 });
    expect([sheet.width, sheet.height]).toEqual([2 * (40 + 4) + 4, 2 * (20 + LABEL + 4) + 4]);
    expect(at(sheet, 4, 4)).toEqual([40, 120, 40]); // the first frame's top-left pixel: the ground
    expect(at(sheet, 4 + 5, 4 + 5)).toEqual([200, 0, 0]); // the pillar's top-left pixel
    const label = new Set<string>();
    for (let y = 4 + 20; y < 4 + 20 + LABEL; y++) for (let x = 4; x < 44; x++) label.add(at(sheet, x, y).join());
    expect(label).toEqual(new Set(['27,27,36', '200,200,224'])); // the background and the label's ink
    expect(contactSheet([room(0)], { cols: 8 }).width).toBe(40 + 8); // one frame: one column
  });

  it('adds the base row and a diff row with each changed pixel in magenta', () => {
    const a = [room(0), room(1)];
    const b = [room(0), room(1, pillar(5, 5, [0, 0, 200]))];
    const diffs = a.map((f, i) => compareFrames(f, b[i]));
    const sheet = contactSheet(a, { cols: 2, base: b, diffs });
    expect(sheet.height).toBe(3 * (20 + LABEL + 4) + 4);
    const diffRow = 4 + 2 * (20 + LABEL + 4);
    expect(at(sheet, 4 + 44 + 5, diffRow + 5)).toEqual([...MAGENTA]); // frame 1's pillar
    expect(at(sheet, 4 + 5, diffRow + 5)).toEqual([42, 42, 42]); // frame 0's pillar, the same: grey
    expect(at(sheet, 4 + 44, 4 + 20 + LABEL + 4 + 5)).toEqual([40, 120, 40]); // B's frame 1
    let magenta = 0;
    for (let p = 0; p < sheet.rgba.length; p += 4)
      if (MAGENTA.every((v, c) => sheet.rgba[p + c] === v) && p % (sheet.width * 4) >= 48 * 4) magenta++;
    expect(magenta).toBeGreaterThan(50); // the pillar's 50 pixels and the label "50 PX DIFFER: PILLAR"
  });

  it('draws text in a 3 × 5 pixel font at twice its size, upper case, unknown characters as "?"', () => {
    const sheet = { width: 24, height: 10, rgba: new Uint8Array(24 * 10 * 4) };
    drawText(sheet, [0, 0], '1t~', [255, 255, 255]);
    const glyph = (k: number) =>
      [0, 1, 2, 3, 4].map((row) => [0, 1, 2].map((col) => (at(sheet, k * 8 + col * 2, row * 2)[0] ? 1 : 0)).join(''));
    expect(glyph(0)).toEqual(['010', '110', '010', '010', '111']);
    expect(glyph(1)).toEqual(['111', '010', '010', '010', '010']);
    expect(glyph(2)).toEqual(['111', '001', '010', '000', '010']);
    expect(at(sheet, 3, 1)).toEqual([255, 255, 255]); // each font pixel is 2 × 2
    drawText(sheet, [0, 0], '888', [9, 9, 9], 4);
    expect([at(sheet, 2, 0), at(sheet, 4, 0)]).toEqual([
      [9, 9, 9],
      [0, 0, 0],
    ]); // cut before x 4
  });
});

describe('the thumbnail baselines', () => {
  const room = (n: number, front = pillar()) => frame(n, [front, wall, ground]);
  const film = [room(0), room(1)];

  it('count the cells that moved in each frame, and a different number of frames', () => {
    const expected = film.map((f) => ({ tick: f.tick, ...f.thumbnail! }));
    expect(compareFilmThumbs(expected, film)).toEqual([]);
    const moved = compareFilmThumbs(expected, [room(0), room(1, pillar(17))]);
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatch(/^frame 1 \(tick 10\): \d+ cells moved, worst \(\d+,\d+\) [0-9a-f]{6}→[0-9a-f]{6}/);
    expect(compareFilmThumbs(expected, [room(0)])).toEqual(['the film has 1 frames, the baseline 2']);
  });

  it('are recorded with --update, then compared; a missing baseline fails', async () => {
    const root = tempDir();
    mkdirSync(join(root, 'tests', 'baselines', 'thumbs'), { recursive: true });
    expect((await checkFilmThumbs(root, 'room', film, false)).failures.map((f) => f.id)).toEqual(['FILM_NO_THUMB']);
    const recorded = await checkFilmThumbs(root, 'room', film, true);
    expect(recorded.lines).toEqual(['thumbnails recorded: tests/baselines/thumbs/room.json']);
    const saved = JSON.parse(readFileSync(join(root, 'tests', 'baselines', 'thumbs', 'room.json'), 'utf8'));
    expect(saved).toMatchObject({ case: 'room', frames: [{ tick: 0, width: 48, height: 27 }, { tick: 10 }] });
    expect(await checkFilmThumbs(root, 'room', film, false)).toEqual({
      ...{ lines: ['thumbnails: every frame matches tests/baselines/thumbs/room.json'], failures: [] },
    });
    const moved = await checkFilmThumbs(root, 'room', [room(0), room(1, pillar(17))], false);
    expect(moved.failures).toMatchObject([{ id: 'FILM_THUMB_MOVED', file: 'tests/baselines/thumbs/room.json' }]);
  });
});

describe('the base worktree', () => {
  it('resolves a ref, tells whether a commit has a file and whether the tree still matches it', () => {
    const root = repository({ 'labs/box/index.html': '<!doctype html>' });
    const head = resolveRef(root, 'HEAD');
    expect(head).toMatch(/^[0-9a-f]{40}$/);
    expect(() => resolveRef(root, 'nosuchref')).toThrow('--compare nosuchref names no commit');
    expect([hasFile(root, head, 'labs/box/index.html'), hasFile(root, head, 'labs/new/index.html')]).toEqual([
      true,
      false,
    ]);
    expect(hasFile(root, head, 'labs/box')).toBe(false); // a directory is not a page
    expect(sameSources(root, head)).toBe(true);
    writeFileSync(join(root, 'out.log'), 'ignored? no: only out/ is');
    expect(sameSources(root, head)).toBe(false);
    rmSync(join(root, 'out.log'));
    mkdirSync(join(root, 'out'));
    writeFileSync(join(root, 'out', 'report.json'), '{}');
    expect(sameSources(root, head)).toBe(true);
    writeFileSync(join(root, 'labs', 'box', 'index.html'), '<!doctype html><p>');
    expect(sameSources(root, head)).toBe(false);
  });

  it('checks the commit out under out/film/ with this tree node_modules linked, and removes it whole', () => {
    const root = repository({ 'labs/box/index.html': 'first' });
    const first = resolveRef(root, 'HEAD');
    writeFileSync(join(root, 'labs', 'box', 'index.html'), 'second');
    const dir = addWorktree(root, first);
    expect(dir.startsWith(join(root, 'out', 'film', 'base-'))).toBe(true);
    expect(readFileSync(join(dir, 'labs', 'box', 'index.html'), 'utf8')).toBe('first');
    expect(readlinkSync(join(dir, 'node_modules'))).toBe(join(root, 'node_modules'));
    expect(git(root, 'worktree', 'list').trim().split('\n')).toHaveLength(2);
    removeWorktree(root, dir);
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(join(root, 'node_modules', 'three'))).toBe(true);
    expect(git(root, 'worktree', 'list').trim().split('\n')).toHaveLength(1);
    // A worktree left by a run that was killed is replaced, not an error.
    const again = addWorktree(root, first);
    expect(addWorktree(root, first)).toBe(again);
    removeWorktree(root, again);
  });
});

describe('x film usage', () => {
  /** Runs `node x film <args>` in `root`; returns the exit code and the printed lines. */
  async function film(root: string, ...args: string[]) {
    const lines: string[] = [];
    const commands = { film: () => loadCommand(ROOT, 'film') };
    const code = await dispatch(['film', ...args], { root, print: (line) => lines.push(line), commands });
    return { code, text: lines.join('\n') };
  }

  it('refuses bad arguments before any browser starts (exit 2)', async () => {
    const root = repository({ 'labs/box/index.html': '<!doctype html>', 'package.json': '{ "version": "0.0.0" }' });
    const usage = async (args: string[], message: string) =>
      expect(await film(root, ...args)).toMatchObject({ code: 2, text: expect.stringContaining(message) });
    await usage([], 'name a page');
    await usage(['labs/nope'], 'there is no labs/nope/index.html');
    await usage(['labs/box', '--steps', 'jump'], 'there is no step "jump"');
    await usage(['labs/box', '--cols', 'two'], '--cols takes a whole number ≥ 1');
    await usage(['labs/box', '--update'], '--update records thumbnails');
    await usage(['labs/box', '--thumb', 'Room'], '--thumb takes a case name');
    await usage(['labs/box', '--compare', 'nosuchref'], '--compare nosuchref names no commit');
    await usage(['labs/box', '--set', 'speed'], '--set takes key=value');
  });
});
