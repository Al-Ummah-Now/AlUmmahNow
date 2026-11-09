import { fireEvent, render, screen } from '@testing-library/react';
import { STUDIO_EN } from '@al-ummah/shared-types';
import { StudioVideoEditor } from '../StudioVideoEditor';

const push = jest.fn();

jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
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
  return render(<StudioVideoEditor locale="en" channelId="c1" userId="u1" video={video} canViewAnalytics={canViewAnalytics} />);
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

  it('assigns playlists on this channel', () => {
    editor();
    expect(screen.getByTestId('playlist')).toHaveTextContent('v1/c1');
  });
});
