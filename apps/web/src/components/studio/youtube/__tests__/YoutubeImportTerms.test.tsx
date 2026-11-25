/** Move from YouTube while the creator Terms are not accepted (#1929): the queue waits, is asked about once, and goes on. */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { EN_TRANSLATIONS as mockEn, type YtImport } from '@al-ummah/shared-types';
import { item } from '@/lib/youtube-import/__tests__/fixtures';
import { accept, modal } from '@/components/legal/__tests__/terms-testkit';
import { YoutubeImportTab } from '../YoutubeImportTab';

const mockApi = { getImportStatus: jest.fn(), getImport: jest.fn(), initiate: jest.fn(), complete: jest.fn(), cancelImport: jest.fn(), saveMatches: jest.fn(), startImport: jest.fn() };
const mockT = { ...mockEn };
let mockTermsAccepted: boolean | undefined = false;
const mockMark = jest.fn();
jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: mockT, lang: 'en', locale: 'en', dir: 'ltr', isRTL: false }) }));
jest.mock('@/lib/youtube-import/api', () => ({
  ...jest.requireActual('@/lib/youtube-import/api'),
  getImportStatus: (...a: unknown[]) => mockApi.getImportStatus(...a), getImport: (...a: unknown[]) => mockApi.getImport(...a), cancelImport: (...a: unknown[]) => mockApi.cancelImport(...a),
  saveMatches: (...a: unknown[]) => mockApi.saveMatches(...a), startImport: (...a: unknown[]) => mockApi.startImport(...a),
}));
jest.mock('@/lib/api/upload-client', () => ({ initiateVideoUpload: (...a: unknown[]) => mockApi.initiate(...a), completeVideoUpload: (...a: unknown[]) => mockApi.complete(...a) }));
jest.mock('@/lib/upload/resilient-tus', () => ({
  ResilientUpload: class { constructor(private o: { onSuccess: () => void }) {} async start() { this.o.onSuccess(); } async abort() { return undefined; } },
  tusEndpointFor: () => 'https://api.example.test/tus', grantedUploadUrl: jest.fn(), reportUploadFailure: jest.fn(), requestUploadResume: jest.fn(),
}));
jest.mock('@/lib/upload/fingerprint', () => ({ tryFileFingerprint: jest.fn().mockResolvedValue('fp') }));
jest.mock('@/lib/runtime-config', () => ({ getApiUrl: () => 'https://api.example.test', getWwwUrl: () => 'https://www.example.test' }));
jest.mock('@/lib/auth/client-token', () => ({ fetchClientAuthToken: jest.fn(), getClientAuthHeaders: jest.fn() }));
jest.mock('@/components/common/AppLink', () => ({ __esModule: true, default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), warn: jest.fn(), debug: jest.fn(), info: jest.fn() } }));
jest.mock('@/lib/errors/reporter', () => ({ reportError: jest.fn(() => 'ERR-TEST-0001') }));
jest.mock('@/lib/share/short-link', () => ({ shareLink: () => 'https://alummahnow.link/v/x' }));
jest.mock('@/hooks/useCreatorAccess', () => ({
  useCreatorAccess: () => ({ status: 'ready', access: { termsAccepted: mockTermsAccepted, termsVersion: '2026-11-24' } }),
  needsCreatorTerms: (c: { access: { termsAccepted?: boolean } }) => c.access.termsAccepted === false,
  markCreatorTermsRequired: () => mockMark(),
  acceptCreatorTerms: jest.fn().mockResolvedValue({ ok: true }),
}));

const text = mockEn.studio.youtube;
const imp: YtImport = {
  id: 'imp1', channelId: 'c1', userId: 'u1', status: 'importing', ytChannel: { id: 'UC1', title: 'Fajr', thumbnailUrl: null, videoCount: 2 }, captions: false, visibilityMode: 'keep', connected: true, error: null,
  counts: { videos: 2, selected: 2, matched: 2, uploading: 0, processing: 0, ready: 0, failed: 0, playlists: 0 }, createdAt: '', updatedAt: '', finishedAt: null,
};
const video = (id: string) => item(id, { selected: true, state: 'selected', match: { zipName: '', entryName: `${id}.mp4`, fileName: `${id}.mp4`, size: 4, by: 'id' } as never });
const refused = { success: false, status: 403, code: 'terms_required', error: 'x' };
const phases = () => screen.getAllByTestId('yt-progress-row').map((el) => el.dataset.phase);

/** The server's copy is new at every poll, as it is for real. */
const poll = () => act(async () => { await jest.advanceTimersByTimeAsync(5_100); });

async function open(ids: string[]) {
  mockApi.getImportStatus.mockResolvedValue({ ready: true, captionsAvailable: false, import: imp });
  mockApi.getImport.mockImplementation(async () => ({ import: { ...imp }, items: ids.map(video), playlists: [] }));
  render(<YoutubeImportTab locale="en" channelId="c1" channelHandle={null} />);
  await act(async () => { await jest.advanceTimersByTimeAsync(50); });
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  await act(async () => {
    fireEvent.change(input, { target: { files: ids.map((id) => new File(['data'], `${id}.mp4`, { type: 'video/mp4' })) } });
    await jest.advanceTimersByTimeAsync(50);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  Object.values(mockApi).forEach((m) => m.mockReset());
  mockTermsAccepted = false;
  mockApi.complete.mockResolvedValue({ success: true });
});
afterEach(() => jest.useRealTimers());

it('asks once, stays dismissed through every poll, and goes on with the same files after accepting', async () => {
  mockApi.initiate.mockResolvedValue(refused);
  await open(['a', 'b', 'c']);
  expect(modal()).toBeInTheDocument();
  expect(mockMark).toHaveBeenCalledTimes(1);
  const sent = mockApi.initiate.mock.calls.length;
  expect(sent).toBeLessThanOrEqual(2);
  fireEvent.click(screen.getByTestId('creator-terms-cancel'));
  for (let i = 0; i < 4; i++) {
    await poll();
    expect(modal()).toBeNull();
  }
  expect(mockMark).toHaveBeenCalledTimes(1);
  expect(mockApi.initiate).toHaveBeenCalledTimes(sent);
  // Waiting: nothing failed, nothing is done, and it can still be cancelled
  expect(phases()).toEqual(['paused', 'paused', 'waiting']);
  expect(screen.queryByTestId('yt-done')).toBeNull();
  expect(screen.queryByTestId('yt-retry')).toBeNull();
  expect(screen.getByTestId('yt-cancel')).toBeInTheDocument();
  expect(screen.getByTestId('yt-progress-summary')).toHaveTextContent('0 failed, 3 waiting');
  expect(screen.getAllByTestId('yt-phase')[0]).toHaveTextContent(text.progress.paused);
  expect(screen.getByTestId('yt-terms-paused-banner')).toBeInTheDocument();

  fireEvent.click(screen.getAllByTestId('yt-row-review-terms')[0]);
  expect(modal()).toBeInTheDocument();
  fireEvent.click(screen.getByTestId('creator-terms-cancel'));
  fireEvent.click(screen.getByTestId('yt-review-terms'));
  mockApi.initiate.mockImplementation(async (req: { youtubeImport: { itemId: string } }) => ({ success: true, result: { videoId: `v-${req.youtubeImport.itemId}`, tusSessionId: 's' } }));
  await accept();
  await act(async () => { await jest.advanceTimersByTimeAsync(50); });
  expect(screen.queryByTestId('yt-terms-paused-banner')).toBeNull();
  expect(phases()).toEqual(['processing', 'processing', 'processing']);
  expect(modal()).toBeNull();
});

it.each([1, 2])('is never shown as finished while only %i refused videos are left', async (count) => {
  mockApi.initiate.mockResolvedValue(refused);
  await open(['a', 'b'].slice(0, count));
  await poll();
  expect(screen.getByTestId('yt-import')).not.toHaveAttribute('data-done');
  expect(screen.queryByText(text.done.heading)).toBeNull();
  expect(screen.queryByTestId('yt-new-import')).toBeNull();
});

it('a poll while the acceptance is being saved neither asks again nor restarts anything', async () => {
  mockApi.initiate.mockResolvedValue(refused);
  await open(['a']);
  const { acceptCreatorTerms } = jest.requireMock('@/hooks/useCreatorAccess');
  let saved!: (r: { ok: true }) => void;
  acceptCreatorTerms.mockReturnValueOnce(new Promise((r) => { saved = r; }));
  fireEvent.click(screen.getByTestId('creator-terms-checkbox'));
  fireEvent.click(screen.getByTestId('creator-terms-agree'));
  await poll();
  await poll();
  expect(mockMark).toHaveBeenCalledTimes(1);
  mockApi.initiate.mockResolvedValue({ success: true, result: { videoId: 'v', tusSessionId: 's' } });
  await act(async () => { saved({ ok: true }); await jest.advanceTimersByTimeAsync(50); });
  expect(modal()).toBeNull();
  expect(screen.queryByTestId('creator-terms-error')).toBeNull();
  expect(phases()).toEqual(['processing']);
});

it('goes on by itself once when the account says accepted, and never in a loop with a server that refuses', async () => {
  mockTermsAccepted = true;
  mockApi.initiate.mockResolvedValue(refused);
  await open(['a']);
  for (let i = 0; i < 5; i++) await poll();
  expect(mockApi.initiate).toHaveBeenCalledTimes(2);
  expect(phases()).toEqual(['paused']);
  expect(screen.getByTestId('yt-terms-paused-banner')).toBeInTheDocument();
});

it('a later pause shows the banner without opening the dialog again', async () => {
  mockApi.initiate.mockResolvedValue(refused);
  await open(['a']);
  await accept();
  await act(async () => { await jest.advanceTimersByTimeAsync(50); });
  expect(mockApi.initiate).toHaveBeenCalledTimes(2);
  expect(modal()).toBeNull();
  expect(screen.getByTestId('yt-terms-paused-banner')).toBeInTheDocument();
});

it('cancelling the import forgets the pause', async () => {
  mockApi.initiate.mockResolvedValue(refused);
  mockApi.cancelImport.mockResolvedValue(undefined);
  await open(['a']);
  fireEvent.click(screen.getByTestId('creator-terms-cancel'));
  fireEvent.click(screen.getByTestId('yt-cancel'));
  await act(async () => { fireEvent.click(screen.getByTestId('yt-cancel-dialog-confirm')); await jest.advanceTimersByTimeAsync(50); });
  expect(screen.getByTestId('yt-notice')).toHaveTextContent(text.progress.cancelled);
  expect(modal()).toBeNull();
});
