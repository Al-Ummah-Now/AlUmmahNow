/**
 * @jest-environment node
 *
 * A video the layout answers 404 for (the Worker turns a purged one into a 410) carries the 404 page's
 * metadata: the family's tab title and no robots of its own, so Next's noindex is its one robots meta
 * (lib/seo/error-robots.ts). A video only its owner may see stays noindex with no card.
 */
jest.mock('react', () => ({ ...jest.requireActual('react'), cache: <T,>(fn: T) => fn }));
jest.mock('next/headers', () => ({ headers: async () => new Map([['host', 'videos.alummahnow.net']]) }));
jest.mock('next/navigation', () => ({ notFound: jest.fn() }));
jest.mock('@/lib/seo/availability-server', () => ({ videoAvailability: jest.fn(async () => 'public') }));
jest.mock('@/lib/embed/content', () => ({ loadPublicVideo: jest.fn(), loadPublicChapters: jest.fn() }));
jest.mock('@/lib/seo/site-link', () => ({ loadSiteLink: jest.fn(async () => null), siteWatchCanonical: () => null }));

import { generateMetadata } from '../layout';
import { loadPublicVideo } from '@/lib/embed/content';
import { videoAvailability } from '@/lib/seo/availability-server';

const video = loadPublicVideo as jest.Mock;
const availability = videoAvailability as jest.Mock;
const params = (id: string) => ({ params: Promise.resolve({ locale: 'en', id }) });
const NOT_FOUND = { title: { absolute: 'Page not found | Al Ummah Now' }, robots: null };

describe('watch layout metadata for a video nobody may see', () => {
  beforeEach(() => jest.clearAllMocks());

  it('missing or purged: the 404 page\'s title and no robots of its own', async () => {
    availability.mockResolvedValueOnce('missing');
    expect(await generateMetadata(params('errpgNever0001'))).toEqual(NOT_FOUND);
    expect(video).not.toHaveBeenCalled();
  });

  it('not an id at all: the same', async () => {
    expect(await generateMetadata(params('../../etc'))).toEqual(NOT_FOUND);
    expect(availability).not.toHaveBeenCalled();
  });

  it('restricted (only its owner sees it): noindex, no card', async () => {
    availability.mockResolvedValueOnce('restricted');
    video.mockResolvedValueOnce(null);
    expect(await generateMetadata(params('ownPrivate01'))).toEqual({ robots: { index: false, follow: false } });
  });
});
