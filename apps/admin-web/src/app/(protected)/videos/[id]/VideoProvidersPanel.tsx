'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AdminVideoMedia, MediaProviderId, ProviderMediaStatus } from '@al-ummah/shared-types';
import { setVideoPlaybackOverride } from '@/lib/api/admin';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatDate, type MessageKey } from '@/i18n/translate';
import { useConfirm } from '@/components/content/actions';
import { Chip, type ChipTone } from '@/components/content/parts';
import { ErrorAlert, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { OverrideEditor } from '@/components/media/ProviderOrderEditor';
import { OVERRIDE_PROBLEM_LABEL, PROVIDER_LABEL, draftOf, overrideOf, type OverrideDraft } from '@/lib/media/providers-form';
import { logger } from '@/lib/logger-client';

const STATUS_LABEL: Record<ProviderMediaStatus, MessageKey> = {
  pending: 'mediaProviders.video.status.pending',
  processing: 'mediaProviders.video.status.processing',
  ready: 'mediaProviders.video.status.ready',
  failed: 'mediaProviders.video.status.failed',
};
const STATUS_TONE: Record<ProviderMediaStatus, ChipTone> = { pending: 'neutral', processing: 'warn', ready: 'good', failed: 'bad' };

/**
 * The video page's providers (docs/media-delivery/PROVIDERS.md): which providers hold a copy and
 * in what state, the rules a play of this video uses now, and (media:manage) pinning this one
 * video's playback providers, strategy and weights (admin-api PUT /api/media/videos/:id/override,
 * audited per video). Unpinning asks first in the in-app dialog.
 */
export function VideoProvidersPanel({ videoId, media, canManage }: { videoId: string; media: AdminVideoMedia | null | undefined; canManage: boolean }) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const ids = useId();
  const { confirm, dialog } = useConfirm();
  const [view, setView] = useState<AdminVideoMedia | null>(media ?? null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<OverrideDraft>(() => draftOf(media?.override));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!view) return <p className="text-sm text-fg-muted" data-testid="video-providers-unavailable">{t('mediaProviders.video.unavailable')}</p>;

  const name = (p: MediaProviderId) => t(PROVIDER_LABEL[p]);
  const playing = view.effective.order.filter((p) => view.enabled.includes(p));
  const effectiveText = t('mediaProviders.video.effective', {
    strategy: t(view.effective.strategy === 'weighted' ? 'mediaProviders.strategyWeighted' : 'mediaProviders.strategyPriority'),
    order: playing
      .map((p) => (view.effective.strategy === 'weighted' ? t('mediaProviders.video.weightedOrder', { provider: name(p), weight: `${view.effective.weights[p] ?? 0}%` }) : name(p)))
      .join(' → ') || t('mediaProviders.none'),
  });

  async function send(override: ReturnType<typeof overrideOf>, success: MessageKey) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await setVideoPlaybackOverride(videoId, override);
      if (!result.ok) {
        const problem = result.problems?.[0]?.problem;
        logger.warn('[videos] Playback override refused', { videoId, status: result.status, problem });
        setError(result.status === 401 ? t('errors.notAuthenticated') : problem && OVERRIDE_PROBLEM_LABEL[problem] ? t(OVERRIDE_PROBLEM_LABEL[problem]) : t('mediaProviders.video.saveFailed'));
        return;
      }
      if (result.data.media) setView(result.data.media);
      setEditing(false);
      setNotice(t(success));
      router.refresh();
    } catch (e) {
      logger.error('[videos] Playback override request failed', { videoId, error: e instanceof Error ? e.message : String(e) });
      setError(t('mediaProviders.video.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    const ok = await confirm({ title: t('mediaProviders.video.clearConfirmTitle'), body: t('mediaProviders.video.clearConfirmBody'), confirmLabel: t('mediaProviders.video.clearConfirm'), testId: 'video-providers-clear-confirm' });
    if (ok) await send(null, 'mediaProviders.video.cleared');
  }

  return (
    <div data-testid="video-providers" data-pinned={!!view.override}>
      {dialog}
      <h3 className="text-sm font-medium text-fg mb-2">{t('mediaProviders.video.copiesLegend')}</h3>
      {view.copies.length === 0 ? (
        <p className="text-sm text-fg-muted mb-4" data-testid="video-providers-empty">{t('mediaProviders.video.copiesEmpty')}</p>
      ) : (
        <ul className="mb-4 grid gap-2 sm:grid-cols-2">
          {view.copies.map((c) => (
            <li key={c.provider} className="rounded border border-border p-3" data-testid={`video-providers-copy-${c.provider}`} data-status={c.status}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-fg">{name(c.provider)}</span>
                <Chip tone={STATUS_TONE[c.status]}>{t(STATUS_LABEL[c.status])}</Chip>
              </div>
              <div className="mt-1 space-y-0.5 text-sm text-fg-muted">
                {c.renditions.length > 0 && <p dir="ltr" className="text-start">{c.renditions.join(' · ')}</p>}
                {c.readyAt && <p>{formatDate(c.readyAt, locale, true)}</p>}
                {c.legacy && <p>{t('mediaProviders.video.legacy')}</p>}
                {c.error && <p className="text-danger-fg break-words">{c.error}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}

      <h3 className="text-sm font-medium text-fg mb-1">{t('mediaProviders.video.playsFrom')}</h3>
      <p className="text-sm text-fg mb-1" data-testid="video-providers-effective">{effectiveText}</p>
      <p className="text-sm text-fg-muted mb-3" data-testid="video-providers-source">
        {view.override ? (
          <>
            {t('mediaProviders.video.pinned')}
            {view.override.note ? ` · ${view.override.note}` : ''}
            {view.override.updatedAt ? ` · ${formatDate(view.override.updatedAt, locale, true)}` : ''}
          </>
        ) : view.channelOverride ? (
          t('mediaProviders.video.followsChannel')
        ) : (
          t('mediaProviders.video.followsSettings')
        )}
      </p>

      {canManage && !editing && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`${secondaryButtonClass} !py-2 !px-3 text-sm disabled:opacity-60`}
            disabled={busy}
            onClick={() => {
              setDraft(view.override ? draftOf(view.override) : { ...draftOf(null), order: [...playing] });
              setEditing(true);
              setNotice(null);
            }}
            data-testid="video-providers-pin"
          >
            {view.override ? t('mediaProviders.video.editPin') : t('mediaProviders.video.pin')}
          </button>
          {view.override && (
            <button type="button" className={`${secondaryButtonClass} !py-2 !px-3 text-sm disabled:opacity-60`} disabled={busy} onClick={clear} data-testid="video-providers-clear">
              {t('mediaProviders.video.clearPin')}
            </button>
          )}
        </div>
      )}

      {canManage && editing && (
        <div className="rounded-lg border border-accent bg-surface-2 p-4" data-testid="video-providers-editor">
          <OverrideEditor
            idPrefix={`${ids}-v`}
            draft={draft}
            onDraft={setDraft}
            enabled={view.enabled}
            withIngest={false}
            testId="video-providers-override"
            inherited={{ ingest: [], order: view.effective.order, strategy: view.effective.strategy }}
          />
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className={`${primaryButtonClass} !py-2 !px-4 text-sm disabled:opacity-60`}
              disabled={busy}
              aria-busy={busy}
              onClick={() => send(overrideOf(draft, { ingest: false }), overrideOf(draft, { ingest: false }) ? 'mediaProviders.video.saved' : 'mediaProviders.video.cleared')}
              data-testid="video-providers-save"
            >
              {busy ? t('mediaProviders.saving') : t('mediaProviders.video.savePin')}
            </button>
            <button type="button" className={`${secondaryButtonClass} !py-2 !px-4 text-sm`} disabled={busy} onClick={() => { setEditing(false); setError(null); }} data-testid="video-providers-cancel">
              {t('mediaProviders.video.cancel')}
            </button>
          </div>
        </div>
      )}
      {error && <div className="mt-3"><ErrorAlert testId="video-providers-error">{error}</ErrorAlert></div>}
      <p role="status" className="mt-2 text-sm text-fg empty:hidden" data-testid="video-providers-notice">{notice}</p>
    </div>
  );
}
