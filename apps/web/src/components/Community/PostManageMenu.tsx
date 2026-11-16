'use client';

/**
 * The channel owner's menu on a post card (Story 29.4): Edit opens the post editor; Delete removes
 * the post at once (no confirm: a 30-day soft delete) and the Undo toast brings it back
 * (lib/community/delete-post.ts). Only rendered for the owner acting as the post's channel
 * (the API refuses everyone else).
 */

import { useState } from 'react';
import type { CommunityPost } from '@al-ummah/shared-types';
import { MoreVertical, Pencil, Trash2 } from 'lucide-react';
import Link from '@/components/common/AppLink';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { deletePostWithUndo } from '@/lib/community/delete-post';
import { useLanguage } from '@/hooks/useLanguage';

/** The post editor's address. */
export function editPostHref(locale: string, post: Pick<CommunityPost, 'id' | 'channelId'>): string {
  return `/${locale === 'ar' ? 'ar' : 'en'}/settings/channel/${encodeURIComponent(post.channelId)}/community/${encodeURIComponent(post.id)}/edit`;
}

interface PostManageMenuProps {
  post: Pick<CommunityPost, 'id' | 'channelId'>;
  /** The post was deleted: take it off the page */
  onDeleted?: (postId: string) => void;
  /** Undo brought it back: show it again */
  onRestored?: (postId: string) => void | Promise<void>;
}

export default function PostManageMenu({ post, onDeleted, onRestored }: PostManageMenuProps) {
  const { t, lang, isRTL } = useLanguage();
  const texts = t.community;
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    setDeleting(true);
    try {
      await deletePostWithUndo(post, texts, {
        onRemoved: () => onDeleted?.(post.id),
        onRestored: () => onRestored?.(post.id),
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    // Not modal: the rest of the page is never aria-hidden while it is open
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="shrink-0 rounded-full" aria-label={texts.postActions} disabled={deleting} data-testid="post-owner-actions">
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
          onSelect={() => void remove()}
          disabled={deleting}
          className="text-[var(--fanous-color-error-text)] focus:text-[var(--fanous-color-error-text)]"
          data-testid="post-owner-delete"
        >
          <Trash2 className="h-4 w-4 me-2" aria-hidden="true" />
          {deleting ? texts.deleting : texts.deletePost}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
