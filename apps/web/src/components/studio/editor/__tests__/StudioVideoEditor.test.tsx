import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { STUDIO_EN } from '@al-ummah/shared-types';
import { StudioVideoEditor } from '../StudioVideoEditor';

const push = jest.fn();
const back = jest.fn();

jest.mock('next/navigation', () => ({ useRouter: () => ({ push, back, prefetch: jest.fn() }) }));
jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: { studio: mockStudio } }) }));
jest.mock('@/components/videoEdit/index', () => ({
  __esModule: true,
  default: ({ channelId, userId, onSave, onCancel }: { channelId: string; userId: string; onSave: (v: unknown) => void; onCancel: () => void }) => (
    <div>
      <span data-testid="edit-context">{`${channelId}/${userId}`}</span>
      <button onClick={() => onSave({ id: 'v1' })}>save</button>
      <button onClick={onCancel}>cancel</button>
    </div>
  ),
}));
jest.mock('@/components/SaveToPlaylist', () => ({
  __esModule: true,
  default: ({ videoId, channelId }: { videoId: string; channelId?: string }) => <span data-testid="playlist">{`${videoId}/${channelId}`}</span>,
}));

const mockStudio = STUDIO_EN;
const video = { id: 'v1', title: 'My video' } as never;
const LIST = '/en/studio/c1/content/videos';

function editor(canViewAnalytics = true) {
  const client = new QueryClient();
  return render(<QueryClientProvider client={client}><StudioVideoEditor locale="en" channelId="c1" userId="u1" video={video} canViewAnalytics={canViewAnalytics} /></QueryClientProvider>);
}

describe('StudioVideoEditor', () => {
  beforeEach(() => jest.clearAllMocks());

  it('edits as this channel', () => {
    editor();
    expect(screen.getByTestId('edit-context')).toHaveTextContent('c1/u1');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('My video');
  });

  it('links back to the Videos tab', () => {
    editor();
    expect(screen.getByRole('link', { name: STUDIO_EN.editor.back })).toHaveAttribute('href', LIST);
  });

  it('goes back to the list after saving and on cancel', () => {
    editor();
    fireEvent.click(screen.getByText('save'));
    expect(push).toHaveBeenCalledWith(LIST);
    push.mockClear();
    fireEvent.click(screen.getByText('cancel'));
    expect(push).toHaveBeenCalledWith(LIST);
  });

  it('offers the Analytics tab only with access to stats', () => {
    const { unmount } = editor();
    expect(screen.getByRole('link', { name: STUDIO_EN.editor.analytics })).toHaveAttribute('href', `${LIST}/v1/analytics`);
    unmount();
    editor(false);
    expect(screen.queryByRole('link', { name: STUDIO_EN.editor.analytics })).toBeNull();
  });

  it('goes back in history to the exact list it was opened from', () => {
    window.history.replaceState(null, '', '/en/studio/c1/content/videos/v1/edit');
    sessionStorage.setItem('studio:list-return', JSON.stringify({ channelId: 'c1', target: '/en/studio/c1/content/videos/v1/edit', url: `${LIST}?status=drafts&sort=views` }));
    editor();
    const link = screen.getByRole('link', { name: STUDIO_EN.editor.back });
    expect(link).toHaveAttribute('href', `${LIST}?status=drafts&sort=views`);
    fireEvent.click(link);
    expect(back).toHaveBeenCalled();
    fireEvent.click(screen.getByText('save'));
    expect(back).toHaveBeenCalledTimes(2);
    expect(push).not.toHaveBeenCalled();
    sessionStorage.clear();
  });

  it('assigns playlists on this channel', () => {
    editor();
    expect(screen.getByTestId('playlist')).toHaveTextContent('v1/c1');
  });
});
