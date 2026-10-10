/**
 * @file Proves the local rule "ask the entry, never the id" (tools/eslint/askTheEntry.ts, PLAN.md §6.6) with failing
 * and passing fixtures linted from a temporary directory, switched on (as WP 1.2 will) and off (as it is until then).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ALL_ON, caseProblems, lintCases, type Case, type CaseResult } from './testing';

const RULE = 'local/ask-the-entry';
let count = 0;
const entry = (name: string, bad: string, good: string, goodFile?: string): Case => ({
  name,
  file: `engine/anim/react${++count}.ts`,
  bad,
  good,
  goodFile,
  rule: RULE,
});

const CASES: Case[] = [
  entry(
    'an id compared with an id-shaped string',
    "export const flinch = (move: { id: string }) => move.id === 'move:slash';",
    'export const flinch = (move: { flinch: boolean }) => move.flinch;',
  ),
  entry(
    'an id-shaped string compared with anything',
    "export const isCrate = (name: string) => 'prop:crate' !== name;",
    'export const isCrate = (prop: { breakable?: boolean }) => prop.breakable ?? false;',
  ),
  entry(
    'an id compared with a bare name',
    "export const heavy = (body: { id: string }) => body.id == 'brute';",
    'export const heavy = (body: { mass: number }) => body.mass > 80;',
  ),
  entry(
    'a variable named like an id',
    "export const mine = (ownerId: string) => ownerId === 'actor:hero';",
    'export const mine = (ownerId: string, heroId: string) => ownerId === heroId;',
  ),
  entry(
    'a switch on an id',
    "export function speed(kind: { id: string }) { switch (kind.id) { case 'slime': return 1; default: return 2; } }",
    "export function speed(event: { type: string }) { switch (event.type) { case 'hit': return 1; default: return 2; } }",
  ),
  entry(
    'an id-shaped case',
    "export function speed(name: string) { switch (name) { case 'move:dash': return 9; default: return 2; } }",
    'export function speed(move: { speed?: number }) { return move.speed ?? 2; }',
  ),
  entry(
    'a list of ids',
    "export const ranged = (move: { id: string }) => ['move:shoot', 'move:throw'].includes(move.id);",
    "export const ranged = (move: { tags: string[] }) => move.tags.includes('ranged');",
  ),
  entry(
    'an id prefix',
    "export const isMove = (id: string) => id.startsWith('move:');",
    "export const isMove = (entry: { kind: string }) => entry.kind === 'move';",
  ),
  entry(
    'game code may name its own content',
    "export const boss = (actor: { id: string }) => actor.id === 'actor:boss';",
    "export const boss = (actor: { id: string }) => actor.id === 'actor:boss';",
    'labs/box/scenes/arena.ts',
  ),
  entry(
    'unit tests may name ids',
    "export const isSlash = (move: { id: string }) => move.id === 'move:slash';",
    "export const isSlash = (move: { id: string }) => move.id === 'move:slash';",
    'engine/anim/react.test.ts',
  ),
];

let results: CaseResult[];
let off: CaseResult[];
beforeAll(async () => {
  [results, off] = await Promise.all([lintCases(CASES), lintCases(CASES, { ...ALL_ON, askTheEntry: false })]);
}, 60_000);

describe('ask the entry, never the id: switched on', () => {
  it.each(CASES.map((item, i) => [item.name, i] as const))('%s', (_name, i) => {
    expect(caseProblems(results[i])).toEqual([]);
  });

  it('names the compared string and the fix', () => {
    const [message] = results[0].bad.map((item) => item.message);
    expect(message).toContain("compares an id with 'move:slash'");
    expect(message).toContain('give the kind that hook with a default on its schema');
  });

  it('leaves typeof checks, event types and two-variable lookups alone', async () => {
    const [result] = await lintCases([
      entry(
        'lookups',
        "export const x = (move: { id: string }) => move.id === 'move:slash';",
        "export const find = (list: { id: string }[], id: string) => list.find((e) => e.id === id);\nexport const s = (v: unknown, e: { type: string }) => typeof v === 'string' && e.type === 'hit:start';\nexport function on(e: { type: string }) { switch (e.type) { case 'hit:end': return 1; default: return 0; } }",
      ),
    ]);
    expect(caseProblems(result)).toEqual([]);
  });
});

describe('ask the entry, never the id: switched off (until WP 1.2)', () => {
  it('reports nothing', () => {
    expect(off.flatMap((result) => result.bad.filter((item) => item.ruleId === RULE))).toEqual([]);
  });
});
