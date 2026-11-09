// Finds colours written outside the tokens. Pure, so tests and the CLI share it.
const FAMILIES = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|ummah';
const UTILITIES = 'bg|text|border|ring|from|via|to|fill|stroke|divide|outline|decoration|shadow|accent|caret|placeholder';

const RULES: { name: string; pattern: RegExp }[] = [
  { name: 'hex', pattern: /(?<![&\w/])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g },
  { name: 'color function', pattern: /\b(?:rgba?|hsla?|oklch|oklab|hwb)\(\s*(?!var\()[0-9.]/g },
  { name: 'palette utility', pattern: new RegExp(`(?<![\\w-])(?:${UTILITIES})-(?:(?:${FAMILIES})-\\d{2,3}|white|black)(?![\\w-])`, 'g') },
];

export function countViolations(source: string): number {
  let total = 0;
  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    for (const { pattern } of RULES) total += line.match(pattern)?.length ?? 0;
  }
  return total;
}

export type Allowlist = Record<string, number>;

/** A file over its count is drift. A file under its count must lower the allowlist, so it only shrinks. */
export function compareToAllowlist(found: Allowlist, allowed: Allowlist): string[] {
  const problems: string[] = [];
  for (const [file, count] of Object.entries(found)) {
    const limit = allowed[file] ?? 0;
    if (count > limit) problems.push(`${file}: ${count} hard-coded colours, allowed ${limit}. Use a Fanous token.`);
    else if (count < limit) problems.push(`${file}: now ${count}, allowlist says ${limit}. Run pnpm check:theme-colors --update.`);
  }
  for (const file of Object.keys(allowed)) {
    if (!(file in found)) problems.push(`${file}: no longer has hard-coded colours or was removed. Run pnpm check:theme-colors --update.`);
  }
  return problems;
}
