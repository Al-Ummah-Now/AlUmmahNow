import { clampOffset, clampZoom, coverScale, fitAspect, sourceRect, CROP_SPECS, MAX_ZOOM, MIN_ZOOM } from '../image-crop';

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

describe('fitAspect (squeezed avatars)', () => {
  it('trims a frame measured slightly off-square so the 800x800 avatar is not distorted', () => {
    // A 320x318 frame (rounding / partial aspect-ratio support) at scale 0.25
    const rect = sourceRect({ width: 1280, height: 1280 }, { width: 320, height: 318 }, 0.25, { x: 0, y: 0 });
    expect(rect.sw / rect.sh).not.toBe(1);
    const fitted = fitAspect(rect, 1);
    expect(fitted.sw / fitted.sh).toBeCloseTo(1, 10);
    // Trimmed around the centre
    expect(fitted.sx + fitted.sw / 2).toBeCloseTo(rect.sx + rect.sw / 2, 10);
    expect(fitted.sy + fitted.sh / 2).toBeCloseTo(rect.sy + rect.sh / 2, 10);
  });

  it('trims a too-tall rect to a 4:1 cover', () => {
    const fitted = fitAspect({ sx: 0, sy: 0, sw: 400, sh: 120 }, 4);
    expect(fitted).toEqual({ sx: 0, sy: 10, sw: 400, sh: 100 });
  });

  it('leaves an exact rect untouched', () => {
    const rect = { sx: 5, sy: 6, sw: 200, sh: 200 };
    expect(fitAspect(rect, 1)).toBe(rect);
  });
});
