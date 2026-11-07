import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { EN_TRANSLATIONS } from '@/lib/i18n/translations/en';
import { AR_TRANSLATIONS } from '@/lib/i18n/translations/ar';
import { localizeActionUrl, relativeTime, renderNotification } from '@/lib/notifications/render';
import { eventToItem } from '@/hooks/useNotificationBell';
import { NotificationRow } from '../NotificationRow';
import { MenuButton } from '@/components/common/MenuButton';
import type { NotificationItem } from '@al-ummah/shared-types';

let mockLang: 'en' | 'ar' = 'en';
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => {
    const isAr = mockLang === 'ar';
    return {
      t: isAr
        ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS
        : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
      lang: mockLang,
      locale: mockLang,
      dir: isAr ? 'rtl' : 'ltr',
      isRTL: isAr,
    };
  },
}));

jest.mock('@/services/api/notifications', () => ({
  NotificationsService: {
    channelBell: jest.fn().mockResolvedValue({ channelId: 'c1', bell: 'all', subscribed: true }),
    setChannelBell: jest.fn().mockResolvedValue(true),
  },
}));

const item = (overrides: Partial<NotificationItem> = {}): NotificationItem => ({
  id: 'n1',
  category: 'new_videos',
  notificationType: 'subscription',
  notificationKey: 'newVideo',
  params: { channelName: 'Noor', videoTitle: 'Tafsir 1' },
  actionUrl: '/video/v1',
  entityId: 'v1',
  isRead: false,
  createdAt: new Date().toISOString(),
  ...overrides,
});

describe('notification rendering', () => {
  it('renders keys in the viewer language with params', () => {
    expect(renderNotification(item(), EN_TRANSLATIONS)).toEqual({ title: 'New video', message: 'Noor uploaded "Tafsir 1"' });
    expect(renderNotification(item(), AR_TRANSLATIONS).message).toContain('Noor');
    expect(renderNotification(item({ notificationKey: 'commentReply', params: { actorName: 'Ali' } }), EN_TRANSLATIONS).message).toBe(
      'Ali replied to your comment',
    );
    expect(renderNotification(item({ notificationKey: 'liveStarted', params: { channelName: 'Noor', streamTitle: 'Jumuah' } }), AR_TRANSLATIONS).title).toBe(
      'مباشر الآن',
    );
  });

  it('localizes server action urls and rejects external ones', () => {
    expect(localizeActionUrl('/video/v1', 'ar')).toBe('/ar/video/v1');
    expect(localizeActionUrl('/en/video/v1', 'ar')).toBe('/en/video/v1');
    expect(localizeActionUrl('https://evil.example', 'en')).toBeNull();
    expect(localizeActionUrl('//evil.example', 'en')).toBeNull();
    expect(localizeActionUrl(null, 'en')).toBeNull();
  });

  it('formats relative time', () => {
    const now = Date.parse('2026-11-07T12:00:00Z');
    expect(relativeTime('2026-11-07T11:59:40Z', EN_TRANSLATIONS, 'en', now)).toBe('Just now');
    expect(relativeTime('2026-11-07T11:55:00Z', EN_TRANSLATIONS, 'en', now)).toBe('5 min ago');
    expect(relativeTime('2026-11-07T09:00:00Z', EN_TRANSLATIONS, 'en', now)).toBe('3 h ago');
    expect(relativeTime('2026-11-05T12:00:00Z', AR_TRANSLATIONS, 'ar', now)).toContain('يوم');
  });

  it('turns realtime events into unread list items and ignores unknown keys', () => {
    const fromEvent = eventToItem({
      type: 'notification',
      notificationId: 'x',
      userId: 'u',
      notificationKey: 'newSubscriber',
      notificationType: 'subscription',
      category: 'subscribers',
      params: { channelName: 'C' },
    });
    expect(fromEvent).toMatchObject({ id: 'x', isRead: false, category: 'subscribers', notificationKey: 'newSubscriber' });
    expect(eventToItem({ type: 'notification', notificationId: 'y', userId: 'u', notificationType: 'system' })).toBeNull();
  });
});

describe('NotificationRow', () => {
  beforeEach(() => {
    mockLang = 'en';
  });

  it('shows unread state, links with the locale and exposes read/delete actions', () => {
    const onMarkRead = jest.fn();
    const onDelete = jest.fn();
    render(
      <ul>
        <NotificationRow item={item()} onMarkRead={onMarkRead} onDelete={onDelete} />
      </ul>,
    );
    expect(screen.getByText('New video')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/en/video/v1');
    expect(screen.getByTestId('notification-item')).toHaveAttribute('data-read', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Mark as read' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete notification' }));
    expect(onMarkRead).toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalled();
  });

  it('renders Arabic text and links for RTL viewers', () => {
    mockLang = 'ar';
    render(
      <ul>
        <NotificationRow item={item({ isRead: true })} />
      </ul>,
    );
    expect(screen.getByText('فيديو جديد')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/ar/video/v1');
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('MenuButton keyboard support', () => {
  it('opens with ArrowDown, moves focus with arrows, selects and closes with Escape', async () => {
    const first = jest.fn();
    const second = jest.fn();
    render(
      <MenuButton
        label="More"
        testId="menu"
        items={[
          { id: 'a', label: 'First', onSelect: first },
          { id: 'b', label: 'Second', onSelect: second },
        ]}
      >
        …
      </MenuButton>,
    );
    const button = screen.getByTestId('menu');
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const items = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);

    fireEvent.click(button);
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Second' }));
    });
    expect(second).toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
  });
});

describe('ChannelBellMenu', () => {
  beforeEach(() => {
    mockLang = 'en';
  });

  it('loads the current bell and saves a new level', async () => {
    const { NotificationsService } = jest.requireMock('@/services/api/notifications');
    const { ChannelBellMenu } = await import('../ChannelBellMenu');
    render(<ChannelBellMenu channelId="c1" />);
    await waitFor(() => expect(screen.getByTestId('channel-bell')).toHaveAttribute('data-bell', 'all'));
    fireEvent.click(screen.getByTestId('channel-bell-button'));
    expect(screen.getByRole('menuitemradio', { name: /^All/ })).toHaveAttribute('aria-checked', 'true');
    await act(async () => {
      fireEvent.click(screen.getByTestId('channel-bell-option-none'));
    });
    expect(NotificationsService.setChannelBell).toHaveBeenCalledWith('c1', 'none');
    await waitFor(() => expect(screen.getByTestId('channel-bell')).toHaveAttribute('data-bell', 'none'));
  });
});
