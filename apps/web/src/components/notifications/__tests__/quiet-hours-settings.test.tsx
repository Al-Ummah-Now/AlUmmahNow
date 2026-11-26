import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import {
  ALWAYS_ON_NOTIFICATION_CATEGORIES,
  DEFAULT_NOTIFICATION_QUIET_HOURS,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CENTER_EN,
  type NotificationSettingsResult,
  type NotificationSettingsUpdateRequest,
} from '@al-ummah/shared-types';
import { LOCAL_PRAYER_WINDOWS_STORAGE_KEY, formatMinuteOfDay } from '@/lib/notifications/prayer-quiet-windows';
import { NotificationSettingsPanel } from '../NotificationSettingsPanel';

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

jest.mock('@/components/AuthProvider/authContext', () => ({
  useAuth: () => ({ user: { id: 'usr_1' } }),
}));

jest.mock('../BrowserNotificationsSetting', () => ({
  BrowserNotificationsSetting: () => null,
}));

const initialResult = () => ({
  settings: {
    new_videos: true,
    live: true,
    replies: true,
    comments: true,
    subscribers: true,
    uploads: true,
    account: true,
  },
  categories: NOTIFICATION_CATEGORIES,
  alwaysOn: ALWAYS_ON_NOTIFICATION_CATEGORIES,
  email: { account: true, locale: null },
  quietHours: { ...DEFAULT_NOTIFICATION_QUIET_HOURS, prayerWindows: [] },
} satisfies NotificationSettingsResult);

const mockSettings = jest.fn<Promise<NotificationSettingsResult | null>, []>();
const mockUpdateSettings = jest.fn<Promise<NotificationSettingsResult | null>, [NotificationSettingsUpdateRequest]>();

jest.mock('@/services/api/notifications', () => ({
  NotificationsService: {
    settings: () => mockSettings(),
    updateSettings: (changes: NotificationSettingsUpdateRequest) => mockUpdateSettings(changes),
  },
}));

describe('NotificationSettingsPanel — Quiet hours & prayer windows (E22-S5)', () => {
  beforeEach(() => {
    mockLang = 'en';
    mockUpdateSettings.mockClear();
    window.localStorage.clear();
    const base = initialResult();
    mockSettings.mockResolvedValue(base);
    mockUpdateSettings.mockImplementation(async (changes) => ({
      ...base,
      quietHours: {
        ...base.quietHours,
        ...(changes?.quietHours ?? {}),
        prayerWindows: changes?.quietHours?.prayerWindows ?? base.quietHours.prayerWindows,
      },
    }));
  });

  it('hides quiet hours when the API omits the feature settings', async () => {
    mockSettings.mockResolvedValue({ ...initialResult(), quietHours: undefined });
    render(<NotificationSettingsPanel />);

    expect(await screen.findByTestId('notification-email-settings')).toBeInTheDocument();
    expect(screen.queryByTestId('notification-quiet-hours')).not.toBeInTheDocument();
  });

  it('renders quiet hours controls and saves daily window and time range changes', async () => {
    render(<NotificationSettingsPanel />);
    await waitFor(() => expect(screen.getByTestId('notification-quiet-hours')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId('notification-quiet-enabled'));
    });
    expect(mockUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ quietHours: expect.objectContaining({ enabled: true }) }),
    );

    await act(async () => {
      fireEvent.change(screen.getByTestId('notification-quiet-start'), { target: { value: '1260' } });
    });
    expect(mockUpdateSettings).toHaveBeenLastCalledWith({ quietHours: { startMinute: 1260 } });
  });

  it('rolls back an optimistic quiet-hours change and shows an error when saving fails', async () => {
    mockUpdateSettings.mockResolvedValueOnce(null);
    render(<NotificationSettingsPanel />);

    const toggle = await screen.findByTestId('notification-quiet-enabled');
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);
    expect(toggle).toBeChecked();

    expect(await screen.findByText(NOTIFICATION_CENTER_EN.settingsError)).toBeInTheDocument();
    expect(toggle).not.toBeChecked();
    expect(toggle).toBeEnabled();
  });

  it('ignores corrupt cached prayer windows when loading settings', async () => {
    window.localStorage.setItem(LOCAL_PRAYER_WINDOWS_STORAGE_KEY, '{broken');
    render(<NotificationSettingsPanel />);
    expect(await screen.findByTestId('notification-quiet-hours')).toBeInTheDocument();
    expect(screen.queryByTestId('notification-prayer-quiet-enabled')).not.toBeInTheDocument();
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it('omits cached windows when disabling the prayer schedule', async () => {
    const base = initialResult();
    mockSettings.mockResolvedValue({
      ...base,
      quietHours: { ...base.quietHours, prayerQuietEnabled: true },
    });
    render(<NotificationSettingsPanel />);

    const toggle = await screen.findByTestId('notification-prayer-quiet-enabled');
    expect(toggle).toBeChecked();
    expect(mockUpdateSettings).not.toHaveBeenCalled();

    window.localStorage.setItem(
      LOCAL_PRAYER_WINDOWS_STORAGE_KEY,
      JSON.stringify([{ startMinute: 310, endMinute: 335 }]),
    );
    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(mockUpdateSettings).toHaveBeenCalledWith({
      quietHours: { prayerQuietEnabled: false, timezone: base.quietHours.timezone },
    });
  });

  it('sends only minute bounds from cached prayer windows and formats Arabic times', async () => {
    mockLang = 'ar';
    window.localStorage.setItem(
      LOCAL_PRAYER_WINDOWS_STORAGE_KEY,
      JSON.stringify([
        { startMinute: 310, endMinute: 335, lat: 40.7, lng: -74, city: 'New York' },
        { startMinute: 730, endMinute: 760 },
      ]),
    );

    render(<NotificationSettingsPanel />);
    await waitFor(() => expect(screen.getByTestId('notification-quiet-hours')).toBeInTheDocument());

    // Arabic time options use Eastern Arabic digits ٠–٩ and zero ASCII digits
    const formatted22 = formatMinuteOfDay('ar', 1320);
    expect(formatted22).not.toMatch(/[0-9]/);
    expect(formatted22).toMatch(/[\u0660-\u0669]/);

    await act(async () => {
      fireEvent.click(screen.getByTestId('notification-prayer-quiet-enabled'));
    });
    expect(mockUpdateSettings).toHaveBeenCalledWith({
      quietHours: expect.objectContaining({
        prayerQuietEnabled: true,
        prayerWindows: [
          { startMinute: 310, endMinute: 335 },
          { startMinute: 730, endMinute: 760 },
        ],
      }),
    });
  });

  it.each([NaN, Infinity, -Infinity])('formats non-finite minute %s as midnight', (minute) => {
    expect(formatMinuteOfDay('en', minute)).toBe(formatMinuteOfDay('en', 0));
  });
});
