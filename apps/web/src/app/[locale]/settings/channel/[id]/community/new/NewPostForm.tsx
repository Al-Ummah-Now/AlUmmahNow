'use client';
import { logger } from '@/lib/logger-client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PostType, PostVisibility, CreateCommunityPostRequest } from '@al-ummah/shared-types';
import Link from '@/components/common/AppLink';
import { Button } from '@/components/ui/button';
import ChannelSettingsBreadcrumb from '@/components/ChannelSettingsBreadcrumb';
import { useLanguage } from '@/hooks/useLanguage';
import { useHumanCheck } from '@/hooks/useHumanCheck';
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
import { createCommunityPost } from '@/lib/api/community-posts';
import { ArrowLeft, Loader2 } from 'lucide-react';

interface NewPostFormProps {
  locale: string;
  id: string;
  /** Rendered on the server, so the breadcrumb starts at the channel from the first paint */
  channelName: string;
  channelHandle: string | null;
}

export default function NewPostForm({ locale, id, channelName, channelHandle }: NewPostFormProps) {
  const router = useRouter();
  const { t } = useLanguage();
  const { ensureHuman } = useHumanCheck();
  const isRTL = locale === 'ar';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const [selectedType, setSelectedType] = useState<PostType | null>(null);
  const [visibility, setVisibility] = useState<PostVisibility>(PostVisibility.PUBLIC);
  const [commentsEnabled, setCommentsEnabled] = useState(true);

  const [textContent, setTextContent] = useState('');
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
  const [videoId, setVideoId] = useState('');
  const [videoContent, setVideoContent] = useState('');
  const [gif, setGif] = useState<GifData | null>(null);
  // PostV2 (post-schema.ts): every post has a language; articles, cards and links have their own fields
  const [postLocale, setPostLocale] = useState<'en' | 'ar'>(locale === 'ar' ? 'ar' : 'en');
  const [article, setArticle] = useState<ArticleFormData>(emptyArticle);
  const [cards, setCards] = useState<CardsFormData>(emptyCards);
  const [link, setLink] = useState<LinkFormData>(emptyLink);

  const validatePost = (): string | null => {
    if (!selectedType) return isRTL ? 'اختر نوع المنشور' : 'Select a post type';

    switch (selectedType) {
      case PostType.TEXT:
        if (!textContent.trim()) return isRTL ? 'المحتوى مطلوب' : 'Content is required';
        if (textContent.length > 5000) return isRTL ? 'المحتوى طويل جداً' : 'Content too long';
        break;

      case PostType.IMAGE:
        if (images.length === 0) return isRTL ? 'يجب رفع صورة واحدة على الأقل' : 'At least one image required';
        if (images.length > 10) return isRTL ? 'الحد الأقصى 10 صور' : 'Maximum 10 images';
        break;

      case PostType.POLL:
        if (!pollData.question.trim()) return isRTL ? 'السؤال مطلوب' : 'Question is required';
        if (pollData.options.length < 2) return isRTL ? 'الحد الأدنى خياران' : 'Minimum 2 options';
        if (pollData.options.some(opt => !opt.text.trim())) {
          return isRTL ? 'جميع الخيارات مطلوبة' : 'All options must be filled';
        }
        break;

      case PostType.QUIZ:
        if (!quizData.question.trim()) return isRTL ? 'السؤال مطلوب' : 'Question is required';
        if (quizData.options.length < 2) return isRTL ? 'الحد الأدنى خياران' : 'Minimum 2 options';
        if (quizData.options.some(opt => !opt.text.trim())) {
          return isRTL ? 'جميع الخيارات مطلوبة' : 'All options must be filled';
        }
        if (!quizData.correctOptionId) return isRTL ? 'حدد الإجابة الصحيحة' : 'Select correct answer';
        break;

      case PostType.VIDEO:
        if (!videoId.trim()) return isRTL ? 'معرف المرئي مطلوب' : 'Video ID is required';
        break;

      case PostType.GIF:
        if (!gif) return isRTL ? 'GIF مطلوب' : 'GIF is required';
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
          if (uploaded.some((u) => !u)) {
            setError(t.community.errorUpload);
            return;
          }
          baseData.images = images.map((img, i) => ({
            url: uploaded[i]!.url,
            width: uploaded[i]!.width ?? img.width,
            height: uploaded[i]!.height ?? img.height,
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
        router.push(`/${locale}/settings/channel/${id}/community`);
      } else {
        setError(isRTL ? 'فشل النشر' : 'Failed to publish');
      }
    } catch (err) {
      setError(isRTL ? 'حدث خطأ' : 'An error occurred');
      logger.error('Publish error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 md:px-6">
        <ChannelSettingsBreadcrumb channelId={id} channelName={channelName} channelHandle={channelHandle} locale={locale} currentPage="communityNew" />
      </div>
      <div className="
        border-b
        bg-card
        sticky top-0
        z-10
      ">
        <div className="
          container
          mx-auto
          px-4 py-3
          md:px-6 md:py-4
          flex
          items-center
          justify-between
        ">
          <div className="flex items-center gap-2 md:gap-3">
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="w-11 h-11"
            >
              <Link
                href={`/${locale}/settings/channel/${id}/community`}
                aria-label={t.common.backTo ? t.common.backTo.replace('{page}', t.channel.communitySettings || t.community.community) : t.common.back}
                data-testid="new-post-back"
              >
                <ArrowLeft className="w-5 h-5 rtl:-scale-x-100" aria-hidden="true" />
              </Link>
            </Button>
            <h1 className="text-lg md:text-2xl font-bold">
              {isRTL ? 'منشور جديد' : 'New Post'}
            </h1>
          </div>

          {/* Drafts are not supported by the API (posts are published or scheduled), so only Publish is offered */}
          <div className="flex gap-2">
            <Button
              onClick={handlePublish}
              disabled={loading || !selectedType}
            >
              {loading && <Loader2 className="w-4 h-4 mr-2 rtl:ml-2 rtl:mr-0 animate-spin" />}
              {isRTL ? 'نشر' : 'Publish'}
            </Button>
          </div>
        </div>
      </div>

      <div className="
        container
        mx-auto
        px-4 py-6
        md:px-6 md:py-8
        max-w-7xl
      ">
        <div className="
          grid
          grid-cols-1
          lg:grid-cols-3
          gap-6 md:gap-8
        ">
          <div className="lg:col-span-2 space-y-6">
            <Card className="p-4 md:p-6">
              <h2 className="text-base md:text-lg font-semibold mb-4">
                {isRTL ? 'اختر نوع المنشور' : 'Select Post Type'}
              </h2>
              <PostTypeSelector
                selected={selectedType}
                onSelect={setSelectedType}
                locale={locale}
              />
            </Card>

            {selectedType && (
              <Card className="p-4 md:p-6">
                <h2 className="text-base md:text-lg font-semibold mb-4">
                  {isRTL ? 'محتوى المنشور' : 'Post Content'}
                </h2>

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
                {isRTL ? 'الإعدادات' : 'Settings'}
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
                    {isRTL ? 'الرؤية' : 'Visibility'}
                  </Label>
                  <Select value={visibility} onValueChange={(v) => setVisibility(v as PostVisibility)}>
                    <SelectTrigger id="community-post-visibility" className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={PostVisibility.PUBLIC}>
                        {isRTL ? 'عام' : 'Public'}
                      </SelectItem>
                      <SelectItem value={PostVisibility.SUBSCRIBERS}>
                        {isRTL ? 'المشتركون فقط' : 'Subscribers only'}
                      </SelectItem>
                      <SelectItem value={PostVisibility.MEMBERS}>
                        {isRTL ? 'الأعضاء فقط' : 'Members only'}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <Label className="text-sm md:text-base">
                    {isRTL ? 'السماح بالتعليقات' : 'Allow Comments'}
                  </Label>
                  <Button
                    variant={commentsEnabled ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setCommentsEnabled(!commentsEnabled)}
                  >
                    {commentsEnabled
                      ? (isRTL ? 'مفعّل' : 'Enabled')
                      : (isRTL ? 'معطّل' : 'Disabled')
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
