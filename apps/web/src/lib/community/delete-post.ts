'use client';

/**
 * Deleting a community post (Story 29.4; owner rule: undo over confirm). The delete runs at once,
 * no confirm: it is a soft delete the server keeps for 30 days. The post leaves the page and an
 * Undo toast brings it back (POST …/restore). A failed delete keeps the post and says so.
 */

import type { CommunityPost } from '@al-ummah/shared-types';
import { deleteCommunityPost, restoreCommunityPost } from '@/lib/api/community-posts';
import { reportError } from '@/lib/errors/reporter';
import { showUndoToast } from '@/lib/undo-toast';

export interface DeletePostTexts {
  postDeleted: string;
  deleteFailed: string;
  undo: string;
  undoing: string;
  undoFailed: string;
  dismiss: string;
}

export async function deletePostWithUndo(
  post: Pick<CommunityPost, 'id' | 'channelId'>,
  texts: DeletePostTexts,
  handlers: { onRemoved: () => void; onRestored: () => void | Promise<void> },
): Promise<boolean> {
  const extra = { postId: post.id, channelId: post.channelId };
  try {
    const result = await deleteCommunityPost(post.channelId, post.id, { channelId: post.channelId });
    if (!result?.success) throw new Error('Delete post refused');
  } catch (error) {
    reportError(error, { shown: true, extra: { ...extra, action: 'delete_post' } });
    showUndoToast({ message: texts.deleteFailed, dismissLabel: texts.dismiss, testId: 'post-delete-toast' });
    return false;
  }
  handlers.onRemoved();
  showUndoToast({
    message: texts.postDeleted,
    dismissLabel: texts.dismiss,
    testId: 'post-delete-toast',
    undo: {
      label: texts.undo,
      busyLabel: texts.undoing,
      failedMessage: texts.undoFailed,
      run: async () => {
        try {
          const result = await restoreCommunityPost(post.channelId, post.id, { channelId: post.channelId });
          if (!result?.success) throw new Error('Restore post refused');
        } catch (error) {
          reportError(error, { shown: true, extra: { ...extra, action: 'restore_post' } });
          throw error;
        }
        await handlers.onRestored();
      },
    },
  });
  return true;
}
