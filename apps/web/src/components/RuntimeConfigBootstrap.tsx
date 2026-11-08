'use client';

import type { RuntimeConfig } from '@/lib/runtime-config';

/**
 * Backstop for the runtime-config <script> in the root layout. When a route
 * calls notFound(), Next sends a bare error shell and builds the document in
 * the browser, where an inline script never runs (#297). Rendered ahead of the
 * providers, so the config is set before any of their effects.
 */
export function RuntimeConfigBootstrap({ config }: { config: RuntimeConfig }): null {
  if (typeof window !== 'undefined' && !window.__RUNTIME_CONFIG__) {
    window.__RUNTIME_CONFIG__ = config;
  }
  return null;
}
