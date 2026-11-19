'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CREATOR_TIER_BOUNDS, CREATOR_TIER_IDS, CREATOR_TIER_TEXT, localizeDigits, parseDigits, type CreatorTier } from '@al-ummah/shared-types';
import type { ActionResult } from '@/lib/api/errors';
import { isUnexpectedFailure, tierActionMessage, tierEffect, tierFormPayload, tierToForm, validateTierForm, type TierField, type TierFormValues, type TierPayload, tierLabel, arabicMissing } from '@/lib/creator-tiers';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatCount, formatNumber, type MessageKey } from '@/i18n/translate';
import Link from '@/components/AppLink';
import { cardClass, fieldClass, linkClass } from '@/components/ui';
import { LocalizedFieldPair } from '@/components/localized/LocalizedFieldPair';
import { Chip, dangerButtonClass } from '@/components/content/parts';
import { logger } from '@/lib/logger-client';
import { reportError } from '@/lib/errors/reporter';
import { TierChangeDialog, confirmButtonClass } from './TierChangeDialog';
import { DefaultTierButton, type SetDefaultTierAction } from './DefaultTierButton';
import { useUndoableAction } from '@/components/undo/UndoToast';

type Message = { kind: 'ok' | 'error'; text: string } | null;

/** Server actions (lib/api/creators saveCreatorTier / deleteCreatorTier), passed down from the page. */
export interface TierActions {
  save: (tier: TierPayload, create: boolean) => Promise<ActionResult<unknown>>;
  remove: (id: string) => Promise<ActionResult<unknown>>;
  /** Makes a tier (or 'none') the default, with Undo */
  setDefault?: SetDefaultTierAction;
  /** Reorders the tiers (rank), with Undo */
  reorder?: (ids: string[], opts?: { undo?: boolean }) => Promise<ActionResult<{ previous: string[]; order: string[] }>>;
}
type Pending = 'save' | 'delete' | null;

const SHIPPED = new Set<string>(Object.values(CREATOR_TIER_IDS));


type NumberField = 'perHour' | 'perDay' | 'maxConcurrent' | 'captionMinutesMonth' | 'liveHoursMonth' | 'liveMaxConcurrent' | 'liveMaxStreamMinutes' | 'audioTracksPerVideo';

const HELP: Record<NumberField | 'maxChannels', MessageKey> = {
  perHour: 'creators.helpPerHour',
  perDay: 'creators.helpPerDay',
  maxConcurrent: 'creators.helpConcurrent',
  maxChannels: 'creators.helpChannels',
  captionMinutesMonth: 'creators.helpCaptions',
  audioTracksPerVideo: 'creators.helpAudioTracks',
  liveHoursMonth: 'creators.helpLiveHours',
  liveMaxConcurrent: 'creators.helpLiveConcurrent',
  liveMaxStreamMinutes: 'creators.helpLiveMaxMinutes',
};

/**
 * The Hidden switch of an existing tier: saves at once (audited by the tier save) and offers Undo. It sends
 * the stored tier with only `hidden` changed, so unsaved edits in the form are never saved with it. The
 * default tier cannot be hidden (the server refuses it too).
 */
function HiddenSwitch({ tier, canManage, isDefault, save, describedBy }: { tier: CreatorTier; canManage: boolean; isDefault: boolean; save: TierActions['save']; describedBy: string }) {
  const router = useRouter();
  const { t, locale } = useLanguage();
  const { run } = useUndoableAction();
  const [hidden, setHidden] = useState(tier.hidden);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = tierLabel(tier, locale);
  const send = async (value: boolean) => {
    const result = await save({ ...tierFormPayload(tierToForm(tier)), hidden: value }, false);
    if (!result.ok) throw new HiddenFailure(result);
    setHidden(value);
    router.refresh();
    return value;
  };
  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      await run({
        action: () => send(next),
        undo: async () => send(!next),
        message: t(next ? 'creators.tierHiddenOn' : 'creators.tierHiddenOff', { tier: name }),
        undoneMessage: t('creators.tierHiddenUndone'),
      });
    } catch (e) {
      const result: ActionFailure | { ok: false; status: number } = e instanceof HiddenFailure ? e.result : { ok: false, status: 0 };
      logger.warn('[creators] Tier hidden switch failed', { id: tier.id, status: result.status, code: 'code' in result ? result.code : undefined });
      if (isUnexpectedFailure(result)) reportError(e instanceof Error ? e : new Error(String(e)), { kind: 'fetch', status: result.status, shown: true });
      setError(t(tierActionMessage(result)));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <label className="flex items-center gap-2 text-sm text-fg">
        <input
          type="checkbox"
          checked={hidden}
          disabled={!canManage || busy || (isDefault && !hidden)}
          aria-describedby={describedBy}
          onChange={(e) => void toggle(e.target.checked)}
          className="h-4 w-4 accent-accent"
          data-testid={`tier-${tier.id}-hidden`}
        />
        {t('creators.tierHidden')}
      </label>
      {error && <span role="alert" className="ps-6 text-xs text-danger-fg" data-testid={`tier-${tier.id}-hidden-error`}>{error}</span>}
    </>
  );
}

type ActionFailure = Extract<ActionResult<unknown>, { ok: false }>;

class HiddenFailure extends Error {
  constructor(readonly result: ActionFailure) {
    super(`Tier hidden switch failed: ${result.status}`);
  }
}

/** One tier's limits, editable by admins (creators:manage); saved through admin-api with an audit row. */
function TierCard({ tier, users, invites = 0, canManage, actions, create = false, isDefault = false }: { tier?: CreatorTier; users: number; invites?: number; canManage: boolean; actions: TierActions; create?: boolean; isDefault?: boolean }) {
  const router = useRouter();
  const { t, locale } = useLanguage();
  const ids = useId();
  const [form, setForm] = useState<TierFormValues>(tierToForm(tier));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [message, setMessage] = useState<Message>(null);
  const key = create ? 'new' : tier?.id ?? '';
  const fixedUnlimited = tier?.id === CREATOR_TIER_IDS.unlimited;
  const errors = validateTierForm(form, { create });
  const shown = touched ? errors : {};
  const n = (value: number) => formatNumber(value, locale);
  const set = <K extends keyof TierFormValues>(field: K, value: TierFormValues[K]) => setForm((f) => ({ ...f, [field]: value }));

  async function run(action: () => Promise<ActionResult<unknown>>, ok: string) {
    setPending(null);
    setBusy(true);
    setMessage(null);
    let result: ActionResult<unknown>;
    try {
      result = await action();
    } catch (error) {
      result = { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
    }
    setBusy(false);
    if (!result.ok) {
      logger.warn('[creators] Tier action failed', { id: key, status: result.status, code: result.code });
      if (isUnexpectedFailure(result)) reportError(new Error(`Creator tier action failed: ${result.status} ${result.code ?? ''}`.trim()), { kind: 'fetch', status: result.status, shown: true });
      setMessage({ kind: 'error', text: t(tierActionMessage(result)) });
      return;
    }
    setMessage({ kind: 'ok', text: ok });
    if (create) {
      setForm(tierToForm());
      setTouched(false);
    }
    router.refresh();
  }

  const help = (field: TierField) => `${ids}-${field}-help`;
  const errorOf = (field: TierField) =>
    shown[field] ? (
      <span id={`${ids}-${field}-error`} className="text-xs text-danger-fg" data-testid={`tier-${key}-${field}-error`}>
        {t(shown[field]!.key, shown[field]!.params)}
      </span>
    ) : null;
  const errorText = (field: TierField) => (shown[field] ? t(shown[field]!.key, shown[field]!.params) : undefined);
  const described = (field: TierField) => [help(field), shown[field] ? `${ids}-${field}-error` : ''].filter(Boolean).join(' ');

  const number = (field: NumberField, label: string) => {
    const { min, max } = CREATOR_TIER_BOUNDS[field];
    return (
      <label className="flex flex-col gap-1 text-sm text-fg-muted">
        <span className="text-fg font-medium">{label}</span>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          required
          value={Number.isFinite(form[field]) ? localizeDigits(locale, form[field]) : ''}
          disabled={!canManage}
          aria-invalid={shown[field] ? true : undefined}
          aria-describedby={described(field)}
          onChange={(e) => set(field, e.target.value.trim() === '' ? NaN : Number(parseDigits(e.target.value.trim())))}
          className={fieldClass}
          dir="ltr"
          data-testid={`tier-${key}-${field}`}
        />
        <span id={help(field)} className="text-xs">{t(HELP[field], { min: n(min), max: n(max) })}</span>
        {errorOf(field)}
      </label>
    );
  };

  const flag = (field: 'uploads' | 'channels' | 'requestable' | 'hidden', label: string, forcedOn: boolean, describedBy?: string) => (
    <label className="flex items-center gap-2 text-sm text-fg">
      <input
        type="checkbox"
        checked={forcedOn || form[field]}
        disabled={!canManage || forcedOn}
        aria-describedby={describedBy}
        onChange={(e) => set(field, e.target.checked)}
        className="h-4 w-4 accent-accent"
        data-testid={`tier-${key}-${field}`}
      />
      {label}
    </label>
  );

  const saved = tier ?? null;
  const valid = Object.keys(errors).length === 0;

  return (
    <form
      noValidate
      className={`${cardClass} flex flex-col gap-4`}
      data-testid={`tier-card-${key}`}
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!valid) return;
        if (create) void run(() => actions.save(tierFormPayload(form), true), t('creators.tierSaved'));
        else setPending('save');
      }}
    >
      {!create && saved && (
        <p className="text-sm text-fg-muted" data-testid={`tier-${key}-effect`}>{tierEffect(saved, t, locale)}</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1 text-sm">
          <label className="flex items-center gap-2 text-fg pt-6">
            <input
              type="checkbox"
              checked={form.unlimited}
              disabled={!canManage || fixedUnlimited}
              aria-describedby={`${ids}-unlimited-help`}
              onChange={(e) => set('unlimited', e.target.checked)}
              className="h-4 w-4 accent-accent"
              data-testid={`tier-${key}-unlimited`}
            />
            {t('creators.tierUnlimited')}
          </label>
          <span id={`${ids}-unlimited-help`} className="text-xs text-fg-muted">
            {fixedUnlimited ? t('creators.helpUnlimitedFixed') : t('creators.helpUnlimited')}
          </span>
        </div>
        {/* Both languages required (L10N rule); Translate fills one from the other for review */}
        <div className="sm:col-span-2 flex flex-col gap-4">
          <LocalizedFieldPair
            id={`tier-${key}-name-pair`}
            label={t('creators.tierName')}
            field="tiers.name"
            value={{ en: form.name, ar: form.nameAr }}
            onChange={(v) => setForm((f) => ({ ...f, name: v.en, nameAr: v.ar }))}
            maxLength={CREATOR_TIER_TEXT.name}
            disabled={!canManage}
            errors={{ en: errorText('name'), ar: errorText('nameAr') }}
            help={t('creators.helpNamePair')}
            inputTestIds={{ en: `tier-${key}-name`, ar: `tier-${key}-nameAr` }}
          />
          <LocalizedFieldPair
            id={`tier-${key}-description-pair`}
            label={t('creators.tierDescription')}
            field="tiers.description"
            value={{ en: form.description, ar: form.descriptionAr }}
            onChange={(v) => setForm((f) => ({ ...f, description: v.en, descriptionAr: v.ar }))}
            maxLength={CREATOR_TIER_TEXT.description}
            disabled={!canManage}
            errors={{ en: errorText('description'), ar: errorText('descriptionAr') }}
            help={t('creators.helpDescriptionPair')}
            inputTestIds={{ en: `tier-${key}-description`, ar: `tier-${key}-descriptionAr` }}
          />
        </div>
      </div>
      <fieldset className="flex flex-col gap-2 rounded border border-border p-4" data-testid={`tier-${key}-access`}>
        <legend className="px-1 text-sm font-medium text-fg">{t('creators.tierAccess')}</legend>
        {/* Each switch says in one line what it allows and what a user without it sees */}
        <div className="flex flex-col gap-3">
          {([
            ['uploads', 'creators.tierUploadsFlag', 'creators.helpUploadsFlag'],
            ['channels', 'creators.tierChannelsFlag', 'creators.helpChannelsFlag'],
          ] as const).map(([field, label, help]) => (
            <div key={field} className="flex flex-col gap-1">
              {flag(field, t(label), form.unlimited, `${ids}-${field}-help`)}
              <span id={`${ids}-${field}-help`} className="ps-6 text-xs text-fg-muted" data-testid={`tier-${key}-${field}-help`}>{t(help)}</span>
            </div>
          ))}
        </div>
        {form.unlimited && <span className="text-xs text-fg-muted">{t('creators.helpFlagsUnlimited')}</span>}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1 text-sm">
          {flag('requestable', t('creators.tierRequestable'), false, `${ids}-requestable-help`)}
          <span id={`${ids}-requestable-help`} className="ps-6 text-xs text-fg-muted" data-testid={`tier-${key}-requestable-help`}>{t('creators.helpRequestable')}</span>
        </div>
        {/* Hidden (owner, 2026-11-19): a new tier sets it with Create; an existing tier switches at once, with Undo */}
        <div className="flex flex-col gap-1 text-sm">
          {create || !tier ? flag('hidden', t('creators.tierHidden'), false, `${ids}-hidden-help`) : <HiddenSwitch tier={tier} canManage={canManage} isDefault={isDefault} save={actions.save} describedBy={`${ids}-hidden-help`} />}
          <span id={`${ids}-hidden-help`} className="ps-6 text-xs text-fg-muted" data-testid={`tier-${key}-hidden-help`}>{t(isDefault ? 'creators.helpHiddenDefault' : 'creators.helpHidden')}</span>
        </div>
        {/* Rank is set by reordering the Rank list above (drag or move up/down), not typed here */}
      </div>
      {!form.unlimited && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {number('perHour', t('creators.tierPerHour'))}
          {number('perDay', t('creators.tierPerDay'))}
          {number('maxConcurrent', t('creators.tierConcurrent'))}
          <label className="flex flex-col gap-1 text-sm text-fg-muted">
            <span className="text-fg font-medium">{t('creators.tierChannels')}</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={form.maxChannels == null ? '' : localizeDigits(locale, form.maxChannels)}
              placeholder={t('creators.tierChannelsHint')}
              disabled={!canManage}
              aria-invalid={shown.maxChannels ? true : undefined}
              aria-describedby={described('maxChannels')}
              onChange={(e) => set('maxChannels', e.target.value.trim() === '' ? null : Number(parseDigits(e.target.value.trim())))}
              className={fieldClass}
              dir="ltr"
              data-testid={`tier-${key}-maxChannels`}
            />
            <span id={help('maxChannels')} className="text-xs">
              {t(HELP.maxChannels, { min: n(CREATOR_TIER_BOUNDS.maxChannels.min), max: n(CREATOR_TIER_BOUNDS.maxChannels.max) })}
            </span>
            {errorOf('maxChannels')}
          </label>
          {number('captionMinutesMonth', t('creators.tierCaptions'))}
          {number('audioTracksPerVideo', t('creators.tierAudioTracks'))}
        </div>
      )}
      <fieldset className="flex flex-col gap-3 border-t border-border pt-4" data-testid={`tier-${key}-live`}>
        <legend className="text-fg font-medium text-sm">{t('creators.tierLive')}</legend>
        {form.unlimited ? (
          <p className="text-xs text-fg-muted" data-testid={`tier-${key}-live-unlimited`}>{t('creators.helpLiveUnlimited')}</p>
        ) : (
          <>
            <div className="flex flex-col gap-1 text-sm">
              <label className="flex items-center gap-2 text-fg">
                <input
                  type="checkbox"
                  checked={form.live}
                  disabled={!canManage}
                  aria-describedby={`${ids}-live-help`}
                  onChange={(e) => set('live', e.target.checked)}
                  className="h-4 w-4 accent-accent"
                  data-testid={`tier-${key}-liveAllowed`}
                />
                {t('creators.tierLiveAllowed')}
              </label>
              <span id={`${ids}-live-help`} className="text-xs text-fg-muted">{t('creators.helpLive')}</span>
            </div>
            {form.live && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {number('liveHoursMonth', t('creators.tierLiveHours'))}
                {number('liveMaxConcurrent', t('creators.tierLiveConcurrent'))}
                {number('liveMaxStreamMinutes', t('creators.tierLiveMaxMinutes'))}
              </div>
            )}
          </>
        )}
      </fieldset>
      {canManage && (
        // Footer: Save / Create tier at the end edge; Delete and why it is blocked before it
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="submit" className={`${confirmButtonClass} order-last`} disabled={busy} data-testid={`tier-${key}-save`}>
            {busy ? t('creators.saving') : create ? t('creators.tierCreate') : t('creators.tierSave')}
          </button>
          {!create && tier && !SHIPPED.has(tier.id) && (
            <button
              type="button"
              className={dangerButtonClass}
              disabled={busy || users > 0 || invites > 0 || isDefault}
              aria-describedby={users > 0 || invites > 0 || isDefault ? `${ids}-delete-blocked` : undefined}
              onClick={() => setPending('delete')}
              data-testid={`tier-${key}-delete`}
            >
              {t('creators.tierDelete')}
            </button>
          )}
          {/* Owner rule: a tier users, pending invites or new sign-ups (the default) depend on cannot be deleted; say why and where to go */}
          {!create && tier && !SHIPPED.has(tier.id) && (users > 0 || invites > 0 || isDefault) && (
            <span id={`${ids}-delete-blocked`} className="flex flex-col gap-0.5 text-xs text-fg-muted" data-testid={`tier-${key}-delete-blocked`}>
              {isDefault && <span data-testid={`tier-${key}-is-default`}>{t('creators.tierIsDefault')}</span>}
              {users > 0 && (
                <span data-testid={`tier-${key}-in-use`}>
                  {users === 1 ? t('creators.tierInUseOne') : t('creators.tierInUseCount', { count: n(users) })}{' '}
                  <Link href={`/users?tier=${encodeURIComponent(tier.id)}`} className={`${linkClass} underline`} data-testid={`tier-${key}-users-link`}>
                    {t('creators.tierShowUsers')}
                  </Link>
                </span>
              )}
              {invites > 0 && (
                <span data-testid={`tier-${key}-invites`}>
                  {invites === 1 ? t('creators.tierInvitesOne') : t('creators.tierInvitesCount', { count: n(invites) })}{' '}
                  <Link href="/users/invites" className={`${linkClass} underline`} data-testid={`tier-${key}-invites-link`}>
                    {t('creators.tierShowInvites')}
                  </Link>
                </span>
              )}
            </span>
          )}
        </div>
      )}
      <p role="status" aria-live="polite" className="text-sm min-h-5" data-testid={`tier-${key}-status`}>
        {message && <span className={message.kind === 'ok' ? 'text-success-fg' : 'text-danger-fg'}>{message.text}</span>}
      </p>
      {!create && tier && (
        <TierChangeDialog
          open={pending !== null}
          title={pending === 'delete' ? t('creators.tierDeleteTitle', { name: tierLabel(tier, locale) }) : t('creators.tierSaveTitle', { name: tierLabel(tier, locale) })}
          body={pending === 'delete' ? t('creators.tierDeleteBody') : `${(users === 1 ? t('creators.tierSaveBodyOne') : t('creators.tierSaveBody', { count: n(users) }))} ${tierEffect(form, t, locale)}`}
          confirmLabel={pending === 'delete' ? t('creators.tierDelete') : t('creators.tierSave')}
          danger={pending === 'delete'}
          testId={`tier-${key}-confirm`}
          onCancel={() => setPending(null)}
          onConfirm={() =>
            void (pending === 'delete'
              ? run(() => actions.remove(tier.id), t('creators.tierDeleted'))
              // Hidden has its own switch (saved at once): Save keeps the stored value, never the form's stale copy
              : run(() => actions.save({ ...tierFormPayload(form), hidden: tier?.hidden ?? form.hidden }, false), t('creators.tierSaved')))
          }
        />
      )}
    </form>
  );
}

export function TierEditor({ tiers, counts, invites = {}, defaultTierId, canManage, actions }: { tiers: CreatorTier[]; counts: Record<string, number>; invites?: Record<string, number>; defaultTierId?: string; canManage: boolean; actions: TierActions }) {
  const { t, locale } = useLanguage();
  return (
    <div className="flex flex-col gap-6">
      {tiers.map((tier) => (
        <section key={tier.id} id={`tier-${tier.id}`} aria-labelledby={`tier-${tier.id}-title`} className="scroll-mt-6">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 id={`tier-${tier.id}-title`} className="text-lg font-semibold text-fg">{tierLabel(tier, locale)}</h2>
            {tier.hidden && <Chip tone="neutral" testId={`tier-${tier.id}-hidden-chip`}>{t('creators.hiddenChip')}</Chip>}
            {arabicMissing(tier) && (
              <Chip tone="warn" testId={`tier-${tier.id}-arabic-missing`}>
                <span title={t('creators.arabicMissingHelp')}>{t('creators.arabicMissing')}</span>
              </Chip>
            )}
            <Chip tone={tier.unlimited ? 'info' : 'good'} testId={`tier-${tier.id}-users`}>
              {formatCount(counts[tier.id] ?? 0, 'user', locale)}
            </Chip>
            {tier.id === defaultTierId ? (
              <Chip tone="info" testId={`tier-${tier.id}-default`}>{t('creators.tierDefaultChip')}</Chip>
            ) : (
              // A hidden tier cannot be the default (every new account gets the default): show it first
              canManage && actions.setDefault && !tier.hidden && (
                <DefaultTierButton tierId={tier.id} tierName={tierLabel(tier, locale)} label={t('creators.tierSetDefault')} setDefault={actions.setDefault} testId={`tier-${tier.id}-set-default`} />
              )
            )}
          </div>
          <TierCard tier={tier} users={counts[tier.id] ?? 0} invites={invites[tier.id] ?? 0} canManage={canManage} actions={actions} isDefault={tier.id === defaultTierId} />
        </section>
      ))}
      {canManage && (
        <section aria-labelledby="tier-add">
          <h2 id="tier-add" className="mb-2 text-lg font-semibold text-fg">{t('creators.tierAdd')}</h2>
          <TierCard users={0} canManage={canManage} actions={actions} create />
        </section>
      )}
    </div>
  );
}

