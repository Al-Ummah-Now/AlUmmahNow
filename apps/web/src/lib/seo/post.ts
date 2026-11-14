/**
 * A community post's permalink (/{locale}/post/{id}, wiki AUN-SEO): its title, description, share
 * image and SocialMediaPosting markup. The title is the post's first line, the description its first
 * 160 characters; a post with no text (an image, GIF or video) is named after its channel.
 */
import type { CommunityPost } from '@al-ummah/shared-types';
import { WWW_ORGANIZATION_ID, siteName } from './structured-data';

type PermalinkPost = Pick<CommunityPost, 'id' | 'channelId' | 'type' | 'content' | 'images' | 'gif' | 'poll' | 'createdAt' | 'updatedAt' | 'likes' | 'comments' | 'channelName' | 'channelNameLocalized' | 'channelAvatar' | 'visibility' | 'status'> & {
  article?: { title?: string; excerpt?: string | null; coverUrl?: string | null } | null;
  videoId?: string;
};

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/** At most `max` characters, cut at a word where one is near, with an ellipsis. */
export function clip(text: string, max: number): string {
  const flat = oneLine(text);
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export const postChannelName = (post: PermalinkPost, locale: string) =>
  post.channelNameLocalized?.[locale === 'ar' ? 'ar' : 'en']?.trim() || post.channelName?.trim() || siteName(locale);

/** The post's own words: its text, else an article's title and excerpt, else a poll's question. */
function postText(post: PermalinkPost): string {
  return (post.content || '').trim() || [post.article?.title, post.article?.excerpt].filter(Boolean).join('\n').trim() || (post.poll?.question || '').trim();
}

export function postHeadline(post: PermalinkPost, locale: string): string {
  const firstLine = postText(post).split(/\r?\n/).map(oneLine).find(Boolean);
  if (firstLine) return clip(firstLine, 100);
  return locale === 'ar' ? `منشور من ${postChannelName(post, locale)}` : `Post from ${postChannelName(post, locale)}`;
}

export function postDescription(post: PermalinkPost, locale: string): string {
  const text = postText(post);
  if (text) return clip(text, 160);
  const name = postChannelName(post, locale);
  return locale === 'ar' ? `منشور من ${name} على الأمة الآن.` : `A post from ${name} on Al Ummah Now.`;
}

/** The first https image of the post (its images, an article cover, a GIF); undefined when none. */
export function postImage(post: PermalinkPost): string | undefined {
  const candidates = [
    ...(post.images ?? []).map((i) => i.url),
    post.article?.coverUrl,
    post.gif?.url,
  ];
  return candidates.find((u): u is string => typeof u === 'string' && /^https:\/\//.test(u));
}

/** Only a published, public post is indexed: members-only, scheduled, held or deleted ones never are. */
export const isIndexablePost = (post: PermalinkPost) => (!post.visibility || post.visibility === 'public') && (!post.status || post.status === 'published');

export const postPermalink = (origin: string, locale: string, id: string) => `${origin}/${locale === 'ar' ? 'ar' : 'en'}/post/${encodeURIComponent(id)}`;

/** The permalink's SocialMediaPosting; the author is the channel (its page when it has a URL). */
export function socialMediaPostingLd(post: PermalinkPost, locale: string, origin: string, channelUrl: string) {
  const lang = locale === 'ar' ? 'ar' : 'en';
  const url = postPermalink(origin, lang, post.id);
  const text = postText(post);
  const image = postImage(post);
  const counters = [
    typeof post.likes === 'number' ? { '@type': 'InteractionCounter', interactionType: { '@type': 'LikeAction' }, userInteractionCount: post.likes } : null,
    typeof post.comments === 'number' ? { '@type': 'InteractionCounter', interactionType: { '@type': 'CommentAction' }, userInteractionCount: post.comments } : null,
  ].filter(Boolean);
  return {
    '@context': 'https://schema.org',
    '@type': 'SocialMediaPosting',
    '@id': `${url}#post`,
    url,
    mainEntityOfPage: url,
    headline: postHeadline(post, lang),
    ...(text ? { articleBody: text.slice(0, 5000) } : {}),
    ...(image ? { image } : {}),
    ...(post.createdAt ? { datePublished: post.createdAt } : {}),
    ...(post.updatedAt || post.createdAt ? { dateModified: post.updatedAt || post.createdAt } : {}),
    inLanguage: lang,
    author: { '@type': 'Organization', '@id': `${channelUrl}#channel`, name: postChannelName(post, lang), url: channelUrl },
    publisher: { '@id': WWW_ORGANIZATION_ID },
    ...(counters.length ? { interactionStatistic: counters } : {}),
  };
}
