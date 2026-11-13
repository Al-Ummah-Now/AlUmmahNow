'use client';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface VideoPostFormProps {
  videoId: string;
  content: string;
  onVideoIdChange: (videoId: string) => void;
  onContentChange: (content: string) => void;
  locale: string;
  error?: string;
}

export function VideoPostForm({
  videoId,
  content,
  onVideoIdChange,
  onContentChange,
  locale,
  error
}: VideoPostFormProps) {
  const isRTL = locale === 'ar';

  return (
    <div className="space-y-4 md:space-y-6">
      <div>
        <Label htmlFor="video-id" className="text-sm md:text-base">
          {isRTL ? 'معرف المرئي' : 'Video ID'}
        </Label>
        <Input
          id="video-id"
          value={videoId}
          onChange={(e) => onVideoIdChange(e.target.value)}
          placeholder={isRTL ? 'أدخل معرف المرئي...' : 'Enter video ID...'}
          dir={isRTL ? 'rtl' : 'ltr'}
          className="mt-2 text-sm md:text-base"
        />
        <p className="text-xs md:text-sm text-muted-foreground mt-1">
          {isRTL
            ? 'معرف المرئي من قناتك أو قناة أخرى'
            : 'Video ID from your channel or another channel'
          }
        </p>
      </div>

      <div>
        <Label htmlFor="video-content" className="text-sm md:text-base">
          {isRTL ? 'التعليق (اختياري)' : 'Comment (optional)'}
        </Label>
        <Textarea
          id="video-content"
          value={content}
          onChange={(e) => onContentChange(e.target.value)}
          placeholder={isRTL
            ? 'أضف تعليقاً على المرئي...'
            : 'Add a comment about the video...'
          }
          dir={isRTL ? 'rtl' : 'ltr'}
          className="mt-2 min-h-[100px] text-sm md:text-base"
          maxLength={5000}
        />
        <p className="text-xs text-muted-foreground mt-1">
          {content.length}/5000
        </p>
      </div>

      {error && (
        <p className="text-destructive text-xs md:text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
