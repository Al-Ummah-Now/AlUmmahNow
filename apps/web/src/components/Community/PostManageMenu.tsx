'use client';

/**
 * The channel owner's menu on a post card (Story 29.4): Edit opens the post editor, Delete asks in
 * the in-app dialog, then removes the post. Only rendered for the owner acting as the post's channel
 * (the API refuses everyone else).
 */

import { useState } from 'react';
import type { CommunityPost } from '@al-ummah/shared-types';
import { MoreVertical, Pencil, Trash2 } from 'lucide-react';
import Link from '@/components/common/AppLink';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
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
import { deleteCommunityPost } from '@/lib/api/community-posts';
import { reportError } from '@/lib/errors/reporter';
import { useLanguage } from '@/hooks/useLanguage';

/** The post editor's address. */
export function editPostHref(locale: string, post: Pick<CommunityPost, 'id' | 'channelId'>): string {
  return `/${locale === 'ar' ? 'ar' : 'en'}/settings/channel/${encodeURIComponent(post.channelId)}/community/${encodeURIComponent(post.id)}/edit`;
}

interface PostManageMenuProps {
  post: Pick<CommunityPost, 'id' | 'channelId'>;
  onDeleted?: (postId: string) => void;
}

export default function PostManageMenu({ post, onDeleted }: PostManageMenuProps) {
  const { t, lang, isRTL } = useLanguage();
  const texts = t.community;
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [failed, setFailed] = useState(false);

  const remove = async (event: React.MouseEvent) => {
    // Keep the dialog open until the delete is done (and on failure, to show it)
    event.preventDefault();
    setDeleting(true);
    setFailed(false);
    try {
      const result = await deleteCommunityPost(post.channelId, post.id, { channelId: post.channelId });
      if (!result?.success) throw new Error('Delete post refused');
      setConfirming(false);
      onDeleted?.(post.id);
    } catch (error) {
      reportError(error, { shown: true, extra: { postId: post.id, channelId: post.channelId, action: 'delete_post' } });
      setFailed(true);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="shrink-0 rounded-full" aria-label={texts.postActions} data-testid="post-owner-actions">
            <MoreVertical className="h-5 w-5" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={isRTL ? 'start' : 'end'}>
          <DropdownMenuItem asChild>
            <Link href={editPostHref(lang, post)} data-testid="post-owner-edit">
              <Pencil className="h-4 w-4 me-2" aria-hidden="true" />
              {texts.editPost}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => { setFailed(false); setConfirming(true); }}
            className="text-destructive focus:text-destructive"
            data-testid="post-owner-delete"
          >
            <Trash2 className="h-4 w-4 me-2" aria-hidden="true" />
            {texts.deletePost}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirming} onOpenChange={(open) => !deleting && setConfirming(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{texts.deletePostTitle}</AlertDialogTitle>
            <AlertDialogDescription>{texts.deletePostBody}</AlertDialogDescription>
          </AlertDialogHeader>
          {failed && (
            <p role="alert" className="text-sm text-destructive" data-testid="post-delete-error">
              {texts.deleteFailed}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{texts.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={remove}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="post-delete-confirm"
            >
              {deleting ? texts.deleting : texts.deletePost}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
