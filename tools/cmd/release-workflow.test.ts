/**
 * @file Unit tests for the release workflow (.github/workflows/release.yml, PLAN.md WP 13.45, ADR-0026): read as text,
 * it runs on each push to main and never on pull requests, with write access to the repository's contents alone, and
 * tags the pushed commit `v` and package.json's version, the tag tools/lib/lean.ts's URLs name; it leaves a tag that
 * exists as it is and never deletes or forces one.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEAN_URL } from '../lib/lean';
import { ROOT } from '../x';
import { ENGINE_VERSION } from '../../engine/core/version';

const text = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8');
/** The workflow without its comments. */
const body = text
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');

describe('the release workflow', () => {
  it('runs on each push to main alone, with write access to contents only', () => {
    expect(body).toMatch(/on:\n {2}push:\n {4}branches: \[main\]\n\n/);
    expect(body).not.toMatch(/pull_request/);
    expect(body).toMatch(/permissions:\n {2}contents: write\n\n/);
  });

  it("tags the pushed commit v and package.json's version, the tag the lean package's URLs name", () => {
    expect(body).toContain(`tag="v$(node -p "require('./package.json').version")"`);
    expect(body).toContain('git tag "$tag" "$GITHUB_SHA"');
    expect(LEAN_URL).toContain(`@v${ENGINE_VERSION}/`);
  });

  it('leaves a tag that exists as it is, and never deletes or forces one', () => {
    expect(body).toContain('git ls-remote --exit-code --tags origin "refs/tags/$tag"');
    expect(body).not.toMatch(/--force|-f\b|--delete|:refs\/tags/);
  });
});
