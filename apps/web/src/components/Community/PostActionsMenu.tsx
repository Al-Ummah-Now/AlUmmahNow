'use client';

/**
 * The ⋮ menu on every community post card (#1515; Story 29.4), on the shared accessible MenuButton
 * (WAI-ARIA menu, arrows/Home/End/Escape, rows mirrored in Arabic with the icon at the start edge):
 *
 * - everyone: Copy link (the short link the share button copies);
 * - signed in, not the post's own channel: Report (the shared report dialog, kind `post`);
 * - the post's channel (owner or a member with post.manage): Edit and Delete. Delete has no
 *   confirm: it is a 30-day soft delete with an Undo toast (lib/community/delete-post.ts).
 *
 * Copy link is always there, so the button never opens an empty menu.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CommunityPost } from '@al-ummah/shared-types';
import { Flag, Link2, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { MenuButton, type MenuButtonItem } from '@/components/common/MenuButton';
import ReportContentButton from '@/components/moderation/ReportContentButton';
import { useOptionalAuth } from '@/components/AuthProvider/authContext';
import { deletePostWithUndo } from '@/lib/community/delete-post';
import { copyText } from '@/lib/share/copy';
import { shareLink } from '@/lib/share/short-link';
import { showUndoToast } from '@/lib/undo-toast';
import { useLanguage } from '@/hooks/useLanguage';

/** The post editor's address. */
export function editPostHref(locale: string, post: Pick<CommunityPost, 'id' | 'channelId'>): string {
  return `/${locale === 'ar' ? 'ar' : 'en'}/studio/${encodeURIComponent(post.channelId)}/content/posts/${encodeURIComponent(post.id)}/edit`;
}

/** The link Copy link copies: the short link, else the post's own page. */
export function postLink(post: Pick<CommunityPost, 'id'>, locale: string): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return shareLink({ kind: 'post', id: post.id }, `${origin}/${locale === 'ar' ? 'ar' : 'en'}/post/${encodeURIComponent(post.id)}`, { locale });
}

interface PostActionsMenuProps {
  post: Pick<CommunityPost, 'id' | 'channelId' | 'userId' | 'content'>;
  /** The viewer acts as the post's channel (owner, or a member with post.manage) */
  canManage?: boolean;
  /** The post was deleted: take it off the page */
  onDeleted?: (postId: string) => void;
  /** Undo brought it back: show it again */
  onRestored?: (postId: string) => void | Promise<void>;
}

export default function PostActionsMenu({ post, canManage = false, onDeleted, onRestored }: PostActionsMenuProps) {
  const { t, lang } = useLanguage();
  const texts = t.community;
  const router = useRouter();
  // Optional: post cards also render where nobody is signed in and there is no auth provider
  const { user } = useOptionalAuth();
  const [reportOpen, setReportOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Its own channel never reports its post
  const canReport = Boolean(user?.id) && !canManage && post.userId !== user?.id;

  const items: MenuButtonItem[] = [
    {
      id: 'copy',
      label: texts.copyLink,
      icon: <Link2 className="h-4 w-4" />,
      testId: 'post-action-copy-link',
      onSelect: async () => {
        const copied = await copyText(postLink(post, lang));
        showUndoToast({ message: copied ? texts.linkCopied : texts.copyLinkFailed, dismissLabel: texts.dismiss, testId: 'post-link-toast' });
      },
    },
  ];
  if (canReport) {
    items.push({ id: 'report', label: texts.reportPost, icon: <Flag className="h-4 w-4" />, testId: 'post-action-report', onSelect: () => setReportOpen(true) });
  }
  if (canManage) {
    items.push(
      { id: 'edit', label: texts.editPost, icon: <Pencil className="h-4 w-4" />, testId: 'post-owner-edit', onSelect: () => router.push(editPostHref(lang, post)) },
      {
        id: 'delete',
        label: deleting ? texts.deleting : texts.deletePost,
        icon: <Trash2 className="h-4 w-4" />,
        danger: true,
        testId: 'post-owner-delete',
        onSelect: async () => {
          if (deleting) return;
          setDeleting(true);
          try {
            await deletePostWithUndo(post, texts, { onRemoved: () => onDeleted?.(post.id), onRestored: () => onRestored?.(post.id) });
          } finally {
            setDeleting(false);
          }
        },
      },
    );
  }

  return (
    <>
      <MenuButton
        label={texts.postActions}
        items={items}
        testId={canManage ? 'post-owner-actions' : 'post-actions-menu'}
        disabled={deleting}
        buttonClassName="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[var(--fanous-color-text-secondary)] hover:bg-[var(--fanous-color-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fanous-color-link)]"
      >
        <MoreVertical className="h-5 w-5" aria-hidden="true" />
      </MenuButton>
      {canReport && (
        <ReportContentButton
          hideTrigger
          open={reportOpen}
          onOpenChange={setReportOpen}
          contentType="post"
          contentId={post.id}
          contentTitle={typeof post.content === 'string' ? post.content.slice(0, 80) : undefined}
        />
      )}
    </>
  );
}
