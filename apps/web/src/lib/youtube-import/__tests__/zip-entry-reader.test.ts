/**
 * @jest-environment node
 */
/**
 * The tus reader that streams a Takeout zip entry (wiki AUN-YT-IMPORT): slices
 * in order, a restart from an earlier offset (tus retrying from the server's
 * offset) reopens the stream and skips, a repeated chunk needs no reopen.
 */
import { deflateRawSync } from 'node:zlib';
import { readZipIndex } from '@al-ummah/shared-types';
import { addTakeoutFiles, emptyTakeoutSet, uploadInputOf, zipEntryFingerprint } from '../takeout';
import { EntryReadError, ZipEntrySource, zipEntryFileReader } from '../zip-entry-reader';

const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => i % 251);

/** A stream that gives `data` in pieces of `piece` bytes. */
function opener(data: Uint8Array, piece = 7) {
  const calls = { opens: 0 };
  const open = async () => {
    calls.opens++;
    let at = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (at >= data.length) return controller.close();
        controller.enqueue(data.slice(at, at + piece));
        at += piece;
      },
    });
  };
  return { open, calls };
}

const read = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

describe('ZipEntrySource', () => {
  const data = bytes(100);

  it('hands out consecutive slices and says when the entry is done', async () => {
    const { open, calls } = opener(data);
    const src = new ZipEntrySource(open, data.length);
    const a = await src.slice(0, 40);
    const b = await src.slice(40, 80);
    const c = await src.slice(80, 120);
    expect(await read(a.value)).toEqual(data.slice(0, 40));
    expect(await read(b.value)).toEqual(data.slice(40, 80));
    expect(await read(c.value)).toEqual(data.slice(80, 100));
    expect([a.done, b.done, c.done]).toEqual([false, false, true]);
    expect(c.value.size).toBe(20);
    expect(calls.opens).toBe(1);
  });

  it('repeats the same chunk (a retried PATCH) without reopening', async () => {
    const { open, calls } = opener(data);
    const src = new ZipEntrySource(open, data.length);
    await src.slice(0, 30);
    const again = await src.slice(0, 30);
    expect(await read(again.value)).toEqual(data.slice(0, 30));
    expect(calls.opens).toBe(1);
  });

  it('restarts from an earlier offset by reopening and skipping', async () => {
    const { open, calls } = opener(data, 9);
    const src = new ZipEntrySource(open, data.length);
    await src.slice(0, 30);
    await src.slice(30, 60);
    await src.slice(60, 90);
    // The server kept only 45 bytes: tus asks again from there
    const back = await src.slice(45, 75);
    expect(await read(back.value)).toEqual(data.slice(45, 75));
    expect(calls.opens).toBe(2);
    const rest = await src.slice(75, 105);
    expect(await read(rest.value)).toEqual(data.slice(75, 100));
    expect(rest.done).toBe(true);
    expect(calls.opens).toBe(2);
  });

  it('skips ahead to a later start (resuming a stored upload)', async () => {
    const { open } = opener(data, 13);
    const src = new ZipEntrySource(open, data.length);
    const slice = await src.slice(57, 70);
    expect(await read(slice.value)).toEqual(data.slice(57, 70));
  });

  it('fails when the entry is shorter than its index says', async () => {
    const { open } = opener(data.slice(0, 50));
    const src = new ZipEntrySource(open, 100);
    await expect(src.slice(40, 80)).rejects.toBeInstanceOf(EntryReadError);
  });

  it('is what the tus fileReader opens', async () => {
    const { open } = opener(data);
    const reader = zipEntryFileReader(open, data.length);
    const source = await reader.openFile({}, 50);
    expect(source.size).toBe(100);
    expect(reader.source()).toBe(source);
    source.close();
  });
});

/** A minimal zip (stored and deflated entries, UTF-8 names). */
function zip(entries: { name: string; data: Uint8Array; method: 0 | 8 }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const body = e.method === 8 ? new Uint8Array(deflateRawSync(e.data)) : e.data;
    const name = enc.encode(e.name);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, e.method, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, e.method, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    parts.push(local, body);
    central.push(cd);
    offset += local.length + body.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe('Takeout files in the browser', () => {
  const video = bytes(70_000);
  const csv = 'Video ID,Video Title (Original)\nAAAAAAAAAAA,محاضرة الفجر\n';
  const takeoutZip = new File(
    [
      zip([
        { name: 'Takeout/YouTube and YouTube Music/videos/محاضرة الفجر.mp4', data: video, method: 8 },
        { name: 'Takeout/YouTube and YouTube Music/videos/Talk.mov', data: bytes(500), method: 0 },
        { name: 'Takeout/YouTube and YouTube Music/video metadata/videos.csv', data: new TextEncoder().encode(csv), method: 8 },
      ]) as BlobPart,
    ],
    'takeout-001.zip',
    { type: 'application/zip', lastModified: 1_700_000_000_000 },
  );

  it('lists video entries and reads videos.csv from a zip part, plus loose files', async () => {
    const loose = new File([bytes(10) as BlobPart], 'Extracted [BBBBBBBBBBB].mp4', { type: 'video/mp4' });
    const set = await addTakeoutFiles(emptyTakeoutSet(), [takeoutZip, loose, takeoutZip]);
    expect(set.picked).toEqual(['takeout-001.zip', 'Extracted [BBBBBBBBBBB].mp4']);
    expect(set.files.map((f) => f.fileName)).toEqual(['محاضرة الفجر.mp4', 'Talk.mov', 'Extracted [BBBBBBBBBBB].mp4']);
    expect(set.files[0]).toMatchObject({ zipName: 'takeout-001.zip', size: 70_000, key: 'takeout-001.zip/Takeout/YouTube and YouTube Music/videos/محاضرة الفجر.mp4' });
    expect(set.files[2]).toMatchObject({ zipName: '', entryName: 'Extracted [BBBBBBBBBBB].mp4' });
    expect(set.csv).toEqual([{ videoId: 'AAAAAAAAAAA', title: 'محاضرة الفجر', durationMs: null }]);
    expect(set.problems).toEqual([]);
  });

  it('streams a deflated entry through the tus reader, restarts included', async () => {
    const set = await addTakeoutFiles(emptyTakeoutSet(), [takeoutZip]);
    const source = set.sources.get(set.files[0]!.key)!;
    const { input, open, size } = uploadInputOf(source, 'محاضرة الفجر.mp4');
    expect(input).toMatchObject({ name: 'محاضرة الفجر.mp4', size: 70_000, type: 'video/mp4' });
    const src = new ZipEntrySource(open!, size);
    const first = await read((await src.slice(0, 40_000)).value);
    const back = await read((await src.slice(20_000, 60_000)).value);
    const last = await src.slice(60_000, 100_000);
    expect(first).toEqual(video.slice(0, 40_000));
    expect(back).toEqual(video.slice(20_000, 60_000));
    expect(await read(last.value)).toEqual(video.slice(60_000));
    expect(last.done).toBe(true);
  });

  it('reports a file that is not a zip, and fingerprints an entry by its place', async () => {
    const junk = new File([new TextEncoder().encode('not a zip '.repeat(20)) as BlobPart], 'takeout-002.zip', { type: 'application/zip' });
    const set = await addTakeoutFiles(emptyTakeoutSet(), [junk]);
    expect(set.problems).toEqual([{ fileName: 'takeout-002.zip', code: 'unreadable' }]);
    const [entry] = await readZipIndex(async (s, e) => new Uint8Array(await takeoutZip.slice(s, e).arrayBuffer()), takeoutZip.size);
    const a = await zipEntryFingerprint(takeoutZip, entry!, 'x.mp4');
    const b = await zipEntryFingerprint(takeoutZip, entry!, 'x.mp4');
    expect(a).toEqual(b);
    expect(a).toMatchObject({ name: 'x.mp4', size: 70_000, lastModified: 1_700_000_000_000 });
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
