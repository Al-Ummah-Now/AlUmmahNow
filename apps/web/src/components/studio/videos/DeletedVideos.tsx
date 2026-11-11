'use client';

/**
 * Studio's Recently deleted (creator deletes are soft; api-videos
 * lib/creatorDeletions.ts): restore within 30 days, or queue a video for
 * permanent deletion at the next cleanup. Same bulk bar as the Videos tab.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useLanguage } from '@/hooks/useLanguage';
import { listDeletedVideos, purgeVideos, restoreVideos, type BulkSummary, type DeletedVideo } from '@/lib/api/studio-content';
import { isLimitRefusal, type LimitRefusal } from '@/lib/studio/limits';
import { logger } from '@/lib/logger-client';
import { MAX_BULK_SELECTION } from '@/lib/studio/videos';

const DAY_MS = 86_400_000;

/** Whole days until the cleanup erases it (0 = within a day). */
export function daysLeft(purgeAfter: string, now = Date.now()): number {
  return Math.max(0, Math.floor((Date.parse(purgeAfter) - now) / DAY_MS));
}

interface Props {
  locale: string;
  channelId: string;
  onChanged?: () => void;
}

export function DeletedVideos({ locale, channelId, onChanged }: Props) {
  const { t } = useLanguage();
  const text = t.studio.videos.trash;
  const bulk = t.studio.videos.bulk;
  const { confirm, dialog } = useConfirm();
  const [items, setItems] = useState<DeletedVideo[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef(0);

  const load = useCallback(async (more?: string) => {
    const id = ++request.current;
    if (!more) setLoading(true);
    setFailed(false);
    try {
      const page = await listDeletedVideos(channelId, more);
      if (id !== request.current) return;
      if (!page) {
        setFailed(true);
        return;
      }
      setItems((previous) => (more ? [...previous, ...page.items] : page.items));
      setCursor(page.cursor);
    } catch (error) {
      logger.error('[Studio] Could not load deleted videos', { channelId, error });
      if (id === request.current) setFailed(true);
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    setSelected(new Set());
    void load();
  }, [load]);

  const finish = async (summary: BulkSummary | LimitRefusal | null, done: string) => {
    if (!summary || isLimitRefusal(summary) || summary.succeeded === 0) setNotice(text.failed);
    else if (summary.failed > 0) setNotice(text.partial.replace('{succeeded}', String(summary.succeeded)).replace('{failed}', String(summary.failed)));
    else setNotice(done.replace('{count}', String(summary.succeeded)));
    setSelected(new Set());
    await load();
    onChanged?.();
  };

  const restore = async (ids: string[]) => {
    setBusy(true);
    try {
      await finish(await restoreVideos(ids).catch(() => null), text.restored);
    } finally {
      setBusy(false);
    }
  };

  const purge = async (ids: string[]) => {
    const ok = await confirm({
      title: ids.length > 1 ? text.confirmBulkTitle.replace('{count}', String(ids.length)) : text.confirmTitle,
      description: text.confirmBody,
      confirmLabel: text.purge,
      typeToConfirm: text.confirmWord,
      testId: 'studio-confirm-purge',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await finish(await purgeVideos(ids).catch(() => null), text.queuedDone);
    } finally {
      setBusy(false);
    }
  };

  const restorable = (video: DeletedVideo) => video.status === 'deleted' || video.status === 'queued';
  const toggle = (id: string) => setSelected((previous) => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id);
    else if (next.size < MAX_BULK_SELECTION) next.add(id);
    return next;
  });
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const statusText = (video: DeletedVideo) => {
    if (video.status === 'queued') return text.queued;
    if (video.status === 'purging') return text.purging;
    const days = daysLeft(video.purgeAfter);
    return days === 0 ? text.lastDay : text.daysLeft.replace('{days}', new Intl.NumberFormat(locale).format(days));
  };

  return (
    <div data-testid="studio-deleted">
      <p className="mb-3 text-sm text-muted-foreground">{text.intro}</p>
      <p role="status" aria-live="polite" className={notice ? 'mb-3 text-sm text-foreground' : 'sr-only'}>{notice}</p>

      {selected.size > 0 && (
        <div className="sticky bottom-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-2 md:static" data-testid="studio-bulk-bar">
          <span className="text-sm font-medium">{bulk.selected.replace('{count}', String(selected.size))}</span>
          <Button variant="outline" disabled={busy} onClick={() => void restore([...selected])} className="min-h-11" data-testid="studio-bulk-restore">{text.restore}</Button>
          <Button variant="outline" disabled={busy} onClick={() => void purge([...selected])} className="min-h-11" data-testid="studio-bulk-purge">{text.purge}</Button>
          <Button variant="ghost" onClick={() => setSelected(new Set())} className="min-h-11">{bulk.clear}</Button>
        </div>
      )}

      {failed ? (
        <div className="py-12 text-center">
          <p className="mb-3 text-foreground">{t.studio.videos.loadFailed}</p>
          <Button onClick={() => void load()}>{t.studio.videos.retry}</Button>
        </div>
      ) : loading ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((row) => <Skeleton key={row} className="h-14 w-full" />)}
        </div>
      ) : items.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground" data-testid="studio-deleted-empty">{text.empty}</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {items.map((video) => (
            <li key={video.id} className="flex flex-wrap items-center gap-3 p-3" data-testid="studio-deleted-row">
              <input
                type="checkbox"
                className="h-5 w-5"
                aria-label={t.studio.videos.selectVideo.replace('{title}', video.title)}
                checked={selected.has(video.id)}
                disabled={!restorable(video)}
                onChange={() => toggle(video.id)}
              />
              <div className="min-w-0 flex-1">
                <span dir="auto" className="block truncate font-medium text-foreground">{video.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {text.deletedOn.replace('{date}', dateFormat.format(new Date(video.deletedAt)))} · <span data-testid="studio-deleted-status">{statusText(video)}</span>
                </span>
              </div>
              {restorable(video) && (
                <div className="flex gap-2">
                  <Button variant="outline" disabled={busy} onClick={() => void restore([video.id])} className="min-h-11">{text.restore}</Button>
                  {video.status === 'deleted' && (
                    <Button variant="ghost" disabled={busy} onClick={() => void purge([video.id])} className="min-h-11">{text.purge}</Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {cursor && !loading && (
        <div className="mt-4 text-center">
          <Button variant="outline" onClick={() => void load(cursor)}>{t.studio.videos.loadMore}</Button>
        </div>
      )}
      {dialog}
    </div>
  );
}
