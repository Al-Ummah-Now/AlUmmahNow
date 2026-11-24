import * as fs from 'fs';
import * as path from 'path';

/**
 * Small clips in every format the upload forms accept (#1938), built from the two committed
 * samples with no ffmpeg: MP4 and WebM are the samples, M4V and MOV are the MP4 with their
 * file-type brand changed, MKV is the WebM with its EBML DocType changed to "matroska", and AVI is a
 * RIFF/AVI header with an empty movie list. Browser, server and TUS see the container and the
 * name, which is all this suite looks at; encoding (the fake Bunny reads MP4 only) is not tested.
 */

const FIXTURES = path.join(__dirname, '..', 'test-fixtures');
const mp4 = () => fs.readFileSync(path.join(FIXTURES, 'e2e-sample.mp4'));
const webm = () => fs.readFileSync(path.join(FIXTURES, 'e2e-sample.webm'));

/** The first 'ftyp' box's major brand replaced (4 bytes at offset 8) */
function withBrand(file: Buffer, brand: string): Buffer {
  const out = Buffer.from(file);
  if (out.toString('latin1', 4, 8) !== 'ftyp') throw new Error('sample is not an ISO base media file');
  out.write(brand.padEnd(4, ' '), 8, 'latin1');
  return out;
}

/** WebM → Matroska: DocType "webm" (size 4) becomes "matroska" (size 8) and the EBML header grows by 4 */
function toMatroska(file: Buffer): Buffer {
  if (file.readUInt32BE(0) !== 0x1a45dfa3) throw new Error('sample is not an EBML file');
  const sizeByte = file[4]!;
  if (!(sizeByte & 0x80)) throw new Error('EBML header size is not a one-byte vint');
  const at = file.indexOf(Buffer.from([0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]), 5); // DocType, size 4, 'webm'
  if (at < 0) throw new Error('no DocType "webm" in the sample');
  const patched = Buffer.concat([file.subarray(0, at), Buffer.from([0x42, 0x82, 0x88]), Buffer.from('matroska', 'latin1'), file.subarray(at + 7)]);
  patched[4] = 0x80 | ((sizeByte & 0x7f) + 4);
  return patched;
}

function le32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

/** RIFF 'AVI ' with a main header and an empty 'movi' list */
function emptyAvi(): Buffer {
  const avih = Buffer.alloc(8 + 56);
  avih.write('avih', 0, 'latin1');
  avih.writeUInt32LE(56, 4);
  avih.writeUInt32LE(40_000, 8); // microseconds per frame
  avih.writeUInt32LE(320, 8 + 32); // width
  avih.writeUInt32LE(180, 8 + 36); // height
  const hdrl = Buffer.concat([Buffer.from('LIST', 'latin1'), le32(4 + avih.length), Buffer.from('hdrl', 'latin1'), avih]);
  const movi = Buffer.concat([Buffer.from('LIST', 'latin1'), le32(4), Buffer.from('movi', 'latin1')]);
  const body = Buffer.concat([Buffer.from('AVI ', 'latin1'), hdrl, movi]);
  return Buffer.concat([Buffer.from('RIFF', 'latin1'), le32(body.length), body]);
}

export interface FormatClip {
  label: string;
  /** File name, with the extension in the case given */
  name: string;
  /** What a browser reports for it (Chrome, Safari or Firefox, by system) */
  reported: string[];
  /** What the web form sends to the server for it */
  sent: string;
  buffer: Buffer;
}

/** One clip per accepted format, named `<stem>.<ext>` */
export function formatClips(stem: string): FormatClip[] {
  return [
    { label: 'MP4', name: `${stem}.mp4`, reported: ['video/mp4'], sent: 'video/mp4', buffer: mp4() },
    { label: 'M4V', name: `${stem}.m4v`, reported: ['video/x-m4v'], sent: 'video/x-m4v', buffer: withBrand(mp4(), 'M4V ') },
    { label: 'MOV', name: `${stem}.MOV`, reported: ['video/quicktime'], sent: 'video/quicktime', buffer: withBrand(mp4(), 'qt  ') },
    { label: 'WebM', name: `${stem}.webm`, reported: ['video/webm'], sent: 'video/webm', buffer: webm() },
    { label: 'MKV', name: `${stem}.mkv`, reported: ['video/x-matroska', ''], sent: 'video/x-matroska', buffer: toMatroska(webm()) },
    { label: 'AVI', name: `${stem}.avi`, reported: ['video/x-msvideo', 'video/avi', 'video/vnd.avi'], sent: 'video/x-msvideo', buffer: emptyAvi() },
  ];
}

/** Files the forms must refuse, with the type a browser reports */
export function refusedFiles(stem: string): Array<{ name: string; mimeType: string; buffer: Buffer }> {
  return [
    { name: `${stem} notes.txt`, mimeType: 'text/plain', buffer: Buffer.from('not a video\n') },
    { name: `${stem} clip.wmv`, mimeType: 'video/x-ms-wmv', buffer: Buffer.alloc(2048) },
    { name: `${stem} no-type.wmv`, mimeType: '', buffer: Buffer.alloc(2048) },
    { name: `${stem} song.mp3`, mimeType: 'audio/mpeg', buffer: Buffer.alloc(2048) },
  ];
}
