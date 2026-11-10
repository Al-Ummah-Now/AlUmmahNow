import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { NotificationCenter } from '../NotificationCenter';
import { TOAST_TTL_MS } from '@/lib/notifications/toast-queue';
import { useUploadResult } from '@/lib/notifications/upload-results';

let mockLang: 'en' | 'ar' = 'en';
let mockPath = '/en';
let deliver: ((data: unknown) => void) | null = null;

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: mockLang === 'ar'
      ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS
      : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: mockLang,
    isRTL: mockLang === 'ar',
  }),
}));
jest.mock('@/components/AuthProvider/authContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('next/navigation', () => ({ usePathname: () => mockPath }));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
jest.mock('@/lib/websocket/WebSocketProvider', () => ({
  useWebSocketSubscription: (channel: string, cb: (data: unknown) => void) => {
    if (channel === 'user:u1') deliver = cb;
    return true;
  },
}));

const ready = (n: number) => ({
  type: 'notification',
  notificationId: `n${n}`,
  userId: 'u1',
  notificationType: 'upload',
  notificationKey: 'uploadReady',
  params: { videoTitle: `Good Deeds ${n}` },
  actionUrl: `/video/v${n}`,
});
const push = (event: unknown) => act(() => deliver!(event));

beforeEach(() => {
  jest.useFakeTimers();
  mockLang = 'en';
  mockPath = '/en';
  deliver = null;
});
afterEach(() => jest.useRealTimers());

describe('NotificationCenter toasts', () => {
  it('groups a bulk upload into one toast with a count and View all', () => {
    render(<NotificationCenter />);
    [1, 2, 3].forEach((n) => push(ready(n)));
    push(ready(2)); // redelivery
    const toasts = screen.getAllByTestId('realtime-toast');
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toHaveAttribute('data-count', '3');
    expect(within(toasts[0]).getByTestId('realtime-toast-message')).toHaveTextContent('3 videos finished processing');
    expect(within(toasts[0]).getByTestId('realtime-toast-action')).toHaveAttribute('href', '/en/dashboard/videos');
    expect(within(toasts[0]).getByTestId('realtime-toast-action')).toHaveTextContent('View all');
  });

  it('shows a single notification with its own text and link', () => {
    render(<NotificationCenter />);
    push(ready(1));
    const toast = screen.getByTestId('realtime-toast');
    expect(toast).toHaveTextContent('Video ready');
    expect(toast).toHaveTextContent('Your video "Good Deeds 1" is ready to watch');
    expect(within(toast).getByTestId('realtime-toast-action')).toHaveAttribute('href', '/en/video/v1');
  });

  it('caps visible toasts at two and collapses the rest into +N more', () => {
    render(<NotificationCenter />);
    push(ready(1));
    push({ ...ready(2), notificationId: 'c', notificationKey: 'newComment' });
    push({ ...ready(3), notificationId: 's', notificationKey: 'newSubscriber', params: { channelName: 'Noor' } });
    push({ ...ready(4), notificationId: 'r', notificationKey: 'commentReply', params: { actorName: 'Ali' } });
    expect(screen.getAllByTestId('realtime-toast')).toHaveLength(2);
    const more = screen.getByTestId('realtime-toast-more');
    expect(more).toHaveTextContent('+2 more');
    expect(more).toHaveAttribute('href', '/en/notifications');
  });

  it('announces a burst once, politely, with the final count', () => {
    render(<NotificationCenter />);
    const announcer = screen.getByTestId('realtime-toast-announcer');
    expect(announcer).toHaveAttribute('aria-live', 'polite');
    push(ready(1));
    act(() => jest.advanceTimersByTime(300));
    push(ready(2));
    act(() => jest.advanceTimersByTime(300));
    push(ready(3));
    expect(announcer).toHaveTextContent('');
    act(() => jest.advanceTimersByTime(1500));
    expect(announcer).toHaveTextContent('Video ready. 3 videos finished processing');
  });

  it('dismisses with the close button and with Escape, and expires on its own', () => {
    render(<NotificationCenter />);
    push(ready(1));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByTestId('realtime-toast')).toBeNull();

    push({ ...ready(5), notificationKey: 'newComment' });
    fireEvent.keyDown(screen.getByTestId('realtime-toast'), { key: 'Escape' });
    expect(screen.queryByTestId('realtime-toast')).toBeNull();

    push({ ...ready(6), notificationKey: 'newSubscriber' });
    act(() => jest.advanceTimersByTime(TOAST_TTL_MS + 10));
    expect(screen.queryByTestId('realtime-toast')).toBeNull();
  });

  it('stays while hovered', () => {
    render(<NotificationCenter />);
    push(ready(1));
    fireEvent.mouseEnter(screen.getByTestId('realtime-toasts'));
    act(() => jest.advanceTimersByTime(TOAST_TTL_MS * 3));
    expect(screen.getByTestId('realtime-toast')).toBeInTheDocument();
  });

  it('renders Arabic copy with plural forms', () => {
    mockLang = 'ar';
    mockPath = '/ar';
    render(<NotificationCenter />);
    [1, 2].forEach((n) => push(ready(n)));
    const toast = screen.getByTestId('realtime-toast');
    expect(toast).toHaveTextContent('اكتملت معالجة مقطعي فيديو');
    expect(within(toast).getByTestId('realtime-toast-action')).toHaveAttribute('href', '/ar/dashboard/videos');
    expect(screen.getByRole('button', { name: 'إغلاق الإشعار' })).toBeInTheDocument();
  });

  it('shows no toast on the upload page and updates the row instead', () => {
    mockPath = '/en/upload';
    let result: string | null = null;
    function Row() {
      result = useUploadResult('v7');
      return null;
    }
    render(
      <>
        <NotificationCenter />
        <Row />
      </>,
    );
    push(ready(7));
    expect(screen.queryByTestId('realtime-toast')).toBeNull();
    expect(result).toBe('ready');
  });
});
