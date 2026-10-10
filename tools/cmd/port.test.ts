/**
 * @file Tests `x port refs` (tools/cmd/port.ts, WP 0.11). Offline: the exact JSON layout, and the checksum check
 * on a temporary directory (a changed, missing or unlisted file fails; a rewrite drops only the files it wrote), the
 * usage errors, and `--check` plus the `x check` plugin on the committed vectors. With the my-3d2dge checkout (else
 * deferred: no source): a smoke run and the determinism of a small subset, regenerated in two fresh `vm` contexts
 * and compared with each other and with the committed records, byte for byte.
 */
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { requireSource } from '../lib/source';
import { dispatch, ROOT } from '../x';
import port, {
  blobScript,
  check,
  CHECKSUMS,
  checkVectors,
  colorVectors,
  coreVectors,
  humanoidRun,
  layout,
  loadEngine,
  moveRecord,
  PORT_DIR,
  writeVectors,
} from './port';

const made: string[] = [];
afterAll(() => made.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A temporary repository root holding `files` under `PORT_DIR` with their checksums, and a package.json. */
function sandbox(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'x-port-')));
  made.push(root);
  writeVectors(join(root, PORT_DIR), files);
  writeFileSync(join(root, 'package.json'), '{ "version": "0.0.0" }\n');
  return root;
}

/** The committed JSON file `name` of `PORT_DIR`, parsed. */
const committed = (name: string) => JSON.parse(readFileSync(join(ROOT, PORT_DIR, name), 'utf8'));

describe('the layout', () => {
  it('writes every number exactly, -0 included, and parses back to the same doubles', () => {
    const numbers = [0.1 + 0.2, 1 / 3, 1e-7, 5e-324, 1e21, -1.5e-300, 2 ** 53 + 2, -0, 0];
    const text = layout(numbers);
    expect(text).toBe('[0.30000000000000004,0.3333333333333333,1e-7,5e-324,1e+21,-1.5e-300,9007199254740994,-0,0]');
    const back = JSON.parse(text) as number[];
    back.forEach((value, i) => expect(Object.is(value, numbers[i])).toBe(true));
  });

  it('keeps short containers and arrays of scalars on one line, and opens the rest', () => {
    const long = Array.from({ length: 60 }, (_, i) => i / 7);
    const text = layout({ a: { b: [1, 2] }, samples: [long, long], words: ['x', true, null] });
    const lines = text.split('\n');
    expect(lines[1]).toBe('  "a": {"b":[1,2]},');
    expect(lines[3]).toBe(`    ${JSON.stringify(long)},`);
    expect(lines.at(-2)).toBe('  "words": ["x",true,null]');
    expect(JSON.parse(text)).toEqual({ a: { b: [1, 2] }, samples: [long, long], words: ['x', true, null] });
  });

  it('refuses what JSON cannot hold exactly', () => {
    expect(() => layout([1, NaN])).toThrow('NaN');
    expect(() => layout({ v: Infinity })).toThrow('Infinity');
    expect(() => layout([undefined])).toThrow('undefined');
  });
});

describe('the checksums', () => {
  it('pass when untouched, and name each changed, missing or unlisted file', () => {
    const root = sandbox({ 'a.json': '[1]\n', 'b.json': '[2]\n', 'README.md': '# r\n' });
    expect(checkVectors(root)).toEqual({ failures: [], files: 3 });
    writeFileSync(join(root, PORT_DIR, 'a.json'), '[1.5]\n');
    rmSync(join(root, PORT_DIR, 'b.json'));
    writeFileSync(join(root, PORT_DIR, 'stray.json'), '[]\n');
    const { failures } = checkVectors(root);
    expect(failures.map((f) => [f.id, f.file])).toEqual([
      ['PORT_CHANGED', `${PORT_DIR}/a.json`],
      ['PORT_MISSING', `${PORT_DIR}/b.json`],
      ['PORT_UNLISTED', `${PORT_DIR}/stray.json`],
    ]);
    expect(failures[0].message).toMatch(/is changed: only node x port refs writes here: regenerate/);
    rmSync(join(root, PORT_DIR, CHECKSUMS));
    expect(checkVectors(root).failures.map((f) => f.id)).toContain('PORT_MISSING');
  });

  it('drop the files an earlier run wrote and no longer writes, never anything else', () => {
    const root = sandbox({ 'old.json': '[0]\n', 'kept.json': '[1]\n' });
    writeFileSync(join(root, PORT_DIR, 'foreign.txt'), 'not ours\n');
    writeVectors(join(root, PORT_DIR), { 'kept.json': '[1]\n' });
    expect(checkVectors(root).failures.map((f) => [f.id, f.file])).toEqual([
      ['PORT_UNLISTED', `${PORT_DIR}/foreign.txt`],
    ]);
    expect(() => readFileSync(join(root, PORT_DIR, 'old.json'))).toThrow();
  });
});

describe('node x port', () => {
  const print = () => {};
  it('checks the committed vectors offline, as the x check plugin does', async () => {
    expect(await dispatch(['port', 'refs', '--check'], { print })).toBe(0);
    expect(await check.run({ root: ROOT, lane: false })).toEqual({ failures: [] });
    expect(committed(CHECKSUMS).files).toHaveProperty(['humanoid-chibi.json']);
  });

  it('is a usage error without refs', async () => {
    const [root, commands] = [sandbox({}), { port: async () => port }];
    expect(await dispatch(['port'], { root, commands, print })).toBe(2);
    expect(await dispatch(['port', 'clips'], { root, commands, print })).toBe(2);
    expect(await dispatch(['port', 'refs', '--chek'], { root, commands, print })).toBe(2);
  });
});

describe('the vectors (they need the my-3d2dge checkout)', () => {
  it('load the engine with no message, and refuse unseeded randomness', (context) => {
    const engine = loadEngine(requireSource('my-3d2dge', context));
    expect(() => new engine.E.Humanoid({})).toThrow('Math.random was called before a record seeded it');
    engine.seed('smoke');
    expect(Object.keys(new engine.E.Humanoid({}).J)).toContain('handR');
    expect(engine.messages).toEqual([]);
  });

  it('regenerate a subset byte for byte, in fresh contexts, as committed', (context) => {
    const source = requireSource('my-3d2dge', context);
    const subset = () => {
      const engine = loadEngine(source);
      const records = [
        humanoidRun(engine, 'chibi', 'walk', 0),
        humanoidRun(engine, 'heroic', 'pose-wave', 3),
        moveRecord(engine, 'bulky', 'roundhouse', 'active'),
        blobScript(engine, 'hop'),
      ];
      return { texts: [...records, coreVectors(engine), colorVectors(engine)].map((r) => layout(r)), engine };
    };
    const [first, second] = [subset(), subset()];
    expect(second.texts).toEqual(first.texts);
    expect(first.engine.messages).toEqual([]);
    const chibi = committed('humanoid-chibi.json').runs.find((r: { state: string }) => r.state === 'walk');
    const heroic = committed('humanoid-heroic.json').runs.find(
      (r: { state: string; facing: number }) => r.state === 'pose-wave' && r.facing === 3,
    );
    const move = committed('moves.json').records.find(
      (r: { build: string; move: string; phase: string }) =>
        r.build === 'bulky' && r.move === 'roundhouse' && r.phase === 'active',
    );
    const hop = committed('blob.json').scripts[0];
    const files = [chibi, heroic, move, hop, committed('core.json'), committed('color.json')];
    expect(files.map((r) => layout(r))).toEqual(first.texts);
  });
});
