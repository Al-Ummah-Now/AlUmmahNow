import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import {
  ALWAYS_ON_NOTIFICATION_CATEGORIES,
  DEFAULT_NOTIFICATION_QUIET_HOURS,
  NOTIFICATION_CATEGORIES,
  type NotificationSettingsResult,
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
const mockUpdateSettings = jest.fn<Promise<NotificationSettingsResult | null>, [unknown]>();

jest.mock('@/services/api/notifications', () => ({
  NotificationsService: {
    settings: () => mockSettings(),
    updateSettings: (changes: unknown) => mockUpdateSettings(changes),
  },
}));

describe('NotificationSettingsPanel — Quiet hours & prayer windows (E22-S5)', () => {
  beforeEach(() => {
    mockLang = 'en';
    window.localStorage.clear();
    const base = initialResult();
    mockSettings.mockResolvedValue(base);
    mockUpdateSettings.mockImplementation(async (changes: any) => ({
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

  it('syncs locally cached prayer windows when toggling quiet during prayer times, and formats Eastern Arabic digits in Arabic', async () => {
    mockLang = 'ar';
    window.localStorage.setItem(
      LOCAL_PRAYER_WINDOWS_STORAGE_KEY,
      JSON.stringify([
        { startMinute: 310, endMinute: 335 },
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
});
