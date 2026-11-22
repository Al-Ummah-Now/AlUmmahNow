/**
 * English copy uses typographic apostrophes and quotes (’ “ ”), never straight ones (' ").
 * Scans only string values of the English copy, so keys and code are never looked at: the web
 * strings (EN_TRANSLATIONS, every *_EN block merged in) and the creator invite email's default copy.
 * A value that shows code a user types (an HTML attribute, JSON) is listed in CODE_SAMPLES.
 */
import { CREATOR_INVITE_SEED_COPY, EN_TRANSLATIONS } from '@al-ummah/shared-types';

/** Key paths whose value quotes code the user types, so the straight quote is the right glyph. */
const CODE_SAMPLES = new Set<string>([
  'studio.site.seo.verificationHint', // the content="…" part of a <meta> tag
]);

function straightQuotes(tree: unknown, prefix: string): string[] {
  const found: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (typeof node === 'string') {
      if (/['"]/.test(node) && !CODE_SAMPLES.has(path)) found.push(`${path}: ${node}`);
    } else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) walk(value, path ? `${path}.${key}` : key);
    }
  };
  walk(tree, prefix);
  return found;
}

describe('English copy uses typographic quotes', () => {
  it('has no straight apostrophe or quote in the web strings (use ’ and “ ”)', () => {
    expect(straightQuotes(EN_TRANSLATIONS, '')).toEqual([]);
  });

  it('has no straight apostrophe or quote in the invite email (use ’ and “ ”)', () => {
    expect(straightQuotes(CREATOR_INVITE_SEED_COPY.en, 'invite.en')).toEqual([]);
  });

  it('flags a straight apostrophe and quote, and skips a listed code sample', () => {
    expect(straightQuotes({ a: { b: "Don't", c: 'Say "hi"', d: 'Don’t say “hi”' } }, '')).toEqual(["a.b: Don't", 'a.c: Say "hi"']);
    expect(straightQuotes({ studio: { site: { seo: { verificationHint: 'content="…"' } } } }, '')).toEqual([]);
  });
});
