/**
 * Tests for the channel Community tab: loads real posts, handles
 * empty/error states, likes posts and votes on polls as the viewer's channel.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PostStatus, PostType, PostVisibility } from '@al-ummah/shared-types';
import type { CommunityPost } from '@al-ummah/shared-types';
import { EN_TRANSLATIONS } from '@/lib/i18n/translations/en';
import { CommunityTabContent } from '../CommunityTabContent';
import {
  listCommunityPosts,
  likeCommunityPost,
  voteOnPoll,
} from '@/lib/api/community-posts';

jest.mock('@/lib/api/community-posts', () => ({
  listCommunityPosts: jest.fn(),
  likeCommunityPost: jest.fn(),
  unlikeCommunityPost: jest.fn(),
  voteOnPoll: jest.fn(),
}));

jest.mock('@/lib/api/post-comments', () => ({
  listPostComments: jest.fn(),
  createPostComment: jest.fn(),
}));

jest.mock('@/lib/logger-client', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: EN_TRANSLATIONS, isRTL: false, locale: 'en' }),
}));

const mockUser: { current: { id: string } | null } = { current: { id: 'viewer-user' } };
jest.mock('@/components/AuthProvider/authContext', () => ({
  useAuth: () => ({ user: mockUser.current }),
}));

jest.mock('@/contexts/ActiveChannelContext', () => ({
  useActiveChannel: () => ({
    activeChannel: mockUser.current
      ? { channelId: 'viewer-channel', userId: 'viewer-user', name: 'Viewer', isMain: true }
      : null,
  }),
}));

const mockList = listCommunityPosts as jest.MockedFunction<typeof listCommunityPosts>;
const mockLike = likeCommunityPost as jest.MockedFunction<typeof likeCommunityPost>;
const mockVote = voteOnPoll as jest.MockedFunction<typeof voteOnPoll>;

function makePost(overrides: Partial<CommunityPost> = {}): CommunityPost {
  return {
    id: 'post-1',
    channelId: 'channel-1',
    userId: 'owner-user',
    type: PostType.TEXT,
    content: 'Assalamu alaikum everyone',
    likes: 4,
    comments: 0,
    shares: 0,
    views: 0,
    createdAt: new Date().toISOString(),
    pinned: false,
    status: PostStatus.PUBLISHED,
    visibility: PostVisibility.PUBLIC,
    commentsEnabled: true,
    channelName: 'Test Channel',
    channelVerified: false,
    ...overrides,
  };
}

function listResponse(posts: CommunityPost[]) {
  return { posts, pagination: { page: 1, limit: 20, total: posts.length, hasNext: false } };
}

describe('CommunityTabContent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser.current = { id: 'viewer-user' };
  });

  it('loads and renders the channel posts', async () => {
    mockList.mockResolvedValue(listResponse([makePost()]));

    render(<CommunityTabContent channelId="channel-1" />);

    expect(await screen.findByText('Assalamu alaikum everyone')).toBeInTheDocument();
    expect(mockList).toHaveBeenCalledWith(
      { channelId: 'channel-1', page: 1, limit: 20 },
      { channelId: 'viewer-channel' }
    );
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'tabpanel-community');
  });

  it('shows the empty state when the channel has no posts', async () => {
    mockList.mockResolvedValue(listResponse([]));

    render(<CommunityTabContent channelId="channel-1" />);

    expect(await screen.findByText(EN_TRANSLATIONS.community.noPostsYet)).toBeInTheDocument();
  });

  it('shows an error with retry when loading fails', async () => {
    mockList.mockResolvedValueOnce(null).mockResolvedValueOnce(listResponse([makePost()]));

    render(<CommunityTabContent channelId="channel-1" />);

    expect(await screen.findByText(EN_TRANSLATIONS.community.loadPostsFailed)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: EN_TRANSLATIONS.community.retry }));

    expect(await screen.findByText('Assalamu alaikum everyone')).toBeInTheDocument();
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it('likes a post as the viewer channel and shows the returned count', async () => {
    mockList.mockResolvedValue(listResponse([makePost()]));
    mockLike.mockResolvedValue({ success: true, liked: true, totalLikes: 5 });

    render(<CommunityTabContent channelId="channel-1" />);

    const likeButton = await screen.findByRole('button', { name: new RegExp(`^${EN_TRANSLATIONS.community.like}\\b`) });
    fireEvent.click(likeButton);

    await waitFor(() =>
      expect(mockLike).toHaveBeenCalledWith('channel-1', 'post-1', { channelId: 'viewer-channel' })
    );
    expect(await screen.findByRole('button', { name: new RegExp(`^${EN_TRANSLATIONS.community.unlike}\\b`) })).toHaveTextContent('5');
  });

  it('starts liked when the viewer already liked the post', async () => {
    mockList.mockResolvedValue(listResponse([makePost({ viewerHasLiked: true })]));

    render(<CommunityTabContent channelId="channel-1" />);

    expect(await screen.findByRole('button', { name: new RegExp(`^${EN_TRANSLATIONS.community.unlike}\\b`) })).toBeInTheDocument();
  });

  const pollPost = () =>
    makePost({
      id: 'poll-1',
      type: PostType.POLL,
      content: undefined,
      poll: {
        question: 'Best time to study?',
        multipleChoice: false,
        showResults: false,
        totalVotes: 1,
        options: [
          { id: 'option-0', text: 'Fajr', votes: 1, percentage: 100 },
          { id: 'option-1', text: 'Isha', votes: 0, percentage: 0 },
        ],
      },
    });

  it('votes on a poll and displays the results', async () => {
    mockList.mockResolvedValue(listResponse([pollPost()]));
    mockVote.mockResolvedValue({
      success: true,
      results: {
        totalVotes: 2,
        options: [
          { id: 'option-0', votes: 1, percentage: 50 },
          { id: 'option-1', votes: 1, percentage: 50 },
        ],
      },
    });

    render(<CommunityTabContent channelId="channel-1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Isha' }));
    fireEvent.click(screen.getByRole('button', { name: EN_TRANSLATIONS.community.vote }));

    await waitFor(() =>
      expect(mockVote).toHaveBeenCalledWith(
        'channel-1',
        'poll-1',
        { optionIds: ['option-1'] },
        { channelId: 'viewer-channel' }
      )
    );
    expect(await screen.findByText('2 votes')).toBeInTheDocument();
    expect(screen.getAllByText('50.0%')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: EN_TRANSLATIONS.community.vote })).not.toBeInTheDocument();
  });

  it('shows results instead of the vote button when the viewer already voted', async () => {
    mockList.mockResolvedValue(listResponse([{ ...pollPost(), viewerPollVote: ['option-0'] }]));

    render(<CommunityTabContent channelId="channel-1" />);

    expect(await screen.findByText('100.0%')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: EN_TRANSLATIONS.community.vote })).not.toBeInTheDocument();
  });

  it('asks signed-out viewers to sign in before voting', async () => {
    mockUser.current = null;
    mockList.mockResolvedValue(listResponse([pollPost()]));

    render(<CommunityTabContent channelId="channel-1" />);

    expect(await screen.findByText(EN_TRANSLATIONS.community.signInToVote)).toBeInTheDocument();
    expect(mockList).toHaveBeenCalledWith({ channelId: 'channel-1', page: 1, limit: 20 }, undefined);
  });
});
