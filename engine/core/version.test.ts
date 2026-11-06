/**
 * @file Unit tests for engine/core/version.ts (T1, WP 13.45): the version is package.json's, a semantic version.
 * @see engine/core/version.ts
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from './version';

describe('ENGINE_VERSION', () => {
  it("is package.json's version, major.minor.patch", () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(ENGINE_VERSION).toBe(pkg.version);
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
