/**
 * @file Plumbing for the rule families of eslint.config.js: core rules re-exposed under a family's own name, and
 * per-path zones for bans that have exceptions.
 *
 * Flat config keeps only the last options given to a rule for a file, so two families that both used
 * `no-restricted-imports` on one file would silently lose one family's list. Each family therefore registers the core
 * rules it uses under its own plugin name (`layer/no-restricted-imports`, `sim/no-restricted-globals`): families never
 * replace each other's options, and the rule id in a report names the family. An alias is the core rule itself,
 * except where `resolvingImports` wraps it: `no-restricted-imports` matches the raw source text, so the families
 * whose patterns describe relative paths (layers, public API) see each relative source in its shortest spelling from
 * the importing file, and `../../engine/sim/x` from `engine/core/` is matched as `../sim/x`.
 *
 * Invariants: `zoned` gives every file the union of the bans that apply to it; a path in `only` or `except` that ends
 * in `/` is a directory, any other path is one file. A resolved report still quotes the source as written.
 *
 * @example
 * const sim = family('sim', 'no-restricted-globals');
 * // a block: { plugins: { sim }, rules: { 'sim/no-restricted-globals': ['error', { name: 'Date', message: '…' }] } }
 * @see tools/eslint/banned.ts
 */
import { posix } from 'node:path';
import type { ESLint, Linter, Rule } from 'eslint';
import { builtinRules } from 'eslint/use-at-your-own-risk';

/** Returns a plugin named `name` whose rules are the named core rules, unchanged. */
export function family(name: string, ...rules: string[]): ESLint.Plugin {
  return {
    meta: { name },
    rules: Object.fromEntries(
      rules.map((rule) => {
        const module = builtinRules.get(rule);
        if (!module) throw new Error(`ESLint has no core rule "${rule}" to alias as ${name}/${rule}`);
        return [rule, module];
      }),
    ),
  };
}

/**
 * A relative source's shortest spelling from `dir`: `./a/../b` is `./b`, and `../../engine/sim` from `engine/core` is
 * `../sim`.
 */
function shortest(dir: string, source: string): string {
  const path = posix.relative(dir, posix.resolve(dir, source));
  if (path === '') return '.';
  return path === '..' || path.startsWith('../') ? path : `./${path}`;
}

/** `plugin` with its `no-restricted-imports` matching each relative source as resolved from the importing file. */
export function resolvingImports(plugin: ESLint.Plugin): ESLint.Plugin {
  const rule = plugin.rules?.['no-restricted-imports'] as Rule.RuleModule | undefined;
  if (!rule) throw new Error(`${plugin.meta?.name} has no no-restricted-imports to resolve`);
  const resolving: Rule.RuleModule = {
    meta: rule.meta,
    create(context) {
      const dir = posix.dirname(context.filename);
      const written = new WeakMap<object, string>();
      // The rule reports the node it was given: put the source back as written.
      const report = (descriptor: Rule.ReportDescriptor) => {
        const source = 'node' in descriptor ? written.get(descriptor.node) : undefined;
        context.report(
          source === undefined ? descriptor : { ...descriptor, data: { ...descriptor.data, importSource: source } },
        );
      };
      const listeners = rule.create(Object.create(context, { report: { value: report } }) as Rule.RuleContext);
      const resolved = (node: Rule.Node): Rule.Node => {
        const source = (node as { source?: { value?: unknown } }).source;
        if (typeof source?.value !== 'string' || !/^\.\.?(?:\/|$)/.test(source.value)) return node;
        const spelled = shortest(dir, source.value);
        if (spelled === source.value) return node;
        const copy = { ...node, source: { ...source, value: spelled } } as Rule.Node;
        written.set(copy, source.value);
        return copy;
      };
      return Object.fromEntries(
        Object.entries(listeners).map(([selector, listener]) => [
          selector,
          (node: Rule.Node, ...rest: unknown[]) => (listener as (...args: unknown[]) => void)(resolved(node), ...rest),
        ]),
      );
    },
  };
  return { ...plugin, rules: { ...plugin.rules, 'no-restricted-imports': resolving } };
}

/** One entry of a restriction rule's options (`{ selector, message }`, `{ property, message }`…), plus its scope. */
export type Ban = Record<string, unknown> & {
  /** The sentence ESLint prints: what is banned, and the fix. */
  message: string;
  /** Applies only under these paths. */
  only?: string[];
  /** Does not apply under these paths. */
  except?: string[];
};

/** Whether `ban` applies at `path` (a zone: '' for the family's files, a directory ending in `/`, or a file). */
function applies(ban: Ban, path: string): boolean {
  const inside = (prefixes: string[] | undefined) => (prefixes ?? []).some((prefix) => path.startsWith(prefix));
  return (!ban.only || inside(ban.only)) && !inside(ban.except);
}

/** The option object ESLint receives: the ban without its scope. */
function option(ban: Ban): Record<string, unknown> {
  return Object.fromEntries(Object.entries(ban).filter(([key]) => key !== 'only' && key !== 'except'));
}

/**
 * Blocks that apply one aliased rule over `files` so each file gets exactly the bans that apply to it: one block for
 * all `files`, then one per path an `only` or `except` names, the most specific last (flat config's last block wins).
 */
export function zoned(
  label: string,
  plugin: ESLint.Plugin,
  ruleId: string,
  bans: Ban[],
  files: string[],
  ignores: string[] = [],
): Linter.Config[] {
  const namespace = ruleId.split('/')[0];
  const zones = [...new Set(bans.flatMap((ban) => [...(ban.only ?? []), ...(ban.except ?? [])]))];
  zones.sort((a, b) => a.length - b.length);
  const block = (name: string, blockFiles: string[], zone: string): Linter.Config => ({
    name,
    files: blockFiles,
    ignores,
    plugins: { [namespace]: plugin },
    rules: { [ruleId]: ['error', ...bans.filter((ban) => applies(ban, zone)).map(option)] },
  });
  return [
    block(label, files, ''),
    ...zones.map((zone) => block(`${label}: ${zone}`, [zone.endsWith('/') ? `${zone}**` : zone], zone)),
  ];
}

/** Every `message` in a list of blocks' rule options, `no-restricted-imports`'s paths and patterns included. */
export function messagesOf(blocks: readonly Linter.Config[], ruleId?: string): string[] {
  const found = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (typeof value !== 'object' || value === null) return;
    const record = value as Record<string, unknown>;
    if (typeof record.message === 'string') found.add(record.message);
    visit(record.paths);
    visit(record.patterns);
  };
  for (const block of blocks) {
    for (const [id, setting] of Object.entries(block.rules ?? {})) {
      if (ruleId && id !== ruleId) continue;
      if (Array.isArray(setting) && setting[0] !== 'off' && setting[0] !== 0) visit(setting.slice(1));
    }
  }
  return [...found];
}
