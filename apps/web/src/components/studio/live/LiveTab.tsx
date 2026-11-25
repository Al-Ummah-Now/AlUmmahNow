'use client';

/**
 * Studio → Content → Live (issue #771): the channel's live streams and the
 * "New live stream" form. Creating a stream assigns its provider (Bunny or
 * self-hosted, D3) on the server; nothing here depends on which one.
 */
import { dateTimeFormat } from '@al-ummah/shared-types';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import Link from '@/components/common/AppLink';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/common/Switch';
import { useLanguage } from '@/hooks/useLanguage';
import { createStream, deleteStream, isLiveOff, listChannelStreams, liveErrorCode, type LiveStreamRow } from '@/lib/live/api';
import { markCreatorTermsRequired, needsCreatorTerms, useCreatorAccess } from '@/hooks/useCreatorAccess';
import { CreatorTermsDialog } from '@/components/legal/CreatorTermsGate';
import { logger } from '@/lib/logger-client';
import { can, type StudioRole } from '@/lib/studio/permissions';
import type { LiveOffers } from '@/lib/studio/nav';
import { LiveKindBadges } from '@/components/live/LiveKindBadges';
import { LiveOptionsFields, offeredOptions, optionsOf } from './LiveOptionsFields';
import { LiveQuota } from './LiveQuota';
import { PremiereForm } from './PremiereForm';
import { NO_START, StartFields, readStart } from './StartFields';
import { studioLiveHref } from './href';

interface Props {
  locale: string;
  channelId: string;
  role: StudioRole;
  /** What is on for the channel (lib/studio/nav liveOffers) */
  offers?: LiveOffers;
}

export { studioLiveHref };

const STREAMS_ONLY: LiveOffers = { streams: true, premieres: false, chat: false, events: false, schedule: false };

export function LiveTab({ locale, channelId, role, offers = STREAMS_ONLY }: Props) {
  const { t, lang } = useLanguage();
  const text = t.studio.live;
  const router = useRouter();
  const ids = useId();
  const canManage = can(role, 'live.manage');
  // Live is only reachable when the owner's tier includes it (GET /api/me/features); what is left
  // to say is the quota, for the owner (GET /api/me/creator). A channel admin works under the
  // owner's quota, which only the server knows: it answers live_hours_used and the form says so.
  const creator = useCreatorAccess();
  const tierLive = role === 'owner' && creator.status === 'ready' ? creator.access.live : null;
  const blocked = !!tierLive && !tierLive.allowed;

  const [items, setItems] = useState<LiveStreamRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'failed' | 'ready'>('loading');
  const [notice, setNotice] = useState('');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [start, setStart] = useState(NO_START);
  const [options, setOptions] = useState(() => optionsOf());
  const [kind, setKind] = useState<'live' | 'premiere'>(offers.streams ? 'live' : 'premiere');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');
  const [formErrorCode, setFormErrorCode] = useState('');
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

  const [termsOpen, setTermsOpen] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setFormError(text.form.titleRequired);
      return;
    }
    const at = offers.schedule ? readStart(start) : 'empty';
    if (at === 'incomplete' || at === 'past') {
      setFormError(at === 'past' ? text.apps.timeTooSoon : text.apps.timeRequired);
      return;
    }
    if (needsCreatorTerms(creator)) {
      setTermsOpen(true);
      return;
    }
    setCreating(true);
    setFormError('');
    setFormErrorCode('');
    try {
      const stream = await createStream(channelId, { title: title.trim(), description: description.trim(), isPrivate, ...(typeof at === 'string' ? {} : { scheduledStartTime: at.iso }), ...offeredOptions(options, offers) });
      router.push(studioLiveHref(locale, channelId, stream.id));
    } catch (error) {
      // Live was switched off meanwhile: the page re-renders without it (not found)
      if (isLiveOff(error)) {
        router.refresh();
        return;
      }
      const code = liveErrorCode(error);
      if (code === 'terms_required') {
        markCreatorTermsRequired();
        setTermsOpen(true);
      }
      if (code === 'generic') logger.error('[StudioLive] Could not create a live stream', { channelId, error });
      setFormError(text.errors[code]);
      setFormErrorCode(code);
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

  const startFormat = dateTimeFormat(locale === 'ar' ? 'ar' : 'en', { dateStyle: 'medium', timeStyle: 'short' });
  const dateFormat = dateTimeFormat(locale === 'ar' ? 'ar' : 'en', { dateStyle: 'medium' });

  return (
    <div data-testid="studio-live">
      <h1 className="sr-only">{t.studio.tabs.live}</h1>

      {canManage && offers.streams && tierLive && <LiveQuota locale={locale} live={tierLive} />}
      {canManage && offers.streams && offers.premieres && (
        <div role="group" aria-label={text.apps.kindLabel} className="mb-4 flex flex-wrap gap-2" data-testid="studio-live-kind">
          {(['live', 'premiere'] as const).map((k) => (
            <Button key={k} type="button" variant={kind === k ? 'default' : 'outline'} aria-pressed={kind === k} className="min-h-11" onClick={() => setKind(k)} data-testid={`studio-live-kind-${k}`}>
              {k === 'live' ? text.newStream : text.apps.newPremiere}
            </Button>
          ))}
        </div>
      )}
      {canManage && offers.premieres && kind === 'premiere' && <PremiereForm locale={locale} channelId={channelId} offers={offers} />}
      {canManage && (blocked || !offers.streams || kind === 'premiere') ? null : canManage ? (
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
          {offers.schedule && <StartFields value={start} onChange={setStart} legend={text.apps.startOptional} />}
          <LiveOptionsFields value={options} onChange={setOptions} offers={offers} />
          {formError && (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-[var(--fanous-color-error-text)]" data-testid="studio-live-error" data-code={formErrorCode}>
              <span>{formError}</span>
              {formErrorCode === 'terms_required' && (
                <button
                  type="button"
                  onClick={() => setTermsOpen(true)}
                  className="underline font-medium text-[var(--fanous-color-accent)]"
                  data-testid="studio-live-review-terms"
                >
                  {t.upload.termsGateReviewAction}
                </button>
              )}
            </div>
          )}
          <CreatorTermsDialog
            open={termsOpen}
            onOpenChange={setTermsOpen}
            onAccepted={() => {
              if (formErrorCode === 'terms_required') {
                setFormError('');
                setFormErrorCode('');
              }
            }}
          />
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
            <li key={row.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-3" data-testid="studio-live-row" data-stream-id={row.id}>
              {/* Phones: the title and date take the full row, the status and actions go under them */}
              <div className="min-w-0 sm:flex-1">
                <p className="truncate font-medium text-foreground" dir="auto">{row.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Badge variant={row.status === 'live' ? 'destructive' : 'secondary'} data-testid="studio-live-status">{text.status[row.status] ?? row.status}</Badge>
                  <LiveKindBadges kind={row.kind} eventType={row.eventType} lang={lang === 'ar' ? 'ar' : 'en'} />
                  <p className="text-xs text-muted-foreground">
                    {row.status === 'scheduled' && row.scheduledStartTime ? startFormat.format(new Date(row.scheduledStartTime)) : row.dateCreated ? text.created.replace('{date}', dateFormat.format(new Date(row.dateCreated))) : ''}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                {canManage && (
                  <Button asChild variant="outline" className="min-h-11">
                    {/* With the month's hours used up a stream that isn't live can't start: no "Go live" offer, its details instead */}
                    <Link href={studioLiveHref(locale, channelId, row.id)} data-testid="studio-live-manage">{row.kind === 'premiere' ? text.apps.premiereManage : row.status === 'live' ? text.manageLive : row.status === 'ended' || row.status === 'cancelled' || blocked ? text.details : text.manage}</Link>
                  </Button>
                )}
                <Button asChild variant="ghost" className="min-h-11">
                  <Link href={`/${locale}/live/${encodeURIComponent(row.id)}`}>{text.watch}</Link>
                </Button>
                {canManage && (
                  <Button variant="ghost" className="min-h-11" onClick={() => setPendingDelete(row)} data-testid="studio-live-delete">{text.delete}</Button>
                )}
              </div>
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
