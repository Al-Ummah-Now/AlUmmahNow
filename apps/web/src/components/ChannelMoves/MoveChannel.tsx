'use client';

/**
 * Channel settings → Move channel (wiki AUN-CHANNEL-CLAIM §5): the owner offers the channel to one of
 * its admins. The fresh sign-in is asked as the page opens, before anything is typed; someone who comes
 * back as another account is told it isn't their channel, and nothing has changed. An open offer shows
 * with Withdraw instead of the form.
 */
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { formatDate, formatNumber } from '@al-ummah/shared-types';
import Link from '@/components/common/AppLink';
import { Autocomplete, type AutocompleteOption } from '@/components/ui/Autocomplete';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useLanguage } from '@/hooks/useLanguage';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { useProfile } from '@/hooks/useProfile';
import { loginRoutePath } from '@/lib/auth/silent-sign-in';
import { isFreshSignIn, isMoveError, isolate, loadMoveState, makeMoveOffer, moveErrorMessage, moveName, searchMoveReceivers, withdrawMove, type ChannelMoveState, type MoveOffer, type MoveReceiver } from '@/lib/channels/moves';
import { userDisplayName } from '@/lib/display-name';
import { Avatar, CARD, Expires, LoadFailed, Loading, Message, PRIMARY, SECONDARY, SOFT, TEXT, type MoveMessage } from './parts';

const FIELD = 'w-full rounded-lg border border-[var(--fanous-c-form-input-border)] bg-[var(--fanous-c-form-input-bg)] px-3 py-2 text-sm text-[var(--fanous-c-form-input-text)] focus:outline-none focus:ring-2 focus:ring-brand';
/** Days between an owner's moves of a channel (api-videos MOVE_COOLDOWN_DAYS) */
const COOLDOWN_DAYS = 30;

interface MoveChannelProps {
  channelId: string;
  handle: string;
  locale: string;
  /** When the person last signed in (epoch s), from the session's token; null: signed out or unknown */
  authTime: number | null;
  signedIn: boolean;
}

/** What the owner typed, kept for a sign-in that became necessary half way (this tab only). */
const draftKey = (channelId: string) => `aun-move-draft:${channelId}`;
function readDraft(channelId: string): { receiver: MoveReceiver; keepContactEmail: boolean } | null {
  try {
    const raw = window.sessionStorage.getItem(draftKey(channelId));
    window.sessionStorage.removeItem(draftKey(channelId));
    const draft = raw ? (JSON.parse(raw) as { receiver?: MoveReceiver; keepContactEmail?: boolean }) : null;
    return draft?.receiver?.userId ? { receiver: draft.receiver, keepContactEmail: draft.keepContactEmail === true } : null;
  } catch {
    return null;
  }
}

export default function MoveChannel({ channelId, handle, locale, authTime, signedIn }: MoveChannelProps) {
  const { t } = useLanguage();
  const m = t.channelMoves;
  const [state, setState] = useState<ChannelMoveState | 'not-yours' | null>(null);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState<MoveMessage | null>(null);

  const refresh = useCallback(async () => {
    setFailed(false);
    try {
      setState(await loadMoveState(channelId));
    } catch (error) {
      if (isMoveError(error, 'channel_not_found')) setState('not-yours');
      else setFailed(true);
    }
  }, [channelId]);

  useEffect(() => {
    if (signedIn) void refresh();
  }, [refresh, signedIn]);

  if (!signedIn) return <SignInAgain channelId={channelId} locale={locale} />;
  if (failed) return <LoadFailed onRetry={() => void refresh()} />;
  if (state === null) return <Loading />;
  if (state === 'not-yours') return <NotYours channelId={channelId} locale={locale} />;

  const done = (text: string) => {
    setMessage({ kind: 'ok', text });
    void refresh();
  };
  return (
    <div className="space-y-6" data-testid="move-channel">
      <Message message={message} />
      {state.offer ? (
        <OpenOffer offer={state.offer} onWithdrawn={() => done(m.withdrawn)} onError={(text) => { setMessage({ kind: 'error', text }); void refresh(); }} />
      ) : state.movableAt ? (
        <p className={`${CARD} text-sm ${TEXT}`} data-testid="move-cooldown">{m.movableAt.replace('{date}', formatDate(locale, state.movableAt, { dateStyle: 'long' }))}</p>
      ) : isFreshSignIn(authTime) ? (
        <MoveForm channelId={channelId} handle={handle} locale={locale} onSent={() => done(m.form.sent)} onNotYours={() => setState('not-yours')} />
      ) : (
        <SignInAgain channelId={channelId} locale={locale} />
      )}
    </div>
  );
}

const movePath = (locale: string, channelId: string) => `/${locale}/settings/channel/${channelId}/move`;

function SignInAgain({ channelId, locale }: { channelId: string; locale: string }) {
  const { t } = useLanguage();
  const s = t.channelMoves.signIn;
  return (
    <section className={`${CARD} space-y-3`} data-testid="move-sign-in">
      <h2 className={`text-lg font-semibold ${TEXT}`}>{s.title}</h2>
      <p className={`text-sm ${SOFT}`}>{s.text}</p>
      {/* A full navigation: the login route answers with a redirect to the sign-in page. prompt=login, because a silent sign-in keeps the old time */}
      <a href={loginRoutePath(movePath(locale, channelId), locale, 'login')} className={PRIMARY} data-testid="move-sign-in-button">{s.button}</a>
    </section>
  );
}

function NotYours({ channelId, locale }: { channelId: string; locale: string }) {
  const { t, lang } = useLanguage();
  const { user } = useMultiAccount();
  const n = t.channelMoves.notYours;
  // As the header shows it: the profile's name in this language; until it loads, the session's
  const { profile } = useProfile(user ?? null);
  const name = user ? userDisplayName(profile, lang) || userDisplayName(user, lang, user.email) : '';
  return (
    <section className={`${CARD} space-y-3`} data-testid="move-not-yours">
      <h2 className={`text-lg font-semibold ${TEXT}`}>{n.title}</h2>
      <p className={`text-sm ${SOFT}`}>{n.text}</p>
      {name && <p className={`text-sm ${SOFT}`}>{n.signedInAs.replace('{name}', isolate(name))}</p>}
      <div className="flex flex-wrap gap-2">
        <a href={loginRoutePath(movePath(locale, channelId), locale, 'login')} className={PRIMARY} data-testid="move-other-account">{n.button}</a>
        <Link href={`/${locale}/channels/${channelId}`} className={SECONDARY}>{n.backToChannel}</Link>
      </div>
    </section>
  );
}

function OpenOffer({ offer, onWithdrawn, onError }: { offer: MoveOffer; onWithdrawn: () => void; onError: (text: string) => void }) {
  const { t, lang } = useLanguage();
  const m = t.channelMoves;
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const person = moveName(offer.to, lang, m.offers.someone);
  const starting = offer.status === 'accepting';

  const withdraw = async () => {
    if (busy || !(await confirm({ title: m.withdrawTitle, description: m.withdrawText, confirmLabel: m.withdraw, testId: 'move-withdraw-dialog' }))) return;
    setBusy(true);
    try {
      await withdrawMove(offer.id);
      onWithdrawn();
    } catch (error) {
      onError(moveErrorMessage(error, lang));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`${CARD} space-y-3`} data-testid="move-open-offer" data-status={offer.status}>
      <div className="flex items-center gap-4">
        <Avatar src={offer.to.avatarUrl} name={person} />
        <div className="min-w-0">
          <h2 className={`break-words text-lg font-semibold ${TEXT}`}>{m.open.title.replace('{person}', isolate(person))}</h2>
          <p className={`text-sm ${SOFT}`}>{starting ? m.open.starting : m.open.text}</p>
          {!starting && <Expires at={offer.expiresAt} />}
        </div>
      </div>
      {!starting && (
        <div className="flex justify-end">
          <button type="button" onClick={() => void withdraw()} disabled={busy} aria-busy={busy} className={SECONDARY} data-testid="move-withdraw">{m.withdraw}</button>
        </div>
      )}
      {dialog}
    </section>
  );
}

function MoveForm({ channelId, handle, locale, onSent, onNotYours }: { channelId: string; handle: string; locale: string; onSent: () => void; onNotYours: () => void }) {
  const { t, lang } = useLanguage();
  const m = t.channelMoves;
  const f = m.form;
  const ids = { receiver: useId(), receiverHelp: useId(), keep: useId(), keepHelp: useId(), typed: useId() };
  const [query, setQuery] = useState('');
  const [receiver, setReceiver] = useState<MoveReceiver | null>(null);
  const [keepContactEmail, setKeep] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; signIn: boolean } | null>(null);
  const [noAdmins, setNoAdmins] = useState(false);

  useEffect(() => {
    const draft = readDraft(channelId);
    if (!draft) return;
    setReceiver(draft.receiver);
    setKeep(draft.keepContactEmail);
  }, [channelId]);

  const someone = m.offers.someone;
  const find = useCallback(async (q: string, signal: AbortSignal): Promise<AutocompleteOption[]> => {
    const people = await searchMoveReceivers(channelId, q, signal);
    if (!q.trim()) setNoAdmins(people.length === 0);
    return people.map((p) => {
      const name = moveName(p, lang, someone);
      return { id: p.userId, label: name, keywords: Object.values(p.nameLocalized ?? {}), thumbnailUrl: p.avatarUrl ?? undefined, thumbnailShape: 'round' as const, icon: <Avatar src={null} name={name} size="h-8 w-8 text-sm" />, value: p };
    });
  }, [channelId, lang, someone]);

  const matches = typed.trim().replace(/^@/, '').toLowerCase() === handle.toLowerCase();

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!receiver || !matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      await makeMoveOffer(channelId, { toUserId: receiver.userId, confirm: typed, keepContactEmail });
      onSent();
    } catch (e) {
      if (isMoveError(e, 'move_not_owner', 'channel_not_found')) return onNotYours();
      const signIn = isMoveError(e, 'reauth_required');
      if (signIn) {
        try {
          window.sessionStorage.setItem(draftKey(channelId), JSON.stringify({ receiver, keepContactEmail }));
        } catch {
          // Without storage the owner picks the person again
        }
      }
      setError({ text: moveErrorMessage(e, lang), signIn });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void send(e)} className={`${CARD} space-y-6`} data-testid="move-form" noValidate>
      <div>
        <h2 className={`text-lg font-semibold ${TEXT}`}>{m.happens.title}</h2>
        <ul className={`mt-2 list-disc space-y-1 ps-5 text-sm ${SOFT}`}>
          <li>{m.happens.everything}</li>
          <li>{m.happens.access}</li>
          <li>{m.happens.live}</li>
          <li>{m.happens.once.replace('{days}', formatNumber(lang, COOLDOWN_DAYS))}</li>
        </ul>
      </div>

      <div>
        <label htmlFor={ids.receiver} className={`mb-1 block text-sm font-medium ${TEXT}`}>{f.receiver}</label>
        {receiver ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--fanous-c-form-input-border)] px-3 py-2" data-testid="move-receiver-chosen">
            <Avatar src={receiver.avatarUrl} name={moveName(receiver, lang, someone)} size="h-10 w-10 text-base" />
            {/* Wide enough for a name: on a phone the button goes to its own line instead of squeezing it */}
            <div className="min-w-[9rem] flex-1">
              <p className={`break-words text-sm font-semibold ${TEXT}`}><bdi>{moveName(receiver, lang, someone)}</bdi></p>
            </div>
            <button type="button" onClick={() => { setReceiver(null); setQuery(''); }} disabled={busy} className={SECONDARY} data-testid="move-receiver-change">{f.change}</button>
          </div>
        ) : (
          <>
            <Autocomplete
              inputId={ids.receiver}
              value={query}
              onValueChange={setQuery}
              load={find}
              loadInitial={async (_cursor, signal) => ({ options: await find('', signal), next: null })}
              loadKey={channelId}
              minChars={1}
              emptyText={f.noAdmins}
              onSelect={(option) => { setReceiver(option.value as MoveReceiver); setError(null); }}
              listLabel={f.receiver}
              testId="move-receiver"
              optionTestId={() => 'move-receiver-option'}
              inputProps={{ placeholder: f.receiverPlaceholder, autoComplete: 'off', autoCapitalize: 'off', maxLength: 200, 'aria-describedby': ids.receiverHelp }}
              inputClassName={FIELD}
            />
            <p id={ids.receiverHelp} className={`mt-1 text-xs ${SOFT}`}>{f.receiverHelp}</p>
            {noAdmins && (
              <p className={`mt-2 text-sm ${TEXT}`} data-testid="move-no-admins">
                {f.noAdmins} <Link href={`/${locale}/settings/channel/${channelId}/team`} className="font-semibold text-[var(--fanous-c-link-text)] underline">{f.openTeam}</Link>
              </p>
            )}
          </>
        )}
      </div>

      <div className="flex items-start gap-3">
        <input id={ids.keep} type="checkbox" checked={keepContactEmail} onChange={(e) => setKeep(e.target.checked)} disabled={busy} aria-describedby={ids.keepHelp} className="mt-1 h-4 w-4 accent-[var(--fanous-color-primary)]" data-testid="move-keep-email" />
        <div>
          <label htmlFor={ids.keep} className={`text-sm font-medium ${TEXT}`}>{f.keepContactEmail}</label>
          <p id={ids.keepHelp} className={`text-xs ${SOFT}`}>{f.keepContactEmailHelp}</p>
        </div>
      </div>

      <div>
        <label htmlFor={ids.typed} className={`mb-1 block text-sm font-medium ${TEXT}`}>{f.confirm.replace('{handle}', isolate(`@${handle}`))}</label>
        <input id={ids.typed} value={typed} onChange={(e) => setTyped(e.target.value)} disabled={busy} dir="ltr" autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={200} className={`${FIELD} text-start`} data-testid="move-confirm" />
      </div>

      <Message message={error ? { kind: 'error', text: error.text } : null}>
        {error?.signIn && <a href={loginRoutePath(movePath(locale, channelId), locale, 'login')} className={PRIMARY} data-testid="move-reauth">{m.signIn.button}</a>}
      </Message>

      <div className="flex justify-end">
        <button type="submit" disabled={!receiver || !matches || busy} aria-busy={busy} className={PRIMARY} data-testid="move-send">{busy ? f.sending : f.send}</button>
      </div>
    </form>
  );
}
