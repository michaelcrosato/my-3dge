/**
 * @file Runs the repository checks no standard tool covers, last in `npm run check` (PLAN.md §8.1).
 *
 * Plugins: the asset scan, here, and the `check` a module in `tools/cmd/` may export (`export const check:
 * CheckPlugin`), which is how dependency pins, docs drift and escalation records arrive (WPs 0.3, 0.6, 0.7).
 *
 * The asset scan (doctrine: Assets) reads every file git tracks or would track. A binary file (by extension, magic
 * bytes or a NUL byte) passes only if `data/APPROVED-BINARIES.json` lists it, `{ path, escalation: "ESC-NNNN",
 * reason }`, with its record in `docs/escalations/`, or if it is a font (WOFF2, TTF, OTF) under `data/fonts/` with
 * its license beside it. A base64 run or `data:` URI over 1 KB fails too. Else: `x esc open --principle Assets`.
 *
 * Lane mode is detected: in a linked git worktree (`--git-dir` differs from `--git-common-dir`), an ultracode lane,
 * a `warnInLane` plugin (docs drift) only warns (§11.3). `X_LANE=0|1` overrides the detection.
 *
 * Usage: node x check. Exit 0 when every plugin passes, 1 otherwise.
 * @see tools/cmd/check.test.ts
 */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Finding } from '../lib/report';
import { closest, commandNames, type Command, type CommandResult } from '../x';

/** What a plugin is given: the repository root, and whether this checkout is an ultracode lane. */
export interface CheckContext {
  root: string;
  lane: boolean;
}

/** What a plugin found. */
export interface CheckOutcome {
  failures: Finding[];
  warnings?: Finding[];
  /** Named numbers for the report, prefixed with the plugin's name by `x check`. */
  metrics?: Record<string, number | string | boolean>;
  /** One short line for the output, such as `214 files`. */
  summary?: string;
}

/** One repository check. A `tools/cmd/<name>.ts` module plugs one in by exporting it as `check`. */
export interface CheckPlugin {
  /** Its name in the output and the metrics: `assets`, `deps`, `docs`, `esc`. */
  name: string;
  /** In an ultracode lane, its failures are warnings: the integrator regenerates what it checks (PLAN.md §11.3). */
  warnInLane?: boolean;
  run(context: CheckContext): CheckOutcome | Promise<CheckOutcome>;
}

/** Extensions of binary formats, by name, so a file is caught even when its bytes look like text. */
const BINARY_EXTENSIONS = new Set(
  (
    'png jpg jpeg gif webp avif bmp ico tif tiff psd exr hdr ktx ktx2 basis dds glb bin wasm fbx blend ' +
    'mp3 wav ogg oga flac m4a aac opus mp4 webm mov avi mkv zip gz tgz bz2 xz 7z rar jar pdf exe dll so dylib ' +
    'woff woff2 ttf otf eot npy npz'
  ).split(' '),
);
/** The pre-approved font formats (DOCTRINE.md, Assets). */
const FONT_EXTENSIONS = new Set(['woff2', 'ttf', 'otf']);
/** Leading bytes of common binary formats, to name what a file is. */
const MAGIC: [string, number[]][] = [
  ['PNG', [0x89, 0x50, 0x4e, 0x47]],
  ['JPEG', [0xff, 0xd8, 0xff]],
  ['GIF', [0x47, 0x49, 0x46, 0x38]],
  ['RIFF (WAV, WebP, AVI)', [0x52, 0x49, 0x46, 0x46]],
  ['Ogg', [0x4f, 0x67, 0x67, 0x53]],
  ['FLAC', [0x66, 0x4c, 0x61, 0x43]],
  ['MP3', [0x49, 0x44, 0x33]],
  ['ZIP', [0x50, 0x4b, 0x03, 0x04]],
  ['gzip', [0x1f, 0x8b]],
  ['PDF', [0x25, 0x50, 0x44, 0x46]],
  ['WebAssembly', [0x00, 0x61, 0x73, 0x6d]],
  ['glTF binary', [0x67, 0x6c, 0x54, 0x46]],
  ['WOFF', [0x77, 0x4f, 0x46, 0x46]],
  ['WOFF2', [0x77, 0x4f, 0x46, 0x32]],
  ['TrueType', [0x00, 0x01, 0x00, 0x00]],
  ['OpenType', [0x4f, 0x54, 0x54, 0x4f]],
  ['ELF', [0x7f, 0x45, 0x4c, 0x46]],
  ['Matroska/WebM', [0x1a, 0x45, 0xdf, 0xa3]],
];
/** The longest embedded run accepted in text: 1 KB. */
const MAX_EMBEDDED = 1024;
const BASE64_RUN = new RegExp(`[A-Za-z0-9+/_-]{${MAX_EMBEDDED + 1},}={0,2}`, 'g');
const DATA_URI = /data:(?:[a-z]+\/[a-z0-9.+-]+)?(?:;[^,\s"'`]*)?,([^\s"'`)]*)/gi;
const LICENSE_NAME = /licen[cs]e|copying|(^|[._-])ofl([._-]|$)/i;
const APPROVALS = 'data/APPROVED-BINARIES.json';
const APPROVAL_KEYS = ['path', 'escalation', 'reason'];
const ASK =
  "needs the owner's approval: x esc open --principle Assets; once approved, list it in data/APPROVED-BINARIES.json with its escalation record. Meanwhile generate it, or keep it as readable text (doctrine: Assets)";

/** What binary format `bytes` (a file named `path`) is, or undefined for text. */
export function binaryKind(path: string, bytes: Buffer): string | undefined {
  const magic = MAGIC.find(([, lead]) => lead.every((byte, i) => bytes[i] === byte));
  if (magic) return magic[0];
  const extension = extname(path).slice(1).toLowerCase();
  if (BINARY_EXTENSIONS.has(extension)) return `a .${extension} file`;
  if (bytes.subarray(0, 8000).includes(0)) return 'binary (it holds NUL bytes)';
  return undefined;
}

/** The files git tracks or would track under `root`: tracked plus untracked, ignored ones left out. */
export function repositoryFiles(root: string): string[] {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const files = new Set(out.split('\0').filter(Boolean));
  return [...files].filter((file) => existsSync(join(root, file)) && lstatSync(join(root, file)).isFile()).sort();
}

/** The 1-based line of character `index` in `text`. */
const lineAt = (text: string, index: number) => text.slice(0, index).split('\n').length;

/** Reads the approved binaries: path → escalation id, plus a finding for each malformed entry. */
function readApprovals(root: string): { approved: Map<string, string>; failures: Finding[]; warnings: Finding[] } {
  const approved = new Map<string, string>();
  const failures: Finding[] = [];
  const warnings: Finding[] = [];
  const fail = (message: string) => failures.push({ id: 'ASSET_APPROVALS', message, file: APPROVALS });
  if (!existsSync(join(root, APPROVALS))) return { approved, failures, warnings };
  let entries: unknown;
  try {
    entries = JSON.parse(readFileSync(join(root, APPROVALS), 'utf8'));
  } catch (error) {
    fail(`${APPROVALS} is not valid JSON: ${(error as Error).message}`);
    return { approved, failures, warnings };
  }
  if (!Array.isArray(entries)) {
    fail(`${APPROVALS} must be a JSON array of { path, escalation, reason }`);
    return { approved, failures, warnings };
  }
  entries.forEach((entry: Record<string, unknown>, i) => {
    const at = `${APPROVALS}[${i}]`;
    for (const key of Object.keys(entry ?? {})) {
      if (!APPROVAL_KEYS.includes(key)) {
        const near = closest(key, APPROVAL_KEYS);
        fail(
          `${at} has an unknown key "${key}"${near ? `: did you mean "${near}"?` : ''} (keys: path, escalation, reason)`,
        );
      }
    }
    const { path, escalation, reason } = entry ?? {};
    if (typeof path !== 'string' || typeof reason !== 'string' || !reason || typeof escalation !== 'string') {
      return fail(`${at} needs a path, an escalation ("ESC-NNNN") and a reason`);
    }
    const records = existsSync(join(root, 'docs/escalations')) ? readdirSync(join(root, 'docs/escalations')) : [];
    if (!/^ESC-\d{4}$/.test(escalation) || !records.some((name) => name.startsWith(`${escalation}-`))) {
      return fail(
        `${at} approves ${path} with "${escalation}", but no record docs/escalations/${escalation}-*.md exists`,
      );
    }
    if (!existsSync(join(root, path))) {
      warnings.push({
        id: 'ASSET_STALE',
        message: `${at} approves ${path}, which no longer exists: remove the entry`,
        file: APPROVALS,
      });
    }
    approved.set(path, escalation);
  });
  return { approved, failures, warnings };
}

/** The asset scan (doctrine: Assets). */
export const assetScan: CheckPlugin = {
  name: 'assets',
  run({ root }) {
    let files: string[];
    try {
      files = repositoryFiles(root);
    } catch (error) {
      const message = `the asset scan reads the file list from git, which failed: ${(error as Error).message.split('\n')[0]}`;
      return { failures: [{ id: 'ASSET_GIT', message }] };
    }
    const { approved, failures, warnings } = readApprovals(root);
    let binaries = 0;
    let fonts = 0;
    for (const file of files) {
      const bytes = readFileSync(join(root, file));
      const kind = binaryKind(file, bytes);
      if (kind) {
        binaries++;
        const extension = extname(file).slice(1).toLowerCase();
        if (approved.has(file)) continue;
        if (FONT_EXTENSIONS.has(extension) && file.startsWith('data/fonts/')) {
          const beside = readdirSync(join(root, dirname(file))).filter((name) => name !== basename(file));
          if (beside.some((name) => LICENSE_NAME.test(name))) fonts++;
          else {
            const message = `${file} is a font without its license: put the license file beside it (LICENSE, OFL.txt or <font>-LICENSE.txt)`;
            failures.push({ id: 'ASSET_FONT_LICENSE', message, file });
          }
        } else if (FONT_EXTENSIONS.has(extension)) {
          const message = `${file} is a font outside data/fonts/: fonts are pre-approved only there, each with its license file beside it`;
          failures.push({ id: 'ASSET_FONT_PLACE', message, file });
        } else {
          failures.push({ id: 'ASSET_BINARY', message: `${file} is ${kind}: it ${ASK}`, file });
        }
        continue;
      }
      const text = bytes.toString('utf8');
      for (const match of text.matchAll(DATA_URI)) {
        if (match[1].length <= MAX_EMBEDDED) continue;
        const message = `${file} embeds a data: URI of ${match[1].length} characters (over 1 KB): an embedded binary ${ASK}`;
        failures.push({ id: 'ASSET_DATA_URI', message, file, line: lineAt(text, match.index) });
      }
      for (const match of text.replace(DATA_URI, (uri) => ' '.repeat(uri.length)).matchAll(BASE64_RUN)) {
        const message = `${file} holds a base64 run of ${match[0].length} characters (over 1 KB): an embedded binary ${ASK}`;
        failures.push({ id: 'ASSET_BASE64', message, file, line: lineAt(text, match.index) });
      }
    }
    return {
      failures,
      warnings,
      summary: `${files.length} files, ${binaries} binary (${approved.size} approved, ${fonts} fonts)`,
      metrics: { files: files.length, binaries, approved: approved.size, fonts },
    };
  },
};

/** Whether `root` is an ultracode lane: `X_LANE` when set (0 or 1), else whether it is a linked git worktree. */
export function isLane(root: string, env: Record<string, string | undefined> = process.env): boolean {
  if (env.X_LANE === '1' || env.X_LANE === '0') return env.X_LANE === '1';
  if (env.X_LANE) throw new Error(`X_LANE must be 0 or 1, not "${env.X_LANE}"`);
  try {
    const out = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const [gitDir, commonDir] = out.trim().split('\n');
    return resolve(gitDir) !== resolve(commonDir);
  } catch {
    return false;
  }
}

/** The plugins: the asset scan, then each `check` exported by a module in `tools/cmd/` (a text scan finds them). */
export async function discoverPlugins(root: string): Promise<CheckPlugin[]> {
  const plugins = [assetScan];
  for (const name of commandNames(root)) {
    const file = join(root, 'tools', 'cmd', `${name}.ts`);
    if (name === 'check' || !/^export const check\b/m.test(readFileSync(file, 'utf8'))) continue;
    const { check } = (await import(pathToFileURL(file).href)) as { check?: Partial<CheckPlugin> };
    if (typeof check?.name !== 'string' || typeof check.run !== 'function') {
      throw new Error(`tools/cmd/${name}.ts exports check, but not as a CheckPlugin ({ name, run })`);
    }
    plugins.push(check as CheckPlugin);
  }
  return plugins;
}

/** Runs `plugins` side by side and merges what they found; in a lane, `warnInLane` plugins only warn. */
export async function runChecks(root: string, plugins: readonly CheckPlugin[], lane: boolean): Promise<CommandResult> {
  const outcomes = await Promise.all(
    plugins.map(async (plugin): Promise<CheckOutcome> => {
      try {
        return await plugin.run({ root, lane });
      } catch (error) {
        return {
          failures: [{ id: 'CHECK_CRASH', message: `the ${plugin.name} check crashed: ${(error as Error).message}` }],
        };
      }
    }),
  );
  const failures: Finding[] = [];
  const warnings: Finding[] = [];
  const metrics: Record<string, number | string | boolean> = { lane, plugins: plugins.length };
  const lines = plugins.map((plugin, i) => {
    const outcome = outcomes[i];
    const demote = lane && plugin.warnInLane;
    const note = ' (a warning in this ultracode lane: the integrator regenerates it, PLAN.md §11.3)';
    failures.push(...(demote ? [] : outcome.failures));
    warnings.push(...(demote ? outcome.failures.map((f) => ({ ...f, message: f.message + note })) : []));
    warnings.push(...(outcome.warnings ?? []));
    for (const [key, value] of Object.entries(outcome.metrics ?? {})) metrics[`${plugin.name}.${key}`] = value;
    const verdict = outcome.failures.length === 0 ? 'ok' : demote ? 'warn' : 'FAIL';
    return `${plugin.name}: ${verdict}${outcome.summary ? `, ${outcome.summary}` : ''}`;
  });
  return {
    ok: failures.length === 0,
    summary: `${plugins.length} plugin${plugins.length === 1 ? '' : 's'}${lane ? ', ultracode lane' : ''}: ${
      failures.length === 0 ? 'all pass' : `${failures.length} failure${failures.length === 1 ? '' : 's'}`
    }`,
    lines,
    failures,
    warnings,
    metrics,
  };
}

export default {
  usage: 'check',
  options: {},
  maxPositionals: 0,
  async run({ root }): Promise<CommandResult> {
    return runChecks(root, await discoverPlugins(root), isLane(root));
  },
} satisfies Command;
