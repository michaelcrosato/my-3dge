/**
 * @file Prints and checks the engine's version (PLAN.md WP 13.45, ADR-0026): package.json's, a semantic version that
 * every merge bumps and main's push tags `v<version>` (.github/workflows/release.yml).
 *
 * Usage: node x version [--check]. Without a flag it prints the version and its tag. `--check`, a step of the quick
 * gate (tools/cmd/ci.ts), fails while the working tree differs from origin/main and the version is not above main's,
 * naming the fix (tools/lib/version.ts `versionCheck`).
 *
 * @see tools/lib/version.ts
 */
import { versionCheck } from '../lib/version';
import type { Command, CommandResult } from '../x';

export default {
  usage: 'version [--check]',
  options: { check: { type: 'boolean' } },
  maxPositionals: 0,
  async run({ root, values }): Promise<CommandResult> {
    const check = versionCheck(root);
    if (!values.check) {
      return {
        ok: true,
        summary: `my-3dge ${check.version}, tagged v${check.version} on main`,
        metrics: { version: check.version },
      };
    }
    return {
      ok: check.ok,
      summary: check.reason,
      failures: check.ok ? [] : [{ id: 'VERSION_NOT_BUMPED', message: check.reason }],
      metrics: { version: check.version, main: check.main ?? '' },
    };
  },
} satisfies Command;
