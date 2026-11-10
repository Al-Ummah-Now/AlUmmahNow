import { aspectOf, isPortrait, thumbnailFit } from '../aspect';

describe('thumbnailFit: thumbnails are never stretched or cut to a strip', () => {
  const r = (w: number, h: number) => w / h;

  it.each([
    ['16:9', r(16, 9), 'cover'],
    ['16:10', r(16, 10), 'cover'],
    ['1280x658 encode', r(1280, 658), 'cover'],
    ['3:2', r(3, 2), 'contain'],
    ['4:3', r(4, 3), 'contain'],
    ['1:1', 1, 'contain'],
    ['9:16', r(9, 16), 'contain'],
    ['2.39:1 cinema', 2.39, 'cover'],
  ])('a %s image in a 16:9 card → %s', (_label, image, expected) => {
    expect(thumbnailFit(image)).toBe(expected);
  });

  it('a 9:16 shorts box covers with a vertical image and letterboxes a landscape one', () => {
    expect(thumbnailFit(r(9, 16), undefined, r(9, 16))).toBe('cover');
    expect(thumbnailFit(r(16, 9), undefined, r(9, 16))).toBe('contain');
  });

  it('a 16:9 image keeps filling a card that is narrower than 16:9 (fixed-height cards)', () => {
    expect(thumbnailFit(r(16, 9), undefined, 1.44)).toBe('cover');
    expect(thumbnailFit(r(4, 3), undefined, 1.44)).toBe('cover');
    expect(thumbnailFit(r(9, 16), undefined, 1.44)).toBe('contain');
    expect(thumbnailFit(1, undefined, 1.44)).toBe('contain');
  });

  it('the stored video size is the hint until the image has loaded', () => {
    expect(thumbnailFit(undefined, r(1080, 1920))).toBe('contain');
    expect(thumbnailFit(undefined, r(1920, 1080))).toBe('cover');
  });

  it('the loaded image wins over the hint (the image is what would be cropped)', () => {
    expect(thumbnailFit(r(16, 9), r(9, 16))).toBe('cover');
    expect(thumbnailFit(r(9, 16), r(16, 9))).toBe('contain');
  });

  it('nothing known: cover, as before', () => {
    expect(thumbnailFit()).toBe('cover');
    expect(thumbnailFit(undefined, undefined, NaN)).toBe('cover');
  });
});

describe('aspectOf / isPortrait', () => {
  it('needs two positive finite numbers', () => {
    expect(aspectOf(1920, 1080)).toBeCloseTo(16 / 9);
    expect(aspectOf(0, 1080)).toBeUndefined();
    expect(aspectOf(1920, undefined)).toBeUndefined();
    expect(aspectOf(null, 10)).toBeUndefined();
    expect(aspectOf(Infinity, 10)).toBeUndefined();
  });

  it('vertical and square are portrait', () => {
    expect(isPortrait(1080, 1920)).toBe(true);
    expect(isPortrait(1440, 1440)).toBe(true);
    expect(isPortrait(1920, 1080)).toBe(false);
    expect(isPortrait()).toBe(false);
  });
});
