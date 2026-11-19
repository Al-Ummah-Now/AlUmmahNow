'use client';

/**
 * "Try it" (issue #413): what one app build (platform, app, version, language, install id) would
 * get from the drafts on the page, before they are saved. api-videos evaluates them with the code
 * that serves the apps, so the answer is exactly what the build would see; nothing is written.
 */
import { useId, useState } from 'react';
import { APP_CONFIG_APPS, APP_CONFIG_PLATFORMS, APP_CONFIG_SEMVER, type AppConfigApp, type AppConfigContext, type AppConfigDocumentKey, type AppConfigPlatform, type AppConfigResult } from '@al-ummah/shared-types';
import { evaluateAppConfig } from '@/lib/api/appConfig';
import { useLanguage } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/translate';
import { cardClass, fieldClass, secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';
import { Select } from '@/components/select/Select';

interface Props {
  /** The drafts as documents; null for one that still has problems */
  documents: () => Partial<Record<AppConfigDocumentKey, unknown>> | null;
}

const show = (value: unknown) => JSON.stringify(value);

export function DryRun({ documents }: Props) {
  const { t } = useLanguage();
  const ids = useId();
  const [context, setContext] = useState<AppConfigContext>({ platform: 'ios', app: 'viewer', version: '1.0.0', locale: '', installId: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AppConfigResult | null>(null);
  const versionOk = APP_CONFIG_SEMVER.test(context.version.trim());

  async function run(event: React.FormEvent) {
    event.preventDefault();
    if (!versionOk) return;
    const docs = documents();
    if (!docs) {
      setError(t('appConfig.runInvalid'));
      setResult(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ctx: AppConfigContext = { platform: context.platform, app: context.app, version: context.version.trim() };
      if (context.locale?.trim()) ctx.locale = context.locale.trim();
      if (context.installId?.trim()) ctx.installId = context.installId.trim();
      const res = await evaluateAppConfig(ctx, docs);
      if (res.ok) setResult(res.data);
      else {
        logger.warn('[app-config] Dry run failed', { status: res.status });
        setError(res.status === 400 ? t('appConfig.runInvalid') : t('appConfig.runFailed'));
        setResult(null);
      }
    } catch (e) {
      logger.error('[app-config] Dry run request failed', { error: e instanceof Error ? e.message : String(e) });
      setError(t('appConfig.runFailed'));
    } finally {
      setBusy(false);
    }
  }

  const input = (name: 'version' | 'locale' | 'installId', hint: MessageKey | null) => (
    <label className="flex min-w-0 flex-col gap-1 text-sm">
      <span className="text-fg-muted">{t(`appConfig.${name}` as MessageKey)}</span>
      <input
        value={context[name] ?? ''}
        onChange={(e) => setContext((c) => ({ ...c, [name]: e.target.value }))}
        dir="ltr"
        spellCheck={false}
        autoComplete="off"
        aria-invalid={name === 'version' && !versionOk ? true : undefined}
        aria-describedby={hint ? `${ids}-${name}-hint` : undefined}
        className={`${fieldClass} w-full font-mono`}
        data-testid={`app-config-dry-${name}`}
      />
      {hint && (
        <span id={`${ids}-${name}-hint`} className={`text-xs ${name === 'version' && !versionOk ? 'text-danger-fg' : 'text-fg-subtle'}`}>
          {name === 'version' && !versionOk ? t('appConfig.problems.versionFormat') : t(hint)}
        </span>
      )}
    </label>
  );

  return (
    <section className={`${cardClass} !p-4 space-y-3`} aria-labelledby={`${ids}-title`} data-testid="app-config-dry-run">
      <h2 id={`${ids}-title`} className="text-lg font-semibold text-fg">
        {t('appConfig.dryRunTitle')}
      </h2>
      <p className="text-sm text-fg-muted">{t('appConfig.dryRunHint')}</p>
      <form onSubmit={run} className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)]">
        <label className="flex min-w-0 flex-col gap-1 text-sm">
          <span className="text-fg-muted">{t('appConfig.platform')}</span>
          <Select value={context.platform} onChange={(e) => setContext((c) => ({ ...c, platform: e.target.value as AppConfigPlatform }))} className={`${fieldClass} w-full`} data-testid="app-config-dry-platform">
            {APP_CONFIG_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {t(`appConfig.platformNames.${p}` as MessageKey)}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-sm">
          <span className="text-fg-muted">{t('appConfig.app')}</span>
          <Select value={context.app} onChange={(e) => setContext((c) => ({ ...c, app: e.target.value as AppConfigApp }))} className={`${fieldClass} w-full`} data-testid="app-config-dry-app">
            {APP_CONFIG_APPS.map((a) => (
              <option key={a} value={a}>
                {t(`appConfig.appNames.${a}` as MessageKey)}
              </option>
            ))}
          </Select>
        </label>
        {input('version', 'appConfig.versionHint')}
        {input('locale', 'appConfig.localeHint')}
        {input('installId', 'appConfig.installIdHint')}
        <div>
          <button type="submit" className={secondaryButtonClass} disabled={busy || !versionOk} data-testid="app-config-dry-run-submit">
            {busy ? t('appConfig.running') : t('appConfig.run')}
          </button>
        </div>
      </form>
      <div role="status" aria-live="polite">
        {error && (
          <p className="text-sm text-danger-fg" data-testid="app-config-dry-error">
            {error}
          </p>
        )}
        {result && <DryRunResult result={result} />}
      </div>
    </section>
  );
}

function DryRunResult({ result }: { result: AppConfigResult }) {
  const { t } = useLanguage();
  const flags = Object.entries(result.flags);
  const config = Object.entries(result.config);
  const tone = result.update.status === 'required' ? 'text-danger-fg' : result.update.status === 'recommended' ? 'text-warning-fg' : 'text-success-fg';
  return (
    <div className="space-y-3 border-t border-border pt-3" data-testid="app-config-dry-result">
      <h3 className="text-sm font-semibold text-fg">{t('appConfig.resultTitle')}</h3>
      <p className="text-sm">
        <span className="text-fg-muted">{t('appConfig.update')}: </span>
        <span className={`font-medium ${tone}`} data-testid="app-config-dry-update" data-status={result.update.status}>
          {t(`appConfig.updateStatus.${result.update.status}`)}
        </span>
      </p>
      {[
        { title: 'appConfig.flagsResult' as const, rows: flags, flag: true, testId: 'app-config-dry-flags' },
        { title: 'appConfig.configResult' as const, rows: config, flag: false, testId: 'app-config-dry-config' },
      ].map(({ title, rows, flag, testId }) => (
        <div key={testId}>
          <h4 className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{t(title)}</h4>
          {rows.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('appConfig.none')}</p>
          ) : (
            <dl className="mt-1 divide-y divide-border text-sm" data-testid={testId}>
              {rows.map(([key, value]) => (
                <div key={key} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1" data-key={key}>
                  <dt>
                    <bdi dir="ltr" className="font-mono text-fg [overflow-wrap:anywhere]">
                      {key}
                    </bdi>
                  </dt>
                  <dd className="min-w-0 text-fg-muted" data-value={JSON.stringify(value)}>
                    {flag && value === true ? t('appConfig.on') : flag && value === false ? t('appConfig.off') : <bdi dir="ltr" className="font-mono [overflow-wrap:anywhere]">{show(value)}</bdi>}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      ))}
    </div>
  );
}
