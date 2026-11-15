/**
 * A tus `fileReader` that uploads one entry of a Google Takeout zip without
 * extracting it (wiki AUN-YT-IMPORT). The entry is inflated as a stream
 * (openEntryStream over File.slice) and handed to tus chunk by chunk.
 *
 * tus asks for slices in order. After a failed PATCH it asks again from the
 * server's offset, which can be earlier than what was already read: the
 * stream cannot seek, so it is opened again and the bytes before that offset
 * are skipped. The last slice stays buffered, so repeating the same chunk
 * (the usual retry) costs no reopen.
 */
import type * as tus from 'tus-js-client';

/** Opens the entry's uncompressed bytes from the start. */
export type EntryOpener = () => Promise<ReadableStream<Uint8Array>>;

export class EntryReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EntryReadError';
  }
}

export class ZipEntrySource implements tus.FileSource {
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  /** Absolute offset of the first buffered byte in the entry */
  private bufferStart = 0;
  /** Buffered bytes as the stream gave them (never concatenated: a chunk is 50 MB) */
  private chunks: Uint8Array[] = [];
  private buffered = 0;
  private ended = false;
  /** How many times the stream was opened (tests, logs) */
  opens = 0;

  constructor(
    private readonly open: EntryOpener,
    readonly size: number,
  ) {}

  private async reopen(): Promise<void> {
    await this.reader?.cancel().catch(() => undefined);
    this.reader = (await this.open()).getReader();
    this.opens++;
    this.bufferStart = 0;
    this.chunks = [];
    this.buffered = 0;
    this.ended = false;
  }

  /** Forget the buffered bytes before `offset`. */
  private dropBefore(offset: number): void {
    while (this.chunks.length > 0 && this.bufferStart < offset) {
      const first = this.chunks[0]!;
      const drop = Math.min(offset - this.bufferStart, first.length);
      if (drop === first.length) this.chunks.shift();
      else this.chunks[0] = first.subarray(drop);
      this.bufferStart += drop;
      this.buffered -= drop;
    }
    // Nothing buffered: whatever comes next starts at the end of what was read
  }

  async slice(start: number, end: number): Promise<{ value: Blob; done: boolean }> {
    const stop = Math.min(end, this.size);
    // tus went back (a retry from the server's offset): the stream cannot seek, so read it again
    if (!this.reader || start < this.bufferStart) await this.reopen();
    this.dropBefore(start);
    while (this.bufferStart + this.buffered < stop && !this.ended) {
      const { value, done } = await this.reader!.read();
      if (done) {
        this.ended = true;
        break;
      }
      if (!value?.length) continue;
      const at = this.bufferStart + this.buffered;
      if (at + value.length <= start) {
        // Still skipping towards the slice: not kept
        this.bufferStart += value.length;
        continue;
      }
      const skip = Math.max(0, start - at);
      if (skip > 0) this.bufferStart += skip;
      const kept = skip > 0 ? value.subarray(skip) : value;
      this.chunks.push(kept);
      this.buffered += kept.length;
    }
    if (this.bufferStart + this.buffered < stop) {
      throw new EntryReadError(`The entry ended at ${this.bufferStart + this.buffered} bytes, expected ${this.size}`);
    }
    // The slice's parts, without copying them into one array
    const parts: Uint8Array[] = [];
    let offset = this.bufferStart;
    for (const chunk of this.chunks) {
      if (offset >= stop) break;
      const from = Math.max(0, start - offset);
      const to = Math.min(chunk.length, stop - offset);
      if (to > from) parts.push(chunk.subarray(from, to));
      offset += chunk.length;
    }
    // A Blob: tus reads value.size to know how much it sends; the buffer stays until tus moves on (a repeated chunk needs no reopen)
    return { value: new Blob(parts as BlobPart[]), done: stop >= this.size };
  }

  close(): void {
    void this.reader?.cancel().catch(() => undefined);
    this.reader = null;
    this.chunks = [];
    this.buffered = 0;
  }
}

/** The tus `fileReader` for one entry (the input tus passes is ignored: the opener knows the entry). */
export function zipEntryFileReader(open: EntryOpener, size: number): tus.FileReader & { source: () => ZipEntrySource | null } {
  let current: ZipEntrySource | null = null;
  return {
    source: () => current,
    async openFile() {
      current = new ZipEntrySource(open, size);
      return current;
    },
  };
}
