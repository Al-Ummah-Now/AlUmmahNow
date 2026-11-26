import { fireEvent, render, screen } from '@testing-library/react';
import { AR_TRANSLATIONS, EN_TRANSLATIONS } from '@al-ummah/shared-types';
import ProfilePageClient from '@/app/[locale]/profile/ProfilePageClient';

const mockPush = jest.fn();
let mockLocale: 'en' | 'ar';
jest.mock('next/navigation', () => ({
  useParams: () => ({ locale: mockLocale }),
  useRouter: () => ({ push: mockPush }),
}));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => {
    const { AR_TRANSLATIONS, EN_TRANSLATIONS } = jest.requireActual('@al-ummah/shared-types');
    return { t: mockLocale === 'ar' ? AR_TRANSLATIONS : EN_TRANSLATIONS };
  },
}));
jest.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({ profile: { displayName: 'Noor' }, isLoading: false, error: null }),
}));
jest.mock('@/components/AuthProvider/authContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('@/hooks/useMultiAccount', () => ({ useCurrentChannel: () => ({ id: 'ch1' }) }));
jest.mock('@/components/settings/SettingsBreadcrumb', () => ({ SettingsBreadcrumb: () => null }));
jest.mock('@/components/channelManagement', () => ({ ChannelManagementSection: () => null }));
jest.mock('@/components/media/ProfileImages', () => ({ AvatarImage: () => null, CoverImage: () => null }));

it.each([
  ['en', 'No playlists yet', EN_TRANSLATIONS],
  ['ar', 'لا توجد قوائم تشغيل بعد', AR_TRANSLATIONS],
] as const)('shows a playlist empty state and keeps the create action in %s', (locale, heading, t) => {
  mockLocale = locale;
  mockPush.mockClear();
  render(<ProfilePageClient />);
  expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
  expect(screen.queryByText(t.common.noResults)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: t.common.create }));
  expect(mockPush).toHaveBeenCalledWith(`/${locale}/settings/channel/ch1/playlists`);
});
