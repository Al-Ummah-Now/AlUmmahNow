/** Going live, premieres and creating a channel, refused with `terms_required` (#1929). */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EN_TRANSLATIONS as mockEn } from '@al-ummah/shared-types';
import { LiveApiError } from '@/lib/live/api';
import { startOf } from '@/components/studio/live/StartFields';
import { GoLive } from '@/components/studio/live/GoLive';
import { LiveTab } from '@/components/studio/live/LiveTab';
import { PremiereForm } from '@/components/studio/live/PremiereForm';
import { PremiereManage } from '@/components/studio/live/PremiereManage';
import { StudioNoChannel } from '@/components/studio/StudioNoChannel';
import { ChannelManagementSection } from '@/components/channelManagement';
import { ChannelManagementSection as ChannelManagementRtl } from '@/components/channelManagement/rtl';
import { accept, asksOnceAndGoesOn, doesNotAskInALoop, modal } from './terms-testkit';

const mockT = { ...mockEn };
const mockPush = jest.fn();
const mockRouter = { push: mockPush, refresh: jest.fn(), replace: jest.fn() };
let mockTermsAccepted: boolean | undefined = true;
jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: mockT, lang: 'en', locale: 'en', dir: 'ltr', isRTL: false }) }));
jest.mock('@/hooks/useCreatorAccess', () => ({
  useCreatorAccess: () => ({ status: 'ready', access: { canUpload: true, canCreateChannel: true, termsAccepted: mockTermsAccepted, termsVersion: '2026-11-24' } }),
  needsCreatorTerms: (c: { access: { termsAccepted?: boolean } }) => c.access.termsAccepted === false,
  mayCreateChannel: () => true,
  markCreatorTermsRequired: jest.fn(),
  acceptCreatorTerms: jest.fn().mockResolvedValue({ ok: true }),
}));
const mockApi = {
  listChannelStreams: jest.fn(), createStream: jest.fn(), getStream: jest.fn(), getIngest: jest.fn(), getState: jest.fn(), startStream: jest.fn(),
  schedulePremiere: jest.fn(), swapPremiere: jest.fn(), createChannel: jest.fn(), createChannelResult: jest.fn(),
};
jest.mock('@/lib/live/api', () => ({
  ...jest.requireActual('@/lib/live/api'),
  ...Object.fromEntries(['listChannelStreams', 'createStream', 'getStream', 'getIngest', 'getState', 'startStream', 'schedulePremiere', 'swapPremiere'].map((name) => [name, (...a: unknown[]) => (mockApi as Record<string, jest.Mock>)[name]!(...a)])),
}));
jest.mock('@/lib/api/channels', () => ({
  listChannels: jest.fn().mockResolvedValue({ channels: [] }), createChannelResult: (...a: unknown[]) => mockApi.createChannelResult(...a), updateChannel: jest.fn(), deleteChannel: jest.fn(),
}));
jest.mock('@/hooks/useMultiAccount', () => ({
  useMultiAccount: () => ({ user: { id: 'u1', channels: [] }, creatingChannel: false, reloadChannels: jest.fn(), createChannel: (...a: unknown[]) => mockApi.createChannel(...a) }),
  useActiveUserId: () => 'u1',
}));
jest.mock('@/components/AuthProvider/authContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter, useSearchParams: () => new URLSearchParams(), usePathname: () => '/en' }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), debug: jest.fn(), warn: jest.fn(), info: jest.fn() } }));
jest.mock('@/components/live/LivePlayer', () => ({ LivePlayer: () => null }));
jest.mock('@/components/help/HelpLink', () => ({ HelpLink: () => null }));
jest.mock('@/components/studio/live/PremiereVideoPicker', () => ({
  PremiereVideoPicker: (p: { onPick: (v: { id: string; title: string }) => void }) => <button type="button" data-testid="pick" onClick={() => p.onPick({ id: 'v2', title: 'Second lecture' })} />,
}));

const OFFERS = { streams: true, premieres: true, chat: false, events: false, schedule: false };
const refuse = (m: jest.Mock) => m.mockRejectedValueOnce(new LiveApiError(403, 'terms_required'));
const tomorrow = new Date(Date.now() + 86_400_000);
tomorrow.setHours(19, 30, 0, 0);

beforeEach(() => {
  jest.clearAllMocks();
  Object.values(mockApi).forEach((m) => m.mockReset());
  mockTermsAccepted = true;
  mockApi.listChannelStreams.mockResolvedValue({ items: [], cursor: null });
});

describe('a new live stream', () => {
  const create = {
    act: async () => {
      render(<LiveTab locale="en" channelId="c1" role="owner" offers={OFFERS} />);
      fireEvent.change(await screen.findByTestId('studio-live-title'), { target: { value: 'Talk' } });
      fireEvent.click(screen.getByTestId('studio-live-create'));
    },
    call: mockApi.createStream, refuse, ok: (m: jest.Mock) => m.mockResolvedValue({ id: 'n1' }), review: 'studio-live-review-terms',
  };
  it('is created after accepting, with what was typed', async () => {
    await asksOnceAndGoesOn(create);
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/en/studio/c1/content/live/n1'));
  });
  it('does not loop', () => doesNotAskInALoop(create));
  it('asks first when the account is known not to have accepted, then creates it', async () => {
    mockTermsAccepted = false;
    mockApi.createStream.mockResolvedValue({ id: 'n1' });
    await create.act();
    expect(modal()).toBeInTheDocument();
    expect(mockApi.createStream).not.toHaveBeenCalled();
    await accept();
    await waitFor(() => expect(mockApi.createStream).toHaveBeenCalledTimes(1));
  });
});

describe('the go live page', () => {
  const stream = () => {
    mockApi.getStream.mockResolvedValue({ id: 's1', channelId: 'c1', title: 'Live', status: 'scheduled', isPrivate: false });
    mockApi.getState.mockResolvedValue({ state: { status: 'scheduled' } });
  };
  const rtmp = { protocol: 'rtmp', url: 'rtmps://live.example.com/live', key: 'key', full: 'rtmps://live.example.com/live/key' };
  const ingest = { ingest: rtmp, state: { status: 'scheduled' } };
  it('reads the encoder settings after accepting', async () => {
    stream();
    await asksOnceAndGoesOn({
      act: () => { render(<GoLive locale="en" channelId="c1" streamId="s1" offers={OFFERS} />); },
      call: mockApi.getIngest, refuse, ok: (m) => m.mockResolvedValue(ingest), review: 'studio-golive-review-terms',
    });
    expect(await screen.findByTestId('studio-golive-start')).toBeInTheDocument();
  });
  it('goes live after accepting', async () => {
    stream();
    mockApi.getIngest.mockResolvedValue(ingest);
    await asksOnceAndGoesOn({
      act: async () => {
        render(<GoLive locale="en" channelId="c1" streamId="s1" offers={OFFERS} />);
        fireEvent.click(await screen.findByTestId('studio-golive-start'));
      },
      call: mockApi.startStream, refuse, ok: (m) => m.mockResolvedValue({ ingest: null, state: { status: 'live' } }), review: 'studio-golive-review-terms',
    });
    expect(screen.queryByTestId('studio-golive-error')).toBeNull();
  });
});

describe('a premiere', () => {
  const schedule = {
    act: () => {
      render(<PremiereForm locale="en" channelId="c1" offers={OFFERS} />);
      fireEvent.click(screen.getByTestId('pick'));
      const at = startOf(tomorrow.toISOString());
      fireEvent.change(screen.getByTestId('studio-live-date'), { target: { value: at.date } });
      fireEvent.change(screen.getByTestId('studio-live-time'), { target: { value: at.time } });
      fireEvent.click(screen.getByTestId('studio-premiere-schedule'));
    },
    call: mockApi.schedulePremiere, refuse, ok: (m: jest.Mock) => m.mockResolvedValue({ id: 'p1' }), review: 'studio-premiere-review-terms',
  };
  const row = { id: 's1', title: 'Opening night', status: 'scheduled' as const, kind: 'premiere' as const, premiereVideoId: 'v1', scheduledStartTime: tomorrow.toISOString() };
  const manage = () => {
    mockApi.getStream.mockResolvedValue(row);
    render(<PremiereManage locale="en" channelId="c1" stream={row} offers={OFFERS} />);
  };
  const startNow = {
    act: async () => {
      manage();
      fireEvent.click(screen.getByTestId('studio-premiere-start'));
      fireEvent.click(await screen.findByTestId('studio-premiere-start-dialog-confirm'));
    },
    call: mockApi.startStream, refuse, ok: (m: jest.Mock) => m.mockResolvedValue({}), review: 'studio-premiere-review-terms',
  };
  const swap = {
    act: () => {
      manage();
      fireEvent.click(screen.getByTestId('studio-premiere-swap'));
      fireEvent.click(screen.getByTestId('pick'));
    },
    call: mockApi.swapPremiere, refuse, ok: (m: jest.Mock) => m.mockResolvedValue({}), review: 'studio-premiere-review-terms',
  };
  it('is scheduled after accepting', async () => {
    await asksOnceAndGoesOn(schedule);
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/en/studio/c1/content/live/p1'));
  });
  it('scheduling does not loop', () => doesNotAskInALoop(schedule));
  it('starts now after accepting, without confirming again', () => asksOnceAndGoesOn(startNow));
  it('starting now does not loop', () => doesNotAskInALoop(startNow));
  it('gets its other video after accepting, and says so', async () => {
    await asksOnceAndGoesOn(swap);
    expect(await screen.findByText(mockEn.studio.live.apps.swapped)).toBeInTheDocument();
    expect(mockApi.swapPremiere).toHaveBeenCalledWith('s1', 'v2');
  });
});

describe('a channel', () => {
  it('is created after accepting in Studio’s empty state', async () => {
    const create = jest.fn();
    let refusals = 1;
    mockApi.createChannel.mockImplementation(async (data: unknown, options: { onTermsRequired: () => void }) => {
      create(data);
      if (refusals-- > 0) {
        options.onTermsRequired();
        return null;
      }
      return { id: 'ch9' };
    });
    await asksOnceAndGoesOn({
      act: () => {
        render(<StudioNoChannel locale="en" />);
        fireEvent.change(screen.getByLabelText(mockEn.studio.noChannel.nameLabel), { target: { value: 'Noor' } });
        fireEvent.click(screen.getByTestId('studio-create-channel'));
      },
      call: create, refuse: () => undefined, ok: () => undefined, review: 'studio-create-channel-review-terms',
    });
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/en/studio/ch9/dashboard'));
  });

  const refused = { data: null, status: 403, errorBody: { code: 'terms_required' } };
  it.each([['English', ChannelManagementSection, 'Create Channel'], ['Arabic', ChannelManagementRtl, 'إنشاء القناة']] as const)('is created after accepting from the channels page (%s), and the next form is empty', async (_name, Section, label) => {
    const openForm = async () => fireEvent.click((await screen.findAllByRole('button')).find((b) => b.textContent && /channel|قنا/i.test(b.textContent))!);
    const name = () => document.getElementById(_name === 'English' ? 'channel-name-en' : 'channel-name-ar') as HTMLInputElement;
    await asksOnceAndGoesOn({
      act: async () => {
        render(<Section initialChannels={[]} />);
        await openForm();
        fireEvent.change(name(), { target: { value: 'Noor channel' } });
        fireEvent.click(screen.getByRole('button', { name: label }));
      },
      call: mockApi.createChannelResult, refuse: (m) => m.mockResolvedValueOnce(refused), ok: (m) => m.mockResolvedValue({ data: { success: true }, status: 200 }), review: 'create-channel-review-terms',
    });
    await waitFor(() => expect(name()).toBeNull());
    await openForm();
    expect(name().value).toBe('');
  });
});
