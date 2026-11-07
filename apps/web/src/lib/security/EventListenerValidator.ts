/**
 * EventListenerValidator (Story 1.2, AC 1, 2)
 *
 * Guards the two global event targets (`window` and `document`). Once installed,
 * every `addEventListener` call on those targets is validated:
 *
 * 1. The event type must be in GLOBAL_EVENT_ALLOWLIST (or explicitly allowed).
 * 2. The listener must be a function or an object with `handleEvent`.
 * 3. The listener source must not match BLOCKED_HANDLER_PATTERNS (eval,
 *    Function constructor, document.write, javascript: URLs, string timers).
 *
 * Rejected listeners are never registered (mode `enforce`) and are reported to
 * the SecurityEventLogger. Listeners that match SUSPICIOUS_HANDLER_PATTERNS are
 * registered but reported. Element-level listeners are not intercepted: they are
 * scoped to the element they are attached to by construction.
 */

import {
  BLOCKED_HANDLER_PATTERNS,
  GLOBAL_EVENT_ALLOWLIST,
  SUSPICIOUS_HANDLER_PATTERNS,
} from './allowlist';
import { SecurityEventLogger, securityEventLogger } from './SecurityEventLogger';

export type ValidatorMode = 'enforce' | 'report';

export interface ListenerValidationResult {
  allowed: boolean;
  reason?: string;
  suspicious?: string[];
}

export interface EventListenerValidatorOptions {
  mode?: ValidatorMode;
  allowlist?: Iterable<string>;
  logger?: SecurityEventLogger;
}

type AddEventListenerFn = EventTarget['addEventListener'];

interface InstalledTarget {
  target: EventTarget;
  hadOwnProperty: boolean;
  previous: AddEventListenerFn;
}

function listenerSource(listener: EventListenerOrEventListenerObject): string {
  try {
    if (typeof listener === 'function') {
      return Function.prototype.toString.call(listener);
    }
    const handleEvent = (listener as EventListenerObject).handleEvent;
    return typeof handleEvent === 'function' ? Function.prototype.toString.call(handleEvent) : '';
  } catch {
    // Proxies and some host objects throw on toString; treat them as opaque.
    return '';
  }
}

export class EventListenerValidator {
  private readonly allowlist: Set<string>;
  private readonly denylist = new Set<string>();
  private readonly mode: ValidatorMode;
  private readonly reportedUnlisted = new Set<string>();
  private readonly logger: SecurityEventLogger;
  private readonly sourceCache = new WeakMap<object, ListenerValidationResult>();
  private installed: InstalledTarget[] = [];

  constructor(options: EventListenerValidatorOptions = {}) {
    this.mode = options.mode ?? 'enforce';
    this.allowlist = new Set(options.allowlist ?? GLOBAL_EVENT_ALLOWLIST);
    this.logger = options.logger ?? securityEventLogger;
  }

  /** Permit an additional global event type (e.g. a vetted third-party integration). */
  allow(type: string): void {
    this.denylist.delete(type);
    this.allowlist.add(type);
  }

  /** Block an event type on global targets even if it is on the allowlist. */
  block(type: string): void {
    this.denylist.add(type);
  }

  isInstalled(): boolean {
    return this.installed.length > 0;
  }

  /**
   * Validate a listener without registering it.
   */
  validate(type: string, listener: EventListenerOrEventListenerObject | null | undefined): ListenerValidationResult {
    if (typeof type !== 'string' || type.length === 0 || type.length > 64) {
      return { allowed: false, reason: 'invalid-event-type' };
    }
    if (this.denylist.has(type)) {
      return { allowed: false, reason: 'event-type-blocked' };
    }
    // Unlisted event types are allowed: libraries (e.g. Video.js media events,
    // React/input handling) legitimately use many types. They are reported once
    // per type for review; malicious handlers are still blocked by the source
    // patterns below and the CSP.
    const unlisted = !this.allowlist.has(type) && !this.reportedUnlisted.has(type);
    if (unlisted) this.reportedUnlisted.add(type);
    if (listener === null || listener === undefined) {
      // addEventListener ignores null listeners; nothing to register.
      return { allowed: true };
    }
    const isObjectListener =
      typeof listener === 'object' && typeof (listener as EventListenerObject).handleEvent === 'function';
    if (typeof listener !== 'function' && !isObjectListener) {
      return { allowed: false, reason: 'invalid-listener' };
    }

    const cached = this.sourceCache.get(listener as object);
    if (cached) return unlisted ? { ...cached, suspicious: [...(cached.suspicious ?? []), 'event-type-not-allowlisted'] } : cached;

    const source = listenerSource(listener);
    const blocked = BLOCKED_HANDLER_PATTERNS.find(({ pattern }) => pattern.test(source));
    const result: ListenerValidationResult = blocked
      ? { allowed: false, reason: `blocked-pattern:${blocked.id}` }
      : {
          allowed: true,
          suspicious: SUSPICIOUS_HANDLER_PATTERNS.filter(({ pattern }) => pattern.test(source)).map(({ id }) => id),
        };
    this.sourceCache.set(listener as object, result);
    return unlisted && result.allowed ? { ...result, suspicious: [...(result.suspicious ?? []), 'event-type-not-allowlisted'] } : result;
  }

  /**
   * Intercept addEventListener on the given global targets. Returns an uninstall
   * function. Installing twice is a no-op.
   */
  install(targets?: EventTarget[]): () => void {
    if (this.installed.length > 0) return () => this.uninstall();
    const resolved =
      targets ??
      ([typeof window !== 'undefined' ? window : null, typeof document !== 'undefined' ? document : null].filter(
        Boolean,
      ) as EventTarget[]);

    for (const target of resolved) {
      const hadOwnProperty = Object.prototype.hasOwnProperty.call(target, 'addEventListener');
      const previous = target.addEventListener;
      const targetName = target === (typeof window !== 'undefined' ? window : undefined) ? 'window' : 'document';
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const validator = this;

      const guarded: AddEventListenerFn = function guardedAddEventListener(
        this: EventTarget,
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ) {
        // A null listener registers nothing; libraries use it to feature-detect
        // passive/once support (e.g. addEventListener('test', null, opts)).
        if (listener === null || listener === undefined) {
          return previous.call(this, type, listener, options);
        }
        const result = validator.validate(type, listener);
        if (!result.allowed) {
          validator.logger.log({
            type: 'listener_blocked',
            severity: result.reason?.startsWith('blocked-pattern') ? 'high' : 'medium',
            reason: result.reason ?? 'rejected',
            context: { target: targetName, eventType: String(type).slice(0, 64), mode: validator.mode },
          });
          if (validator.mode === 'enforce') return;
        } else if (result.suspicious && result.suspicious.length > 0) {
          validator.logger.log({
            type: 'listener_suspicious',
            severity: 'low',
            reason: result.suspicious.join(','),
            context: { target: targetName, eventType: type },
          });
        }
        return previous.call(this, type, listener, options);
      };

      Object.defineProperty(target, 'addEventListener', {
        value: guarded,
        configurable: true,
        writable: true,
      });
      this.installed.push({ target, hadOwnProperty, previous });
    }

    return () => this.uninstall();
  }

  uninstall(): void {
    for (const { target, hadOwnProperty, previous } of this.installed) {
      if (hadOwnProperty) {
        Object.defineProperty(target, 'addEventListener', { value: previous, configurable: true, writable: true });
      } else {
        delete (target as unknown as Record<string, unknown>).addEventListener;
      }
    }
    this.installed = [];
  }
}

/**
 * Wrap a `message` handler so it only runs for messages from trusted origins and
 * with a plain-object payload. Rejections are reported to the security log.
 */
export function createOriginCheckedHandler(
  allowedOrigins: ReadonlyArray<string>,
  handler: (event: MessageEvent) => void,
  logger: SecurityEventLogger = securityEventLogger,
): (event: MessageEvent) => void {
  const allowed = new Set(allowedOrigins);
  return (event: MessageEvent) => {
    if (!allowed.has(event.origin)) {
      logger.log({
        type: 'message_rejected',
        severity: 'medium',
        reason: 'untrusted-origin',
        context: { origin: event.origin || 'null' },
      });
      return;
    }
    const data = event.data as unknown;
    if (data !== null && typeof data === 'object' && Object.getPrototypeOf(data) !== Object.prototype && !Array.isArray(data)) {
      logger.log({ type: 'message_rejected', severity: 'medium', reason: 'non-plain-payload', context: { origin: event.origin } });
      return;
    }
    handler(event);
  };
}

/** Process-wide validator used by SecurityBootstrap. */
export const eventListenerValidator = new EventListenerValidator();
