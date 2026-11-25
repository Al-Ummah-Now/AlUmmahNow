/** Studio's part of Epic 17: premieres, event tags, chat settings, the held review. */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { LIVE_WATCH_EN, STUDIO_EN } from '@al-ummah/shared-types';
import { LiveApiError } from '@/lib/live/api';
import { liveOffers, type LiveOffers } from '@/lib/studio/nav';
import { GoLive } from '../GoLive';
import { LiveSettings } from '../LiveSettings';
import { LiveTab } from '../LiveTab';
import { PremiereManage } from '../PremiereManage';
import { canPremiere } from '../PremiereVideoPicker';
import { readStart, startOf } from '../StartFields';

const api = { listChannelStreams: jest.fn(), createStream: jest.fn(), getStream: jest.fn(), getIngest: jest.fn(), getState: jest.fn(), startStream: jest.fn(), endStream: jest.fn(), schedulePremiere: jest.fn(), swapPremiere: jest.fn(), updateStream: jest.fn(), saveChatSettings: jest.fn(), heldChat: jest.fn(), moderateChat: jest.fn() };
const mockApi = api;
const fetchContentPage = jest.fn();
const push = jest.fn();
const mockRouter = { push, refresh: jest.fn() };
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }));
jest.mock('@/hooks/useCreatorAccess', () => ({
  useCreatorAccess: () => ({ status: 'loading' }),
  needsCreatorTerms: () => false,
  markCreatorTermsRequired: jest.fn(),
}));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: { studio: mockStudio, liveWatch: mockWatch, confirmDialog: { typeToConfirm: 'Type {value}' }, common: { cancel: 'Cancel', loading: 'Loading' }, autocomplete: mockAny }, lang: 'en', isRTL: false }),
}));
jest.mock('@/lib/live/api', () => ({
  ...jest.requireActual('@/lib/live/api'),
  ...Object.fromEntries(['listChannelStreams', 'createStream', 'getStream', 'getIngest', 'getState', 'startStream', 'endStream', 'schedulePremiere', 'swapPremiere', 'updateStream', 'saveChatSettings', 'heldChat', 'moderateChat'].map((name) => [name, (...a: unknown[]) => (mockApi as Record<string, jest.Mock>)[name]!(...a)])),
}));
jest.mock('@/lib/studio/content-client', () => ({ fetchContentPage: (...a: unknown[]) => fetchContentPage(...a) }));
jest.mock('@/components/live/LivePlayer', () => ({ LivePlayer: () => null }));
// The picker's own behavior is Autocomplete's; here it offers what it would load
jest.mock('../PremiereVideoPicker', () => ({
  ...jest.requireActual('../PremiereVideoPicker'),
  PremiereVideoPicker: (p: { onPick: (v: { id: string; title: string }) => void }) => <button type="button" data-testid="pick" onClick={() => p.onPick({ id: 'v2', title: 'Second lecture' })} />,
}));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));
const mockStudio = STUDIO_EN;
const mockWatch = LIVE_WATCH_EN;
const mockAny = new Proxy({}, { get: () => 'text' });
const text = STUDIO_EN.live.apps;

const ALL: LiveOffers = { streams: true, premieres: true, chat: true, events: true, schedule: true };
const OFF: LiveOffers = { streams: true, premieres: false, chat: false, events: false, schedule: false };
const tomorrow = new Date(Date.now() + 86_400_000);
tomorrow.setHours(19, 30, 0, 0);
const START = startOf(tomorrow.toISOString());
const setStart = (value = START) => {
  fireEvent.change(screen.getByTestId('studio-live-date'), { target: { value: value.date } });
  fireEvent.change(screen.getByTestId('studio-live-time'), { target: { value: value.time } });
};
const premiere = (over: object = {}) => ({ id: 's1', title: 'Opening night', status: 'scheduled' as const, kind: 'premiere' as const, premiereVideoId: 'v1', scheduledStartTime: tomorrow.toISOString(), reminderCount: 3, ...over });

beforeEach(() => {
  jest.clearAllMocks();
  api.listChannelStreams.mockResolvedValue({ items: [], cursor: null });
  api.heldChat.mockResolvedValue([]);
});

describe('what is offered', () => {
  it('follows the channel’s switches; with them off the Live tab is as it was', async () => {
    expect(liveOffers({})).toEqual({ streams: false, premieres: false, chat: false, events: false, schedule: false });
    expect(liveOffers({ liveStreams: true, livePremieres: true, liveChat: true, liveEvents: true, liveReminders: true })).toEqual(ALL);
    expect(liveOffers({ liveReminders: true }).schedule).toBe(true);
    render(<LiveTab locale="en" channelId="c1" role="owner" offers={OFF} />);
    expect(await screen.findByTestId('studio-live-form')).toBeInTheDocument();
    for (const id of ['studio-live-kind', 'studio-live-start', 'studio-live-event', 'studio-live-chat-fields', 'studio-premiere-form']) expect(screen.queryByTestId(id)).toBeNull();
    api.createStream.mockResolvedValue({ id: 'n1' });
    fireEvent.change(screen.getByTestId('studio-live-title'), { target: { value: 'Talk' } });
    fireEvent.click(screen.getByTestId('studio-live-create'));
    await waitFor(() => expect(api.createStream).toHaveBeenCalledWith('c1', { title: 'Talk', description: '', isPrivate: false }));
  });

  it('a channel with premieres and no live provider schedules premieres only', async () => {
    render(<LiveTab locale="en" channelId="c1" role="owner" offers={{ ...OFF, streams: false, premieres: true }} />);
    expect(await screen.findByTestId('studio-premiere-form')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-live-form')).toBeNull();
    expect(screen.queryByTestId('studio-live-kind')).toBeNull();
  });

  it('a new stream takes a start, a tag and the chat’s settings; half a start is asked for', async () => {
    api.createStream.mockResolvedValue({ id: 'n1' });
    render(<LiveTab locale="en" channelId="c1" role="owner" offers={ALL} />);
    fireEvent.change(await screen.findByTestId('studio-live-title'), { target: { value: 'Friday' } });
    setStart({ date: START.date, time: '' });
    fireEvent.click(screen.getByTestId('studio-live-create'));
    expect(screen.getByTestId('studio-live-error')).toHaveTextContent(text.timeRequired);
    setStart();
    fireEvent.change(screen.getByTestId('studio-live-event'), { target: { value: 'jumuah' } });
    fireEvent.change(screen.getByTestId('studio-live-slow'), { target: { value: '30' } });
    fireEvent.change(screen.getByTestId('studio-live-hold'), { target: { value: 'strict' } });
    fireEvent.click(screen.getByTestId('studio-live-subscribersOnly'));
    fireEvent.click(screen.getByTestId('studio-live-create'));
    await waitFor(() => expect(api.createStream).toHaveBeenCalledWith('c1', expect.objectContaining({ scheduledStartTime: tomorrow.toISOString(), eventType: 'jumuah', chat: { allowChat: true, chatReplay: true, slowModeSeconds: 30, subscribersOnly: true, aiHold: 'strict' } })));
  });
});

describe('scheduling a premiere', () => {
  const open = async () => {
    render(<LiveTab locale="ar" channelId="c1" role="admin" offers={ALL} />);
    fireEvent.click(await screen.findByTestId('studio-live-kind-premiere'));
  };
  const submit = () => fireEvent.click(screen.getByTestId('studio-premiere-schedule'));

  it('asks for a video and a time to come, then opens the premiere', async () => {
    api.schedulePremiere.mockResolvedValue({ id: 'p1' });
    await open();
    expect(screen.queryByTestId('studio-live-form')).toBeNull();
    submit();
    expect(screen.getByTestId('studio-premiere-problem')).toHaveTextContent(text.videoRequired);
    fireEvent.click(screen.getByTestId('pick'));
    expect(screen.getByTestId('studio-premiere-title')).toHaveValue('Second lecture');
    submit();
    expect(screen.getByTestId('studio-premiere-problem')).toHaveTextContent(text.timeRequired);
    setStart({ date: '2020-01-01', time: '10:00' });
    submit();
    expect(screen.getByTestId('studio-premiere-problem')).toHaveTextContent(text.timeTooSoon);
    setStart();
    submit();
    await waitFor(() => expect(push).toHaveBeenCalledWith('/ar/studio/c1/content/live/p1'));
    expect(api.schedulePremiere).toHaveBeenCalledWith('v2', { title: 'Second lecture', scheduledStartTime: tomorrow.toISOString(), chat: expect.objectContaining({ aiHold: 'basic' }) });
  });

  it('says the server’s refusal in its own words', async () => {
    api.schedulePremiere.mockRejectedValue(new LiveApiError(409, 'premiere_exists'));
    await open();
    fireEvent.click(screen.getByTestId('pick'));
    setStart();
    submit();
    expect(await screen.findByText('This video already has a premiere.')).toBeInTheDocument();
  });

  it('only ready, closed videos are offered', () => {
    const ok = { id: 'v', isDraft: false, isPublic: false, duration: 600, width: 1920, height: 1080, uploadStatus: 'ready' };
    expect(canPremiere(ok as never)).toBe(true);
    expect(canPremiere({ ...ok, isDraft: true, isPublic: true } as never)).toBe(true);
    for (const over of [{ isPublic: true }, { isUnlisted: true }, { duration: 0 }, { uploadStatus: 'processing' }, { scheduledPublishStatus: 'scheduled' }, { premiereHold: { streamId: 's' } }, { width: 1080, height: 1920, duration: 30 }]) expect([over, canPremiere({ ...ok, ...over } as never)]).toEqual([over, false]);
  });

  it('a start is read in the creator’s time zone', () => {
    expect(readStart({ date: '', time: '' })).toBe('empty');
    expect(readStart({ date: '', time: '10:00' })).toBe('incomplete');
    expect(readStart(START)).toEqual({ iso: tomorrow.toISOString() });
    expect(startOf('never')).toEqual({ date: '', time: '' });
  });
});

describe('one premiere', () => {
  it('is what Studio opens instead of the encoder settings', async () => {
    api.getStream.mockResolvedValue(premiere());
    api.getIngest.mockRejectedValue(new LiveApiError(409, 'premiere_no_ingest'));
    render(<GoLive locale="en" channelId="c1" streamId="s1" offers={ALL} />);
    expect(await screen.findByTestId('studio-premiere')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-golive-encoder')).toBeNull();
    expect(screen.getByTestId('studio-premiere-reminded')).toHaveTextContent('3 people');
    expect(screen.getByTestId('studio-premiere-video-link')).toHaveAttribute('href', '/en/studio/c1/content/videos/v1/edit');
  });

  it('is started, cancelled and given another video, each read again after', async () => {
    api.getStream.mockResolvedValue(premiere());
    api.swapPremiere.mockResolvedValue(premiere({ premiereVideoId: 'v2' }));
    render(<PremiereManage locale="en" channelId="c1" stream={premiere()} offers={OFF} />);
    fireEvent.click(screen.getByTestId('studio-premiere-swap'));
    fireEvent.click(screen.getByTestId('pick'));
    expect(await screen.findByText(text.swapped)).toBeInTheDocument();
    expect(api.swapPremiere).toHaveBeenCalledWith('s1', 'v2');

    fireEvent.click(screen.getByTestId('studio-premiere-start'));
    fireEvent.click(await screen.findByTestId('studio-premiere-start-dialog-cancel'));
    expect(api.startStream).not.toHaveBeenCalled();

    api.updateStream.mockRejectedValueOnce(new LiveApiError(409, 'premiere_started'));
    fireEvent.click(screen.getByTestId('studio-premiere-cancel'));
    fireEvent.click(await screen.findByTestId('studio-premiere-cancel-dialog-confirm'));
    expect(await screen.findByText('This premiere has already started.')).toBeInTheDocument();

    api.updateStream.mockResolvedValue({});
    api.getStream.mockResolvedValue(premiere({ status: 'cancelled' }));
    fireEvent.click(screen.getByTestId('studio-premiere-cancel'));
    fireEvent.click(await screen.findByTestId('studio-premiere-cancel-dialog-confirm'));
    expect(await screen.findByText(text.premiereCancelled)).toBeInTheDocument();
    expect(api.updateStream).toHaveBeenLastCalledWith('s1', { status: 'cancelled' });
    expect(screen.queryByTestId('studio-premiere-start')).toBeNull();
  });

  it('is ended while it is on', async () => {
    api.getStream.mockResolvedValue(premiere({ status: 'ended' }));
    render(<PremiereManage locale="en" channelId="c1" stream={premiere({ status: 'live' })} offers={OFF} />);
    fireEvent.click(screen.getByTestId('studio-premiere-end'));
    fireEvent.click(await screen.findByTestId('studio-premiere-end-dialog-confirm'));
    expect(await screen.findByText(text.premiereOver)).toBeInTheDocument();
    expect(api.endStream).toHaveBeenCalledWith('s1');
  });
});

describe('settings', () => {
  it('sends what changed, the chat’s to its own route', async () => {
    const onSaved = jest.fn();
    api.updateStream.mockResolvedValue({});
    api.saveChatSettings.mockResolvedValue(undefined);
    render(<LiveSettings stream={premiere({ eventType: 'halqa', slowModeSeconds: 10 })} offers={ALL} onSaved={onSaved} />);
    const save = () => fireEvent.click(screen.getByTestId('studio-live-save'));
    save();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(api.updateStream).not.toHaveBeenCalled();
    expect(api.saveChatSettings).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('studio-live-event'), { target: { value: '' } });
    fireEvent.change(screen.getByTestId('studio-live-hold'), { target: { value: 'none' } });
    setStart({ date: START.date, time: '21:00' });
    save();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2));
    const at = new Date(tomorrow);
    at.setHours(21, 0);
    expect(api.updateStream).toHaveBeenCalledWith('s1', { scheduledStartTime: at.toISOString(), eventType: null });
    expect(api.saveChatSettings).toHaveBeenCalledWith('s1', { allowChat: true, chatReplay: true, slowModeSeconds: 10, subscribersOnly: false, aiHold: 'none' });
    expect(screen.getByTestId('studio-live-settings-notice')).toHaveTextContent(text.saved);
  });

  it('are not there when nothing can be set', () => {
    const { container } = render(<LiveSettings stream={{ id: 's1', title: 'x', status: 'live' }} offers={OFF} onSaved={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('the held review', () => {
  const message = { id: 'h1', streamId: 's1', userId: 'u1', authorName: 'Yusuf', authorHandle: null, authorAvatar: null, authorRole: null, text: 'a held line', offsetMs: 0, isPinned: false, createdAt: '2026-11-24T00:00:00Z' };
  it('shows or removes each; says when none waits', async () => {
    api.heldChat.mockResolvedValue([message, { ...message, id: 'h2' }]);
    api.moderateChat.mockResolvedValue(undefined);
    render(<PremiereManage locale="en" channelId="c1" stream={premiere()} offers={{ ...OFF, chat: true }} />);
    const rows = await screen.findAllByTestId('live-chat-held');
    fireEvent.click(within(rows[0]!).getByTestId('live-chat-held-show'));
    await waitFor(() => expect(api.moderateChat).toHaveBeenCalledWith('s1', 'h1', 'restore'));
    await waitFor(() => expect(screen.getAllByTestId('live-chat-held')).toHaveLength(1));
    fireEvent.click(screen.getByTestId('live-chat-held-remove'));
    expect(await screen.findByText(text.heldEmpty)).toBeInTheDocument();
  });

  it('decides once however often it is pressed', async () => {
    let finish: () => void = () => undefined;
    api.heldChat.mockResolvedValue([message]);
    api.moderateChat.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<PremiereManage locale="en" channelId="c1" stream={premiere()} offers={{ ...OFF, chat: true }} />);
    const show = await screen.findByTestId('live-chat-held-show');
    fireEvent.click(show);
    fireEvent.click(show);
    fireEvent.click(screen.getByTestId('live-chat-held-remove'));
    expect(api.moderateChat).toHaveBeenCalledTimes(1);
    expect(show).toBeDisabled();
    finish();
    expect(await screen.findByText(text.heldEmpty)).toBeInTheDocument();
  });

  it('is nothing for who may not moderate', async () => {
    api.heldChat.mockRejectedValue(new LiveApiError(403, 'forbidden'));
    render(<PremiereManage locale="en" channelId="c1" stream={premiere()} offers={{ ...OFF, chat: true }} />);
    await waitFor(() => expect(api.heldChat).toHaveBeenCalled());
    expect(screen.queryByTestId('studio-live-held')).toBeNull();
  });
});
