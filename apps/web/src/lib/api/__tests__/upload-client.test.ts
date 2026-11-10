import { callUploadApi, completeVideoUpload, initiateVideoUpload } from '../upload-client';
import { fetchClientAuthInfo } from '@/lib/auth/client-token';

jest.mock('@/lib/auth/client-token', () => ({ fetchClientAuthInfo: jest.fn() }));
jest.mock('@/lib/runtime-config', () => ({ getApiUrl: () => 'https://videos.api.test' }));
jest.mock('@/lib/logger-client', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const auth = fetchClientAuthInfo as jest.Mock;
const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response;

describe('upload-client (plain API calls, no Server Actions)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ advanceTimers: true });
    auth.mockReset();
    auth.mockResolvedValue({ accessToken: 'tok-1', channelId: 'ch-session' });
  });
  afterEach(() => jest.useRealTimers());

  it('calls api-videos directly with the bearer token and the given channel', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(json(200, { success: true, result: { videoId: 'v1' } }));
    const res = await callUploadApi({ method: 'POST', path: '/api/videos/upload/complete', channelId: 'ch-1', body: { videoId: 'v1' } }, 'fail', fetchImpl);
    expect(res.success).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith('https://videos.api.test/api/videos/upload/complete', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer tok-1', channelId: 'ch-1' }),
      body: JSON.stringify({ videoId: 'v1' }),
    }));
  });

  it('refreshes the token once on 401', async () => {
    auth.mockResolvedValueOnce({ accessToken: 'old' }).mockResolvedValueOnce({ accessToken: 'new' });
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(json(401, { success: false, error: 'expired' }))
      .mockResolvedValueOnce(json(200, { success: true }));
    const res = await callUploadApi({ method: 'GET', path: '/x', channelId: 'c' }, 'fail', fetchImpl);
    expect(res.success).toBe(true);
    expect(auth).toHaveBeenLastCalledWith(true);
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe('Bearer new');
  });

  it('retries 5xx and network errors when asked, then reports the API error', async () => {
    const fetchImpl = jest.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(json(503, { success: false, error: 'busy' }))
      .mockResolvedValueOnce(json(200, { success: true }));
    const res = await callUploadApi({ method: 'POST', path: '/x', channelId: 'c', retries: 3 }, 'fail', fetchImpl);
    expect(res.success).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does not retry 4xx', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(json(400, { success: false, error: 'bad title' }));
    const res = await callUploadApi({ method: 'POST', path: '/x', channelId: 'c', retries: 3 }, 'fail', fetchImpl);
    expect(res).toEqual({ success: false, error: 'bad title' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails cleanly when signed out', async () => {
    auth.mockResolvedValue({ accessToken: null });
    const fetchImpl = jest.fn();
    expect(await callUploadApi({ method: 'GET', path: '/x', channelId: 'c' }, 'fail', fetchImpl)).toEqual({ success: false, error: 'fail' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('initiate hands the TUS step the token it used; complete never leaks it', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(json(200, { success: true, result: { videoId: 'v1', chunkSize: 1, resumable: true } }))
      .mockResolvedValueOnce(json(200, { success: true, result: { videoId: 'v1', status: 'processing', message: '' } })) as unknown as typeof fetch;
    const init = await initiateVideoUpload({ title: 't', fileSize: 1, mimeType: 'video/mp4' }, 'c');
    expect(init.result?.authToken).toBe('tok-1');
    const done = await completeVideoUpload('v1', 'c', 1);
    expect(done).toEqual({ success: true, result: { videoId: 'v1', status: 'processing', message: '' } });
  });
});
