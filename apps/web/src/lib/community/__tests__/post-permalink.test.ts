/**
 * @jest-environment node
 *
 * The permalink loader: locate (published posts only), then read as the viewer; 404s stay 404s,
 * outages are "unavailable" (503), a bad id never reaches the API.
 */
import { loadPermalinkPost } from '../post-permalink';

jest.mock('@/lib/api/api-client', () => ({ buildApiUrl: (path: string) => `https://api.test${path}` }));
jest.mock('@/lib/api/server-auth', () => ({ getServerAuthContext: async () => ({ accessToken: 'tok' }) }));
jest.mock('@/lib/logger-server', () => ({ logger: { warn: jest.fn() } }));
jest.mock('react', () => ({ ...jest.requireActual('react'), cache: (fn: unknown) => fn }));

const reply = (status: number, body?: unknown) => Promise.resolve({ status, ok: status >= 200 && status < 300, json: async () => body } as Response);

describe('loadPermalinkPost', () => {
  const fetchMock = jest.fn();
  beforeEach(() => { fetchMock.mockReset(); global.fetch = fetchMock as never; });

  it('locates the post, then reads it as the viewer', async () => {
    fetchMock.mockImplementationOnce(() => reply(200, { id: 'p1', channelId: 'c1' })).mockImplementationOnce(() => reply(200, { id: 'p1', channelId: 'c1', content: 'Hi' }));
    expect(await loadPermalinkPost('p1')).toEqual({ status: 'ok', post: { id: 'p1', channelId: 'c1', content: 'Hi' } });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/api/community/posts/p1');
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.test/api/community/channels/c1/posts/p1');
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer tok');
  });

  it('missing when the post cannot be located or read; unavailable when the API is down', async () => {
    fetchMock.mockImplementationOnce(() => reply(404));
    expect(await loadPermalinkPost('p1')).toEqual({ status: 'missing' });
    fetchMock.mockImplementationOnce(() => reply(200, { channelId: 'c1' })).mockImplementationOnce(() => reply(404));
    expect(await loadPermalinkPost('p1')).toEqual({ status: 'missing' });
    fetchMock.mockImplementationOnce(() => reply(503));
    expect(await loadPermalinkPost('p1')).toEqual({ status: 'unavailable' });
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    expect(await loadPermalinkPost('p1')).toEqual({ status: 'unavailable' });
  });

  it('a malformed id never reaches the API', async () => {
    expect(await loadPermalinkPost('../x')).toEqual({ status: 'missing' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
