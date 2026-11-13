/**
 * #1151 (web side for community posts): a member without an active channel comments on a post
 * as themselves. The form used to refuse with "You must be logged in to comment" when no channel
 * was active, although the API accepts a comment with no channel header since c0d7e609.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CommentForm from '../CommentForm';
import { createPostComment } from '@/lib/api/post-comments';

let account: Record<string, unknown> = { id: 'viewer', channel: null, channels: [] };

jest.mock('@/hooks/useMultiAccount', () => ({ useMultiAccount: () => ({ user: account }) }));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', isRTL: false }),
}));
jest.mock('@/lib/api/post-comments', () => ({ createPostComment: jest.fn() }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

const created = { id: 'pc1', content: 'Thanks for sharing' };

describe('CommentForm without a channel', () => {
  beforeEach(() => (createPostComment as jest.Mock).mockReset().mockResolvedValue({ success: true, comment: created }));

  it('posts as the member (no channel header) and says so above the box', async () => {
    account = { id: 'viewer', channel: null, channels: [] };
    const onCreated = jest.fn();
    render(<CommentForm postChannelId="their-ch" postId="p1" userId="viewer" userDisplayName="Amina Yusuf" onCommentCreated={onCreated} />);

    expect(screen.getByTestId('comment-identity')).toHaveTextContent('Commenting as Amina Yusuf');
    expect(screen.getByTestId('comment-identity')).toHaveAttribute('data-as', 'member');
    expect(screen.queryByTestId('comment-identity-switch')).toBeNull();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Thanks for sharing' } });
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);
    await waitFor(() => expect(createPostComment).toHaveBeenCalledWith('their-ch', 'p1', { content: 'Thanks for sharing' }, { channelId: undefined }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(screen.queryByText(/must be logged in/i)).toBeNull();
  });

  it('with a channel active it posts as that channel and offers Switch', async () => {
    account = { id: 'viewer', channel: { id: 'my-ch' }, channels: [{ id: 'my-ch', name: 'My channel' }] };
    render(<CommentForm postChannelId="their-ch" postId="p1" userId="viewer" channelId="my-ch" userDisplayName="My channel" />);
    expect(screen.getByTestId('comment-identity')).toHaveAttribute('data-as', 'channel');
    expect(screen.getByRole('button', { name: 'Switch channel' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hello' } });
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);
    await waitFor(() => expect(createPostComment).toHaveBeenCalledWith('their-ch', 'p1', { content: 'Hello' }, { channelId: 'my-ch' }));
  });

  it('signed out it still refuses', async () => {
    render(<CommentForm postChannelId="their-ch" postId="p1" userDisplayName="Guest" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hi' } });
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);
    expect(await screen.findByText(/must be logged in/i)).toBeInTheDocument();
    expect(createPostComment).not.toHaveBeenCalled();
  });
});
