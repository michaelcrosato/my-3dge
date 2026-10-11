/**
 * @file Tests the CMU site's tools (tools/anim/cmu.ts, WP 8.5), offline: the site's motion list parsed from its HTML,
 * and takes fetched out of an archive (a zip built here stands in for `allasfamc.zip`) into a cache directory, what
 * is cached never fetched again.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { asfOf, cmuAll, cmuGet, parseMotionList } from './cmu';
import { fileSource, openZip, zipBytes } from './zip';

const LIST = `<TABLE><TR><TD colspan=4>Subject #2 (various expressions and human behaviors)</TD></TR>
<TR><TD>1</TD><TD><a href="/subjects/02/02_01.amc">02_01</a></TD><TD>walk</TD><TD>120</TD></TR>
<TR><TD>2</TD><TD><a href="/subjects/02/02_02.amc">02_02</a></TD><TD>run/jog &amp; stop</TD><TD>60</TD></TR>
<TR><TD>Subject #13 (assorted&nbsp;motions)</TD></TR>
<TR><TD>29</TD><TD><a href="/subjects/13/13_29.amc">13_29</a></TD><TD>jumping jacks</TD><TD>120</TD></TR></TABLE>`;

describe('the CMU site', () => {
  it('reads the motion list: each take, its subject, its words and its rate', () => {
    expect(parseMotionList(LIST)).toEqual([
      { id: '02_01', subject: 2, about: 'various expressions and human behaviors', desc: 'walk', fps: 120 },
      { id: '02_02', subject: 2, about: 'various expressions and human behaviors', desc: 'run/jog & stop', fps: 60 },
      { id: '13_29', subject: 13, about: 'assorted motions', desc: 'jumping jacks', fps: 120 },
    ]);
  });

  it('fetches takes and their skeletons out of the archive, once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmu-'));
    const archive = join(dir, 'all.zip');
    const files = {
      'all_asfamc/subjects/02/02.asf': 'skeleton 2',
      'all_asfamc/subjects/02/02_01.amc': 'walk frames',
      'all_asfamc/subjects/02/02_02.amc': 'run frames',
    };
    writeFileSync(archive, zipBytes(files));
    let opened = 0;
    const open = () => (opened++, openZip(fileSource(archive)));
    const cache = join(dir, 'cache');
    const [got] = cmuGet(['02_01'], cache, open);
    expect(got).toEqual({ id: '02_01', asf: asfOf(2, cache), amc: join(cache, '02_01.amc') });
    expect(readFileSync(got.amc, 'utf8')).toBe('walk frames');
    cmuGet(['02_01'], cache, open);
    expect(opened).toBe(1);
    expect(() => cmuGet(['2-1'], cache, open)).toThrow(/a take is SUBJECT_TRIAL, like 02_01: 2-1/);
    writeFileSync(join(cache, 'index.tsv'), 'id\tsubject\tabout\tdesc\tfps\n02_02\t2\t\trun\t120\n');
    expect(cmuAll(cache, open)).toBe(2);
    expect(existsSync(join(cache, '02_02.amc'))).toBe(true);
  });
});
