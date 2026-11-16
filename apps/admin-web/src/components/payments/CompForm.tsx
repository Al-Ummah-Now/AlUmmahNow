'use client';

/**
 * Grant a complimentary tier (wiki AUN-SUBS, BillingCompInput): a tier
 * without payment until a date or until an admin cancels it, with a reason
 * kept in the audit log. billing:manage; admin-api asks for a recent sign-in
 * (step-up). Used on the Subscriptions list and on the user page (the user id
 * filled in).
 */
import { useId, useState } from 'react';
import { useUndoableAction } from '@/components/undo/UndoToast';
import { BILLING_COMP_REASON_MAX } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatDate } from '@/i18n/translate';
import { ActionFeedback } from '@/components/content/actions';
import { primarySmallButtonClass, smallButtonClass } from '@/components/content/parts';
import { fieldClass } from '@/components/ui';
import { Autocomplete } from '@/components/search/Autocomplete';
import { billingRequest } from '@/lib/list/api-client';
import { compUntil } from '@/lib/payments';
import { hintClass, labelClass, useBillingAction } from './shared';
import type { TierOption } from './PricesPanel';

type Problem = 'invalidUser' | 'chooseTier' | 'invalidUntil' | 'reasonRequired';

export function CompForm({ tiers, userId: fixedUser, onDone }: { tiers: TierOption[]; userId?: string; onDone?: () => void | Promise<void> }) {
  const { t, locale } = useLanguage();
  const ids = useId();
  const { busy, error, notice, run } = useBillingAction('payments-comp');
  const { run: withUndo } = useUndoableAction();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState(fixedUser ?? '');
  // The picked user's name, for the confirmation (never the id)
  const [userLabel, setUserLabel] = useState('');
  const [tierId, setTierId] = useState('');
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);

  const submit = async () => {
    const user = userId.trim();
    const end = compUntil(until);
    const why = reason.trim();
    const found: Problem | null = !user ? 'invalidUser' : !tierId ? 'chooseTier' : end === undefined ? 'invalidUntil' : !why ? 'reasonRequired' : null;
    setProblem(found);
    if (found || end === undefined) return;
    const tier = tiers.find((x) => x.id === tierId)?.name ?? tierId;
    // No confirm (admin UX rule): it acts at once and the toast says what was given, with Undo
    const given = t('payments.comp.confirmBody', { user: userLabel || t('payments.comp.thisUser'), tier, until: end ? t('payments.comp.untilDate', { date: formatDate(end, locale) }) : t('payments.comp.noEnd') });
    const done = await run('comp', async () => {
      // Acts at once with Undo: Undo ends the comp it just gave
      await withUndo({
        action: () => billingRequest<{ subscription: { id: string } }>('POST', 'comps', { body: { userId: user, tierId, until: end, reason: why } }),
        undo: async (r) => {
          await billingRequest('POST', `subscriptions/${encodeURIComponent(r.subscription.id)}/cancel`, { body: { atPeriodEnd: false, undo: true } });
          await onDone?.();
        },
        message: given,
        undoneMessage: t('payments.undone'),
      });
      return null;
    });
    if (done) {
      setReason('');
      setUntil('');
      if (!fixedUser) {
        setUserId('');
        setUserLabel('');
      }
      await onDone?.();
    }
  };

  const problemId = `${ids}-problem`;
  return (
    <div data-testid="payments-comp-form">
      <ActionFeedback error={error} message={notice} testId="payments-comp-feedback" />
      {!open ? (
        <button type="button" className={smallButtonClass} onClick={() => setOpen(true)} aria-expanded={false} data-testid="payments-comp-open">
          {t('payments.comp.open')}
        </button>
      ) : (
        <form
          className="rounded border border-border p-4 space-y-3"
          aria-labelledby={`${ids}-title`}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <h3 id={`${ids}-title`} className="font-medium text-fg">
            {t('payments.comp.title')}
          </h3>
          <p className={hintClass}>{t('payments.comp.hint')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {!fixedUser && (
              <div className="sm:col-span-2">
                {/* Admins never type ids: find the user by name, email or @handle */}
                <Autocomplete
                  kind="user"
                  mode="pick"
                  label={t('payments.comp.user')}
                  placeholder={t('payments.comp.userPlaceholder')}
                  hint={t('payments.comp.userHint')}
                  onChange={(id, item) => {
                    setUserId(id);
                    setUserLabel(item?.label ?? '');
                  }}
                  testId="payments-comp-user"
                />
              </div>
            )}
            <div>
              <label htmlFor={`${ids}-tier`} className={labelClass}>
                {t('payments.comp.tier')}
              </label>
              <select id={`${ids}-tier`} className={`${fieldClass} w-full`} value={tierId} onChange={(e) => setTierId(e.target.value)} aria-invalid={problem === 'chooseTier' || undefined} data-testid="payments-comp-tier">
                <option value="">{t('payments.provider.choose')}</option>
                {tiers.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${ids}-until`} className={labelClass}>
                {t('payments.comp.until')}
              </label>
              <input id={`${ids}-until`} type="date" className={`${fieldClass} w-full`} value={until} onChange={(e) => setUntil(e.target.value)} aria-describedby={`${ids}-until-hint`} aria-invalid={problem === 'invalidUntil' || undefined} data-testid="payments-comp-until" />
              <p id={`${ids}-until-hint`} className={hintClass}>
                {t('payments.comp.untilHint')}
              </p>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor={`${ids}-reason`} className={labelClass}>
                {t('payments.comp.reason')}
              </label>
              <textarea id={`${ids}-reason`} dir="auto" rows={2} className={`${fieldClass} w-full`} maxLength={BILLING_COMP_REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby={`${ids}-reason-hint`} aria-invalid={problem === 'reasonRequired' || undefined} data-testid="payments-comp-reason" />
              <p id={`${ids}-reason-hint`} className={hintClass}>
                {t('payments.comp.reasonHint')}
              </p>
            </div>
          </div>
          {problem && (
            <p id={problemId} role="alert" className="text-sm text-danger-fg">
              {t(`payments.comp.${problem}`)}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={primarySmallButtonClass} disabled={busy !== null} data-testid="payments-comp-submit">
              {t('payments.comp.submit')}
            </button>
            <button type="button" className={smallButtonClass} onClick={() => setOpen(false)}>
              {t('payments.comp.close')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
