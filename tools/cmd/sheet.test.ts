/**
 * @file Unit tests for `x sheet` (tools/cmd/sheet.ts): the subjects a QA id or prefix names, the ids its QA keeps
 * (`humanoid` never plays the library's clips), the frames a sheet of one state or of many draws, the usage errors,
 * and a run with `--svg`, which writes the sheet without a browser and reports its hash and the subject's `anim` QA
 * (the PNG through Chromium is the command's own run, not T1's).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADDED_MOVES, ENGINE_MOVES } from '../../engine/anim/moves-data';
import { dispatch, loadCommand, ROOT } from '../x';
import { animSheet } from '../../engine/anim/sheet';
import { createSkeleton } from '../../engine/anim/skeleton';
import { qaPrefixes, sheetFor, sheetFrames, subjectIds } from './sheet';

const commands = { sheet: () => loadCommand(ROOT, 'sheet') };

describe('subjectIds', () => {
  it('names one state, every state a prefix starts, or all of them', () => {
    expect(subjectIds('move:slash')).toEqual(['move:slash']);
    expect(subjectIds('move:')).toEqual([...Object.keys(ENGINE_MOVES), ...Object.keys(ADDED_MOVES)]);
    expect(subjectIds('humanoid').length).toBeGreaterThan(40);
    expect(subjectIds('move:slsh')).toEqual([]);
  });
});

describe('qaPrefixes', () => {
  it("keeps the subject's own QA ids: for humanoid every state of its matrix, never the blob, floater or a clip", () => {
    const keeps = (id: string) => qaPrefixes('humanoid').some((prefix) => id.startsWith(prefix));
    expect(subjectIds('humanoid').every(keeps)).toBe(true);
    for (const id of ['clip:QUATERNIUS/Swim_Idle_Loop', 'set:CMU', 'blob:bite', 'floater:rest'])
      expect(keeps(id), id).toBe(false);
    expect(qaPrefixes('move:slash')).toEqual(['move:slash']);
  });
});

describe('sheetFrames', () => {
  it('spreads one state over its hold, then shows it back at rest', () => {
    const { frames, moves } = sheetFrames('move:slash', { build: 'build:heroic', facing: 0, count: 4 });
    expect(moves).toBe(true);
    expect(frames.map((frame) => frame.label)).toEqual([
      'move:slash +0.02 s',
      'move:slash +0.15 s',
      'move:slash +0.30 s',
      'move:slash +0.43 s',
      'move:slash at rest',
    ]);
  });

  it('gives one frame per state for a prefix', () => {
    const { frames, moves } = sheetFrames('pose:', { build: 'build:chibi', facing: 1, count: 8 });
    expect(moves).toBe(false);
    expect(frames.map((frame) => frame.label)).toEqual(subjectIds('pose:'));
  });
});

describe('x sheet', () => {
  it("draws on the build's own skeleton: build:adult's bones, not the chibi default", () => {
    const { frames, sheet, drawn } = sheetFor('pose:cheer', { build: 'build:adult', facing: 0, count: 3 });
    expect(drawn.skeleton?.build.id).toBe('build:adult');
    expect(sheet.svg).toBe(animSheet(frames, { ...drawn, skeleton: createSkeleton('build:adult') }).svg);
    expect(sheet.svg).not.toBe(animSheet(frames, { ...drawn, skeleton: createSkeleton('build:chibi') }).svg);
  });

  it('writes the SVG sheet with --svg and reports it, with the subject within its anim QA baseline', async () => {
    const printed: string[] = [];
    const code = await dispatch(['sheet', 'pose:cheer', '--svg', '--frames', '3'], {
      root: ROOT,
      commands,
      print: (line) => printed.push(line),
    });
    expect(code, printed.join('\n')).toBe(0);
    const report = JSON.parse(readFileSync(join(ROOT, 'out/sheet/pose-cheer/report.json'), 'utf8'));
    expect(report.metrics).toMatchObject({ frames: 4, cameras: 3, width: 1464 });
    expect(report.metrics.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(readFileSync(join(ROOT, 'out/sheet/pose-cheer/sheet.svg'), 'utf8')).toMatch(/^<svg /);
    expect(existsSync(join(ROOT, 'out/sheet/pose-cheer/sheet.png'))).toBe(report.artifacts.length > 1);
  });

  it('refuses an unknown subject, naming the closest, a rig without a humanoid skeleton and an unknown preset', async () => {
    const printed: string[] = [];
    const print = (line: string) => printed.push(line);
    expect(await dispatch(['sheet', 'move:slsh', '--svg'], { root: ROOT, commands, print })).toBe(2);
    expect(printed.join('\n')).toMatch(/no state matches "move:slsh": did you mean move:slash\?/);
    expect(await dispatch(['sheet', 'blob:bite', '--svg'], { root: ROOT, commands, print })).toBe(2);
    expect(printed.join('\n')).toMatch(
      /blob:bite has no humanoid skeleton to draw: run node x qa anim --only blob:bite/,
    );
    expect(await dispatch(['sheet', 'move:jab', '--cams', 'tunrtable'], { root: ROOT, commands, print })).toBe(2);
    expect(printed.join('\n')).toMatch(/no camera preset "tunrtable": did you mean turntable\?/);
  });
});
