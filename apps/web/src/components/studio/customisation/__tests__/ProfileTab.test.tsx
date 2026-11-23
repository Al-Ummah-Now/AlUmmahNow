/**
 * Studio → Customisation → Profile saves a channel name typed in either language (user content
 * needs one language only): the English name is required only while the Arabic one is empty, the
 * plain fields carry the filled language (English first), and an Arabic-only name never shows up
 * in the English field.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EN_TRANSLATIONS } from '@/lib/i18n/translations/en';
import { ProfileTab } from '../ProfileTab';

const getChannel = jest.fn();
const update = jest.fn();
jest.mock('@/lib/api/channels', () => ({ getChannelForOwner: (...a: unknown[]) => getChannel(...a) }));
jest.mock('@/lib/api/channel-profile', () => ({ updateChannelProfile: (...a: unknown[]) => update(...a) }));
jest.mock('@/lib/api/direct-upload', () => ({ uploadFileDirect: jest.fn() }));
let mockLang: 'en' | 'ar' = 'en';
jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: EN_TRANSLATIONS, lang: mockLang, isRTL: mockLang === 'ar' }) }));
jest.mock('@/hooks/useMultiAccount', () => ({ useMultiAccount: () => ({ reloadChannels: jest.fn() }) }));
jest.mock('@/hooks/useLeaveGuard', () => ({ useLeaveGuard: () => null }));
jest.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => ({ confirm: jest.fn(), dialog: null }) }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('@/components/media/ProfileImages', () => ({
  EditableAvatar: ({ placeholder }: { placeholder?: React.ReactNode }) => <div data-testid="avatar-placeholder">{placeholder}</div>,
  EditableCover: () => null,
}));
jest.mock('@/components/ImageCropDialog', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/settings/ChannelTranslationSettings', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/settings/ChannelAboutFields', () => ({ ChannelAboutFields: () => null, canSubmitAboutFields: () => true }));

const base = { id: 'ch1', handle: 'halaqat.alfajr', links: [], contactEmail: '', location: '' };
const nameEn = () => screen.getByLabelText(/Channel name \(English\)/) as HTMLInputElement;
const nameAr = () => screen.getByLabelText(/Channel name \(Arabic\)/) as HTMLInputElement;
const save = () => screen.getByTestId('channel-edit-save');

describe('ProfileTab: either-language save', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLang = 'en';
    update.mockImplementation(async (_id: string, data: Record<string, unknown>) => ({ ok: true, channel: { ...base, ...data } }));
  });

  it('saves an Arabic-only name: English not required, plain fields carry the Arabic', async () => {
    getChannel.mockResolvedValue({ ...base, name: 'Old name', nameLocalized: { en: 'Old name' } });
    render(<ProfileTab channelId="ch1" role="owner" />);
    await waitFor(() => expect(nameEn().value).toBe('Old name'));
    fireEvent.change(nameEn(), { target: { value: '' } });
    expect(save()).toBeDisabled();
    fireEvent.change(nameAr(), { target: { value: 'حلقة الفجر' } });
    expect(nameEn()).not.toBeRequired();
    expect(save()).toBeEnabled();
    fireEvent.click(save());
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][1]).toMatchObject({ name: 'حلقة الفجر', nameLocalized: { en: '', ar: 'حلقة الفجر' } });
  });

  it('English first when both are filled, and English is required while the Arabic is empty', async () => {
    getChannel.mockResolvedValue({ ...base, name: 'Al-Fajr', nameLocalized: { en: 'Al-Fajr', ar: '' }, description: '', descriptionLocalized: { ar: 'تذكير يومي' } });
    render(<ProfileTab channelId="ch1" role="owner" />);
    await waitFor(() => expect(nameEn().value).toBe('Al-Fajr'));
    expect(nameEn()).toBeRequired();
    fireEvent.change(nameAr(), { target: { value: ' حلقة الفجر ' } });
    fireEvent.click(save());
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][1]).toMatchObject({ name: 'Al-Fajr', nameLocalized: { en: 'Al-Fajr', ar: 'حلقة الفجر' }, description: 'تذكير يومي' });
  });

  it('an Arabic-only channel shows an empty English field, not the Arabic copied into it', async () => {
    getChannel.mockResolvedValue({ ...base, name: 'حلقة الفجر', nameLocalized: { ar: 'حلقة الفجر' } });
    render(<ProfileTab channelId="ch1" role="owner" />);
    await waitFor(() => expect(nameAr().value).toBe('حلقة الفجر'));
    expect(nameEn().value).toBe('');
  });

  it('the avatar initial comes from the page language: «ح» on an Arabic page, "A" on an English one', async () => {
    getChannel.mockResolvedValue({ ...base, name: 'Al-Fajr', nameLocalized: { en: 'Al-Fajr', ar: 'حلقة الفجر' } });
    mockLang = 'ar';
    const { unmount } = render(<ProfileTab channelId="ch1" role="owner" />);
    await waitFor(() => expect(nameAr().value).toBe('حلقة الفجر'));
    expect(screen.getByTestId('avatar-placeholder').textContent).toBe('ح');
    unmount();
    mockLang = 'en';
    render(<ProfileTab channelId="ch1" role="owner" />);
    await waitFor(() => expect(nameEn().value).toBe('Al-Fajr'));
    expect(screen.getByTestId('avatar-placeholder').textContent).toBe('A');
  });
});
