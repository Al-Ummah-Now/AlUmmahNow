/**
 * Home hero / Spotlight frame (2026-11-10: "feature video in home doesn't use correct aspect for video").
 */
import { heroSrcSet, heroThumbFit, isFeaturable, isUprightVideo, pickHomeFeatured, type HeroVideo } from '../hero';

const landscape: HeroVideo = { id: 'land', width: 1920, height: 1080, duration: 600 };
const short: HeroVideo = { id: 'short', width: 1080, height: 1920, duration: 45 };
const square: HeroVideo = { id: 'square', width: 1080, height: 1080, duration: 30 };

describe('heroThumbFit', () => {
  it('fills the 16:9 frame with a landscape video', () => {
    expect(heroThumbFit(landscape)).toBe('cover');
    expect(heroThumbFit({ id: 'x' })).toBe('cover'); // no size known: assume landscape
  });

  it('shows a vertical or square video whole before its image loads', () => {
    expect(heroThumbFit(short)).toBe('contain');
    expect(heroThumbFit(square)).toBe('contain');
    expect(heroThumbFit({ id: 'flag', isShort: true })).toBe('contain');
    // A long vertical video is not a Short, but is still taller than wide
    expect(heroThumbFit({ id: 'tall', width: 720, height: 1280, duration: 900 })).toBe('contain');
  });

  it("lets the loaded image's own shape decide", () => {
    expect(heroThumbFit(landscape, 9 / 16)).toBe('contain'); // vertical thumbnail on a landscape video
    expect(heroThumbFit(short, 16 / 9)).toBe('cover'); // a Short with a landscape custom thumbnail
    expect(heroThumbFit(landscape, 4 / 3)).toBe('contain');
    expect(heroThumbFit(landscape, 16 / 10)).toBe('cover');
  });
});

describe('pickHomeFeatured', () => {
  it('prefers the newest ready landscape video over a newer Short', () => {
    expect(pickHomeFeatured([short, square, landscape])?.id).toBe('land');
    expect(isUprightVideo(short)).toBe(true);
  });

  it('skips videos that are not ready, drafts and private videos', () => {
    const processing = { ...landscape, id: 'proc', uploadStatus: 'processing' as const };
    const draft = { ...landscape, id: 'draft', isDraft: true };
    const priv = { ...landscape, id: 'priv', isPublic: false };
    const ready = { ...landscape, id: 'ready', uploadStatus: 'ready' as const };
    expect(pickHomeFeatured([processing, draft, priv, ready])?.id).toBe('ready');
    expect(isFeaturable(processing)).toBe(false);
  });

  it('keeps a video an editor featured, even a Short', () => {
    expect(pickHomeFeatured([landscape, { ...short, isFeatured: true }])?.id).toBe('short');
    // ...but not one that is still processing
    expect(pickHomeFeatured([landscape, { ...short, isFeatured: true, uploadStatus: 'processing' }])?.id).toBe('land');
  });

  it('falls back to a Short when there is no landscape video, and to nothing when nothing is ready', () => {
    expect(pickHomeFeatured([short, square])?.id).toBe('short');
    expect(pickHomeFeatured([{ ...landscape, uploadStatus: 'uploading' }])).toBeUndefined();
  });

  it('honours the exclusion list', () => {
    expect(pickHomeFeatured([landscape, { ...landscape, id: 'b' }], new Set(['land']))?.id).toBe('b');
  });
});

describe('heroSrcSet', () => {
  it('lists the stored width variants', () => {
    expect(heroSrcSet({ hd: 'https://i/x?width=1280', sd: 'https://i/x?width=640', mobile: 'https://i/x?width=320' })).toBe(
      'https://i/x?width=320 320w, https://i/x?width=640 640w, https://i/x?width=1280 1280w'
    );
    expect(heroSrcSet(undefined)).toBeUndefined();
    expect(heroSrcSet({})).toBeUndefined();
  });
});
