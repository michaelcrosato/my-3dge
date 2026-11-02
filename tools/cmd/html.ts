/**
 * @file Writes and checks the one-file playground, `playground.html` (tools/lib/oneFile.ts; ADR-0023 amendment 5): the
 * playground as one self-contained HTML page, the file the engine is distributed and tested as.
 *
 * - `--write` builds it and writes it when it differs; commit it with the change that made it differ.
 * - `--check` (the default) builds it and fails while the committed file differs (`HTML_STALE`, fixed by `--write`) or
 *   loads anything from outside itself (`HTML_EXTERNAL`). The quick gate runs it (tools/cmd/ci.ts).
 *
 * The build takes about 11 s and gives the same bytes every time. The report's metrics give the file's size in bytes.
 *
 * Usage: node x html [--check | --write]. Exit 0 when the file is current (or was written), 1 otherwise, 2 on a
 * usage error.
 *
 * @example
 * // node x html --write   → x html: ok: wrote playground.html (6,912,709 bytes)
 * // node x html --check   → x html: ok: playground.html current (6,912,709 bytes)
 * @see tools/cmd/html.test.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOneFile, externalRefs, ONE_FILE } from '../lib/oneFile';
import type { Finding } from '../lib/report';
import { UsageError, type Command, type CommandResult } from '../x';

/** Builds the command; tests inject the build. */
export function createHtmlCommand(build: (root: string) => Promise<string> = buildOneFile): Command {
  return {
    usage: 'html [--check | --write]',
    options: { check: { type: 'boolean' }, write: { type: 'boolean' } },
    maxPositionals: 0,
    async run({ values, root }): Promise<CommandResult> {
      if (values.check && values.write) throw new UsageError('choose --check or --write, not both');
      const html = await build(root);
      const path = join(root, ONE_FILE);
      const current = existsSync(path) && readFileSync(path, 'utf8') === html;
      const failures: Finding[] = externalRefs(html).map((ref) => ({
        id: 'HTML_EXTERNAL',
        message: `the one file loads ${ref}, which a file opened from disk cannot reach: inline it (tools/lib/oneFile.ts) or import it from the page's code`, // prettier-ignore
        file: ONE_FILE,
      }));
      const bytes = Buffer.byteLength(html);
      const size = `${bytes.toLocaleString('en-US')} bytes`;
      if (values.write) {
        if (!current) writeFileSync(path, html);
        return {
          ok: failures.length === 0,
          summary: current ? `${ONE_FILE} was already current (${size})` : `wrote ${ONE_FILE} (${size})`,
          failures,
          metrics: { bytes, written: current ? 0 : 1 },
        };
      }
      if (!current) {
        failures.push({
          id: 'HTML_STALE',
          message: `${ONE_FILE} ${existsSync(path) ? 'differs from a build of its sources' : 'is missing'}: run node x html --write and commit it`, // prettier-ignore
          file: ONE_FILE,
        });
      }
      return {
        ok: failures.length === 0,
        summary: current ? `${ONE_FILE} current (${size})` : `${ONE_FILE} stale`,
        failures,
        metrics: { bytes, stale: current ? 0 : 1 },
      };
    },
  };
}

export default createHtmlCommand();
