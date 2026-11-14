import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { JsonLd } from '@/components/seo/JsonLd';
import PostPermalinkView from '@/components/Community/permalink/PostPermalinkView';
import { loadPermalinkPost } from '@/lib/community/post-permalink';
import { loadChannelById } from '@/lib/channel-loaders';
import { channelPath } from '@/lib/channel-url';
import { originFromHost } from '@/lib/embed/request-origin';
import { ContentUnavailableError } from '@/lib/seo/availability';
import { breadcrumbLd, siteName } from '@/lib/seo/structured-data';
import { isIndexablePost, postChannelName, postDescription, postHeadline, postImage, postPermalink, socialMediaPostingLd } from '@/lib/seo/post';

interface PostPageProps {
  params: Promise<{ locale: string; id: string }>;
}

/** The channel's page path, by handle when it has one (its @handle URL is the canonical one). */
async function channelHref(locale: string, channelId: string): Promise<string> {
  const channel = await loadChannelById(channelId).catch(() => null);
  return channelPath(locale, { id: channelId, handle: channel?.handle });
}

/**
 * Title from the post's first line, description from its first 160 characters, its image, each
 * language its own canonical with the en/ar pair and x-default English (D-SEO-1). A post that is not
 * public (members, subscribers) renders for whoever may see it but is never indexed.
 */
export async function generateMetadata({ params }: PostPageProps): Promise<Metadata> {
  const { locale, id } = await params;
  const lang = locale === 'ar' ? 'ar' : 'en';
  const read = await loadPermalinkPost(id);
  if (read.status !== 'ok') return { robots: { index: false, follow: false } };
  const { post } = read;
  const title = postHeadline(post, lang);
  const description = postDescription(post, lang);
  const image = postImage(post);
  const host = (await headers()).get('host');
  const url = (l: string) => (host ? postPermalink(originFromHost(host), l, id) : `/${l}/post/${encodeURIComponent(id)}`);
  return {
    title,
    description,
    alternates: { canonical: url(lang), languages: { en: url('en'), ar: url('ar'), 'x-default': url('en') } },
    openGraph: { type: 'article', siteName: siteName(lang), url: url(lang), title, description, ...(image ? { images: [{ url: image }] } : {}), ...(post.createdAt ? { publishedTime: post.createdAt } : {}) },
    twitter: { card: image ? 'summary_large_image' : 'summary', title, description, ...(image ? { images: [image] } : {}) },
    ...(isIndexablePost(post) ? {} : { robots: { index: false, follow: false } }),
  };
}

/**
 * A community post's own page: /[locale]/post/[id] (wiki AUN-SEO, post permalinks). Linked from the
 * time on every post card. 404 when nobody here may see the post, 503 when the API is down.
 */
export default async function PostPage({ params }: PostPageProps) {
  const { locale, id } = await params;
  const lang = locale === 'ar' ? 'ar' : 'en';
  const read = await loadPermalinkPost(id);
  if (read.status === 'missing') notFound();
  if (read.status === 'unavailable') throw new ContentUnavailableError('a community post');
  const { post } = read;
  const channelUrl = await channelHref(lang, post.channelId);
  const host = (await headers()).get('host');
  const origin = host ? originFromHost(host) : '';
  const ld = host && isIndexablePost(post)
    ? [
        socialMediaPostingLd(post, lang, origin, `${origin}${channelUrl}`),
        breadcrumbLd([
          { name: postChannelName(post, lang), url: `${origin}${channelUrl}` },
          { name: postHeadline(post, lang), url: postPermalink(origin, lang, id) },
        ]),
      ]
    : null;

  return (
    <main className="flex-1 min-h-screen bg-[var(--fanous-color-background)]">
      {ld ? <JsonLd data={ld} /> : null}
      <PostPermalinkView post={post} locale={lang} channelHref={channelUrl} channelName={postChannelName(post, lang)} />
    </main>
  );
}
