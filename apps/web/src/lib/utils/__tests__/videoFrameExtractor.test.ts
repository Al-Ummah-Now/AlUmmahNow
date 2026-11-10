import { FRAME_MAX_EDGE, frameCaptureSize } from '../videoFrameExtractor';

const ratio = ({ width, height }: { width: number; height: number }) => width / height;

describe('frameCaptureSize: frames keep the video aspect ratio', () => {
  it.each([
    ['16:9', 1920, 1080, { width: 1280, height: 720 }],
    ['9:16', 1080, 1920, { width: 720, height: 1280 }],
    ['1:1', 1440, 1440, { width: 1280, height: 1280 }],
    ['4:3', 640, 480, { width: 1280, height: 960 }],
  ])('%s video (%ix%i)', (_label, w, h, expected) => {
    const size = frameCaptureSize(w, h);
    expect(size).toEqual(expected);
    expect(Math.max(size.width, size.height)).toBe(FRAME_MAX_EDGE);
    expect(ratio(size)).toBeCloseTo(w / h, 2);
  });

  it('a vertical video is never drawn into a 16:9 canvas', () => {
    const size = frameCaptureSize(720, 1280);
    expect(size.height).toBeGreaterThan(size.width);
    expect(size).not.toEqual({ width: 1280, height: 720 });
  });

  it('odd encodes keep their ratio within a pixel', () => {
    const size = frameCaptureSize(1280, 658);
    expect(size).toEqual({ width: 1280, height: 658 });
    const small = frameCaptureSize(854, 446);
    expect(Math.abs(small.height - Math.round((1280 * 446) / 854))).toBeLessThanOrEqual(1);
  });

  it('small clips are scaled up so frames clear the 320x180 thumbnail minimum', () => {
    expect(frameCaptureSize(240, 426)).toEqual({ width: 721, height: 1280 });
    expect(frameCaptureSize(160, 90)).toEqual({ width: 1280, height: 720 });
  });

  it('honours a custom longest edge', () => {
    expect(frameCaptureSize(1080, 1920, 640)).toEqual({ width: 360, height: 640 });
  });

  it.each([
    [0, 0],
    [NaN, 720],
    [1280, Infinity],
    [-1, 10],
  ])('falls back to 16:9 when the browser reports no usable size (%p x %p)', (w, h) => {
    expect(frameCaptureSize(w, h)).toEqual({ width: 1280, height: 720 });
  });
});
