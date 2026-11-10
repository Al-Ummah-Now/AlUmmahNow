/**
 * Every client-side error reaches the server: direct reports, logger.error
 * calls (forwarded), with the signed-in usr_ id, release, route and context,
 * scrubbed, batched, never twice for the same Error object.
 */
type Sent = { events: Array<Record<string, unknown> & { extra?: Record<string, unknown> }> };

const sent: Sent[] = [];
const fetchMock = jest.fn(async (_url: string, init: { body: string }) => {
  sent.push(JSON.parse(init.body));
  return { ok: true, status: 202 } as Response;
});

beforeAll(() => {
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
});

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('web error reporter', () => {
  let mod: typeof import('../reporter');
  let logger: typeof import('@/lib/logger-client').logger;

  beforeEach(async () => {
    jest.resetModules();
    sent.length = 0;
    fetchMock.mockClear();
    process.env.NEXT_PUBLIC_RELEASE = 'abc123def456';
    window.history.pushState({}, '', '/en/upload');
    document.documentElement.lang = 'en';
    document.documentElement.setAttribute('data-theme', 'fawanees');
    mod = await import('../reporter');
    logger = (await import('@/lib/logger-client')).logger;
    mod.setErrorContext({ userId: 'usr_abc123', workerVersion: 'v-1', environment: 'qa' });
  });

  const events = () => sent.flatMap((b) => b.events);

  it('a shown error is sent at once with the context, scrubbed', () => {
    const ref = mod.reportError(new Error('Upload for someone@example.com failed?token=abcd'), { kind: 'upload', shown: true, status: 500, extra: { step: 'initiate', fileCount: 11 } });
    expect(ref).toMatch(/^ERR-/);
    expect(fetchMock).toHaveBeenCalledWith('/api/errors', expect.objectContaining({ method: 'POST', keepalive: true }));
    const [e] = events();
    expect(e).toMatchObject({ app: 'web', kind: 'upload', ref, status: 500, release: 'abc123def456', workerVersion: 'v-1', userId: 'usr_abc123', locale: 'en', theme: 'fawanees', route: '/en/upload', shown: true });
    expect(e.extra).toMatchObject({ step: 'initiate', fileCount: 11 });
    expect(JSON.stringify(e)).not.toContain('someone@example.com');
    expect(JSON.stringify(e)).not.toContain('abcd');
  });

  it('never sends a user id that is not a usr_ id', () => {
    mod.setErrorContext({ userId: 'someone@example.com' });
    mod.reportError(new Error('x'), { shown: true });
    expect(events()[0].userId).toBeUndefined();
  });

  it('logger.error() is forwarded with its message and primitive data as context', async () => {
    const err = new Error('Network down');
    logger.error('[useBatchUpload] Failed to add files', { error: err, fileCount: 11, videoId: 'v1', nested: { no: true } });
    await settle();
    mod.flushErrorReports();
    const [e] = events();
    expect(e).toMatchObject({ kind: 'caught', message: 'Network down' });
    expect(e.extra).toMatchObject({ logged: '[useBatchUpload] Failed to add files', fileCount: 11, videoId: 'v1' });
    expect(e.extra).not.toHaveProperty('nested');
  });

  it('a logged string error becomes an error with the log message', async () => {
    logger.error('[useBatchUpload] Complete upload failed', { videoId: 'v9', error: 'HTTP 502' });
    await settle();
    mod.flushErrorReports();
    expect(events()[0].message).toBe('[useBatchUpload] Complete upload failed: HTTP 502');
  });

  it('an Error reported directly is not sent again by a logger.error of the same object', async () => {
    const err = new Error('boom');
    logger.error('failed', err);
    mod.reportError(err, { shown: true });
    await settle();
    mod.flushErrorReports();
    expect(events()).toHaveLength(1);
  });

  it('withoutErrorForwarding keeps a log local (the caller reports it itself)', async () => {
    mod.withoutErrorForwarding(() => logger.error('local only', { error: new Error('x') }));
    await settle();
    mod.flushErrorReports();
    expect(events()).toHaveLength(0);
  });

  it('version skew caught by a logger is left to the skew recovery', async () => {
    logger.error('action failed', new Error('Server Action "abc" was not found on the server.'));
    await settle();
    mod.flushErrorReports();
    expect(events()).toHaveLength(0);
  });

  it('flushes background events with sendBeacon when the page is hidden', async () => {
    const beacon = jest.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    const uninstall = mod.getReporter()!.install();
    mod.reportError(new Error('background'), { kind: 'caught' });
    window.dispatchEvent(new Event('pagehide'));
    expect(beacon).toHaveBeenCalledWith('/api/errors', expect.anything());
    uninstall();
  });
});
