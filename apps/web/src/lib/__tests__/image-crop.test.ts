import { clampOffset, clampZoom, coverScale, sourceRect, CROP_SPECS, MAX_ZOOM, MIN_ZOOM } from '../image-crop';

describe('image-crop geometry', () => {
  const viewport = { width: 400, height: 100 }; // 4:1 cover frame

  it('cover-fits the image to the frame', () => {
    expect(coverScale({ width: 2000, height: 1000 }, viewport)).toBeCloseTo(0.2); // width-bound
    expect(coverScale({ width: 400, height: 400 }, viewport)).toBeCloseTo(1); // width-bound, taller
    expect(coverScale({ width: 1000, height: 100 }, viewport)).toBeCloseTo(1); // height-bound
  });

  it('clamps zoom to the allowed range', () => {
    expect(clampZoom(0.2)).toBe(MIN_ZOOM);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(clampZoom(2)).toBe(2);
  });

  it('never lets the image uncover the frame', () => {
    const image = { width: 400, height: 400 };
    // scale 1: image is 400x400 in a 400x100 frame -> x locked, y within +/-150
    expect(clampOffset({ x: 50, y: 999 }, image, viewport, 1)).toEqual({ x: 0, y: 150 });
    expect(clampOffset({ x: -50, y: -999 }, image, viewport, 1)).toEqual({ x: 0, y: -150 });
  });

  it('maps the visible frame back to source pixels', () => {
    const image = { width: 400, height: 400 };
    // centred: rows 150..250 are visible
    expect(sourceRect(image, viewport, 1, { x: 0, y: 0 })).toEqual({ sx: 0, sy: 150, sw: 400, sh: 100 });
    // dragged down to the top edge
    expect(sourceRect(image, viewport, 1, { x: 0, y: 150 })).toEqual({ sx: 0, sy: 0, sw: 400, sh: 100 });
    // zoom 2: a quarter of the width, centred
    const r = sourceRect(image, viewport, 2, { x: 0, y: 0 });
    expect(r).toEqual({ sx: 100, sy: 175, sw: 200, sh: 50 });
  });

  it('outputs at the spec aspect ratios', () => {
    expect(CROP_SPECS.avatar.output.width / CROP_SPECS.avatar.output.height).toBe(CROP_SPECS.avatar.aspect);
    expect(CROP_SPECS.cover.output.width / CROP_SPECS.cover.output.height).toBe(CROP_SPECS.cover.aspect);
  });
});
