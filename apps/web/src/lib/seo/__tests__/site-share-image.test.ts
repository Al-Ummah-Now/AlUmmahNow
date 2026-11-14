/** Pages that set their own openGraph/twitter (which replace the root layout's) still carry a share image. */
import { ogImages, SITE_SHARE_IMAGE, twitterImages } from '../site-share-image';
import { listPageMetadata } from '../structured-data';

describe('site share image', () => {
  it('a page without its own image gets the site image with its declared size', () => {
    expect(ogImages(null, 'Playlist')).toEqual([{ url: '/icon-512.png', width: 512, height: 512, alt: 'Playlist' }]);
    expect(ogImages(undefined)).toEqual([SITE_SHARE_IMAGE]);
    expect(twitterImages(null)).toEqual(['/icon-512.png']);
  });

  it('a page with its own image keeps it (no size declared: it is not ours to measure)', () => {
    expect(ogImages('https://cdn.example/p.jpg', 'Post')).toEqual([{ url: 'https://cdn.example/p.jpg', alt: 'Post' }]);
    expect(twitterImages('https://cdn.example/p.jpg')).toEqual(['https://cdn.example/p.jpg']);
  });

  it('list pages name the site image themselves', () => {
    const meta = listPageMetadata('ar', '/channels', 'القنوات');
    expect(meta.openGraph?.images).toEqual([{ ...SITE_SHARE_IMAGE, alt: 'القنوات | الأمة الآن' }]);
    expect(meta.twitter?.images).toEqual(['/icon-512.png']);
  });
});
