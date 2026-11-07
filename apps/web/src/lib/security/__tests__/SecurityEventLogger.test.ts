/**
 * Story 1.2 AC 2: security events are logged and shipped to the server.
 */
import { SecurityEventLogger, type SecurityEvent } from '../SecurityEventLogger';
import { normalizeCspReports, normalizeSecurityEvents } from '../security-report';

describe('SecurityEventLogger', () => {
  it('batches events and ships them to the endpoint', async () => {
    const shipped: Array<{ endpoint: string; events: SecurityEvent[] }> = [];
    const logger = new SecurityEventLogger({
      batchSize: 2,
      transport: async (endpoint, events) => void shipped.push({ endpoint, events }),
    });
    logger.log({ type: 'listener_blocked', severity: 'medium', reason: 'event-type-not-allowlisted' });
    expect(shipped).toHaveLength(0);
    logger.log({ type: 'listener_blocked', severity: 'medium', reason: 'event-type-not-allowlisted' });
    await logger.flush();
    expect(shipped).toHaveLength(1);
    expect(shipped[0].endpoint).toBe('/api/security/events');
    expect(shipped[0].events).toHaveLength(2);
    expect(logger.getBufferedEvents()).toHaveLength(0);
  });

  it('flushes critical events immediately', async () => {
    const transport = jest.fn(async () => undefined);
    const logger = new SecurityEventLogger({ batchSize: 50, transport });
    logger.log({ type: 'csp_violation', severity: 'critical', reason: 'script-src' });
    await logger.flush();
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('caps the buffer and truncates context values', () => {
    const logger = new SecurityEventLogger({ batchSize: 1000, maxBuffer: 3, transport: async () => undefined });
    for (let i = 0; i < 5; i++) {
      logger.log({ type: 'input_sanitized', severity: 'low', reason: `r${i}`, context: { long: 'x'.repeat(500) } });
    }
    const events = logger.getBufferedEvents();
    expect(events.map(e => e.reason)).toEqual(['r2', 'r3', 'r4']);
    expect(String(events[0].context?.long)).toHaveLength(200);
  });

  it('survives transport failures', async () => {
    const logger = new SecurityEventLogger({ batchSize: 1000, transport: async () => { throw new Error('offline'); } });
    logger.log({ type: 'listener_blocked', severity: 'medium', reason: 'x' });
    await expect(logger.flush()).resolves.toBeUndefined();
  });
});

describe('server-side report normalisation', () => {
  it('keeps only known event types and sanitizes fields', () => {
    const events = normalizeSecurityEvents({
      events: [
        { type: 'listener_blocked', severity: 'high', reason: '<script>x</script>blocked', path: '/en/video/1?token=abc', context: { eventType: 'keydown' } },
        { type: 'made_up', severity: 'low', reason: 'x' },
        { type: 'csp_violation', severity: 'nope', reason: 'script-src' },
      ],
    });
    expect(events).toEqual([
      expect.objectContaining({ type: 'listener_blocked', severity: 'high', reason: 'blocked', path: '/en/video/1' }),
      expect.objectContaining({ type: 'csp_violation', severity: 'medium' }),
    ]);
  });

  it('parses legacy and Reporting API CSP reports without query strings', () => {
    const legacy = normalizeCspReports({
      'csp-report': { 'effective-directive': 'script-src-elem', 'blocked-uri': 'https://evil.example/x.js?id=1', 'document-uri': 'https://qa.alummahnow.net/en?x=1', 'line-number': 3 },
    });
    expect(legacy).toEqual([
      { directive: 'script-src-elem', blockedUri: 'https://evil.example/x.js', documentUri: 'https://qa.alummahnow.net/en', sourceFile: '', disposition: '', line: 3 },
    ]);
    const modern = normalizeCspReports([{ type: 'csp-violation', body: { effectiveDirective: 'script-src', blockedURL: 'inline' } }]);
    expect(modern[0]).toMatchObject({ directive: 'script-src', blockedUri: 'inline' });
  });
});
