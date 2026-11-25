/**
 * Where a signed-in person reports from: a channel's header, a post's menu and a post comment's menu open the same
 * dialog, which offers child safety first. Not on one's own, and not signed out.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Channel, CommunityPost, PostComment } from '@al-ummah/shared-types';
import { ChannelHeader as ChannelHeaderLTR } from '@/components/Channel/ChannelHeader';
import { ChannelHeader as ChannelHeaderRTL } from '@/components/Channel/rtl/ChannelHeader';
import PostCard from '@/components/Community/PostCard';
import Comment from '@/components/Community/Comment';
import ReportContentButton from '../ReportContentButton';
import { createReport } from '@/lib/api/moderation';

let mockUser: { id: string } | null = { id: 'me' };
let mockLang: 'en' | 'ar' = 'en';

jest.mock('next/image', () => ({ __esModule: true, default: () => null }));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: mockLang === 'ar' ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: mockLang,
    isRTL: mockLang === 'ar',
  }),
}));
jest.mock('@/components/AuthProvider/authContext', () => ({ useOptionalAuth: () => (mockUser ? { user: mockUser } : null) }));
jest.mock('@/hooks/useMultiAccount', () => ({ useMultiAccount: () => ({ user: mockUser, loading: false }) }));
jest.mock('@/hooks/useChannelSubscription', () => ({
  useChannelSubscription: () => ({ isSubscribed: false, subscriberCount: 0, isChecking: false, isUpdating: false, error: null, toggle: jest.fn() }),
}));
jest.mock('@/hooks/useHumanCheck', () => ({ useHumanCheck: () => ({ ensureHuman: async () => ({ ok: true, token: null }) }) }));
jest.mock('@/components/notifications/ChannelBellMenu', () => ({ ChannelBellMenu: () => null }));
jest.mock('@/components/Channel/ChannelOwnerActions', () => ({ ChannelOwnerActions: () => null }));
jest.mock('@/components/share/ShareLinkButton', () => ({ ShareLinkButton: () => null }));
jest.mock('@/components/Community/PostEngagement', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/Community/CommentsSection', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => ({ confirm: jest.fn(), confirmDialog: null }) }));
jest.mock('@/lib/api/post-comments', () => ({ listCommentReplies: jest.fn().mockResolvedValue({ success: true, comments: [] }) }));
jest.mock('@/lib/api/moderation', () => ({ createReport: jest.fn().mockResolvedValue({ success: true }) }));
jest.mock('@/lib/logger-client', () => ({ logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const REPORT = { en: 'Report', ar: 'إبلاغ' };
const channel = { id: 'ch-1', userId: 'owner', name: 'Salam', isMain: true, dateCreated: '2026-11-01T00:00:00Z' } as unknown as Channel;
const post = { id: 'post-1', channelId: 'ch-1', userId: 'owner', type: 'text', content: 'Hello', createdAt: '2026-11-20T00:00:00Z', likes: 0, comments: 0, shares: 0, views: 0, pinned: false, status: 'published', visibility: 'public', commentsEnabled: true, channelName: 'Salam', channelVerified: false } as unknown as CommunityPost;
const comment = { id: 'cmt-1', postId: 'post-1', channelId: 'owner', userId: 'owner', content: 'Salam', userDisplayName: 'Sara', channelVerified: false, likes: 0, repliesCount: 0, isPinned: false, isEdited: false, isHeartedByCreator: false, createdAt: '2026-11-20T00:00:00Z' } as unknown as PostComment;

/** Reports child safety in the dialog that is open, and says what was sent. */
async function sendChildSafety() {
  const reason = document.getElementById('report-reason') as HTMLSelectElement;
  const select = reason.tagName === 'SELECT' ? reason : (document.querySelector('select') as HTMLSelectElement);
  fireEvent.change(select, { target: { value: 'child_safety' } });
  fireEvent.submit(document.querySelector('form')!);
  await waitFor(() => expect(createReport).toHaveBeenCalled());
  return (createReport as jest.Mock).mock.calls[0][0];
}

beforeEach(() => {
  mockUser = { id: 'me' };
  mockLang = 'en';
  (createReport as jest.Mock).mockClear();
});

describe('the report dialog', () => {
  it.each([['en', 'Child safety'], ['ar', 'سلامة الأطفال']] as const)('offers child safety first (%s)', async (lang, label) => {
    mockLang = lang;
    render(<ReportContentButton contentType="video" contentId="vid-1" />);
    fireEvent.click(screen.getByRole('button'));
    const options = [...document.querySelectorAll('select option')].map((o) => [(o as HTMLOptionElement).value, o.textContent ?? '']);
    expect(options[1][0]).toBe('child_safety');
    expect(options[1][1]).toContain(label);
    expect(await sendChildSafety()).toEqual({ contentType: 'video', contentId: 'vid-1', reason: 'child_safety' });
  });
});

describe.each([['en', ChannelHeaderLTR], ['ar', ChannelHeaderRTL]] as const)('a channel header (%s)', (lang, Header) => {
  const button = () => screen.queryByRole('button', { name: REPORT[lang] });
  beforeEach(() => {
    mockLang = lang;
  });

  it('reports the channel by its id', async () => {
    render(<Header channel={channel} locale={lang} />);
    fireEvent.click(button()!);
    expect(await sendChildSafety()).toMatchObject({ contentType: 'channel', contentId: 'ch-1', reason: 'child_safety' });
  });

  it('not on one’s own, and not signed out', () => {
    mockUser = { id: 'owner' };
    const own = render(<Header channel={channel} locale={lang} />);
    expect(button()).toBeNull();
    own.unmount();
    mockUser = null;
    render(<Header channel={channel} locale={lang} />);
    expect(button()).toBeNull();
  });
});

describe('a post card', () => {
  it('reports the post from its menu', async () => {
    render(<PostCard post={post} userId="me" />);
    fireEvent.click(screen.getByTestId('post-actions'));
    fireEvent.click(await screen.findByTestId('post-report'));
    expect(await sendChildSafety()).toMatchObject({ contentType: 'post', contentId: 'post-1', reason: 'child_safety' });
  });

  it('has no menu on one’s own, or signed out', () => {
    const own = render(<PostCard post={post} userId="owner" />);
    expect(screen.queryByTestId('post-actions')).toBeNull();
    own.unmount();
    render(<PostCard post={post} />);
    expect(screen.queryByTestId('post-actions')).toBeNull();
  });
});

describe('a post comment', () => {
  it('reports the comment from its menu', async () => {
    render(<Comment comment={comment} postChannelId="ch-1" postId="post-1" userId="me" />);
    fireEvent.click(screen.getByTestId('comment-actions'));
    fireEvent.click(await screen.findByTestId('comment-report'));
    expect(await sendChildSafety()).toMatchObject({ contentType: 'comment', contentId: 'cmt-1', reason: 'child_safety' });
  });

  it('one’s own has no report; signed out and deleted have no menu', async () => {
    const own = render(<Comment comment={comment} postChannelId="ch-1" postId="post-1" userId="owner" />);
    fireEvent.click(screen.getByTestId('comment-actions'));
    expect(await screen.findByTestId('comment-delete')).toBeInTheDocument();
    expect(screen.queryByTestId('comment-report')).toBeNull();
    own.unmount();
    const out = render(<Comment comment={comment} postChannelId="ch-1" postId="post-1" />);
    expect(screen.queryByTestId('comment-actions')).toBeNull();
    out.unmount();
    render(<Comment comment={{ ...comment, deletedAt: '2026-11-21T00:00:00Z' } as PostComment} postChannelId="ch-1" postId="post-1" userId="me" />);
    expect(screen.queryByTestId('comment-actions')).toBeNull();
  });
});
