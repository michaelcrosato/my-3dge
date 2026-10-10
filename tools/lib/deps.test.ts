/**
 * @file Unit tests for the version model of `x deps` (tools/lib/deps.ts): lines, the 12-month rule, npm ranges and
 * registry answers. The check and the modes are tested in tools/cmd/deps.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { lineName, lineOf, qualifiesOn, satisfies, stableReleases, type RegistryAnswer } from './deps';

const rel = (version: string, date: string) => ({ version, date });

describe('versions and the 12-month rule', () => {
  it('names lines as semver does, ages releases by calendar day, and reads npm ranges', () => {
    expect([lineOf('3.2.7'), lineOf('0.182.1'), lineOf('0.0.4')]).toEqual(['3.0.0', '0.182.0', '0.0.4']);
    expect([lineName('3.2.7'), lineName('0.182.0')]).toEqual(['3.x', '0.182.x']);
    expect([qualifiesOn('2025-10-22'), qualifiesOn('2024-02-29')]).toEqual(['2026-10-22', '2025-03-01']);
    expect(
      ['1.0.9', '^5.2.2', '~0.8.2', '*', '>=7.24.0 <7.24.7', '>=0.5.17'].map((r, i) =>
        satisfies(['1.0.9', '5.9.0', '0.8.3', '1.0.0', '7.24.6', '0.5.24'][i], r),
      ),
    ).toEqual(Array(6).fill(true));
    expect([satisfies('1.0.10', '1.0.9'), satisfies('6.0.0', '^5.2.2'), satisfies('0.9.0', '~0.8.2')]).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("counts only stable, published releases at or below the latest tag (three's registry lists a stray 1.58.1)", () => {
    const answer: RegistryAnswer = {
      time: {
        created: '2010-01-01',
        '0.180.0': '2025-09-03T11:48:29Z',
        '1.58.1': '2013-04-17',
        '0.182.0-beta': '2025-12-01',
        '0.181.0': '2025-10-31',
      },
      versions: ['0.180.0', '0.181.0', '0.182.0-beta'],
      latest: '0.181.0',
    };
    expect(stableReleases(answer)).toEqual([rel('0.180.0', '2025-09-03'), rel('0.181.0', '2025-10-31')]);
  });
});
