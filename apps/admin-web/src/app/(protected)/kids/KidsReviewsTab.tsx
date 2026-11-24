'use client';

import { useEffect, useRef, useState } from 'react';
import Link from '@/components/AppLink';
import { useLanguage } from '@/i18n/I18nProvider';
import { Select } from '@/components/select/Select';
import { ConfirmButton } from '@/components/content/actions';
import { Chip, primarySmallButtonClass } from '@/components/content/parts';
import { cardClass, fieldClass, linkClass, secondaryButtonClass } from '@/components/ui';
import type {
  KidsAdminActions,
  KidsAgeBand,
  KidsReviewListResponse,
  KidsReviewRequest,
  KidsReviewStatus,
  KidsTopic,
} from '@/lib/api/kids-types';
import { AGE_BAND_OPTIONS, TOPIC_OPTIONS, formatAgeBand, formatTopic } from './kids-helpers';

type GuardedFn = (
  key: string,
  fn: () => Promise<{ ok: boolean; status?: number; error?: string; code?: string }>,
  options?: { onOk?: () => void; refresh?: boolean },
) => Promise<boolean>;

export function KidsReviewsTab({
  initial,
  actions,
  busy,
  guarded,
}: {
  initial: KidsReviewListResponse;
  actions: KidsAdminActions;
  busy: string | null;
  guarded: GuardedFn;
}) {
  const { t, locale } = useLanguage();
  const [statusFilter, setStatusFilter] = useState<KidsReviewStatus>('pending');
  const [requests, setRequests] = useState<KidsReviewRequest[]>(initial.items);
  const [hasMore, setHasMore] = useState<boolean>(initial.hasMore);
  const [nextCursor, setNextCursor] = useState<string | null>(initial.nextCursor);
  const [ageOverrides, setAgeOverrides] = useState<Record<string, KidsAgeBand>>({});
  const [topicsOverrides, setTopicsOverrides] = useState<Record<string, KidsTopic[]>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const initialSig = initial.items.map((r) => `${r.id}:${r.status}`).join(',');
  const prevInitialSigRef = useRef(initialSig);
  const extraItemsRef = useRef<KidsReviewRequest[]>([]);
  const extraCursorRef = useRef<{ hasMore: boolean; nextCursor: string | null } | null>(null);
  const decidedIdsRef = useRef(new Set<string>());
  const filterReqSeqRef = useRef(0);

  useEffect(() => {
    if (statusFilter !== 'pending') return;
    if (prevInitialSigRef.current === initialSig) return;
    prevInitialSigRef.current = initialSig;
    const baseItems = initial.items.filter((x) => !decidedIdsRef.current.has(x.id));
    const seen = new Set(baseItems.map((x) => x.id));
    const keptExtra = extraItemsRef.current.filter((x) => !decidedIdsRef.current.has(x.id) && !seen.has(x.id));
    extraItemsRef.current = keptExtra;
    setRequests([...baseItems, ...keptExtra]);
    if (extraCursorRef.current) {
      setHasMore(extraCursorRef.current.hasMore);
      setNextCursor(extraCursorRef.current.nextCursor);
    } else {
      setHasMore(initial.hasMore);
      setNextCursor(initial.nextCursor);
    }
  }, [initial, initialSig, statusFilter]);

  async function loadStatus(status: KidsReviewStatus) {
    const seq = ++filterReqSeqRef.current;
    setStatusFilter(status);
    extraItemsRef.current = [];
    extraCursorRef.current = null;
    decidedIdsRef.current.clear();
    await guarded(
      `reviews:filter:${status}`,
      async () => {
        const res = await actions.listReviews({ status });
        if (filterReqSeqRef.current !== seq) return { ok: true };
        setRequests(res.items);
        setHasMore(res.hasMore);
        setNextCursor(res.nextCursor);
        return { ok: true };
      },
      { refresh: false },
    );
  }

  async function loadMore() {
    if (!nextCursor) return;
    await guarded(
      'reviews:more',
      async () => {
        const res = await actions.listReviews({ status: statusFilter, cursor: nextCursor });
        setRequests((prev) => {
          const seen = new Set(prev.map((x) => x.id));
          const added = res.items.filter((x) => !seen.has(x.id));
          extraItemsRef.current = [...extraItemsRef.current, ...added];
          return [...prev, ...added];
        });
        extraCursorRef.current = { hasMore: res.hasMore, nextCursor: res.nextCursor };
        setHasMore(res.hasMore);
        setNextCursor(res.nextCursor);
        return { ok: true };
      },
      { refresh: false },
    );
  }

  function toggleTopic(reqId: string, topic: KidsTopic) {
    setTopicsOverrides((prev) => {
      const current = prev[reqId] ?? [];
      return {
        ...prev,
        [reqId]: current.includes(topic) ? current.filter((x) => x !== topic) : [...current, topic],
      };
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" data-testid="kids-review-filters">
        {(['pending', 'approved', 'declined'] as const).map((status) => (
          <button
            key={status}
            type="button"
            disabled={!!busy}
            onClick={() => void loadStatus(status)}
            aria-pressed={statusFilter === status}
            className={`px-3 py-1.5 rounded-full border text-sm ${statusFilter === status ? 'border-focus bg-surface-2 text-fg font-medium' : 'border-border text-fg-muted hover:bg-surface-hover'}`}
            data-testid={`kids-reviews-status-${status}`}
          >
            {t(`kids.reviews.statuses.${status}` as Parameters<typeof t>[0])}
          </button>
        ))}
      </div>

      {requests.length === 0 ? (
        <div className={`${cardClass} text-fg-muted text-sm`} data-testid="kids-reviews-empty">{t('kids.reviews.empty')}</div>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => {
            const ageBand = ageOverrides[req.id] ?? req.suggestedAgeBand;
            const selectedTopics = topicsOverrides[req.id] ?? [];
            const canApprove = req.targetType === 'video';
            return (
              <div key={req.id} className={`${cardClass} space-y-3`} data-testid={`kids-review-card-${req.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="font-semibold text-fg flex flex-wrap items-center gap-2">
                      <span>{t(`kids.targetTypes.${req.targetType}` as Parameters<typeof t>[0])}:</span>
                      <bdi dir="auto">{req.targetTitle?.trim() || req.targetId}</bdi>
                      {req.targetType === 'video' && (
                        <Link
                          href={`/videos/${encodeURIComponent(req.targetId)}`}
                          className={`${linkClass} text-xs font-normal`}
                          data-testid={`kids-review-watch-${req.id}`}
                        >
                          {t('kids.reviews.watchVideo')}
                        </Link>
                      )}
                    </div>
                    <div className="text-xs text-fg-muted flex flex-wrap gap-3">
                      <span>{t('kids.reviews.suggestedAge', { age: formatAgeBand(req.suggestedAgeBand, t, locale) })}</span>
                      <span>
                        <Link href={`/channels/${encodeURIComponent(req.channelId)}`} className={linkClass}>
                          {t('kids.reviews.channelLabel', { channel: req.channelName?.trim() || req.channelId })}
                        </Link>
                      </span>
                      <span>{t('kids.reviews.submittedBy', { creator: req.requestedByName?.trim() || req.requestedBy })}</span>
                    </div>
                    {req.notes && <p className="text-sm text-fg bg-surface-2 rounded p-2 mt-2" dir="auto">{req.notes}</p>}
                    {req.decisionReason && <p className="text-sm text-fg-muted">{req.decisionReason}</p>}
                  </div>
                  <Chip tone={req.status === 'pending' ? 'warn' : req.status === 'approved' ? 'good' : 'bad'}>
                    {t(`kids.reviews.statuses.${req.status}` as Parameters<typeof t>[0])}
                  </Chip>
                </div>

                {req.status === 'pending' && (
                  <div className="space-y-3 pt-2 border-t border-border">
                    {!canApprove && (
                      <p className="text-xs text-fg-muted" data-testid={`kids-review-video-only-${req.id}`}>
                        {t('kids.reviews.videosOnlyApproveNote')}
                      </p>
                    )}

                    {canApprove && (
                      <div className="flex flex-wrap gap-1.5" aria-label={t('kids.catalog.topics')}>
                        {TOPIC_OPTIONS.map((topic) => {
                          const pressed = selectedTopics.includes(topic);
                          return (
                            <button
                              key={topic}
                              type="button"
                              aria-pressed={pressed}
                              onClick={() => toggleTopic(req.id, topic)}
                              className={`px-2.5 py-0.5 rounded-full border text-xs transition-colors ${pressed ? 'border-accent bg-accent text-on-accent font-medium' : 'border-border bg-surface-2 text-fg hover:bg-surface-hover'}`}
                              data-testid={`kids-review-topic-${req.id}-${topic}`}
                            >
                              {formatTopic(topic, t)}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-3">
                      {canApprove && (
                        <Select
                          value={ageBand}
                          onChange={(e) => setAgeOverrides((m) => ({ ...m, [req.id]: e.target.value as KidsAgeBand }))}
                          className={fieldClass}
                          aria-label={t('kids.catalog.ageBand')}
                        >
                          {AGE_BAND_OPTIONS.map((b) => (
                            <option key={b} value={b}>{formatAgeBand(b, t, locale)}</option>
                          ))}
                        </Select>
                      )}
                      <input
                        type="text"
                        value={notes[req.id] ?? ''}
                        onChange={(e) => setNotes((m) => ({ ...m, [req.id]: e.target.value }))}
                        placeholder={t('kids.reviews.notePlaceholder')}
                        aria-label={t('kids.reviews.noteLabel')}
                        className={`${fieldClass} w-full sm:w-auto sm:flex-1 sm:min-w-44`}
                      />
                      {canApprove && (
                        <button
                          type="button"
                          disabled={!!busy}
                          onClick={() =>
                            void guarded(`review:approve:${req.id}`, async () => {
                              const res = await actions.decideReview(req.id, {
                                decision: 'approved',
                                ageBand,
                                ...(selectedTopics.length > 0 ? { topics: selectedTopics } : {}),
                                ...(notes[req.id]?.trim() ? { reason: notes[req.id].trim() } : {}),
                              });
                              if (res.ok) {
                                decidedIdsRef.current.add(req.id);
                                extraItemsRef.current = extraItemsRef.current.filter((x) => x.id !== req.id);
                                setRequests((prev) => prev.filter((x) => x.id !== req.id));
                              }
                              return res;
                            })
                          }
                          className={primarySmallButtonClass}
                          data-testid={`kids-review-approve-${req.id}`}
                        >
                          {t('kids.reviews.approve')}
                        </button>
                      )}
                      <ConfirmButton
                        label={t('kids.reviews.decline')}
                        title={t('kids.reviews.declineTitle')}
                        body={t('kids.reviews.declineBody')}
                        confirmLabel={t('kids.reviews.declineConfirm')}
                        withReason
                        danger
                        busy={busy === `review:decline:${req.id}`}
                        disabled={!!busy}
                        testId={`kids-review-decline-${req.id}`}
                        onConfirm={async (reason) => {
                          await guarded(`review:decline:${req.id}`, async () => {
                            const res = await actions.decideReview(req.id, {
                              decision: 'declined',
                              ...(reason ? { reason } : notes[req.id]?.trim() ? { reason: notes[req.id].trim() } : {}),
                            });
                            if (res.ok) {
                              decidedIdsRef.current.add(req.id);
                              extraItemsRef.current = extraItemsRef.current.filter((x) => x.id !== req.id);
                              setRequests((prev) => prev.filter((x) => x.id !== req.id));
                            }
                            return res;
                          });
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {hasMore && nextCursor !== null && (
        <div>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void loadMore()}
            className={secondaryButtonClass}
            data-testid="kids-reviews-load-more"
          >
            {t('kids.reviews.loadMore')}
          </button>
        </div>
      )}
    </div>
  );
}
