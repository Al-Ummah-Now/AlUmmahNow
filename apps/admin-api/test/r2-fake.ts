/**
 * In-memory R2 bucket that behaves like R2 for concurrent writers: every get
 * and put yields to other tasks (optional random latency), objects carry an
 * etag that changes on every write, and puts honour
 * `onlyIf: { etagMatches }` / `{ etagDoesNotMatch: '*' }` by resolving null.
 */
export class MemoryR2 {
  data = new Map<string, string>();
  private etags = new Map<string, string>();
  private clock = 0;
  puts = 0;
  constructor(private readonly latencyMs = 0) {}

  private async pause() {
    await new Promise((r) => setTimeout(r, this.latencyMs ? Math.random() * this.latencyMs : 0));
  }

  set(key: string, value: unknown) {
    this.data.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    this.etags.set(key, `e${++this.clock}`);
  }

  read<T = any>(key: string): T {
    return JSON.parse(this.data.get(key)!);
  }

  async get(key: string) {
    await this.pause();
    const v = this.data.get(key);
    if (v === undefined) return null;
    const etag = this.etags.get(key) ?? 'e0';
    return { etag, text: async () => v, json: async <T>() => JSON.parse(v) as T };
  }

  async put(key: string, value: string, options?: { onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } }) {
    await this.pause();
    const onlyIf = options?.onlyIf;
    if (onlyIf?.etagMatches !== undefined && onlyIf.etagMatches !== (this.etags.get(key) ?? 'e0')) return null;
    if (onlyIf?.etagDoesNotMatch === '*' && this.data.has(key)) return null;
    this.puts++;
    this.data.set(key, value);
    this.etags.set(key, `e${++this.clock}`);
    return { key, etag: this.etags.get(key), uploaded: new Date(1_700_000_000_000 + this.clock) };
  }

  async delete(key: string) {
    this.data.delete(key);
    this.etags.delete(key);
  }

  async list() {
    return { objects: [...this.data.keys()].map((key) => ({ key })), truncated: false };
  }
}
