/**
 * @file Smoke and unit tests for `x describe` (tools/cmd/describe.ts): the modules that register content are found by
 * their calls (comments, strings, declarations, tests, `defineCodes`, `defineProperty` and `defineConfig` aside), a
 * module that fails to load is a warning, kinds declared in fixture modules are listed by a child process without
 * editing the command (a module's timers and side effects never reach the command; one that never finishes loading
 * is named), the three listings print and write `describe.json`, the engine's actions are listed (tools define them)
 * and the labs' own beside them, an entry is found as `kind:name` alone or by its name without the kind's prefix, a
 * listing with a line cut short ends naming `describe.json`, and an unknown kind or id is a usage error naming the
 * closest.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { registry } from '../../engine/core/registry';
import { CHILD_TIMEOUT_MS, dispatch, loadCommand, ROOT, type Command } from '../x';
import {
  createDescribeCommand,
  describeFile,
  fieldLine,
  idsLine,
  loadRegistrations,
  registrationModules,
  type HangWatch,
} from './describe';

/** Imports the shared registry from a fixture module in a temporary directory. */
const REGISTRY = JSON.stringify(join(realpathSync(ROOT), 'engine/core/registry.ts'));
const SETTINGS = JSON.stringify(join(realpathSync(ROOT), 'engine/core/settings.ts'));

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A temporary repository holding `files`, its modules ES modules as this repository's are. */
function repository(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'x-describe-')));
  temporary.push(root);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.0.0', type: 'module' }));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

/** Runs `node x describe …` against `root` (the listing in its child process); resolves to the exit code and lines. */
async function run(root: string, ...args: string[]): Promise<{ code: number; lines: string[] }> {
  return runWith(() => loadCommand(ROOT, 'describe'), root, ...args);
}

/** `run` with the command built by `load`. */
async function runWith(load: () => Promise<Command>, root: string, ...args: string[]) {
  const lines: string[] = [];
  const code = await dispatch(['describe', ...args], {
    root,
    commands: { describe: load },
    print: (line) => lines.push(line),
  });
  return { code, lines };
}

describe('registrationModules', () => {
  it('finds modules that call def or a define function, and skips tests, declarations and defineCodes', () => {
    const root = repository({
      'engine/a/kind.ts': "defineKind('demo', { description: 'x', fields: {} });\n",
      'labs/box/props.ts': "registry.def('demo', 'demo:a', {});\n",
      'labs/box/kinds.ts': "registry.defineKind('more', { description: 'x', fields: {} });\n",
      'fixtures/scenes/kernel/scene.ts': "export default defineScene('kernel', {});\n",
      'engine/a/codes.ts': "export const C = defineCodes('a', {});\n",
      'engine/a/schema.ts': 'export const S = defineSchema({});\n',
      'engine/a/decl.ts': 'export function defineThing() {}\nexport function def() {}\n',
      'engine/a/other.ts': 'undef(1); redefine(2);\n',
      'engine/a/kind.test.ts': "defineKind('t', {});\n",
      'tests/e2e/x.ts': "defineKind('t', {});\n",
    });
    expect(registrationModules(root)).toEqual([
      'engine/a/kind.ts',
      'fixtures/scenes/kernel/scene.ts',
      'labs/box/kinds.ts',
      'labs/box/props.ts',
    ]);
  });

  it('skips calls in comments and strings, defineProperty and defineConfig', () => {
    const root = repository({
      'engine/a/comment.ts':
        "// def('x', 'y', {}) once the page is up\n/* defineKind('z', {}) */\nexport const a = 1;\n",
      'engine/a/text.ts': "export const help = `call defineKind('k', { … }) or def('k', 'k:a', {})`;\n",
      'engine/a/property.ts':
        "Object.defineProperty(globalThis, 'x', { value: 1 });\nObject.defineProperties({}, {});\nReflect.defineProperty({}, 'y', {});\n",
      'engine/a/bare.ts': "const { defineProperty } = Object;\ndefineProperty({}, 'z', {});\n",
      'labs/box/vite.config.ts': "import { defineConfig } from 'vite';\nexport default defineConfig({});\n",
      'labs/box/kind.ts': "// the one real call:\ndefineKind('box', { description: 'x', fields: {} });\n",
    });
    expect(registrationModules(root)).toEqual(['labs/box/kind.ts']);
  });

  it('finds the settings module in this repository', () => {
    expect(registrationModules(ROOT)).toContain('engine/core/settings.ts');
  });

  it('turns a module that fails to load into a warning naming it', async () => {
    const root = repository({
      'labs/page/main.ts': "throw new Error('document is not defined');\ndef('x', 'y', {});\n",
    });
    const { loaded, warnings } = await loadRegistrations(root);
    expect(loaded).toEqual([]);
    expect(warnings).toEqual([
      expect.objectContaining({
        id: 'DESCRIBE_LOAD',
        file: 'labs/page/main.ts',
        message: expect.stringContaining('document is not defined'),
      }),
    ]);
  });
});

describe('x describe', { timeout: CHILD_TIMEOUT_MS }, () => {
  it('lists every kind of this repository, settings included, and writes describe.json', async () => {
    const { code, lines } = await run(ROOT);
    expect(code).toBe(0);
    expect(lines[0]).toMatch(/^x describe: ok: \d+ kinds, \d+ entries$/);
    // Past about 20 lines the printed listing is cut (kinds go in name order, `setting` near the end); the cut line
    // names output.txt, which holds every line.
    const cut = lines.find((line) => line.startsWith('… '));
    const listed = cut ? readFileSync(join(ROOT, 'out/describe/all/output.txt'), 'utf8').split('\n') : lines;
    expect(cut === undefined || cut.endsWith('out/describe/all/output.txt')).toBe(true);
    expect(listed.some((line) => line.startsWith('setting ('))).toBe(true);
    const data = JSON.parse(readFileSync(join(ROOT, 'out/describe/all/describe.json'), 'utf8'));
    expect(data.kinds.map((row: { kind: string }) => row.kind)).toContain('setting');
  });

  it('lists a kind declared anywhere, its fields and ids, without the command naming it', async () => {
    const root = repository({
      'engine/gadgets.ts': `import { defineKind } from ${REGISTRY};
const gadgets = defineKind('testGadget', {
  description: 'A test-only kind.',
  fields: {
    size: { type: 'number', default: 1, minimum: 0, maximum: 9, unit: 'm', description: 'Its size.' },
    mode: { type: 'string', enum: ['a', 'b'], default: 'a', description: 'Its mode.' },
  },
});
gadgets.def('testGadget:big', { size: 8 });
gadgets.def('testGadget:small', {});
`,
    });
    const all = await run(root);
    expect(all.lines).toContain('testGadget (2): A test-only kind.');
    const kind = await run(root, 'testGadget');
    expect(kind.code).toBe(0);
    expect(kind.lines).toEqual([
      'x describe: ok: testGadget: 2 fields, 2 entries',
      'A test-only kind.',
      'ids: testGadget:big, testGadget:small',
      '  size: number, = 1, 0..9, m: Its size.',
      '  mode: string, = "a", one of "a"|"b": Its mode.',
      'report: out/describe/testGadget/report.json',
    ]);
    const entry = await run(root, 'testGadget', 'testGadget:big');
    expect(entry.lines.slice(0, 3)).toEqual([
      'x describe: ok: testGadget "testGadget:big": 1 of 2 fields differ from the default',
      '* size = 8',
      '  mode = "a"',
    ]);
    expect(existsSync(join(root, 'out/describe/testGadget-testGadget-big/describe.json'))).toBe(true);
    for (const asked of [['testGadget:big'], ['testGadget', 'big']]) {
      const same = await run(root, ...asked);
      expect([same.code, ...same.lines.slice(0, 3)], asked.join(' ')).toEqual([0, ...entry.lines.slice(0, 3)]);
    }
    expect(registry.kinds()).not.toContain('testGadget');
  });

  it('ends a listing whose line is cut short naming describe.json, where the whole text is', async () => {
    const long = 'A field whose description runs on and on, '.repeat(5);
    const root = repository({
      'engine/long.ts': `import { defineKind } from ${REGISTRY};
defineKind('testLong', { description: 'Long.', fields: { text: { type: 'string', default: '', description: ${JSON.stringify(long)} } } });
defineKind('testShort', { description: 'Short.', fields: { size: { type: 'number', default: 1, description: 'Its size.' } } });
`,
    });
    const { code, lines } = await run(root, 'testLong');
    expect(code).toBe(0);
    expect(lines.find((line) => line.startsWith('  text:'))).toMatch(/\.\.\.$/);
    expect(lines.at(-2)).toBe('(a line above is cut short: the whole text is in out/describe/testLong/describe.json)');
    const data = JSON.parse(readFileSync(join(root, 'out/describe/testLong/describe.json'), 'utf8'));
    expect(data.fields[0].description).toBe(long);
    const short = await run(root, 'testShort'); // nothing cut: no notice
    expect([short.code, short.lines.some((line) => line.includes('cut short'))]).toEqual([0, false]);
  });

  it("lists the engine's actions, which tools define from data/anim/actions/ (the engine cannot import data/), and the labs' own", async () => {
    const { code } = await run(ROOT, 'action');
    expect(code).toBe(0);
    const data = JSON.parse(readFileSync(join(ROOT, 'out/describe/action/describe.json'), 'utf8')) as { ids: string[] };
    const files = readdirSync(join(ROOT, 'data/anim/actions')).filter((file) => file.endsWith('.json'));
    const fromData = files.map((file) => `action:${file.slice(0, -'.json'.length)}`);
    expect(data.ids).toEqual(
      expect.arrayContaining([...fromData, 'action:backflip', 'action:charge', 'action:deathSpin']),
    );
    // besides the data's, only what a lab defines in code: the playground's neighbours sit (labs/playground/cast/neighbours.ts)
    expect(data.ids.filter((id) => !fromData.includes(id))).toEqual(['action:sit']);
  });

  it('describes a setting from the schema it was declared with', async () => {
    const root = repository({
      'engine/speed.ts': `import { defineSettings } from ${SETTINGS};
defineSettings({ 'test.speed': { type: 'number', default: 2, unit: 'm/s', when: 'spawn', description: 'Speed.' } });
`,
    });
    const { code, lines } = await run(root, 'setting', 'test.speed');
    expect(code).toBe(0);
    expect(lines).toEqual(expect.arrayContaining(['* when = "spawn"', '* unit = "m/s"', '  view = false']));
  });

  it('ends its run although a module starts a timer, and keeps modules away from the command', async () => {
    const root = repository({
      'labs/ticker/main.ts': `import { defineKind } from ${REGISTRY};
setInterval(() => {}, 1000);
(globalThis as Record<string, unknown>).describeSideEffect = true;
defineKind('testTicker', { description: 'Ticks.', fields: {} });
`,
    });
    const never: HangWatch = () => ({ loading: () => undefined, done: () => undefined }); // only the child ends it
    const { code, lines } = await runWith(async () => createDescribeCommand({ hang: never }), root);
    const stopped = lines.some((line) => line.startsWith('DESCRIBE_HUNG'));
    expect([code, stopped]).toEqual([0, false]); // it ended by itself, its interval timer running
    expect(lines).toContain('testTicker (0): Ticks.');
    expect((globalThis as Record<string, unknown>).describeSideEffect).toBeUndefined();
  });

  it('fails naming the module being loaded when the child process ends without a listing', async () => {
    const root = repository({ 'labs/stalled/main.ts': "await new Promise(() => {});\ndef('x', 'y', {});\n" });
    const { code, lines } = await run(root);
    expect(code).toBe(1);
    expect(lines[1]).toMatch(
      /^DESCRIBE_WORKER: the listing process ended \(code 13\) while loading labs\/stalled\/main.ts without a listing: .*\(labs\/stalled\/main.ts\)$/,
    );
  });

  it('stops a module that never finishes loading, and names it', async () => {
    const root = repository({
      'labs/stuck/main.ts': "setInterval(() => {}, 1000);\nawait new Promise(() => {});\ndef('x', 'y', {});\n",
    });
    /** Stops the child as hung once it starts loading the stuck module: a count of messages, not a wait. */
    const atStuck: HangWatch = (stop) => ({
      loading: (file) => file === 'labs/stuck/main.ts' && stop(),
      done: () => {},
    });
    const { code, lines } = await runWith(async () => createDescribeCommand({ timeoutMs: 3000, hang: atStuck }), root);
    expect(code).toBe(1);
    expect(lines[0]).toBe('x describe: FAIL: no listing: the child process did not finish');
    expect(lines[1]).toBe(
      'DESCRIBE_HUNG: labs/stuck/main.ts did not finish loading within 3 s (a top-level await that never settles, or a loop): keep page-only work out of the top level of a module that registers content (labs/stuck/main.ts)',
    );
  });

  it('refuses an unknown kind or id with exit 2, naming the closest', async () => {
    const root = repository({
      'engine/speed.ts': `import { defineSettings } from ${SETTINGS};
defineSettings({ 'test.speed': { type: 'number', default: 2, description: 'Speed.' } });
`,
    });
    const kind = await run(root, 'settng');
    expect(kind.code).toBe(2);
    expect(kind.lines[1]).toMatch(/^X_USAGE: there is no kind "settng" \(did you mean "setting"\?\)/);
    const id = await run(root, 'setting', 'test.sped');
    expect(id.code).toBe(2);
    expect(id.lines[1]).toMatch(/there is no setting "test.sped" \(did you mean "test.speed"\?\): .*defineSettings\(/);
  });

  it('prints one line per field, with its flags', () => {
    expect(
      fieldLine({ key: 'impl', type: 'function', required: true, view: true, when: 'scene', description: 'Runs.' }),
    ).toBe('  impl: function, required, view, when scene: Runs.');
  });

  it('cuts a long list of ids to its line, naming describe.json, where every id is', () => {
    expect(idsLine('gadget', [])).toBe('ids: none yet');
    expect(idsLine('gadget', ['gadget:a', 'gadget:b'])).toBe('ids: gadget:a, gadget:b');
    const ids = Array.from({ length: 60 }, (_, i) => `gadget:number${i}`);
    const line = idsLine('gadget', ids);
    expect(line.length).toBeLessThanOrEqual(400);
    const [, shown, more, all, file] = /^ids: (.*), … \((\d+) more; all (\d+) in (\S+)\)$/.exec(line)!;
    expect(shown.split(', ')).toEqual(ids.slice(0, 60 - Number(more)));
    expect([Number(all), file]).toEqual([60, describeFile('gadget')]);
    expect(file).toBe('out/describe/gadget/describe.json');
  });
});
