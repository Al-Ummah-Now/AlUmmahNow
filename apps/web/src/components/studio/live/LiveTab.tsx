'use client';

/**
 * Studio → Content → Live (issue #771): the channel's live streams and the
 * "New live stream" form. Creating a stream assigns its provider (Bunny or
 * self-hosted, D3) on the server; nothing here depends on which one.
 */
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/common/Switch';
import { useLanguage } from '@/hooks/useLanguage';
import { createStream, deleteStream, listChannelStreams, liveErrorCode, type LiveStreamRow } from '@/lib/live/api';
import { logger } from '@/lib/logger-client';
import { can, type StudioRole } from '@/lib/studio/permissions';

interface Props {
  locale: string;
  channelId: string;
  role: StudioRole;
}

export const studioLiveHref = (locale: string, channelId: string, streamId?: string) =>
  `/${locale}/studio/${encodeURIComponent(channelId)}/content/live${streamId ? `/${encodeURIComponent(streamId)}` : ''}`;

export function LiveTab({ locale, channelId, role }: Props) {
  const { t } = useLanguage();
  const text = t.studio.live;
  const router = useRouter();
  const ids = useId();
  const canManage = can(role, 'live.manage');

  const [items, setItems] = useState<LiveStreamRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'failed' | 'ready'>('loading');
  const [notice, setNotice] = useState('');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<LiveStreamRow | null>(null);

  const load = useCallback(async (more?: string | null, signal?: AbortSignal) => {
    try {
      const page = await listChannelStreams(channelId, more, signal);
      setItems((prev) => (more ? [...prev, ...page.items] : page.items));
      setCursor(page.cursor);
      setStatus('ready');
    } catch (error) {
      if (signal?.aborted) return;
      logger.error('[StudioLive] Could not load live streams', { channelId, error });
      if (!more) setStatus('failed');
      else setNotice(text.loadFailed);
    }
  }, [channelId, text.loadFailed]);

  useEffect(() => {
    const controller = new AbortController();
    void load(null, controller.signal);
    return () => controller.abort();
  }, [load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setFormError(text.form.titleRequired);
      return;
    }
    setCreating(true);
    setFormError('');
    try {
      const stream = await createStream(channelId, { title: title.trim(), description: description.trim(), isPrivate });
      router.push(studioLiveHref(locale, channelId, stream.id));
    } catch (error) {
      const code = liveErrorCode(error);
      if (code === 'generic') logger.error('[StudioLive] Could not create a live stream', { channelId, error });
      setFormError(text.errors[code]);
      setCreating(false);
    }
  };

  const onDelete = async (confirmed: boolean) => {
    const stream = pendingDelete;
    setPendingDelete(null);
    if (!confirmed || !stream) return;
    try {
      await deleteStream(stream.id);
      setItems((prev) => prev.filter((row) => row.id !== stream.id));
      setNotice(text.deleted);
    } catch (error) {
      logger.error('[StudioLive] Could not delete a live stream', { streamId: stream.id, error });
      setNotice(text.errors[liveErrorCode(error)]);
    }
  };

  const dateFormat = new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en', { dateStyle: 'medium' });

  return (
    <div data-testid="studio-live">
      <h1 className="sr-only">{t.studio.tabs.live}</h1>

      {canManage ? (
        <form onSubmit={(e) => void submit(e)} className="mb-6 grid gap-3 rounded-lg border border-border bg-card p-4" data-testid="studio-live-form" noValidate>
          <h2 className="text-base font-semibold text-foreground">{text.newStream}</h2>
          <div className="grid gap-1">
            <label htmlFor={`${ids}-title`} className="text-sm font-medium text-foreground">{text.form.title}</label>
            <Input id={`${ids}-title`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} dir="auto" required aria-invalid={!!formError && !title.trim()} data-testid="studio-live-title" />
          </div>
          <div className="grid gap-1">
            <label htmlFor={`${ids}-description`} className="text-sm font-medium text-foreground">{text.form.description}</label>
            <Textarea id={`${ids}-description`} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} rows={3} dir="auto" data-testid="studio-live-description" />
          </div>
          <div className="flex items-center gap-3">
            <Switch id={`${ids}-private`} checked={isPrivate} onCheckedChange={setIsPrivate} aria-labelledby={`${ids}-private-label`} aria-describedby={`${ids}-private-hint`} data-testid="studio-live-private" />
            <div>
              <span id={`${ids}-private-label`} className="text-sm font-medium text-foreground">{text.form.private}</span>
              <p id={`${ids}-private-hint`} className="text-xs text-muted-foreground">{text.form.privateHint}</p>
            </div>
          </div>
          {formError && <p role="alert" className="text-sm text-destructive" data-testid="studio-live-error">{formError}</p>}
          <div>
            <Button type="submit" disabled={creating} className="min-h-11" data-testid="studio-live-create">
              {creating ? text.form.creating : text.form.create}
            </Button>
          </div>
        </form>
      ) : (
        <p className="mb-4 text-sm text-muted-foreground" data-testid="studio-live-readonly">{text.readOnly}</p>
      )}

      <p role="status" aria-live="polite" className={notice ? 'mb-3 text-sm text-foreground' : 'sr-only'} data-testid="studio-live-notice">{notice}</p>

      {status === 'loading' && (
        <div className="space-y-2" aria-busy="true" data-testid="studio-live-loading">
          {[0, 1, 2].map((row) => <Skeleton key={row} className="h-16 w-full" />)}
        </div>
      )}
      {status === 'failed' && (
        <div className="py-12 text-center">
          <p className="mb-3 text-foreground">{text.loadFailed}</p>
          <Button onClick={() => { setStatus('loading'); void load(); }}>{text.retry}</Button>
        </div>
      )}
      {status === 'ready' && items.length === 0 && (
        <p className="py-12 text-center text-muted-foreground" data-testid="studio-live-empty">{text.empty}</p>
      )}
      {status === 'ready' && items.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border" data-testid="studio-live-list">
          {items.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 p-3" data-testid="studio-live-row" data-stream-id={row.id}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground" dir="auto">{row.title}</p>
                <p className="text-xs text-muted-foreground">
                  {row.dateCreated ? text.created.replace('{date}', dateFormat.format(new Date(row.dateCreated))) : ''}
                </p>
              </div>
              <Badge variant={row.status === 'live' ? 'destructive' : 'secondary'} data-testid="studio-live-status">{text.status[row.status] ?? row.status}</Badge>
              {canManage && (
                <Button asChild variant="outline" className="min-h-11">
                  <Link href={studioLiveHref(locale, channelId, row.id)} data-testid="studio-live-manage">{text.manage}</Link>
                </Button>
              )}
              <Button asChild variant="ghost" className="min-h-11">
                <Link href={`/${locale}/live/${encodeURIComponent(row.id)}`}>{text.watch}</Link>
              </Button>
              {canManage && (
                <Button variant="ghost" className="min-h-11" onClick={() => setPendingDelete(row)} data-testid="studio-live-delete">{text.delete}</Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {status === 'ready' && cursor && (
        <div className="mt-4 text-center">
          <Button variant="outline" onClick={() => void load(cursor)}>{text.loadMore}</Button>
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        onResult={(confirmed) => void onDelete(confirmed)}
        title={text.deleteTitle}
        description={pendingDelete ? text.deleteBody.replace('{title}', pendingDelete.title) : undefined}
        confirmLabel={text.delete}
        testId="studio-live-delete-dialog"
      />
    </div>
  );
}
