/**
 * @file Files out of a zip archive on the web, read by HTTP ranges (PLAN.md §5.3, WP 8.5): the end record, then the
 * central directory, then only the entries asked for, so one take of the CMU database's 1.08 GB `allasfamc.zip`
 * costs the directory (about 315 KB) and its own bytes, never the archive. Ported from shardfall's
 * `crates/pav_tools/src/mocap/fetch.rs:49-161`, which reads each entry on its own.
 * Requests go through `curl`, as shardfall's do: every container has it, and it follows the environment's proxy
 * settings, which Node's `fetch` ignores. A file on disk reads the same way (`fileSource`).
 *
 * Invariants: stored (0) and deflated (8) entries are read; another method, a zip64 archive (over 4 GB) or a server
 * that ignores ranges is an error that says so. `readMany` reads wanted entries in one request while the unwanted
 * bytes between two of them are at most `MAX_GAP` and the request at most `MAX_RANGE`, so it fetches at most `MAX_GAP`
 * more than its entries' own bytes for each entry, and the whole archive takes a few dozen requests.
 *
 * @example
 * import { writeFileSync, mkdtempSync } from 'node:fs';
 * import { tmpdir } from 'node:os';
 * import { join } from 'node:path';
 * const file = join(mkdtempSync(join(tmpdir(), 'zip-')), 'a.zip');
 * writeFileSync(file, zipBytes({ 'a/01.asf': 'skeleton', 'a/01_01.amc': 'frames' }));
 * const zip = openZip(fileSource(file));
 * zip.entries.map((entry) => entry.name); // ['a/01.asf', 'a/01_01.amc']
 * new TextDecoder().decode(zip.read(zip.entries[1])); // 'frames'
 * @see tools/anim/zip.test.ts
 */
import { execFileSync } from 'node:child_process';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

/** Where bytes come from: `bytes(from, to)` gives bytes `from`–`to` inclusive, or with `from` < 0 the last `-from`. */
export interface ByteSource {
  name: string;
  bytes(from: number, to: number): Uint8Array;
}

/** One file in an archive: its name, compression, packed and unpacked sizes, and where its local header is. */
export interface ZipEntry {
  name: string;
  method: number;
  packed: number;
  size: number;
  local: number;
}

/** An archive's entries, and a reader for them. */
export interface Zip {
  entries: ZipEntry[];
  read(entry: ZipEntry): Uint8Array;
  /** Reads several entries, in the order given; near neighbours share a request (`MAX_GAP`, `MAX_RANGE`). */
  readMany(entries: ZipEntry[]): Uint8Array[];
}

/** The most bytes `readMany` asks for at once. */
export const MAX_RANGE = 64 * 1024 * 1024;
/**
 * The most unwanted bytes `readMany` fetches between two wanted entries rather than start a new request. A request
 * to the CMU site costs about 0.13 s, measured, which is what 256 KiB to 0.6 MB take to arrive.
 */
export const MAX_GAP = 256 * 1024;

/** Runs `curl` with `args`, returning its output; a failure names the URL and curl's message. */
function curl(args: string[], what: string): Uint8Array {
  try {
    return execFileSync('curl', ['-sSfL', '--retry', '3', '--connect-timeout', '30', ...args], {
      maxBuffer: 2 * MAX_RANGE,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const message = String((error as { stderr?: Buffer }).stderr ?? (error as Error).message).trim();
    throw new Error(`${what}: ${message || 'curl failed'}: check the network (or the proxy settings) and retry`);
  }
}

/** A whole file on the web (`curl` follows redirects and the proxy settings). */
export const fetchBytes = (url: string): Uint8Array => curl([url], url);

/** A file on the web, read by ranges. */
export function urlSource(url: string): ByteSource {
  return {
    name: url,
    bytes(from, to) {
      const range = from < 0 ? `${from}` : `${from}-${to}`;
      const out = curl(['-r', range, url], `${url} (bytes ${range})`);
      const wanted = from < 0 ? -from : to - from + 1;
      if (out.length > wanted) throw new Error(`${url} ignores byte ranges: it sent ${out.length} bytes for ${range}`);
      return out;
    },
  };
}

/** A file on disk, read by ranges. */
export function fileSource(path: string): ByteSource {
  return {
    name: path,
    bytes(from, to) {
      const fd = openSync(path, 'r');
      try {
        const size = fstatSync(fd).size;
        const [a, b] = from < 0 ? [Math.max(0, size + from), size - 1] : [from, Math.min(to, size - 1)];
        const out = new Uint8Array(Math.max(0, b - a + 1));
        readSync(fd, out, 0, out.length, a);
        return out;
      } finally {
        closeSync(fd);
      }
    },
  };
}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;

/** An entry's bytes, unpacked, from `chunk` holding its local header at `at`. */
function unpack(chunk: Uint8Array, at: number, entry: ZipEntry, where: string): Uint8Array {
  if (u32(chunk, at) !== 0x04034b50)
    throw new Error(`${where}: ${entry.name} has no local header: the archive is damaged`);
  const start = at + 30 + u16(chunk, at + 26) + u16(chunk, at + 28);
  const packed = chunk.subarray(start, start + entry.packed);
  if (entry.method === 0) return packed;
  if (entry.method === 8) return new Uint8Array(inflateRawSync(packed));
  throw new Error(`${where}: ${entry.name} is packed by method ${entry.method}, which is not read: unpack it by hand`);
}

/** Opens an archive: reads its end record and central directory (two reads), not its entries. */
export function openZip(src: ByteSource): Zip {
  const tail = src.bytes(-65_557, 0);
  let eocd = -1;
  for (let p = tail.length - 22; p >= 0 && eocd < 0; p--) if (u32(tail, p) === 0x06054b50) eocd = p;
  if (eocd < 0) throw new Error(`${src.name} is not a zip archive`);
  const [size, offset] = [u32(tail, eocd + 12), u32(tail, eocd + 16)];
  if (offset === 0xffffffff || size === 0xffffffff)
    throw new Error(`${src.name}: a zip64 archive (over 4 GB) is not read`);
  const cd = src.bytes(offset, offset + size - 1);
  const entries: ZipEntry[] = [];
  for (let p = 0; p + 46 <= cd.length && u32(cd, p) === 0x02014b50;) {
    const [nl, xl, cl] = [u16(cd, p + 28), u16(cd, p + 30), u16(cd, p + 32)];
    const name = new TextDecoder('latin1').decode(cd.subarray(p + 46, p + 46 + nl));
    entries.push({
      name,
      method: u16(cd, p + 10),
      packed: u32(cd, p + 20),
      size: u32(cd, p + 24),
      local: u32(cd, p + 42),
    });
    p += 46 + nl + xl + cl;
  }
  // where each entry ends: the next one's local header, or the central directory
  const ends = new Map<ZipEntry, number>();
  const byPlace = [...entries].sort((a, b) => a.local - b.local);
  byPlace.forEach((entry, i) => ends.set(entry, byPlace[i + 1]?.local ?? offset));
  const end = (entry: ZipEntry) => ends.get(entry) ?? offset;
  const read = (entry: ZipEntry) => {
    const head = src.bytes(entry.local, entry.local + 29);
    const start = entry.local + 30 + u16(head, 26) + u16(head, 28);
    const body = entry.packed > 0 ? src.bytes(start, start + entry.packed - 1) : new Uint8Array(0);
    const chunk = new Uint8Array(30 + (start - entry.local - 30) + body.length);
    chunk.set(head, 0);
    chunk.set(body, start - entry.local);
    return unpack(chunk, 0, entry, src.name);
  };
  const readMany = (wanted: ZipEntry[]) => {
    const out = new Map<ZipEntry, Uint8Array>();
    const sorted = [...wanted].sort((a, b) => a.local - b.local);
    for (let i = 0; i < sorted.length;) {
      let j = i + 1;
      while (
        j < sorted.length &&
        sorted[j].local - end(sorted[j - 1]) <= MAX_GAP &&
        end(sorted[j]) - sorted[i].local <= MAX_RANGE
      )
        j++;
      const [from, to] = [sorted[i].local, end(sorted[j - 1]) - 1];
      const chunk = src.bytes(from, to);
      for (const entry of sorted.slice(i, j)) out.set(entry, unpack(chunk, entry.local - from, entry, src.name));
      i = j;
    }
    return wanted.map((entry) => out.get(entry) as Uint8Array);
  };
  return { entries, read, readMany };
}

/** A zip archive of `files` (name → text), deflated, for tests and tools that write one. */
export function zipBytes(files: Record<string, string>): Uint8Array {
  const [locals, centrals] = [[] as Uint8Array[], [] as Uint8Array[]];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const [raw, nameBytes] = [new TextEncoder().encode(text), new TextEncoder().encode(name)];
    const packed = new Uint8Array(deflateRawSync(raw));
    const header = (central: boolean) => {
      const h = new Uint8Array(central ? 46 : 30);
      const v = new DataView(h.buffer);
      v.setUint32(0, central ? 0x02014b50 : 0x04034b50, true);
      const at = central ? 2 : 0; // the central header has a "made by" field first
      v.setUint16(8 + at, 8, true); // deflated
      v.setUint32(14 + at, crc32(raw), true);
      v.setUint32(18 + at, packed.length, true);
      v.setUint32(22 + at, raw.length, true);
      v.setUint16(26 + at, nameBytes.length, true);
      if (central) v.setUint32(42, offset, true);
      return h;
    };
    centrals.push(header(true), nameBytes);
    locals.push(header(false), nameBytes, packed);
    offset += 30 + nameBytes.length + packed.length;
  }
  const cdSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = new Uint8Array(22);
  const v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, Object.keys(files).length, true);
  v.setUint16(10, Object.keys(files).length, true);
  v.setUint32(12, cdSize, true);
  v.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, end];
  const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
