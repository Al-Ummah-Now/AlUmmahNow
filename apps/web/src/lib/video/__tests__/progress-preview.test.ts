jest.mock('@/lib/logger-client', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { getBunnyPreviewUrl, initializeSpriteThumbnails } from '../progress-preview';
import type { ExtendedPlayer } from '../videojs';

const QA_LIBRARY_ID = 512345;
const PROD_LIBRARY_HEX = (239863).toString(16).padStart(8, '0');

function fakePlayer() {
  const spriteThumbnails = jest.fn();
  const player = { isDisposed: () => false, spriteThumbnails } as unknown as ExtendedPlayer;
  return { player, spriteThumbnails };
}

describe('getBunnyPreviewUrl', () => {
  it("builds the sprite URL from the video's own library id", () => {
    const url = getBunnyPreviewUrl('guid-1', QA_LIBRARY_ID);
    expect(url).toBe(`https://vz-${QA_LIBRARY_ID.toString(16).padStart(8, '0')}.b-cdn.net/guid-1/preview.webp`);
    expect(url).not.toContain(PROD_LIBRARY_HEX);
  });

  it('returns null when the library id is unknown or invalid', () => {
    expect(getBunnyPreviewUrl('guid-1', undefined)).toBeNull();
    expect(getBunnyPreviewUrl('guid-1', null)).toBeNull();
    expect(getBunnyPreviewUrl('guid-1', 0)).toBeNull();
    expect(getBunnyPreviewUrl('guid-1', Number.NaN)).toBeNull();
    expect(getBunnyPreviewUrl('', QA_LIBRARY_ID)).toBeNull();
  });
});

describe('initializeSpriteThumbnails', () => {
  it("uses the video's library id", () => {
    const { player, spriteThumbnails } = fakePlayer();
    initializeSpriteThumbnails(player, { bunnyVideoId: 'guid-1', libraryId: QA_LIBRARY_ID });
    expect(spriteThumbnails).toHaveBeenCalledTimes(1);
    const url: string = spriteThumbnails.mock.calls[0][0].url;
    expect(url).toContain(QA_LIBRARY_ID.toString(16).padStart(8, '0'));
    expect(url).not.toContain(PROD_LIBRARY_HEX);
  });

  it('skips the preview when no library id is known', () => {
    const { player, spriteThumbnails } = fakePlayer();
    initializeSpriteThumbnails(player, { bunnyVideoId: 'guid-1', libraryId: null });
    initializeSpriteThumbnails(player, { bunnyVideoId: 'guid-1' } as never);
    expect(spriteThumbnails).not.toHaveBeenCalled();
  });
});
