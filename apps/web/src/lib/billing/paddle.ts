'use client';

/**
 * Paddle.js v2 for the /upgrade checkout overlay (wiki AUN-SUBS). Loaded on
 * demand, only when the viewer subscribes through Paddle, so no other page
 * pays for the script. The client token and environment come from
 * GET /api/billing/plans (public values). CSP allows cdn.paddle.com and the
 * checkout frames (lib/security/csp.ts).
 */
import { logger } from '@/lib/logger-client';

export const PADDLE_SCRIPT_URL = 'https://cdn.paddle.com/paddle/v2/paddle.js';

export interface PaddleEvent {
  name?: string;
}

interface PaddleGlobal {
  Environment: { set: (environment: 'sandbox' | 'production') => void };
  Initialize: (options: { token: string; eventCallback?: (event: PaddleEvent) => void }) => void;
  Checkout: { open: (options: { transactionId: string; settings?: Record<string, unknown> }) => void; close?: () => void };
}

declare global {
  interface Window {
    Paddle?: PaddleGlobal;
  }
}

let loading: Promise<PaddleGlobal> | null = null;
let initializedWith: string | null = null;
let listener: ((event: PaddleEvent) => void) | null = null;

function loadScript(): Promise<PaddleGlobal> {
  if (window.Paddle) return Promise.resolve(window.Paddle);
  if (loading) return loading;
  loading = new Promise<PaddleGlobal>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PADDLE_SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.Paddle ? resolve(window.Paddle) : reject(new Error('Paddle.js loaded without its global')));
    script.onerror = () => reject(new Error('Paddle.js failed to load'));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

/**
 * Opens Paddle's overlay for a transaction the API created. `onEvent` gets
 * the overlay's events (checkout.completed, checkout.closed); the latest
 * caller's handler wins, Paddle is initialized once per token.
 */
export async function openPaddleCheckout(
  config: { clientToken: string; environment: 'sandbox' | 'production' },
  transactionId: string,
  options: { locale: string; onEvent: (event: PaddleEvent) => void },
): Promise<void> {
  const paddle = await loadScript();
  listener = options.onEvent;
  if (initializedWith !== config.clientToken) {
    paddle.Environment.set(config.environment);
    paddle.Initialize({ token: config.clientToken, eventCallback: (event) => listener?.(event) });
    initializedWith = config.clientToken;
    logger.debug('[billing] Paddle initialized', { environment: config.environment });
  }
  paddle.Checkout.open({ transactionId, settings: { locale: options.locale === 'ar' ? 'ar' : 'en', displayMode: 'overlay' } });
}
