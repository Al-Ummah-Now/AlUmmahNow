'use client';

import { useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  MOBILE_APP_ROLES,
  MobileAppsSettingsSchema,
  appleAppSiteAssociation,
  assetLinks,
  publicAttestationConfig,
  type MobileAppRole,
  type MobileAppsSettings,
} from '@al-ummah/shared-types';
import { saveMobileApps, type MobileAppsChange, type MobileAppsView } from '@/lib/api/admin';
import { useLanguage } from '@/i18n/I18nProvider';
import { type MessageKey } from '@/i18n/translate';
import { ErrorAlert, cardClass, fieldClass, linkClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';
import { UserName } from '@/components/audit/UserName';
import { fillNodes } from '@/components/audit/fill';
import { Select } from '@/components/select/Select';

import { LocalTime } from '@/components/LocalTime';
const ROLE_LABEL: Record<MobileAppRole, MessageKey> = {
  viewer: 'mobileApps.roleViewer',
  studio: 'mobileApps.roleStudio',
  admin: 'mobileApps.roleAdmin',
};

/** Form state: fingerprints and client ids edited as text, one per line. */
interface Draft {
  teamId: string;
  apple: { role: MobileAppRole; bundleId: string }[];
  appAttest: boolean;
  appAttestEnvironment: 'production' | 'development';
  android: { role: MobileAppRole; packageName: string; fingerprints: string }[];
  playIntegrity: boolean;
  cloudProjectNumber: string;
  enforceClientIds: string;
}

const lines = (text: string) =>
  text
    .split(/[\n,]+/)
    .map((l) => l.trim())
    .filter(Boolean);

function toDraft(s: MobileAppsSettings): Draft {
  return {
    teamId: s.apple.teamId,
    apple: s.apple.apps.map((a) => ({ ...a })),
    appAttest: s.apple.appAttest.enabled,
    appAttestEnvironment: s.apple.appAttest.environment,
    android: s.android.apps.map((a) => ({ role: a.role, packageName: a.packageName, fingerprints: a.sha256Fingerprints.join('\n') })),
    playIntegrity: s.android.playIntegrity.enabled,
    cloudProjectNumber: s.android.playIntegrity.cloudProjectNumber,
    enforceClientIds: s.attestation.enforceClientIds.join('\n'),
  };
}

function toSettings(d: Draft): MobileAppsSettings {
  return {
    apple: {
      teamId: d.teamId.trim().toUpperCase(),
      apps: d.apple.filter((a) => a.bundleId.trim()).map((a) => ({ role: a.role, bundleId: a.bundleId.trim() })),
      appAttest: { enabled: d.appAttest, environment: d.appAttestEnvironment },
    },
    android: {
      apps: d.android.filter((a) => a.packageName.trim()).map((a) => ({ role: a.role, packageName: a.packageName.trim(), sha256Fingerprints: lines(a.fingerprints) })),
      playIntegrity: { enabled: d.playIntegrity, cloudProjectNumber: d.cloudProjectNumber.trim() },
    },
    attestation: { enforceClientIds: lines(d.enforceClientIds) },
  };
}

/** Field path ("apple.teamId", "android.apps.0.sha256Fingerprints.1") → the first problem on it. */
function problemsOf(settings: MobileAppsSettings): Map<string, string> {
  const parsed = MobileAppsSettingsSchema.safeParse(settings);
  const out = new Map<string, string>();
  if (parsed.success) return out;
  for (const issue of parsed.error.issues) {
    const path = issue.path.join('.');
    if (!out.has(path)) out.set(path, issue.message);
  }
  return out;
}

export function MobileAppsForm({ state, history, canEdit, siteUrl }: { state: MobileAppsView; history: MobileAppsChange[]; canEdit: boolean; siteUrl: string | null }) {
  const { t } = useLanguage();
  const router = useRouter();
  const ids = useId();
  const [draft, setDraft] = useState<Draft>(() => toDraft(state.settings));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showProblems, setShowProblems] = useState(false);

  const settings = useMemo(() => toSettings(draft), [draft]);
  const problems = useMemo(() => problemsOf(settings), [settings]);
  const aasa = useMemo(() => (problems.size ? null : appleAppSiteAssociation(settings)), [settings, problems]);
  const links = useMemo(() => (problems.size ? null : assetLinks(settings)), [settings, problems]);
  const attestation = useMemo(() => publicAttestationConfig(settings), [settings]);
  const dirty = JSON.stringify(settings) !== JSON.stringify(toSettings(toDraft(state.settings)));
  const disabled = !canEdit || busy;

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const problem = (path: string) => (showProblems ? problems.get(path) : undefined);
  const androidProblem = (i: number) => {
    if (!showProblems) return undefined;
    for (const [path, message] of problems) if (path.startsWith(`android.apps.${i}.`)) return message;
    return undefined;
  };

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!canEdit || !dirty) return;
    setShowProblems(true);
    setError(null);
    setNotice(null);
    if (problems.size) {
      setError(t('mobileApps.fixProblems'));
      return;
    }
    setBusy(true);
    try {
      const result = await saveMobileApps(settings);
      if (!result.ok) {
        logger.warn('[mobile-apps] Save failed', { status: result.status });
        setError(result.status === 401 ? t('errors.notAuthenticated') : result.status === 403 ? t('mobileApps.readOnly') : t('mobileApps.saveFailed'));
        return;
      }
      setShowProblems(false);
      setNotice(t('mobileApps.saved'));
      router.refresh();
    } catch (e) {
      logger.error('[mobile-apps] Save request failed', { error: e instanceof Error ? e.message : String(e) });
      setError(t('mobileApps.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  const label = 'block text-sm font-medium text-fg mb-1';
  const hint = 'block text-sm text-fg-muted mt-1';
  const errorText = 'block text-sm text-danger-fg mt-1';
  const check = 'mt-1 h-4 w-4 shrink-0 accent-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';
  const smallButton = 'text-sm px-3 py-1.5 rounded border border-border bg-surface-2 hover:bg-surface-hover text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50';
  const served = (on: boolean, testId: string) => (
    <span
      data-testid={testId}
      data-served={on}
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${on ? 'border-transparent bg-chip-resolved-bg text-chip-resolved-fg' : 'border-border text-fg-muted bg-surface-2'}`}
    >
      {on ? t('mobileApps.served') : t('mobileApps.notServed')}
    </span>
  );

  return (
    <form onSubmit={save} noValidate className="space-y-6" data-testid="mobile-apps-form" data-default={state.isDefault}>
      {/* Apple */}
      <section className={cardClass} aria-labelledby={`${ids}-apple`}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h2 id={`${ids}-apple`} className="text-lg font-semibold text-fg">{t('mobileApps.appleTitle')}</h2>
          {served(!!aasa, 'mobile-apps-aasa-status')}
        </div>
        <fieldset disabled={disabled} className="space-y-5">
          <div className="max-w-sm">
            <label htmlFor={`${ids}-team`} className={label}>{t('mobileApps.teamId')}</label>
            <input
              id={`${ids}-team`}
              className={`${fieldClass} w-full font-mono uppercase`}
              value={draft.teamId}
              onChange={(e) => set({ teamId: e.target.value })}
              maxLength={10}
              autoComplete="off"
              spellCheck={false}
              dir="ltr"
              placeholder="ABCDE12345"
              aria-describedby={`${ids}-team-hint ${ids}-team-error`}
              aria-invalid={!!problem('apple.teamId')}
              data-testid="mobile-apps-team-id"
            />
            <span id={`${ids}-team-hint`} className={hint}>{t('mobileApps.teamIdHint')}</span>
            {problem('apple.teamId') && <span id={`${ids}-team-error`} className={errorText}>{t('mobileApps.teamIdInvalid')}</span>}
          </div>

          <div>
            <p className={label} id={`${ids}-bundles`}>{t('mobileApps.bundleIds')}</p>
            <ul className="space-y-2" aria-labelledby={`${ids}-bundles`} data-testid="mobile-apps-bundle-list">
              {draft.apple.map((app, i) => (
                <li key={i} className="flex flex-wrap items-start gap-2">
                  <Select
                    className={`${fieldClass} min-w-0 flex-1 sm:flex-none sm:w-40`}
                    value={app.role}
                    aria-label={t('mobileApps.appRole')}
                    onChange={(e) => set({ apple: draft.apple.map((a, j) => (j === i ? { ...a, role: e.target.value as MobileAppRole } : a)) })}
                  >
                    {MOBILE_APP_ROLES.map((r) => (
                      <option key={r} value={r}>{t(ROLE_LABEL[r])}</option>
                    ))}
                  </Select>
                  <div className="min-w-0 basis-full order-last sm:order-none sm:basis-0 sm:flex-1">
                    <input
                      className={`${fieldClass} w-full font-mono`}
                      value={app.bundleId}
                      dir="ltr"
                      spellCheck={false}
                      aria-label={t('mobileApps.bundleIdLabel', { n: i + 1 })}
                      aria-invalid={!!problem(`apple.apps.${i}.bundleId`)}
                      onChange={(e) => set({ apple: draft.apple.map((a, j) => (j === i ? { ...a, bundleId: e.target.value } : a)) })}
                      data-testid={`mobile-apps-bundle-${i}`}
                    />
                    {problem(`apple.apps.${i}.bundleId`) && <span className={errorText}>{t('mobileApps.bundleIdInvalid')}</span>}
                  </div>
                  <button type="button" className={smallButton} onClick={() => set({ apple: draft.apple.filter((_, j) => j !== i) })} aria-label={t('mobileApps.removeRow', { n: i + 1 })}>
                    {t('mobileApps.remove')}
                  </button>
                </li>
              ))}
            </ul>
            {problem('apple.apps') && <span className={errorText}>{t('mobileApps.duplicate')}</span>}
            <button type="button" className={`${smallButton} mt-2`} onClick={() => set({ apple: [...draft.apple, { role: 'viewer', bundleId: '' }] })} data-testid="mobile-apps-add-bundle">
              {t('mobileApps.addBundle')}
            </button>
          </div>

          <div className="rounded border border-border p-4 space-y-3">
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" className={check} checked={draft.appAttest} onChange={(e) => set({ appAttest: e.target.checked })} aria-describedby={`${ids}-attest-hint`} data-testid="mobile-apps-app-attest" />
              <span>
                <span className="block text-fg font-medium">{t('mobileApps.appAttest')}</span>
                <span id={`${ids}-attest-hint`} className="block text-sm text-fg-muted">{t('mobileApps.appAttestHint')}</span>
              </span>
            </label>
            {problem('apple.appAttest.enabled') && <span className={errorText}>{t('mobileApps.appAttestNeeds')}</span>}
            <fieldset className="flex flex-wrap gap-4" disabled={disabled || !draft.appAttest}>
              <legend className="sr-only">{t('mobileApps.appAttestEnvironment')}</legend>
              {(['production', 'development'] as const).map((env) => (
                <label key={env} className="flex items-center gap-2 text-sm text-fg cursor-pointer">
                  <input type="radio" name="appAttestEnvironment" className={check} checked={draft.appAttestEnvironment === env} onChange={() => set({ appAttestEnvironment: env })} />
                  {t(env === 'production' ? 'mobileApps.envProduction' : 'mobileApps.envDevelopment')}
                </label>
              ))}
            </fieldset>
          </div>
        </fieldset>
      </section>

      {/* Android */}
      <section className={cardClass} aria-labelledby={`${ids}-android`}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h2 id={`${ids}-android`} className="text-lg font-semibold text-fg">{t('mobileApps.androidTitle')}</h2>
          {served(!!links, 'mobile-apps-assetlinks-status')}
        </div>
        <fieldset disabled={disabled} className="space-y-5">
          <ul className="space-y-4" data-testid="mobile-apps-package-list">
            {draft.android.map((app, i) => (
              <li key={i} className="rounded border border-border p-4">
                <div className="flex flex-wrap items-start gap-2">
                  <Select
                    className={`${fieldClass} min-w-0 flex-1 sm:flex-none sm:w-40`}
                    value={app.role}
                    aria-label={t('mobileApps.appRole')}
                    onChange={(e) => set({ android: draft.android.map((a, j) => (j === i ? { ...a, role: e.target.value as MobileAppRole } : a)) })}
                  >
                    {MOBILE_APP_ROLES.map((r) => (
                      <option key={r} value={r}>{t(ROLE_LABEL[r])}</option>
                    ))}
                  </Select>
                  <input
                    className={`${fieldClass} min-w-0 basis-full order-last sm:order-none sm:basis-0 sm:flex-1 font-mono`}
                    value={app.packageName}
                    dir="ltr"
                    spellCheck={false}
                    aria-label={t('mobileApps.packageLabel', { n: i + 1 })}
                    onChange={(e) => set({ android: draft.android.map((a, j) => (j === i ? { ...a, packageName: e.target.value } : a)) })}
                    data-testid={`mobile-apps-package-${i}`}
                  />
                  <button type="button" className={smallButton} onClick={() => set({ android: draft.android.filter((_, j) => j !== i) })} aria-label={t('mobileApps.removeRow', { n: i + 1 })}>
                    {t('mobileApps.remove')}
                  </button>
                </div>
                <label htmlFor={`${ids}-fp-${i}`} className={`${label} mt-3`}>{t('mobileApps.fingerprints')}</label>
                <textarea
                  id={`${ids}-fp-${i}`}
                  className={`${fieldClass} w-full font-mono text-xs`}
                  rows={3}
                  dir="ltr"
                  spellCheck={false}
                  value={app.fingerprints}
                  placeholder="AA:BB:CC:…"
                  aria-describedby={`${ids}-fp-hint`}
                  aria-invalid={!!androidProblem(i)}
                  onChange={(e) => set({ android: draft.android.map((a, j) => (j === i ? { ...a, fingerprints: e.target.value } : a)) })}
                  data-testid={`mobile-apps-fingerprints-${i}`}
                />
                {androidProblem(i) && <span className={errorText}>{t('mobileApps.packageInvalid')}</span>}
              </li>
            ))}
          </ul>
          <span id={`${ids}-fp-hint`} className={hint}>{t('mobileApps.fingerprintsHint')}</span>
          {problem('android.apps') && <span className={errorText}>{t('mobileApps.duplicate')}</span>}
          <button type="button" className={smallButton} onClick={() => set({ android: [...draft.android, { role: 'viewer', packageName: '', fingerprints: '' }] })} data-testid="mobile-apps-add-package">
            {t('mobileApps.addPackage')}
          </button>

          <div className="rounded border border-border p-4 space-y-3">
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" className={check} checked={draft.playIntegrity} onChange={(e) => set({ playIntegrity: e.target.checked })} aria-describedby={`${ids}-pi-hint`} data-testid="mobile-apps-play-integrity" />
              <span>
                <span className="block text-fg font-medium">{t('mobileApps.playIntegrity')}</span>
                <span id={`${ids}-pi-hint`} className="block text-sm text-fg-muted">{t('mobileApps.playIntegrityHint')}</span>
              </span>
            </label>
            <div className="max-w-sm">
              <label htmlFor={`${ids}-project`} className={label}>{t('mobileApps.cloudProject')}</label>
              <input
                id={`${ids}-project`}
                className={`${fieldClass} w-full font-mono`}
                inputMode="numeric"
                dir="ltr"
                value={draft.cloudProjectNumber}
                onChange={(e) => set({ cloudProjectNumber: e.target.value })}
                aria-invalid={!!problem('android.playIntegrity.cloudProjectNumber')}
                data-testid="mobile-apps-cloud-project"
              />
              {problem('android.playIntegrity.cloudProjectNumber') && <span className={errorText}>{t('mobileApps.cloudProjectInvalid')}</span>}
              {problem('android.playIntegrity.enabled') && <span className={errorText}>{t('mobileApps.playIntegrityNeeds')}</span>}
            </div>
          </div>
        </fieldset>
      </section>

      {/* Requiring a proof */}
      <section className={cardClass} aria-labelledby={`${ids}-enforce`}>
        <h2 id={`${ids}-enforce`} className="text-lg font-semibold text-fg mb-2">{t('mobileApps.enforceTitle')}</h2>
        <p className="text-sm text-fg-muted mb-3">{t('mobileApps.enforceHint')}</p>
        <fieldset disabled={disabled}>
          <label htmlFor={`${ids}-clients`} className={label}>{t('mobileApps.enforceClients')}</label>
          <textarea
            id={`${ids}-clients`}
            className={`${fieldClass} w-full font-mono text-xs`}
            rows={3}
            dir="ltr"
            spellCheck={false}
            value={draft.enforceClientIds}
            onChange={(e) => set({ enforceClientIds: e.target.value })}
            data-testid="mobile-apps-enforce-clients"
          />
        </fieldset>
        <p className="text-sm text-fg mt-3" data-testid="mobile-apps-attestation-summary">
          {t('mobileApps.attestationSummary', {
            apple: attestation.apple.enabled ? t('mobileApps.on') : t('mobileApps.off'),
            android: attestation.android.enabled ? t('mobileApps.on') : t('mobileApps.off'),
          })}
        </p>
      </section>

      {/* What the site serves */}
      <section className={cardClass} aria-labelledby={`${ids}-files`}>
        <h2 id={`${ids}-files`} className="text-lg font-semibold text-fg mb-2">{t('mobileApps.filesTitle')}</h2>
        <p className="text-sm text-fg-muted mb-4">{t('mobileApps.filesHint')}</p>
        <div className="grid gap-4 lg:grid-cols-2">
          {[
            { name: 'apple-app-site-association', doc: aasa, testId: 'mobile-apps-preview-aasa' },
            { name: 'assetlinks.json', doc: links, testId: 'mobile-apps-preview-assetlinks' },
          ].map((file) => (
            <div key={file.name} className="min-w-0">
              <p className="text-sm font-medium text-fg mb-1" dir="ltr">
                {siteUrl ? (
                  <a className={linkClass} href={`${siteUrl}/.well-known/${file.name}`} target="_blank" rel="noreferrer">
                    /.well-known/{file.name}
                  </a>
                ) : (
                  <>/.well-known/{file.name}</>
                )}
              </p>
              {file.doc ? (
                <pre className="max-h-72 overflow-auto rounded border border-border bg-surface-2 p-3 text-xs text-fg" dir="ltr" tabIndex={0} data-testid={file.testId}>
                  {JSON.stringify(file.doc, null, 2)}
                </pre>
              ) : (
                <p className="rounded border border-dashed border-border p-3 text-sm text-fg-muted" data-testid={file.testId}>{t('mobileApps.fileEmpty')}</p>
              )}
            </div>
          ))}
        </div>
      </section>

      <div className="space-y-3">
        <p className="text-sm text-fg-muted" data-testid="mobile-apps-last-changed">
          {state.updatedAt
            ? fillNodes(t('mobileApps.lastChanged'), { date: <LocalTime value={state.updatedAt} withTime />, actor: state.updatedBy ? <UserName id={state.updatedBy} showEmail={false} /> : '—' })
            : t('mobileApps.neverChanged')}
        </p>
        {canEdit ? (
          <div className="flex flex-wrap gap-3">
            <button type="submit" className={primaryButtonClass} disabled={busy || !dirty} data-testid="mobile-apps-save">
              {busy ? t('mobileApps.saving') : t('mobileApps.save')}
            </button>
            <button
              type="button"
              className={secondaryButtonClass}
              disabled={busy || !dirty}
              onClick={() => {
                setDraft(toDraft(state.settings));
                setShowProblems(false);
                setError(null);
              }}
            >
              {t('mobileApps.discard')}
            </button>
          </div>
        ) : (
          <p className="text-sm text-fg-muted" data-testid="mobile-apps-read-only">{t('mobileApps.readOnly')}</p>
        )}
        {error && <ErrorAlert testId="mobile-apps-save-error">{error}</ErrorAlert>}
        <p role="status" className="text-sm text-fg" data-testid="mobile-apps-saved">{notice}</p>
      </div>

      <section className={cardClass} aria-labelledby={`${ids}-history`}>
        <h2 id={`${ids}-history`} className="text-lg font-semibold text-fg mb-2">{t('mobileApps.historyTitle')}</h2>
        {history.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('mobileApps.historyEmpty')}</p>
        ) : (
          <ul className="space-y-1 text-sm text-fg-muted" data-testid="mobile-apps-history">
            {history.map((h) => (
              <li key={h.id}>{fillNodes(t('mobileApps.historyEntry', { summary: changeSummary(h, t) }), { date: <LocalTime value={h.createdAt} withTime />, actor: <UserName id={h.actorId} showEmail={false} /> })}</li>
            ))}
          </ul>
        )}
      </section>
    </form>
  );
}

/** What a change touched, in words: "Team ID, Android fingerprints". */
function changeSummary(h: MobileAppsChange, t: (key: MessageKey) => string): string {
  const before = h.oldValue;
  const after = h.newValue;
  const parts: string[] = [];
  if (!before || before.apple.teamId !== after.apple.teamId) parts.push(t('mobileApps.teamId'));
  if (!before || JSON.stringify(before.apple.apps) !== JSON.stringify(after.apple.apps)) parts.push(t('mobileApps.bundleIds'));
  if (!before || JSON.stringify(before.android.apps) !== JSON.stringify(after.android.apps)) parts.push(t('mobileApps.androidTitle'));
  if (!before || JSON.stringify(before.apple.appAttest) !== JSON.stringify(after.apple.appAttest)) parts.push(t('mobileApps.appAttest'));
  if (!before || JSON.stringify(before.android.playIntegrity) !== JSON.stringify(after.android.playIntegrity)) parts.push(t('mobileApps.playIntegrity'));
  if (!before || JSON.stringify(before.attestation) !== JSON.stringify(after.attestation)) parts.push(t('mobileApps.enforceTitle'));
  return parts.join(', ');
}
