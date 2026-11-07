/**
 * Story 1.2 AC 1, 2: only allowlisted global listeners are registered;
 * suspicious listeners are blocked and logged.
 */
import { EventListenerValidator, createOriginCheckedHandler } from '../EventListenerValidator';
import { SecurityEventLogger, type SecurityEvent } from '../SecurityEventLogger';

function makeLogger() {
  const shipped: SecurityEvent[][] = [];
  const logger = new SecurityEventLogger({ batchSize: 1000, transport: async (_e, events) => void shipped.push(events) });
  return { logger, shipped };
}

describe('EventListenerValidator', () => {
  let validator: EventListenerValidator;
  let logger: SecurityEventLogger;

  beforeEach(() => {
    ({ logger } = makeLogger());
    validator = new EventListenerValidator({ logger });
  });

  afterEach(() => validator.uninstall());

  describe('validate()', () => {
    it('allows allowlisted event types with plain handlers', () => {
      expect(validator.validate('keydown', () => undefined)).toEqual({ allowed: true, suspicious: [] });
      expect(validator.validate('resize', { handleEvent: () => undefined }).allowed).toBe(true);
    });

    it('allows event types that are not allowlisted but flags them once per type', () => {
      expect(validator.validate('keypress-logger', () => undefined)).toEqual({
        allowed: true,
        suspicious: ['event-type-not-allowlisted'],
      });
      // Reported only once per type
      expect(validator.validate('keypress-logger', () => undefined)).toEqual({ allowed: true, suspicious: [] });
    });

    it('allows every event React delegates to the document root (controlled inputs need input/beforeinput)', () => {
      for (const type of ['input', 'beforeinput', 'compositionend', 'submit', 'select', 'dblclick', 'mouseover', 'timeupdate', 'toggle']) {
        expect(validator.validate(type, () => undefined).allowed).toBe(true);
      }
    });

    it('rejects invalid listeners and event types', () => {
      expect(validator.validate('', () => undefined).reason).toBe('invalid-event-type');
      expect(validator.validate('x'.repeat(65), () => undefined).reason).toBe('invalid-event-type');
      expect(validator.validate('keydown', 'alert(1)' as unknown as EventListener).reason).toBe('invalid-listener');
    });

    it.each([
      ['eval', function handler() { return eval('1'); }],
      ['function-constructor', function handler() { return new Function('return 1')(); }],
      ['document-write', function handler() { document.write('<p>x</p>'); }],
      ['javascript-url', function handler() { location.href = 'javascript:alert(1)'; }],
      ['string-timer', function handler() { setTimeout('alert(1)' as unknown as () => void, 0); }],
    ])('blocks handlers using %s', (id, handler) => {
      expect(validator.validate('keydown', handler as EventListener)).toEqual({ allowed: false, reason: `blocked-pattern:${id}` });
    });

    it('flags but allows suspicious handlers', () => {
      const handler = () => document.cookie;
      expect(validator.validate('keydown', handler)).toEqual({ allowed: true, suspicious: ['cookie-access'] });
    });

    it('supports explicit block/allow overrides', () => {
      validator.block('resize');
      expect(validator.validate('resize', () => undefined).allowed).toBe(false);
      validator.allow('resize');
      validator.allow('my-custom-event');
      expect(validator.validate('resize', () => undefined).allowed).toBe(true);
      expect(validator.validate('my-custom-event', () => undefined).allowed).toBe(true);
    });

    it('validates within the 10ms performance budget', () => {
      const handlers = Array.from({ length: 200 }, (_, i) => () => i);
      const start = performance.now();
      handlers.forEach(h => validator.validate('keydown', h));
      expect((performance.now() - start) / handlers.length).toBeLessThan(10);
    });
  });

  describe('install()', () => {
    it('registers allowlisted global listeners normally', () => {
      validator.install();
      const handler = jest.fn();
      window.addEventListener('resize', handler);
      window.dispatchEvent(new Event('resize'));
      expect(handler).toHaveBeenCalledTimes(1);
      window.removeEventListener('resize', handler);
    });

    it('registers non-allowlisted global listeners (e.g. media events) and reports them', () => {
      validator.install();
      const handler = jest.fn();
      document.addEventListener('totally-unknown', handler);
      document.dispatchEvent(new Event('totally-unknown'));
      expect(handler).toHaveBeenCalledTimes(1);
      expect(logger.getBufferedEvents()).toEqual([
        expect.objectContaining({
          type: 'listener_suspicious',
          reason: 'event-type-not-allowlisted',
          context: expect.objectContaining({ target: 'document', eventType: 'totally-unknown' }),
        }),
      ]);
    });

    it('blocks injected handlers on allowlisted types with high severity', () => {
      validator.install();
      // Typical injected keylogger: exfiltrates keys through a constructed function.
      const injected = function (e: KeyboardEvent) { new Function('k', 'return k')(e.key); };
      window.addEventListener('keydown', injected as EventListener);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
      const [event] = logger.getBufferedEvents();
      expect(event).toMatchObject({ type: 'listener_blocked', severity: 'high', reason: 'blocked-pattern:function-constructor' });
    });

    it('passes null-listener feature probes through without logging', () => {
      validator.install();
      let passiveRead = false;
      const options = Object.defineProperty({}, 'passive', { get: () => (passiveRead = true) });
      window.addEventListener('test', null as unknown as EventListener, options as AddEventListenerOptions);
      expect(passiveRead).toBe(true);
      expect(logger.getBufferedEvents()).toHaveLength(0);
    });

    it('does not intercept element-scoped listeners', () => {
      validator.install();
      const el = document.createElement('div');
      const handler = jest.fn();
      el.addEventListener('totally-unknown', handler);
      el.dispatchEvent(new Event('totally-unknown'));
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('report mode logs but still registers', () => {
      const reportOnly = new EventListenerValidator({ logger, mode: 'report' });
      reportOnly.install();
      const handler = jest.fn();
      document.addEventListener('totally-unknown', handler);
      document.dispatchEvent(new Event('totally-unknown'));
      expect(handler).toHaveBeenCalledTimes(1);
      expect(logger.getBufferedEvents()).toHaveLength(1);
      reportOnly.uninstall();
    });

    it('uninstall restores the native addEventListener', () => {
      const original = document.addEventListener;
      validator.install();
      expect(document.addEventListener).not.toBe(original);
      validator.uninstall();
      expect(document.addEventListener).toBe(original);
      expect(Object.prototype.hasOwnProperty.call(document, 'addEventListener')).toBe(false);
    });

    it('is idempotent', () => {
      validator.install();
      const guarded = window.addEventListener;
      validator.install();
      expect(window.addEventListener).toBe(guarded);
    });
  });
});

describe('createOriginCheckedHandler', () => {
  it('only forwards messages from trusted origins with plain payloads', () => {
    const { logger } = makeLogger();
    const handler = jest.fn();
    const checked = createOriginCheckedHandler(['https://iframe.mediadelivery.net'], handler, logger);

    checked(new MessageEvent('message', { origin: 'https://evil.example', data: { type: 'x' } }));
    checked(new MessageEvent('message', { origin: 'https://iframe.mediadelivery.net', data: new Date() }));
    checked(new MessageEvent('message', { origin: 'https://iframe.mediadelivery.net', data: { type: 'ready' } }));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(logger.getBufferedEvents().map(e => e.reason)).toEqual(['untrusted-origin', 'non-plain-payload']);
  });
});
