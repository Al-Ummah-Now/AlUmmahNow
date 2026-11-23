import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { HELP_AR, HELP_EN, type CalendarEventItem } from '@al-ummah/shared-types';
import { EventsCalendarPage } from '../EventsCalendarPage';
import { ChannelUpcomingEvents } from '../ChannelUpcomingEvents';
import { EVENTS_COPY, formatEventSchedule } from '@/lib/events/events-copy';

let mockUser: { id: string } | null = { id: 'usr_viewer_1' };
jest.mock('@/components/AuthProvider/authContext', () => ({
  useOptionalAuth: () => ({ user: mockUser }),
  useAuth: () => ({ user: mockUser }),
}));

let mockLang: 'en' | 'ar' = 'en';
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    lang: mockLang,
    locale: mockLang,
    dir: mockLang === 'ar' ? 'rtl' : 'ltr',
    isRTL: mockLang === 'ar',
  }),
}));

let mockEventCalendarEnabled = false;
jest.mock('@/hooks/useFeatures', () => ({
  useFeatures: () => ({
    ready: true,
    features: { eventCalendar: mockEventCalendarEnabled, liveEvents: mockEventCalendarEnabled, liveReminders: mockEventCalendarEnabled },
  }),
}));

const mockList = jest.fn();
const mockSetReminder = jest.fn();
jest.mock('@/services/api/events', () => ({
  EventsService: {
    list: (params: unknown) => mockList(params),
    setReminder: (streamId: string, remind: boolean) => mockSetReminder(streamId, remind),
    icsUrl: (channelId: string | null, locale: 'en' | 'ar') =>
      `https://videos.api.alummahnow.net/api${channelId ? `/channels/${channelId}` : ''}/events.ics?lang=${locale}`,
  },
}));

const sampleEvents: CalendarEventItem[] = [
  {
    streamId: 'str_halqa_1',
    channelId: 'ch_makkah',
    channelName: 'Al-Manar Academy',
    channelNameAr: 'أكاديمية المنار',
    channelHandle: 'almanar',
    title: 'Weekly Tafsir Halqa — Surah Al-Kahf',
    description: 'Interactive online Tafsir stream with moderated Q&A.',
    kind: 'live',
    eventType: 'halqa',
    status: 'scheduled',
    scheduledStartAt: '2026-11-27T18:00:00.000Z',
    startedAt: null,
    endedAt: null,
    premiereVideoId: null,
    reminderCount: 12,
    viewerReminded: false,
    watchPath: '/live/str_halqa_1',
  },
  {
    streamId: 'str_jumuah_2',
    channelId: 'ch_makkah',
    channelName: 'Al-Manar Academy',
    channelNameAr: 'أكاديمية المنار',
    channelHandle: 'almanar',
    title: 'Friday Khutbah Broadcast',
    description: null,
    kind: 'premiere',
    eventType: 'jumuah',
    status: 'live',
    scheduledStartAt: '2026-11-27T12:15:00.000Z',
    startedAt: '2026-11-27T12:15:00.000Z',
    endedAt: null,
    premiereVideoId: 'vid_1',
    reminderCount: 40,
    viewerReminded: true,
    watchPath: '/live/str_jumuah_2',
  },
];

describe('Event Calendar UI & formatting (E22-S6)', () => {
  beforeEach(() => {
    mockUser = { id: 'usr_viewer_1' };
    mockLang = 'en';
    mockEventCalendarEnabled = false;
    mockList.mockReset();
    mockSetReminder.mockReset();
    mockList.mockResolvedValue({ status: 'ok', items: [sampleEvents[0]], nextCursor: null });
    mockSetReminder.mockResolvedValue(true);
  });

  it('formats Gregorian and Hijri dates with Eastern Arabic numerals in Arabic and zero ASCII digits', () => {
    const arSchedule = formatEventSchedule('2026-11-27T18:00:00.000Z', 'ar', 'UTC');
    expect(arSchedule).not.toBeNull();
    expect(arSchedule!.gregorian).toMatch(/[\u0660-\u0669]/);
    expect(arSchedule!.gregorian).not.toMatch(/[0-9]/);
    expect(arSchedule!.hijri).toMatch(/[\u0660-\u0669]/);
    expect(arSchedule!.hijri).not.toMatch(/[0-9]/);
    expect(arSchedule!.time).not.toMatch(/[0-9]/);
    expect(arSchedule!.combined).toContain('،');

    expect(Object.keys(EVENTS_COPY.ar)).toEqual(Object.keys(EVENTS_COPY.en));
    expect(Object.keys(EVENTS_COPY.ar.types)).toEqual(Object.keys(EVENTS_COPY.en.types));
    expect(JSON.stringify(EVENTS_COPY.ar)).not.toContain('فيديو');
    const arHelp = HELP_AR.topics.watching.sections.find((s) => s.id === 'event-calendar');
    const enHelp = HELP_EN.topics.watching.sections.find((s) => s.id === 'event-calendar');
    expect(arHelp?.feature).toBe('eventCalendar');
    expect(enHelp?.feature).toBe('eventCalendar');
    expect(JSON.stringify(arHelp)).not.toContain('فيديو');
  });

  it('renders frosted-glass event cards, filters by eventType, exposes .ics link, and toggles reminders', async () => {
    mockEventCalendarEnabled = true;
    render(
      <EventsCalendarPage
        locale="en"
        initialItems={sampleEvents}
        initialCursor={null}
        timeZone="UTC"
      />,
    );

    expect(screen.getAllByTestId('event-card')).toHaveLength(2);
    expect(screen.getByTestId('events-ics-link')).toHaveAttribute(
      'href',
      'https://videos.api.alummahnow.net/api/events.ics?lang=en',
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('events-filter-halqa'));
    });
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'halqa', subscribedOnly: false }),
    );
    await waitFor(() => expect(screen.getAllByTestId('event-card')).toHaveLength(1));

    await act(async () => {
      fireEvent.click(screen.getByTestId('event-remind-btn'));
    });
    expect(mockSetReminder).toHaveBeenCalledWith('str_halqa_1', true);
  });

  it('keeps ChannelUpcomingEvents completely hidden (zero network call) when eventCalendar is off, and renders when on', async () => {
    mockEventCalendarEnabled = false;
    const { rerender } = render(<ChannelUpcomingEvents channelId="ch_makkah" />);
    expect(screen.queryByTestId('channel-upcoming-events')).toBeNull();
    expect(mockList).not.toHaveBeenCalled();

    mockEventCalendarEnabled = true;
    mockLang = 'ar';
    rerender(<ChannelUpcomingEvents channelId="ch_makkah" />);
    await waitFor(() => expect(screen.getByTestId('channel-upcoming-events')).toBeInTheDocument());
    expect(mockList).toHaveBeenCalledWith({ channelId: 'ch_makkah', limit: 4 });
  });
});
