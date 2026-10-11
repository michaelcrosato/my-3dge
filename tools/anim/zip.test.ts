/**
 * @file Tests reading zip archives by ranges (tools/anim/zip.ts, WP 8.5) on archives built here: the entries listed
 * from the central directory alone, one entry read in two small requests, neighbours read in one, the same through
 * `curl` (a `file://` URL stands in for the web, offline), and the errors for what is not a zip archive.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fileSource, openZip, urlSource, zipBytes, type ByteSource } from './zip';

const FILES = {
  'all/subjects/02/02.asf': 'a skeleton\n'.repeat(50),
  'all/subjects/02/02_01.amc': '1\nroot 0 0 0\n'.repeat(400),
  'readme.txt': '',
};
const archive = () => {
  const file = join(mkdtempSync(join(tmpdir(), 'zip-')), 'all.zip');
  writeFileSync(file, zipBytes(FILES));
  return file;
};
/** A source that counts the bytes and requests it serves. */
function counted(src: ByteSource) {
  const log = { requests: 0, bytes: 0 };
  return {
    log,
    src: {
      name: src.name,
      bytes: (from: number, to: number) => {
        const out = src.bytes(from, to);
        log.requests++;
        log.bytes += out.length;
        return out;
      },
    },
  };
}

describe('a zip archive read by ranges', () => {
  it('lists its entries from the end record and the central directory alone', () => {
    const { src, log } = counted(fileSource(archive()));
    const zip = openZip(src);
    expect(zip.entries.map((e) => [e.name, e.method, e.size])).toEqual([
      ['all/subjects/02/02.asf', 8, 550],
      ['all/subjects/02/02_01.amc', 8, 5200],
      ['readme.txt', 8, 0],
    ]);
    expect(log.requests).toBe(2);
  });

  it('reads one entry in two small requests, and neighbours in one', () => {
    const { src, log } = counted(fileSource(archive()));
    const zip = openZip(src);
    const before = log.requests;
    const amc = zip.read(zip.entries[1]);
    expect(new TextDecoder().decode(amc)).toBe(FILES['all/subjects/02/02_01.amc']);
    expect(log.requests - before).toBe(2);
    const many = zip.readMany([zip.entries[2], zip.entries[0]]);
    expect(many.map((b) => new TextDecoder().decode(b))).toEqual(['', FILES['all/subjects/02/02.asf']]);
    expect(log.requests - before).toBe(3);
  });

  it('reads through curl the same way (a file:// URL stands in for the web)', () => {
    // past the 64 KiB the end record is looked for in, as a web archive is (curl reads no longer tail of a file)
    const file = join(mkdtempSync(join(tmpdir(), 'zip-')), 'big.zip');
    writeFileSync(file, zipBytes({ ...FILES, 'noise.txt': randomBytes(100_000).toString('hex') }));
    const zip = openZip(urlSource(pathToFileURL(file).href));
    expect(new TextDecoder().decode(zip.read(zip.entries[0]))).toBe(FILES['all/subjects/02/02.asf']);
  });

  it('says when a file is no zip archive, or a URL cannot be read', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'zip-')), 'not.zip');
    writeFileSync(file, 'plain text');
    expect(() => openZip(fileSource(file))).toThrow(/not.zip is not a zip archive/);
    expect(() => urlSource(pathToFileURL(join(file, 'missing')).href).bytes(0, 9)).toThrow(/check the network/);
  });
});
