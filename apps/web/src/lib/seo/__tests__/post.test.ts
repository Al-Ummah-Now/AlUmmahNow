/**
 * Post permalinks (wiki AUN-SEO): title = first line, description = first 160 characters, image,
 * SocialMediaPosting with the channel as author, and only public published posts indexed.
 */
import { clip, isIndexablePost, postDescription, postHeadline, postImage, socialMediaPostingLd } from '../post';

const O = 'https://videos.alummahnow.net';
const base = {
  id: 'p1', channelId: 'c1', type: 'text', createdAt: '2026-11-14T08:00:00.000Z', likes: 3, comments: 2,
  channelName: 'Noor', channelNameLocalized: { ar: 'نور' }, visibility: 'public', status: 'published',
} as never as Parameters<typeof postHeadline>[0];
const post = (over: Record<string, unknown>) => ({ ...(base as object), ...over }) as Parameters<typeof postHeadline>[0];

describe('post permalink metadata', () => {
  it('names the post by its first line and describes it by its first 160 characters', () => {
    const long = `Ramadan timetable\n${'Every evening we share the times for the next day. '.repeat(6)}`;
    const p = post({ content: long });
    expect(postHeadline(p, 'en')).toBe('Ramadan timetable');
    const description = postDescription(p, 'en');
    expect(description.length).toBeLessThanOrEqual(160);
    expect(description.startsWith('Ramadan timetable Every evening')).toBe(true);
    expect(description.endsWith('…')).toBe(true);
  });

  it('a long first line is clipped at a word; whitespace is collapsed', () => {
    expect(clip('a '.repeat(80), 20).length).toBeLessThanOrEqual(20);
    expect(postHeadline(post({ content: `  ${'word '.repeat(40)}` }), 'en').length).toBeLessThanOrEqual(100);
  });

  it('a post with no text is named after its channel, in the page language', () => {
    const photo = post({ type: 'image', content: '', images: [{ url: 'https://cdn.example/a.jpg', width: 1, height: 1, mimeType: 'image/jpeg', size: 1 }] });
    expect(postHeadline(photo, 'en')).toBe('Post from Noor');
    expect(postHeadline(photo, 'ar')).toBe('منشور من نور');
    expect(postDescription(photo, 'ar')).toBe('منشور من نور على الأمة الآن.');
    expect(postImage(photo)).toBe('https://cdn.example/a.jpg');
  });

  it('uses a poll question or an article title when there is no text', () => {
    expect(postHeadline(post({ content: '', poll: { question: 'Which day?' } }), 'en')).toBe('Which day?');
    expect(postHeadline(post({ content: '', article: { title: 'On patience', excerpt: 'A short read', coverUrl: 'https://cdn.example/c.jpg' } }), 'en')).toBe('On patience');
  });

  it('never uses a non-https image', () => {
    expect(postImage(post({ images: [{ url: 'http://cdn.example/a.jpg' }] }))).toBeUndefined();
  });

  it('indexes only public, published posts', () => {
    expect(isIndexablePost(base)).toBe(true);
    expect(isIndexablePost(post({ visibility: 'members' }))).toBe(false);
    expect(isIndexablePost(post({ status: 'scheduled' }))).toBe(false);
  });
});

describe('SocialMediaPosting', () => {
  it('has the required fields with the channel as author', () => {
    const ld = socialMediaPostingLd(post({ content: 'Hello\nworld' }), 'ar', O, `${O}/ar/@Noor`);
    expect(ld).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'SocialMediaPosting',
      url: `${O}/ar/post/p1`,
      headline: 'Hello',
      articleBody: 'Hello\nworld',
      datePublished: '2026-11-14T08:00:00.000Z',
      inLanguage: 'ar',
      author: { '@type': 'Organization', name: 'نور', url: `${O}/ar/@Noor`, '@id': `${O}/ar/@Noor#channel` },
    });
    expect(ld.interactionStatistic).toHaveLength(2);
    expect(ld).not.toHaveProperty('image');
  });
});
