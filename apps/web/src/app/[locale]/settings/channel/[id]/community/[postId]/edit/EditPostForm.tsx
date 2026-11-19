'use client';

/**
 * The post editor (Story 29.4). What the API lets an author change after posting: the text, an
 * article's, cards' or link's fields, the language, who can see it, comments, and for a scheduled
 * post its time (or publish it now). A poll's or quiz's question and options, images, the GIF and
 * the linked video stay as posted; the page says so instead of offering fields that would be refused.
 */

import { useEffect, useState } from 'react';
import { Switch } from '@/components/common/Switch';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { PostStatus, PostType, PostVisibility, type CommunityPost, type UpdateCommunityPostRequest } from '@al-ummah/shared-types';
import ChannelSettingsBreadcrumb from '@/components/ChannelSettingsBreadcrumb';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TextPostForm } from '@/components/Community/management/forms/TextPostForm';
import { ArticlePostForm, type ArticleFormData } from '@/components/Community/management/forms/ArticlePostForm';
import { CardsPostForm, type CardsFormData } from '@/components/Community/management/forms/CardsPostForm';
import { LinkPostForm, type LinkFormData } from '@/components/Community/management/forms/LinkPostForm';
import { PostSchedulePicker, preferredZone, scheduleProblem, scheduleStateFrom, scheduledIso, type ScheduleProblem, type ScheduleState } from '@/components/Community/management/PostSchedulePicker';
import { updateCommunityPost } from '@/lib/api/community-posts';
import { reportError } from '@/lib/errors/reporter';
import { useLanguage } from '@/hooks/useLanguage';

interface EditPostFormProps {
  locale: string;
  channelId: string;
  post: CommunityPost;
  channelName: string;
  channelHandle: string | null;
}

/** Kinds whose text (`content`) can change; images, the GIF and the video stay. */
const CONTENT_KINDS = new Set<PostType>([PostType.TEXT, PostType.IMAGE, PostType.GIF, PostType.VIDEO]);
const MEDIA_KINDS = new Set<PostType>([PostType.IMAGE, PostType.GIF, PostType.VIDEO]);

function articleFrom(post: CommunityPost): ArticleFormData {
  return { title: post.article?.title ?? '', excerpt: post.article?.excerpt ?? '', body: post.article?.body ?? '', cover: post.article?.cover ?? null };
}

function cardsFrom(post: CommunityPost): CardsFormData {
  return {
    title: post.title ?? '',
    cards: (post.slides ?? []).map((slide, i) => ({
      id: slide.id || `card-${i + 1}`,
      image: slide.image ?? null,
      heading: slide.heading ?? '',
      body: slide.body ?? '',
      position: slide.position ?? 'bottom',
    })),
  };
}

function linkFrom(post: CommunityPost): LinkFormData {
  return {
    url: post.link?.url ?? '',
    title: post.link?.title ?? '',
    description: post.link?.description ?? '',
    siteName: post.link?.siteName ?? '',
    image: post.link?.image ?? null,
    comment: post.content ?? '',
  };
}

/** The composer's panel: the shared frosted card over the theme's card surface (see NewPostForm). */
const PANEL = 'pb-glass rounded-xl border border-[var(--fanous-color-divider)] bg-card p-4 md:p-6';

export default function EditPostForm({ locale, channelId, post, channelName, channelHandle }: EditPostFormProps) {
  const router = useRouter();
  const { t } = useLanguage();
  const texts = t.community;
  const isRTL = locale === 'ar';
  const listHref = `/${locale}/settings/channel/${channelId}/community`;

  const isScheduled = post.status === PostStatus.SCHEDULED;
  // A link-only mirror of a CMS article (no body) is edited in the CMS (api-videos validateUpdatePost)
  const cmsArticle = post.type === PostType.ARTICLE && typeof post.article?.body !== 'string';
  const locked = cmsArticle || post.type === PostType.POLL || post.type === PostType.QUIZ;

  const [content, setContent] = useState(post.content ?? '');
  const [article, setArticle] = useState<ArticleFormData>(() => articleFrom(post));
  const [cards, setCards] = useState<CardsFormData>(() => cardsFrom(post));
  const [link, setLink] = useState<LinkFormData>(() => linkFrom(post));
  const [postLocale, setPostLocale] = useState<'en' | 'ar'>(post.locale === 'ar' ? 'ar' : post.locale === 'en' ? 'en' : (locale === 'ar' ? 'ar' : 'en'));
  const [visibility, setVisibility] = useState<PostVisibility>(post.visibility ?? PostVisibility.PUBLIC);
  const [commentsEnabled, setCommentsEnabled] = useState(post.commentsEnabled !== false);
  // The wall-clock time depends on the viewer's zone, so it is set on the client (no hydration mismatch)
  const [schedule, setSchedule] = useState<ScheduleState>({ later: isScheduled, local: '' });
  useEffect(() => {
    setSchedule(scheduleStateFrom(isScheduled ? post.scheduledAt : null, preferredZone()));
  }, [isScheduled, post.scheduledAt]);
  const [scheduleError, setScheduleError] = useState<ScheduleProblem | null>(null);
  const [saving, setSaving] = useState<'save' | 'publish' | null>(null);
  // A field problem (shown by the form, or below it) and a failed save (always below)
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');

  /** The fields that changed, as the API takes them (null: a validation message was shown). */
  const changes = (): UpdateCommunityPostRequest | null => {
    const body: UpdateCommunityPostRequest = {};
    if (CONTENT_KINDS.has(post.type)) {
      if (post.type === PostType.TEXT && !content.trim()) {
        setError(isRTL ? 'المحتوى مطلوب' : 'Content is required');
        return null;
      }
      if (content !== (post.content ?? '')) body.content = content;
    }
    if (post.type === PostType.ARTICLE && !cmsArticle) {
      if (!article.title.trim()) { setError(texts.errorTitle); return null; }
      if (!article.body.trim()) { setError(texts.errorBody); return null; }
      body.article = { title: article.title.trim(), excerpt: article.excerpt.trim() || null, body: article.body, cover: article.cover };
      body.content = article.excerpt.trim();
    }
    if (post.type === PostType.CARDS) {
      if (!cards.title.trim()) { setError(texts.errorTitle); return null; }
      if (!cards.cards.some((c) => c.image)) { setError(texts.errorCards); return null; }
      if (cards.cards.some((c) => c.image && !c.image.alt?.trim())) { setError(texts.errorAlt); return null; }
      body.title = cards.title.trim();
      body.slides = cards.cards.filter((c) => c.image).map((c) => ({ id: c.id, image: c.image!, heading: c.heading.trim() || null, body: c.body.trim() || null, position: c.position }));
    }
    if (post.type === PostType.LINK) {
      if (!/^https?:\/\/\S+$/i.test(link.url.trim())) { setError(texts.errorLink); return null; }
      body.link = { url: link.url.trim(), title: link.title.trim() || null, siteName: link.siteName.trim() || null, description: link.description.trim() || null, image: link.image };
      if (link.comment !== (post.content ?? '')) body.content = link.comment.trim();
    }
    if (!cmsArticle && postLocale !== post.locale) body.locale = postLocale;
    if (visibility !== (post.visibility ?? PostVisibility.PUBLIC)) body.visibility = visibility;
    if (commentsEnabled !== (post.commentsEnabled !== false)) body.commentsEnabled = commentsEnabled;
    if (isScheduled) {
      const problem = scheduleProblem(schedule.local, Date.now(), schedule.zone);
      const iso = scheduledIso({ ...schedule, later: true });
      const before = post.scheduledAt ? new Date(post.scheduledAt).toISOString() : null;
      // An unchanged time that has come close (or passed) is left as it is
      if (iso !== before) {
        setScheduleError(problem);
        if (problem) return null;
        body.scheduledAt = iso!;
      }
    }
    return body;
  };

  const submit = async (publishNow: boolean) => {
    setError('');
    setActionError('');
    setScheduleError(null);
    const body = changes();
    if (!body) return;
    if (publishNow) {
      delete body.scheduledAt;
      body.publishNow = true;
    }
    if (Object.keys(body).length === 0) {
      router.push(listHref);
      return;
    }
    setSaving(publishNow ? 'publish' : 'save');
    try {
      const result = await updateCommunityPost(channelId, post.id, body, { channelId });
      if (!result?.success) throw new Error(publishNow ? 'Publish post now refused' : 'Update post refused');
      router.push(listHref);
    } catch (err) {
      reportError(err, { shown: true, extra: { channelId, postId: post.id, action: publishNow ? 'publish_post_now' : 'update_post' } });
      setActionError(publishNow ? texts.publishFailed : texts.saveFailed);
    } finally {
      setSaving(null);
    }
  };

  const typeLabel: Record<PostType, string> = {
    [PostType.TEXT]: texts.text,
    [PostType.IMAGE]: texts.image,
    [PostType.POLL]: texts.poll,
    [PostType.QUIZ]: texts.quiz,
    [PostType.VIDEO]: texts.video,
    [PostType.GIF]: texts.gif,
    [PostType.ARTICLE]: texts.article,
    [PostType.CARDS]: texts.cards,
    [PostType.LINK]: texts.link,
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-7xl px-4 md:px-6">
        <ChannelSettingsBreadcrumb channelId={channelId} channelName={channelName} channelHandle={channelHandle} locale={locale} currentPage="community" subPage={texts.editPostTitle} />
      </div>
      {/* A flat bar as wide as the columns (the composer's, owner review) */}
      <div className="sticky top-0 z-10 bg-[var(--fanous-color-background)]">
        <div className="container mx-auto max-w-7xl px-4 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--fanous-color-divider)] py-3 md:py-4">
          <div className="flex items-center gap-2 md:gap-3">
            {/* The way back is the breadcrumb's arrow above (one back link per page, owner review) */}
            <h1 className="text-lg md:text-2xl font-bold">{texts.editPostTitle}</h1>
            <Badge variant="secondary">{typeLabel[post.type] ?? post.type}</Badge>
          </div>
          <div className="flex gap-2">
            {isScheduled && (
              <Button variant="outline" onClick={() => submit(true)} disabled={saving !== null} data-testid="edit-post-publish-now">
                {saving === 'publish' && <Loader2 className="w-4 h-4 me-2 animate-spin" aria-hidden="true" />}
                {texts.publishNow}
              </Button>
            )}
            <Button onClick={() => submit(false)} disabled={saving !== null} data-testid="edit-post-save">
              {saving === 'save' && <Loader2 className="w-4 h-4 me-2 animate-spin" aria-hidden="true" />}
              {saving === 'save' ? texts.saving : texts.saveChanges}
            </Button>
          </div>
        </div>
        </div>
      </div>

      <div className="container mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8">
        <div className="grid grid-cols-1 gap-6 md:gap-8 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <section className={PANEL}>
              {cmsArticle ? (
                <p className="text-sm text-muted-foreground" data-testid="edit-post-locked">{texts.articleManagedInCms}</p>
              ) : locked ? (
                <>
                  <p className="mb-3 font-medium">{post.poll?.question || post.quiz?.question || post.content}</p>
                  <p className="text-sm text-muted-foreground" data-testid="edit-post-locked">{texts.pollLocked}</p>
                </>
              ) : (
                <>
                  {CONTENT_KINDS.has(post.type) && <TextPostForm content={content} onChange={setContent} locale={locale} error={error} />}
                  {MEDIA_KINDS.has(post.type) && (
                    <p className="mt-3 text-sm text-muted-foreground" data-testid="edit-post-media-note">{texts.mediaLocked}</p>
                  )}
                  {post.type === PostType.ARTICLE && <ArticlePostForm channelId={channelId} data={article} onChange={setArticle} postLocale={postLocale} error={error} />}
                  {post.type === PostType.CARDS && <CardsPostForm channelId={channelId} data={cards} onChange={setCards} postLocale={postLocale} />}
                  {post.type === PostType.LINK && <LinkPostForm channelId={channelId} data={link} onChange={setLink} postLocale={postLocale} />}
                </>
              )}
              {/* Text and article forms show their own field problem; cards and links show it here */}
              {error && (post.type === PostType.CARDS || post.type === PostType.LINK) && (
                <p role="alert" className="mt-4 text-sm text-[var(--fanous-color-error-text)]" data-testid="edit-post-error">{error}</p>
              )}
              {actionError && (
                <p role="alert" className="mt-4 text-sm text-[var(--fanous-color-error-text)]" data-testid="edit-post-error">{actionError}</p>
              )}
            </section>
          </div>

          <div className="space-y-6">
            <section className={PANEL}>
              <h2 className="mb-4 text-base font-semibold md:text-lg">{isRTL ? 'الإعدادات' : 'Settings'}</h2>
              <div className="space-y-4">
                {isScheduled && (
                  <PostSchedulePicker
                    timeOnly
                    value={schedule}
                    onChange={(next) => { setSchedule(next); setScheduleError(null); }}
                    problem={scheduleError}
                    disabled={saving !== null}
                  />
                )}
                {!cmsArticle && (
                  <div>
                    <Label htmlFor="edit-post-language" className="text-sm md:text-base">{texts.postLanguage}</Label>
                    <Select value={postLocale} onValueChange={(v) => setPostLocale(v === 'ar' ? 'ar' : 'en')}>
                      <SelectTrigger id="edit-post-language" className="mt-2">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="ar">العربية</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div>
                  <Label htmlFor="edit-post-visibility" className="text-sm md:text-base">{isRTL ? 'الرؤية' : 'Visibility'}</Label>
                  <Select value={visibility} onValueChange={(v) => setVisibility(v as PostVisibility)}>
                    <SelectTrigger id="edit-post-visibility" className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={PostVisibility.PUBLIC}>{isRTL ? 'عام' : 'Public'}</SelectItem>
                      <SelectItem value={PostVisibility.SUBSCRIBERS}>{isRTL ? 'المشتركون فقط' : 'Subscribers only'}</SelectItem>
                      <SelectItem value={PostVisibility.MEMBERS}>{isRTL ? 'الأعضاء فقط' : 'Members only'}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {/* Ids without "comments": the themes pad [id*="comments"] (the comment section) */}
                <div className="flex items-center justify-between gap-3">
                  <label id="edit-post-allow-comment-label" htmlFor="edit-post-allow-comment-toggle" className="text-sm font-medium md:text-base">{t.community.allowComments}</label>
                  <Switch
                    id="edit-post-allow-comment-toggle"
                    checked={commentsEnabled}
                    onCheckedChange={setCommentsEnabled}
                    aria-labelledby="edit-post-allow-comment-label"
                    data-testid="edit-post-allow-comments"
                  />
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
