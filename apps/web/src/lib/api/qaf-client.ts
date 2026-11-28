export class QafRequestError extends Error {
  constructor(readonly code: string, readonly retryAfter?: number) {
    super(code);
  }
}

export async function requestSource<T>(
  channelId: string,
  path = '',
  options: { body?: object; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(`/api/studio/sources/${encodeURIComponent(channelId)}${path}`, {
    method: options.body ? 'POST' : 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
    cache: 'no-store',
  });
  const payload = await response.json() as T & { error?: string; retryAfter?: number };
  if (!response.ok) throw new QafRequestError(payload.error ?? 'unavailable', payload.retryAfter);
  return payload;
}
