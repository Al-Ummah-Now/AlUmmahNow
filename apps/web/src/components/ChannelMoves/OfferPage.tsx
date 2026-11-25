'use client';

/**
 * One channel offer (/channel-moves/{offerId}): its receiver accepts or declines, the owner withdraws,
 * and a closed offer says what became of it. Anyone else gets the site's 404.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from '@/components/common/AppLink';
import NotFoundPage from '@/components/NotFoundPage';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useLanguage } from '@/hooks/useLanguage';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { acceptMove, declineMove, isMoveError, isolate, loadMoveOffer, moveErrorMessage, moveName, withdrawMove, type MoveOffer } from '@/lib/channels/moves';
import { CARD, Expires, LoadFailed, Loading, Message, OfferChannel, PRIMARY, SECONDARY, SOFT, TEXT, type MoveMessage } from './parts';

export default function OfferPage({ offerId }: { offerId: string }) {
  const { t, lang } = useLanguage();
  const m = t.channelMoves;
  const { reloadChannels } = useMultiAccount();
  const { confirm, dialog } = useConfirm();
  const [offer, setOffer] = useState<MoveOffer | null>(null);
  const [problem, setProblem] = useState<'missing' | { error: unknown } | null>(null);
  const [busy, setBusy] = useState<'accept' | 'decline' | 'withdraw' | null>(null);
  const [message, setMessage] = useState<MoveMessage | null>(null);

  const refresh = useCallback(async () => {
    setProblem(null);
    try {
      setOffer(await loadMoveOffer(offerId));
    } catch (error) {
      setProblem(isMoveError(error, 'offer_not_found', 'feature_off') ? 'missing' : { error });
    }
  }, [offerId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (problem === 'missing') return <NotFoundPage />;

  const act = async (kind: 'accept' | 'decline' | 'withdraw', run: () => Promise<void>, done: string) => {
    if (busy) return;
    setBusy(kind);
    setMessage(null);
    try {
      await run();
      setMessage({ kind: 'ok', text: done });
      if (kind === 'accept') void reloadChannels();
    } catch (error) {
      setMessage({ kind: 'error', text: moveErrorMessage(error, lang) });
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const channel = offer ? moveName(offer.channel, lang, m.offers.channel) : '';
  const receiver = offer?.viewerRole === 'to';
  const closed = offer && offer.status !== 'offered' ? m.closed[offer.status][receiver ? 'to' : 'from'] : null;

  const accept = async () => {
    if (!(await confirm({ title: m.acceptTitle.replace('{channel}', isolate(channel)), description: m.acceptText, confirmLabel: m.accept, danger: false, testId: 'move-accept-dialog' }))) return;
    await act('accept', () => acceptMove(offerId), m.accepted);
  };
  const withdraw = async () => {
    if (!(await confirm({ title: m.withdrawTitle, description: m.withdrawText, confirmLabel: m.withdraw, testId: 'move-withdraw-dialog' }))) return;
    await act('withdraw', () => withdrawMove(offerId), m.withdrawn);
  };

  return (
    <main className="min-h-screen">
      <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="move-offer-page">
        <p><Link href={`/${lang}/channel-moves`} className="text-sm text-[var(--fanous-c-link-text)] underline">{m.offers.title}</Link></p>
        <Message message={message} />
        {problem && <LoadFailed error={problem.error} onRetry={() => void refresh()} />}
        {!offer && !problem && <Loading />}
        {offer && (
          <article className={`${CARD} space-y-4`} data-testid="move-offer" data-status={offer.status} data-role={offer.viewerRole}>
            <OfferChannel offer={offer} heading="h1" />
            <p className={`text-base ${TEXT}`}>
              {receiver
                ? m.receivedText.replace('{person}', isolate(moveName(offer.from, lang, m.offers.someone)))
                : m.sentText.replace('{person}', isolate(moveName(offer.to, lang, m.offers.someone)))}
            </p>
            {closed ? (
              <p className={`text-sm font-semibold ${TEXT}`} data-testid="move-offer-closed">{closed}</p>
            ) : (
              <>
                {receiver && <p className={`text-sm ${SOFT}`}>{m.becomes}{offer.keepContactEmail ? ` ${m.keepsEmail}` : ''}</p>}
                <Expires at={offer.expiresAt} />
              </>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              {offer.status === 'offered' && receiver && (
                <>
                  <button type="button" onClick={() => void act('decline', () => declineMove(offerId), m.declined)} disabled={!!busy} aria-busy={busy === 'decline'} className={SECONDARY} data-testid="move-decline">{m.decline}</button>
                  <button type="button" onClick={() => void accept()} disabled={!!busy} aria-busy={busy === 'accept'} className={PRIMARY} data-testid="move-accept">{busy === 'accept' ? m.accepting : m.accept}</button>
                </>
              )}
              {offer.status === 'offered' && offer.viewerRole === 'from' && (
                <button type="button" onClick={() => void withdraw()} disabled={!!busy} aria-busy={busy === 'withdraw'} className={SECONDARY} data-testid="move-withdraw">{m.withdraw}</button>
              )}
              {offer.status === 'moved' && offer.channel.name && (
                <Link href={`/${lang}/channels/${offer.channel.id}`} className={SECONDARY} data-testid="move-open-channel">{m.openChannel}</Link>
              )}
            </div>
          </article>
        )}
        {dialog}
      </div>
    </main>
  );
}
