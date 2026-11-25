/** @jest-environment node */
jest.mock('@/lib/runtime-config', () => ({ getApiUrl: () => 'https://api.example' }));
jest.mock('../logger', () => new Proxy({}, { get: (_t, name) => (name === '__esModule' ? true : name === 'logApiError' ? mockError : jest.fn()) }));
const mockError = jest.fn();

import { apiRequest } from '../api-client';

const options = { method: 'GET' as const, url: 'https://api.example/api/profile', functionName: 'test' };
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  mockError.mockClear();
});
const answer = (status: number) => {
  global.fetch = jest.fn(async () => new Response('{"error":"Profile not found"}', { status })) as unknown as typeof fetch;
};

describe('an expected error status', () => {
  it('is an answer: null, and not logged as an error (no profile yet on a first sign-in)', async () => {
    answer(404);
    expect(await apiRequest({ ...options, expectedStatuses: [404] })).toBeNull();
    expect(mockError).not.toHaveBeenCalled();
  });

  it('any other failure is still an error', async () => {
    answer(500);
    expect(await apiRequest({ ...options, expectedStatuses: [404] })).toBeNull();
    expect(mockError).toHaveBeenCalledTimes(1);
    answer(404);
    await apiRequest(options);
    expect(mockError).toHaveBeenCalledTimes(2);
  });
});
