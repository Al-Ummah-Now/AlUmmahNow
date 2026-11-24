import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { VideoObject } from '@/interfaces';

let mockLang: 'en' | 'ar' = 'en';
let mockFeatures: Record<string, boolean> = { offlineDownloads: false, aiCategorySuggest: false };

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => {
    const en = jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS;
    const ar = jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS;
    return { t: mockLang === 'ar' ? ar : en, lang: mockLang, isRTL: mockLang === 'ar' };
  },
}));

jest.mock('@/hooks/useFeatures', () => ({
  useFeatures: () => ({ ready: true, features: mockFeatures }),
}));

jest.mock('@/hooks/useCreatorAccess', () => ({
  useCreatorAccess: () => ({ status: 'ready', access: { termsAccepted: true } }),
}));

jest.mock('@/hooks/useChannelTags', () => ({ useChannelTags: () => [] }));
jest.mock('@/hooks/useCategorySuggestion', () => ({ useCategorySuggestion: () => ({ suggestion: null, loading: false }) }));
jest.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => ({ confirm: jest.fn(async () => true), dialog: null }) }));
jest.mock('@/components/videoPreview/index', () => ({ __esModule: true, default: () => <div data-testid="preview" /> }));
jest.mock('@/components/videoPreview/rtl/index', () => ({ __esModule: true, default: () => <div data-testid="preview-rtl" /> }));
jest.mock('../ThumbnailSelector', () => ({ __esModule: true, default: () => null }));
jest.mock('../audio/AudioTracksPanel', () => ({ __esModule: true, default: () => null }));
jest.mock('../SubtitleUploadSection', () => ({ __esModule: true, default: () => null }));
jest.mock('../ChapterEditor', () => ({ __esModule: true, default: () => null }));
jest.mock('../ChapterUpload', () => ({ __esModule: true, default: () => null }));
jest.mock('../ScheduleSection', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/videoFormat/VideoFormatChoice', () => ({
  VideoFormatChoice: () => null,
  formatChoiceOf: () => 'auto',
}));
jest.mock('@/lib/api/chapters', () => ({ getChapters: jest.fn(async () => ({ success: true })), updateChapters: jest.fn() }));
jest.mock('@/lib/api/category-suggestion-client', () => ({ getCategorySuggestion: jest.fn(async () => null) }));

const mockUpdateVideo = jest.fn();
jest.mock('@/lib/api/videos', () => ({
  updateVideo: (...args: unknown[]) => mockUpdateVideo(...args),
}));

const mockGetChannelForOwner = jest.fn();
jest.mock('@/lib/api/channels', () => ({
  getChannelForOwner: (...args: unknown[]) => mockGetChannelForOwner(...args),
}));

import VideoEdit from '../index';

const baseVideo: VideoObject = {
  id: 'vid-1',
  title: 'Surah Al-Kahf',
  titleLocalized: { en: 'Surah Al-Kahf', ar: 'سورة الكهف' },
  description: 'Recitation',
  descriptionLocalized: { en: 'Recitation', ar: 'تلاوة' },
  thumbnailUrl: 'https://cdn.example/thumb.jpg',
  videoUrl: 'https://cdn.example/video.m3u8',
  userId: 'u-1',
  channel: 'ch-1',
  channelId: 'ch-1',
  channelName: 'Test Channel',
  channelAvatarUrl: '',
  dateCreated: '2026-11-23T00:00:00Z',
  dateModified: '2026-11-23T00:00:00Z',
  createdAt: '2026-11-23T00:00:00Z',
  views: 10,
  availableResolutions: ['480p'],
  isPublic: true,
  isLive: false,
  likesCount: 0,
  dislikesCount: 0,
  commentsCount: 0,
};

describe('VideoEdit offline downloads toggle (E14-S5)', () => {
  beforeEach(() => {
    mockLang = 'en';
    mockFeatures = { offlineDownloads: false, aiCategorySuggest: false };
    mockUpdateVideo.mockReset();
    mockUpdateVideo.mockResolvedValue({ success: true, result: { video: { ...baseVideo, allowDownloads: false } } });
    mockGetChannelForOwner.mockReset();
    mockGetChannelForOwner.mockResolvedValue({ id: 'ch-1', name: 'Test Channel', defaultAllowDownloads: true });
  });

  it('hides the downloads toggle completely when offlineDownloads feature switch is OFF', () => {
    render(<VideoEdit video={baseVideo} userId="u-1" channelId="ch-1" />);
    expect(screen.queryByTestId('video-edit-downloads')).toBeNull();
    expect(screen.queryByTestId('video-edit-allow-downloads')).toBeNull();
  });

  it('shows the toggle when offlineDownloads is ON and saves allowDownloads=false when unchecked', async () => {
    mockFeatures = { offlineDownloads: true, aiCategorySuggest: false };
    render(<VideoEdit video={baseVideo} userId="u-1" channelId="ch-1" />);
    const checkbox = screen.getByTestId('video-edit-allow-downloads') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);

    fireEvent.click(screen.getByTestId('video-edit-save'));
    await waitFor(() => expect(mockUpdateVideo).toHaveBeenCalledTimes(1));
    expect(mockUpdateVideo.mock.calls[0][1]).toMatchObject({ allowDownloads: false });
  });

  it('inherits channel defaultAllowDownloads=false when video.allowDownloads is absent and omits allowDownloads on unrelated title edits', async () => {
    mockFeatures = { offlineDownloads: true, aiCategorySuggest: false };
    mockGetChannelForOwner.mockResolvedValue({ id: 'ch-1', name: 'Test Channel', defaultAllowDownloads: false });
    render(<VideoEdit video={baseVideo} userId="u-1" channelId="ch-1" />);

    const checkbox = screen.getByTestId('video-edit-allow-downloads') as HTMLInputElement;
    await waitFor(() => expect(checkbox.checked).toBe(false));

    // Edit only the English title and save without touching the downloads toggle.
    const titleInput = screen.getByDisplayValue('Surah Al-Kahf');
    fireEvent.change(titleInput, { target: { value: 'Surah Al-Kahf (Fixed Title)' } });

    fireEvent.click(screen.getByTestId('video-edit-save'));
    await waitFor(() => expect(mockUpdateVideo).toHaveBeenCalledTimes(1));
    const payload = mockUpdateVideo.mock.calls[0][1] as Record<string, unknown>;
    expect('allowDownloads' in payload).toBe(false);
  });

  it('renders Arabic copy with «مرئي» and no Western digits when locale is ar', () => {
    mockLang = 'ar';
    mockFeatures = { offlineDownloads: true, aiCategorySuggest: false };
    render(<VideoEdit video={{ ...baseVideo, allowDownloads: false }} userId="u-1" channelId="ch-1" />);
    const fieldset = screen.getByTestId('video-edit-downloads');
    expect(fieldset.textContent).toContain('التنزيل دون اتصال');
    expect(fieldset.textContent).toContain('المرئي');
    expect(fieldset.textContent).not.toContain('فيديو');
    expect((screen.getByTestId('video-edit-allow-downloads') as HTMLInputElement).checked).toBe(false);
  });
});
