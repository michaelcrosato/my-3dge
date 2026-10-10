/**
 * @file The dependency record (`tools/deps.json`) and the model behind `x deps` (PLAN.md §6.10, doctrine: Mastery):
 * versions and their lines, the 12-month rule, registry answers, and the lockfile's types packages.
 *
 * Invariants: a line is semver's compatible range, named by its lowest version (3.2.7 → 3.0.0; 0.182.1 →
 * 0.182.0). A release qualifies on the same calendar day 12 months after it was published, UTC. Only stable,
 * published releases at or below the `latest` tag count (three.js's registry `time` still lists an unpublished
 * 1.58.1). Nothing here touches the network or writes a file.
 *
 * @example
 * lineOf('0.182.0'); // '0.182.0' — so 0.183.0 is another line
 * qualifiesOn('2025-10-22'); // '2026-10-22'
 * newestInLine(stableReleases({ time: { '3.2.4': '2025-06-17', '3.2.7': '2026-07-06' } }), '3.2.4'); // 3.2.7
 * @see tools/cmd/deps.ts (the rules, per field)
 * @see tools/cmd/deps.test.ts
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** How a pin is admitted (PLAN.md §6.10): see tools/cmd/deps.ts's file comment. */
export type Rule = 'qualifies' | 'compatible' | 'same-way' | 'internals' | 'platform';
/** Every rule, in the order the plan lists them. */
export const RULES: readonly Rule[] = ['qualifies', 'compatible', 'same-way', 'internals', 'platform'];

/** A release and the day it was published (`YYYY-MM-DD`, UTC). */
export interface Release {
  version: string;
  date: string;
}
/** The next line's first release, and the day it qualifies. */
export interface NextLine extends Release {
  qualifies: string;
}
/** One package's record in `tools/deps.json`. */
export interface PinRecord {
  /** The newest release that was 12 months old on `measured`. */
  qualifying?: Release;
  /** The release package.json (or `.nvmrc`, or the lockfile) holds. */
  pin: Release;
  /** The newest release of the pin's line, as `x deps --update` last saw it. */
  newest?: Release;
  rule: Rule;
  /** The ADR that shows a `same-way` pin works the same way (`ADR-NNNN`). */
  adr?: string;
  /** What an `internals` pin measured better at. */
  measurement?: string;
  /** A package whose line this one shares (`@types/three` → `three`; `@types/node` → `node`). */
  follows?: string;
  next: NextLine | null;
  /** Why it is a dependency at all (doctrine: Common ground). */
  reason: string;
}
/** A package that a types package pulls in and that is not types itself. */
export interface TypesDep {
  version: string;
  /** The types package that pulls it in. */
  via: string;
  reason: string;
}
/** A pinned document that follows a pin's line; `blob` is the git blob of its text after the header comment. */
export interface Knowledge {
  follows: string;
  /** The line it is written for, as `lineName` prints it: `0.182.x`. */
  line: string;
  source?: string;
  page?: string;
  revision?: string;
  date?: string;
  blob?: string;
}
/** `tools/deps.json`. */
export interface DepsRecord {
  $comment?: string;
  /** The day the registry dates were last read. */
  measured: string;
  dependencies: Record<string, PinRecord>;
  devDependencies: Record<string, PinRecord>;
  types: Record<string, PinRecord>;
  typesDeps: Record<string, TypesDep>;
  platform: Record<string, PinRecord>;
  knowledge: Record<string, Knowledge>;
}

/** The record's path, relative to the repository root. */
export const RECORD = 'tools/deps.json';
/** package.json's sections that `tools/deps.json` mirrors. */
export const SECTIONS = ['dependencies', 'devDependencies'] as const;
/** The types packages the rule also covers: `@types/*` and `@webgpu/*`. */
export const TYPES = /^@(types|webgpu)\//;

/** Parses a stable release `x.y.z` (no prerelease), else undefined. */
export function parseVersion(version: string): [number, number, number] | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

/** Orders two versions: negative when `a` is older. */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [parseVersion(a) ?? [0, 0, 0], parseVersion(b) ?? [0, 0, 0]];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

/** A version's line, as its lowest version: 3.2.7 → 3.0.0, 0.182.1 → 0.182.0, 0.0.4 → 0.0.4. */
export function lineOf(version: string): string {
  const [major, minor, patch] = parseVersion(version) ?? [0, 0, 0];
  return major > 0 ? `${major}.0.0` : minor > 0 ? `0.${minor}.0` : `0.0.${patch}`;
}

/** A line's name, for messages and `knowledge`: `3.x`, `0.182.x`, `0.0.4`. */
export function lineName(version: string): string {
  const [major, minor] = parseVersion(lineOf(version)) ?? [0, 0, 0];
  return major > 0 ? `${major}.x` : minor > 0 ? `0.${minor}.x` : lineOf(version);
}

/** The day a release published on `date` turns 12 months old (a 29 February release: 1 March). */
export function qualifiesOn(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year + 1, month - 1, day)).toISOString().slice(0, 10);
}

/** Today, UTC, as `YYYY-MM-DD`. */
export const todayUtc = () => new Date().toISOString().slice(0, 10);
/** Whether `value` is a `YYYY-MM-DD` day. */
export const isDay = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
/** Whether `value` is a `{ version, date }` release. */
export const isRelease = (value: unknown): value is Release =>
  !!parseVersion((value as Release | undefined)?.version ?? '') && isDay((value as Release).date);

/** Whether `version` satisfies an npm range of the forms lockfiles hold: exact, `^`, `~`, `x`, comparators, `||`. */
export function satisfies(version: string, range: string): boolean {
  const have = parseVersion(version) ?? [0, 0, 0];
  const holds = (part: string) => {
    const match = /^(\^|~|>=|<=|>|<|=)?v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/.exec(part);
    if (!match) return true; // `*`, `x`, a dist-tag: npm decides
    const [op = '', ...parts] = match.slice(1);
    const want = parts.map((p) => (p === undefined || p === 'x' || p === '*' ? undefined : Number(p)));
    const floor = want.map((n) => n ?? 0).join('.');
    const order = compareVersions(version, floor);
    if (op === '>=') return order >= 0;
    if (op === '>') return order > 0;
    if (op === '<=') return order <= 0;
    if (op === '<') return order < 0;
    if (op === '^') return order >= 0 && lineOf(version) === lineOf(floor);
    if (op === '~') return order >= 0 && have[0] === want[0] && have[1] === (want[1] ?? have[1]);
    return want.every((n, i) => n === undefined || n === have[i]);
  };
  return range.split('||').some((alternative) => alternative.trim().split(/\s+/).every(holds));
}

/** What a registry says about a package: publish times by version, and the published versions and `latest` tag. */
export interface RegistryAnswer {
  time: Record<string, string>;
  versions?: string[];
  latest?: string;
}

/** A registry answer's stable, published releases, oldest first, none above its `latest` tag. */
export function stableReleases(answer: RegistryAnswer): Release[] {
  const published = answer.versions && new Set(answer.versions.map((v) => v.replace(/^v/, '')));
  return Object.entries(answer.time)
    .map(([version, date]) => ({ version: version.replace(/^v/, ''), date: date.slice(0, 10) }))
    .filter(({ version }) => parseVersion(version) && (!published || published.has(version)))
    .filter(({ version }) => !answer.latest || compareVersions(version, answer.latest) <= 0)
    .sort((a, b) => compareVersions(a.version, b.version));
}

/** The newest release of `version`'s line. */
export const newestInLine = (releases: Release[], version: string) =>
  releases.filter((r) => lineOf(r.version) === lineOf(version)).at(-1);
/** The newest release that is 12 months old on `day`. */
export const newestQualified = (releases: Release[], day: string) =>
  releases.filter((r) => qualifiesOn(r.date) <= day).at(-1);
/** The first release of a later line than `version`'s. */
export const firstOfNextLine = (releases: Release[], version: string) =>
  releases.find((r) => compareVersions(lineOf(r.version), lineOf(version)) > 0);
/** Node's releases on even lines only: odd lines never get LTS and are skipped (§6.10, rule 6). */
export const evenLines = (releases: Release[]) => releases.filter((r) => (parseVersion(r.version)?.[0] ?? 1) % 2 === 0);

/** The parts of package-lock.json (v3) the tools read. */
export interface Lockfile {
  packages: Record<string, LockEntry | undefined>;
}
/** One lockfile entry: a package's version and what it depends on (the root entry also lists dev dependencies). */
export interface LockEntry {
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}
/** The files `x deps` reads. */
export interface Repository {
  pkg: Partial<Record<(typeof SECTIONS)[number], Record<string, string>>>;
  lock: Lockfile;
  record: DepsRecord;
  /** `.nvmrc`'s version, trimmed; empty when there is none. */
  nvmrc: string;
}

/** Reads package.json, the lockfile, `tools/deps.json` and `.nvmrc`; throws a message naming the file. */
export function readRepository(root: string): Repository {
  const json = (file: string) => {
    try {
      return JSON.parse(readFileSync(join(root, file), 'utf8'));
    } catch (error) {
      throw new Error(`${file} could not be read: ${(error as Error).message.split('\n')[0]}`, { cause: error });
    }
  };
  const nvmrc = existsSync(join(root, '.nvmrc')) ? readFileSync(join(root, '.nvmrc'), 'utf8').trim() : '';
  return { pkg: json('package.json'), lock: json('package-lock.json'), record: json(RECORD), nvmrc };
}

/** The package name at a lockfile path: `node_modules/a/node_modules/@b/c` → `@b/c`. */
const nameOf = (path: string) => path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);

/** Where `name` resolves from the package at lockfile path `from`: Node's lookup, innermost `node_modules` first. */
function resolveIn(lock: Lockfile, from: string, name: string): string | undefined {
  for (let base = from; ;) {
    const candidate = `${base ? `${base}/` : ''}node_modules/${name}`;
    if (lock.packages[candidate]) return candidate;
    if (!base) return undefined;
    const cut = base.lastIndexOf('/node_modules/');
    base = cut < 0 ? '' : base.slice(0, cut);
  }
}

/** The packages a lockfile entry depends on (the root's development dependencies included). */
function dependenciesOf(lock: Lockfile, path: string): string[] {
  const entry = lock.packages[path];
  const root = path === '' ? entry?.devDependencies : undefined;
  return Object.keys({ ...entry?.dependencies, ...entry?.optionalDependencies, ...entry?.peerDependencies, ...root });
}

/** Walks the lockfile from `starts`, never into types packages; returns each path reached, with who reached it. */
function reach(lock: Lockfile, starts: string[]): Map<string, string> {
  const reached = new Map<string, string>();
  for (const queue = [...starts]; queue.length;) {
    const path = queue.shift() as string;
    for (const dep of dependenciesOf(lock, path)) {
      const target = resolveIn(lock, path, dep);
      if (!target || TYPES.test(dep) || reached.has(target)) continue;
      reached.set(target, reached.get(path) ?? nameOf(path));
      queue.push(target);
    }
  }
  return reached;
}

/**
 * The lockfile's types packages (name → versions held), and the packages that are there only because a types
 * package pulls them in (name → version and that types package): reachable from a types package, but not from the
 * root through other packages.
 */
export function typesInLock(lock: Lockfile) {
  const types = new Map<string, Set<string>>();
  const typePaths = Object.keys(lock.packages).filter((path) => path && TYPES.test(nameOf(path)));
  for (const path of typePaths) {
    types.set(nameOf(path), (types.get(nameOf(path)) ?? new Set()).add(lock.packages[path]?.version ?? ''));
  }
  const needed = reach(lock, ['']);
  const pulled = new Map<string, { version: string; via: string }>();
  for (const [path, via] of reach(lock, typePaths)) {
    if (!needed.has(path)) pulled.set(nameOf(path), { version: lock.packages[path]?.version ?? '', via });
  }
  return { types, pulled };
}

/** The git blob id of `bytes`, as `git hash-object` prints it. */
export const gitBlob = (bytes: Buffer) =>
  createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

/** Finds a record by name in any section; `node` and `chromium` are the platform's. */
export const lookup = (record: DepsRecord, name = ''): PinRecord | undefined =>
  record.platform?.[name] ?? record.dependencies?.[name] ?? record.devDependencies?.[name] ?? record.types?.[name];
