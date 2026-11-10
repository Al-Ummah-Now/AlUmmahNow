import { redact, redactString, resolveLogLevel, summaryLevel, REDACTED, REDACTED_EMAIL } from '../policy.js';

describe('resolveLogLevel', () => {
  it.each([
    ['production', 'warn'],
    ['stage', 'info'],
    ['staging', 'info'],
    ['qa', 'debug'],
    ['development', 'debug'],
    ['preview', 'debug'],
  ])('%s → %s', (environment, level) => {
    expect(resolveLogLevel({ environment })).toBe(level);
  });

  it('is case- and space-insensitive', () => {
    expect(resolveLogLevel({ environment: ' Production ', logLevel: 'WARN' })).toBe('warn');
  });

  it('ignores an invalid LOG_LEVEL', () => {
    expect(resolveLogLevel({ environment: 'stage', logLevel: 'verbose' })).toBe('info');
  });

  it('clamps production to info at most verbose', () => {
    expect(resolveLogLevel({ environment: 'production', logLevel: 'trace' })).toBe('info');
    expect(resolveLogLevel({ environment: 'production', logLevel: 'debug' })).toBe('info');
    expect(resolveLogLevel({ environment: 'production', logLevel: 'error' })).toBe('error');
  });

  it('unknown environment: warn, unless NODE_ENV is development/test', () => {
    expect(resolveLogLevel({})).toBe('warn');
    expect(resolveLogLevel({ nodeEnv: 'production' })).toBe('warn');
    expect(resolveLogLevel({ nodeEnv: 'development' })).toBe('debug');
    expect(resolveLogLevel({ nodeEnv: 'test' })).toBe('debug');
  });
});

describe('redact', () => {
  it('replaces secret-named keys at any depth', () => {
    const out = redact({
      userId: 'u1',
      password: 'p',
      accessToken: 'a',
      refresh_token: 'r',
      Authorization: 'Bearer x',
      cookie: 'c',
      'x-api-key': 'k',
      apiKey: 'k',
      client_secret: 's',
      nested: { idToken: 't', sessionId: 's', ok: 1 },
    });
    expect(out).toEqual({
      userId: 'u1',
      password: REDACTED,
      accessToken: REDACTED,
      refresh_token: REDACTED,
      Authorization: REDACTED,
      cookie: REDACTED,
      'x-api-key': REDACTED,
      apiKey: REDACTED,
      client_secret: REDACTED,
      nested: { idToken: REDACTED, sessionId: REDACTED, ok: 1 },
    });
  });

  it('keeps booleans and ids that only look similar', () => {
    expect(redact({ hasToken: true, emailVerified: false, key: 'videos/v1.json', tokenCount: 3 })).toEqual({
      hasToken: true,
      emailVerified: false,
      key: 'videos/v1.json',
      tokenCount: 3,
    });
  });

  it('removes emails by key and inside text', () => {
    expect(redact({ email: 'a@b.com', userEmail: 'c@d.org', note: 'sent to jane.doe@example.co.uk ok' })).toEqual({
      email: REDACTED_EMAIL,
      userEmail: REDACTED_EMAIL,
      note: `sent to ${REDACTED_EMAIL} ok`,
    });
  });

  it('omits whole request bodies', () => {
    expect(redact({ requestBody: { title: 't' }, rawBody: 'x', payload: '{}' })).toEqual({
      requestBody: '[body omitted]',
      rawBody: '[body omitted]',
      payload: '[body omitted]',
    });
  });

  it('removes JWTs, bearer credentials and secret URL parameters from text', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    expect(redactString(`token ${jwt} end`)).toBe(`token ${REDACTED} end`);
    expect(redactString('Authorization: Bearer abcdefghijklmnop')).toBe(`Authorization: Bearer ${REDACTED}`);
    expect(redactString('https://cdn/x.m3u8?token=abc123&expires=99')).toBe(`https://cdn/x.m3u8?token=${REDACTED}&expires=99`);
    expect(redactString('/callback?code=xyz&state=s')).toBe(`/callback?code=${REDACTED}&state=s`);
  });

  it('serialises Errors with stack, cause and code', () => {
    const cause = new Error('inner');
    const err = Object.assign(new Error('outer a@b.com', { cause }), { code: 'E1', status: 502 });
    const out = redact(err) as Record<string, unknown>;
    expect(out).toMatchObject({ name: 'Error', message: `outer ${REDACTED_EMAIL}`, code: 'E1', status: 502 });
    expect(out.stack).toEqual(expect.any(String));
    expect(out.cause).toMatchObject({ message: 'inner' });
  });

  it('bounds size: depth, arrays, long strings, cycles', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(redact(cyclic)).toEqual({ a: 1, self: '[circular]' });

    const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
    expect(JSON.stringify(redact(deep))).toContain('[truncated]');

    const arr = redact(Array.from({ length: 60 }, (_, i) => i)) as unknown[];
    expect(arr).toHaveLength(51);
    expect(arr[50]).toBe('…[+10 items]');

    expect((redact('x'.repeat(5000)) as string).length).toBeLessThan(2100);
  });

  it('never logs headers, and only method+url of a Request', () => {
    const headers = new Headers({ cookie: 'c' });
    expect(redact({ headers })).toEqual({ headers: REDACTED });
    expect(redact(new Request('https://x.test/a?token=t', { method: 'POST', body: 'secret body' }))).toEqual({
      method: 'POST',
      url: `https://x.test/a?token=${REDACTED}`,
    });
  });
});

describe('summaryLevel', () => {
  it('error for 5xx, thrown or failed; warn for slow or retry; info otherwise', () => {
    expect(summaryLevel({ status: 200, durationMs: 10 })).toBe('info');
    expect(summaryLevel({ status: 404, durationMs: 10 })).toBe('info');
    expect(summaryLevel({ status: 200, durationMs: 1500 })).toBe('warn');
    expect(summaryLevel({ status: 500, durationMs: 10 })).toBe('error');
    expect(summaryLevel({ durationMs: 10, error: new Error('x') })).toBe('error');
    expect(summaryLevel({ durationMs: 10, outcome: 'failed' })).toBe('error');
    expect(summaryLevel({ durationMs: 10, outcome: 'retry' })).toBe('warn');
    expect(summaryLevel({ status: 200, durationMs: 900 }, 800)).toBe('warn');
  });
});
