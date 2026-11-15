/* eslint-disable @typescript-eslint/no-explicit-any -- fake browser and worker globals */
/**
 * Browser notifications setting (Web Push, #1287): the switch, the permission prompt, the
 * subscription and the device registration, in en and ar.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserNotificationsSetting } from '../BrowserNotificationsSetting';
import { resetWebPushKeyCache, stopWebPushOnSignOut, syncWebPush } from '@/lib/push/web-push';

let mockLang: 'en' | 'ar' = 'en';
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: mockLang === 'ar' ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: mockLang,
    dir: mockLang === 'ar' ? 'rtl' : 'ltr',
  }),
}));
jest.mock('@/lib/runtime-config', () => ({ getApiUrl: () => 'https://api.test' }));
jest.mock('@/lib/auth/client-token', () => ({ getClientAuthHeaders: async () => ({ Authorization: 'Bearer tok' }) }));

const KEY = btoa(String.fromCharCode(4, ...new Array(64).fill(7))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const SUB_JSON = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', expirationTime: null, keys: { p256dh: 'p', auth: 'a' } };

interface Browser {
  permission: NotificationPermission;
  answer: NotificationPermission;
  subscription: { toJSON: () => unknown; unsubscribe: jest.Mock; options: { applicationServerKey: ArrayBuffer | null } } | null;
  subscribe: jest.Mock;
  register: jest.Mock;
  requests: Array<{ url: string; method: string; body?: any; auth?: string }>;
  publicKey: string | null;
  deviceStatus: number;
}

let b: Browser;

/** jsdom has no Response: what the code reads of one. */
const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function install() {
  b = { permission: 'default', answer: 'granted', subscription: null, subscribe: jest.fn(), register: jest.fn(), requests: [], publicKey: KEY, deviceStatus: 200 };
  const pushManager = {
    getSubscription: async () => b.subscription,
    subscribe: b.subscribe.mockImplementation(async (opts: { applicationServerKey: Uint8Array }) => {
      b.subscription = { toJSON: () => SUB_JSON, unsubscribe: jest.fn(async () => { b.subscription = null; return true; }), options: { applicationServerKey: opts.applicationServerKey.buffer as ArrayBuffer } };
      return b.subscription;
    }),
  };
  const registration = { pushManager };
  b.register.mockResolvedValue(registration);
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register: b.register, ready: Promise.resolve(registration), getRegistration: async () => registration },
  });
  (window as any).PushManager = function PushManager() {};
  (window as any).Notification = {
    get permission() { return b.permission; },
    requestPermission: jest.fn(async () => (b.permission = b.answer)),
  };
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/devices/webpush-key')) return reply(200, { success: true, result: { publicKey: b.publicKey } });
    b.requests.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: (init?.headers as Record<string, string>)?.Authorization });
    return reply(b.deviceStatus, {});
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  mockLang = 'en';
  localStorage.clear();
  resetWebPushKeyCache();
  install();
});

const view = () => render(<BrowserNotificationsSetting userId="u1" idPrefix="t" />);

describe('browser notifications setting', () => {
  it('turning it on asks permission, subscribes with the VAPID key and registers this browser', async () => {
    view();
    const toggle = await screen.findByRole('switch', { name: 'Notifications in this browser' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    expect((window as any).Notification.requestPermission).toHaveBeenCalled();
    expect(b.register).toHaveBeenCalledWith('/push-sw.js', { scope: '/push/' });
    const [{ applicationServerKey, userVisibleOnly }] = b.subscribe.mock.calls[0];
    expect(userVisibleOnly).toBe(true);
    expect(Array.from(applicationServerKey as Uint8Array).slice(0, 2)).toEqual([4, 7]);
    const put = b.requests.find((r) => r.method === 'PUT')!;
    expect(put.url).toMatch(/^https:\/\/api\.test\/api\/devices\/web-[0-9a-f]{32}$/);
    expect(put.auth).toBe('Bearer tok');
    expect(put.body).toEqual({ platform: 'web', provider: 'webpush', app: 'viewer', subscription: SUB_JSON, locale: 'en' });
  });

  it('turning it off removes the device and the subscription', async () => {
    view();
    const toggle = await screen.findByRole('switch');
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    const sub = b.subscription!;
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    expect(b.requests.at(-1)).toMatchObject({ method: 'DELETE' });
    expect(sub.unsubscribe).toHaveBeenCalled();
  });

  it('a refused permission shows how to allow it, and the switch stays off and disabled', async () => {
    b.answer = 'denied';
    view();
    const toggle = await screen.findByRole('switch');
    fireEvent.click(toggle);
    await screen.findByText(/blocked for this site/);
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(b.requests).toEqual([]);
  });

  it('a failed registration says so and stays off', async () => {
    b.deviceStatus = 503;
    view();
    const toggle = await screen.findByRole('switch');
    fireEvent.click(toggle);
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t turn on browser notifications. Try again.');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('hidden while the environment has no VAPID key pair', async () => {
    b.publicKey = null;
    const { container } = view();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('a browser without Web Push gets a note instead of a switch, in Arabic too', async () => {
    delete (window as any).PushManager;
    mockLang = 'ar';
    view();
    expect(await screen.findByTestId('notification-browser-note')).toHaveTextContent('لا يستطيع هذا المتصفح استقبال الإشعارات.');
    expect(screen.getByText('إشعارات المتصفح')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('shows on only for the account that turned it on', async () => {
    view();
    fireEvent.click(await screen.findByRole('switch'));
    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'));
    render(<BrowserNotificationsSetting userId="someone-else" idPrefix="o" />);
    await waitFor(() => expect(screen.getAllByRole('switch')).toHaveLength(2));
    expect(screen.getAllByRole('switch')[1]).toHaveAttribute('aria-checked', 'false');
  });
});

describe('page load sync and sign-out', () => {
  async function turnOn() {
    view();
    fireEvent.click(await screen.findByRole('switch'));
    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'));
    b.requests.length = 0;
  }

  it('a page load re-registers for the owner with the current language, never for anyone else', async () => {
    await turnOn();
    await syncWebPush('someone-else', 'ar');
    expect(b.requests).toEqual([]);
    await syncWebPush('u1', 'ar');
    expect(b.requests).toEqual([expect.objectContaining({ method: 'PUT', body: expect.objectContaining({ locale: 'ar' }) })]);
  });

  it('signing out unregisters this browser; without an opt-in it does nothing', async () => {
    await stopWebPushOnSignOut();
    expect(b.requests).toEqual([]);
    await turnOn();
    await stopWebPushOnSignOut();
    expect(b.requests).toEqual([expect.objectContaining({ method: 'DELETE' })]);
    expect(b.subscription).toBeNull();
  });
});
