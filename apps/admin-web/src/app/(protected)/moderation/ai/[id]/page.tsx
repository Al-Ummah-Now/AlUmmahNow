import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getAiSignal } from '@/lib/api/admin';
import { AdminApiError } from '@/lib/api/errors';
import type { AiSignalDetail } from '@/lib/api/types';
import { getI18n } from '@/i18n/server';
import { formatDate, translateDynamic } from '@/i18n/translate';
import { ErrorAlert, cardClass, linkClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { SignalActions } from './actions';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AiSignalPage({ params }: PageProps) {
  const { id } = await params;
  const { t, locale } = await getI18n();

  let detail: AiSignalDetail | null = null;
  let failed = false;
  try {
    detail = await getAiSignal(id);
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    failed = true;
    logger.error('[ai-moderation] Failed to load signal', { id, error: e instanceof Error ? e.message : String(e) });
  }

  const s = detail?.signal;
  const scores = s ? Object.entries(s.categories).sort((a, b) => b[1] - a[1]) : [];

  return (
    <div>
      <div className="mb-6">
        <Link href="/moderation/ai" className={linkClass}>
          <span aria-hidden="true" className="inline-block rtl:rotate-180">&larr;</span> {t('ai.backToSignals')}
        </Link>
      </div>

      {failed && <ErrorAlert testId="ai-signal-error">{t('errors.loadReport')}</ErrorAlert>}

      {s && detail && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <section className={cardClass} data-testid="ai-signal">
              <div className="flex flex-wrap justify-between gap-3 mb-4">
                <h1 className="text-2xl font-bold text-fg">{t('ai.detailTitle')}</h1>
                <span className="text-fg-muted" data-testid="ai-signal-decision" data-decision={s.decision}>
                  {translateDynamic(t, 'aiDecision', s.decision)}
                </span>
              </div>

              <h2 className="font-semibold text-fg mb-2">{t('ai.originalText')}</h2>
              {detail.content?.available ? (
                <p className="whitespace-pre-wrap bg-surface-2 rounded p-3 text-fg" dir="auto" data-testid="ai-original">
                  {detail.content.text}
                </p>
              ) : (
                <p className="text-fg-muted">{t('ai.contentUnavailable')}</p>
              )}
              {detail.content?.canHide && (
                <p className="text-sm text-fg-subtle mt-2" data-testid="ai-visibility" data-hidden={String(detail.content.hidden)}>
                  {detail.content.hidden ? t('ai.hiddenNow') : t('ai.visibleNow')}
                </p>
              )}

              {s.translation && (
                <>
                  <h2 className="font-semibold text-fg mt-4 mb-2">{t('ai.translation')}</h2>
                  <p className="whitespace-pre-wrap bg-surface-2 rounded p-3 text-fg" dir="ltr" lang="en" data-testid="ai-translation">
                    {s.translation}
                  </p>
                </>
              )}

              <h2 className="font-semibold text-fg mt-4 mb-2">{t('ai.scores')}</h2>
              {scores.length === 0 ? (
                <p className="text-fg-muted">{s.skip_reason ? `${t('ai.skipReason')} ${translateDynamic(t, 'aiSkip', s.skip_reason)}` : t('ai.noScores')}</p>
              ) : (
                <ul className="space-y-1" data-testid="ai-scores">
                  {scores.map(([category, score]) => (
                    <li key={category} className="flex justify-between gap-4">
                      <span className="text-fg">{translateDynamic(t, 'aiCategory', category)}</span>
                      <span className="text-fg-muted" dir="ltr">{score.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              )}

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 mt-6 text-sm">
                <dt className="text-fg-muted">{t('ai.colSurface')}</dt>
                <dd className="text-fg">{translateDynamic(t, 'aiSurface', s.surface)}</dd>
                <dt className="text-fg-muted">{t('ai.colLanguage')}</dt>
                <dd className="text-fg">{s.language ? translateDynamic(t, 'aiLanguage', s.language) : '—'}</dd>
                <dt className="text-fg-muted">{t('ai.subject')}</dt>
                <dd className="text-fg font-mono break-all" dir="ltr">{s.subject_type}:{s.subject_id}</dd>
                <dt className="text-fg-muted">{t('ai.author')}</dt>
                <dd className="text-fg font-mono break-all" dir="ltr">{s.author_id ?? '—'}</dd>
                <dt className="text-fg-muted">{t('ai.model')}</dt>
                <dd className="text-fg font-mono break-all" dir="ltr">{s.models ?? '—'}</dd>
                <dt className="text-fg-muted">{t('ai.promptVersion')}</dt>
                <dd className="text-fg font-mono" dir="ltr">{s.prompt_version ?? '—'}</dd>
                <dt className="text-fg-muted">{t('ai.created')}</dt>
                <dd className="text-fg"><time dateTime={s.created_at}>{formatDate(s.created_at, locale, true)}</time></dd>
                <dt className="text-fg-muted">{t('ai.colReview')}</dt>
                <dd className="text-fg" data-testid="ai-review-status">{translateDynamic(t, 'aiReview', s.review_status)}</dd>
              </dl>
            </section>

            <section className={cardClass} data-testid="ai-audit">
              <h2 className="font-semibold text-fg mb-3">{t('ai.auditTrail')}</h2>
              {detail.actions.length === 0 ? (
                <p className="text-fg-muted">{t('ai.noAudit')}</p>
              ) : (
                <ol className="space-y-2">
                  {detail.actions.map((a) => (
                    <li key={a.id} className="text-sm flex flex-wrap gap-x-3">
                      <time className="text-fg-subtle" dateTime={a.created_at}>{formatDate(a.created_at, locale, true)}</time>
                      <span className="text-fg">{translateDynamic(t, 'aiAction', a.action)}</span>
                      <span className="text-fg-muted">
                        {a.actor_type === 'ai' ? t('ai.actorAi') : t('ai.actorUser', { id: (a.actor_id ?? '').slice(0, 8) })}
                      </span>
                      {a.category && <span className="text-fg-muted">{translateDynamic(t, 'aiCategory', a.category)}{a.score !== null ? ` (${a.score.toFixed(2)})` : ''}</span>}
                      {a.reason && <span className="text-fg-subtle" dir="auto">{a.reason}</span>}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          <SignalActions
            signalId={s.id}
            canHide={!!detail.content?.canHide && !!detail.content?.available}
            hidden={!!detail.content?.hidden}
          />
        </div>
      )}
    </div>
  );
}
