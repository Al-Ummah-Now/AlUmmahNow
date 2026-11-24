import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { LIVE_WATCH_EN } from '@al-ummah/shared-types';
import { LiveEventFilter, UpcomingLive, useLiveEventFilter } from '../LiveBrowse';

const OFF = { livePremieres: false, liveReminders: false, liveEvents: false };
let mockFeatures = OFF;
const useLiveStreams = jest.fn();
jest.mock('@/hooks/useFeatures', () => ({ useFeatures: () => ({ ready: true, features: mockFeatures }) }));
jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: { liveWatch: mockText }, lang: 'en', isRTL: false }) }));
jest.mock('@/hooks/useLiveStreams', () => ({ useLiveStreams: (...a: unknown[]) => useLiveStreams(...a) }));
const mockText = LIVE_WATCH_EN;

const HOUR = 3_600_000;
const stream = (id: string, inMs: number | null) => ({ id, title: id, scheduledStartTime: inMs === null ? undefined : new Date(Date.now() + inMs) });
const page = (streams: object[], hasNextPage = false) => ({ streams, hasNextPage, fetchNextPage: jest.fn(), isFetchingNextPage: false });
const Card = ({ stream: s, onPlay }: { stream: { id: string }; onPlay: () => void }) => <button type="button" data-testid="card" onClick={onPlay}>{s.id}</button>;
const Grid = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
const show = (onOpen = jest.fn()) => render(<UpcomingLive card={Card as never} grid={Grid} onOpen={onOpen} />);

beforeEach(() => {
  jest.clearAllMocks();
  mockFeatures = { ...OFF, liveReminders: true };
  useLiveStreams.mockReturnValue(page([]));
});

describe('the upcoming list', () => {
  it('holds what has a time to come, the next first', () => {
    useLiveStreams.mockReturnValue(page([stream('later', 5 * HOUR), stream('past', -HOUR), stream('untimed', null), stream('next', HOUR)]));
    const onOpen = jest.fn();
    show(onOpen);
    expect(screen.getAllByTestId('card').map((c) => c.textContent)).toEqual(['next', 'later']);
    fireEvent.click(screen.getAllByTestId('card')[0]!);
    expect(onOpen).toHaveBeenCalledWith('next');
  });

  it('is nothing, not an empty heading, when there is none; and not asked for while the switches are off', () => {
    const { unmount } = show();
    expect(screen.queryByTestId('live-upcoming')).toBeNull();
    unmount();
    mockFeatures = OFF;
    useLiveStreams.mockReturnValue(page([stream('next', HOUR)]));
    show();
    expect(screen.queryByTestId('live-upcoming')).toBeNull();
    expect(useLiveStreams).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
  });

  it('looks further while the first pages have none, and stops', () => {
    const first = page([stream('untimed', null)], true);
    useLiveStreams.mockReturnValue(first);
    show();
    expect(first.fetchNextPage).toHaveBeenCalledTimes(1);
    const many = page(Array.from({ length: 150 }, (_, i) => stream(`u${i}`, null)), true);
    useLiveStreams.mockReturnValue(many);
    show();
    expect(many.fetchNextPage).not.toHaveBeenCalled();
  });
});

describe('the event filter', () => {
  it('offers the tags and All, and says which is chosen', () => {
    const onChange = jest.fn();
    render(<LiveEventFilter value="halqa" onChange={onChange} />);
    expect(screen.getByTestId('live-event-halqa')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('live-event-jumuah'));
    expect(onChange).toHaveBeenLastCalledWith('jumuah');
    fireEvent.click(screen.getByTestId('live-event-all'));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('is forgotten when event tags are turned off', () => {
    mockFeatures = { ...OFF, liveEvents: true };
    const { result, rerender } = renderHook(() => useLiveEventFilter());
    act(() => result.current.choose('taraweeh'));
    expect(result.current).toMatchObject({ enabled: true, eventType: 'taraweeh' });
    mockFeatures = OFF;
    rerender();
    expect(result.current).toMatchObject({ enabled: false, eventType: undefined });
  });
});
