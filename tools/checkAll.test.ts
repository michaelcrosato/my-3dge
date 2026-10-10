/**
 * @file Tests tools/checkAll.ts (`npm run check`): the exit code is 1 when any tool fails and 0 only when all pass,
 * and each tool's output is printed whole, in the order given, however the tools finish.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkAll, type CheckTool } from './checkAll';

/** A fake tool: prints `lines` (after `delayMs`) and exits with `code`. */
const tool = (name: string, code: number, lines: string[], delayMs = 0): CheckTool => ({
  name,
  command: `node -e "setTimeout(() => { ${lines.map((line) => `console.log('${line}');`).join(' ')} process.exit(${code}); }, ${delayMs})"`,
});

afterEach(() => vi.restoreAllMocks());

/** Runs checkAll with console.log captured; returns the exit code and the printed lines. */
async function run(tools: CheckTool[]): Promise<{ code: number; printed: string[] }> {
  const printed: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((text: string) => printed.push(...String(text).split('\n')));
  const code = await checkAll(tools);
  return { code, printed };
}

describe('checkAll', () => {
  it('returns 0 when every tool passes', async () => {
    const { code, printed } = await run([tool('a', 0, ['one']), tool('b', 0, [])]);
    expect(code).toBe(0);
    expect(printed.at(-1)).toMatch(/^check: ok in \d+\.\d s$/);
  });

  it('returns 1 when one tool fails, naming it, and still runs the others to the end', async () => {
    const { code, printed } = await run([tool('a', 0, ['fine']), tool('b', 1, ['broken']), tool('c', 0, ['also'])]);
    expect(code).toBe(1);
    expect(printed.at(-1)).toBe('check: FAIL (b)');
    expect(printed).toContain('also');
  });

  it('prints each tool whole and in the given order, even when a later tool finishes first', async () => {
    const { printed } = await run([tool('slow', 0, ['s1', 's2'], 400), tool('fast', 2, ['f1', 'f2'])]);
    const body = printed.filter((line) => !line.startsWith('check:'));
    expect(body.map((line) => line.replace(/\(\d+\.\d s\)/, '(t)'))).toEqual([
      'ok   slow (t)',
      's1',
      's2',
      'FAIL fast (t)',
      'f1',
      'f2',
    ]);
  });
});
