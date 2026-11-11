import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { STUDIO_EN, type LiveIngest, type LiveStreamState } from '@al-ummah/shared-types';
import { GoLive, goLivePhase, maskKey, STUDIO_POLL_MS } from '../GoLive';

const getStream = jest.fn();
const getIngest = jest.fn();
const getState = jest.fn();
const startStream = jest.fn();
const endStream = jest.fn();

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: { studio: mockStudio, confirmDialog: { typeToConfirm: 'Type {value}' }, common: { cancel: 'Cancel' } }, lang: 'en', isRTL: false }),
}));
jest.mock('@/lib/live/api', () => {
  const actual = jest.requireActual('@/lib/live/api');
  return {
    ...actual,
    getStream: (...a: unknown[]) => getStream(...a),
    getIngest: (...a: unknown[]) => getIngest(...a),
    getState: (...a: unknown[]) => getState(...a),
    startStream: (...a: unknown[]) => startStream(...a),
    endStream: (...a: unknown[]) => endStream(...a),
  };
});
jest.mock('@/components/live/LivePlayer', () => ({ LivePlayer: ({ src, testId }: { src: string; testId: string }) => <div data-testid={testId} data-src={src} /> }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), debug: jest.fn() } }));

const mockStudio = STUDIO_EN;
const text = STUDIO_EN.live.goLive;

const state = (over: Partial<LiveStreamState> = {}): LiveStreamState => ({
  streamId: 's1', sessionId: 'sess1', status: 'scheduled', sessionStatus: 'provisioned', receiving: false,
  playbackUrl: 'https://live.qa.alummahnow.net/hls/sess1/master.m3u8', vodUrl: null, startedAt: null, endedAt: null, bitrateKbps: null, ...over,
});
const rtmp: LiveIngest = { protocol: 'rtmp', url: 'rtmp://ingest.example/live', streamKey: 'SECRETKEY', ffmpegExample: 'ffmpeg -i in -f flv rtmp://ingest.example/live/SECRETKEY' };
const hls: LiveIngest = { protocol: 'https-hls', url: 'https://live.qa.alummahnow.net/ingest/sess1', streamKey: 'K2', ffmpegExample: 'ffmpeg -f hls https://live.qa.alummahnow.net/ingest/sess1/K2/' };

function setup(ingest: LiveIngest = rtmp, initial: LiveStreamState = state()) {
  getStream.mockResolvedValue({ id: 's1', title: 'Friday lecture', status: initial.status });
  getIngest.mockResolvedValue({ ingest, state: initial });
  getState.mockResolvedValue({ state: initial, sentAt: 0, receivedAt: 0, dateHeader: null });
  return render(<GoLive locale="en" channelId="c1" streamId="s1" />);
}

describe('goLivePhase', () => {
  it('maps state to the page phase', () => {
    expect(goLivePhase(null, false)).toBe('ready');
    expect(goLivePhase(state(), false)).toBe('ready');
    expect(goLivePhase(state(), true)).toBe('waiting');
    expect(goLivePhase(state({ status: 'live', sessionStatus: 'live', receiving: false }), false)).toBe('waiting');
    expect(goLivePhase(state({ status: 'live', sessionStatus: 'live', receiving: true }), false)).toBe('live');
    expect(goLivePhase(state({ status: 'ended', sessionStatus: 'ended' }), true)).toBe('ended');
    expect(goLivePhase(state({ sessionStatus: 'failed' }), false)).toBe('ended');
  });

  it('masks the key in the ffmpeg command', () => {
    expect(maskKey('a KEY b KEY', 'KEY')).toBe(`a ${'•'.repeat(12)} b ${'•'.repeat(12)}`);
    expect(maskKey('abc', '')).toBe('abc');
  });
});

describe('GoLive', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(navigator, { clipboard: { writeText: jest.fn().mockResolvedValue(undefined) } });
  });
  afterEach(() => jest.useRealTimers());

  it('shows the encoder settings with the key masked; Reveal and Copy', async () => {
    setup();
    expect(await screen.findByTestId('studio-golive-server')).toHaveValue(rtmp.url);
    const key = screen.getByTestId('studio-golive-key');
    expect(key).toHaveAttribute('type', 'password');
    expect(screen.getByTestId('studio-golive-ffmpeg')).not.toHaveTextContent('SECRETKEY');
    expect(screen.getByTestId('studio-golive-help')).toHaveTextContent(text.help.rtmp);
    fireEvent.click(screen.getByTestId('studio-golive-reveal'));
    expect(key).toHaveAttribute('type', 'text');
    expect(screen.getByTestId('studio-golive-ffmpeg')).toHaveTextContent('SECRETKEY');
    fireEvent.click(screen.getByTestId('studio-golive-copy-key'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('SECRETKEY');
    fireEvent.click(screen.getByTestId('studio-golive-copy-ffmpeg'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(rtmp.ffmpegExample);
    expect(await screen.findByTestId('studio-golive-copied')).toHaveTextContent(`${text.ffmpeg}: ${text.copied}`);
  });

  it('has the same layout for the self-hosted HTTPS push, with its own help line', async () => {
    setup(hls);
    expect(await screen.findByTestId('studio-golive-encoder')).toHaveAttribute('data-protocol', 'https-hls');
    expect(screen.getByTestId('studio-golive-help')).toHaveTextContent(text.help['https-hls']);
    expect(screen.getByTestId('studio-golive-server')).toHaveValue(hls.url);
  });

  it('Go live → waiting for the encoder → live (polled every 5 s) with the preview', async () => {
    jest.useFakeTimers();
    setup(hls);
    await screen.findByTestId('studio-golive-start');
    expect(screen.getByTestId('studio-golive-status')).toHaveTextContent(text.ready);
    startStream.mockResolvedValue({ ingest: rtmp, state: state() });
    fireEvent.click(screen.getByTestId('studio-golive-start'));
    await waitFor(() => expect(screen.getByTestId('studio-golive-status')).toHaveTextContent(text.waiting));
    // A start that failed over to the other provider shows that provider's settings
    expect(screen.getByTestId('studio-golive-server')).toHaveValue(rtmp.url);
    expect(screen.queryByTestId('studio-golive-preview')).toBeNull();

    getState.mockResolvedValue({ state: state({ status: 'live', sessionStatus: 'live', receiving: true, startedAt: '2026-11-11T10:00:00.000Z', bitrateKbps: 4500 }), sentAt: 0, receivedAt: 0, dateHeader: null });
    await act(async () => { jest.advanceTimersByTime(STUDIO_POLL_MS); });
    await waitFor(() => expect(screen.getByTestId('studio-golive-status')).toHaveTextContent(text.live));
    expect(screen.getByTestId('studio-golive-details')).toHaveTextContent('4500 kbps');
    expect(screen.getByTestId('studio-golive-preview')).toHaveAttribute('data-src', state().playbackUrl);
  });

  it('End stream asks in the in-app dialog; Cancel keeps it live', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm');
    setup(rtmp, state({ status: 'live', sessionStatus: 'live', receiving: true }));
    fireEvent.click(await screen.findByTestId('studio-golive-end'));
    expect(await screen.findByTestId('studio-golive-end-dialog')).toHaveTextContent(text.endTitle);
    fireEvent.click(screen.getByTestId('studio-golive-end-dialog-cancel'));
    await waitFor(() => expect(screen.queryByTestId('studio-golive-end-dialog')).toBeNull());
    expect(endStream).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('End stream confirmed → recording preparing → recording ready with a link', async () => {
    jest.useFakeTimers();
    setup(rtmp, state({ status: 'live', sessionStatus: 'live', receiving: true }));
    fireEvent.click(await screen.findByTestId('studio-golive-end'));
    endStream.mockResolvedValue({ state: state({ status: 'ended', sessionStatus: 'ended', playbackUrl: null }) });
    fireEvent.click(await screen.findByTestId('studio-golive-end-dialog-confirm'));
    await waitFor(() => expect(endStream).toHaveBeenCalledWith('s1'));
    await waitFor(() => expect(screen.getByTestId('studio-golive-status')).toHaveTextContent(text.ended));
    expect(screen.getByTestId('studio-golive-recording')).toHaveTextContent(text.recordingPreparing);
    expect(screen.queryByTestId('studio-golive-encoder')).toBeNull();

    getState.mockResolvedValue({ state: state({ status: 'ended', sessionStatus: 'ended', vodUrl: 'https://cdn.example/vod.m3u8' }), sentAt: 0, receivedAt: 0, dateHeader: null });
    await act(async () => { jest.advanceTimersByTime(STUDIO_POLL_MS); });
    expect(await screen.findByTestId('studio-golive-recording-link')).toHaveAttribute('href', '/en/live/s1');
  });

  it('explains refusals in plain words', async () => {
    setup();
    const { LiveApiError } = jest.requireActual('@/lib/live/api');
    startStream.mockRejectedValue(new LiveApiError(503, 'live_capacity'));
    fireEvent.click(await screen.findByTestId('studio-golive-start'));
    expect(await screen.findByTestId('studio-golive-error')).toHaveTextContent(STUDIO_EN.live.errors.live_capacity);
  });

  it('tells a team member who did not create the stream that the settings are not theirs', async () => {
    const { LiveApiError } = jest.requireActual('@/lib/live/api');
    getStream.mockResolvedValue({ id: 's1', title: 'x', status: 'scheduled' });
    getIngest.mockRejectedValue(new LiveApiError(403, 'forbidden'));
    render(<GoLive locale="en" channelId="c1" streamId="s1" />);
    expect(await screen.findByTestId('studio-golive-forbidden')).toHaveTextContent(text.notOwner);
  });
});
