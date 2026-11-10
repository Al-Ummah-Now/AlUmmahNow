'use client';

/**
 * Playlists of a batch upload: one choice for every video, each row can have
 * its own. While the batch uploads (Start pressed), every row whose video
 * record exists and that has playlists is handed to `queueAdds` once, in queue
 * order (the order key keeps that order in the playlist); from then on the
 * row shows its playlists and no longer changes them. Rows added while the
 * batch is idle stay editable until the next Start.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { UploadQueueItem } from '@al-ummah/shared-types';
import { newBatchId, orderKeyFor, rowPlaylists } from '@/lib/upload/playlist-adds';

type QueueAdds = (videoId: string, playlistIds: readonly string[], orderKey: string) => void;

/** Whether a row's video gets playlist adds (not a file that was uploaded before, not a cancelled one). */
function eligible(file: UploadQueueItem): file is UploadQueueItem & { videoId: string } {
  return !!file.videoId && !file.alreadyUploaded && file.status !== 'cancelled';
}

export function useBatchPlaylists(files: UploadQueueItem[], isUploading: boolean, queueAdds: QueueAdds) {
  const [batchPlaylists, setBatchPlaylists] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string[] | undefined>>({});
  // Row id → the playlists its adds were requested for
  const [committed, setCommitted] = useState<Record<string, string[]>>({});
  const batchIdRef = useRef(newBatchId());
  const nextIndexRef = useRef(0);
  const committedRef = useRef(committed);
  useEffect(() => {
    committedRef.current = committed;
  }, [committed]);

  useEffect(() => {
    if (!isUploading) return;
    const added: Record<string, string[]> = {};
    for (const file of files) {
      if (!eligible(file) || committedRef.current[file.id]) continue;
      const ids = rowPlaylists(batchPlaylists, overrides[file.id]);
      if (ids.length === 0) continue;
      queueAdds(file.videoId, ids, orderKeyFor(batchIdRef.current, nextIndexRef.current++));
      added[file.id] = ids;
    }
    if (Object.keys(added).length) {
      committedRef.current = { ...committedRef.current, ...added };
      setCommitted(committedRef.current);
    }
  }, [files, isUploading, batchPlaylists, overrides, queueAdds]);

  /** A row's own playlists (undefined: back to the batch's). */
  const setRowPlaylists = useCallback((rowId: string, ids: string[] | undefined) => {
    setOverrides((prev) => ({ ...prev, [rowId]: ids }));
  }, []);

  return { batchPlaylists, setBatchPlaylists, overrides, setRowPlaylists, committed };
}
