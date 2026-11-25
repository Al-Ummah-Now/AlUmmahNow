/** Publishing, scheduling, editing in bulk and audio tracks, refused with `terms_required` (#1929). */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EN_TRANSLATIONS as mockEn } from '@al-ummah/shared-types';
import VideoEdit from '@/components/videoEdit';
import ScheduleSection from '@/components/videoEdit/ScheduleSection';
import AudioTrackDialog from '@/components/videoEdit/audio/AudioTrackDialog';
import { ScheduledVideosList } from '@/components/scheduled-videos/ScheduledVideosList';
import { BulkScheduleDialog } from '@/components/studio/videos/BulkDialogs';
import { VideosTab } from '@/components/studio/videos/VideosTab';
import { BulkEditPanel } from '@/components/bulkEdit/BulkEditPanel';
import { accept, asksOnceAndGoesOn, doesNotAskInALoop, modal, refusal } from './terms-testkit';

const mockT = { ...mockEn };
jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: mockT, lang: 'en', locale: 'en', dir: 'ltr', isRTL: false }) }));
jest.mock('@/hooks/useCreatorAccess', () => ({
  useCreatorAccess: () => ({ status: 'ready', access: { canUpload: true, canCreateChannel: true, termsAccepted: false, termsVersion: '2026-11-24' } }),
  needsCreatorTerms: () => false,
  markCreatorTermsRequired: jest.fn(),
  acceptCreatorTerms: jest.fn().mockResolvedValue({ ok: true }),
}));
const mockApi = {
  updateVideo: jest.fn(), bulkEditVideos: jest.fn(), undoBulkEdit: jest.fn(), scheduleVideo: jest.fn(), publishNow: jest.fn(), cancelSchedule: jest.fn(),
  bulkScheduleVideos: jest.fn(), addAudioTrack: jest.fn(), fetchContentPage: jest.fn(), reportError: jest.fn(),
};
jest.mock('@/lib/api/videos', () => ({
  updateVideo: (...a: unknown[]) => mockApi.updateVideo(...a), bulkEditVideos: (...a: unknown[]) => mockApi.bulkEditVideos(...a), undoBulkEdit: (...a: unknown[]) => mockApi.undoBulkEdit(...a),
  bulkDeleteVideos: jest.fn(), bulkUpdateVideos: jest.fn(),
}));
jest.mock('@/lib/api/scheduling', () => ({
  scheduleVideo: (...a: unknown[]) => mockApi.scheduleVideo(...a), publishNow: (...a: unknown[]) => mockApi.publishNow(...a), cancelSchedule: (...a: unknown[]) => mockApi.cancelSchedule(...a),
  updateSchedule: jest.fn(), getVideoSchedule: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/api/studio-content', () => ({ bulkScheduleVideos: (...a: unknown[]) => mockApi.bulkScheduleVideos(...a) }));
jest.mock('@/lib/api/audio-tracks', () => ({ ...jest.requireActual('@/lib/api/audio-tracks'), addAudioTrack: (...a: unknown[]) => mockApi.addAudioTrack(...a) }));
jest.mock('@/lib/api/chapters', () => ({ getChapters: jest.fn().mockResolvedValue(null), updateChapters: jest.fn() }));
jest.mock('@/lib/api/playlists', () => ({ getPlaylistById: jest.fn(), reorderPlaylistVideos: jest.fn() }));
jest.mock('@/lib/api/category-suggestion-client', () => ({ getCategorySuggestion: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/errors/reporter', () => ({ reportError: (...a: unknown[]) => mockApi.reportError(...a) }));
jest.mock('@/lib/logger-client', () => ({ logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/auth/client-token', () => ({ fetchClientAuthToken: jest.fn() }));
jest.mock('@/lib/studio/content-client', () => ({
  ...jest.requireActual('@/lib/studio/content-client'),
  fetchContentPage: (...a: unknown[]) => mockApi.fetchContentPage(...a),
  fetchContentCounts: jest.fn().mockResolvedValue({ published: 0, scheduled: 1, drafts: 0, processing: 0, failed: 0 }),
}));
jest.mock('next/navigation', () => ({
  usePathname: () => '/en/studio/c1/content/videos', useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }), useSearchParams: () => new URLSearchParams('status=scheduled'), useParams: () => ({ locale: 'en' }),
}));
jest.mock('next/dynamic', () => function mockDynamic() { return () => null; });
jest.mock('next/image', () => ({ __esModule: true, default: () => <span /> }));
jest.mock('@/hooks/useChannelTags', () => ({ useChannelTags: () => [] }));
jest.mock('@/hooks/useCategorySuggestion', () => ({ useCategorySuggestion: () => ({ suggestion: null, pending: false }) }));
jest.mock('@/hooks/useVideoCategories', () => ({ useVideoCategories: () => ({ active: [], all: [] }) }));
jest.mock('@/hooks/useFeatures', () => ({ useFeatures: () => ({ ready: true, features: { upload: true, bulkSchedule: true } }), refreshFeatures: jest.fn() }));
jest.mock('@/hooks/useMultiAccount', () => ({ useMultiAccount: () => ({ user: { channels: [{ id: 'c1', name: 'Noor' }] } }) }));
jest.mock('@/hooks/useChannelPlaylists', () => ({ useChannelPlaylists: () => ({ playlists: [], loading: false, failed: false, create: jest.fn() }) }));
jest.mock('@/components/AuthProvider/authContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('@/components/videoUpload/CategorySelector', () => ({ CategorySelector: () => null }));
jest.mock('@/components/videoPreview/index', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/videoPreview/rtl/index', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/videoEdit/ThumbnailSelector', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/videoEdit/audio/AudioTracksPanel', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/videoEdit/SubtitleUploadSection', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/videoEdit/ChapterEditor', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/videoEdit/ChapterUpload', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/playlists/AddToPlaylistDialog', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/studio/videos/DeletedVideos', () => ({ DeletedVideos: () => null }));
jest.mock('@/components/calendar/ViewSwitcher', () => ({ ViewSwitcher: () => null }));
jest.mock('@/components/calendar/CalendarControls', () => ({ CalendarControls: () => null }));

const refuse = (m: jest.Mock) => m.mockResolvedValueOnce(refusal);
const tomorrow = new Date(Date.now() + 86_400_000);
const day = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

beforeEach(() => {
  jest.clearAllMocks();
  Object.values(mockApi).forEach((m) => m.mockReset());
});

describe('the video editor', () => {
  const onSave = jest.fn();
  const save = {
    act: () => {
      render(<VideoEdit video={{ id: 'v1', title: 'Lesson', channelId: 'c1', isPublic: true, isDraft: true } as never} userId="u1" channelId="c1" onSave={onSave} onCancel={jest.fn()} />);
      fireEvent.change(screen.getByTestId('video-edit-title-en'), { target: { value: 'Lesson one' } });
      fireEvent.click(screen.getByTestId('video-edit-save'));
    },
    call: mockApi.updateVideo, refuse, ok: (m: jest.Mock) => m.mockResolvedValue({ success: true, result: { video: { id: 'v1' } } }), review: 'video-edit-review-terms',
  };
  it('asks once, keeps what was typed, and saves it after accepting', async () => {
    await asksOnceAndGoesOn(save);
    expect(mockApi.updateVideo.mock.calls[1][1]).toMatchObject({ titleLocalized: { en: 'Lesson one' } });
    expect(await screen.findByTestId('video-edit-success')).toBeInTheDocument();
    expect(onSave).toHaveBeenCalledWith({ id: 'v1' });
  });
  it('says so, without a loop, when it is refused again', () => doesNotAskInALoop(save));
  it('any other failure is its own message, with no Terms', async () => {
    mockApi.updateVideo.mockResolvedValue({ success: false, code: 'thumbnail_shape' });
    await save.act();
    expect(await screen.findByTestId('video-edit-error')).not.toHaveAttribute('data-code');
    expect(modal()).toBeNull();
  });
});

describe('the editor’s schedule', () => {
  const open = () => render(<ScheduleSection videoId="v1" channelId="c1" isPublic={false} scheduledPublishDate={tomorrow.toISOString()} scheduledPublishStatus="scheduled" />);
  const schedule = {
    act: () => {
      render(<ScheduleSection videoId="v1" channelId="c1" isPublic={false} />);
      fireEvent.change(screen.getByTestId('edit-schedule-date'), { target: { value: day } });
      fireEvent.change(screen.getByTestId('edit-schedule-time'), { target: { value: '10:30' } });
      fireEvent.click(screen.getByTestId('edit-schedule-submit'));
    },
    call: mockApi.scheduleVideo, refuse, ok: (m: jest.Mock) => m.mockResolvedValue({ success: true, result: { status: 'scheduled' } }), review: 'edit-schedule-review-terms',
  };
  it('schedules after accepting', async () => {
    await asksOnceAndGoesOn(schedule);
    expect(await screen.findByTestId('edit-schedule-success')).toBeInTheDocument();
  });
  it('does not loop', () => doesNotAskInALoop(schedule));
  it('publishes now after accepting', async () => {
    await asksOnceAndGoesOn({
      act: () => { open(); fireEvent.click(screen.getByTestId('edit-schedule-publish-now')); },
      call: mockApi.publishNow, refuse, ok: (m) => m.mockResolvedValue({ success: true }), review: 'edit-schedule-review-terms',
    });
    expect(mockApi.scheduleVideo).not.toHaveBeenCalled();
  });
});

describe('the scheduled list', () => {
  const onRefresh = jest.fn();
  const publish = {
    act: async () => {
      render(<ScheduledVideosList videos={[{ id: 'v1', title: 'Lesson', channelId: 'c1', scheduledPublishDate: tomorrow.toISOString(), scheduledPublishStatus: 'scheduled' } as never]} isLoading={false} onRefresh={onRefresh} />);
      fireEvent.click(screen.getByTestId('scheduled-video-publish-now'));
      fireEvent.click(await screen.findByTestId('publish-now-dialog-confirm'));
    },
    call: mockApi.publishNow, refuse, ok: (m: jest.Mock) => m.mockResolvedValue({ success: true }), review: 'scheduled-videos-review-terms',
  };
  it('publishes the same video after accepting, without confirming again, and reads the list again', async () => {
    await asksOnceAndGoesOn(publish);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('scheduled-videos-action-error')).toBeNull();
  });
  it('does not loop', () => doesNotAskInALoop(publish));
});

describe('Studio’s videos', () => {
  const publish = {
    act: async () => {
      mockApi.fetchContentPage.mockResolvedValue({ items: [{ id: 'a', title: 'Lesson', dateCreated: '2026-01-01T00:00:00.000Z', views: 0, commentsCount: 0, likesCount: 0, isPublic: false, studioStatus: 'scheduled', scheduledPublishStatus: 'scheduled', scheduledPublishDate: tomorrow.toISOString() }], cursor: null });
      render(<QueryClientProvider client={new QueryClient()}><VideosTab locale="en" channelId="c1" role="owner" /></QueryClientProvider>);
      const row = await screen.findByTestId('studio-video-row');
      fireEvent.keyDown(within(row).getByTestId('studio-video-actions'), { key: 'Enter' });
      fireEvent.click(await screen.findByTestId('studio-video-action-publishNow'));
    },
    call: mockApi.publishNow, refuse, ok: (m: jest.Mock) => m.mockResolvedValue({ success: true }), review: 'studio-videos-review-terms',
  };
  it('publishes the same video after accepting and says it is published', async () => {
    await asksOnceAndGoesOn(publish);
    expect(await screen.findByText(mockEn.studio.videos.done.published)).toBeInTheDocument();
  });
  it('does not loop', () => doesNotAskInALoop(publish));
});

describe('bulk scheduling', () => {
  const onDone = jest.fn();
  const schedule = {
    act: () => {
      render(<BulkScheduleDialog open videoIds={['a', 'b']} onOpenChange={jest.fn()} onDone={onDone} />);
      fireEvent.change(document.getElementById('studio-bulk-start')!, { target: { value: `${day}T10:30` } });
      fireEvent.click(screen.getByTestId('studio-bulk-schedule-submit'));
    },
    call: mockApi.bulkScheduleVideos, refuse: (m: jest.Mock) => m.mockResolvedValueOnce({ termsRequired: true }), ok: (m: jest.Mock) => m.mockResolvedValue({ succeeded: 2, failed: 0 }), review: 'studio-bulk-schedule-review-terms',
  };
  it('stays open with its values, and schedules them after accepting', async () => {
    await asksOnceAndGoesOn(schedule);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith({ succeeded: 2, failed: 0 });
  });
  it('does not loop', () => doesNotAskInALoop(schedule));
  it('closed and opened again, it no longer says it was refused', async () => {
    const onOpenChange = jest.fn();
    mockApi.bulkScheduleVideos.mockResolvedValueOnce({ termsRequired: true });
    render(<BulkScheduleDialog open videoIds={['a']} onOpenChange={onOpenChange} onDone={onDone} />);
    fireEvent.change(document.getElementById('studio-bulk-start')!, { target: { value: `${day}T10:30` } });
    fireEvent.click(screen.getByTestId('studio-bulk-schedule-submit'));
    fireEvent.click(await screen.findByTestId('creator-terms-cancel'));
    expect(await screen.findByTestId('studio-bulk-schedule-terms')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: mockEn.studio.videos.bulkSchedule.cancel }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByTestId('studio-bulk-schedule-terms')).toBeNull();
  });
});

describe('an audio track', () => {
  const onDone = jest.fn();
  const add = {
    act: () => {
      render(
        <AudioTrackDialog videoId="v1" track={null} lang="en" spokenLanguage="ar" t={mockEn.audioTracks} onDone={onDone} onClose={jest.fn()} onDetect={jest.fn()}
          view={{ tracks: [{ id: 'o', language: 'ar', label: 'العربية', kind: 'original', isDefault: true, state: 'ready', source: 'original', createdAt: 'x' }], package: { status: 'ready', playing: true }, limit: { allowed: 3, used: 0, unlimited: false }, detected: [{ index: 0 }, { index: 1 }], detecting: false, ready: true } as never} />,
      );
      fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(['x'], 'dub.m4a', { type: 'audio/mp4' })] } });
      fireEvent.click(screen.getByTestId('audio-track-submit'));
    },
    call: mockApi.addAudioTrack, refuse: (m: jest.Mock) => m.mockResolvedValueOnce({ ok: false, status: 403, error: 'terms_required', details: { code: 'terms_required' } }), ok: (m: jest.Mock) => m.mockResolvedValue({ ok: true, data: { track: { id: 't1' } } }), review: 'audio-track-review-terms',
  };
  it('is added after accepting, with its file', async () => {
    await asksOnceAndGoesOn(add);
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ type: 'added', track: { id: 't1' }, file: expect.any(File) }));
    expect(mockApi.reportError).not.toHaveBeenCalled();
  });
  it('does not loop', () => doesNotAskInALoop(add));
});

describe('editing selected videos', () => {
  const videos = ['v1', 'v2', 'v3'].map((id) => ({ id, title: id, channelId: id === 'v3' ? 'other' : 'ch' }));
  const row = (id: string, code?: string) => (code ? { videoId: id, success: false, code } : { videoId: id, success: true, changed: true });
  const answer = (...rows: object[]) => ({ success: true, results: rows });
  const apply = () => {
    fireEvent.click(screen.getByTestId('bulk-edit-tick-visibility'));
    fireEvent.click(screen.getByTestId('bulk-edit-review'));
    fireEvent.click(screen.getByTestId('bulk-edit-apply'));
  };
  const open = () => render(<BulkEditPanel open onOpenChange={jest.fn()} videos={videos as never} />);
  const result = () => screen.getByTestId('bulk-edit-result');

  it('edits only what the Terms refused after accepting, and keeps the rest of the result', async () => {
    mockApi.bulkEditVideos
      .mockResolvedValueOnce(answer(row('v1', 'terms_required'), row('v2', 'forbidden')))
      .mockResolvedValueOnce(answer(row('v3')))
      .mockResolvedValueOnce(answer(row('v1')));
    open();
    apply();
    await waitFor(() => expect(modal()).toBeInTheDocument());
    expect(screen.getByTestId('bulk-edit-terms')).toHaveTextContent(mockEn.creator.termsRequired);
    await accept();
    await waitFor(() => expect(mockApi.bulkEditVideos).toHaveBeenCalledTimes(3));
    expect(mockApi.bulkEditVideos.mock.calls[2][0].ids).toEqual(['v1']);
    expect(mockApi.bulkEditVideos.mock.calls[2][0].operationId).toBe(mockApi.bulkEditVideos.mock.calls[0][0].operationId);
    await waitFor(() => expect([result().dataset.succeeded, result().dataset.failed]).toEqual(['2', '1']));
    expect(screen.queryByTestId('bulk-edit-review-terms')).toBeNull();
    expect(mockApi.reportError).not.toHaveBeenCalled();
  });

  it('refused for every video is not reported as a failure, and is not asked in a loop', async () => {
    mockApi.bulkEditVideos.mockImplementation(async ({ ids }: { ids: string[] }) => answer(...ids.map((id) => row(id, 'terms_required'))));
    open();
    apply();
    await waitFor(() => expect(modal()).toBeInTheDocument());
    await accept();
    await waitFor(() => expect(mockApi.bulkEditVideos).toHaveBeenCalledTimes(4));
    expect(await screen.findByTestId('bulk-edit-review-terms')).toBeInTheDocument();
    expect(modal()).toBeNull();
    expect(mockApi.reportError).not.toHaveBeenCalled();
  });

  it('every other failure still is reported', async () => {
    mockApi.bulkEditVideos.mockImplementation(async ({ ids }: { ids: string[] }) => answer(...ids.map((id, i) => row(id, i === 0 ? 'failed' : 'terms_required'))));
    open();
    apply();
    await waitFor(() => expect(mockApi.reportError).toHaveBeenCalledTimes(1));
  });

  it('an undo that was refused says nothing was undone, stays, and goes again after accepting', async () => {
    mockApi.bulkEditVideos.mockImplementation(async ({ ids }: { ids: string[] }) => answer(...ids.map((id) => row(id))));
    mockApi.undoBulkEdit.mockImplementationOnce(async (_op: string, ids: string[]) => answer(...ids.map((id) => row(id, 'terms_required'))));
    mockApi.undoBulkEdit.mockImplementation(async (_op: string, ids: string[]) => answer(...ids.map((id) => row(id))));
    open();
    apply();
    fireEvent.click(await screen.findByTestId('bulk-edit-undo'));
    await waitFor(() => expect(modal()).toBeInTheDocument());
    expect(screen.queryByTestId('bulk-edit-undone')).toBeNull();
    fireEvent.click(screen.getByTestId('creator-terms-cancel'));
    await waitFor(() => expect(modal()).toBeNull());
    expect(screen.getByTestId('bulk-edit-undo')).toBeInTheDocument();
    const before = mockApi.undoBulkEdit.mock.calls.length;
    fireEvent.click(screen.getByTestId('bulk-edit-review-terms'));
    await accept();
    expect(await screen.findByTestId('bulk-edit-undone')).toHaveAttribute('data-restored', '3');
    expect(mockApi.undoBulkEdit.mock.calls.length).toBe(before * 2);
    expect(screen.queryByTestId('bulk-edit-undo')).toBeNull();
    await act(async () => undefined);
  });
});
