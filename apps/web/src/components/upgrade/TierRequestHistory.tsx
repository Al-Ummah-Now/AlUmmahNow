'use client';

/**
 * "Your requests": every tier request the signed-in user has made, newest
 * first, with its status, dates and the team's note on a decline (wiki
 * AUN-TIER-REQUESTS). Shown below the cards on /upgrade and in Settings › Tier.
 * `refreshKey` changes when the caller files or withdraws a request, so the
 * list starts over from the newest.
 */
import { useCallback, useEffect, useState } from 'react';
import type { PublicTier, TierRequest } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { fetchMyTierRequests } from '@/lib/api/tier-requests-client';
import { QUIET } from '@/components/upgrade/buttons';
import { fillCopy, tierName, type Lang } from '@/lib/upgrade/tiers';
import { formatAbsoluteDate } from '@/lib/format/videoMeta';

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; items: TierRequest[]; next: string | null; more: boolean };

export function TierRequestHistory({ tiers, refreshKey = 0, headingLevel = 2 }: { tiers: readonly PublicTier[]; refreshKey?: number; headingLevel?: 2 | 3 }) {
  const { t, lang } = useLanguage();
  const copy = t.upgrade.history;
  const l: Lang = lang === 'ar' ? 'ar' : 'en';
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = useCallback(async (cursor: string | null, previous: TierRequest[]) => {
    const res = await fetchMyTierRequests(cursor);
    if (!res.ok || !res.result) return setState(previous.length ? { status: 'ready', items: previous, next: cursor, more: false } : { status: 'error' });
    setState({ status: 'ready', items: [...previous, ...res.result.items], next: res.result.next, more: false });
  }, []);

  useEffect(() => {
    setState({ status: 'loading' });
    void load(null, []);
  }, [load, refreshKey]);

  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  const nameOf = (r: TierRequest) => {
    const tier = tiers.find((x) => x.id === r.tierId);
    return tier ? tierName(tier, l) : r.tierName;
  };

  return (
    <section className="upg-history" aria-labelledby="upg-history-h" data-testid="tier-request-history">
      <Heading id="upg-history-h" className="upg-history-title">{copy.title}</Heading>
      {state.status === 'loading' && <p className="upg-history-empty" aria-busy="true">…</p>}
      {state.status === 'error' && <p className="upg-history-empty" role="alert" data-testid="tier-request-history-error">{copy.loadFailed}</p>}
      {state.status === 'ready' && state.items.length === 0 && <p className="upg-history-empty" data-testid="tier-request-history-empty">{copy.empty}</p>}
      {state.status === 'ready' && state.items.length > 0 && (
        <>
          <ul className="upg-history-list" data-slot="card" data-glass="lite">
            {state.items.map((r) => (
              <li key={r.id} className="upg-history-row" data-status={r.status} data-testid="tier-request-history-row">
                <div className="upg-history-main">
                  <span className="upg-history-tier">{nameOf(r)}</span>
                  <span className="upg-history-chip" data-status={r.status} data-testid="tier-request-history-status">{copy.status[r.status]}</span>
                </div>
                <p className="upg-history-dates">
                  <span>{fillCopy(copy.sent, { date: formatAbsoluteDate(r.createdAt, l) })}</span>
                  {r.decidedAt && r.status !== 'pending' && <span>{fillCopy(copy.decided, { date: formatAbsoluteDate(r.decidedAt, l) })}</span>}
                </p>
                {r.status === 'declined' && r.declineReason && (
                  // The team's words as written, in their own block and direction (an English note in the Arabic page, and the other way)
                  <div className="upg-note upg-history-note" data-testid="tier-request-history-note">
                    <p className="upg-note-label">{copy.teamNote}</p>
                    <p className="upg-note-text" dir="auto">{r.declineReason}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {state.next && (
            <button
              type="button"
              className={`${QUIET} upg-history-more`}
              data-slot="button"
              disabled={state.more}
              aria-busy={state.more}
              data-testid="tier-request-history-more"
              onClick={() => {
                setState({ ...state, more: true });
                void load(state.next, state.items);
              }}
            >
              {copy.more}
            </button>
          )}
        </>
      )}
    </section>
  );
}
