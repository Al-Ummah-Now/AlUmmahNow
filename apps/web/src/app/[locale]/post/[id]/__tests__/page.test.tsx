/**
 * @jest-environment node
 *
 * /{locale}/post/{id} (wiki AUN-SEO): 404 when nobody here may see the post, 503 when the API is
 * down, canonical + hreflang per language, noindex for a members-only post, and SocialMediaPosting
 * only for a public one.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import PostPage, { generateMetadata } from '../page';
import { loadPermalinkPost } from '@/lib/community/post-permalink';
import { ContentUnavailableError } from '@/lib/seo/availability';

jest.mock('next/headers', () => ({ headers: async () => new Map([['host', 'videos.alummahnow.net']]) }));
jest.mock('next/navigation', () => ({ notFound: jest.fn(() => { throw new Error('NEXT_NOT_FOUND'); }) }));
jest.mock('@/lib/community/post-permalink', () => ({ loadPermalinkPost: jest.fn() }));
jest.mock('@/lib/channel-loaders', () => ({ loadChannelById: jest.fn(async () => ({ id: 'c1', handle: 'Noor' })) }));
jest.mock('@/components/Community/permalink/PostPermalinkView', () => ({ __esModule: true, default: (p: { channelHref: string }) => <div data-href={p.channelHref}>post</div> }));

const load = loadPermalinkPost as jest.Mock;
const params = (locale: string, id = 'p1') => ({ params: Promise.resolve({ locale, id }) });
const post = (over: Record<string, unknown> = {}) => ({
  status: 'ok',
  post: { id: 'p1', channelId: 'c1', type: 'text', content: 'Eid prayer times\nAt 7:30 in the park.', createdAt: '2026-11-14T08:00:00.000Z', likes: 1, comments: 0, channelName: 'Noor', visibility: 'public', status: 'published', ...over },
});

describe('post permalink page', () => {
  beforeEach(() => jest.clearAllMocks());

  it('metadata: title, description, self-canonical with the en/ar pair and x-default', async () => {
    load.mockResolvedValue(post());
    const meta = await generateMetadata(params('ar'));
    expect(meta.title).toBe('Eid prayer times');
    expect(meta.description).toBe('Eid prayer times At 7:30 in the park.');
    expect(meta.alternates).toEqual({
      canonical: 'https://videos.alummahnow.net/ar/post/p1',
      languages: { en: 'https://videos.alummahnow.net/en/post/p1', ar: 'https://videos.alummahnow.net/ar/post/p1', 'x-default': 'https://videos.alummahnow.net/en/post/p1' },
    });
    expect(meta.robots).toBeUndefined();
  });

  it('a members-only post renders but is noindex and carries no markup', async () => {
    load.mockResolvedValue(post({ visibility: 'members' }));
    expect((await generateMetadata(params('en'))).robots).toEqual({ index: false, follow: false });
    expect(renderToStaticMarkup(await PostPage(params('en')))).not.toContain('application/ld+json');
  });

  it('a public post carries SocialMediaPosting and breadcrumbs, author = the channel @handle page', async () => {
    load.mockResolvedValue(post());
    const html = renderToStaticMarkup(await PostPage(params('en')));
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)![1]);
    expect(ld[0]['@type']).toBe('SocialMediaPosting');
    expect(ld[0].author.url).toBe('https://videos.alummahnow.net/en/@Noor');
    expect(ld[1]['@type']).toBe('BreadcrumbList');
    expect(html).toContain('data-href="/en/@Noor"');
  });

  it('a post nobody may see is a 404; an API outage is a 503', async () => {
    load.mockResolvedValue({ status: 'missing' });
    await expect(PostPage(params('en'))).rejects.toThrow('NEXT_NOT_FOUND');
    expect((await generateMetadata(params('en'))).robots).toEqual({ index: false, follow: false });
    load.mockResolvedValue({ status: 'unavailable' });
    await expect(PostPage(params('en'))).rejects.toBeInstanceOf(ContentUnavailableError);
  });
});
