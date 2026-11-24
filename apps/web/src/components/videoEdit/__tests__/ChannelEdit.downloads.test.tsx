import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

let mockLang: 'en' | 'ar' = 'en';
let mockFeatures: Record<string, boolean> = { offlineDownloads: false };
let mockChannelResponse: Record<string, unknown> = {
  id: 'ch-1',
  name: 'Al-Quran Recitations',
  nameLocalized: { en: 'Al-Quran Recitations', ar: 'تلاوات القرآن الكريم' },
  description: 'Daily recitations',
  descriptionLocalized: { en: 'Daily recitations', ar: 'تلاوات يومية' },
  handle: 'quranrecitations',
};

jest.mock('next/navigation', () => ({
  useParams: () => ({ locale: mockLang, id: 'ch-1' }),
}));

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

jest.mock('@/components/AuthProvider/authContext', () => ({
  useAuth: () => ({ user: { id: 'u-1', email: 'creator@alummahnow.test' } }),
}));

jest.mock('@/hooks/useMultiAccount', () => ({
  useMultiAccount: () => ({
    reloadChannels: jest.fn(async () => undefined),
    user: { id: 'u-1', channels: [{ id: 'ch-1', role: 'owner' }] },
  }),
}));

jest.mock('@/components/ui/confirm-dialog', () => ({
  useConfirm: () => ({ confirm: jest.fn(async () => true), dialog: null }),
}));

jest.mock('@/components/common/AppLink', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

jest.mock('@/components/ChannelSettingsBreadcrumb', () => ({
  __esModule: true,
  default: () => <nav data-testid="breadcrumb" />,
}));

jest.mock('@/components/media/ProfileImages', () => ({
  EditableAvatar: () => <div data-testid="editable-avatar" />,
  EditableCover: () => <div data-testid="editable-cover" />,
}));

jest.mock('@/components/ImageCropDialog', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/settings/ChannelAboutFields', () => ({
  ChannelAboutFields: () => <div data-testid="about-fields" />,
  canSubmitAboutFields: () => true,
}));

jest.mock('@/components/settings/ChannelTranslationSettings', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/lib/api/channels', () => ({
  getChannelForOwner: jest.fn(async () => mockChannelResponse),
}));

const mockUpdateChannelProfile = jest.fn();
jest.mock('@/lib/api/channel-profile', () => ({
  updateChannelProfile: (...args: unknown[]) => mockUpdateChannelProfile(...args),
}));

jest.mock('@/lib/api/direct-upload', () => ({
  uploadFileDirect: jest.fn(),
}));

import ChannelEditPage from '@/app/[locale]/settings/channel/[id]/edit/page';

describe('ChannelEditPage defaultAllowDownloads toggle (E14-S5)', () => {
  beforeEach(() => {
    mockLang = 'en';
    mockFeatures = { offlineDownloads: false };
    mockChannelResponse = {
      id: 'ch-1',
      name: 'Al-Quran Recitations',
      nameLocalized: { en: 'Al-Quran Recitations', ar: 'تلاوات القرآن الكريم' },
      description: 'Daily recitations',
      descriptionLocalized: { en: 'Daily recitations', ar: 'تلاوات يومية' },
      handle: 'quranrecitations',
    };
    mockUpdateChannelProfile.mockReset();
    mockUpdateChannelProfile.mockResolvedValue({ ok: false, status: 400, error: 'stop_nav' });
  });

  it('hides the channel default toggle when offlineDownloads is OFF and omits defaultAllowDownloads on save', async () => {
    render(<ChannelEditPage />);
    await waitFor(() => expect(screen.queryByTestId('about-fields')).not.toBeNull());
    expect(screen.queryByTestId('channel-edit-downloads')).toBeNull();

    const submit = screen.getByRole('button', { name: /save changes/i });
    fireEvent.click(submit);
    await waitFor(() => expect(mockUpdateChannelProfile).toHaveBeenCalledTimes(1));
    const payload = mockUpdateChannelProfile.mock.calls[0][1] as Record<string, unknown>;
    expect('defaultAllowDownloads' in payload).toBe(false);
  });

  it('does not pin defaultAllowDownloads=true on unrelated channel saves, and sends it only when toggled', async () => {
    mockFeatures = { offlineDownloads: true };
    render(<ChannelEditPage />);
    const checkbox = (await screen.findByTestId('channel-edit-default-allow-downloads')) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    // Save without touching the toggle: payload must NOT pin defaultAllowDownloads=true.
    const submit = screen.getByRole('button', { name: /save changes/i });
    fireEvent.click(submit);
    await waitFor(() => expect(mockUpdateChannelProfile).toHaveBeenCalledTimes(1));
    const untouchedPayload = mockUpdateChannelProfile.mock.calls[0][1] as Record<string, unknown>;
    expect('defaultAllowDownloads' in untouchedPayload).toBe(false);

    // Now toggle it OFF and save: payload MUST send defaultAllowDownloads=false.
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(mockUpdateChannelProfile).toHaveBeenCalledTimes(2));
    expect(mockUpdateChannelProfile.mock.calls[1][1]).toMatchObject({ defaultAllowDownloads: false });
  });

  it('reads defaultAllowDownloads=false on load and renders Arabic copy with «مرئيات» and no Western digits', async () => {
    mockLang = 'ar';
    mockFeatures = { offlineDownloads: true };
    mockChannelResponse = { ...mockChannelResponse, defaultAllowDownloads: false };
    render(<ChannelEditPage />);

    const checkbox = (await screen.findByTestId('channel-edit-default-allow-downloads')) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    const box = screen.getByTestId('channel-edit-downloads');
    expect(box.textContent).toContain('مرئيات');
    expect(box.textContent).not.toContain('فيديو');
    expect(box.textContent).not.toMatch(/[0-9]/);
  });
});
