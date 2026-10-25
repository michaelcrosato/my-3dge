/**
 * @file Unit tests for the MCP server's links to its worker (tools/mcp/link.ts, PLAN.md §8.11, WP 7.6): a worker in
 * this process answers by request, with its progress; a forked worker that exits fails what it holds and every request
 * after, naming its exit and its last error line, as a worker whose engine module no longer loads prints it (a stand-in
 * x.js in a sandbox, so no engine loads). tools/cmd/mcp.test.ts forks the real one.
 * @see tools/mcp/link.ts
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { forkLink, localLink } from './link';

describe('the links to a worker', () => {
  it('answer by request in this process, with the progress a request sends', async () => {
    const lines: string[] = [];
    const link = localLink(async (request, progress) => (progress(`asked ${request.op}`), request.op));
    expect(await link.request({ op: 'tools' }, (line) => void lines.push(line))).toBe('tools');
    expect(lines).toEqual(['asked tools']);
  });

  it('fail what a forked worker held when it exits, naming its last error line', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-link-'));
    try {
      const crash = ['x mcp: FAIL: the command crashed', 'X_CRASH: x mcp crashed: tools/mcp/worker.ts did not load: SyntaxError: Unexpected token', 'report: out/mcp/all/report.json']; // prettier-ignore
      writeFileSync(join(root, 'x.js'), `${crash.map((line) => `console.log(${JSON.stringify(line)});`).join('\n')}\nprocess.exitCode = 1;\n`); // prettier-ignore
      const link = forkLink(root, ['--headless'], new PassThrough().resume()); // its output read, not printed
      const said = /^MCP_BACKEND: the backend \(x mcp --worker, pid \d+\) exited \(code 1\), saying X_CRASH: x mcp crashed: tools\/mcp\/worker\.ts did not load: SyntaxError: Unexpected token: the next call starts it again$/; // prettier-ignore
      await expect(link.request({ op: 'tools' })).rejects.toThrow(said);
      await expect(link.request({ op: 'tools' })).rejects.toThrow(said);
      await link.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
