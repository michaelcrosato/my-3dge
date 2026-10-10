/**
 * @file Unit tests for the advice trap's rules (tests/setup/adviceTrap.ts): what it traps, how an entry lists a
 * warning, how the allow list is read and checked, the message an agent reads, and how it wraps the console.
 * tests/setup/harnesses.test.ts proves it fails and passes real tests in both harnesses.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ADVICE_DIR,
  describeUnlisted,
  findUnlisted,
  listing,
  loadAllowList,
  trap,
  watchConsole,
  type AllowEntry,
  type Warning,
} from './adviceTrap';

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A temporary allow-list directory holding `files` (name → content). */
function adviceDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'x-advice-'));
  temporary.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

describe('trap', () => {
  it('catches an engine advice code at any level, and names the code', () => {
    for (const level of ['warn', 'log', 'info', 'debug', 'error']) {
      expect(trap(level, '[GFX_NO_TIMESTAMP] timestamp-query is missing')).toMatchObject({
        level,
        code: 'GFX_NO_TIMESTAMP',
      });
    }
    expect(trap('log', '[X_UNKNOWN_FLAG] --verbos')?.code).toBe('X_UNKNOWN_FLAG');
  });

  it('catches every console.warn, a browser warning and a three.js deprecation at any level', () => {
    expect(trap('warn', 'anything at all')).toEqual({ level: 'warn', text: 'anything at all' });
    expect(trap('warning', 'from the page')?.level).toBe('warn');
    expect(trap('log', 'THREE.TSL: "modInt()" is deprecated. Use "mod( int( ... ) )" instead.')).toBeDefined();
    expect(trap('error', 'THREE.WebGPURenderer: .renderAsync() has been deprecated')).toBeDefined();
  });

  it('lets other output through: plain logs and errors, bracketed words that are not codes', () => {
    expect(trap('log', 'a log line')).toBeUndefined();
    expect(trap('error', 'a failure, reported by the test itself')).toBeUndefined();
    expect(trap('info', '[info] lower case is not a code')).toBeUndefined();
    expect(trap('info', '[GFX] a code needs an area and a name')).toBeUndefined();
    expect(trap('log', 'not three: THREE.X is deprecated mid-line')).toBeUndefined();
  });
});

describe('listing', () => {
  const allowed: AllowEntry[] = [
    { code: 'GFX_NO_TIMESTAMP', reason: 'SwiftShader has it, but a test removes it', file: 'a.json' },
    { code: 'THREE.Fixture: .old()', reason: 'a dependency still calls it', file: 'b.json' },
  ];

  it('lists an advice line by its exact code, never by its text', () => {
    expect(listing(trap('warn', '[GFX_NO_TIMESTAMP] gone')!, allowed)?.file).toBe('a.json');
    expect(listing(trap('warn', '[GFX_NO_TIMESTAMP_X] gone')!, allowed)).toBeUndefined();
    expect(listing(trap('warn', '[GFX_OTHER] THREE.Fixture: .old()')!, allowed)).toBeUndefined();
  });

  it('lists an uncoded warning by a text its message contains', () => {
    expect(listing(trap('warn', 'THREE.Fixture: .old() is deprecated')!, allowed)?.file).toBe('b.json');
    expect(listing(trap('warn', 'THREE.Other: .old() is deprecated')!, allowed)).toBeUndefined();
  });

  it('findUnlisted keeps the unlisted warnings, in order, with where they were printed', () => {
    const caught = findUnlisted(
      [
        { type: 'log', text: 'fine' },
        { type: 'warning', text: 'second', url: 'http://127.0.0.1:5173/tests/pages/x.ts', line: 3 },
        { type: 'warning', text: '[GFX_NO_TIMESTAMP] listed' },
        { type: 'info', text: '[GFX_NEW_THING] first' },
      ],
      allowed,
    );
    expect(caught.map((warning) => warning.text)).toEqual(['second', '[GFX_NEW_THING] first']);
    expect(caught[0].where).toBe('http://127.0.0.1:5173/tests/pages/x.ts:3');
  });
});

describe('loadAllowList', () => {
  it('reads every *.json file of the directory, in name order, and skips other files', () => {
    const dir = adviceDir({
      'b.json': '[{ "code": "B_ONE", "reason": "r" }]',
      'a.json': '[{ "code": "A_ONE", "reason": "r" }, { "code": "some text", "reason": "r" }]',
      'README.md': '# not read',
    });
    expect(loadAllowList(dir).map((entry) => entry.code)).toEqual(['A_ONE', 'some text', 'B_ONE']);
  });

  it('rejects a malformed file, naming the file, the entry and the fix', () => {
    const cases: [string, RegExp][] = [
      ['{ "code": "A_B" }', /must hold an array/],
      ['[{ "code": "A_B", "reason": "r", "why": "x" }]', /entry 1 has the unknown key "why"/],
      ['[{ "code": "A_B", "reason": "r" }, { "code": "A_C" }]', /entry 2 lacks a non-empty "reason"/],
      ['[{ "code": " ", "reason": "r" }]', /lacks a non-empty "code"/],
      ['[42]', /entry 1 is not an object/],
      ['[{ "code": ', /is not valid JSON/],
    ];
    for (const [content, message] of cases) {
      const dir = adviceDir({ 'area.json': content });
      expect(() => loadAllowList(dir)).toThrow(message);
      expect(() => loadAllowList(dir)).toThrow(/area\.json.*tests\/baselines\/advice\/README\.md/);
    }
  });

  it('reads an empty list from a missing directory, and the repository list is well formed', () => {
    expect(loadAllowList(join(tmpdir(), 'x-advice-missing-dir'))).toEqual([]);
    expect(loadAllowList(ADVICE_DIR).map((entry) => entry.code)).toContain('TRAP_LISTED');
  });
});

describe('describeUnlisted', () => {
  it('names each warning, where it was printed and the entry that would list it', () => {
    const message = describeUnlisted(
      [{ level: 'warn', text: '[GFX_NEW] x', code: 'GFX_NEW', where: 'engine/gfx/a.ts:3:1' }],
      ' during this test',
    );
    expect(message).toBe(
      '1 unlisted warning during this test: console.warn "[GFX_NEW] x" at engine/gfx/a.ts:3:1. Fix the cause, or ' +
        'list it with a reason in tests/baselines/advice/<area>.json as { "code": "GFX_NEW", "reason": "why it is ' +
        'expected" } (tests/baselines/advice/README.md)',
    );
  });

  it('shortens long messages and counts what it does not show', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ level: 'warn', text: `${i}`.repeat(200) }));
    const message = describeUnlisted(many);
    expect(message).toMatch(/^7 unlisted warnings: /);
    expect(message).toContain('...');
    expect(message).toContain('and 2 more');
  });
});

describe('watchConsole', () => {
  it('hands each trapped call to the sink with its caller, prints it, and unwraps', () => {
    const printed: unknown[][] = [];
    const target = { warn: (...args: unknown[]) => printed.push(args) } as unknown as Console;
    for (const level of ['log', 'info', 'debug', 'error'] as const) target[level] = () => {};
    const sink: Warning[] = [];
    const unwrap = watchConsole(target, (warning) => sink.push(warning));
    target.warn('[GFX_A_B] %d left', 3);
    target.log('quiet');
    unwrap();
    target.warn('after');
    expect(sink).toEqual([
      {
        level: 'warn',
        text: '[GFX_A_B] 3 left',
        code: 'GFX_A_B',
        where: expect.stringMatching(/^tests\/setup\/adviceTrap\.test\.ts:\d+:\d+$/),
      },
    ]);
    expect(printed).toEqual([['[GFX_A_B] %d left', 3], ['after']]);
  });
});
