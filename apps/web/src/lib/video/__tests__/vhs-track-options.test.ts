/**
 * Where HLS plays through VHS, the player's track lists are VHS's own (wiki AUN-MULTI-AUDIO): Linux
 * WebKit (no native HLS, but `audioTracks` on the element) listed Media Source's unnamed track in
 * the Audio menu and ignored a switch. Native HLS (Safari, iOS) keeps the browser's tracks.
 */
jest.mock('video.js', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('video.js/dist/lang/ar.json', () => ({}));
jest.mock('@/lib/video/components', () => ({ registerFanousComponents: jest.fn(), applyBuiltInIcons: jest.fn(), layerCaptionSettings: jest.fn(), syncCustomCaptions: jest.fn() }));
jest.mock('@/lib/logger-client', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import videojs from 'video.js';
import { createVideoPlayer, vhsTrackOptions } from '../videojs-setup';

const el = (answer: Record<string, string>) => ({ canPlayType: (type: string) => answer[type] ?? '' });

describe('vhsTrackOptions', () => {
  it('turns native audio and video tracks off where there is no native HLS (VHS plays)', () => {
    expect(vhsTrackOptions(el({}))).toEqual({ nativeAudioTracks: false, nativeVideoTracks: false });
  });

  it('keeps the browser tracks where HLS is native (Safari, iOS)', () => {
    expect(vhsTrackOptions(el({ 'application/vnd.apple.mpegurl': 'maybe' }))).toEqual({});
    expect(vhsTrackOptions(el({ 'application/x-mpegURL': 'probably' }))).toEqual({});
  });

  it('treats a canPlayType that throws as no native HLS', () => {
    expect(vhsTrackOptions({ canPlayType: () => { throw new Error('no'); } })).toEqual({ nativeAudioTracks: false, nativeVideoTracks: false });
  });
});

describe('createVideoPlayer html5 options', () => {
  it('passes the VHS track options with the default html5 options', () => {
    const fake = { el: () => null, ready: jest.fn(), on: jest.fn(), isDisposed: () => false, dispose: jest.fn() };
    (videojs as unknown as jest.Mock).mockReturnValue(fake);
    const video = document.createElement('video');
    video.canPlayType = () => '';
    createVideoPlayer(video, { controls: true } as never);
    const opts = (videojs as unknown as jest.Mock).mock.calls[0][1];
    expect(opts.html5).toEqual(expect.objectContaining({ nativeTextTracks: false, nativeAudioTracks: false, nativeVideoTracks: false }));
  });
});
