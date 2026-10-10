/**
 * @file The network half of `x deps` (PLAN.md §6.10): `--update` adopts each pin's newest compatible release and
 * rewrites `tools/deps.json`; `--qualify` lists the lines that have qualified beyond the pins, as upgrade WPs.
 *
 * The registry is `npm view <pkg> time versions dist-tags --json` (`versions` drops releases unpublished since,
 * `latest` caps strays) and nodejs.org's release index for Node, through curl, which honours the proxy. Both, and
 * the command runner, are injectable: tests run against fixture registries, offline.
 *
 * Invariants: `--update --dry-run` writes nothing. A `types` package moves only as far as every package depending on
 * it allows (`npm update`); a direct one is installed exactly (`npm install --save-exact`). A newer Node is listed,
 * never installed. The record is written only when something changed, Prettier-formatted, and then T0 and T1 run.
 *
 * @example
 * const offline = { npm: async () => ({ time: {} }), node: async () => ({ time: {} }) }; // a fixture registry
 * const plan = await planUpdate(process.cwd(), { registry: offline, today: '2026-10-10' });
 * plan.adoptions; // [] here, and against npm's registry right after the pins are set
 * @see tools/cmd/deps.ts
 * @see tools/cmd/deps.test.ts
 */
import { execFile, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  compareVersions,
  evenLines,
  firstOfNextLine,
  lineName,
  lineOf,
  lookup,
  newestInLine,
  newestQualified,
  qualifiesOn,
  readRepository,
  RECORD,
  satisfies,
  SECTIONS,
  stableReleases,
  todayUtc,
  typesInLock,
  type DepsRecord,
  type Lockfile,
  type PinRecord,
  type RegistryAnswer,
  type Release,
} from './deps';
import type { Finding } from './report';

/** The network, injectable: npm's registry and Node's release index. */
export interface Registry {
  npm(name: string): Promise<RegistryAnswer>;
  node(): Promise<RegistryAnswer>;
}
/** Runs a command in the repository and returns its exit status and output. */
export type Runner = (command: string, args: string[], cwd: string) => { status: number; output: string };
/** What `--update` and `--qualify` take besides the repository. */
export interface NetworkOptions {
  registry?: Registry;
  run?: Runner;
  /** The day (UTC) releases are aged against; today by default. */
  today?: string;
}
/** A release to adopt. */
export interface Adoption {
  section: 'dependencies' | 'devDependencies' | 'types';
  name: string;
  from: string;
  to: Release;
}

const execFileAsync = promisify(execFile);
/** The real network. */
export const NETWORK: Registry = {
  async npm(name) {
    const args = ['view', name, 'time', 'versions', 'dist-tags', '--json'];
    const json = JSON.parse((await execFileAsync('npm', args, { maxBuffer: 256 << 20 })).stdout);
    return { time: json.time ?? {}, versions: [json.versions ?? []].flat(), latest: json['dist-tags']?.latest };
  },
  async node() {
    const args = ['--fail', '--silent', '--show-error', '--location', 'https://nodejs.org/dist/index.json'];
    const list = JSON.parse((await execFileAsync('curl', args, { maxBuffer: 64 << 20 })).stdout) as Release[];
    return { time: Object.fromEntries(list.map((r) => [r.version, r.date])) };
  },
};
/** The real runner: a child process in the repository. */
export const SPAWN: Runner = (command, args, cwd) => {
  const run = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 << 20 });
  return { status: run.status ?? 1, output: `${run.stdout ?? ''}${run.stderr ?? ''}${run.error?.message ?? ''}` };
};

const SECTIONS_AND_TYPES = [...SECTIONS, 'types'] as const;
/** The records the registry is asked about, as [section, name, record]. */
const npmRecords = (record: DepsRecord) =>
  SECTIONS_AND_TYPES.flatMap((section) =>
    Object.entries(record[section] ?? {}).map(([name, rec]) => [section, name, rec] as const),
  );

/** Asks the registry about each name, six at a time; an unanswered name maps to its error. */
async function ask(registry: Registry, names: string[]): Promise<Map<string, Release[] | Error>> {
  const answers = new Map<string, Release[] | Error>();
  let next = 0;
  const worker = async () => {
    for (let name = names[next++]; name !== undefined; name = names[next++]) {
      answers.set(name, await registry.npm(name).then(stableReleases, (error: Error) => error));
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, names.length) }, worker));
  return answers;
}

/** The ranges every package in the lockfile asks of `name`. */
const rangesFor = (lock: Lockfile, name: string) =>
  Object.values(lock.packages).flatMap((entry) => entry?.dependencies?.[name] ?? []);

/** What `--update` would do: the releases to adopt, the refreshed record, and lines to print. */
export async function planUpdate(root: string, options: NetworkOptions = {}) {
  const day = options.today ?? todayUtc();
  const registry = options.registry ?? NETWORK;
  const { lock, record: current } = readRepository(root);
  const record: DepsRecord = structuredClone(current);
  const adoptions: Adoption[] = [];
  const notes: string[] = [];
  const failures: Finding[] = [];
  const answers = await ask(
    registry,
    npmRecords(record).map(([, name]) => name),
  );
  /** Refreshes `newest`, `qualifying` (within its line) and `next`; returns the release to adopt, if any. */
  const refresh = (rec: PinRecord, releases: Release[], admits: (version: string) => boolean) => {
    const sameLine = (a: string) => (r: Release) => lineOf(r.version) === lineOf(a);
    rec.newest = releases.filter((r) => sameLine(rec.pin.version)(r) && admits(r.version)).at(-1) ?? rec.pin;
    const q = rec.qualifying && newestQualified(releases.filter(sameLine(rec.qualifying.version)), day);
    if (q && rec.qualifying && compareVersions(q.version, rec.qualifying.version) > 0) rec.qualifying = q;
    const followed = rec.follows === undefined ? undefined : lookup(record, rec.follows);
    const next = !followed
      ? firstOfNextLine(releases, rec.pin.version)
      : followed.next && releases.find(sameLine(followed.next.version));
    rec.next = next ? { ...next, qualifies: followed?.next?.qualifies ?? qualifiesOn(next.date) } : null;
    return compareVersions(rec.newest.version, rec.pin.version) > 0 ? rec.newest : undefined;
  };
  try {
    const node = record.platform.node;
    const releases = evenLines(stableReleases(await registry.node()));
    const newest = newestInLine(releases, node.pin.version);
    const next = firstOfNextLine(releases, node.pin.version);
    node.next = next ? { ...next, qualifies: qualifiesOn(next.date) } : null;
    if (newest && compareVersions(newest.version, node.pin.version) > 0) {
      notes.push(
        `node ${newest.version} (${newest.date}) is newer than .nvmrc's ${node.pin.version}: write it to .nvmrc and ${RECORD}, then run bash scripts/setup.sh`,
      );
    }
  } catch (error) {
    notes.push(
      `Node's release index did not answer (${(error as Error).message.split('\n')[0]}): Node was not checked`,
    );
  }
  // Packages that follow another (`@types/three` → `three`) come after it, so its `next` is fresh.
  const ordered = npmRecords(record).sort(([, , a], [, , b]) => Number(!!a.follows) - Number(!!b.follows));
  for (const [section, name, rec] of ordered) {
    const releases = answers.get(name);
    if (!(releases instanceof Array)) {
      const why = (releases as Error | undefined)?.message.split('\n')[0] ?? 'no answer';
      failures.push({
        id: 'DEPS_REGISTRY',
        message: `the registry did not answer for ${name} (${why}): run it again online`,
      });
      continue;
    }
    const ranges = section === 'types' ? rangesFor(lock, name) : [];
    const to = refresh(rec, releases, (version) => ranges.every((range) => satisfies(version, range)));
    if (to) adoptions.push({ section, name, from: rec.pin.version, to });
  }
  return { day, record, adoptions, notes, failures, changed: JSON.stringify(record) !== JSON.stringify(current) };
}

/** Writes `tools/deps.json`, formatted as Prettier formats it. */
async function writeRecord(root: string, record: DepsRecord) {
  const prettier = await import('prettier');
  const file = join(root, RECORD);
  const options = (await prettier.resolveConfig(file)) ?? {};
  writeFileSync(file, await prettier.format(JSON.stringify(record, null, 2), { ...options, filepath: file }));
}

/** `--update`: adopts what `planUpdate` found (unless `dryRun`), rewrites the record, then runs T0 and T1. */
export async function update(root: string, options: NetworkOptions & { dryRun?: boolean } = {}) {
  const plan = await planUpdate(root, options);
  const run = options.run ?? SPAWN;
  const lines = plan.adoptions.map(({ name, from, to }) => `adopt ${name} ${from} → ${to.version} (${to.date})`);
  const failures = [...plan.failures];
  const step = (command: string, args: string[]) => {
    const result = run(command, args, root);
    if (result.status !== 0) {
      const tail = result.output.trim().split('\n').slice(-3).join(' | ');
      failures.push({
        id: 'DEPS_STEP',
        message: `${command} ${args.join(' ')} failed (exit ${result.status}): ${tail}`,
      });
    }
    return result.status === 0;
  };
  if (options.dryRun || failures.length || (!plan.adoptions.length && !plan.changed)) {
    return { plan, lines: [...lines, ...plan.notes], failures, wrote: false };
  }
  const group = (section: Adoption['section']) =>
    plan.adoptions
      .filter((a) => a.section === section)
      .map((a) => (section === 'types' ? a.name : `${a.name}@${a.to.version}`));
  const installed =
    (!group('dependencies').length ||
      step('npm', ['install', '--save-exact', '--save-prod', ...group('dependencies')])) &&
    (!group('devDependencies').length ||
      step('npm', ['install', '--save-exact', '--save-dev', ...group('devDependencies')])) &&
    (!group('types').length || step('npm', ['update', ...group('types')]));
  if (!installed) return { plan, lines, failures, wrote: false };

  const { pkg, lock } = readRepository(root);
  for (const { section, name } of plan.adoptions) {
    const rec = plan.record[section][name];
    const held = section === 'types' ? lock.packages[`node_modules/${name}`]?.version : pkg[section]?.[name];
    if (rec.newest && rec.newest.version === held) rec.pin = rec.newest;
    else {
      rec.newest = rec.pin;
      lines.push(`${name} stayed at ${held}: what depends on it holds it back (npm explain ${name})`);
    }
  }
  const { pulled } = typesInLock(lock);
  const typesDeps: DepsRecord['typesDeps'] = {};
  for (const [name, { version, via }] of [...pulled].sort(([a], [b]) => a.localeCompare(b))) {
    typesDeps[name] = {
      ...plan.record.typesDeps[name],
      version,
      via,
      reason: plan.record.typesDeps[name]?.reason ?? '',
    };
    if (!typesDeps[name].reason) lines.push(`write the reason for ${name} (via ${via}) in ${RECORD}'s typesDeps`);
  }
  plan.record.typesDeps = typesDeps;
  plan.record.measured = plan.day;
  await writeRecord(root, plan.record);
  if (step('npm', ['run', 'check'])) step('npm', ['test']);
  return { plan, lines: [...lines, ...plan.notes], failures, wrote: true };
}

/** One line that has qualified beyond its pin: an upgrade WP to schedule. */
export interface Qualified {
  name: string;
  /** The line's first release, and the day the line qualified. */
  first: Release;
  qualified: string;
  /** What the upgrade pins: the newest release of that line. */
  target: Release;
}

/** `--qualify`: the lines that have qualified beyond each pin (direct dependencies and Node). */
export async function qualify(root: string, options: NetworkOptions = {}) {
  const day = options.today ?? todayUtc();
  const registry = options.registry ?? NETWORK;
  const { record } = readRepository(root);
  const leaders = SECTIONS.flatMap((section) => Object.entries(record[section] ?? {})).filter(
    ([, rec]) => !rec.follows,
  );
  const answers = await ask(
    registry,
    leaders.map(([name]) => name),
  );
  const failures: Finding[] = [];
  const upgrades: Qualified[] = [];
  const consider = (name: string, pin: string, releases: Release[]) => {
    const q = newestQualified(releases, day);
    if (!q || compareVersions(lineOf(q.version), lineOf(pin)) <= 0) return;
    const first = releases.find((r) => lineOf(r.version) === lineOf(q.version)) as Release;
    upgrades.push({
      name,
      first,
      qualified: qualifiesOn(first.date),
      target: newestInLine(releases, q.version) as Release,
    });
  };
  for (const [name, rec] of leaders) {
    const releases = answers.get(name);
    if (releases instanceof Array) consider(name, rec.pin.version, releases);
    else
      failures.push({ id: 'DEPS_REGISTRY', message: `the registry did not answer for ${name}: run it again online` });
  }
  try {
    consider('node', record.platform.node.pin.version, evenLines(stableReleases(await registry.node())));
  } catch (error) {
    failures.push({ id: 'DEPS_REGISTRY', message: `Node's release index did not answer: ${(error as Error).message}` });
  }
  const lines = upgrades.map(
    (u) =>
      `${u.name} ${lineName(u.first.version)} qualified on ${u.qualified} (${u.first.version}, ${u.first.date}): an upgrade WP pins ${u.target.version} (${u.target.date})`,
  );
  return { upgrades, lines, failures };
}
