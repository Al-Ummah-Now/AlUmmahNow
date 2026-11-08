/**
 * Validates the playback context an analytics batch claims (docs/embeds §6)
 * before it is forwarded to POST /api/videos/:id/view.
 */

import { normalizeOrigin } from './params';

export interface ViewContext {
  source: 'watch' | 'embed';
  embedOrigin?: string;
}

export function viewContextFromBatch(context: unknown): ViewContext {
  if (!context || typeof context !== 'object') return { source: 'watch' };
  const { source, embedOrigin } = context as { source?: unknown; embedOrigin?: unknown };
  if (source !== 'embed') return { source: 'watch' };
  const origin = typeof embedOrigin === 'string' ? normalizeOrigin(embedOrigin) : null;
  return origin ? { source: 'embed', embedOrigin: origin } : { source: 'embed' };
}
