import { logger } from '@/lib/logger-client';
import { useLanguage } from '@/hooks/useLanguage';

import { useState } from 'react';
import { CommunityPost, PostType, PostStatus, formatCompact, formatCountNoun, formatTimeAgo } from '@al-ummah/shared-types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  MoreVertical,
  Eye,
  Edit,
  Trash2,
  Pin,
  Calendar,
  ThumbsUp,
  MessageSquare
} from 'lucide-react';
import { formatScheduledAt } from './PostSchedulePicker';

interface PostCardProps {
  post: CommunityPost;
  locale: string;
  onView: (post: CommunityPost) => void;
  /** Omit to hide the Edit action */
  onEdit?: (post: CommunityPost) => void;
  onDelete: (postId: string) => Promise<void>;
  /** A scheduled post: publish it now (Story 29.4) */
  onPublishNow?: (post: CommunityPost) => Promise<void>;
}

const POST_TYPE_LABELS = {
  [PostType.TEXT]: { en: 'Text', ar: 'نص' },
  [PostType.IMAGE]: { en: 'Image', ar: 'صورة' },
  [PostType.POLL]: { en: 'Poll', ar: 'استطلاع' },
  [PostType.QUIZ]: { en: 'Quiz', ar: 'اختبار' },
  [PostType.VIDEO]: { en: 'Video', ar: 'مرئي' },
  [PostType.GIF]: { en: 'GIF', ar: 'GIF' },
  [PostType.ARTICLE]: { en: 'Article', ar: 'مقال' },
  [PostType.CARDS]: { en: 'Cards', ar: 'بطاقات' },
  [PostType.LINK]: { en: 'Link', ar: 'رابط' }
};

const STATUS_LABELS = {
  [PostStatus.PUBLISHED]: { en: 'Published', ar: 'منشور' },
  [PostStatus.SCHEDULED]: { en: 'Scheduled', ar: 'مجدول' },
  [PostStatus.DRAFT]: { en: 'Draft', ar: 'مسودة' },
  [PostStatus.DELETED]: { en: 'Deleted', ar: 'محذوف' }
};

export function PostCard({ post, locale, onView, onEdit, onDelete, onPublishNow }: PostCardProps) {
  const isRTL = locale === 'ar';
  const { t } = useLanguage();
  const [deleting, setDeleting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const isScheduled = post.status === PostStatus.SCHEDULED && !!post.scheduledAt;
  const publishNow = async () => {
    if (!onPublishNow) return;
    setPublishing(true);
    try {
      await onPublishNow(post);
    } finally {
      setPublishing(false);
    }
  };

  // No confirm: the delete is a 30-day soft delete with an Undo toast (the page's onDelete)
  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDelete(post.id);
    } catch (error) {
      logger.error('Delete failed:', error);
    } finally {
      setDeleting(false);
    }
  };

  const getStatusColor = (status: PostStatus) => {
    switch (status) {
      case PostStatus.PUBLISHED:
        return 'bg-green-700 text-white';
      case PostStatus.SCHEDULED:
        return 'bg-blue-700 text-white';
      case PostStatus.DRAFT:
        return 'bg-gray-600 text-white';
      case PostStatus.DELETED:
        return 'bg-red-700 text-white';
      default:
        return 'bg-gray-600 text-white';
    }
  };

  const timeAgo = formatTimeAgo(isRTL ? 'ar' : 'en', post.createdAt, { numeric: 'always' });

  return (
    <Card glass="lite" className="p-4 md:p-6" data-testid="managed-post" data-post-id={post.id}>
      <div className="space-y-3 md:space-y-4">
        {/* Badges with the actions on one row; the text and the meta line take the full width below */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <Badge variant="secondary">
              {isRTL ? POST_TYPE_LABELS[post.type].ar : POST_TYPE_LABELS[post.type].en}
            </Badge>
            <Badge className={getStatusColor(post.status)}>
              {isRTL ? STATUS_LABELS[post.status].ar : STATUS_LABELS[post.status].en}
            </Badge>
            {post.pinned && (
              <Badge variant="outline" className="gap-1">
                <Pin className="w-3 h-3" />
                {isRTL ? 'مثبت' : 'Pinned'}
              </Badge>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {isScheduled && onPublishNow && (
              <Button variant="outline" size="sm" onClick={publishNow} disabled={publishing} data-testid="managed-post-publish-now">
                {t.community.publishNow}
              </Button>
            )}
            {/* Not modal: the rest of the page is never aria-hidden while it is open */}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="shrink-0" aria-label={t.channelManage.postActions} data-testid="post-actions">
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              {/* Below the button (never over the author line), its end edge on the button's: inside the screen in both directions */}
              <DropdownMenuContent side="bottom" align="end">
                <DropdownMenuItem onClick={() => onView(post)}>
                  <Eye className="w-4 h-4 me-2" aria-hidden="true" />
                  {t.community.viewPost}
                </DropdownMenuItem>
                {onEdit && (
                  <DropdownMenuItem onClick={() => onEdit(post)}>
                    <Edit className="w-4 h-4 me-2" aria-hidden="true" />
                    {t.community.editPost}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                  className="text-[var(--fanous-color-error-text)] focus:text-[var(--fanous-color-error-text)]"
                  data-testid="studio-post-delete"
                >
                  <Trash2 className="w-4 h-4 me-2 text-[var(--fanous-color-error-text)]" aria-hidden="true" />
                  {deleting ? t.community.deleting : t.community.deletePost}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Its own direction for the words, the page's edge for the line (like Studio comments), and two
            lines that end in an ellipsis: the fading clamp left a short second line looking cut off */}
        <p className="text-sm md:text-base line-clamp-2 [overflow-wrap:break-word] text-left [html[dir=rtl]_&]:text-right" dir="auto" data-testid="post-card-text">
          {post.content || post.poll?.question || post.quiz?.question || (isRTL ? 'بدون محتوى' : 'No content')}
        </p>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground md:gap-x-4 md:text-sm">
          {/* The date on its own line on a phone (it never squeezes into a column), the counts after it */}
          <span className="flex basis-full items-center gap-1 sm:basis-auto" data-testid={isScheduled ? 'managed-post-scheduled-at' : undefined}>
            <Calendar className="h-3.5 w-3.5 shrink-0 md:h-4 md:w-4" aria-hidden="true" />
            {isScheduled ? t.community.scheduledFor.replace('{date}', formatScheduledAt(post.scheduledAt!, locale)) : timeAgo}
          </span>
          <span className="flex items-center gap-1" title={formatCountNoun(isRTL ? 'ar' : 'en-US', post.views, 'view')}>
            <Eye className="w-3 h-3 md:w-4 md:h-4" aria-hidden="true" />
            <span aria-hidden="true">{formatCompact(isRTL ? 'ar' : 'en-US', post.views ?? 0)}</span>
            <span className="sr-only">{formatCountNoun(isRTL ? 'ar' : 'en-US', post.views, 'view')}</span>
          </span>
          <span className="flex items-center gap-1" title={formatCountNoun(isRTL ? 'ar' : 'en-US', post.likes, 'like')}>
            <ThumbsUp className="w-3 h-3 md:w-4 md:h-4" aria-hidden="true" />
            <span aria-hidden="true">{formatCompact(isRTL ? 'ar' : 'en-US', post.likes ?? 0)}</span>
            <span className="sr-only">{formatCountNoun(isRTL ? 'ar' : 'en-US', post.likes, 'like')}</span>
          </span>
          <span className="flex items-center gap-1" title={formatCountNoun(isRTL ? 'ar' : 'en-US', post.comments, 'comment')}>
            <MessageSquare className="w-3 h-3 md:w-4 md:h-4" aria-hidden="true" />
            <span aria-hidden="true">{formatCompact(isRTL ? 'ar' : 'en-US', post.comments ?? 0)}</span>
            <span className="sr-only">{formatCountNoun(isRTL ? 'ar' : 'en-US', post.comments, 'comment')}</span>
          </span>
        </div>
      </div>
    </Card>
  );
}
