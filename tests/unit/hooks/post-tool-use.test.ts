/**
 * @file The PostToolUse hook (.claude/hooks/post-tool-use.ts, WP 0.10), run on a fixture project whose ESLint config
 * is the repository's own eslint.config.js: writing a banned API fails the hook with the replacement named; Prettier
 * formats the edited file; warnings come back as context; Markdown and outside paths are left alone.
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lintLines } from '../../../.claude/hooks/post-tool-use';
import { ROOT } from '../../../tools/x';
import { runHook, tempDir, writeFiles } from './harness';

let project = '';

beforeAll(() => {
  project = tempDir('post-tool-use');
  for (const file of ['package.json', '.prettierrc.json', '.prettierignore']) {
    copyFileSync(join(ROOT, file), join(project, file));
  }
  writeFileSync(
    join(project, 'eslint.config.js'),
    `export { default } from ${JSON.stringify(`${ROOT}/eslint.config.js`)};\n`,
  );
  // Only the tools' binaries: ESLint's cache then lands in the fixture's node_modules/.cache, not the repository's.
  mkdirSync(join(project, 'node_modules'));
  symlinkSync(join(ROOT, 'node_modules', '.bin'), join(project, 'node_modules', '.bin'));
});

afterAll(() => rmSync(project, { recursive: true, force: true }));

/** Writes `source` at `path` in the fixture and runs the hook as Claude Code would after a Write. */
function write(path: string, source: string) {
  writeFiles(project, { [path]: source });
  return runHook(
    'post-tool-use.ts',
    { tool_name: 'Write', tool_input: { file_path: join(project, path) } },
    {
      projectDir: project,
    },
  );
}

describe('the PostToolUse hook', () => {
  it.each([
    [
      'engine/gfx/legacy.ts',
      "import { WebGLRenderer } from 'three/webgpu';\nexport const renderer = new WebGLRenderer();\n",
      'use WebGPURenderer',
    ],
    [
      'engine/gfx/clock.ts',
      "import { Clock } from 'three/webgpu';\nexport const clock = new Clock();\n",
      'use core/time',
    ],
  ])('fails on a banned API in %s, naming the replacement', (path, source, replacement) => {
    const run = write(path, `/** @file Fixture. */\n${source}`);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain(`${path}: `);
    expect(run.stderr).toMatch(/banned\/no-restricted-(syntax|imports)/);
    expect(run.stderr).toContain(replacement);
  });

  it('formats the edited file with Prettier and stays silent when ESLint is clean', () => {
    const run = write('engine/core/fine.ts', '/** @file Fixture. */\nexport const greeting = "hello"\n');
    expect(run).toEqual({ code: 0, stdout: '', stderr: '' });
    expect(readFileSync(join(project, 'engine/core/fine.ts'), 'utf8')).toBe(
      "/** @file Fixture. */\nexport const greeting = 'hello';\n",
    );
  });

  it('hands warnings back as context without failing', () => {
    const lines = Array.from({ length: 405 }, (_, i) => `export const n${i} = ${i};`).join('\n');
    const run = write('engine/core/long.ts', `/** @file Fixture. */\n${lines}\n`);
    expect(run.code).toBe(0);
    const context = JSON.parse(run.stdout) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(context.hookSpecificOutput.hookEventName).toBe('PostToolUse');
    expect(context.hookSpecificOutput.additionalContext).toContain('max-lines');
  });

  it('fails when Prettier cannot parse the file', () => {
    const run = write('engine/core/broken.ts', '/** @file Fixture. */\nexport const = ;\n');
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('engine/core/broken.ts: Prettier cannot format it');
  });

  it('leaves hand-written Markdown, deleted files and paths outside the project alone', () => {
    const prose = '# Notes\n\n| a  | b |\n|---|---|\n';
    expect(write('docs/notes.md', prose)).toEqual({ code: 0, stdout: '', stderr: '' });
    expect(readFileSync(join(project, 'docs/notes.md'), 'utf8')).toBe(prose);
    for (const file_path of [join(project, 'gone.ts'), join(ROOT, 'package.json')]) {
      const run = runHook(
        'post-tool-use.ts',
        { tool_name: 'Edit', tool_input: { file_path } },
        { projectDir: project },
      );
      expect(run).toEqual({ code: 0, stdout: '', stderr: '' });
    }
  });

  it('prints each ESLint message once, errors apart from warnings', () => {
    const message = { line: 2, column: 10, severity: 2, ruleId: 'banned/no-restricted-syntax', message: 'use X' };
    const { errors, warnings } = lintLines(
      [{ filePath: '/x/a.ts', messages: [message, message, { ...message, severity: 1, ruleId: 'max-lines' }] }],
      'a.ts',
    );
    expect(errors).toEqual(['a.ts:2:10  banned/no-restricted-syntax  use X']);
    expect(warnings).toEqual(['a.ts:2:10  max-lines  use X']);
  });
});
