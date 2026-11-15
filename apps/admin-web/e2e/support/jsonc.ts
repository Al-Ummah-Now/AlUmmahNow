/**
 * Minimal JSONC reader for wrangler config files (the processor's queue batch timeout, cleanup.ts):
 * strips // and block comments and trailing commas outside strings, then JSON.parse. Kept inside
 * the admin-web project, which type-checks only its own files (scripts/release/jsonc.ts is the
 * release scripts' copy).
 */
export function parseJsonc(text: string): unknown {
  return JSON.parse(stripTrailingCommas(stripComments(text)));
}

/** Calls `visit` for each character outside strings; strings are copied as they are. */
function outsideStrings(text: string, visit: (i: number) => { skip: number; emit: string }): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === '\\') out += text[++i] ?? '';
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else {
      const { skip, emit } = visit(i);
      out += emit;
      i += skip;
    }
  }
  return out;
}

function stripComments(text: string): string {
  return outsideStrings(text, (i) => {
    if (text[i] === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      return { skip: (end < 0 ? text.length : end) - i - 1, emit: '' };
    }
    if (text[i] === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      return { skip: (end < 0 ? text.length : end + 2) - i - 1, emit: '' };
    }
    return { skip: 0, emit: text[i] };
  });
}

function stripTrailingCommas(text: string): string {
  return outsideStrings(text, (i) => ({ skip: 0, emit: text[i] === ',' && /^\s*[}\]]/.test(text.slice(i + 1)) ? '' : text[i] }));
}
