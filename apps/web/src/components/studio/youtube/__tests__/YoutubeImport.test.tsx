/**
 * Studio → Move from YouTube (wiki AUN-YT-IMPORT): the feature-off state,
 * Google's ?error= codes, choosing videos (the selection payload), and how the
 * Import step shows each item's state.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { STUDIO_EN, type YtFileMatch, type YtImport } from '@al-ummah/shared-types';
import { item } from '@/lib/youtube-import/__tests__/fixtures';
import type { LiveState } from '@/lib/youtube-import/wizard';
import { ImportStep } from '../ImportStep';
import { YoutubeImportTab } from '../YoutubeImportTab';

const getImportStatus = jest.fn();
const getImport = jest.fn();
const saveSelection = jest.fn();
const startOAuth = jest.fn();

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: { studio: mockStudio, confirmDialog: { typeToConfirm: 'Type {value}' }, common: { cancel: 'Cancel' } }, lang: 'en', locale: 'en', isRTL: false }),
}));
jest.mock('@/lib/youtube-import/api', () => {
  const actual = jest.requireActual('@/lib/youtube-import/api');
  return {
    ...actual,
    getImportStatus: (...a: unknown[]) => getImportStatus(...a),
    getImport: (...a: unknown[]) => getImport(...a),
    saveSelection: (...a: unknown[]) => saveSelection(...a),
    startOAuth: (...a: unknown[]) => startOAuth(...a),
  };
});
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));
jest.mock('@/components/common/AppLink', () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), warn: jest.fn(), debug: jest.fn(), info: jest.fn() } }));
jest.mock('@/lib/errors/reporter', () => ({ reportError: jest.fn(() => 'ERR-TEST-0001') }));
jest.mock('@/lib/share/short-link', () => ({ shareLink: (t: { id: string }) => `https://alummahnow.link/v/${t.id}` }));

const mockStudio = STUDIO_EN;
const text = STUDIO_EN.youtube;

const imp = (status: YtImport['status']): YtImport => ({
  id: 'imp1', channelId: 'c1', userId: 'u1', status, ytChannel: { id: 'UC1', title: 'قناة الفجر', thumbnailUrl: null, videoCount: 3 }, captions: false, visibilityMode: 'keep', connected: true, error: null,
  counts: { videos: 3, selected: 0, matched: 0, uploading: 0, processing: 0, ready: 0, failed: 0, playlists: 0 },
  createdAt: '', updatedAt: '', finishedAt: null,
});

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/en/studio/c1/content/youtube');
});

describe('YoutubeImportTab', () => {
  it('says the feature is off when the site has no Google connection', async () => {
    getImportStatus.mockResolvedValue({ ready: false, captionsAvailable: false, import: null });
    render(<YoutubeImportTab locale="en" channelId="c1" channelHandle={null} />);
    expect(await screen.findByTestId('yt-off')).toHaveTextContent(text.off.title);
    expect(screen.queryByTestId('yt-connect-button')).toBeNull();
  });

  it("shows Google's refusal from ?error= on the Connect step, and connects with captions when opted in (off by default)", async () => {
    window.history.replaceState(null, '', '/en/studio/c1/content/youtube?error=youtube_denied');
    getImportStatus.mockResolvedValue({ ready: true, captionsAvailable: true, import: null });
    startOAuth.mockReturnValue(new Promise(() => undefined));
    render(<YoutubeImportTab locale="en" channelId="c1" channelHandle={null} />);
    expect(await screen.findByTestId('yt-connect-error')).toHaveTextContent(text.errors.youtube_denied);
    expect(screen.getByTestId('yt-captions')).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByTestId('yt-captions'));
    fireEvent.click(screen.getByTestId('yt-connect-button'));
    expect(startOAuth).toHaveBeenCalledWith('c1', true, 'en');
    expect(screen.getByTestId('yt-connect-button')).toHaveTextContent(text.connect.connecting);
  });

  it('chooses videos and a playlist, then saves the full selection', async () => {
    const items = [item('a', { title: 'محاضرة الفجر' }), item('b', { state: 'imported' }), item('c')];
    const playlists = [{ ytPlaylistId: 'PL1', title: 'Series', description: '', ytVisibility: 'public' as const, ytVideoIds: [items[2]!.ytVideoId], selected: false, playlistId: null, state: 'none' as const }];
    getImportStatus.mockResolvedValue({ ready: true, captionsAvailable: true, import: imp('ready') });
    getImport.mockResolvedValue({ import: imp('ready'), items, playlists });
    saveSelection.mockResolvedValue(imp('ready'));
    render(<YoutubeImportTab locale="en" channelId="c1" channelHandle={null} />);
    const rows = await screen.findAllByTestId('yt-video-row');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveAttribute('data-disabled', 'true');
    expect(screen.getByTestId('yt-imported')).toHaveTextContent(text.pick.imported);

    // Nothing chosen: a hint, no call
    fireEvent.click(screen.getByTestId('yt-pick-next'));
    expect(screen.getByRole('alert')).toHaveTextContent(text.pick.nothingSelected);
    expect(saveSelection).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByTestId('yt-video-check')[0]!);
    fireEvent.mouseDown(screen.getByTestId('yt-tab-playlists'));
    fireEvent.click(await screen.findByTestId('yt-playlist-recreate'));
    fireEvent.click(screen.getByTestId('yt-playlist-select'));
    fireEvent.click(screen.getByTestId('yt-vis-private'));
    expect(screen.getByTestId('yt-selected-count')).toHaveTextContent('2 of 2 selected');
    await act(async () => {
      fireEvent.click(screen.getByTestId('yt-pick-next'));
    });
    expect(saveSelection).toHaveBeenCalledWith('imp1', { itemIds: ['a', 'c'], playlistIds: ['PL1'], visibilityMode: 'private' });
    await waitFor(() => expect(screen.getByTestId('yt-files')).toBeInTheDocument());
    expect(document.activeElement).toBe(screen.getByTestId('yt-step-heading'));
  });
});

describe('ImportStep', () => {
  const match: YtFileMatch = { zipName: 'takeout-001.zip', entryName: 'v.mp4', fileName: 'v.mp4', size: 1, by: 'id' };
  const items = [
    item('up', { title: 'Uploading one', selected: true, match, state: 'uploading', videoId: 'v1' }),
    item('fail', { title: 'Failed one', selected: true, match, state: 'failed', videoId: 'v2' }),
    item('ready', { title: 'درس', selected: true, match, state: 'ready', videoId: 'v3', thumbnail: 'done', captions: 'waiting_quota' }),
    item('wait', { title: 'Waiting one', selected: true, match, state: 'selected' }),
  ];
  const live = new Map<string, LiveState>([['up', { phase: 'uploading', percent: 37 }], ['fail', { phase: 'failed', errorCode: 'upload_limit' }]]);
  const props = {
    locale: 'en', current: imp('importing'), items, live, counts: { ready: 1, active: 1, failed: 1, waiting: 1, total: 4 }, retrying: new Set<string>(),
    onCancel: jest.fn(), resume: null, channelHref: '/en/@fajr', contentHref: '/en/studio/c1/content/videos', shortUrl: (id: string) => `https://alummahnow.link/v/${id}`,
    onDownloadCsv: jest.fn(), onNewImport: jest.fn(), notice: '',
  };

  it('shows each state: uploading %, failed with Try again, ready with caption quota, waiting', () => {
    const onRetry = jest.fn();
    render(<ImportStep {...props} done={false} onRetry={onRetry} />);
    const phases = screen.getAllByTestId('yt-phase').map((el) => el.textContent);
    expect(phases).toEqual(['Uploading 37%', text.progress.failed, text.progress.ready, text.progress.waiting]);
    expect(screen.getByTestId('yt-row-error')).toHaveTextContent(text.progress.errors.upload_limit);
    expect(screen.getByTestId('yt-captions-step')).toHaveTextContent(`${text.progress.captions}: ${text.progress.step.waiting_quota}`);
    expect(screen.getByTestId('yt-quota-note')).toHaveTextContent(text.progress.quotaNote);
    expect(screen.getByTestId('yt-progress-summary')).toHaveTextContent('1 ready, 1 in progress, 1 failed, 1 waiting');
    fireEvent.click(screen.getByTestId('yt-retry'));
    expect(onRetry).toHaveBeenCalledWith(items[1]);
    expect(screen.getByTestId('yt-cancel')).toBeInTheDocument();
  });

  it('shows the summary with the link-back kit when done', () => {
    render(<ImportStep {...props} done onRetry={jest.fn()} />);
    expect(screen.getByTestId('yt-done-summary')).toHaveTextContent('1 videos imported, 1 failed.');
    expect(screen.getByTestId('yt-view-channel')).toHaveAttribute('href', '/en/@fajr');
    expect(screen.getAllByTestId('yt-link-back-row')).toHaveLength(1);
    expect(screen.getByTestId('yt-link-back-row')).toHaveTextContent('Also on Al Ummah Now: https://alummahnow.link/v/v3');
    fireEvent.click(screen.getByTestId('yt-download-csv'));
    expect(props.onDownloadCsv).toHaveBeenCalled();
    expect(screen.queryByTestId('yt-cancel')).toBeNull();
  });
});
