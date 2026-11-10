/** Version skew is reported to the admin Errors page (kind "skew") before the page recovers. */
const report = jest.fn();
jest.mock('@/lib/errors/reporter', () => ({ reportError: (...a: unknown[]) => report(...a), withoutErrorForwarding: (fn: () => unknown) => fn() }));
jest.mock('@/lib/logger-client', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import { reportVersionSkew } from '../report';

it('reports the skew event with where it was caught and whether the reload waits for an upload', () => {
  reportVersionSkew({ source: 'server-action-response', name: 'UnrecognizedActionError', message: 'Server Action "x" was not found on the server.', deferred: true });
  const [err, opts] = report.mock.calls[0];
  expect(err).toBeInstanceOf(Error);
  expect(err.name).toBe('UnrecognizedActionError');
  expect(opts).toEqual({ kind: 'skew', extra: { source: 'server-action-response', deferred: true } });
});
