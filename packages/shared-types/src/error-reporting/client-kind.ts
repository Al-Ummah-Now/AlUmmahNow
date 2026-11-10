import { isChunkLoadError, isNetworkError, isVersionSkewError } from './classify';
import type { ErrorKind } from './types';

/** Kind of a browser error: skew and chunk failures are recognised whatever caught them. */
export function classifyKind(error: unknown, fallback: ErrorKind): ErrorKind {
  if (isVersionSkewError(error)) return 'skew';
  if (isChunkLoadError(error)) return 'chunk';
  if (isNetworkError(error)) return 'fetch';
  return fallback;
}
