/**
 * @file Unit tests for the sample of mutants StrykerJS tests (tools/stryker/sample.ts): `share` spreads keys evenly in
 * [0, 1); a function goes by its own name, its key's or its variable's; only an outermost function is ever ignored,
 * and the same one gets the same answer every run, wherever the repository is; about `SAMPLE.rate` of many functions
 * are kept; a function out of scope is ignored with its reason; and the module hands StrykerJS an ignore plugin named
 * `sample`.
 * @see tools/stryker/sample.ts
 */
import { describe, expect, it } from 'vitest';
import { PluginKind } from '@stryker-mutator/api/plugin';
import { functionKey, functionName, OUT_OF_SCOPE, resetPlaces, sample, SAMPLE, share, strykerPlugins, type SamplePath } from './sample'; // prettier-ignore

/** A path for `node` under `parent`, in the file `file`. */
function path(node: SamplePath['node'], parent: SamplePath | null = null, file = '/r/engine/sim/a.ts'): SamplePath {
  return { node, parentPath: parent, hub: { file: { opts: { filename: file } } } };
}
const program = (file?: string) => path({ type: 'Program' }, null, file);
const id = (name: string) => ({ type: 'Identifier', name });

describe('the sample of mutants', () => {
  it('spreads keys evenly in [0, 1)', () => {
    const shares = Array.from({ length: 4000 }, (_, k) => share(`key${k}`));
    expect(shares.every((v) => v >= 0 && v < 1)).toBe(true);
    for (let bin = 0; bin < 4; bin++) expect(Math.abs(shares.filter((v) => Math.floor(v * 4) === bin).length - 1000)).toBeLessThan(100); // prettier-ignore
    expect(share('wp-12.2')).toBe(share('wp-12.2'));
  });

  it('names a function by its own name, its key or the variable it is assigned to', () => {
    const root = program();
    expect(functionName(path({ type: 'FunctionDeclaration', id: id('step') }, root))).toBe('step');
    expect(functionName(path({ type: 'ClassMethod', key: id('update') }, root))).toBe('update');
    const declarator = path({ type: 'VariableDeclarator', id: id('steer') }, root);
    expect(functionName(path({ type: 'ArrowFunctionExpression' }, declarator))).toBe('steer');
    const property = path({ type: 'ObjectProperty', key: { type: 'StringLiteral', value: 'use' } }, root);
    expect(functionName(path({ type: 'FunctionExpression' }, property))).toBe('use');
    expect(functionName(path({ type: 'ArrowFunctionExpression' }, path({ type: 'CallExpression' }, root)))).toBe('anonymous'); // prettier-ignore
  });

  it('ignores only outermost functions, the same ones every run, wherever the repository is', () => {
    const answers = (file: string) => {
      resetPlaces();
      const root = program(file);
      return Array.from({ length: 200 }, (_, k) => sample.shouldIgnore(path({ type: 'FunctionDeclaration', id: id(`f${k}`) }, root, file))); // prettier-ignore
    };
    const here = answers('/home/a/repo/engine/anim/b.ts');
    expect(answers('/tmp/x/engine/anim/b.ts')).toEqual(here);
    const kept = here.filter((answer) => answer === undefined).length;
    expect(Math.abs(kept / 200 - SAMPLE.rate)).toBeLessThan(0.08);
    expect(here.find((answer) => answer !== undefined)).toMatch(
      /^outside the sample: StrykerJS tests 10% of the functions/,
    );
    const outer = path({ type: 'FunctionDeclaration', id: id('outer') }, program());
    const inner = path({ type: 'ArrowFunctionExpression' }, path({ type: 'BlockStatement' }, outer));
    expect([sample.shouldIgnore(inner), sample.shouldIgnore(path({ type: 'ReturnStatement' }, program()))]).toEqual([undefined, undefined]); // prettier-ignore
  });

  it('ignores the functions out of scope whatever the draw, with their reason', () => {
    resetPlaces();
    const file = '/r/engine/anim/fk.ts';
    const fk = path({ type: 'FunctionDeclaration', id: id('forwardKinematics') }, program(file), file);
    expect(sample.shouldIgnore(fk)).toBe(`out of scope (tools/stryker/sample.ts): ${OUT_OF_SCOPE['engine/anim/fk.ts:forwardKinematics#0']}`); // prettier-ignore
    expect(Object.values(OUT_OF_SCOPE).every((reason) => reason.length > 40)).toBe(true);
  });

  it('keys functions of one name in a file by their place, from the repository’s root', () => {
    resetPlaces();
    const root = program('/somewhere/engine/sim/c.ts');
    const twice = () => functionKey(path({ type: 'ClassMethod', key: id('run') }, root, '/somewhere/engine/sim/c.ts'));
    expect([twice(), twice()]).toEqual(['engine/sim/c.ts:run#0', 'engine/sim/c.ts:run#1']);
  });

  it('is the ignore plugin sample', () => {
    expect(strykerPlugins).toEqual([
      expect.objectContaining({ kind: PluginKind.Ignore, name: 'sample', value: sample }),
    ]);
  });
});
