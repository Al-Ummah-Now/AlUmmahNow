/**
 * Large link previews (2026-11-15): every page's og:image is a 1200x630 JPEG with its size and type,
 * and the X card is summary_large_image, so chat apps show the big image with the text under it.
 */
import { LARGE_CARD, ogImages, SITE_SHARE_IMAGE, twitterImages } from '../site-share-image';
import { listPageMetadata } from '../structured-data';

describe('site share image', () => {
  it('is the owner\'s 1200x630 brand card, never the square app icon', () => {
    expect(SITE_SHARE_IMAGE).toEqual({ url: '/brand/og-default.jpg', width: 1200, height: 630, type: 'image/jpeg' });
    expect(ogImages(null, 'Playlist')).toEqual([{ ...SITE_SHARE_IMAGE, alt: 'Playlist' }]);
    expect(ogImages(undefined)).toEqual([SITE_SHARE_IMAGE]);
    expect(twitterImages(null)).toEqual(['/brand/og-default.jpg']);
  });

  it('a page\'s own card declares the card size, type and secure URL', () => {
    const card = 'https://videos.alummahnow.net/og/v/v1.jpg';
    expect(ogImages(card, 'Post')).toEqual([{ url: card, secureUrl: card, type: 'image/jpeg', width: 1200, height: 630, alt: 'Post' }]);
    expect(twitterImages(card)).toEqual([card]);
  });

  it('list pages name the site card themselves, with the large X card', () => {
    const meta = listPageMetadata('ar', '/channels', 'القنوات');
    expect(meta.openGraph?.images).toEqual([{ ...SITE_SHARE_IMAGE, alt: 'القنوات | الأمة الآن' }]);
    expect(meta.twitter).toMatchObject({ card: LARGE_CARD, images: ['/brand/og-default.jpg'] });
  });
});
