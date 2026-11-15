'use client';
import { logger } from '@/lib/logger-client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PostType, PostVisibility, CreateCommunityPostRequest, type CommunityPost, type UpdateCommunityPostRequest } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { StudioBackLink } from '@/components/studio/StudioBackLink';
import { useLanguage } from '@/hooks/useLanguage';
import { useHumanCheck } from '@/hooks/useHumanCheck';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { ComposerAvatar } from '@/components/comments-shared/ComposerAvatar';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { PostTypeSelector } from '@/components/Community/management/PostTypeSelector';
import { TextPostForm } from '@/components/Community/management/forms/TextPostForm';
import { ImagePostForm, ImageWithCaption } from '@/components/Community/management/forms/ImagePostForm';
import { PollPostForm, PollFormData } from '@/components/Community/management/forms/PollPostForm';
import { QuizPostForm, QuizFormData } from '@/components/Community/management/forms/QuizPostForm';
import { VideoPostForm } from '@/components/Community/management/forms/VideoPostForm';
import { GifPostForm, GifData } from '@/components/Community/management/forms/GifPostForm';
import { ArticlePostForm, ArticleFormData, emptyArticle } from '@/components/Community/management/forms/ArticlePostForm';
import { CardsPostForm, CardsFormData, emptyCards } from '@/components/Community/management/forms/CardsPostForm';
import { LinkPostForm, LinkFormData, emptyLink } from '@/components/Community/management/forms/LinkPostForm';
import { uploadPostImage } from '@/components/Community/management/forms/PostImageField';
import { tooLargeMessage } from '@/lib/community/upload-limits';
import { createCommunityPost, updateCommunityPost } from '@/lib/api/community-posts';
import { Loader2 } from 'lucide-react';

interface PostFormProps {
  locale: string;
  channelId: string;
  /** Edit this post instead of writing a new one */
  post?: CommunityPost;
}

/**
 * Types whose content can't change after publishing: the API's update takes
 * text, articles, links, visibility and comments, not media, polls or quizzes.
 */
const CONTENT_LOCKED = new Set<PostType>([PostType.IMAGE, PostType.POLL, PostType.QUIZ, PostType.GIF, PostType.CARDS]);

/**
 * Content → Posts → New post, or a post's Edit page (spec §4.4.3). Moved from
 * /settings/channel/{id}/community/new; editing uses the existing PUT route.
 */
export default function PostForm({ locale, channelId, post }: PostFormProps) {
  const id = channelId;
  const editing = !!post;
  const router = useRouter();
  const { t, lang } = useLanguage();
  const postsHref = `/${locale}/studio/${encodeURIComponent(channelId)}/content/posts`;
  const { ensureHuman } = useHumanCheck();
  // The channel the post goes under: its logo (named for screen readers), no "Posting as" text
  const { user: account } = useMultiAccount();
  const postChannel = account?.channels?.find((c) => c.id === id);
  const postChannelName = postChannel?.nameLocalized?.[lang]?.trim() || postChannel?.name?.trim() || '';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const [selectedType, setSelectedType] = useState<PostType | null>(post?.type ?? null);
  const [visibility, setVisibility] = useState<PostVisibility>(post?.visibility ?? PostVisibility.PUBLIC);
  const [commentsEnabled, setCommentsEnabled] = useState(post?.commentsEnabled ?? true);

  const [textContent, setTextContent] = useState(post?.type === PostType.TEXT ? post.content ?? '' : '');
  const [images, setImages] = useState<ImageWithCaption[]>([]);
  const [pollData, setPollData] = useState<PollFormData>({
    question: '',
    options: [{ text: '' }, { text: '' }],
    multipleChoice: false
  });
  const [quizData, setQuizData] = useState<QuizFormData>({
    question: '',
    options: [
      { id: 'opt-1', text: '' },
      { id: 'opt-2', text: '' }
    ],
    correctOptionId: 'opt-1'
  });
  const [videoId, setVideoId] = useState(post?.videoId ?? '');
  const [videoContent, setVideoContent] = useState(post?.type === PostType.VIDEO ? post.content ?? '' : '');
  const [gif, setGif] = useState<GifData | null>(null);
  // PostV2 (post-schema.ts): every post has a language; articles, cards and links have their own fields
  const [postLocale, setPostLocale] = useState<'en' | 'ar'>(post?.locale === 'ar' || post?.locale === 'en' ? post.locale : locale === 'ar' ? 'ar' : 'en');
  const [article, setArticle] = useState<ArticleFormData>(() =>
    post?.article ? { title: post.article.title, excerpt: post.article.excerpt ?? '', body: post.article.body ?? '', cover: post.article.cover ?? null } : emptyArticle(),
  );
  // Media in an existing image, GIF or cards post is kept as it is (CONTENT_LOCKED)
  const [imageCaption, setImageCaption] = useState(post && CONTENT_LOCKED.has(post.type) ? post.content ?? '' : '');
  const [cards, setCards] = useState<CardsFormData>(emptyCards);
  const [link, setLink] = useState<LinkFormData>(() =>
    post?.link
      ? { url: post.link.url, title: post.link.title ?? '', description: post.link.description ?? '', siteName: post.link.siteName ?? '', image: post.link.image ?? null, comment: post.content ?? '' }
      : emptyLink(),
  );

  const validatePost = (): string | null => {
    if (!selectedType) return t.studio.postForm.selectType;

    switch (selectedType) {
      case PostType.TEXT:
        if (!textContent.trim()) return t.studio.postForm.contentRequired;
        if (textContent.length > 5000) return t.studio.postForm.contentTooLong;
        break;

      case PostType.IMAGE:
        if (images.length === 0) return t.studio.postForm.imageRequired;
        if (images.length > 10) return t.studio.postForm.imagesMax;
        break;

      case PostType.POLL:
        if (!pollData.question.trim()) return t.studio.postForm.questionRequired;
        if (pollData.options.length < 2) return t.studio.postForm.optionsMin;
        if (pollData.options.some(opt => !opt.text.trim())) {
          return t.studio.postForm.optionsFilled;
        }
        break;

      case PostType.QUIZ:
        if (!quizData.question.trim()) return t.studio.postForm.questionRequired;
        if (quizData.options.length < 2) return t.studio.postForm.optionsMin;
        if (quizData.options.some(opt => !opt.text.trim())) {
          return t.studio.postForm.optionsFilled;
        }
        if (!quizData.correctOptionId) return t.studio.postForm.correctAnswer;
        break;

      case PostType.VIDEO:
        if (!videoId.trim()) return t.studio.postForm.videoIdRequired;
        break;

      case PostType.GIF:
        if (!gif) return t.studio.postForm.gifRequired;
        break;

      case PostType.ARTICLE:
        if (!article.title.trim()) return t.community.errorTitle;
        if (!article.body.trim()) return t.community.errorBody;
        break;

      case PostType.CARDS:
        if (!cards.title.trim()) return t.community.errorTitle;
        if (!cards.cards.some((c) => c.image)) return t.community.errorCards;
        if (cards.cards.some((c) => c.image && !c.image.alt?.trim())) return t.community.errorAlt;
        break;

      case PostType.LINK:
        if (!/^https?:\/\/\S+$/i.test(link.url.trim())) return t.community.errorLink;
        break;
    }

    return null;
  };

  const handleSave = async () => {
    if (!post || !selectedType) return;
    const validationError = CONTENT_LOCKED.has(selectedType) ? null : validatePost();
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const update: UpdateCommunityPostRequest = { visibility, commentsEnabled, locale: postLocale };
      switch (selectedType) {
        case PostType.TEXT:
          update.content = textContent;
          break;
        case PostType.VIDEO:
          update.content = videoContent;
          break;
        case PostType.ARTICLE:
          update.content = article.excerpt.trim() || undefined;
          update.article = { title: article.title.trim(), excerpt: article.excerpt.trim() || null, body: article.body, cover: article.cover };
          break;
        case PostType.LINK:
          update.content = link.comment.trim() || undefined;
          update.link = { url: link.url.trim(), title: link.title.trim() || null, siteName: link.siteName.trim() || null, description: link.description.trim() || null, image: link.image };
          break;
        default:
          update.content = imageCaption;
      }
      const result = await updateCommunityPost(id, post.id, update, { channelId: id });
      if (result?.success) {
        router.push(postsHref);
      } else {
        setError(t.studio.posts.saveFailed);
      }
    } catch (err) {
      logger.error('[Studio] Post not saved', { channelId: id, postId: post.id, error: err });
      setError(t.studio.posts.saveFailed);
    } finally {
      setLoading(false);
    }
  };

  const handlePublish = async () => {
    const validationError = validatePost();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const baseData: Record<string, unknown> = {
        type: selectedType!,
        visibility,
        commentsEnabled,
        locale: postLocale
      };

      switch (selectedType) {
        case PostType.TEXT:
          baseData.content = textContent;
          break;

        case PostType.IMAGE: {
          // Upload first: the post stores the uploads' URLs (never the browser's preview URLs)
          const uploaded = await Promise.all(images.map((img) => (img.file ? uploadPostImage(id, img.file, img.caption || null) : null)));
          const media = uploaded.map((u) => (u?.ok ? u.media : null));
          if (media.some((m) => !m)) {
            // The API refused a file's size (the composer checks first, so only when the limits differ)
            const tooLarge = uploaded.find((u) => u && !u.ok && u.tooLarge);
            setError(tooLarge && !tooLarge.ok && tooLarge.tooLarge ? tooLargeMessage(t, lang, 'image', tooLarge.tooLarge) : t.community.errorUpload);
            return;
          }
          baseData.images = images.map((img, i) => ({
            url: media[i]!.url,
            width: media[i]!.width ?? img.width,
            height: media[i]!.height ?? img.height,
            caption: img.caption,
            mimeType: img.mimeType,
            size: img.size
          }));
          break;
        }

        case PostType.ARTICLE:
          baseData.content = article.excerpt.trim() || undefined;
          baseData.article = {
            title: article.title.trim(),
            excerpt: article.excerpt.trim() || null,
            body: article.body,
            cover: article.cover
          };
          break;

        case PostType.CARDS:
          baseData.title = cards.title.trim();
          baseData.slides = cards.cards
            .filter((c) => c.image)
            .map((c) => ({ id: c.id, image: c.image, heading: c.heading.trim() || null, body: c.body.trim() || null, position: c.position }));
          break;

        case PostType.LINK:
          baseData.content = link.comment.trim() || undefined;
          baseData.link = {
            url: link.url.trim(),
            title: link.title.trim() || null,
            siteName: link.siteName.trim() || null,
            description: link.description.trim() || null,
            image: link.image
          };
          break;

        case PostType.POLL:
          baseData.content = pollData.question;
          baseData.poll = {
            question: pollData.question,
            options: pollData.options,
            multipleChoice: pollData.multipleChoice,
            votingEndsAt: pollData.votingEndsAt
          };
          break;

        case PostType.QUIZ:
          baseData.content = quizData.question;
          baseData.quiz = {
            question: quizData.question,
            options: quizData.options,
            correctOptionId: quizData.correctOptionId,
            explanation: quizData.explanation
          };
          break;

        case PostType.VIDEO:
          baseData.videoId = videoId;
          baseData.content = videoContent;
          break;

        case PostType.GIF:
          baseData.gif = {
            width: gif!.width,
            height: gif!.height,
            duration: gif!.duration
          };
          break;
      }

      // An account's first post needs the Turnstile check (normally invisible)
      const human = await ensureHuman('post');
      if (!human.ok) {
        setError(t.humanCheck.failed);
        return;
      }
      const result = await createCommunityPost(id, baseData as unknown as CreateCommunityPostRequest, {
        channelId: id
      }, human.token);

      if (result?.success) {
        router.push(postsHref);
      } else {
        setError(t.studio.postForm.publishFailed);
      }
    } catch (err) {
      setError(t.studio.postForm.genericError);
      logger.error('[Studio] Post publish failed', { channelId, error: err });
    } finally {
      setLoading(false);
    }
  };

  const contentLocked = editing && !!selectedType && CONTENT_LOCKED.has(selectedType);

  return (
    <div className="max-w-6xl" data-testid={editing ? 'studio-post-edit' : 'studio-post-new'}>
      <StudioBackLink href={postsHref} label={t.studio.posts.back} />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ComposerAvatar src={postChannel?.avatarUrl} name={postChannelName} as="channel" testId="post-identity" />
          <h2 className="text-lg font-semibold text-foreground md:text-xl">
            {editing ? t.studio.posts.editHeading : t.community.newPost}
          </h2>
        </div>
        {/* Drafts are not supported by the API (posts are published or scheduled), so only Publish is offered */}
        <Button onClick={editing ? handleSave : handlePublish} disabled={loading || !selectedType} className="min-h-11" data-testid={editing ? 'post-save' : 'post-publish'}>
          {loading && <Loader2 aria-hidden="true" className="me-2 h-4 w-4 animate-spin motion-reduce:animate-none" />}
          {editing ? t.studio.posts.save : t.studio.postForm.publish}
        </Button>
      </div>
      {editing && error && (
        <p role="alert" className="mb-4 text-sm text-destructive" data-testid="post-save-error">{error}</p>
      )}

      <div>
        <div className="grid grid-cols-1 gap-6 md:gap-8 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            {!editing && (
              <Card className="p-4 md:p-6">
                <h3 className="text-base md:text-lg font-semibold mb-4">
                  {t.studio.postForm.typeHeading}
                </h3>
                <PostTypeSelector
                  selected={selectedType}
                  onSelect={setSelectedType}
                  locale={locale}
                />
              </Card>
            )}

            {contentLocked && (
              <Card className="p-4 md:p-6" data-testid="post-edit-locked">
                <p className="text-sm text-muted-foreground">{t.studio.posts.lockedFields}</p>
                <label htmlFor="post-edit-caption" className="mt-4 block text-sm font-medium text-foreground">{t.community.text}</label>
                <textarea
                  id="post-edit-caption"
                  dir="auto"
                  rows={4}
                  maxLength={5000}
                  value={imageCaption}
                  onChange={(e) => setImageCaption(e.target.value)}
                  className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </Card>
            )}

            {selectedType && !contentLocked && (
              <Card className="p-4 md:p-6">
                <h3 className="text-base md:text-lg font-semibold mb-4">
                  {t.studio.postForm.contentHeading}
                </h3>

                {selectedType === PostType.TEXT && (
                  <TextPostForm
                    content={textContent}
                    onChange={setTextContent}
                    locale={locale}
                    error={error}
                  />
                )}

                {selectedType === PostType.IMAGE && (
                  <ImagePostForm
                    images={images}
                    onChange={setImages}
                    locale={locale}
                    error={error}
                  />
                )}

                {selectedType === PostType.POLL && (
                  <PollPostForm
                    data={pollData}
                    onChange={setPollData}
                    locale={locale}
                    error={error}
                  />
                )}

                {selectedType === PostType.QUIZ && (
                  <QuizPostForm
                    data={quizData}
                    onChange={setQuizData}
                    locale={locale}
                    error={error}
                  />
                )}

                {selectedType === PostType.VIDEO && (
                  <VideoPostForm
                    videoId={videoId}
                    content={videoContent}
                    onVideoIdChange={setVideoId}
                    onContentChange={setVideoContent}
                    locale={locale}
                    error={error}
                  />
                )}

                {selectedType === PostType.GIF && (
                  <GifPostForm
                    gif={gif}
                    onChange={setGif}
                    locale={locale}
                    error={error}
                  />
                )}

                {selectedType === PostType.ARTICLE && (
                  <ArticlePostForm channelId={id} data={article} onChange={setArticle} postLocale={postLocale} error={error} />
                )}

                {selectedType === PostType.CARDS && (
                  <CardsPostForm channelId={id} data={cards} onChange={setCards} postLocale={postLocale} />
                )}

                {selectedType === PostType.LINK && (
                  <LinkPostForm channelId={id} data={link} onChange={setLink} postLocale={postLocale} />
                )}

                {error && [PostType.ARTICLE, PostType.CARDS, PostType.LINK].includes(selectedType) && (
                  <p role="alert" className="mt-4 text-sm text-destructive" data-testid="new-post-error">{error}</p>
                )}
              </Card>
            )}
          </div>

          <div className="space-y-6">
            <Card className="p-4 md:p-6">
              <h3 className="text-base md:text-lg font-semibold mb-4">
                {t.studio.postForm.settings}
              </h3>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="community-post-language" className="text-sm md:text-base">
                    {t.community.postLanguage}
                  </Label>
                  <Select value={postLocale} onValueChange={(v) => setPostLocale(v === 'ar' ? 'ar' : 'en')}>
                    <SelectTrigger id="community-post-language" className="mt-2" aria-describedby="community-post-language-hint">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="ar">العربية</SelectItem>
                    </SelectContent>
                  </Select>
                  <p id="community-post-language-hint" className="mt-1 text-xs text-muted-foreground">{t.community.postLanguageHint}</p>
                </div>

                <div>
                  <Label htmlFor="community-post-visibility" className="text-sm md:text-base">
                    {t.studio.postForm.visibility}
                  </Label>
                  <Select value={visibility} onValueChange={(v) => setVisibility(v as PostVisibility)}>
                    <SelectTrigger id="community-post-visibility" className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={PostVisibility.PUBLIC}>
                        {t.studio.postForm.public}
                      </SelectItem>
                      <SelectItem value={PostVisibility.SUBSCRIBERS}>
                        {t.studio.postForm.subscribers}
                      </SelectItem>
                      <SelectItem value={PostVisibility.MEMBERS}>
                        {t.studio.postForm.members}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <Label className="text-sm md:text-base">
                    {t.studio.postForm.allowComments}
                  </Label>
                  <Button
                    variant={commentsEnabled ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setCommentsEnabled(!commentsEnabled)}
                  >
                    {commentsEnabled
                      ? t.studio.postForm.enabled
                      : t.studio.postForm.disabled
                    }
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
