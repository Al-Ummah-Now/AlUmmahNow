'use client';

/** My open channel offers (/channel-moves): those made to me and those I made. */
import { useCallback, useEffect, useState } from 'react';
import Link from '@/components/common/AppLink';
import NotFoundPage from '@/components/NotFoundPage';
import { useLanguage } from '@/hooks/useLanguage';
import { isMoveError, isolate, loadMyMoveOffers, moveErrorMessage, moveName, type MoveOffer, type MoveSide, type MyMoveOffers } from '@/lib/channels/moves';
import { CARD, Expires, LoadFailed, Loading, Message, OfferChannel, SECONDARY, SOFT, TEXT } from './parts';

function Section({ title, offers, testId, more }: { title: string; offers: MoveOffer[]; testId: string; more: { on: boolean; busy: boolean; load: () => void } }) {
  const { t, lang } = useLanguage();
  const m = t.channelMoves;
  // A page can hold only offers that are no longer open: the next one may still hold some
  if (!offers.length && !more.on) return null;
  return (
    <section className="space-y-3" data-testid={testId}>
      <h2 className={`text-lg font-semibold ${TEXT}`}>{title}</h2>
      <ul className="space-y-4">
        {offers.map((offer) => (
          <li key={offer.id} className={`${CARD} space-y-3`} data-testid="move-offer-item" data-offer={offer.id}>
            <OfferChannel offer={offer} heading="h3" />
            <p className={`text-sm ${TEXT}`}>
              {offer.viewerRole === 'to'
                ? m.receivedText.replace('{person}', isolate(moveName(offer.from, lang, m.offers.someone)))
                : m.sentText.replace('{person}', isolate(moveName(offer.to, lang, m.offers.someone)))}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-3">
              {offer.status === 'accepting' ? <p className={`text-sm ${SOFT}`} data-testid="move-offer-starting">{m.closed.accepting[offer.viewerRole === 'to' ? 'to' : 'from']}</p> : <Expires at={offer.expiresAt} />}
              <Link href={`/${lang}/channel-moves/${offer.id}`} className={SECONDARY} data-testid="move-offer-view">
                {m.offers.view}
                <span className="sr-only"> {isolate(moveName(offer.channel, lang, m.offers.channel))}</span>
              </Link>
            </div>
          </li>
        ))}
      </ul>
      {more.on && (
        <button type="button" className={SECONDARY} onClick={more.load} disabled={more.busy} aria-busy={more.busy} data-testid={`${testId}-more`}>
          {m.offers.more}
        </button>
      )}
    </section>
  );
}

export default function MoveOffers() {
  const { t, lang } = useLanguage();
  const m = t.channelMoves;
  const [offers, setOffers] = useState<MyMoveOffers | null>(null);
  const [busy, setBusy] = useState<MoveSide | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [problem, setProblem] = useState<'off' | { error: unknown } | null>(null);

  const refresh = useCallback(async () => {
    setProblem(null);
    try {
      setOffers(await loadMyMoveOffers());
    } catch (error) {
      setProblem(isMoveError(error, 'feature_off') ? 'off' : { error });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadMore = async (side: MoveSide) => {
    const cursor = offers?.[`${side}Cursor`];
    if (!cursor || busy) return;
    setBusy(side);
    setMoreError(null);
    try {
      const next = await loadMyMoveOffers({ side, cursor });
      setOffers((now) => {
        if (!now) return now;
        const known = new Set(now[side].map((o) => o.id));
        return { ...now, [side]: [...now[side], ...next[side].filter((o) => !known.has(o.id))], [`${side}Cursor`]: next[`${side}Cursor`] };
      });
    } catch (error) {
      setMoreError(moveErrorMessage(error, lang as 'en' | 'ar'));
    } finally {
      setBusy(null);
    }
  };
  const more = (side: MoveSide) => ({ on: !!offers?.[`${side}Cursor`], busy: busy === side, load: () => void loadMore(side) });

  if (problem === 'off') return <NotFoundPage />;
  return (
    <main className="min-h-screen">
      <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="move-offers">
        <div>
          <h1 className={`text-2xl font-bold ${TEXT}`}>{m.offers.title}</h1>
          <p className={`mt-1 ${SOFT}`}>{m.offers.description}</p>
        </div>
        {problem && <LoadFailed error={problem.error} onRetry={() => void refresh()} />}
        {!offers && !problem && <Loading />}
        {offers && !offers.received.length && !offers.sent.length && !offers.receivedCursor && !offers.sentCursor && <p className={`${CARD} text-sm ${SOFT}`} data-testid="move-offers-empty">{m.offers.none}</p>}
        {offers && <Section title={m.offers.received} offers={offers.received} testId="move-offers-received" more={more('received')} />}
        {offers && <Section title={m.offers.sent} offers={offers.sent} testId="move-offers-sent" more={more('sent')} />}
        <Message message={moreError ? { kind: 'error', text: moreError } : null} />
      </div>
    </main>
  );
}
