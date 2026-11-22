/**
 * @jest-environment node
 *
 * Playlist share card (large link previews, 2026-11-15): the first video's 1200x630 card when it is
 * public, else the channel's card, always with the large X card; title in the page's language.
 */
jest.mock('react', () => ({ ...jest.requireActual('react'), cache: <T,>(fn: T) => fn }));
jest.mock('@/lib/logger-server', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('next/headers', () => ({ headers: async () => new Map([['host', 'videos.alummahnow.net']]) }));
jest.mock('next/navigation', () => ({ notFound: jest.fn() }));
jest.mock('@/lib/seo/availability-server', () => ({ playlistAvailability: jest.fn(async () => 'public') }));
jest.mock('@/lib/embed/content', () => ({ loadPublicPlaylistResult: jest.fn(), loadPublicVideo: jest.fn() }));

import { generateMetadata } from '../layout';
import { loadPublicPlaylistResult, loadPublicVideo } from '@/lib/embed/content';
import { playlistAvailability } from '@/lib/seo/availability-server';

const playlist = loadPublicPlaylistResult as jest.Mock;
const video = loadPublicVideo as jest.Mock;
const P = '01e1db63-2666-4ed8-ad92-659a9620b152';
const O = 'https://videos.alummahnow.net';
const params = (locale: string) => ({ params: Promise.resolve({ locale, id: P }) });

describe('playlist share card', () => {
  beforeEach(() => jest.clearAllMocks());

  it('the first public video\'s card, Arabic title on /ar', async () => {
    playlist.mockResolvedValue({ status: 200, data: { title: 'Gaza', titleLocalized: { ar: 'متى ينصر اهل غزة' }, channelId: 'c1', videos: ['v1', 'v2'] } });
    video.mockResolvedValue({ id: 'v1', poster: '/thumb/v1.jpg' });
    const meta = await generateMetadata(params('ar'));
    expect(meta.openGraph).toMatchObject({ title: 'متى ينصر اهل غزة', images: [{ url: `${O}/og/v/v1.jpg`, width: 1200, height: 630, type: 'image/jpeg', alt: 'متى ينصر اهل غزة' }] });
    expect(meta.twitter).toMatchObject({ card: 'summary_large_image', images: [`${O}/og/v/v1.jpg`] });
  });

  it('first video not public: the channel\'s card', async () => {
    playlist.mockResolvedValue({ status: 200, data: { title: 'List', channelId: 'c1', videos: ['v1'] } });
    video.mockResolvedValue(null);
    const meta = await generateMetadata(params('en'));
    expect(meta.twitter).toMatchObject({ card: 'summary_large_image', images: [`${O}/og/c/c1.jpg`] });
  });
});

describe('playlist the layout answers 404 for', () => {
  beforeEach(() => jest.clearAllMocks());
  const NOT_FOUND = { title: { absolute: 'Page not found | Al Ummah Now' }, robots: null };

  it('missing (or purged, the Worker\'s 410): the 404 page\'s title and no robots of its own', async () => {
    (playlistAvailability as jest.Mock).mockResolvedValueOnce('missing');
    expect(await generateMetadata(params('en'))).toEqual(NOT_FOUND);
    // Not an id at all
    expect(await generateMetadata({ params: Promise.resolve({ locale: 'en', id: '../../etc' }) })).toEqual(NOT_FOUND);
    expect(playlist).not.toHaveBeenCalled();
  });

  it('restricted (only the owner sees it): noindex, no share card', async () => {
    (playlistAvailability as jest.Mock).mockResolvedValueOnce('restricted');
    expect(await generateMetadata(params('en'))).toEqual({ robots: { index: false, follow: false } });
  });
});
