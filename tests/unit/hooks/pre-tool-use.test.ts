/**
 * @file The PreToolUse hook (.claude/hooks/pre-tool-use.ts, WP 0.10): an edit to DOCTRINE.md asks the owner; hand
 * edits under out/ and node_modules/ and force-pushes to main are denied; everything else passes without a decision.
 */
import { describe, expect, it } from 'vitest';
import { decide, forcePushesMain, shellWords, writesDoctrine } from '../../../.claude/hooks/pre-tool-use';
import { ROOT } from '../../../tools/x';
import { runHook } from './harness';

const options = { projectDir: ROOT, currentBranch: () => 'claude/feature' };
const bash = (command: string) => ({ tool_name: 'Bash', tool_input: { command } });

describe('the PreToolUse hook', () => {
  it('asks the owner before any edit tool touches DOCTRINE.md', () => {
    for (const tool_name of ['Edit', 'Write', 'MultiEdit']) {
      const decision = decide({ tool_name, tool_input: { file_path: `${ROOT}/DOCTRINE.md` } }, options);
      expect(decision?.permissionDecision).toBe('ask');
      expect(decision?.permissionDecisionReason).toMatch(/owner/);
    }
    expect(decide({ tool_name: 'Edit', tool_input: { file_path: 'DOCTRINE.md' }, cwd: ROOT }, options)).toMatchObject({
      permissionDecision: 'ask',
    });
    expect(decide({ tool_name: 'Edit', tool_input: { file_path: `${ROOT}/AGENTS.md` } }, options)).toBeUndefined();
  });

  it('denies hand edits under out/ and node_modules/, and leaves other paths alone', () => {
    for (const path of ['out/check/all/report.json', 'node_modules/three/package.json']) {
      const decision = decide({ tool_name: 'Write', tool_input: { file_path: `${ROOT}/${path}` } }, options);
      expect(decision?.permissionDecision).toBe('deny');
      expect(decision?.permissionDecisionReason).toContain(path);
    }
    for (const path of [`${ROOT}/engine/gfx/renderer.ts`, `${ROOT}/docs/outline.md`, '/tmp/out/x.json']) {
      expect(decide({ tool_name: 'Edit', tool_input: { file_path: path } }, options)).toBeUndefined();
    }
  });

  it('tells reading the doctrine from writing it in Bash', () => {
    const reads = [
      'cat DOCTRINE.md',
      'grep -n Escalation DOCTRINE.md | head -5',
      "sed -n '1,20p' DOCTRINE.md",
      'git diff -- DOCTRINE.md && git log --oneline -3 DOCTRINE.md',
      'git -C . show HEAD -- DOCTRINE.md',
      'git commit -m "docs: quote DOCTRINE.md; then more" && git add DOCTRINE.md',
      'node x docs --check > out/docs.txt',
    ];
    const writes = [
      "sed -i 's/agents/AI agents/' DOCTRINE.md",
      'echo extra >> DOCTRINE.md',
      'printf x > ./DOCTRINE.md',
      'cp /tmp/draft.md DOCTRINE.md',
      'git checkout -- DOCTRINE.md',
      "perl -pi -e 's/a/b/' DOCTRINE.md",
      'cat draft.md | tee DOCTRINE.md',
      'cd /home/user/my-3dge && rm DOCTRINE.md',
    ];
    for (const command of reads) expect([command, writesDoctrine(command)]).toEqual([command, false]);
    for (const command of writes) expect([command, writesDoctrine(command)]).toEqual([command, true]);
    expect(decide(bash(writes[0]), options)?.permissionDecision).toBe('ask');
    expect(decide(bash(reads[0]), options)).toBeUndefined();
  });

  it('splits commands the way a shell does: quotes, operators and redirections', () => {
    expect(shellWords(`git commit -m "a; b" && echo 'x y' 2>&1 | tee -a log>>out.txt`)).toEqual([
      ['git', 'commit', '-m', 'a; b'],
      ['echo', 'x y', '2>&', '1'],
      ['tee', '-a', 'log', '>>', 'out.txt'],
    ]);
  });

  it('denies force-pushes to main and deleting it, and lets every other push through', () => {
    const onMain = () => 'main';
    const onBranch = () => 'claude/feature';
    const denied = [
      'git push --force origin main',
      'git push -f origin HEAD:main',
      'git push origin +main',
      'git push --force-with-lease=main origin main',
      'git push -uf origin refs/heads/main',
      'git push origin --delete main',
      'git push origin :main',
      'git status && git push --mirror origin',
    ];
    const allowed = [
      'git push -u origin claude/feature',
      'git push --force origin claude/feature',
      'git push origin main',
      'git push -o ci.skip origin claude/feature',
      'git log --oneline origin/main',
    ];
    for (const command of denied) expect([command, forcePushesMain(command, onBranch)]).toEqual([command, true]);
    for (const command of allowed) expect([command, forcePushesMain(command, onBranch)]).toEqual([command, false]);
    expect(forcePushesMain('git push -f', onMain)).toBe(true);
    expect(forcePushesMain('git push -f', onBranch)).toBe(false);
    expect(forcePushesMain('git push --force origin HEAD', onMain)).toBe(true);
    expect(decide(bash(denied[0]), options)).toMatchObject({ permissionDecision: 'deny' });
    expect(decide(bash(allowed[0]), options)).toBeUndefined();
  });

  it('answers Claude Code on stdout: a decision as hookSpecificOutput, or nothing', () => {
    const ask = runHook(
      'pre-tool-use.ts',
      { tool_name: 'Edit', tool_input: { file_path: `${ROOT}/DOCTRINE.md` } },
      {
        projectDir: ROOT,
      },
    );
    expect(ask.code).toBe(0);
    expect(JSON.parse(ask.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: expect.stringContaining('DOCTRINE.md') as unknown,
      },
    });
    const pass = runHook('pre-tool-use.ts', bash('npm test'), { projectDir: ROOT });
    expect(pass).toEqual({ code: 0, stdout: '', stderr: '' });
  });
});
