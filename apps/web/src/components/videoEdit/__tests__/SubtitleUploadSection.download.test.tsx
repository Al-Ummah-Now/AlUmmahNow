import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS, lang: 'ar', isRTL: true }),
}));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('../captions/CaptionDraftsPanel', () => ({ __esModule: true, default: () => null }));
jest.mock('../SubtitleUploadModal', () => ({ __esModule: true, default: () => null }));
const listSubtitles = jest.fn();
jest.mock('@/lib/api/subtitles', () => ({ listSubtitles: (...a: unknown[]) => listSubtitles(...a), deleteSubtitle: jest.fn(), setDefaultSubtitle: jest.fn() }));

import SubtitleUploadSection from '../SubtitleUploadSection';

const track = (language: string, status: string) => ({ id: language, language, label: language, status, isDefault: false, fileSize: 1200, uploadDate: '2026-11-20T00:00:00Z', url: 'u', format: 'vtt' });

describe('SubtitleUploadSection: Download per published track', () => {
  it('ready tracks offer Download in Arabic; a processing or failed one does not', async () => {
    listSubtitles.mockResolvedValue([track('ar', 'active'), track('en', 'processing'), track('ur', 'failed')]);
    render(<SubtitleUploadSection videoId="v1" channelId="c1" />);
    const rows = await screen.findAllByTestId('subtitle-track');
    const downloads = rows.map((r) => r.querySelector('[data-testid="caption-download"]'));
    expect(downloads[0]).toHaveAttribute('data-source', 'track');
    expect(downloads[0]).toHaveAttribute('aria-label', 'تنزيل الترجمة (العربية)');
    expect(downloads[0]).toHaveTextContent('تنزيل الترجمة');
    expect(downloads.slice(1)).toEqual([null, null]);

    // The formats open inside the same track card, below its row
    fireEvent.click(downloads[0]!);
    const formats = screen.getByTestId('caption-download-formats');
    expect(rows[0]).toContainElement(formats);
    expect(formats).toHaveTextContent('اختر صيغة الملف');
  });
});
