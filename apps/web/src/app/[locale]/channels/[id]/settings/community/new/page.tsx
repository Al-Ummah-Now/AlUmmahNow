'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PostType, PostVisibility } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
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
import { createCommunityPost } from '@/lib/api/community-posts';
import { ArrowLeft, Loader2 } from 'lucide-react';

interface NewPostPageProps {
  params: {
    locale: string;
    id: string;
  };
}

export default function NewPostPage({ params }: NewPostPageProps) {
  const router = useRouter();
  const isRTL = params.locale === 'ar';
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
        if (!videoId.trim()) return isRTL ? 'معرف الفيديو مطلوب' : 'Video ID is required';
        break;

      case PostType.GIF:
        if (!gif) return isRTL ? 'GIF مطلوب' : 'GIF is required';
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
      const baseData: any = {
        type: selectedType!,
        visibility,
        commentsEnabled
      };

      switch (selectedType) {
        case PostType.TEXT:
          baseData.content = textContent;
          break;

        case PostType.IMAGE:
          baseData.images = images.map(img => ({
            width: img.width,
            height: img.height,
            caption: img.caption,
            mimeType: img.mimeType,
            size: img.size
          }));
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

      const result = await createCommunityPost(baseData, {
        channelId: params.id,
        userId: ''
      });

      if (result?.success) {
        router.push(`/${params.locale}/channels/${params.id}/settings/community`);
      } else {
        setError(isRTL ? 'فشل النشر' : 'Failed to publish');
      }
    } catch (err) {
      setError(isRTL ? 'حدث خطأ' : 'An error occurred');
      console.error('Publish error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveDraft = async () => {
  };

  return (
    <div className="min-h-screen bg-background">
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
              variant="ghost"
              size="icon"
              onClick={() => router.back()}
              className="w-8 h-8 md:w-10 md:h-10"
            >
              <ArrowLeft className="w-4 h-4 md:w-5 md:h-5" />
            </Button>
            <h1 className="text-lg md:text-2xl font-bold">
              {isRTL ? 'منشور جديد' : 'New Post'}
            </h1>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleSaveDraft}
              disabled={loading}
              className="hidden sm:inline-flex"
            >
              {isRTL ? 'حفظ كمسودة' : 'Save Draft'}
            </Button>
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
                locale={params.locale}
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
                    locale={params.locale}
                    error={error}
                  />
                )}

                {selectedType === PostType.IMAGE && (
                  <ImagePostForm
                    images={images}
                    onChange={setImages}
                    locale={params.locale}
                    error={error}
                  />
                )}

                {selectedType === PostType.POLL && (
                  <PollPostForm
                    data={pollData}
                    onChange={setPollData}
                    locale={params.locale}
                    error={error}
                  />
                )}

                {selectedType === PostType.QUIZ && (
                  <QuizPostForm
                    data={quizData}
                    onChange={setQuizData}
                    locale={params.locale}
                    error={error}
                  />
                )}

                {selectedType === PostType.VIDEO && (
                  <VideoPostForm
                    videoId={videoId}
                    content={videoContent}
                    onVideoIdChange={setVideoId}
                    onContentChange={setVideoContent}
                    locale={params.locale}
                    error={error}
                  />
                )}

                {selectedType === PostType.GIF && (
                  <GifPostForm
                    gif={gif}
                    onChange={setGif}
                    locale={params.locale}
                    error={error}
                  />
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
                  <Label className="text-sm md:text-base">
                    {isRTL ? 'الرؤية' : 'Visibility'}
                  </Label>
                  <Select value={visibility} onValueChange={(v) => setVisibility(v as PostVisibility)}>
                    <SelectTrigger className="mt-2">
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
