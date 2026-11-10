import { act, renderHook } from '@testing-library/react';
import { useProcessingStatus } from '../useProcessingStatus';

const mockGetStatus = jest.fn();
jest.mock('@/lib/api/upload-client', () => ({
  getVideoUploadStatus: (...args: unknown[]) => mockGetStatus(...args),
}));

let mockRealtime: ((data: unknown) => void) | null = null;
let mockChannel = '';
jest.mock('@/lib/websocket/WebSocketProvider', () => ({
  useOptionalWebSocketSubscription: (channel: string, cb: (data: unknown) => void) => {
    mockChannel = channel;
    mockRealtime = cb;
    return true;
  },
}));

jest.mock('@/lib/logger-client', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const status = (s: string) => ({ success: true, result: { videoId: 'x', status: s, progress: 50 } });

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  // let the poll's promises settle
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useProcessingStatus', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockGetStatus.mockReset();
    mockRealtime = null;
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('polls with backoff until ready, then stops polling that video', async () => {
    mockGetStatus.mockResolvedValueOnce(status('processing')).mockResolvedValueOnce(status('ready'));
    const { result } = renderHook(() => useProcessingStatus(['v1'], 'ch1', 'u1'));
    expect(result.current.v1).toBeUndefined();

    await advance(5000);
    expect(mockGetStatus).toHaveBeenCalledWith('v1', 'ch1');
    expect(result.current.v1).toBe('processing');

    await advance(9999);
    expect(mockGetStatus).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(mockGetStatus).toHaveBeenCalledTimes(2);
    expect(result.current.v1).toBe('ready');

    await advance(120000);
    expect(mockGetStatus).toHaveBeenCalledTimes(2);
  });

  it('takes the realtime processing result from the uploader channel', async () => {
    mockGetStatus.mockResolvedValue(status('processing'));
    const { result } = renderHook(() => useProcessingStatus(['v1', 'v2'], 'ch1', 'u1'));
    expect(mockChannel).toBe('user:u1');
    act(() => {
      mockRealtime?.({ type: 'video_processing_update', videoId: 'v2', status: 'failed' });
      mockRealtime?.({ type: 'video_processing_update', videoId: 'other', status: 'ready' });
      mockRealtime?.({ type: 'notification', videoId: 'v1', status: 'ready' });
    });
    expect(result.current).toEqual({ v2: 'failed' });
  });

  it('keeps a video processing when a poll fails, and retries', async () => {
    mockGetStatus.mockRejectedValueOnce(new Error('network down')).mockResolvedValueOnce({ success: false, error: 'HTTP 500' }).mockResolvedValueOnce(status('ready'));
    const { result } = renderHook(() => useProcessingStatus(['v1'], 'ch1', 'u1'));
    await advance(5000);
    expect(result.current.v1).toBeUndefined();
    await advance(10000);
    expect(result.current.v1).toBeUndefined();
    await advance(20000);
    expect(result.current.v1).toBe('ready');
  });

  it('never moves a finished video back to processing', async () => {
    mockGetStatus.mockResolvedValue(status('processing'));
    const { result } = renderHook(() => useProcessingStatus(['v1'], 'ch1', 'u1'));
    act(() => {
      mockRealtime?.({ type: 'video_processing_update', videoId: 'v1', status: 'ready' });
      mockRealtime?.({ type: 'video_processing_update', videoId: 'v1', status: 'processing' });
    });
    await advance(60000);
    expect(result.current.v1).toBe('ready');
  });
});
