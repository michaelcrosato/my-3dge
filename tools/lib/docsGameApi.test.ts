/**
 * @file Unit tests for the guide's public API section (tools/lib/docsGameApi.ts; PLAN.md WP 12.4): the barrels' areas
 * are read in order with `export *` followed, every public value of the real barrels is named, the block between the
 * markers is replaced and nothing else, and the drift check fails a stale block or missing markers.
 * @see tools/lib/docsGameApi.ts
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ROOT } from '../x';
import { apiMap, barrelAreas, GUIDE, GUIDE_BUDGET_BYTES, guideFindings, withApiMap, writeGuide } from './docsGameApi';

const folders: string[] = [];
afterAll(() => folders.forEach((folder) => rmSync(folder, { recursive: true, force: true })));

/** A temporary root holding `files`. */
function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'docs-game-api-'));
  folders.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/** Two tiny barrels: the sim one with an `export *`, the page one re-exporting it. */
const BARRELS = {
  'engine/sim-api.ts': `/** @file sim */\n// Scenes: defined as data.\nexport { defineScene } from './sim/scene';\nexport type { Scene } from './sim/scene';\n\n// Animation: listed in anim/api.ts.\n// It goes on.\nexport * from './anim/api';\n`, // prettier-ignore
  'engine/anim/api.ts': `/** @file anim */\n// Moves: strikes as data.\nexport { defineMove } from './moves';\n`,
  'engine/index.ts': `/** @file page */\n// The sim API.\nexport * from './sim-api';\n\n// The page: createEngine.\nexport { createEngine } from './app/engine';\n`, // prettier-ignore
};

describe('the public API by area', () => {
  it('reads the areas in order, follows export *, and leaves out an area with no names of its own', () => {
    const root = repo(BARRELS);
    expect(barrelAreas(root, 'engine/sim-api.ts')).toEqual([
      { text: 'Scenes: defined as data.', values: ['defineScene'], types: ['Scene'] },
      { text: 'Moves: strikes as data.', values: ['defineMove'], types: [] },
    ]);
    const map = apiMap(root);
    expect(map).toContain('**Scenes**: defined as data.\n`defineScene`; types `Scene`.');
    expect(map).toContain('Pages only, from engine/index.ts:\n\n**The page**: createEngine.\n`createEngine`.');
    expect(map.match(/defineMove/g)).toHaveLength(1);
  });

  it('names every value the real barrels export', () => {
    const map = apiMap(ROOT);
    const names = ['engine/sim-api.ts', 'engine/anim/api.ts', 'engine/index.ts'].flatMap((file) =>
      [...readFileSync(join(ROOT, file), 'utf8').matchAll(/^export \{ (\w+) \}/gm)].map((match) => match[1]),
    );
    expect(names.length).toBeGreaterThan(300);
    expect(names.filter((name) => !map.includes(`\`${name}\``))).toEqual([]);
  });

  it('replaces the block between the markers and nothing else, and checks it', () => {
    const guide = '# Guide\n\n<!-- api-map:start: generated -->\nold\n<!-- api-map:end -->\n\nAfter.\n';
    expect(withApiMap(guide, 'new')).toBe('# Guide\n\n<!-- api-map:start: generated -->\nnew\n<!-- api-map:end -->\n\nAfter.\n'); // prettier-ignore
    expect(() => withApiMap('# Guide\n', 'new')).toThrow(/lacks its markers/);
    const root = repo({ ...BARRELS, [GUIDE]: guide });
    expect(guideFindings(root)).toMatchObject([{ id: 'DOCS_STALE', file: GUIDE }]);
    expect(writeGuide(root)).toBe(true);
    expect([guideFindings(root), writeGuide(root)]).toEqual([[], false]);
    writeFileSync(join(root, GUIDE), '# Guide without markers\n');
    expect(guideFindings(root)).toMatchObject([{ id: 'DOCS_GUIDE', message: expect.stringContaining('markers') }]);
    writeFileSync(join(root, GUIDE), 'x'.repeat(GUIDE_BUDGET_BYTES + 1));
    expect(guideFindings(root)).toMatchObject([{ id: 'DOCS_GUIDE', message: expect.stringContaining('over its') }]);
    expect(guideFindings(repo(BARRELS))).toEqual([]);
  });
});
