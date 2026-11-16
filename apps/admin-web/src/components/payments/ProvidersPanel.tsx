'use client';

/**
 * Payments → Providers (wiki AUN-SUBS): each provider's on/off switch,
 * test/live mode, its non-secret settings per mode, its keys (write-only:
 * "Set" or "Not set", never the value), the webhook URL to register and what
 * is still missing before it can be on. Changes need billing:providers (super
 * admins); admin-api asks for a recent sign-in on the switch, the mode and the
 * keys (step-up), which the client turns into a fresh sign-in.
 */
import { useId, useState } from 'react';
import { PAYMENT_CREDENTIAL_FIELDS, PAYMENT_MODES, PAYMENT_PROVIDERS, type PaymentCredentialField, type PaymentMode, type PaymentProviderConfig } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatDate, type MessageKey } from '@/i18n/translate';
import { ActionFeedback, useConfirm } from '@/components/content/actions';
import { primarySmallButtonClass, smallButtonClass, dangerButtonClass } from '@/components/content/parts';
import { cardClass, fieldClass, linkClass } from '@/components/ui';
import { billingRequest } from '@/lib/list/api-client';
import { hasCredentials, hasLiveMode, parseMissing, providerSettings, settingValid, settingsChanges } from '@/lib/payments';
import { CopyButton, ToneChip, hintClass, labelClass, providerName, sectionTitle, useBillingAction } from './shared';

interface Props {
  providers: PaymentProviderConfig[];
  credentialStorage: boolean;
  canManage: boolean;
  /** Loads the overview again (after a change whose answer does not carry the provider) */
  onRefresh: () => Promise<void>;
}

export function ProvidersPanel({ providers, credentialStorage, canManage, onRefresh }: Props) {
  const { t } = useLanguage();
  return (
    <div className="space-y-6" data-testid="payments-providers">
      {!canManage && (
        <p className="text-sm text-fg-muted" data-testid="payments-providers-read-only">
          {t('payments.provider.readOnly')}
        </p>
      )}
      {providers.map((p) => (
        <ProviderCard key={p.id} provider={p} credentialStorage={credentialStorage} canManage={canManage} onRefresh={onRefresh} />
      ))}
    </div>
  );
}

function ProviderCard({ provider, credentialStorage, canManage, onRefresh }: { provider: PaymentProviderConfig; credentialStorage: boolean; canManage: boolean; onRefresh: () => Promise<void> }) {
  const { t, locale } = useLanguage();
  const ids = useId();
  const { confirm, dialog } = useConfirm();
  const { busy, error, notice, run } = useBillingAction(`payments-provider-${provider.id}`);
  const spec = PAYMENT_PROVIDERS[provider.id];
  const name = providerName(t, provider.id);
  const modeName = (m: PaymentMode) => t(`payments.modes.${m}`);
  const [viewMode, setViewMode] = useState<PaymentMode>(provider.mode);
  const locked = !canManage || busy !== null;

  const put = (key: string, body: Record<string, unknown>, message: string) =>
    run(key, async () => {
      await billingRequest('PUT', `providers/${provider.id}`, { body });
      await onRefresh();
      return message;
    });

  const toggle = async (enabled: boolean) => {
    if (!enabled) {
      const ok = await confirm({ title: t('payments.provider.disableTitle', { provider: name }), body: t('payments.provider.disableBody', { provider: name }), confirmLabel: t('payments.provider.disableConfirm'), danger: true, testId: `payments-disable-${provider.id}` });
      if (!ok) return;
    }
    await put('enabled', { enabled }, t(enabled ? 'payments.provider.enabledNotice' : 'payments.provider.disabledNotice', { provider: name }));
  };

  const changeMode = async (mode: PaymentMode) => {
    if (mode === provider.mode) return;
    if (mode === 'live') {
      const ok = await confirm({ title: t('payments.provider.liveTitle', { provider: name }), body: t('payments.provider.liveBody'), confirmLabel: t('payments.provider.liveConfirm'), testId: `payments-live-${provider.id}` });
      if (!ok) return;
    }
    if (await put('mode', { mode }, t('payments.provider.modeNotice', { provider: name, mode: modeName(mode) }))) setViewMode(mode);
  };

  return (
    <section className={cardClass} aria-labelledby={`${ids}-title`} data-testid={`payments-provider-${provider.id}`} data-enabled={provider.enabled ? 'true' : 'false'} data-mode={provider.mode}>
      {dialog}
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <h2 id={`${ids}-title`} className={sectionTitle}>
          {name}
        </h2>
        <ToneChip tone={provider.enabled ? 'good' : 'neutral'} testId={`payments-provider-state-${provider.id}`}>
          {provider.enabled ? t('payments.provider.on') : t('payments.provider.off')}
        </ToneChip>
        <ToneChip tone={provider.mode === 'live' ? 'warn' : 'info'}>{modeName(provider.mode)}</ToneChip>
      </div>
      <p className="text-sm text-fg-muted mb-4 flex flex-wrap gap-x-3">
        {spec.merchantOfRecord && <span>{t('payments.provider.merchantOfRecord', { provider: name })}</span>}
        <a href={spec.docsUrl} target="_blank" rel="noreferrer noopener" className={linkClass}>
          {t('payments.provider.docs')}
        </a>
        {provider.updatedAt && <span>{t('payments.provider.changed', { date: formatDate(provider.updatedAt, locale, true) })}</span>}
      </p>

      <ActionFeedback error={error} message={notice} testId={`payments-provider-feedback-${provider.id}`} />

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              role="switch"
              className="mt-0.5 h-4 w-4 accent-accent"
              checked={provider.enabled}
              disabled={locked}
              onChange={(e) => void toggle(e.currentTarget.checked)}
              data-testid={`payments-enable-${provider.id}`}
            />
            <span className="font-medium text-fg">{t('payments.provider.switchLabel', { provider: name })}</span>
          </label>

          <fieldset>
            <legend className={labelClass}>{t('payments.provider.mode')}</legend>
            {hasLiveMode(provider.id) ? (
              <div className="flex flex-wrap gap-4">
                {PAYMENT_MODES.map((m) => (
                  <label key={m} className="inline-flex items-center gap-2 text-sm text-fg">
                    <input type="radio" name={`${ids}-mode`} value={m} checked={provider.mode === m} disabled={locked} onChange={() => void changeMode(m)} data-testid={`payments-mode-${provider.id}-${m}`} />
                    {modeName(m)}
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-sm text-fg-muted">{t('payments.provider.noLiveMode')}</p>
            )}
            <p className={hintClass}>{t('payments.provider.modeHint')}</p>
          </fieldset>

          <Missing provider={provider} name={name} />

          <div>
            <p className={labelClass} id={`${ids}-webhook`}>
              {t('payments.provider.webhook')}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code dir="ltr" aria-labelledby={`${ids}-webhook`} className="min-w-0 max-w-full break-all rounded bg-surface-2 border border-border px-2 py-1 text-xs text-fg" data-testid={`payments-webhook-${provider.id}`}>
                {provider.webhookUrl}
              </code>
              <CopyButton value={provider.webhookUrl} className={smallButtonClass} testId={`payments-webhook-copy-${provider.id}`} />
            </div>
            <p className={hintClass}>{t('payments.provider.webhookHint')}</p>
          </div>

          {canManage && (
            <button
              type="button"
              className={smallButtonClass}
              disabled={locked}
              onClick={() =>
                void run('sync', async () => {
                  await billingRequest('POST', `providers/${provider.id}/sync-prices`, { body: {} });
                  return t('payments.provider.syncQueued', { provider: name });
                })
              }
              data-testid={`payments-sync-${provider.id}`}
            >
              {t('payments.provider.sync', { provider: name })}
            </button>
          )}
        </div>

        <div className="space-y-4">
          {(spec.settings.length > 0 || hasCredentials(provider.id)) && hasLiveMode(provider.id) && (
            <fieldset>
              <legend className={labelClass}>{t('payments.provider.viewMode')}</legend>
              <div className="flex flex-wrap gap-4">
                {PAYMENT_MODES.map((m) => (
                  <label key={m} className="inline-flex items-center gap-2 text-sm text-fg">
                    <input type="radio" name={`${ids}-view`} value={m} checked={viewMode === m} onChange={() => setViewMode(m)} data-testid={`payments-view-${provider.id}-${m}`} />
                    {modeName(m)}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {spec.settings.length > 0 && <SettingsForm key={viewMode} provider={provider} mode={viewMode} locked={locked} canManage={canManage} onSave={(changes) => put('settings', { settings: changes }, t('payments.saved'))} />}
          {hasCredentials(provider.id) ? (
            <Credentials provider={provider} mode={viewMode} credentialStorage={credentialStorage} canManage={canManage} locked={locked} confirm={confirm} run={run} onRefresh={onRefresh} />
          ) : (
            <p className="text-sm text-fg-muted">{t('payments.provider.noCredentials')}</p>
          )}
        </div>
      </div>
    </section>
  );
}

function Missing({ provider, name }: { provider: PaymentProviderConfig; name: string }) {
  const { t } = useLanguage();
  const mode = t(`payments.modes.${provider.mode}`);
  if (provider.missing.length === 0) {
    return (
      <p className="text-sm text-success-fg" data-testid={`payments-ready-${provider.id}`}>
        {t('payments.provider.ready', { mode })}
      </p>
    );
  }
  const label = (kind: string, n: string) => {
    if (kind === 'setting') return t(`payments.provider.settings.${n}` as MessageKey);
    if (kind === 'credential' || kind === 'binding') return t(`payments.provider.credentialFields.${n}` as MessageKey);
    return n;
  };
  return (
    <div className="rounded border border-border bg-surface-2 p-3" data-testid={`payments-missing-${provider.id}`}>
      <p className="text-sm font-medium text-fg mb-1">{t('payments.provider.missingTitle', { provider: name, mode })}</p>
      <ul className="list-disc ps-5 text-sm text-fg-muted space-y-0.5">
        {provider.missing.map((item) => {
          const { kind, name: n } = parseMissing(item);
          return <li key={item}>{t(`payments.provider.missing.${kind}` as MessageKey, { name: label(kind, n) })}</li>;
        })}
      </ul>
    </div>
  );
}

function SettingsForm({ provider, mode, locked, canManage, onSave }: { provider: PaymentProviderConfig; mode: PaymentMode; locked: boolean; canManage: boolean; onSave: (changes: Record<string, string | null>) => Promise<boolean> }) {
  const { t } = useLanguage();
  const ids = useId();
  const fields = providerSettings(provider.id, mode);
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.storageKey, provider.settings[f.storageKey] ?? ''])));
  const [invalid, setInvalid] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const bad = fields.find((f) => !settingValid(f.spec, draft[f.storageKey] ?? ''));
        if (bad) {
          setInvalid(t('payments.provider.invalidSetting', { name: t(`payments.provider.settings.${bad.spec.key}` as MessageKey) }));
          return;
        }
        setInvalid(null);
        const changes = settingsChanges(provider.settings, draft);
        if (Object.keys(changes).length) void onSave(changes);
      }}
      data-testid={`payments-settings-${provider.id}`}
    >
      <h3 className="font-medium text-fg">{t('payments.provider.settingsTitle')}</h3>
      {fields.map(({ spec, storageKey }) => {
        const id = `${ids}-${spec.key}`;
        const label = t(`payments.provider.settings.${spec.key}` as MessageKey);
        return (
          <div key={storageKey}>
            <label htmlFor={id} className={labelClass}>
              {label}
            </label>
            {spec.kind === 'choice' ? (
              <select id={id} className={`${fieldClass} w-full`} value={draft[storageKey] ?? ''} disabled={!canManage} onChange={(e) => setDraft((d) => ({ ...d, [storageKey]: e.target.value }))} aria-describedby={`${id}-hint`}>
                <option value="">{t('payments.provider.choose')}</option>
                {(spec.options ?? []).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input id={id} dir="ltr" className={`${fieldClass} w-full`} value={draft[storageKey] ?? ''} maxLength={spec.maxLength} readOnly={!canManage} autoComplete="off" spellCheck={false} onChange={(e) => setDraft((d) => ({ ...d, [storageKey]: e.target.value }))} aria-describedby={`${id}-hint`} data-testid={`payments-setting-${provider.id}-${spec.key}`} />
            )}
            <p id={`${id}-hint`} className={hintClass}>
              {t(`payments.provider.settingHints.${spec.key}` as MessageKey)}
              {spec.perMode ? ` ${t('payments.provider.perMode')}` : ''}
            </p>
          </div>
        );
      })}
      {invalid && (
        <p role="alert" className="text-sm text-danger-fg">
          {invalid}
        </p>
      )}
      {canManage && (
        <button type="submit" className={primarySmallButtonClass} disabled={locked} data-testid={`payments-settings-save-${provider.id}`}>
          {t('payments.provider.saveSettings')}
        </button>
      )}
    </form>
  );
}

type Confirm = ReturnType<typeof useConfirm>['confirm'];
type Run = ReturnType<typeof useBillingAction>['run'];

function Credentials({ provider, mode, credentialStorage, canManage, locked, confirm, run, onRefresh }: { provider: PaymentProviderConfig; mode: PaymentMode; credentialStorage: boolean; canManage: boolean; locked: boolean; confirm: Confirm; run: Run; onRefresh: () => Promise<void> }) {
  const { t } = useLanguage();
  const modeName = t(`payments.modes.${mode}`);
  return (
    <div className="space-y-3" data-testid={`payments-credentials-${provider.id}`}>
      <h3 className="font-medium text-fg">{t('payments.provider.credentialsTitle', { mode: modeName })}</h3>
      <p className={hintClass}>{t('payments.provider.credentialsHint')}</p>
      {!credentialStorage && (
        <p className="rounded border border-border bg-surface-2 p-3 text-sm text-fg" data-testid="payments-no-storage">
          {t('payments.provider.noStorage')}
        </p>
      )}
      {PAYMENT_CREDENTIAL_FIELDS.map((field) => (
        <CredentialRow key={`${field}-${mode}`} provider={provider} field={field} mode={mode} writable={canManage && credentialStorage} locked={locked} confirm={confirm} run={run} onRefresh={onRefresh} />
      ))}
    </div>
  );
}

function CredentialRow({ provider, field, mode, writable, locked, confirm, run, onRefresh }: { provider: PaymentProviderConfig; field: PaymentCredentialField; mode: PaymentMode; writable: boolean; locked: boolean; confirm: Confirm; run: Run; onRefresh: () => Promise<void> }) {
  const { t, locale } = useLanguage();
  const id = useId();
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);
  const status = provider.credentials[field]?.[mode];
  const fieldName = t(`payments.provider.credentialFields.${field}`);
  const name = providerName(t, provider.id);

  const write = (next: string | null, message: string) =>
    run(`credential-${field}`, async () => {
      await billingRequest('PUT', `providers/${provider.id}/credentials`, { body: { field, mode, value: next } });
      setValue('');
      await onRefresh();
      return message;
    });

  return (
    <div className="rounded border border-border p-3" data-testid={`payments-credential-${provider.id}-${field}`} data-set={status ? 'true' : 'false'}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span className="text-sm font-medium text-fg">{fieldName}</span>
        <ToneChip tone={status ? 'good' : 'neutral'}>{status ? t('payments.provider.setOn', { date: formatDate(status.setAt, locale, true) }) : t('payments.provider.notSet')}</ToneChip>
      </div>
      {writable && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = value.trim();
            if (!v) return;
            if (/\s/.test(v)) {
              setInvalid(true);
              return;
            }
            setInvalid(false);
            void write(v, t('payments.provider.credentialSaved', { field: fieldName }));
          }}
        >
          <div className="min-w-0 flex-1">
            <label htmlFor={id} className="sr-only">
              {t('payments.provider.newValue', { field: fieldName })}
            </label>
            <input
              id={id}
              type="password"
              dir="ltr"
              autoComplete="new-password"
              spellCheck={false}
              maxLength={500}
              className={`${fieldClass} w-full`}
              placeholder={t('payments.provider.newValue', { field: fieldName })}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? `${id}-err` : undefined}
              data-testid={`payments-credential-input-${provider.id}-${field}`}
            />
          </div>
          <button type="submit" className={smallButtonClass} disabled={locked || !value.trim()} data-testid={`payments-credential-save-${provider.id}-${field}`}>
            {status ? t('payments.provider.replace') : t('payments.provider.save')}
          </button>
          {status && (
            <button
              type="button"
              className={dangerButtonClass}
              disabled={locked}
              onClick={async () => {
                const ok = await confirm({
                  title: t('payments.provider.clearTitle', { field: fieldName }),
                  body: t('payments.provider.clearBody', { field: fieldName, mode: t(`payments.modes.${mode}`), provider: name }),
                  confirmLabel: t('payments.provider.clearConfirm'),
                  danger: true,
                  testId: `payments-clear-${provider.id}-${field}`,
                });
                if (ok) await write(null, t('payments.provider.credentialCleared', { field: fieldName }));
              }}
              data-testid={`payments-credential-clear-${provider.id}-${field}`}
            >
              {t('payments.provider.clear')}
            </button>
          )}
          {invalid && (
            <p id={`${id}-err`} role="alert" className="basis-full text-sm text-danger-fg">
              {t('payments.provider.noSpaces')}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
