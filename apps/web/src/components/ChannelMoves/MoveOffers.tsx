'use client';

/** My open channel offers (/channel-moves): those made to me and those I made. */
import { useCallback, useEffect, useState } from 'react';
import Link from '@/components/common/AppLink';
import NotFoundPage from '@/components/NotFoundPage';
import { useLanguage } from '@/hooks/useLanguage';
import { isMoveError, isolate, loadMyMoveOffers, moveName, type MoveOffer } from '@/lib/channels/moves';
import { CARD, Expires, LoadFailed, Loading, OfferChannel, SECONDARY, SOFT, TEXT } from './parts';

function Section({ title, offers, testId }: { title: string; offers: MoveOffer[]; testId: string }) {
  const { t, lang } = useLanguage();
  const m = t.channelMoves;
  if (!offers.length) return null;
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
              <Expires at={offer.expiresAt} />
              <Link href={`/${lang}/channel-moves/${offer.id}`} className={SECONDARY} data-testid="move-offer-view">
                {m.offers.view}
                <span className="sr-only"> {isolate(moveName(offer.channel, lang, m.offers.channel))}</span>
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function MoveOffers() {
  const { t } = useLanguage();
  const m = t.channelMoves;
  const [offers, setOffers] = useState<{ received: MoveOffer[]; sent: MoveOffer[] } | null>(null);
  const [problem, setProblem] = useState<'off' | 'failed' | null>(null);

  const refresh = useCallback(async () => {
    setProblem(null);
    try {
      setOffers(await loadMyMoveOffers());
    } catch (error) {
      setProblem(isMoveError(error, 'feature_off') ? 'off' : 'failed');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (problem === 'off') return <NotFoundPage />;
  return (
    <div className="min-h-screen">
      <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="move-offers">
        <div>
          <h1 className={`text-2xl font-bold ${TEXT}`}>{m.offers.title}</h1>
          <p className={`mt-1 ${SOFT}`}>{m.offers.description}</p>
        </div>
        {problem === 'failed' && <LoadFailed onRetry={() => void refresh()} />}
        {!offers && !problem && <Loading />}
        {offers && !offers.received.length && !offers.sent.length && <p className={`${CARD} text-sm ${SOFT}`} data-testid="move-offers-empty">{m.offers.none}</p>}
        {offers && <Section title={m.offers.received} offers={offers.received} testId="move-offers-received" />}
        {offers && <Section title={m.offers.sent} offers={offers.sent} testId="move-offers-sent" />}
      </div>
    </div>
  );
}
