/**
 * Processing UI (incident 2026-11-10): a video that is not ready shows the
 * themed "Processing, ready soon" state (never the player's raw network
 * error), swaps in the player when ready, and cards carry a status badge.
 */
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { EN_TRANSLATIONS } from '@/lib/i18n/translations/en';
import { AR_TRANSLATIONS } from '@/lib/i18n/translations/ar';
import { VideoProcessingState, PROCESSING_POLL_MS } from '../VideoProcessingState';
import { ProcessingBadge } from '@/components/videoCard/ProcessingBadge';
import { isVideoProcessing, type PlayerOptions } from '@/components/VideoPagePlayer/interface';
import { fetchVideoById, getVideoUploadStatusApi } from '@/lib/api/videos';

let lang: 'en' | 'ar' = 'en';
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: lang === 'ar' ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang,
    locale: lang,
    dir: lang === 'ar' ? 'rtl' : 'ltr',
    isRTL: lang === 'ar',
  }),
}));
jest.mock('@/lib/api/videos', () => ({
  fetchVideoById: jest.fn(),
  getVideoUploadStatusApi: jest.fn(),
}));
jest.mock('@/lib/logger-client', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const base: PlayerOptions = {
  id: 'v1',
  title: 'Ashura 1',
  channel: 'c1',
  channelName: 'Al Ummah Now',
  channelAvatar: '',
  description: '',
  views: '0',
  url: '',
  poster: 'https://cdn.example/v1/thumbnail.jpg',
  autoplay: false,
  type: 'video/mp4',
  dateCreated: new Date('2026-11-10T03:42:00Z'),
  userId: 'owner',
  channelId: 'c1',
  uploadStatus: 'processing',
};

beforeEach(() => {
  lang = 'en';
  jest.useFakeTimers();
  (fetchVideoById as jest.Mock).mockReset();
  (getVideoUploadStatusApi as jest.Mock).mockReset();
});
afterEach(() => jest.useRealTimers());

describe('isVideoProcessing', () => {
  it('is true until the video is ready; older videos without a status are ready', () => {
    expect(isVideoProcessing({ uploadStatus: 'initiated' })).toBe(true);
    expect(isVideoProcessing({ uploadStatus: 'uploading' })).toBe(true);
    expect(isVideoProcessing({ uploadStatus: 'processing' })).toBe(true);
    expect(isVideoProcessing({ uploadStatus: 'ready' })).toBe(false);
    expect(isVideoProcessing({ uploadStatus: undefined })).toBe(false);
  });
});

describe('VideoProcessingState', () => {
  it('shows "Processing, ready soon" with the thumbnail placeholder, not an error', () => {
    render(<VideoProcessingState video={base} isOwner={false} onReady={jest.fn()} />);
    expect(screen.getByTestId('video-processing-state')).toHaveAttribute('data-status', 'processing');
    expect(screen.getByRole('status')).toHaveTextContent(EN_TRANSLATIONS.video.processingTitle);
    expect(screen.getByTestId('video-processing-poster')).toBeInTheDocument();
    expect(screen.queryByText(/network error/i)).toBeNull();
  });

  it('is translated in Arabic and laid out right to left', () => {
    lang = 'ar';
    render(<VideoProcessingState video={base} isOwner={false} onReady={jest.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent(AR_TRANSLATIONS.video.processingTitle);
    expect(screen.getByTestId('video-processing-state')).toHaveAttribute('dir', 'rtl');
  });

  it('checks again and hands over the ready video', async () => {
    const onReady = jest.fn();
    (fetchVideoById as jest.Mock).mockResolvedValue({ ...base, uploadStatus: 'ready', playUrl: 'https://cdn.example/v1/playlist.m3u8' });
    render(<VideoProcessingState video={base} isOwner={false} onReady={onReady} />);
    await act(async () => {
      jest.advanceTimersByTime(PROCESSING_POLL_MS);
    });
    expect(onReady).toHaveBeenCalledWith(expect.objectContaining({ uploadStatus: 'ready' }));
  });

  it('shows the owner the encode progress', async () => {
    (getVideoUploadStatusApi as jest.Mock).mockResolvedValue({ success: true, result: { videoId: 'v1', status: 'processing', progress: 50, encodingStatus: { isProcessing: true, encodingProgress: 42, availableResolutions: [] } } });
    (fetchVideoById as jest.Mock).mockResolvedValue(base);
    render(<VideoProcessingState video={base} isOwner onReady={jest.fn()} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(await screen.findByTestId('video-processing-progress')).toHaveAttribute('data-progress', '42');
  });

  it('a failed video tells the owner to upload again, never a raw error', () => {
    render(<VideoProcessingState video={{ ...base, uploadStatus: 'failed' }} isOwner onReady={jest.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent(EN_TRANSLATIONS.video.processingFailedTitle);
    expect(screen.getByTestId('video-processing-reupload')).toHaveAttribute('href', '/en/upload');
  });
});

describe('ProcessingBadge', () => {
  it('labels processing and failed videos, nothing for ready ones', () => {
    const { rerender, container } = render(<ProcessingBadge uploadStatus="processing" />);
    expect(screen.getByTestId('video-card-processing')).toHaveTextContent(EN_TRANSLATIONS.video.processingBadge);
    rerender(<ProcessingBadge uploadStatus="failed" />);
    expect(screen.getByTestId('video-card-processing')).toHaveTextContent(EN_TRANSLATIONS.video.processingFailedBadge);
    rerender(<ProcessingBadge uploadStatus="ready" />);
    expect(container).toBeEmptyDOMElement();
  });
});
