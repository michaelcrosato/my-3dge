/**
 * @file Unit tests for the MCP bridge's tool table (tools/mcp/tools.ts, schema.ts, results.ts, docs.ts; PLAN.md
 * §8.11, WP 7.6): the schema language projects onto JSON Schema keyword for keyword, and every member's arguments
 * project (none takes a hook); the tools are generated from the members, each tool's schema its member's arguments
 * and its description its member's help line, a backend without a renderer offering no shot; arguments by name go
 * in call order; results cut long texts, strip the wrappers round an error, make a PNG of a shot and judge goldens;
 * docs_lookup finds a code, a module and an export, and names the closest otherwise.
 * @see tools/mcp/tools.ts
 * @see tools/mcp/schema.ts
 * @see tools/mcp/results.ts
 * @see tools/mcp/docs.ts
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { registry } from '../../engine/core/registry';
import type { Member } from '../../engine/dev/members';
import type { ShotJson } from '../../engine/gfx/shot';
import { ROOT } from '../x';
import { docsLookup } from './docs';
import { cutText, errorLine, judgeGoldens, MAX_TEXT, shotResult } from './results';
import { argsSchema, fieldSchema, McpSchemaError } from './schema';
import { positional, replayFile, toolList } from './tools';

const member = (name: string) => registry.get('inspectorMember', name) as Member;

describe('the schema projection', () => {
  it("keeps JSON Schema's keywords, joins the unit to the description, and refuses a hook", () => {
    expect(fieldSchema({ type: 'integer', default: 1, minimum: 0, maximum: 9, description: 'How many.' })).toEqual({
      type: 'integer',
      description: 'How many.',
      default: 1,
      minimum: 0,
      maximum: 9,
    });
    expect(fieldSchema({ type: 'any', description: 'Anything.' })).toEqual({ description: 'Anything.' });
    expect(fieldSchema({ type: 'string', enum: ['a', 'b'], description: 'One.' })).toEqual({ type: 'string', enum: ['a', 'b'], description: 'One.' }); // prettier-ignore
    const at = { type: 'array', items: { type: 'number' }, unit: 'm', description: 'Where.' } as const;
    expect(fieldSchema(at)).toEqual({ type: 'array', items: { type: 'number' }, description: 'Where. Unit: m.' });
    const point = { x: { type: 'number', required: true, description: 'East.' }, y: { type: 'number', description: 'Up.' } } as const; // prettier-ignore
    expect(fieldSchema({ type: 'object', properties: point, description: 'A point.' })).toEqual({
      type: 'object',
      description: 'A point.',
      properties: { x: { type: 'number', description: 'East.' }, y: { type: 'number', description: 'Up.' } },
      required: ['x'],
      additionalProperties: false,
    });
    expect(() => fieldSchema({ type: 'function', default: () => 0, description: 'A hook.' }, 'args.onHit')).toThrow(McpSchemaError); // prettier-ignore
  });

  it("projects every registered member's arguments: none takes a hook", () => {
    const members = registry.list('inspectorMember') as Member[];
    expect(members.length).toBeGreaterThan(40);
    for (const entry of members) expect(() => argsSchema(entry.args, entry.id), entry.id).not.toThrow();
  });
});

describe('the tools', () => {
  it("are generated from the members: each one's arguments and help line", () => {
    const tools = toolList(registry, true);
    expect(tools.map((tool) => tool.name)).toEqual(['engine_open', 'engine_step', 'engine_state', 'engine_dump', 'engine_shot', 'engine_input', 'engine_replay', 'engine_set', 'engine_actions', 'engine_help', 'docs_lookup', 'engine_call']); // prettier-ignore
    const tool = (name: string) => tools.find((entry) => entry.name === name)!;
    expect(tool('engine_step').inputSchema).toEqual(argsSchema(member('step').args, 'engine_step'));
    expect(tool('engine_set').inputSchema.required).toEqual(['path', 'value']);
    expect(tool('engine_input').inputSchema).toEqual(argsSchema(member('input.play').args, 'engine_input'));
    expect(tool('engine_step').description).toBe(`${member('step').help} Answers { tick }. (__engine.step(n = 1, intents?))`); // prettier-ignore
    expect(tool('engine_actions').inputSchema.required).toBeUndefined(); // name is optional: without one, the list
    expect(Object.keys(tool('engine_replay').inputSchema.properties!)).toEqual(['options', 'file']); // text: the file's
    expect(tool('engine_state').annotations).toEqual({ readOnlyHint: true });
    const names = (registry.list('inspectorMember') as Member[]).map((entry) => entry.id);
    expect((tool('engine_call').inputSchema.properties!.member as { enum: string[] }).enum).toEqual(names);
  });

  it('offer no shot, and no member that needs a renderer, on a backend without one', () => {
    const tools = toolList(registry, false);
    expect(tools.map((tool) => tool.name)).not.toContain('engine_shot');
    const listed = (tools.find((tool) => tool.name === 'engine_call')!.inputSchema.properties!.member as { enum: string[] }).enum; // prettier-ignore
    expect(listed).toEqual(expect.arrayContaining(['step', 'camera.set', 'scene.dump']));
    expect(listed).not.toContain('shot');
    expect(listed).not.toContain('render');
  });

  it('put arguments given by name in call order, and refuse one the member lacks', () => {
    expect(positional(member('camera.set'), { code: 'cam=iso' })).toEqual(['cam=iso']);
    expect(positional(member('step'), { intents: { jump: true } })).toEqual([undefined, { jump: true }]);
    expect(positional(member('step'), [60])).toEqual([60]);
    expect(positional(member('get'), 3)).toEqual([3]);
    expect(positional(member('errors'), undefined)).toEqual([]);
    expect(() => positional(member('step'), { count: 2 })).toThrow(/^MCP_BAD_INPUT: __engine.step has no argument count: it takes n, intents \(step\(n = 1, intents\?\)\)$/); // prettier-ignore
  });

  it('read a replay file under the root, refusing one outside it or without a scene', () => {
    const replay = replayFile(ROOT, './tests/replays/box-1-room.replay.json', 'linux-x64');
    expect([replay.file, replay.scene, Object.keys(replay.goldens ?? {}).length]).toEqual(['tests/replays/box-1-room.replay.json', 'box:room', 11]); // prettier-ignore
    expect(() => replayFile(ROOT, '../elsewhere.replay.json')).toThrow(/^MCP_NO_FILE: \.\.\/elsewhere/);
    expect(() => replayFile(ROOT, 'package.json')).toThrow(/^MCP_NO_FILE: package.json names no scene/);
  });
});

describe('the results', () => {
  it('cut a text past MAX_TEXT, saying where the whole of it is', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-results-'));
    try {
      expect(cutText('short', root, 'engine_state')).toBe('short');
      const cut = cutText('x'.repeat(MAX_TEXT + 10), root, 'engine_state');
      expect(cut.split('\n').at(-1)).toBe('… 10 more characters cut: the whole result is in out/mcp/engine_state.txt; narrow the call'); // prettier-ignore
      expect(readFileSync(join(root, 'out/mcp/engine_state.txt'), 'utf8')).toHaveLength(MAX_TEXT + 10);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keep an error's first line, without the page's wrappers", () => {
    expect(errorLine(new Error('page.evaluate: Error: [DEV_BAD_ARGS] __engine.get: id is "a": fix\n    at x'))).toBe('[DEV_BAD_ARGS] __engine.get: id is "a": fix'); // prettier-ignore
    expect(errorLine(new Error('page.evaluate: TypeError: __engine.shot is not a function'))).toBe('TypeError: __engine.shot is not a function'); // prettier-ignore
    expect(errorLine('MCP_NOT_OPEN: nothing')).toBe('MCP_NOT_OPEN: nothing');
  });

  it('make a PNG of a shot, its marked copy when it has one, and leave pixels out of its numbers', () => {
    const rgba = (value: number) => Buffer.alloc(2 * 1 * 4, value).toString('base64');
    const shot = { width: 2, height: 1, readback: { bytesPerRow: 256, bytes: 256 }, pixels: rgba(1), built: 0, ms: 2 } as ShotJson; // prettier-ignore
    const [image, numbers] = shotResult(shot, ROOT).content as unknown as [{ data: string }, { text: string }];
    const png = Buffer.from(image.data, 'base64');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([2, 1]);
    expect(JSON.parse(numbers.text)).toEqual({ width: 2, height: 1, built: 0, ms: 2 });
    const marked = shotResult({ ...shot, marked: rgba(9) }, ROOT).content[0] as { data: string };
    expect(marked.data).not.toBe(image.data);
    expect(shotResult({ ...shot, pixels: undefined }, ROOT).content.map((item) => item.type)).toEqual(['text']);
  });

  it('judge hashes against goldens at the steps both hold', () => {
    expect(judgeGoldens({ 0: 'a', 60: 'b' }, { 0: 'a', 60: 'b', 61: 'c' })).toMatchObject({ checked: 2, match: true });
    expect(judgeGoldens({ 0: 'a', 60: 'b', 120: 'c' }, { 0: 'a', 60: 'x', 120: 'y' })).toMatchObject({ checked: 3, match: false, step: '60', expected: 'b', actual: 'x' }); // prettier-ignore
    expect(judgeGoldens(undefined, { 0: 'a' }).note).toMatch(/^the file has no goldens for /);
    expect(judgeGoldens({ 600: 'z' }, { 0: 'a' })).toMatchObject({ checked: 0, match: false, note: 'no golden step was played' }); // prettier-ignore
  });
});

describe('docs_lookup', () => {
  it('finds a code, a module and an export, and names the closest otherwise', () => {
    const code = docsLookup(ROOT, 'DEV_NO_RENDERER').split('\n');
    expect(code[0]).toBe('### DEV_NO_RENDERER (docs/ERRORS.md)');
    expect(code.join('\n')).toContain('- Fix: call it in a page started with createEngine');
    const module = docsLookup(ROOT, 'tools/lib/hash').split('\n');
    expect(module[0]).toBe('tools/lib/hash.ts');
    expect(module.at(-2)).toBe('Exports: fnv1a, fnv1aHex');
    expect(docsLookup(ROOT, '`fnv1aHex`').split('\n')[0]).toMatch(
      /^`fnv1aHex` \(function, tools\/lib\/hash\.ts:\d+\)$/,
    );
    expect(docsLookup(ROOT, 'createHedless')).toBe('the docs list no createHedless: did you mean createHeadless? (an inspector member\'s help: engine_help)'); // prettier-ignore
  });
});
