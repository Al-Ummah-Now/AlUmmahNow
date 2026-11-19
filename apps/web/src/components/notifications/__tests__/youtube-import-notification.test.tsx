/**
 * The "YouTube import finished" notification (wiki AUN-YT-IMPORT): api-videos sends
 * notificationKey youtubeImportFinished (category uploads) with params ready, failed and
 * channelTitle, and an actionUrl to the wizard with ?import=. It renders in the viewer's
 * language with its own icon, is kept in the notification center, and opens the wizard.
 */
import { render, screen } from '@testing-library/react';
import type { NotificationItem } from '@al-ummah/shared-types';
import { NOTIFICATION_KEY_CATEGORY } from '@al-ummah/shared-types';
import { resolveNotificationText } from '@/lib/websocket/notification-text';
import { isCenterKey, localizeActionUrl } from '@/lib/notifications/render';
import { EN_TRANSLATIONS } from '@/lib/i18n/translations/en';
import { AR_TRANSLATIONS } from '@/lib/i18n/translations/ar';
import { NotificationRow } from '../NotificationRow';

let mockLang: 'en' | 'ar' = 'en';
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: mockLang === 'ar' ? AR_TRANSLATIONS : EN_TRANSLATIONS, lang: mockLang, locale: mockLang, isRTL: mockLang === 'ar' }),
}));
jest.mock('@/components/common/AppLink', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const params = { ready: 2, failed: 1, channelTitle: 'Al-Fajr Channel' };
const event = {
  type: 'notification' as const,
  notificationId: 'n1',
  userId: 'u1',
  notificationType: 'upload' as const,
  notificationKey: 'youtubeImportFinished' as const,
  params,
  actionUrl: '/studio/c1/content/youtube?import=imp1',
};
const item: NotificationItem = {
  id: 'n1',
  notificationKey: 'youtubeImportFinished',
  notificationType: 'upload',
  category: 'uploads',
  params,
  actionUrl: '/studio/c1/content/youtube?import=imp1',
  isRead: false,
  createdAt: new Date().toISOString(),
} as NotificationItem;

describe('youtubeImportFinished notification', () => {
  it('is an uploads notification kept in the notification center', () => {
    expect(NOTIFICATION_KEY_CATEGORY.youtubeImportFinished).toBe('uploads');
    expect(isCenterKey('youtubeImportFinished')).toBe(true);
  });

  it('renders its own text with the counts in English and Arabic', () => {
    expect(resolveNotificationText(event, EN_TRANSLATIONS, 'en')).toEqual({ title: 'Your YouTube import finished', message: 'Imported: 2. Need another try: 1.' });
    const ar = resolveNotificationText(event, AR_TRANSLATIONS, 'ar');
    expect(ar.title).toBe('اكتمل نقل قناتك من يوتيوب');
    expect(ar.message).toBe('نُقل: ٢. يحتاج إلى محاولة أخرى: ١.');
  });

  it('opens the wizard on the import, in the viewer language', () => {
    expect(localizeActionUrl(event.actionUrl, 'ar')).toBe('/ar/studio/c1/content/youtube?import=imp1');
  });

  it.each(['en', 'ar'] as const)('shows a row with the import icon in %s', (lang) => {
    mockLang = lang;
    const { container } = render(<ul><NotificationRow item={item} /></ul>);
    const t = lang === 'ar' ? AR_TRANSLATIONS : EN_TRANSLATIONS;
    expect(screen.getByText(t.notifications.realtime.youtubeImportFinishedTitle)).toBeInTheDocument();
    expect(container.querySelector('[data-icon="youtube-import"]')).not.toBeNull();
    expect(screen.getByRole('link')).toHaveAttribute('href', `/${lang}/studio/c1/content/youtube?import=imp1`);
  });
});
