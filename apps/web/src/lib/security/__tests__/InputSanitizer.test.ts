/**
 * Story 1.2 AC 3, 5, 6: input is sanitized before event processing; automated
 * injection test corpus (OWASP XSS filter evasion cheat sheet subset).
 */
import {
  escapeHtml,
  sanitizeEventPayload,
  sanitizeText,
  sanitizeUrl,
  validateStructure,
} from '../InputSanitizer';

/** Payloads from the OWASP XSS Filter Evasion Cheat Sheet and common polyglots. */
export const XSS_CORPUS = [
  '<script>alert(1)</script>',
  '<SCRIPT SRC=http://xss.rocks/xss.js></SCRIPT>',
  '<IMG SRC="javascript:alert(\'XSS\');">',
  '<img src=x onerror=alert(1)>',
  '<svg/onload=alert(1)>',
  '<body onload=alert(1)>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<a href="jAvAsCrIpT:alert(1)">x</a>',
  '<scr<script>ipt>alert(1)</scr</script>ipt>',
  '"><script>alert(document.cookie)</script>',
  '<div style="background:url(javascript:alert(1))">',
  '<object data="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="></object>',
  '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext></math>',
  'jaVasCript:/*-/*`/*\\`/*\'/*"/**/(/* */oNcliCk=alert() )//%0D%0A%0d%0a//</stYle/</titLe/</teXtarEa/</scRipt/--!>\\x3csVg/<sVg/oNloAd=alert()//>\\x3e',
  '<details open ontoggle=alert(1)>',
  '<video><source onerror="alert(1)">',
  '\u0000<script>alert(1)</script>',
];

function containsExecutableMarkup(output: string): boolean {
  return /<\s*[a-z!/]/i.test(output) || /javascript\s*:/i.test(output);
}

describe('sanitizeText', () => {
  it.each(XSS_CORPUS)('neutralises %s', payload => {
    const out = sanitizeText(payload);
    expect(containsExecutableMarkup(out)).toBe(false);
  });

  it('keeps ordinary English and Arabic text intact', () => {
    expect(sanitizeText('Great lecture, thank you!')).toBe('Great lecture, thank you!');
    expect(sanitizeText('جزاك الله خيراً على هذا الدرس')).toBe('جزاك الله خيراً على هذا الدرس');
  });

  it('removes control and bidi-override characters', () => {
    expect(sanitizeText('a\u0000b‮c​d')).toBe('abcd');
  });

  it('caps the length', () => {
    expect(sanitizeText('a'.repeat(5000), 100)).toHaveLength(100);
  });
});

describe('escapeHtml / sanitizeUrl', () => {
  it('escapes HTML metacharacters', () => {
    expect(escapeHtml('<a href="x">\'&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&lt;&#x2F;a&gt;');
  });

  it('only allows http(s) and same-origin relative URLs', () => {
    expect(sanitizeUrl('https://alummahnow.net/en/video/1')).toBe('https://alummahnow.net/en/video/1');
    expect(sanitizeUrl('/en/video/1')).toBe('/en/video/1');
    expect(sanitizeUrl('//evil.example/x')).toBe('');
    expect(sanitizeUrl('javascript:alert(1)')).toBe('');
    expect(sanitizeUrl(' JaVaScRiPt:alert(1)')).toBe('');
    expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBe('');
  });
});

describe('sanitizeEventPayload', () => {
  it('drops prototype-pollution keys', () => {
    const malicious = JSON.parse('{"a":1,"__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}}}');
    const { value, modified } = sanitizeEventPayload<Record<string, unknown>>(malicious);
    expect(value).toEqual({ a: 1 });
    expect(modified).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('sanitizes nested strings and drops non-JSON values', () => {
    const { value } = sanitizeEventPayload({
      title: '<img src=x onerror=alert(1)>Hello',
      nested: { list: ['<script>x</script>ok', 2, Infinity] },
      fn: () => 1,
    });
    expect(value).toEqual({ title: 'Hello', nested: { list: ['ok', 2, null] } });
  });

  it('enforces depth, key and array limits', () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    expect(sanitizeEventPayload(deep, { maxDepth: 3 }).value).toEqual({ a: { b: { c: undefined } } });
    const wide = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(sanitizeEventPayload<object>(wide, { maxKeys: 3 }).value)).toHaveLength(3);
    expect(sanitizeEventPayload<unknown[]>(Array(10).fill(1), { maxArrayLength: 4 }).value).toHaveLength(4);
  });

  it('keeps text intact (minus control chars) when markup stripping is disabled', () => {
    const { value } = sanitizeEventPayload({ text: '2 < 3 and a\u0000b' }, { stripMarkup: false });
    expect(value).toEqual({ text: '2 < 3 and ab' });
  });

  it('does not mutate its input', () => {
    const input = { title: '<b>x</b>' };
    sanitizeEventPayload(input);
    expect(input.title).toBe('<b>x</b>');
  });
});

describe('validateStructure', () => {
  it('checks required/optional field types and strict mode', () => {
    const schema = { required: { type: 'string' as const }, optional: { count: 'number' as const }, strict: true };
    expect(validateStructure({ type: 'x', count: 1 }, schema)).toEqual({ valid: true, errors: [] });
    expect(validateStructure({ count: '1' }, schema).errors).toEqual(['missing:type', 'type:count']);
    expect(validateStructure({ type: 'x', extra: 1 }, schema).errors).toEqual(['unexpected:extra']);
    expect(validateStructure('nope', schema).valid).toBe(false);
  });
});
