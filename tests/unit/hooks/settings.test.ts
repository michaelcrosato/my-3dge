/**
 * @file The Claude Code project settings, skills and subagents in `.claude/` (PLAN.md §8.10, WP 0.10): every hook
 * event points at a script that exists, the allow list holds §8.10's entries, each skill and subagent has the
 * frontmatter Claude Code loads it by, the verifier returns §11.3's JSON verdict, and every repository path their
 * Markdown cites exists or is planned (the docs path checks of tools/lib/docsPaths.ts).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ModuleDoc } from '../../../tools/lib/docs';
import { checkPaths } from '../../../tools/lib/docsPaths';
import { ROOT } from '../../../tools/x';

interface HookEntry {
  matcher?: string;
  hooks: { type: string; command: string; timeout?: number }[];
}
interface Settings {
  permissions: { allow: string[]; deny?: string[] };
  hooks: Record<string, HookEntry[]>;
}

const CLAUDE = join(ROOT, '.claude');
const settings = JSON.parse(readFileSync(join(CLAUDE, 'settings.json'), 'utf8')) as Settings;

/** The `key: value` lines of a Markdown file's frontmatter, and the body after it. */
function frontmatter(path: string): { fields: Record<string, string>; body: string } {
  const text = readFileSync(path, 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) return { fields: {}, body: text };
  const fields = Object.fromEntries(
    match[1]
      .split('\n')
      .map((line) => [line.slice(0, line.indexOf(':')).trim(), line.slice(line.indexOf(':') + 1).trim()]),
  );
  return { fields, body: match[2] };
}

const SKILLS = ['x-loop', 'three-webgpu', 'escalation', 'determinism-debugging'];
const AGENTS = ['verifier', 'visual-reviewer'];

describe('.claude/settings.json', () => {
  it('runs a script that exists for each of the four hook events', () => {
    expect(Object.keys(settings.hooks).sort()).toEqual(['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop']);
    for (const [event, entries] of Object.entries(settings.hooks)) {
      for (const hook of entries.flatMap((entry) => entry.hooks)) {
        expect(hook.type).toBe('command');
        const script = /"\$CLAUDE_PROJECT_DIR\/(\.claude\/hooks\/[\w.-]+)"/.exec(hook.command)?.[1];
        expect([event, script && existsSync(join(ROOT, script))]).toEqual([event, true]);
        expect(hook.timeout).toBeGreaterThan(0);
      }
    }
    const matcher = (event: string) => settings.hooks[event][0].matcher?.split('|') ?? [];
    expect(matcher('PreToolUse')).toEqual(expect.arrayContaining(['Edit', 'Write', 'MultiEdit', 'Bash']));
    expect(matcher('PostToolUse')).toEqual(expect.arrayContaining(['Edit', 'Write', 'MultiEdit']));
  });

  it("allows §8.10's commands and the GitHub server's pull-request tools, and nothing that edits the doctrine", () => {
    const allow = settings.permissions.allow;
    const planned = ['Bash(node x *)', 'Bash(npm run *)', 'Bash(npm test*)', 'Bash(npm ci)', 'Bash(npx vitest *)'];
    planned.push('Bash(npx playwright test*)', 'Bash(git add *)', 'Bash(git commit *)', 'Bash(git push *)');
    planned.push('Bash(gh pr *)', 'Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)');
    expect(allow).toEqual(expect.arrayContaining(planned));
    expect(allow).toEqual(
      expect.arrayContaining(['mcp__github__create_pull_request', 'mcp__github__merge_pull_request']),
    );
    expect(allow.filter((rule) => rule.startsWith('mcp__')).every((rule) => /pull_request|review/.test(rule))).toBe(
      true,
    );
    expect(allow.filter((rule) => /DOCTRINE|^(Edit|Write)/.test(rule))).toEqual([]);
  });
});

describe('.claude/ skills and subagents', () => {
  it('names each skill after its directory, with a description and no version in the name', () => {
    expect(readdirSync(join(CLAUDE, 'skills')).sort()).toEqual([...SKILLS].sort());
    for (const skill of SKILLS) {
      const { fields, body } = frontmatter(join(CLAUDE, 'skills', skill, 'SKILL.md'));
      expect(fields.name).toBe(skill);
      expect(fields.name).not.toMatch(/\d/);
      expect(fields.description.length).toBeGreaterThan(80);
      expect(fields.description.length).toBeLessThanOrEqual(1024);
      expect(body.split('\n').length).toBeLessThan(120);
    }
  });

  it('defines the verifier and the visual reviewer, each returning a JSON verdict', () => {
    expect(readdirSync(join(CLAUDE, 'agents')).sort()).toEqual(AGENTS.map((name) => `${name}.md`));
    for (const agent of AGENTS) {
      const { fields, body } = frontmatter(join(CLAUDE, 'agents', `${agent}.md`));
      expect(fields.name).toBe(agent);
      expect(fields.description.length).toBeGreaterThan(80);
      expect(Object.keys(fields)).not.toContain('model');
      expect(body).toContain('"pass": bool, ');
      expect(body).toContain('"failures": [{ "what", "where", "fix" }], "notes" }');
    }
    const verifier = frontmatter(join(CLAUDE, 'agents', 'verifier.md')).body;
    // PLAN.md §11.3's verifier prompt, carried word for word in its key clauses.
    for (const clause of [
      'Run its Verify commands plus `npm run check` and `npm test`',
      'reproducibility leaks (Math.random, clocks, renderer reads in sim-side',
      'missing or weak tests (would a plausible bug pass?',
      'would a game agent recognize this?',
      '{ "pass": bool, "failures": [{ "what", "where", "fix" }], "notes" }',
    ]) {
      expect(verifier.replace(/\n/g, ' ')).toContain(clause.replace(/\n/g, ' '));
    }
  });

  it('cites only repository paths that exist or that a WP still to come plans', () => {
    const files = [
      ...SKILLS.map((skill) => `.claude/skills/${skill}/SKILL.md`),
      ...AGENTS.map((agent) => `.claude/agents/${agent}.md`),
    ];
    const modules: ModuleDoc[] = files.map((path) => {
      const raw = readFileSync(join(ROOT, path), 'utf8');
      const fileComment = { description: '', tags: [], line: 1, lines: raw.split('\n').length, raw };
      return {
        path,
        fileComment,
        purpose: '',
        exports: [],
        examples: [],
        tests: [],
        codes: [],
        kinds: [],
        imports: [],
      };
    });
    const { failures } = checkPaths(ROOT, modules, { sources: {} });
    expect(failures.filter((failure) => failure.file?.startsWith('.claude/'))).toEqual([]);
  });
});
