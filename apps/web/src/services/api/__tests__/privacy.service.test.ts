/**
 * Story 1.3 AC 2: the web client follows resume tokens for export and erasure.
 */
import { PrivacyService, mergeExport } from '../privacy.service';

jest.mock('@/lib/runtime-config', () => ({ getApiUrl: () => 'https://api.test' }));
jest.mock('@/lib/auth/client-token', () => ({ getClientAuthHeaders: async () => ({ Authorization: 'Bearer t' }) }));

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

describe('PrivacyService', () => {
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('merges partial exports', () => {
    const merged = mergeExport(
      mergeExport(null, { userId: 'u', profile: { id: 'u' }, videos: [1], notes: ['n'], complete: false, resumeToken: 't' }),
      { userId: 'u', profile: null, videos: [2], notes: ['n'], complete: true },
    );
    expect(merged).toMatchObject({ profile: { id: 'u' }, videos: [1, 2], notes: ['n'], complete: true });
  });

  it('exportData follows resume tokens', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ userId: 'u', videos: [1], complete: false, resumeToken: 'abc' }))
      .mockResolvedValueOnce(jsonResponse({ userId: 'u', videos: [2], complete: true }));
    const blob = await PrivacyService.exportData();
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.test/api/privacy/export?resume=abc');
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });
    expect(JSON.parse(text).videos).toEqual([1, 2]);
    expect(JSON.parse(text).resumeToken).toBeUndefined();
  });

  it('eraseData sends confirmation and repeats until complete', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ complete: false, resumeToken: 'r1', deleted: { videos: 1 }, anonymized: {} }))
      .mockResolvedValueOnce(jsonResponse({ complete: true, deleted: { videos: 2, profile: 1 }, anonymized: { videoComments: 3 } }));
    const result = await PrivacyService.eraseData();
    expect(result).toEqual({ complete: true, deleted: { videos: 3, profile: 1 }, anonymized: { videoComments: 3 } });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ confirm: 'DELETE' });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ confirm: 'DELETE', resumeToken: 'r1' });
  });

  it('eraseData surfaces server errors', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 500));
    await expect(PrivacyService.eraseData()).rejects.toThrow('erase_failed_500');
  });
});
