/**
 * @file Unit tests for the GitHub Actions workflow (.github/workflows/ci.yml, PLAN.md §8.9, WP 0.9, ADR-0023): read as
 * text (no YAML dependency), it runs after each merge to main and by hand, never on pull requests, within 120 minutes,
 * and cancels no run; it runs the full run, `node x ci --local --full`, so its commands are `CI_STEPS`
 * (tools/cmd/ci.ts) and nothing runs a step of its own; it checks out both
 * read-only sources at the commits scripts/setup.sh pins (tools/lib/source.ts `sourceSpecs`) into their `.cache/`
 * clones, with the job's read-only token (no secret) and without LFS; it takes Node from .nvmrc; and its Chromium is
 * tools/deps.json's pin, the one scripts/setup.sh downloads and tools/lib/browser.ts looks for. It always publishes the
 * summary (to the step summary and the job's log) and out/.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHROMIUM_VERSION } from '../lib/browser';
import { sourceSpecs } from '../lib/source';
import { ROOT } from '../x';
import { CI_STEPS } from './ci';

const text = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
/** The workflow's lines, its comments left out. */
const lines = text.split('\n').filter((line) => !line.trim().startsWith('#'));
/** The `run:` commands, each line of a block on its own. */
function runs(): string[] {
  const out: string[] = [];
  lines.forEach((line, i) => {
    const one = /^\s*run:\s*(\S.*)$/.exec(line);
    if (one && one[1] !== '|') out.push(one[1].trim());
    else if (one) {
      const indent = /^\s*/.exec(lines[i + 1])![0].length;
      for (let k = i + 1; k < lines.length && /^\s*/.exec(lines[k])![0].length >= indent && lines[k].trim(); k++)
        out.push(lines[k].trim());
    }
  });
  return out;
}
/** The `with:` block of the step that checks out `repository`, as key → value. */
function checkoutOf(repository: string): Record<string, string> {
  const at = lines.findIndex((line) => line.trim() === `repository: ${repository}`);
  expect(at, `a step checks out ${repository}`).toBeGreaterThan(0);
  const block: Record<string, string> = {};
  for (let k = at; k < lines.length && /^\s{10}\S/.test(lines[k]); k++) {
    const [key, ...value] = lines[k].trim().split(':');
    block[key] = value.join(':').trim();
  }
  return block;
}

describe('the GitHub Actions workflow', () => {
  it('runs after each merge to main and by hand, never on pull requests, within 120 minutes, cancelling none', () => {
    expect(text).toMatch(/^on:\n {2}push:\n {4}branches: \[main\]\n {2}workflow_dispatch:\n\n/m);
    expect(lines.join('\n')).not.toMatch(/pull_request|concurrency|cancel-in-progress/);
    expect(text).toMatch(/^ {4}timeout-minutes: 120$/m);
  });

  it('runs the full run, node x ci --local --full, so its commands are CI_STEPS and none runs on its own', () => {
    const commands = runs();
    expect(commands.filter((command) => command.startsWith('node x ci'))).toEqual(['node x ci --local --full']);
    for (const step of CI_STEPS) {
      const own = step.command.join(' ');
      expect(
        commands.some((command) => command === own || command.startsWith(`${own} `)),
        own,
      ).toBe(false);
    }
  });

  it('checks out both sources at their pinned commits into their .cache clones, with no secret, without LFS', () => {
    const specs = sourceSpecs();
    expect(specs.map((spec) => spec.name)).toEqual(['my-3d2dge', 'shardfall']);
    for (const spec of specs) {
      const step = checkoutOf(spec.url.replace('https://github.com/', ''));
      expect(step).toMatchObject({ ref: spec.commit, path: spec.dest, lfs: 'false', 'persist-credentials': 'false' });
      expect(step.token, 'no secret: both repositories are public').toBeUndefined();
    }
    expect(text).not.toMatch(/secrets\./);
  });

  it('takes Node from .nvmrc', () => {
    expect(text).toMatch(/^ {10}node-version-file: \.nvmrc$/m);
    expect(text).not.toMatch(/node-version:/);
  });

  it("uses tools/deps.json's Chromium, the release scripts/setup.sh downloads and browser.ts looks for", () => {
    const deps = JSON.parse(readFileSync(join(ROOT, 'tools/deps.json'), 'utf8')) as {
      platform: { chromium: { pin: { version: string } } };
    };
    const pin = deps.platform.chromium.pin.version;
    expect(/^ {6}CHROMIUM: (\S+)$/m.exec(text)?.[1]).toBe(pin);
    expect(/^chromium_version="([^"]+)"$/m.exec(readFileSync(join(ROOT, 'scripts/setup.sh'), 'utf8'))?.[1]).toBe(pin);
    expect(CHROMIUM_VERSION).toBe(pin);
    expect(runs()).toContain(
      '"$HOME/.cache/my3dge/chrome-$CHROMIUM/chrome-linux64/chrome" --version | grep -F "$CHROMIUM"',
    );
  });

  it("always writes the summary to the step summary and the job's log, and uploads out/", () => {
    expect(runs()).toContain('if [ -f out/ci/summary.md ]; then tee -a "$GITHUB_STEP_SUMMARY" < out/ci/summary.md; fi');
    expect(text).toMatch(/- name: Summary\n {8}if: always\(\)/);
    expect(text).toMatch(
      /- name: Upload out\/\n {8}if: always\(\)\n {8}uses: actions\/upload-artifact@v4\n {8}with:\n {10}name: out\n {10}path: out\/\*\*/,
    );
  });
});
