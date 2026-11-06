/**
 * @file The engine's version (PLAN.md WP 13.45, ADR-0026; the owner's call of 2026-11-06): `ENGINE_VERSION`, the
 * semantic version package.json gives, from 0.1.0. Every merge bumps it (`npm version patch` for a fix, `minor` for a
 * feature or a change to the public API, each with `--no-git-tag-version`), the quick gate holds it above main's
 * (`node x version --check`), and main's push tags its commit `v<version>` (.github/workflows/release.yml): the tag
 * lean pages load the engine from (tools/lib/lean.ts), so a game keeps the engine it was made with.
 *
 * Invariants: package.json holds the version, and this module reads it there (I-32): nothing else writes it down.
 *
 * @example
 * ENGINE_VERSION.split('.').length; // 3: major, minor and patch
 * @see engine/core/version.test.ts
 */
import pkg from '../../package.json' with { type: 'json' };

/** The engine's version, `major.minor.patch` as package.json gives it; its release is the git tag `v` + this. */
export const ENGINE_VERSION: string = pkg.version;
