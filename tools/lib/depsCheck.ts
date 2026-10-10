/**
 * @file The offline dependency check: package.json, the lockfile, `.nvmrc` and the pinned docs against
 * `tools/deps.json` (PLAN.md §6.10). `x deps --check` runs it, and `x check` runs it as its `deps` plugin.
 *
 * It fails when a pin differs from the record; when a package (direct, a lockfile `@types/*` or `@webgpu/*`, or
 * what a types package pulls in) is unrecorded, or recorded but gone; when a pin lacks a reason; when its rule does
 * not admit it (too new for its qualifying release's line, an ADR or a measurement missing); when a pin is older
 * than the newest compatible release recorded; and when a pinned doc does not follow its pin's line. It warns when
 * the active node is not `.nvmrc`'s and when a recorded next line has qualified (schedule its upgrade WP).
 *
 * Invariants: it reads files only (no network, no git), every message names the fix, and the day and the active
 * node are injectable so fixture repositories give the same verdict on any day.
 *
 * @example
 * const { failures, warnings } = checkDeps(process.cwd(), { today: '2026-10-10', nodeVersion: 'v24.21.0' });
 * @see tools/cmd/deps.ts (the rules, per field)
 * @see tools/cmd/deps.test.ts
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CheckOutcome } from '../cmd/check';
import { closest } from '../x';
import {
  compareVersions,
  gitBlob,
  isDay,
  isRelease,
  lineName,
  lineOf,
  lookup,
  parseVersion,
  qualifiesOn,
  readRepository,
  RECORD,
  RULES,
  SECTIONS,
  todayUtc,
  typesInLock,
  type DepsRecord,
  type PinRecord,
  type Repository,
} from './deps';
import type { Finding } from './report';

/** What the check reads besides the files: the day (UTC) and the active node's version. */
export interface CheckDepsOptions {
  today?: string;
  nodeVersion?: string;
}

const ENTRY_KEYS = ['qualifying', 'pin', 'newest', 'rule', 'adr', 'measurement', 'follows', 'next', 'reason'];

/** Collects findings; `fail` points at `tools/deps.json` unless told otherwise. */
class Findings {
  failures: Finding[] = [];
  warnings: Finding[] = [];
  fail(id: string, message: string, file = RECORD) {
    this.failures.push({ id, message, file });
  }
  warn(id: string, message: string, file = RECORD) {
    this.warnings.push({ id, message, file });
  }
}

/** Whether `adr` (`ADR-NNNN`) names a file in docs/decisions/. */
function adrExists(root: string, adr?: string): boolean {
  const dir = join(root, 'docs', 'decisions');
  return !!adr && /^ADR-\d{4}$/.test(adr) && existsSync(dir) && readdirSync(dir).some((f) => f.startsWith(`${adr}-`));
}

/** Checks one record: its shape, its reason, the rule that admits it, `follows`, `newest` and `next`. */
function checkEntry(out: Findings, root: string, record: DepsRecord, day: string, section: string, name: string) {
  const rec = (record as unknown as Record<string, Record<string, PinRecord>>)[section][name];
  const at = `${section}.${name}`;
  for (const key of Object.keys(rec ?? {}).filter((k) => !ENTRY_KEYS.includes(k))) {
    const near = closest(key, ENTRY_KEYS);
    out.fail('DEPS_RECORD', `${at} has an unknown key "${key}"${near ? `: did you mean "${near}"?` : ''}`);
  }
  if (!rec?.reason?.trim()) {
    out.fail('DEPS_REASON', `${name} has no reason in ${RECORD}: say why it is a dependency at all (Common ground)`);
  }
  if (section === 'platform' && name !== 'node') {
    // The environment's browser: its version is the container's, not a registry release (Discovery first).
    if (typeof rec?.pin?.version !== 'string' || rec.rule !== 'platform') {
      out.fail('DEPS_RECORD', `${at} needs "pin": { "version" } and rule "platform"`);
    }
    return;
  }
  if (!isRelease(rec?.pin)) return out.fail('DEPS_RECORD', `${at}.pin must be { "version": "x.y.z", "date": "Y-M-D" }`);
  const { pin, qualifying: q, newest, rule } = rec;
  if (!RULES.includes(rule)) out.fail('DEPS_RECORD', `${at}.rule must be one of: ${RULES.join(', ')}`);
  if (!isRelease(q) || !isRelease(newest)) {
    return out.fail('DEPS_RECORD', `${at} needs "qualifying" and "newest", each { "version", "date" }`);
  }
  if (qualifiesOn(q.date) > record.measured) {
    out.fail(
      'DEPS_QUALIFYING',
      `${name}'s qualifying ${q.version} (${q.date}) was not 12 months old on ${record.measured}`,
    );
  }
  if (lineOf(newest.version) !== lineOf(pin.version) || compareVersions(newest.version, pin.version) < 0) {
    out.fail('DEPS_RECORD', `${at}.newest must be the newest release of the pin's line (${lineName(pin.version)})`);
  } else if (compareVersions(pin.version, newest.version) < 0) {
    out.fail(
      'DEPS_BEHIND',
      `${name} ${pin.version} is older than the newest compatible release recorded, ${newest.version} (${newest.date}): node x deps --update adopts it`,
    );
  }
  const order = compareVersions(lineOf(pin.version), lineOf(q.version));
  if (rule === 'qualifies' && qualifiesOn(pin.date) > day) {
    out.fail(
      'DEPS_TOO_NEW',
      `${name} ${pin.version} (${pin.date}) is too new for rule "qualifies": it is 12 months old on ${qualifiesOn(pin.date)}`,
    );
  } else if (rule === 'compatible' && order > 0) {
    out.fail(
      'DEPS_TOO_NEW',
      `${name} ${pin.version} is too new: it is not backward compatible with its qualifying release ${q.version} (line ${lineName(q.version)}). It waits until its line qualifies, unless an ADR shows it works the same way (rule "same-way") or a measurement admits an internal (rule "internals")`,
    );
  } else if (rule === 'compatible' && (order < 0 || compareVersions(pin.version, q.version) < 0)) {
    const fix = order < 0 ? 'its upgrade WP is due (PLAN.md §9)' : 'pin the newest release of its line';
    out.fail('DEPS_TOO_OLD', `${name} ${pin.version} is older than its qualifying release ${q.version}: ${fix}`);
  } else if (rule === 'same-way' && !adrExists(root, rec.adr)) {
    out.fail('DEPS_ADR', `${name} is admitted as working the same way: "adr" must name its ADR (ADR-NNNN)`);
  } else if (rule === 'internals' && !rec.measurement?.trim()) {
    out.fail('DEPS_MEASUREMENT', `${name} is admitted as an internal: "measurement" must say what measured better`);
  } else if (rule === 'platform' && section !== 'platform') {
    out.fail('DEPS_RULE', `${name}: rule "platform" is for the platform's Node and Chromium only`);
  }
  const followed = rec.follows === undefined ? undefined : lookup(record, rec.follows);
  if (rec.follows !== undefined && !followed) {
    out.fail('DEPS_RECORD', `${at}.follows names "${rec.follows}", which ${RECORD} does not record`);
  } else if (followed && isRelease(followed.pin) && lineOf(followed.pin.version) !== lineOf(pin.version)) {
    const line = lineName(followed.pin.version);
    out.fail('DEPS_FOLLOWS', `${name} ${pin.version} must stay on ${rec.follows}'s line (${line}): pin them together`);
  }
  if (rec.next === null) return;
  const due = followed ? followed.next?.qualifies : isDay(rec.next?.date) ? qualifiesOn(rec.next.date) : undefined;
  if (!isRelease(rec.next) || compareVersions(lineOf(rec.next.version), lineOf(pin.version)) <= 0) {
    out.fail(
      'DEPS_RECORD',
      `${at}.next must be null or a later line's first release, { "version", "date", "qualifies" }`,
    );
  } else if (rec.next.qualifies !== due) {
    out.fail('DEPS_RECORD', `${at}.next.qualifies must be ${due ?? 'the day its line qualifies'}`);
  } else if (!followed && rec.next.qualifies <= day) {
    out.warn(
      'DEPS_QUALIFIED',
      `${name} ${rec.next.version}'s line qualified on ${rec.next.qualifies}: schedule its upgrade WP (node x deps --qualify; PLAN.md §9)`,
    );
  }
}

/** package.json's pins against the record and the lockfile. */
function checkDirect(out: Findings, { pkg, lock, record }: Repository, entry: (s: string, n: string) => void) {
  for (const section of SECTIONS) {
    const declared = pkg[section] ?? {};
    const recorded = record[section] ?? {};
    for (const name of new Set([...Object.keys(declared), ...Object.keys(recorded)])) {
      const spec = declared[name];
      const pinned = recorded[name]?.pin?.version;
      if (spec === undefined) {
        out.fail('DEPS_STALE', `${RECORD} lists ${name} under ${section}, but package.json's ${section} lacks it`);
      } else if (!recorded[name]) {
        out.fail(
          'DEPS_UNRECORDED',
          `${name} (package.json ${section}) is not in ${RECORD}: record its qualifying release, pin, rule and reason`,
        );
      } else if (!parseVersion(spec)) {
        out.fail('DEPS_RANGE', `package.json must pin ${name} exactly, not as the range "${spec}"`, 'package.json');
      } else if (spec !== pinned) {
        const message = `package.json pins ${name} ${spec}; ${RECORD} records ${pinned}: run node x deps --update, or restore the pin`;
        out.fail('DEPS_PIN', message, 'package.json');
      } else if (
        lock.packages['']?.[section]?.[name] !== spec ||
        lock.packages[`node_modules/${name}`]?.version !== spec
      ) {
        out.fail('DEPS_LOCK', `package-lock.json does not hold ${name} ${spec}: run npm install`, 'package-lock.json');
      }
      if (recorded[name]) entry(section, name);
    }
  }
}

/** The lockfile's other types packages, and what types packages pull in, against the record. */
function checkTypes(out: Findings, { pkg, lock, record }: Repository, entry: (s: string, n: string) => void) {
  const direct = new Set(SECTIONS.flatMap((section) => Object.keys(pkg[section] ?? {})));
  const { types, pulled } = typesInLock(lock);
  for (const name of new Set([...types.keys(), ...Object.keys(record.types ?? {})])) {
    if (direct.has(name)) continue;
    const held = [...(types.get(name) ?? [])];
    const rec = record.types?.[name];
    if (!held.length) {
      out.fail('DEPS_STALE', `${RECORD} lists ${name} under types, but the lockfile no longer holds it: remove it`);
    } else if (!rec) {
      out.fail('DEPS_UNRECORDED', `the lockfile's ${name} ${held.join(', ')} is not in ${RECORD}'s types: record it`);
    } else if (held.length > 1 || held[0] !== rec.pin?.version) {
      const message = `the lockfile holds ${name} ${held.join(' and ')}; ${RECORD} records ${rec.pin?.version}: run node x deps --update`;
      out.fail('DEPS_PIN', message);
    }
    if (rec) entry('types', name);
  }
  for (const name of new Set([...pulled.keys(), ...Object.keys(record.typesDeps ?? {})])) {
    const found = pulled.get(name);
    const rec = record.typesDeps?.[name];
    if (!found) {
      out.fail('DEPS_STALE', `${RECORD} lists ${name} under typesDeps, but no types package pulls it in: remove it`);
    } else if (!rec) {
      out.fail('DEPS_UNRECORDED', `${found.via} pulls in ${name} ${found.version}: record it in ${RECORD}'s typesDeps`);
    } else if (rec.version !== found.version || rec.via !== found.via) {
      const message = `the lockfile holds ${name} ${found.version} via ${found.via}; ${RECORD} records ${rec.version} via ${rec.via}: update the record`;
      out.fail('DEPS_PIN', message);
    }
    if (rec && !rec.reason?.trim()) out.fail('DEPS_REASON', `${name} has no reason in ${RECORD}'s typesDeps`);
  }
}

/** Each pinned document: it follows its pin's line, names its revision, and holds its source's blob unchanged. */
function checkKnowledge(out: Findings, root: string, record: DepsRecord) {
  for (const [file, doc] of Object.entries(record.knowledge ?? {})) {
    const followed = lookup(record, doc.follows);
    if (!followed || !isRelease(followed.pin)) {
      out.fail('DEPS_KNOWLEDGE', `knowledge ${file} follows "${doc.follows}", which ${RECORD} does not record`);
    } else if (lineName(followed.pin.version) !== doc.line) {
      const message = `${file} is written for ${doc.follows} ${doc.line}, but the pin is ${followed.pin.version}: move it with the upgrade (PLAN.md §9, Upgrade work packages)`;
      out.fail('DEPS_KNOWLEDGE', message);
    }
    if (!existsSync(join(root, file))) {
      const how = doc.revision ? `take ${doc.page} at ${doc.revision} from ${doc.source}` : 'write it';
      out.fail('DEPS_KNOWLEDGE', `${file} is missing: ${how}`, file);
      continue;
    }
    const text = readFileSync(join(root, file));
    if (doc.revision && !text.includes(doc.revision)) {
      out.fail('DEPS_KNOWLEDGE', `${file}'s header must name its revision, ${doc.revision}`, file);
    }
    const end = text.indexOf('-->\n');
    if (doc.blob && (end < 0 || gitBlob(text.subarray(end + 4)) !== doc.blob)) {
      const message = `${file}'s text after its header comment is not ${doc.page}'s blob ${doc.blob}: take it again, unchanged (git show ${doc.revision?.slice(0, 7)}:${doc.page})`;
      out.fail('DEPS_KNOWLEDGE', message, file);
    }
  }
}

/** The offline dependency check (`x deps --check`; the `deps` plugin of `x check`). */
export function checkDeps(root: string, options: CheckDepsOptions = {}): CheckOutcome {
  const day = options.today ?? todayUtc();
  const out = new Findings();
  let repo: Repository;
  try {
    repo = readRepository(root);
  } catch (error) {
    return { failures: [{ id: 'DEPS_READ', message: `${(error as Error).message}: restore it (git checkout)` }] };
  }
  const { record, nvmrc } = repo;
  if (!isDay(record.measured)) out.fail('DEPS_RECORD', `${RECORD} needs "measured": the day its dates were read`);
  let pins = 0;
  const entry = (section: string, name: string) => {
    pins++;
    checkEntry(out, root, record, day, section, name);
  };
  checkDirect(out, repo, entry);
  checkTypes(out, repo, entry);

  const node = record.platform?.node;
  if (!node || !record.platform?.chromium)
    out.fail('DEPS_RECORD', `${RECORD}'s platform must record node and chromium`);
  for (const name of Object.keys(record.platform ?? {})) checkEntry(out, root, record, day, 'platform', name);
  if (node && nvmrc !== node.pin?.version) {
    out.fail('DEPS_PIN', `.nvmrc says "${nvmrc}"; ${RECORD} records Node ${node.pin?.version}`, '.nvmrc');
  }
  const active = (options.nodeVersion ?? process.version).replace(/^v/, '');
  if (nvmrc && active !== nvmrc) {
    const message = `the active node is ${active}, not .nvmrc's ${nvmrc}: run bash scripts/setup.sh, which installs ${nvmrc} and puts it first on PATH`;
    out.warn('DEPS_NODE', message, '.nvmrc');
  }
  checkKnowledge(out, root, record);

  const soonest = Object.entries({ ...record.dependencies, ...record.devDependencies, ...record.platform })
    .flatMap(([name, rec]) => (rec?.next && !rec.follows && rec.next.qualifies > day ? [{ name, next: rec.next }] : []))
    .sort((a, b) => a.next.qualifies.localeCompare(b.next.qualifies))[0];
  const typesDeps = Object.keys(record.typesDeps ?? {}).length;
  return {
    failures: out.failures,
    warnings: out.warnings,
    summary:
      `${pins} pins and ${typesDeps} types dependencies match ${RECORD}` +
      (soonest ? `; next to qualify: ${soonest.name} ${soonest.next.version} on ${soonest.next.qualifies}` : ''),
    metrics: { pins, typesDeps, node: active, ...(soonest ? { nextQualifies: soonest.next.qualifies } : {}) },
  };
}
