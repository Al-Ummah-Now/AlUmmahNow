'use client';

/**
 * SecurityBootstrap (Story 1.2 AC 1, 2; Story 1.3 AC 5)
 *
 * Mounted once in the root layout. Renders nothing.
 *
 * - Installs the EventListenerValidator on window/document as soon as this
 *   client chunk is evaluated, i.e. before the video player and other client
 *   components register their global listeners.
 * - Reports CSP violations seen by the browser to the security event log.
 * - Flushes buffered security events when the page is hidden.
 * - Enforces on-device retention (expired encrypted entries, legacy tracking keys).
 */

import { useEffect } from 'react';
import { eventListenerValidator } from '@/lib/security/EventListenerValidator';
import { securityEventLogger } from '@/lib/security/SecurityEventLogger';
import { enforceLocalRetention } from '@/lib/privacy/local-data';

if (typeof window !== 'undefined') {
  eventListenerValidator.install();
}

export function SecurityBootstrap(): null {
  useEffect(() => {
    eventListenerValidator.install();

    const controller = new AbortController();
    const { signal } = controller;

    document.addEventListener(
      'securitypolicyviolation',
      (event: SecurityPolicyViolationEvent) => {
        securityEventLogger.log({
          type: 'csp_violation',
          severity: event.effectiveDirective.startsWith('script') ? 'high' : 'medium',
          reason: event.effectiveDirective,
          context: {
            blockedUri: (event.blockedURI || 'inline').split(/[?#]/)[0],
            disposition: event.disposition,
          },
        });
      },
      { signal },
    );

    const flush = () => {
      if (document.visibilityState === 'hidden') void securityEventLogger.flush();
    };
    document.addEventListener('visibilitychange', flush, { signal });
    window.addEventListener('pagehide', () => void securityEventLogger.flush(), { signal });

    enforceLocalRetention();

    return () => controller.abort();
  }, []);

  return null;
}

export default SecurityBootstrap;
