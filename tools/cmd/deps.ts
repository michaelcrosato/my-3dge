/**
 * @file Checks the dependency pins against `tools/deps.json` (offline), and asks the registry for compatible
 * releases to adopt and for lines that have qualified (PLAN.md §6.10; doctrine: Mastery, Common ground).
 *
 * A release qualifies at 12 months old. Each pin is admitted by one `rule`: `qualifies` (the pin is 12 months old),
 * `compatible` (in its qualifying release's line: the same major at 1.0 or later, the same minor for 0.x),
 * `same-way` (a breaking line that works the same way; `adr` names the ADR), `internals` (an internal that
 * measures better; `measurement` says what was measured) or `platform` (Node, Chromium).
 *
 * `tools/deps.json` records, per package: `qualifying`, `pin` and `newest` (the newest release of the pin's line),
 * each `{ version, date }`; `rule`; `next` (the next line's first release and the day it qualifies, or null);
 * `reason` (why it is a dependency at all); optional `follows` (a package whose line it shares). Sections:
 * `dependencies` and `devDependencies` (package.json's), `types` (the lockfile's other `@types/*` and `@webgpu/*`,
 * under the same rule), `typesDeps`, `platform` (`node` is `.nvmrc`'s), `knowledge` (docs that follow a pin).
 *
 * `typesDeps` are the packages in the lockfile only because a types package pulls them in (`@types/three` pulls
 * `@dimforge/rapier3d-compat@0.12.0` for its RapierPhysics declarations). Their range is the types package's, so the
 * age rule does not apply: each is recorded with its version, `via` and reason, the check fails when the lockfile
 * moves one, and nothing may import them (ADR-0007, amendment 1).
 *
 * `--check` (the default; offline; `x check` runs it as its `deps` plugin): package.json, the lockfile, `.nvmrc` and
 * the pinned docs match the record; every pin has a rule that admits it and a reason, and none is older than its
 * `newest`. It warns when the active node is not `.nvmrc`'s, or when a `next` line has qualified.
 * `--update` (network: npm's registry, nodejs.org): installs each pin's newest compatible release, rewrites the
 * record, runs T0 and T1; `--dry-run` only lists. A newer Node is listed, never installed.
 * `--qualify` (network): lists the lines that have qualified beyond each pin, as upgrade WPs to schedule (§9).
 *
 * Usage: node x deps [--check | --update [--dry-run] | --qualify]. Exit 0; 1 on a failed check or step.
 * @see tools/lib/depsCheck.ts
 * @see tools/lib/depsUpdate.ts
 * @see tools/cmd/deps.test.ts
 */
import { checkDeps, type CheckDepsOptions } from '../lib/depsCheck';
import { qualify, update, type NetworkOptions } from '../lib/depsUpdate';
import { UsageError, type Command, type CommandResult } from '../x';
import type { CheckPlugin } from './check';

/** Builds the command; tests inject the day, the active node, a fixture registry and a recording runner. */
export function createDepsCommand(options: CheckDepsOptions & NetworkOptions = {}): Command {
  return {
    usage: 'deps [--check | --update [--dry-run] | --qualify]',
    options: {
      check: { type: 'boolean' },
      update: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      qualify: { type: 'boolean' },
    },
    maxPositionals: 0,
    async run({ values, root }): Promise<CommandResult> {
      const modes = (['check', 'update', 'qualify'] as const).filter((mode) => values[mode]);
      if (modes.length > 1)
        throw new UsageError(`choose one of --check, --update and --qualify, not ${modes.join(' and ')}`);
      if (values['dry-run'] && !values.update) throw new UsageError('--dry-run goes with --update');
      const mode = modes[0] ?? 'check';
      if (mode === 'update') {
        const dryRun = values['dry-run'] === true;
        const { plan, lines, failures, wrote } = await update(root, { ...options, dryRun });
        const count = plan.adoptions.length;
        const summary = dryRun
          ? count
            ? `${count} compatible release${count === 1 ? '' : 's'} to adopt (dry run: nothing changed)`
            : 'nothing to adopt: every pin is the newest release of its line'
          : wrote
            ? `${count} adopted; tools/deps.json rewritten${failures.length ? '' : ', T0 and T1 green'}`
            : count || failures.length
              ? 'nothing adopted'
              : 'nothing to adopt: every pin is the newest release of its line';
        return {
          ok: failures.length === 0,
          summary,
          lines,
          failures,
          target: 'update',
          metrics: { adopt: count, wrote },
        };
      }
      if (mode === 'qualify') {
        const { upgrades, lines, failures } = await qualify(root, options);
        const summary = upgrades.length
          ? `${upgrades.length} line${upgrades.length === 1 ? ' has' : 's have'} qualified beyond the pins: schedule upgrade WPs (PLAN.md §9)`
          : 'no line has qualified beyond the pins';
        return {
          ok: failures.length === 0,
          summary,
          lines,
          failures,
          target: 'qualify',
          metrics: { upgrades: upgrades.length },
        };
      }
      const outcome = checkDeps(root, options);
      return {
        ok: outcome.failures.length === 0,
        summary: outcome.summary ?? '',
        failures: outcome.failures,
        warnings: outcome.warnings,
        metrics: outcome.metrics,
        target: 'check',
      };
    },
  };
}

export default createDepsCommand();

/** The `deps` plugin of `x check` (T0): the offline check. */
export const check: CheckPlugin = {
  name: 'deps',
  run: ({ root }) => checkDeps(root),
};
