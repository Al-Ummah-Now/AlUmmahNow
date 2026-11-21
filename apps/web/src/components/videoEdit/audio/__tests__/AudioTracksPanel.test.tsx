/**
 * Studio's Audio tracks panel (wiki AUN-MULTI-AUDIO §Studio): the model (status, limit, file
 * checks), the chunked upload loop, and the panel's list, limit, add and delete flows.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AUDIO_TRACKS_AR, AUDIO_TRACKS_EN } from '@al-ummah/shared-types';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', isRTL: false }),
}));
let mockFeatures: Record<string, boolean> = {};
const mockRefreshFeatures = jest.fn(async () => undefined);
jest.mock('@/hooks/useFeatures', () => ({ useFeatures: () => ({ ready: true, features: mockFeatures }), refreshFeatures: (...a: unknown[]) => mockRefreshFeatures(...(a as [])) }));
jest.mock('@/lib/errors/reporter', () => ({ reportError: jest.fn(() => 'ref') }));
jest.mock('@/lib/auth/client-token', () => ({ fetchClientAuthToken: jest.fn(async () => 'tok') }));
jest.mock('@/lib/runtime-config', () => ({ getApiUrl: () => 'https://api.test' }));

const listAudioTracks = jest.fn();
const addAudioTrack = jest.fn();
const deleteAudioTrack = jest.fn();
const updateAudioTrack = jest.fn();
const completeAudioTrack = jest.fn();
const send = jest.fn();
jest.mock('@/lib/api/audio-tracks', () => {
  const actual = jest.requireActual('@/lib/api/audio-tracks');
  return {
    ...actual,
    listAudioTracks: (...a: unknown[]) => listAudioTracks(...a),
    addAudioTrack: (...a: unknown[]) => addAudioTrack(...a),
    deleteAudioTrack: (...a: unknown[]) => deleteAudioTrack(...a),
    updateAudioTrack: (...a: unknown[]) => updateAudioTrack(...a),
    completeAudioTrack: (...a: unknown[]) => completeAudioTrack(...a),
    retryAudioTrack: jest.fn(),
    detectAudioStreams: jest.fn(async () => ({ ok: true, data: {} })),
    chunkSender: () => send,
  };
});

import { uploadAudioFile, type AudioTracksView, type StudioAudioTrack } from '@/lib/api/audio-tracks';
import { addLimitMessage, fileProblem, stateTone, streamText, trackStatusText, uploadPercent } from '../audio-track-model';
import AudioTracksPanel from '../AudioTracksPanel';

const ORIG: StudioAudioTrack = { id: 'orig', language: 'ar', label: 'العربية', kind: 'original', isDefault: true, state: 'ready', source: 'original', createdAt: 'x' };
const EN: StudioAudioTrack = { id: 'ten1234567890', language: 'en', label: 'English', kind: 'dub', isDefault: false, state: 'ready', source: 'upload', bytes: 100, createdAt: 'x' };
const view = (over: Partial<AudioTracksView> = {}): AudioTracksView => ({
  tracks: [ORIG, EN],
  package: { status: 'ready', playing: true },
  limit: { allowed: 3, used: 1, unlimited: false },
  detected: null,
  detecting: false,
  ready: true,
  ...over,
});
const ok = <T,>(data: T) => ({ ok: true as const, data });

beforeEach(() => {
  jest.clearAllMocks();
  mockFeatures = { audioTracks: true };
});

describe('audio track model', () => {
  it('words each state, with the reason for failed and rejected tracks', () => {
    expect(trackStatusText({ state: 'uploading' }, AUDIO_TRACKS_EN, {}, 42).label).toBe('Uploading 42%');
    expect(trackStatusText({ state: 'failed', error: 'unreadable_file' }, AUDIO_TRACKS_EN, {}, null)).toEqual({ label: 'Failed', detail: 'No audio could be read from this file.' });
    expect(trackStatusText({ state: 'failed', error: 'weird' }, AUDIO_TRACKS_EN, {}, null).detail).toBe('This track could not be prepared.');
    expect(trackStatusText({ state: 'rejected', reasonCode: 'hate' }, AUDIO_TRACKS_EN, { hate: 'hate speech', other: 'x' }, null, 'Not approved: {reason}')).toEqual({
      label: 'Not approved',
      detail: 'Not approved: hate speech',
    });
    expect(stateTone('ready')).toBe('good');
    expect(stateTone('rejected')).toBe('bad');
    expect(stateTone('in_review')).toBe('neutral');
  });

  it('shows this tab’s upload progress over the stored bytes', () => {
    expect(uploadPercent({ state: 'uploading', bytes: 200, uploadedBytes: 50 })).toBe(25);
    expect(uploadPercent({ state: 'uploading', bytes: 200, uploadedBytes: 50 }, { stored: 150, total: 200 })).toBe(75);
    expect(uploadPercent({ state: 'ready', bytes: 200 })).toBeNull();
  });

  it('states the limit plainly, in both languages (a plan with none never shows Add)', () => {
    expect(addLimitMessage({ limit: { allowed: 0, used: 0, unlimited: false } }, AUDIO_TRACKS_EN)).toBeNull();
    expect(addLimitMessage({ limit: { allowed: 2, used: 2, unlimited: false } }, AUDIO_TRACKS_EN)).toBe('Limit reached (2 per video).');
    expect(addLimitMessage({ limit: { allowed: 2, used: 2, unlimited: false } }, AUDIO_TRACKS_AR)).toContain('2');
    expect(addLimitMessage({ limit: { allowed: 2, used: 1, unlimited: false } }, AUDIO_TRACKS_EN)).toBeNull();
    expect(addLimitMessage({ limit: { allowed: 0, used: 9, unlimited: true } }, AUDIO_TRACKS_EN)).toBeNull();
  });

  it('refuses files that cannot be tracks', () => {
    expect(fileProblem({ name: 'dub.MP3', size: 10 }, AUDIO_TRACKS_EN)).toBeNull();
    expect(fileProblem({ name: 'notes.txt', size: 10 }, AUDIO_TRACKS_EN)).toBe(AUDIO_TRACKS_EN.form.fileType);
    expect(fileProblem({ name: 'big.wav', size: 3 * 1024 ** 3 }, AUDIO_TRACKS_EN)).toBe('This file is larger than 2 GB.');
  });

  it('names a detected stream by number, language and title', () => {
    expect(streamText({ index: 1, language: 'eng', title: 'Dub', channels: 2 }, AUDIO_TRACKS_EN, 'en')).toBe('Track 2 • English • Dub • 2ch');
    expect(streamText({ index: 2 }, AUDIO_TRACKS_EN, 'en')).toBe('Track 3 • —');
  });
});

describe('uploadAudioFile', () => {
  const file = new Blob([new Uint8Array(25)]);
  const noWait = async () => undefined;

  it('sends the file in chunks from the start offset', async () => {
    const offsets: number[] = [];
    const s = jest.fn(async (offset: number, chunk: Blob) => {
      offsets.push(offset);
      return { ok: true as const, offset: offset + chunk.size };
    });
    const progress = jest.fn();
    await expect(uploadAudioFile(file, 10, s, progress, { chunkBytes: 10, wait: noWait })).resolves.toEqual({ ok: true });
    expect(offsets).toEqual([10, 20]);
    expect(progress).toHaveBeenLastCalledWith(25);
  });

  it('moves to the server’s offset on 409 and retries network errors', async () => {
    const s = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 409, offset: 10, error: 'offset_mismatch' })
      .mockResolvedValueOnce({ ok: false, status: 0, error: 'network' })
      .mockImplementation(async (offset: number, chunk: Blob) => ({ ok: true, offset: offset + chunk.size }));
    await expect(uploadAudioFile(file, 0, s, jest.fn(), { chunkBytes: 10, wait: noWait })).resolves.toEqual({ ok: true });
    expect(s.mock.calls.map((c) => c[0])).toEqual([0, 10, 10, 20]);
  });

  it('stops on a refusal, after 3 retries, or when nothing is stored', async () => {
    await expect(uploadAudioFile(file, 0, jest.fn(async () => ({ ok: false as const, status: 403, error: 'forbidden' })), jest.fn(), { chunkBytes: 10, wait: noWait })).resolves.toEqual({
      ok: false,
      error: 'forbidden',
      stored: 0,
    });
    const down = jest.fn(async () => ({ ok: false as const, status: 503, error: 'storage_unavailable' }));
    await expect(uploadAudioFile(file, 0, down, jest.fn(), { chunkBytes: 10, wait: noWait })).resolves.toMatchObject({ ok: false, error: 'storage_unavailable' });
    expect(down).toHaveBeenCalledTimes(4);
    await expect(uploadAudioFile(file, 0, jest.fn(async () => ({ ok: true as const, offset: 0 })), jest.fn(), { chunkBytes: 10, wait: noWait })).resolves.toMatchObject({ error: 'no_progress' });
  });
});

describe('AudioTracksPanel', () => {
  it('lists the tracks with type, status and default, and the usage', async () => {
    listAudioTracks.mockResolvedValue(ok(view()));
    render(<AudioTracksPanel videoId="v1" />);
    const rows = await screen.findAllByTestId('audio-track');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Original')).toBeInTheDocument();
    expect(within(rows[0]!).queryByTestId('audio-track-delete')).toBeNull();
    expect(within(rows[1]!).getByText('Dub')).toBeInTheDocument();
    expect(within(rows[1]!).getByTestId('audio-track-status')).toHaveTextContent('Ready');
    expect(within(rows[0]!).getByTestId('audio-track-default')).toBeChecked();
    expect(screen.getByTestId('audio-tracks-usage')).toHaveTextContent('1 of 3 audio tracks used');
  });

  it('turns Add off and says why at the tier limit or before processing', async () => {
    listAudioTracks.mockResolvedValue(ok(view({ limit: { allowed: 1, used: 1, unlimited: false } })));
    const { unmount } = render(<AudioTracksPanel videoId="v1" />);
    expect(await screen.findByTestId('audio-tracks-limit')).toHaveTextContent('Limit reached (1 per video).');
    expect(screen.getByTestId('audio-track-add')).toBeDisabled();
    unmount();
    listAudioTracks.mockResolvedValue(ok(view({ tracks: [], ready: false, limit: { allowed: 3, used: 0, unlimited: false } })));
    render(<AudioTracksPanel videoId="v1" />);
    expect(await screen.findByTestId('audio-tracks-limit')).toHaveTextContent('finished processing');
    // No invitation to add while adding is off
    expect(screen.queryByTestId('audio-tracks-empty')).not.toBeInTheDocument();
  });

  it('off for the channel with no tracks: no panel at all', async () => {
    mockFeatures = {};
    listAudioTracks.mockResolvedValue(ok(view({ tracks: [], limit: { allowed: 0, used: 0, unlimited: false } })));
    const { container } = render(<AudioTracksPanel videoId="v1" channelId="c1" />);
    await waitFor(() => expect(listAudioTracks).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="audio-tracks"]')).toBeNull();
  });

  it('off with tracks already there: they can be managed, but no Add, count or limit text', async () => {
    mockFeatures = {};
    listAudioTracks.mockResolvedValue(ok(view({ limit: { allowed: 0, used: 1, unlimited: false } })));
    render(<AudioTracksPanel videoId="v1" channelId="c1" />);
    expect(await screen.findAllByTestId('audio-track')).toHaveLength(2);
    expect(screen.queryByTestId('audio-track-add')).toBeNull();
    expect(screen.queryByTestId('audio-tracks-usage')).toBeNull();
    expect(screen.queryByTestId('audio-tracks-limit')).toBeNull();
  });

  it('invites a first track when one can be added', async () => {
    listAudioTracks.mockResolvedValue(ok(view({ tracks: [], limit: { allowed: 3, used: 0, unlimited: false } })));
    render(<AudioTracksPanel videoId="v1" />);
    expect(await screen.findByTestId('audio-tracks-empty')).toBeInTheDocument();
    expect(screen.getByTestId('audio-tracks-usage')).toHaveTextContent('0 of 3 audio tracks used');
  });

  it('adds an uploaded track, sends the file and finishes the upload', async () => {
    listAudioTracks.mockResolvedValue(ok(view({ tracks: [], limit: { allowed: 3, used: 0, unlimited: false } })));
    const added: StudioAudioTrack = { ...EN, id: 'tnew12345678', state: 'uploading', bytes: 5, uploadedBytes: 0 };
    addAudioTrack.mockResolvedValue(ok({ track: added }));
    send.mockImplementation(async (offset: number, chunk: Blob) => ({ ok: true, offset: offset + chunk.size }));
    completeAudioTrack.mockResolvedValue(ok({ track: { ...added, state: 'processing' } }));
    render(<AudioTracksPanel videoId="v1" spokenLanguage="ar" />);
    fireEvent.click(await screen.findByTestId('audio-track-add'));
    const dialog = await screen.findByTestId('audio-track-dialog');
    fireEvent.change(within(dialog).getByTestId('audio-track-file'), { target: { files: [new File([new Uint8Array(5)], 'english.mp3', { type: 'audio/mpeg' })] } });
    fireEvent.change(within(dialog).getByTestId('audio-track-language'), { target: { value: 'en' } });
    expect(within(dialog).getByTestId('audio-track-label')).toHaveValue('English');
    fireEvent.click(within(dialog).getByTestId('audio-track-submit'));
    await waitFor(() => expect(completeAudioTrack).toHaveBeenCalledWith('v1', 'tnew12345678'));
    expect(addAudioTrack).toHaveBeenCalledWith('v1', expect.objectContaining({ language: 'en', label: 'English', kind: 'dub', originalLanguage: 'ar', source: expect.objectContaining({ type: 'upload', bytes: 5, fileName: 'english.mp3' }) }));
    expect(send).toHaveBeenCalledWith(0, expect.any(Blob));
  });

  it('says so when the tier refuses the track (402)', async () => {
    listAudioTracks.mockResolvedValue(ok(view()));
    addAudioTrack.mockResolvedValue({ ok: false, status: 402, error: 'upgrade_required', details: { limit: 1, used: 1 } });
    render(<AudioTracksPanel videoId="v1" />);
    fireEvent.click(await screen.findByTestId('audio-track-add'));
    const dialog = await screen.findByTestId('audio-track-dialog');
    fireEvent.change(within(dialog).getByTestId('audio-track-file'), { target: { files: [new File([new Uint8Array(5)], 'urdu.wav')] } });
    fireEvent.click(within(dialog).getByTestId('audio-track-submit'));
    expect(await within(dialog).findByTestId('audio-track-error')).toHaveTextContent('Limit reached (1 per video).');
  });

  it('asks before deleting a track', async () => {
    listAudioTracks.mockResolvedValue(ok(view()));
    deleteAudioTrack.mockResolvedValue(ok({}));
    render(<AudioTracksPanel videoId="v1" />);
    const rows = await screen.findAllByTestId('audio-track');
    fireEvent.click(within(rows[1]!).getByTestId('audio-track-delete'));
    expect(await screen.findByText('Delete this audio track?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteAudioTrack).toHaveBeenCalledWith('v1', EN.id));
  });

  it('makes a ready track the default', async () => {
    listAudioTracks.mockResolvedValue(ok(view()));
    updateAudioTrack.mockResolvedValue(ok({ track: { ...EN, isDefault: true } }));
    render(<AudioTracksPanel videoId="v1" />);
    const rows = await screen.findAllByTestId('audio-track');
    fireEvent.click(within(rows[1]!).getByTestId('audio-track-default'));
    await waitFor(() => expect(updateAudioTrack).toHaveBeenCalledWith('v1', EN.id, { isDefault: true }));
  });
});
