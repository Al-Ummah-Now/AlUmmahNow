import { logger } from '@/lib/logger-client';
import { useLanguage } from '@/hooks/useLanguage';

import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { CommunityPost, PostType, PostStatus, formatCompact, formatCountNoun, formatTimeAgo } from '@al-ummah/shared-types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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

interface PostCardProps {
  post: CommunityPost;
  locale: string;
  onView: (post: CommunityPost) => void;
  /** Omit to hide the Edit action (there is no post edit page yet) */
  onEdit?: (post: CommunityPost) => void;
  onDelete: (postId: string) => Promise<void>;
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

export function PostCard({ post, locale, onView, onEdit, onDelete }: PostCardProps) {
  const isRTL = locale === 'ar';
  // Whether the text is cut at two lines (measured, and again when the card's width changes)
  const textRef = useRef<HTMLParagraphElement>(null);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [post.content]);
  const { t } = useLanguage();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDelete(post.id);
      setShowDeleteDialog(false);
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
    <>
      <Card glass="lite" className="p-4 md:p-6" data-testid="managed-post" data-post-id={post.id}>
        <div className="space-y-3 md:space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-2">
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

              {/* Its own direction for the words and two lines that end in an ellipsis (the fading clamp left a
                  short second line looking cut off). An uncut text lines up with the page's edge, like Studio
                  comments; a cut one takes its own start: pinned to the page's edge, an Arabic text's ellipsis in
                  the English Studio fell outside the card. Two cut lines fill the width, so they still line up */}
              <p ref={textRef} className={cn('text-sm md:text-base line-clamp-2 [overflow-wrap:break-word] mb-2', clamped ? 'text-start' : 'text-left [html[dir=rtl]_&]:text-right')} dir="auto" data-testid="post-card-text" data-clamped={clamped || undefined}>
                {post.content || post.poll?.question || post.quiz?.question || (isRTL ? 'بدون محتوى' : 'No content')}
              </p>

              <div className="flex items-center gap-3 md:gap-4 text-xs md:text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3 md:w-4 md:h-4" />
                  {timeAgo}
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

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  aria-label={t.channelManage.postActions}
                  data-testid="post-actions"
                >
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              {/* Below the button (never over the author line), its end edge on the button's: inside the screen in both directions */}
              <DropdownMenuContent side="bottom" align="end">
                <DropdownMenuItem onClick={() => onView(post)}>
                  <Eye className="w-4 h-4" aria-hidden="true" />
                  {isRTL ? 'عرض' : 'View'}
                </DropdownMenuItem>
                {onEdit && (
                  <DropdownMenuItem onClick={() => onEdit(post)}>
                    <Edit className="w-4 h-4" aria-hidden="true" />
                    {isRTL ? 'تعديل' : 'Edit'}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => setShowDeleteDialog(true)}>
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                  {isRTL ? 'حذف' : 'Delete'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </Card>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isRTL ? 'تأكيد الحذف' : 'Confirm Delete'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isRTL
                ? 'هل أنت متأكد من حذف هذا المنشور؟ لا يمكن التراجع عن هذا الإجراء.'
                : 'Are you sure you want to delete this post? This action cannot be undone.'
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {isRTL ? 'إلغاء' : 'Cancel'}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (isRTL ? 'جاري الحذف...' : 'Deleting...') : (isRTL ? 'حذف' : 'Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
