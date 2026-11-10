import { CROP_MAX_EDGE, MAX_ZOOM, aspectLabel, cropOutputSize, cropRect, panDelta, shapesMatch } from '../thumbnailCrop';

const ratio = (r: { sw: number; sh: number }) => r.sw / r.sh;

describe('thumbnail crop math (cropped to the video shape, never stretched)', () => {
  it('shapes within 5% match, like the API', () => {
    expect(shapesMatch({ width: 1280, height: 720 }, { width: 1920, height: 1080 })).toBe(true);
    expect(shapesMatch({ width: 1280, height: 696 }, { width: 1920, height: 1080 })).toBe(true);
    expect(shapesMatch({ width: 1280, height: 720 }, { width: 1080, height: 1920 })).toBe(false);
    expect(shapesMatch({ width: 640, height: 480 }, { width: 1440, height: 1440 })).toBe(false);
    expect(shapesMatch({ width: 0, height: 0 }, { width: 1920, height: 1080 })).toBe(true);
  });

  it.each([
    ['16:9 image for a 9:16 video', { width: 1920, height: 1080 }, 9 / 16],
    ['9:16 image for a 16:9 video', { width: 1080, height: 1920 }, 16 / 9],
    ['4:3 image for a 1:1 video', { width: 1600, height: 1200 }, 1],
    ['1:1 image for a 4:3 video', { width: 1000, height: 1000 }, 4 / 3],
  ])('%s: the largest crop of the video shape, centred', (_, image, aspect) => {
    const r = cropRect(image, aspect);
    expect(ratio(r)).toBeCloseTo(aspect, 6);
    expect(r.sw <= image.width + 1e-9 && r.sh <= image.height + 1e-9).toBe(true);
    expect(Math.max(r.sw / image.width, r.sh / image.height)).toBeCloseTo(1, 6);
    expect(r.sx).toBeCloseTo((image.width - r.sw) / 2, 6);
    expect(r.sy).toBeCloseTo((image.height - r.sh) / 2, 6);
  });

  it('zoom narrows the crop (clamped to 1..MAX_ZOOM) and keeps the shape', () => {
    const image = { width: 1920, height: 1080 };
    const z2 = cropRect(image, 16 / 9, 2);
    expect(z2.sw).toBeCloseTo(960);
    expect(z2.sh).toBeCloseTo(540);
    expect(cropRect(image, 16 / 9, 99).sw).toBeCloseTo(1920 / MAX_ZOOM);
    expect(cropRect(image, 16 / 9, 0.1).sw).toBeCloseTo(1920);
  });

  it('pan moves the crop edge to edge and never outside the image', () => {
    const image = { width: 1920, height: 1080 };
    expect(cropRect(image, 9 / 16, 1, -1, 0).sx).toBeCloseTo(0);
    const right = cropRect(image, 9 / 16, 1, 5, 0);
    expect(right.sx + right.sw).toBeCloseTo(1920);
    const down = cropRect(image, 16 / 9, 2, 0, 1);
    expect(down.sy + down.sh).toBeCloseTo(1080);
  });

  it('a drag pans the other way, scaled to the frame', () => {
    const image = { width: 1920, height: 1080 };
    // 9:16 crop is 607.5 wide; slack 1312.5; frame 300px → 2.025 image px per screen px
    const d = panDelta(image, 9 / 16, 1, 300, 100, 0);
    expect(d.x).toBeCloseTo((-100 * (607.5 / 300)) / (1312.5 / 2), 6);
    expect(d.y).toBe(0); // no vertical slack
  });

  it('output has the video shape, longest edge 1280', () => {
    expect(cropOutputSize(16 / 9)).toEqual({ width: CROP_MAX_EDGE, height: 720 });
    expect(cropOutputSize(9 / 16)).toEqual({ width: 720, height: CROP_MAX_EDGE });
    expect(cropOutputSize(1)).toEqual({ width: 1280, height: 1280 });
    expect(cropOutputSize(NaN)).toEqual({ width: 1280, height: 720 });
  });

  it('labels common shapes', () => {
    expect(aspectLabel({ width: 1080, height: 1920 })).toBe('9:16');
    expect(aspectLabel({ width: 1280, height: 696 })).toBe('16:9');
    expect(aspectLabel({ width: 1000, height: 400 })).toBe('1000×400');
  });
});
