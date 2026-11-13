/**
 * Streams the records of a QF snapshot without holding the whole JSON in memory.
 *
 * The envelope is `{ resource_group, resource_id, ..., schema_version, records: [ {...}, ... ] }`.
 * `records` is the envelope's only array, so every object directly inside a top-level array is a
 * record: its text is collected (strings and escapes respected) and parsed on its own. The scalar
 * envelope fields are returned at the end.
 */
export async function streamSnapshotRecords(
  body: ReadableStream<Uint8Array>,
  onRecord: (record: Record<string, unknown>) => void,
): Promise<{ records: number; envelope: Record<string, unknown> }> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  // Container stack: '{' or '['
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let record: string[] | null = null;
  let count = 0;
  // The envelope's opening (its scalar fields), up to the `records` key
  let head = '';

  const feed = (chunk: string) => {
    let recordFrom = record ? 0 : -1;
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') {
        inString = true;
        continue;
      }
      if (c === '{' || c === '[') {
        if (c === '{' && stack.length === 2 && stack[1] === '[' && !record) {
          record = [];
          recordFrom = i;
        }
        stack.push(c);
      } else if (c === '}' || c === ']') {
        stack.pop();
        if (record && c === '}' && stack.length === 2) {
          record.push(chunk.slice(recordFrom, i + 1));
          onRecord(JSON.parse(record.join('')) as Record<string, unknown>);
          count++;
          record = null;
          recordFrom = -1;
        }
      }
    }
    if (record && recordFrom >= 0) record.push(chunk.slice(recordFrom));
  };

  // Keep the envelope's opening (everything before `records`) for its scalar fields
  let headDone = false;
  for (;;) {
    const { done, value } = await reader.read();
    const text = done ? decoder.decode() : decoder.decode(value, { stream: true });
    if (text) {
      if (!headDone) {
        // Searched in the joined text: a chunk boundary may split the key
        head += text;
        const at = head.indexOf('"records"');
        if (at >= 0 || head.length > 65_536) {
          head = at >= 0 ? head.slice(0, at) : head.slice(0, 65_536);
          headDone = true;
        }
      }
      feed(text);
    }
    if (done) break;
  }
  if (stack.length || inString) throw new Error('QF snapshot ended early (truncated JSON)');
  return { records: count, envelope: parseHead(head) };
}

/** Scalar fields of the envelope's opening: `{"resource_group":"quran_core","resource_id":1,...,` */
function parseHead(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const re = /"([a-z_]+)"\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|null|true|false)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) out[m[1]!] = JSON.parse(m[2]!);
  return out;
}
