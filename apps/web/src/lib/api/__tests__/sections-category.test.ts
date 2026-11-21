/**
 * getCategoryVideos is a server action: its category comes from the browser.
 * Only a category slug may reach the API path (CodeQL js/request-forgery).
 */
import { getCategoryVideos } from '@/lib/api/sections';

jest.mock('@/lib/runtime-config', () => ({ getApiUrl: () => 'https://api.test' }));
jest.mock('@/lib/logger-server', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: [] }) });
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('getCategoryVideos', () => {
  it('fetches a category slug from the API', async () => {
    await getCategoryVideos('seerah_for_kids', { limit: 5 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.test/api/videos/sections/by-category/seerah_for_kids?category=seerah_for_kids&limit=5'
    );
  });

  it.each([
    '../../admin/users',
    'fiqh/../../internal',
    'fiqh?x=1',
    'fiqh#x',
    '@evil.example',
    'https://evil.example',
    'Fiqh',
    '',
    'a'.repeat(60),
  ])('refuses %p without a request', async (category) => {
    await expect(getCategoryVideos(category)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
