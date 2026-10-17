/**
 * @file `node x feel <lab> [--course <name,…|all>]` (PLAN.md WP 13.4, docs/PLAYGROUND.md §9.1): runs a lab's feel
 * courses headless and judges every number against its reference and tolerance (engine/dev/feel/run.ts). It imports
 * the lab's scenes (labs/<lab>/scenes/*.ts) and courses (labs/<lab>/courses/*.ts, each a `defineCourse('course:<lab>-
 * <name>', …)`), the animation library first, as the pages load it; `--course` names courses by name (`strip`), several
 * by commas, `all` by default. Each course's verdicts go to `out/feel/<lab>-<name>/report.json`, a measure a metric
 * (its value, reference, how far off and whether it passed); one line per course is printed, and a miss is a failure
 * (`FEEL_MISS`) naming the number, its reference and its tolerance; a watched measure that misses is a warning
 * (`FEEL_WATCHED`, naming the WP that will make it pass). Exit 0 when every judged measure passes, 1 on a miss, 2
 * on a usage error (no such lab, a lab without courses, a course name it lacks, which names the closest).
 *
 * Invariants: each course runs in a session of its own, so the order of courses never changes a number; the command
 * reads the lab's files and writes only under out/feel/.
 *
 * @example
 * // node x feel labs/playground --course strip,jump
 * // x feel: ok: labs/playground: 3 courses, 31 measures, all within their tolerances
 * @see tools/cmd/feel.test.ts
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { listCourses, type Course } from '../../engine/dev/feel/course';
import { runCourse, type MeasureResult } from '../../engine/dev/feel/run';
import { defineLibrary } from '../anim/library';
import { makeReport, writeReport, type Artifact, type Finding } from '../lib/report';
import { closest, UsageError, type Command } from '../x';

/** The lab a target names (`labs/playground`, `labs/playground/` or `playground`), and its directory. */
export function labOf(root: string, target: string): { lab: string; dir: string } {
  const lab = target.replace(/^labs\//, '').replace(/\/+$/, '');
  const dir = `labs/${lab}`;
  if (!/^[\w-]+$/.test(lab) || !existsSync(join(root, dir)) || !statSync(join(root, dir)).isDirectory()) {
    const labs = existsSync(join(root, 'labs')) ? readdirSync(join(root, 'labs')).sort() : [];
    throw new UsageError(`${target} is no lab (labs: ${labs.join(', ') || 'none'})`);
  }
  return { lab, dir };
}

/** Imports every module of `dir` but its tests, in name order. */
async function importAll(root: string, dir: string): Promise<void> {
  if (!existsSync(join(root, dir))) return;
  const files = readdirSync(join(root, dir)).filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'));
  for (const file of files.sort()) await import(pathToFileURL(join(root, dir, file)).href);
}

/** A course's name in its lab: its id without `course:<lab>-`. */
export const courseName = (course: Course, lab: string): string => course.id.replace(`course:${lab}-`, '');

/** A number for reading: four significant digits at most. */
const show = (value: number) => (Number.isFinite(value) ? String(Number(value.toPrecision(4))) : String(value));

/** A measure's tolerance for reading: `±2%`, `±0.3`, `±1 tick`; several are "or". */
export function toleranceText({ share, abs, ticks }: MeasureResult['tolerance']): string {
  const parts = [
    ...(share !== undefined ? [`±${show(share * 100)}%`] : []),
    ...(abs !== undefined ? [`±${show(abs)}`] : []),
    ...(ticks !== undefined ? [`±${ticks} tick${ticks === 1 ? '' : 's'}`] : []),
  ];
  return parts.join(' or ');
}

/** A miss as a sentence: the number, its reference and its tolerance. */
export const missText = (course: string, r: MeasureResult): string =>
  `${course}: ${r.name} (${r.metric}) is ${show(r.value)} against ${show(r.reference)} ${toleranceText(r.tolerance)}`;

export default {
  usage: 'feel <lab> [--course <name,…|all>]',
  options: { course: { type: 'string' } },
  maxPositionals: 1,
  async run({ values, positionals, root }) {
    const target = positionals[0];
    if (!target) throw new UsageError('name a lab: node x feel labs/playground [--course <name,…|all>]');
    const { lab, dir } = labOf(root, target);
    defineLibrary(); // the sim reads no files: the animation library's sets come first, as in the pages
    await importAll(root, `${dir}/scenes`);
    await importAll(root, `${dir}/courses`);
    const own = listCourses().filter((course) => course.id.startsWith(`course:${lab}-`));
    if (!own.length) throw new UsageError(`${dir}/courses/ defines no course: defineCourse('course:${lab}-<name>', …)`); // prettier-ignore
    const names = own.map((course) => courseName(course, lab));
    const wanted = String(values.course ?? 'all');
    const asked = wanted === 'all' ? names : wanted.split(',').map((name) => name.trim());
    for (const name of asked) {
      if (!names.includes(name)) throw new UsageError(`${dir} has no course ${name} (did you mean ${closest(name, names)}? courses: ${names.join(', ')})`); // prettier-ignore
    }
    const lines: string[] = [];
    const failures: Finding[] = [];
    const warnings: Finding[] = [];
    const metrics: Record<string, number | boolean> = {};
    const artifacts: Artifact[] = [];
    let measures = 0;
    for (const name of asked) {
      const course = own[names.indexOf(name)];
      const started = performance.now();
      const result = runCourse(course);
      const numbers = Object.fromEntries(result.results.flatMap((r) => [[`${r.name}.value`, r.value], [`${r.name}.reference`, r.reference], [`${r.name}.off`, r.off], [`${r.name}.pass`, r.pass]])); // prettier-ignore
      const misses = result.results.filter((r) => !r.pass && r.watch === undefined);
      const watched = result.results.filter((r) => !r.pass && r.watch !== undefined);
      const findings = misses.map((r): Finding => ({ id: 'FEEL_MISS', message: missText(name, r) }));
      warnings.push(...watched.map((r): Finding => ({ id: 'FEEL_WATCHED', message: `${missText(name, r)}, until ${r.watch}` }))); // prettier-ignore
      const report = makeReport({ tool: 'x feel', args: { lab, course: name }, ms: performance.now() - started, ok: result.pass, root, failures: findings, metrics: { ...numbers, hash: result.hash, steps: result.steps } }); // prettier-ignore
      const path = writeReport(root, 'feel', `${lab}-${name}`, report);
      artifacts.push({ path, kind: 'json', describes: `the course ${course.id}: each measure against its reference` });
      failures.push(...findings);
      measures += result.results.length;
      for (const r of result.results) metrics[`${name}.${r.name}`] = r.value;
      metrics[`${name}.pass`] = result.pass;
      const passed = result.results.filter((r) => r.pass).length;
      const missed = misses.length ? `; missed: ${misses.map((r) => r.name).join(', ')}` : '';
      const watching = watched.length ? `; watched: ${watched.map((r) => `${r.name} (${r.watch})`).join(', ')}` : '';
      lines.push(`${name}: ${passed} of ${result.results.length} within their tolerances${missed}${watching} (${path})`); // prettier-ignore
    }
    const ok = failures.length === 0;
    const verdict = ok ? 'all within their tolerances' : `${failures.length} missed`;
    return {
      ok,
      target: dir,
      summary: `${dir}: ${asked.length} course${asked.length === 1 ? '' : 's'}, ${measures} measures, ${verdict}`,
      lines,
      failures,
      warnings,
      metrics,
      artifacts,
    };
  },
} satisfies Command;
