/**
 * /[locale]/upgrade (wiki AUN-TIER-REQUESTS): every requestable tier as a card
 * with what it includes, the viewer's current tier lit like a fanous, and a
 * Request button instead of a price. During the beta access is granted on an
 * acceptance basis; paid subscriptions come later (the notice says so).
 *
 * Requesting opens a dialog (name + "tell us about yourself"; Turnstile when
 * the env checks it). The user's latest request shows above the cards:
 * pending (with Withdraw), approved, or declined with the team's note.
 * Signed out, the cards are shown with "Sign in to request".
 *
 * Pay mode (wiki AUN-SUBS): when GET /api/billing/plans offers a tier, its
 * card shows the price (period, currency, provider choices) and Subscribe
 * instead of Request (components/upgrade/PayParts.tsx). Request-only tiers
 * and tiers without an offer keep the request flow; with payments off the
 * page is exactly the request page. Checkout returns to ?checkout=bco_…,
 * where the page confirms the subscription before showing the new tier.
 */
'use client';

import '@/theme/upgrade.css';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { BadgeCheck, Check, Clock, Minus, XCircle } from 'lucide-react';
import { TIER_REQUEST_LIMITS, type PublicTier, type TierRequest, type UpgradeOverview } from '@al-ummah/shared-types';
import Link from '@/components/common/AppLink';
import { FILLED, QUIET } from '@/components/upgrade/buttons';
import { useLanguage } from '@/hooks/useLanguage';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useProfile } from '@/hooks/useProfile';
import { userDisplayName } from '@/lib/display-name';
import { MAIN_CONTENT_ID } from '@/components/SkipLinks';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useHumanCheck } from '@/hooks/useHumanCheck';
import { refreshCreatorAccess } from '@/hooks/useCreatorAccess';
import { login } from '@/lib/actions';
import { upgradePath } from '@/lib/auth/sign-in-return';
import { fetchUpgradeOverview, submitTierRequest, withdrawTierRequest } from '@/lib/api/tier-requests-client';
import NotFoundPage from '@/components/NotFoundPage';
import { fetchBillingPlans } from '@/lib/api/billing-client';
import type { BillingTranslations as BillingCopy } from '@al-ummah/shared-types';
import { offerFor } from '@/lib/billing/pay';
import type { BillingOffer, BillingPlans } from '@al-ummah/shared-types';
import { CheckoutBanner, TierPricing, useCheckoutReturn, useSubscribe, type SubscribeRequest } from './PayParts';
import { cardState, fillCopy, requestErrorMessage, tierDescription, tierFeatures, tierName, validateRequestForm, type FormErrors, type Lang } from '@/lib/upgrade/tiers';
import { formatAbsoluteDate } from '@/lib/format/videoMeta';
import { TierRequestHistory } from './TierRequestHistory';
import { logger } from '@/lib/logger-client';
import { reportError } from '@/lib/errors/reporter';

const FILLED_WIDE = `${FILLED} w-full`;
const QUIET_WIDE = `${QUIET} w-full`;

type Load = { status: 'loading' } | { status: 'error' } | { status: 'off' } | { status: 'ready'; overview: UpgradeOverview };

/** A fanous: the beta notice's mark (the site's lantern motif, stroke icon set). */
function LanternMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2v2" />
      <path d="M9 4h6l1 3H8z" />
      <path d="M8 7c-1.2 2-1.8 4-1.8 6.2C6.2 16.6 8.8 19 12 19s5.8-2.4 5.8-5.8C17.8 11 17.2 9 16 7" />
      <path d="M12 10.5c-1 1.2-1.5 2.1-1.5 3a1.5 1.5 0 0 0 3 0c0-.9-.5-1.8-1.5-3z" />
      <path d="M9.5 19l-.5 3h6l-.5-3" />
    </svg>
  );
}

export function UpgradePage({ locale }: { locale: string }) {
  const { t, lang } = useLanguage();
  const copy = t.upgrade;
  const l: Lang = lang === 'ar' ? 'ar' : 'en';
  const { user } = useAuth();
  const signedIn = !!user;
  // The request's name starts from the profile (the display-name rule: display name → first + last →
  // email), editable in the dialog (owner, 2026-11-16)
  const { profile } = useProfile(user ?? null);
  const profileName = userDisplayName(profile, lang, profile?.email || user?.email) || user?.name || '';
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [asking, setAsking] = useState<PublicTier | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Bumped on every overview load, so "Your requests" re-reads after a request is filed or withdrawn
  const [loads, setLoads] = useState(0);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const bc = t.billing;
  const [plans, setPlans] = useState<BillingPlans | null>(null);

  const reload = useCallback(async () => {
    const res = await fetchUpgradeOverview();
    if (res.ok && res.result) {
      setLoad({ status: 'ready', overview: res.result });
      setLoads((n) => n + 1);
      // An approval since the last visit: the header's Upload and the menu follow at once
      if (res.result.request?.status === 'approved') void refreshCreatorAccess();
      return;
    }
    // Requests closed and no provider since the page was served: /upgrade is an off feature, so it becomes the
    // site's 404 like any other (owner decision 2026-11-19), never an error with Retry
    if (res.status === 404 && res.code === 'feature_off') {
      setLoad({ status: 'off' });
      return;
    }
    logger.warn('[upgrade] Overview not loaded', { status: res.status, code: res.code });
    if (res.status === 0 || res.status >= 500) reportError(new Error(`Upgrade overview failed: ${res.status} ${res.code ?? ''}`.trim()), { kind: 'fetch', status: res.status, shown: true });
    setLoad({ status: 'error' });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, user?.id]);

  // Payments off, or plans unavailable: the page stays the request page
  useEffect(() => {
    let live = true;
    void fetchBillingPlans().then((res) => {
      if (!live) return;
      if (res.ok && res.result) setPlans(res.result);
      else logger.warn('[upgrade] Billing plans not loaded', { status: res.status, code: res.code });
    });
    return () => {
      live = false;
    };
  }, []);

  const { confirm: checkout, startConfirm } = useCheckoutReturn(
    () => {
      void reload();
      void refreshCreatorAccess();
    },
    () => setNotice(bc.pay.canceledReturn),
  );
  const pay = useSubscribe({
    plans,
    locale,
    copy: bc,
    onCompleted: (checkoutId) => startConfirm(checkoutId),
    onClosed: () => setNotice(bc.pay.canceledReturn),
  });

  const withdraw = async (request: TierRequest) => {
    const ok = await confirm({
      title: copy.status.withdrawTitle,
      description: fillCopy(copy.status.withdrawBody, { tier: request.tierName }),
      confirmLabel: copy.status.withdrawConfirm,
      cancelLabel: copy.status.keep,
      danger: true,
      testId: 'tier-request-withdraw-dialog',
    });
    if (!ok) return;
    const res = await withdrawTierRequest(request.id);
    if (!res.ok) {
      if (res.status === 0 || res.status >= 500) reportError(new Error(`Tier request withdraw failed: ${res.status}`), { kind: 'fetch', status: res.status, shown: true });
      setNotice(requestErrorMessage(res.code, copy.errors));
    } else setNotice(copy.status.withdrawn);
    await reload();
  };

  const overview = load.status === 'ready' ? load.overview : null;
  // The server's mode decides (UPGRADE_MODES): the pay flow only while a payment provider is enabled
  const selling = overview?.mode === 'pay' && plans ? plans : null;
  const tierOf = (id: string) => overview?.tiers.find((x) => x.id === id) ?? null;

  if (load.status === 'off') return <NotFoundPage />;

  return (
    <main id={MAIN_CONTENT_ID} className="upg" data-testid="upgrade-page" data-mode={overview?.mode} data-payments={overview ? (overview.mode === 'pay' ? 'on' : 'off') : undefined}>
      <header className="upg-head">
        <h1 className="upg-title">{copy.title}</h1>
        <p className="upg-lead">{selling ? bc.pay.lead : overview && overview.mode !== 'request' ? copy.leadTiers : copy.lead}</p>
      </header>

      {/* The mode (UPGRADE_MODES): the beta notice and the request form only in request mode; closed says so plainly */}
      {overview?.mode === 'request' && (
        <aside className="upg-beta" data-slot="card" role="note" aria-labelledby="upg-beta-title" data-testid="upgrade-beta-notice">
          <span className="upg-beta-mark"><LanternMark /></span>
          <div>
            <h2 id="upg-beta-title" className="upg-beta-title">{copy.betaTitle}</h2>
            <p className="upg-beta-body">{copy.betaBody}</p>
          </div>
        </aside>
      )}
      {/* Closed: no requests and no word about it (owner rule: an off feature leaves no trace); the tiers still show */}

      <p className="upg-notice" role="status" aria-live="polite" data-testid="upgrade-notice" data-tone={notice === bc.pay.canceledReturn ? 'neutral' : undefined}>{notice}</p>

      {checkout && (
        <CheckoutBanner
          confirm={checkout}
          tierLabel={(id, fallback) => { const tier = tierOf(id); return tier ? tierName(tier, l) : fallback; }}
          locale={locale}
          copy={bc}
        />
      )}

      {overview?.request && overview.request.status !== 'withdrawn' && (
        <RequestStatus request={overview.request} tier={tierOf(overview.request.tierId)} lang={l} locale={locale} onWithdraw={withdraw} />
      )}

      <section aria-labelledby="upg-tiers-h" className="upg-tiers">
        <h2 id="upg-tiers-h" className="sr-only">{copy.tiersHeading}</h2>
        {load.status === 'loading' && (
          <ul className="upg-grid" aria-busy="true" data-testid="upgrade-loading">
            {[0, 1, 2].map((i) => <li key={i} className="upg-card upg-card-skel" data-slot="card" aria-hidden="true" />)}
          </ul>
        )}
        {load.status === 'error' && (
          <div className="upg-error" data-slot="card" role="alert" data-testid="upgrade-error">
            <p>{copy.errors.loadFailed}</p>
            <button type="button" className={QUIET} data-slot="button" onClick={() => { setLoad({ status: 'loading' }); void reload(); }}>{copy.errors.retry}</button>
          </div>
        )}
        {overview && (
          <ul className="upg-grid" data-testid="upgrade-tiers">
            {overview.tiers.map((tier) => (
              <TierCard
                key={tier.id}
                tier={tier}
                state={cardState(tier, overview, signedIn)}
                lang={l}
                locale={locale}
                onRequest={() => { setNotice(null); setAsking(tier); }}
                pay={selling ? { plans: selling, offer: offerFor(selling, tier.id), signedIn, copy: bc, busy: pay.busy === tier.id, error: pay.error?.tierId === tier.id ? pay.error.message : null, onSubscribe: (r) => { setNotice(null); void pay.subscribe(r); } } : null}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Every request the user made, whatever the mode (an earlier request keeps its history when requests close) */}
      {overview && signedIn && <TierRequestHistory tiers={overview.tiers} refreshKey={loads} />}

      {/* How requests work: only while the page takes requests */}
      {overview?.mode === 'request' && (
        <section className="upg-how" aria-labelledby="upg-how-h">
          <h2 id="upg-how-h" className="upg-how-title">{copy.howTitle}</h2>
          <ol className="upg-steps">
            {([[copy.step1Title, copy.step1Body], [copy.step2Title, copy.step2Body], [copy.step3Title, copy.step3Body]] as const).map(([title, body]) => (
              <li key={title} className="upg-step">
                <h3 className="upg-step-title">{title}</h3>
                <p className="upg-step-body">{body}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {overview && (
        <RequestDialog
          tier={asking}
          lang={l}
          defaultName={profileName}
          siteKey={overview.turnstileSiteKey}
          onClose={() => setAsking(null)}
          onSent={async () => {
            setAsking(null);
            setNotice(copy.form.sent);
            await reload();
          }}
        />
      )}
      {confirmDialog}
    </main>
  );
}

interface CardPay {
  plans: BillingPlans;
  offer: BillingOffer | null;
  signedIn: boolean;
  copy: BillingCopy;
  busy: boolean;
  error: string | null;
  onSubscribe: (request: SubscribeRequest) => void;
}

function TierCard({ tier, state, lang, locale, onRequest, pay }: { tier: PublicTier; state: ReturnType<typeof cardState>; isDefault?: boolean; lang: Lang; locale: string; onRequest: () => void; pay: CardPay | null }) {
  const { t } = useLanguage();
  const copy = t.upgrade;
  const name = tierName(tier, lang);
  const description = tierDescription(tier, lang);
  const headingId = useId();
  // A tier on sale sells (signed out: sign in first); the viewer's own tier stays "Current"
  const selling = pay?.offer && state !== 'current' ? pay.offer : null;
  return (
    <li className="upg-card" data-slot="card" data-state={state} data-sale={selling ? 'pay' : undefined} data-testid={`tier-card-${tier.id}`} aria-labelledby={headingId} aria-current={state === 'current' ? 'true' : undefined}>
      <h3 id={headingId} className="upg-name">{name}</h3>
      {description && <p className="upg-desc">{description}</p>}
      <h4 className="sr-only">{copy.includes}</h4>
      <ul className="upg-feats">
        {tierFeatures(tier, copy, lang).map((f) => (
          <li key={f.key} className="upg-feat" data-included={f.included} data-testid={`tier-${tier.id}-${f.key}`}>
            {f.included ? <Check className="upg-feat-icon" aria-hidden="true" /> : <Minus className="upg-feat-icon" aria-hidden="true" />}
            <span>{f.text}</span>
          </li>
        ))}
      </ul>
      <div className="upg-foot">
        {selling && pay && (
          <TierPricing
            tierId={tier.id}
            tierLabel={name}
            offer={selling}
            plans={pay.plans}
            lang={lang}
            locale={locale}
            signedIn={pay.signedIn}
            copy={pay.copy}
            busy={pay.busy}
            error={pay.error}
            onSubscribe={pay.onSubscribe}
          />
        )}
        {state === 'current' && (
          <p className="upg-pill upg-pill-current" data-testid={`tier-${tier.id}-current`}>
            <BadgeCheck aria-hidden="true" />
            {copy.current}
          </p>
        )}
        {!selling && state === 'requested' && (
          <p className="upg-pill" data-testid={`tier-${tier.id}-requested`}>
            <Clock aria-hidden="true" />
            {copy.requested}
          </p>
        )}
        {!selling && (state === 'request' || state === 'waiting') && (
          <button type="button" className={FILLED_WIDE} data-slot="button" onClick={onRequest} disabled={state === 'waiting'} aria-label={fillCopy(copy.requestLabel, { tier: name })} data-testid={`tier-${tier.id}-request`}>
            {copy.request}
          </button>
        )}
        {!selling && state === 'sign-in' && (
          <form action={login.bind(null, locale, upgradePath(locale))}>
            <button type="submit" className={QUIET_WIDE} data-slot="button" data-testid={`tier-${tier.id}-sign-in`}>{copy.signInToRequest}</button>
          </form>
        )}
      </div>
    </li>
  );
}

function RequestStatus({ request, tier, lang, locale, onWithdraw }: { request: TierRequest; tier: PublicTier | null; lang: Lang; locale: string; onWithdraw: (r: TierRequest) => void }) {
  const { t } = useLanguage();
  const s = t.upgrade.status;
  const name = tier ? tierName(tier, lang) : request.tierName;
  const Icon = request.status === 'pending' ? Clock : request.status === 'approved' ? BadgeCheck : XCircle;
  const title = request.status === 'pending' ? s.pendingTitle : request.status === 'approved' ? s.approvedTitle : s.declinedTitle;
  return (
    <section className="upg-status" data-slot="card" data-status={request.status} data-testid="tier-request-status" aria-labelledby="upg-status-title">
      <span className="upg-status-icon"><Icon aria-hidden="true" /></span>
      <div className="upg-status-text">
        <h2 id="upg-status-title" className="upg-status-title">{fillCopy(title, { tier: name })}</h2>
        {request.status === 'pending' && <p>{fillCopy(s.pendingBody, { date: formatAbsoluteDate(request.createdAt, lang) })}</p>}
        {request.status === 'approved' && <p>{s.approvedBody}</p>}
        {request.status === 'declined' && (
          <>
            {request.declineReason && (
              <div className="upg-note upg-status-reason" data-testid="tier-request-reason">
                <p className="upg-note-label">{s.declinedReason}</p>
                <p className="upg-note-text" dir="auto">{request.declineReason}</p>
              </div>
            )}
            <p>{s.declinedBody}</p>
          </>
        )}
      </div>
      <div className="upg-status-action">
        {request.status === 'pending' && (
          <button type="button" className={QUIET} data-slot="button" onClick={() => onWithdraw(request)} data-testid="tier-request-withdraw">{s.withdraw}</button>
        )}
        {request.status === 'approved' && tier?.uploads && (
          <Link href={`/${locale}/upload`} className={FILLED} data-slot="button" data-testid="tier-request-upload">{s.approvedUpload}</Link>
        )}
      </div>
    </section>
  );
}

function RequestDialog({ tier, lang, defaultName, siteKey, onClose, onSent }: { tier: PublicTier | null; lang: Lang; defaultName: string; siteKey: string | null; onClose: () => void; onSent: () => Promise<void> }) {
  const { t } = useLanguage();
  const f = t.upgrade.form;
  const ids = useId();
  const { ensureHuman, checking } = useHumanCheck();
  const [name, setName] = useState(defaultName);
  const [about, setAbout] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const aboutRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!tier) return;
    setName((n) => n || defaultName);
    setErrors({});
    setFailure(null);
  }, [tier, defaultName]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!tier || busy) return;
    const found = validateRequestForm({ name, about }, f);
    setErrors(found);
    if (found.name) return nameRef.current?.focus();
    if (found.about) return aboutRef.current?.focus();
    setBusy(true);
    setFailure(null);
    try {
      const input = { tierId: tier.id, name: name.trim(), about: about.trim() };
      let token: string | undefined;
      if (siteKey) {
        const human = await ensureHuman('tier_request', siteKey);
        if (!human.ok) return setFailure(t.upgrade.errors.humanCheck);
        token = human.token;
      }
      let res = await submitTierRequest(input, token);
      // The server asked for the check (no site key known up front, or the token expired)
      if (res.status === 403 && res.code === 'human_check_required' && res.siteKey) {
        const human = await ensureHuman('tier_request', res.siteKey);
        if (!human.ok) return setFailure(t.upgrade.errors.humanCheck);
        res = await submitTierRequest(input, human.token);
      }
      if (res.ok) {
        setAbout('');
        await onSent();
        return;
      }
      logger.warn('[upgrade] Request refused', { status: res.status, code: res.code });
      if (res.status === 0 || res.status >= 500) reportError(new Error(`Tier request failed: ${res.status} ${res.code ?? ''}`.trim()), { kind: 'fetch', status: res.status, shown: true });
      setFailure(requestErrorMessage(res.code, t.upgrade.errors));
    } finally {
      setBusy(false);
    }
  };

  const tierLabel = tier ? tierName(tier, lang) : '';
  const count = (value: string, max: number) => fillCopy(f.count, { count: [...value].length, max });
  return (
    <Dialog open={!!tier} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="upg-dialog" data-testid="tier-request-dialog">
        <DialogTitle className="upg-dialog-title">{f.title}</DialogTitle>
        <p className="upg-dialog-tier" data-testid="tier-request-dialog-tier">{fillCopy(f.tierLine, { tier: tierLabel })}</p>
        <DialogDescription className="upg-dialog-desc">{f.description}</DialogDescription>
        <form className="upg-form" onSubmit={submit} noValidate>
          <div className="upg-field">
            <label htmlFor={`${ids}-name`}>{f.name}</label>
            <input
              ref={nameRef}
              id={`${ids}-name`}
              // Password managers and browser autofill (owner, 2026-11-16): a named field with the standard token
              name="name"
              type="text"
              className="upg-input"
              value={name}
              maxLength={TIER_REQUEST_LIMITS.name.max}
              autoComplete="name"
              dir="auto"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={`${ids}-name-help${errors.name ? ` ${ids}-name-err` : ''}`}
              onChange={(e) => setName(e.target.value)}
              data-testid="tier-request-name"
            />
            <p id={`${ids}-name-help`} className="upg-help">{f.nameHelp}</p>
            {errors.name && <p id={`${ids}-name-err`} className="upg-err">{errors.name}</p>}
          </div>
          <div className="upg-field">
            <label htmlFor={`${ids}-about`}>{f.about}</label>
            <textarea
              ref={aboutRef}
              id={`${ids}-about`}
              name="about"
              className="upg-input upg-textarea"
              value={about}
              rows={6}
              maxLength={TIER_REQUEST_LIMITS.about.max}
              dir="auto"
              aria-invalid={errors.about ? true : undefined}
              aria-describedby={`${ids}-about-help ${ids}-about-count${errors.about ? ` ${ids}-about-err` : ''}`}
              onChange={(e) => setAbout(e.target.value)}
              data-testid="tier-request-about"
            />
            <div className="upg-help-row">
              <p id={`${ids}-about-help`} className="upg-help">{f.aboutHelp}</p>
              <p id={`${ids}-about-count`} className="upg-count" aria-live="off">{count(about.trim(), TIER_REQUEST_LIMITS.about.max)}</p>
            </div>
            {errors.about && <p id={`${ids}-about-err`} className="upg-err">{errors.about}</p>}
          </div>
          {checking && <p className="upg-help" role="status">{f.checking}</p>}
          {failure && <p className="upg-err upg-form-err" role="alert" data-testid="tier-request-error">{failure}</p>}
          <div className="upg-form-actions">
            <button type="button" className={QUIET} data-slot="button" onClick={onClose} disabled={busy}>{f.cancel}</button>
            <button type="submit" className={FILLED} data-slot="button" disabled={busy} data-testid="tier-request-submit">{busy ? f.sending : f.submit}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
