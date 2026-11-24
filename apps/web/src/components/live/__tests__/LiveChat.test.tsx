import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LIVE_WATCH_AR, LIVE_WATCH_EN, type LiveChatMessage } from '@al-ummah/shared-types';
import { LiveApiError, type LiveChatView } from '@/lib/live/api';
import { LiveChatPanel, LiveChatReplay } from '../LiveChatPanel';
import { byTime, pollDelay, withLatest, withMessage } from '../useLiveChat';
import { readWindow } from '../useChatReplay';

const readChat = jest.fn();
const postChat = jest.fn();
const moderateChat = jest.fn();
let mockFrame: ((data: unknown) => void) | null = null;
let mockChannel = '';
let mockUser: { id: string } | null = { id: 'me' };
const ensureHuman = jest.fn(async (..._a: unknown[]) => ({ ok: true, token: 'human' }) as { ok: boolean; token?: string });

jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: { liveWatch: mockText }, lang: mockLang, isRTL: mockLang === 'ar' }) }));
jest.mock('@/components/AuthProvider/authContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/hooks/useMultiAccount', () => ({ useMultiAccount: () => ({ user: { channel: mockActiveChannel } }) }));
jest.mock('@/hooks/useProfile', () => ({ useProfile: () => ({ profile: { displayName: 'Maryam', avatarUrl: null } }) }));
jest.mock('@/hooks/useHumanCheck', () => ({ useHumanCheck: () => ({ ensureHuman: (...a: unknown[]) => ensureHuman(...a), checking: false, messages: { failed: 'human failed' } }) }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));
jest.mock('@/lib/auth/silent-sign-in', () => ({ loginRoutePath: () => '/login' }));
jest.mock('@/components/moderation/ReportContentButton', () => ({ __esModule: true, default: (p: { contentType: string; contentId: string }) => <div data-testid="report" data-type={p.contentType} data-id={p.contentId} /> }));
jest.mock('@/lib/websocket/WebSocketProvider', () => ({
  useOptionalWebSocketSubscription: (channel: string, callback: (data: unknown) => void) => {
    mockChannel = channel;
    mockFrame = callback;
    return true;
  },
}));
const confirm = jest.fn(async (..._a: unknown[]) => true);
jest.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => ({ confirm: (...a: unknown[]) => confirm(...a), dialog: null }) }));
jest.mock('@/lib/live/api', () => ({
  ...jest.requireActual('@/lib/live/api'),
  readChat: (...a: unknown[]) => readChat(...a),
  postChat: (...a: unknown[]) => postChat(...a),
  moderateChat: (...a: unknown[]) => moderateChat(...a),
}));

let mockText = LIVE_WATCH_EN;
let mockLang: 'en' | 'ar' = 'en';
let mockActiveChannel: { id: string; name: string; avatarUrl: null } | null = null;

const msg = (n: number, over: Partial<LiveChatMessage> = {}): LiveChatMessage => ({
  id: `m${n}`, streamId: 's1', userId: `u${n}`, authorName: `Person ${n}`, authorHandle: null, authorAvatar: null, authorRole: null, text: `message ${n}`,
  offsetMs: n * 1000, isPinned: false, createdAt: new Date(1_700_000_000_000 + n * 1000).toISOString(), ...over,
});
const page = (messages: LiveChatMessage[], over = {}) => ({ messages, pinned: null, hasMore: false, ...over });
const CHAT: LiveChatView = { enabled: true, replay: false, slowModeSeconds: 0, subscribersOnly: false, canPost: true };
const frame = async (data: unknown) => act(async () => { mockFrame!(data); });
const texts = () => screen.queryAllByTestId('live-chat-text').map((el) => el.textContent);
const onChanged = jest.fn();
const show = async (props: Partial<React.ComponentProps<typeof LiveChatPanel>> = {}) => {
  const view = render(<LiveChatPanel streamId="s1" mode="live" chat={CHAT} canModerate={false} onChanged={onChanged} {...props} />);
  await waitFor(() => expect(readChat).toHaveBeenCalled());
  await act(async () => {});
  return view;
};
const menu = async (id: string, action: string) => {
  const row = screen.getAllByTestId('live-chat-message').find((el) => el.getAttribute('data-message-id') === id)!;
  await userEvent.click(within(row).getByTestId('live-chat-menu'));
  await userEvent.click(await screen.findByTestId(`live-chat-${action}`));
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'me' };
  mockLang = 'en';
  mockText = LIVE_WATCH_EN;
  mockActiveChannel = null;
  readChat.mockResolvedValue(page([msg(1), msg(2)]));
  moderateChat.mockResolvedValue(undefined);
  confirm.mockResolvedValue(true);
  ensureHuman.mockResolvedValue({ ok: true, token: 'human' });
});

describe('merging', () => {
  it('keeps the server order, one copy of each', () => {
    const same = { createdAt: msg(1).createdAt };
    expect(withMessage([msg(1, { id: 'b' })], msg(2, { id: 'a', ...same })).map((m) => m.id)).toEqual(['a', 'b']);
    expect(withMessage([msg(1)], msg(1, { text: 'again' }))).toHaveLength(1);
    expect([msg(3), msg(1)].sort(byTime).map((m) => m.id)).toEqual(['m1', 'm3']);
  });
  it('a page replaces what it covers, keeps older ones it joins and newer ones just received', () => {
    const ids = (l: LiveChatMessage[]) => l.map((m) => m.id);
    // m3 was removed meanwhile
    expect(ids(withLatest([msg(1), msg(2), msg(3), msg(4)], [msg(2), msg(4)]))).toEqual(['m1', 'm2', 'm4']);
    expect(ids(withLatest([msg(1), msg(5)], [msg(1), msg(2)], (id) => id === 'm5'))).toEqual(['m1', 'm2', 'm5']);
    expect(ids(withLatest([msg(1), msg(5)], [msg(1), msg(2)]))).toEqual(['m1', 'm2']);
    // Nothing in common: messages in between would be missing
    expect(ids(withLatest([msg(1)], [msg(50), msg(51)]))).toEqual(['m50', 'm51']);
    expect(withLatest([msg(1)], [])).toEqual([]);
  });
  it('polls every 10 s ± 2 s on air, 30 s before, and backs off to a minute', () => {
    expect([pollDelay('live', 0, 0), pollDelay('live', 0, 1), pollDelay('soon', 0)]).toEqual([8000, 12000, 30000]);
    expect([pollDelay('live', 1), pollDelay('live', 2), pollDelay('live', 5)]).toEqual([20000, 40000, 60000]);
  });
});

describe('the chat', () => {
  it('shows the latest messages, then what the realtime channel brings', async () => {
    await show();
    expect(mockChannel).toBe('live:s1');
    expect(texts()).toEqual(['message 1', 'message 2']);
    await frame({ type: 'live_chat_message', message: msg(3, { authorRole: 'owner' }) });
    expect(texts()).toEqual(['message 1', 'message 2', 'message 3']);
    expect(screen.getByTestId('live-chat-role')).toHaveTextContent('Host');
    await frame({ type: 'live_chat_removed', messageId: 'm2' });
    expect(texts()).toEqual(['message 1', 'message 3']);
    await frame({ type: 'live_chat_pinned', message: msg(1, { isPinned: true }) });
    expect(screen.getByTestId('live-chat-pinned')).toHaveTextContent('message 1');
    // Everything a blocked person wrote, the pinned one too
    await frame({ type: 'live_chat_removed', messageId: 'm1', userId: 'u1' });
    expect(texts()).toEqual(['message 3']);
    expect(screen.queryByTestId('live-chat-pinned')).toBeNull();
    await frame({ type: 'live_chat_settings', settings: { slowModeSeconds: 10 } });
    expect(onChanged).toHaveBeenCalledWith({ slowModeSeconds: 10 });
  });

  it('reads again when the channel is confirmed, and stops polling', async () => {
    jest.useFakeTimers();
    try {
      render(<LiveChatPanel streamId="s1" mode="live" chat={CHAT} canModerate={false} onChanged={onChanged} />);
      await act(async () => {});
      expect(readChat).toHaveBeenCalledTimes(1);
      await act(async () => { await jest.advanceTimersByTimeAsync(12_100); });
      expect(readChat).toHaveBeenCalledTimes(2);
      await frame({ type: 'realtime_joined' });
      expect(readChat).toHaveBeenCalledTimes(3);
      await act(async () => { await jest.advanceTimersByTimeAsync(120_000); });
      expect(readChat).toHaveBeenCalledTimes(3);
      await frame({ type: 'realtime_left' });
      await act(async () => { await jest.advanceTimersByTimeAsync(12_100); });
      expect(readChat).toHaveBeenCalledTimes(4);
      // Never in the background
      const hidden = jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      await act(async () => { await jest.advanceTimersByTimeAsync(60_000); });
      expect(readChat).toHaveBeenCalledTimes(4);
      hidden.mockRestore();
    } finally {
      jest.useRealTimers();
    }
  });

  it('a message that arrives while the page is being read is not lost', async () => {
    let answer: (p: unknown) => void = () => undefined;
    readChat.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    render(<LiveChatPanel streamId="s1" mode="live" chat={CHAT} canModerate={false} onChanged={onChanged} />);
    await frame({ type: 'live_chat_message', message: msg(9) });
    await act(async () => { answer(page([msg(1)])); });
    expect(texts()).toEqual(['message 1', 'message 9']);
    await frame({ type: 'live_chat_removed', messageId: 'm9' });
    expect(texts()).toEqual(['message 1']);
  });

  it('says that it is closed, and shows no way to write', async () => {
    readChat.mockRejectedValue(new LiveApiError(404, 'not_found'));
    await show();
    expect(screen.getByTestId('live-chat-closed')).toBeInTheDocument();
    expect(screen.queryByTestId('live-chat-form')).toBeNull();
  });

  it('can be tried again after a failure', async () => {
    readChat.mockRejectedValueOnce(new Error('down'));
    await show();
    expect(screen.getByTestId('live-chat-failed')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: LIVE_WATCH_EN.retry }));
    expect(texts()).toEqual(['message 1', 'message 2']);
  });

  it('reads earlier messages', async () => {
    readChat.mockResolvedValueOnce(page([msg(5)], { hasMore: true })).mockResolvedValueOnce(page([msg(3), msg(4)]));
    await show();
    await userEvent.click(screen.getByTestId('live-chat-older'));
    expect(readChat).toHaveBeenLastCalledWith('s1', { before: 'm5', limit: 50 });
    expect(texts()).toEqual(['message 3', 'message 4', 'message 5']);
    expect(screen.queryByTestId('live-chat-older')).toBeNull();
  });
});

describe('writing', () => {
  const write = async (value: string) => {
    await userEvent.type(screen.getByTestId('live-chat-input'), value);
    await userEvent.click(screen.getByTestId('live-chat-send'));
    await act(async () => {});
  };

  it('signed out: a way to sign in, no menus', async () => {
    mockUser = null;
    await show();
    expect(screen.getByTestId('live-chat-sign-in')).toBeInTheDocument();
    expect(screen.queryByTestId('live-chat-input')).toBeNull();
    expect(screen.queryByTestId('live-chat-menu')).toBeNull();
  });

  it('not open yet: says when', async () => {
    await show({ chat: { ...CHAT, canPost: false }, mode: 'soon' });
    expect(screen.getByTestId('live-chat-not-open')).toBeInTheDocument();
  });

  it('sends as the active channel with the human check, and shows the message', async () => {
    mockActiveChannel = { id: 'ch9', name: 'My channel', avatarUrl: null };
    postChat.mockResolvedValue(msg(7, { userId: 'me' }));
    await show();
    await write('  salam ');
    expect(postChat).toHaveBeenCalledWith('s1', 'salam', { channelId: 'ch9', humanToken: 'human' });
    expect(texts()).toContain('message 7');
    expect(screen.getByTestId('live-chat-input')).toHaveValue('');
  });

  it('a refusal keeps the text, says why in the viewer’s language, and counts the wait', async () => {
    mockLang = 'ar';
    mockText = LIVE_WATCH_AR;
    postChat.mockRejectedValue(new LiveApiError(429, 'live_chat_slow_mode', 12));
    await show({ chat: { ...CHAT, slowModeSeconds: 30 } });
    expect(screen.getByTestId('live-chat-notes')).toHaveTextContent('رسالة واحدة كل ٣٠ ثانية');
    await write('مرحبا');
    expect(screen.getByTestId('live-chat-problem')).toHaveTextContent('يُرجى الانتظار قليلًا');
    expect(screen.getByTestId('live-chat-input')).toHaveValue('مرحبا');
    expect(screen.getByTestId('live-chat-send')).toBeDisabled();
    expect(screen.getByTestId('live-chat-send')).toHaveTextContent('١٢');
  });

  it('slow mode waits after a message, not for moderators', async () => {
    postChat.mockResolvedValue(msg(7, { userId: 'me' }));
    const view = await show({ chat: { ...CHAT, slowModeSeconds: 10 } });
    await write('one');
    expect(screen.getByTestId('live-chat-send')).toHaveTextContent('Wait 10');
    view.unmount();
    await show({ chat: { ...CHAT, slowModeSeconds: 10 }, canModerate: true });
    expect(screen.queryByTestId('live-chat-notes')).toBeNull();
    await write('two');
    expect(screen.getByTestId('live-chat-send')).toHaveTextContent('Send');
  });

  it('counts characters, not code units, and refuses what is too long', async () => {
    await show();
    fireEvent.change(screen.getByTestId('live-chat-input'), { target: { value: '🌙'.repeat(450) } });
    expect(screen.getByTestId('live-chat-left')).toHaveTextContent('50 left');
    fireEvent.change(screen.getByTestId('live-chat-input'), { target: { value: '🌙'.repeat(501) } });
    expect(screen.getByTestId('live-chat-send')).toBeDisabled();
  });

  it('a chat that closed meanwhile reads the state again', async () => {
    postChat.mockRejectedValue(new LiveApiError(404, 'not_found'));
    await show();
    await write('x');
    expect(onChanged).toHaveBeenCalled();
  });
});

describe('moderating', () => {
  it('a viewer may report others and remove their own, after asking', async () => {
    readChat.mockResolvedValue(page([msg(1), msg(2, { userId: 'me' })]));
    await show();
    await menu('m1', 'report');
    expect(screen.getByTestId('report')).toHaveAttribute('data-type', 'live_chat');
    expect(screen.getByTestId('report')).toHaveAttribute('data-id', 'm1');
    confirm.mockResolvedValueOnce(false);
    await menu('m2', 'remove');
    expect(moderateChat).not.toHaveBeenCalled();
    await menu('m2', 'remove');
    expect(moderateChat).toHaveBeenCalledWith('s1', 'm2', 'remove');
    expect(texts()).toEqual(['message 1']);
    // Their own can't be brought back
    expect(screen.queryByTestId('live-chat-undo')).toBeNull();
  });

  it('a moderator removes with undo, pins, and blocks after asking; the team can’t be blocked', async () => {
    readChat.mockResolvedValue(page([msg(1), msg(2, { authorRole: 'moderator' }), msg(3), msg(4, { userId: 'u3' })]));
    await show({ canModerate: true });
    await menu('m1', 'remove');
    expect(texts()).not.toContain('message 1');
    await userEvent.click(screen.getByTestId('live-chat-undo'));
    expect(moderateChat).toHaveBeenLastCalledWith('s1', 'm1', 'restore');
    expect(texts()).toContain('message 1');
    await menu('m1', 'pin');
    expect(screen.getByTestId('live-chat-pinned')).toHaveTextContent('message 1');
    await userEvent.click(screen.getByTestId('live-chat-unpin-banner'));
    expect(screen.queryByTestId('live-chat-pinned')).toBeNull();
    await menu('m3', 'block_author');
    expect(confirm).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Block Person 3?' }));
    expect(texts()).toEqual(['message 1', 'message 2']);
    await userEvent.click(within(screen.getAllByTestId('live-chat-message')[1]).getByTestId('live-chat-menu'));
    expect(screen.queryByTestId('live-chat-block_author')).toBeNull();
  });

  it('a failed action says so and reads the chat again', async () => {
    moderateChat.mockRejectedValue(new LiveApiError(409, 'conflict'));
    await show({ canModerate: true });
    readChat.mockClear();
    await menu('m1', 'remove');
    expect(screen.getByTestId('live-chat-notice')).toHaveTextContent(LIVE_WATCH_EN.chatActionFailed);
    expect(readChat).toHaveBeenCalled();
    expect(texts()).toContain('message 1');
  });
});

describe('the replay', () => {
  const fakePlayer = () => {
    const on: Record<string, () => void> = {};
    let time = 0;
    return { currentTime: () => time, on: (e: string, f: () => void) => { on[e] = f; }, off: () => undefined, at: (t: number) => act(async () => { time = t; on.timeupdate?.(); }) };
  };

  it('shows what had been written by now, and follows a seek both ways', async () => {
    readChat.mockImplementation(async (_s: string, q: { fromMs: number }) => page(q.fromMs === 0 ? [msg(5), msg(30)] : q.fromMs === 60_000 ? [msg(65)] : []));
    const player = fakePlayer();
    render(<LiveChatReplay streamId="s1" player={player as never} />);
    expect(screen.getByTestId('live-chat-replay-empty')).toHaveTextContent(LIVE_WATCH_EN.chatReplayEmpty);
    await player.at(6);
    expect(texts()).toEqual(['message 5']);
    await player.at(66);
    expect(texts()).toEqual(['message 5', 'message 30', 'message 65']);
    await player.at(31);
    expect(texts()).toEqual(['message 5', 'message 30']);
    expect(screen.queryByTestId('live-chat-menu')).toBeNull();
    // Each window is read once
    expect(readChat.mock.calls.filter(([, q]) => q.fromMs === 0)).toHaveLength(1);
  });

  it('is not on the page when there is none', async () => {
    readChat.mockRejectedValue(new LiveApiError(404, 'not_found'));
    const player = fakePlayer();
    const { container } = render(<LiveChatReplay streamId="s1" player={player as never} />);
    await player.at(1);
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it('reads the rest of a window that was cut, without repeats', async () => {
    readChat.mockResolvedValueOnce({ ...page([msg(1), msg(2)]), truncated: true }).mockResolvedValueOnce(page([msg(2), msg(3), msg(70)]));
    expect((await readWindow('s1', 0)).map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    expect(readChat).toHaveBeenLastCalledWith('s1', { fromMs: 2000, toMs: 60_000 }, undefined);
  });
});
