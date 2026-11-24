import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DownloadVideoButton } from '../DownloadVideoButton';

let mockLang: 'en' | 'ar' = 'en';
let mockUser: { id: string } | null = { id: 'viewer-1' };
let mockFeatures: Record<string, boolean> = { offlineDownloads: true };

jest.mock('@/components/AuthProvider/authContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

jest.mock('@/hooks/useFeatures', () => ({
  useFeatures: () => ({ ready: true, features: mockFeatures }),
}));

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => {
    const en = jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS;
    const ar = jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS;
    return { t: mockLang === 'ar' ? ar : en, lang: mockLang, isRTL: mockLang === 'ar' };
  },
}));

const mockRequestWebVideoDownload = jest.fn();
jest.mock('@/lib/downloads/download-client', () => ({
  requestWebVideoDownload: (...args: unknown[]) => mockRequestWebVideoDownload(...args),
}));

const readyProps = {
  videoId: 'vid-123',
  channelId: 'ch-1',
  allowDownloads: true,
  isPublic: true,
  isUnlisted: false,
  isLive: false,
  contentUrl: 'https://media.alummahnow.net/pub/vid-123/rev1/video.mp4',
};

describe('DownloadVideoButton (E14-S6b / E14-D3 / E14-D6)', () => {
  beforeEach(() => {
    mockLang = 'en';
    mockUser = { id: 'viewer-1' };
    mockFeatures = { offlineDownloads: true };
    mockRequestWebVideoDownload.mockReset();
  });

  it('renders nothing when signed out, when offlineDownloads is OFF, when creator opted out, when non-public/live, or when R2 MP4 is not ready', () => {
    mockUser = null;
    const { rerender } = render(<DownloadVideoButton {...readyProps} />);
    expect(screen.queryByTestId('watch-download-button')).toBeNull();

    mockUser = { id: 'viewer-1' };
    mockFeatures = { offlineDownloads: false };
    rerender(<DownloadVideoButton {...readyProps} />);
    expect(screen.queryByTestId('watch-download-button')).toBeNull();

    mockFeatures = { offlineDownloads: true };
    rerender(<DownloadVideoButton {...readyProps} allowDownloads={false} />);
    expect(screen.queryByTestId('watch-download-button')).toBeNull();

    rerender(<DownloadVideoButton {...readyProps} allowDownloads={undefined} />);
    expect(screen.queryByTestId('watch-download-button')).toBeNull();

    rerender(<DownloadVideoButton {...readyProps} isPublic={false} />);
    expect(screen.queryByTestId('watch-download-button')).toBeNull();

    rerender(<DownloadVideoButton {...readyProps} isUnlisted={true} />);
    expect(screen.queryByTestId('watch-download-button')).toBeNull();

    rerender(<DownloadVideoButton {...readyProps} isLive={true} />);
    expect(screen.queryByTestId('watch-download-button')).toBeNull();

    // Bunny-only video (no R2 contentUrl)
    rerender(<DownloadVideoButton {...readyProps} contentUrl={undefined} />);
    expect(screen.queryByTestId('watch-download-button')).toBeNull();
  });

  it('requests attachment URL and triggers browser download on click', async () => {
    const attachmentUrl = 'https://media.alummahnow.net/dl/vid-123/rev1/Friday_Khutbah.mp4';
    mockRequestWebVideoDownload.mockResolvedValue({
      ok: true,
      videoId: 'vid-123',
      r2Rev: 'rev1',
      url: attachmentUrl,
      contentType: 'video/mp4',
      bytes: 10_000_000,
      rung: '480p',
    });
    const triggerDownload = jest.fn();
    const onError = jest.fn();

    render(<DownloadVideoButton {...readyProps} triggerDownload={triggerDownload} onError={onError} />);
    const btn = screen.getByTestId('watch-download-button');
    expect(btn.textContent).toContain('Download');

    fireEvent.click(btn);

    await waitFor(() => expect(triggerDownload).toHaveBeenCalledWith(attachmentUrl));
    expect(mockRequestWebVideoDownload).toHaveBeenCalledWith('vid-123', { locale: 'en' });
    expect(onError).toHaveBeenCalledWith(null);
  });

  it.each([
    ['en', 'Download', 'You’ve reached the download rate limit. Please wait a while and try again.'],
    ['ar', 'تنزيل', 'وصلت إلى الحد المسموح به لطلبات التنزيل. يُرجى الانتظار قليلًا ثم المحاولة مرة أخرى.'],
  ] as const)('surfaces the localized 429 error in %s', async (locale, label, message) => {
    mockLang = locale;
    mockRequestWebVideoDownload.mockResolvedValue({
      ok: false,
      status: 429,
      code: 'download_rate_limited',
      message,
      retryAfter: 60,
    });
    const triggerDownload = jest.fn();
    const onError = jest.fn();

    render(<DownloadVideoButton {...readyProps} triggerDownload={triggerDownload} onError={onError} />);
    const btn = screen.getByTestId('watch-download-button');
    expect(btn.textContent).toContain(label);

    fireEvent.click(btn);

    await waitFor(() => expect(onError).toHaveBeenCalledWith(message));
    expect(mockRequestWebVideoDownload).toHaveBeenCalledWith('vid-123', { locale });
    expect(triggerDownload).not.toHaveBeenCalled();
  });
});
