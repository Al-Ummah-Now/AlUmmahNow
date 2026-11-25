'use client';

/**
 * The Releases tab of App config (wiki AUN-APP-UPDATES §4.2): what each app has released, on which platform and
 * channel, whether its signature checked out, where users can get it, and the minimum in force. Admins refresh the
 * index; super admins mark TestFlight and Amazon uploads available (the server needs that mark before it offers
 * them or lets a minimum require them). Refused (quarantined) releases and the repos' signing keys are listed too.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { APP_CONFIG_APPS, localizeDigits, type AppConfigVersionsDocument } from '@al-ummah/shared-types';
import { markStoreAvailable, refreshAppReleases, type AppReleaseEntry, type AppReleasesView } from '@/lib/api/appConfig';
import { useLanguage } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/translate';
import { secondaryButtonClass } from '@/components/ui';
import { smallButtonClass } from '@/components/content/parts';
import { LocalTime } from '@/components/LocalTime';
import { fillNodes } from '@/components/audit/fill';
import { logger } from '@/lib/logger-client';

/** Production App Store bundles the server looks up (api-videos lib/app-updates/releases.ts APP_STORE_BUNDLES). */
const APP_STORE: Record<string, string> = {
  'viewer/ios': 'net.alummahnow.viewer',
  'viewer/ipados': 'net.alummahnow.viewer',
  'viewer/macos': 'net.alummahnow.viewer.mac',
  'studio/ios': 'net.alummahnow.studio',
  'studio/ipados': 'net.alummahnow.studio',
};

const STORE_NAMES: Record<string, string> = { appstore: 'App Store', testflight: 'TestFlight', play: 'Google Play', amazon: 'Amazon Appstore', msstore: 'Microsoft Store' };

interface Props {
  initial: AppReleasesView | null;
  versions: AppConfigVersionsDocument;
  canEdit: boolean;
  /** Opens the version editor on this row's entry (super admins) */
  onEdit: (row: { app: string; platform: string; channel: 'stable' | 'beta' }) => void;
}

type Notice = { tone: 'ok' | 'error'; text: string } | null;

/** The minimum in force for a row: the most specific entry, as the server picks it. */
function minimumFor(versions: AppConfigVersionsDocument, app: string, platform: string, channel: string): string | null {
  const keys = [`${app}/${platform}#${channel}`, `${app}/${platform}`, `${app}/*#${channel}`, `${app}/*`];
  for (const k of keys) if (versions[k]) return versions[k].minimumVersion;
  return null;
}

/** The release index's reasons (api-videos lib/app-updates/releases.ts); any other code shows as it is. */
const REASONS = ['too_large', 'missing_signature', 'bad_signature_file', 'unknown_key', 'bad_signature', 'bad_json', 'bad_manifest', 'wrong_repo', 'wrong_tag', 'wrong_channel', 'not_newer', 'below_floor', 'yanked'] as const;

export function ReleasesPanel({ initial, versions, canEdit, onEdit }: Props) {
  const { t, locale } = useLanguage();
  /** A version as read (٠–٩ in Arabic); typed versions elsewhere on the page stay as entered */
  const shown = (v: string) => localizeDigits(locale, v);
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  /** Why a request was refused, in the page's language */
  const why = (status: number, fallback: MessageKey) =>
    status === 401 ? t('errors.notAuthenticated')
    : status === 403 ? t('appConfig.releases.forbidden')
    : status === 400 ? t('appConfig.releases.invalid')
    : status === 429 ? t('appConfig.releases.busy')
    : status >= 502 ? t('appConfig.releases.unreachable')
    : t(fallback);
  const reason = (code: string): React.ReactNode =>
    (REASONS as readonly string[]).includes(code) ? t(`appConfig.releases.reasons.${code}` as MessageKey) : <bdi dir="ltr" className="font-mono">{code}</bdi>;

  const cell = 'flex items-baseline gap-3 px-3 py-1 md:table-cell md:py-2';
  /** The column's name beside its value, on phones only (the table's header names it from md up) */
  const label = (column: 'colPlatform' | 'colChannel' | 'colLatest' | 'colReleased' | 'colSignature' | 'colStores' | 'colMinimum') => (
    <span className="w-28 shrink-0 text-fg-muted md:hidden" aria-hidden="true">{t(`appConfig.releases.${column}`)}</span>
  );

  const byApp = useMemo(() => {
    const entries = Object.values(view?.entries ?? {});
    return APP_CONFIG_APPS.map((app) => ({
      app,
      rows: entries.filter((e) => e.app === app).sort((a, b) => a.platform.localeCompare(b.platform) || a.channel.localeCompare(b.channel)),
    })).filter((g) => g.rows.length);
  }, [view]);

  async function refresh() {
    setBusy('refresh');
    setNotice(null);
    try {
      const res = await refreshAppReleases();
      if (res.ok) {
        setView((v) => ({ ...res.data.releases, availability: res.data.releases.availability ?? v?.availability ?? {} }));
        setNotice({ tone: 'ok', text: t('appConfig.releases.refreshed') });
        router.refresh();
      } else {
        setNotice({ tone: 'error', text: why(res.status, 'appConfig.releases.refreshFailed') });
      }
    } catch (e) {
      logger.error('[app-config] Release refresh failed', { error: e instanceof Error ? e.message : String(e) });
      setNotice({ tone: 'error', text: t('appConfig.releases.refreshFailed') });
    } finally {
      setBusy(null);
    }
  }

  async function mark(e: AppReleaseEntry, source: 'testflight' | 'amazon', version: string | null) {
    const id = `${e.app}/${e.platform}/${source}`;
    setBusy(id);
    setNotice(null);
    try {
      const res = await markStoreAvailable(e.app, e.platform, source, version);
      if (res.ok) {
        setView((v) => (v ? { ...v, availability: res.data } : v));
        setNotice({ tone: 'ok', text: t('appConfig.releases.marked') });
      } else {
        setNotice({ tone: 'error', text: why(res.status, 'appConfig.releases.markFailed') });
      }
    } catch (err) {
      logger.error('[app-config] Mark available failed', { id, error: err instanceof Error ? err.message : String(err) });
      setNotice({ tone: 'error', text: t('appConfig.releases.markFailed') });
    } finally {
      setBusy(null);
    }
  }

  const stores = (e: AppReleaseEntry) => {
    const items: React.ReactNode[] = [];
    // Files people download themselves; a store-only release (iPhone, Play) has none
    if (e.signed && !e.private && e.artifacts.length > 0 && Object.keys(view?.keys ?? {}).includes(e.repo)) items.push(<li key="direct">{t('appConfig.releases.direct')}</li>);
    const bundle = APP_STORE[`${e.app}/${e.platform}`];
    if (bundle) {
      const live = view?.appStore?.[bundle];
      items.push(
        <li key="appstore">
          {live ? fillNodes(t('appConfig.releases.appstoreLive'), { version: <bdi dir="ltr" className="font-medium">{shown(live.version)}</bdi> }) : t('appConfig.releases.appstoreNone')}
        </li>,
      );
    }
    for (const source of e.stores) {
      if (source === 'appstore') continue;
      const store = STORE_NAMES[source] ?? source;
      const markable = source === 'testflight' || source === 'amazon';
      const marked = markable ? view?.availability?.[`${e.app}/${e.platform}/${source}`] : undefined;
      items.push(
        <li key={source} className="flex flex-wrap items-center gap-2">
          <span>
            {marked
              ? fillNodes(t('appConfig.releases.storeMarked'), { store, version: <bdi dir="ltr" className="font-medium">{shown(marked)}</bdi> })
              : t('appConfig.releases.storeUploaded', { store })}
          </span>
          {markable && canEdit && marked !== e.version && (
            <button type="button" className={smallButtonClass} onClick={() => mark(e, source, e.version)} disabled={busy !== null} data-testid="app-releases-mark">
              {t('appConfig.releases.markAvailable', { store, version: shown(e.version) })}
            </button>
          )}
          {markable && canEdit && marked && (
            <button type="button" className={smallButtonClass} onClick={() => mark(e, source, null)} disabled={busy !== null} data-testid="app-releases-unmark">
              {t('appConfig.releases.unmark', { store })}
            </button>
          )}
        </li>,
      );
    }
    return items.length ? <ul className="space-y-1">{items}</ul> : <span className="text-fg-subtle">—</span>;
  };

  const keys = Object.entries(view?.keys ?? {});

  return (
    <div className="space-y-6" data-testid="app-releases">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={secondaryButtonClass} onClick={refresh} disabled={busy !== null} data-testid="app-releases-refresh">
          {busy === 'refresh' ? t('appConfig.releases.refreshing') : t('appConfig.releases.refresh')}
        </button>
        <span className="text-sm text-fg-muted">
          {view?.updatedAt && !view.updatedAt.startsWith('1970') ? fillNodes(t('appConfig.releases.updated'), { date: <LocalTime value={view.updatedAt} withTime /> }) : t('appConfig.releases.never')}
        </span>
        <span role="status" aria-live="polite" className="text-sm">
          {notice && <span className={notice.tone === 'ok' ? 'text-success-fg' : 'text-danger-fg'} data-testid="app-releases-notice">{notice.text}</span>}
        </span>
      </div>

      {byApp.length === 0 ? (
        <p className="rounded border border-dashed border-border p-4 text-sm text-fg-muted" data-testid="app-releases-empty">
          {t('appConfig.releases.empty')}
        </p>
      ) : (
        byApp.map(({ app, rows }) => (
          <section key={app} className="space-y-2" aria-labelledby={`releases-${app}`}>
            <h2 id={`releases-${app}`} className="text-lg font-semibold text-fg">
              {t(`appConfig.appNames.${app}` as MessageKey)}
            </h2>
            {/* A table from md up; on a phone each release is a block of labelled lines (nothing off the screen) */}
            <div className="relative overflow-hidden rounded-lg border border-border bg-surface">
              <table role="table" className="block w-full text-start text-sm md:table" data-testid="app-releases-table" data-app={app}>
                <thead role="rowgroup" className="sr-only bg-surface-2 text-fg-muted md:not-sr-only md:table-header-group">
                  <tr role="row">
                    <th role="columnheader" scope="col" className="px-3 py-2 text-start font-medium">{t('appConfig.releases.colPlatform')}</th>
                    <th role="columnheader" scope="col" className="px-3 py-2 text-start font-medium">{t('appConfig.releases.colChannel')}</th>
                    <th role="columnheader" scope="col" className="px-3 py-2 text-start font-medium">{t('appConfig.releases.colLatest')}</th>
                    <th role="columnheader" scope="col" className="px-3 py-2 text-start font-medium">{t('appConfig.releases.colReleased')}</th>
                    <th role="columnheader" scope="col" className="px-3 py-2 text-start font-medium">{t('appConfig.releases.colSignature')}</th>
                    <th role="columnheader" scope="col" className="px-3 py-2 text-start font-medium">{t('appConfig.releases.colStores')}</th>
                    <th role="columnheader" scope="col" className="px-3 py-2 text-start font-medium">{t('appConfig.releases.colMinimum')}</th>
                    {canEdit && <th role="columnheader" scope="col" className="relative px-3 py-2"><span className="sr-only">{t('appConfig.releases.colActions')}</span></th>}
                  </tr>
                </thead>
                <tbody role="rowgroup" className="block divide-y divide-border md:table-row-group">
                  {rows.map((e) => {
                    const min = minimumFor(versions, e.app, e.platform, e.channel);
                    return (
                      <tr role="row" key={`${e.platform}/${e.channel}`} className="block py-2 md:table-row md:py-0" data-testid="app-releases-row" data-target={`${e.app}/${e.platform}/${e.channel}`}>
                        <td role="cell" className={`${cell} font-medium text-fg md:font-normal`}>{label('colPlatform')}{t(`appConfig.platformNames.${e.platform}` as MessageKey)}</td>
                        <td role="cell" className={`${cell} text-fg-muted`}>{label('colChannel')}{e.channel === 'beta' ? t('appConfig.releases.beta') : t('appConfig.releases.stable')}</td>
                        <td role="cell" className={cell}>
                          {label('colLatest')}
                          <bdi dir="ltr" className="text-fg">{shown(e.version)}</bdi>
                        </td>
                        <td role="cell" className={`${cell} text-fg-muted`}>
                          {label('colReleased')}
                          <LocalTime value={e.publishedAt} />
                        </td>
                        <td role="cell" className={cell}>
                          {label('colSignature')}
                          <span className="min-w-0">
                          <span className={e.signed ? 'text-success-fg' : 'text-warning-fg'}>{e.signed ? t('appConfig.releases.signed') : t('appConfig.releases.unsigned')}</span>
                          {e.private && <span className="ms-2 text-fg-subtle">{t('appConfig.releases.privateRelease')}</span>}
                          </span>
                        </td>
                        <td role="cell" className={`${cell} text-fg`}>{label('colStores')}{stores(e)}</td>
                        <td role="cell" className={cell}>{label('colMinimum')}{min ? <bdi dir="ltr" className="text-fg">{shown(min)}</bdi> : <span className="text-fg-subtle">{t('appConfig.releases.noMinimum')}</span>}</td>
                        {canEdit && (
                          <td role="cell" className="block px-3 pb-1 pt-2 md:table-cell md:py-2 md:text-end">
                            <button
                              type="button"
                              className={smallButtonClass}
                              onClick={() => onEdit({ app: e.app, platform: e.platform, channel: e.channel })}
                              aria-label={t('appConfig.releases.editRow', { app: t(`appConfig.appNames.${e.app}` as MessageKey), platform: t(`appConfig.platformNames.${e.platform}` as MessageKey), channel: e.channel === 'beta' ? t('appConfig.releases.beta') : t('appConfig.releases.stable') })}
                              data-testid="app-releases-edit"
                            >
                              {t('appConfig.releases.edit')}
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}

      <section aria-labelledby="releases-keys" className="space-y-1" data-testid="app-releases-keys">
        <h2 id="releases-keys" className="text-sm font-semibold text-fg">{t('appConfig.releases.keysTitle')}</h2>
        {keys.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('appConfig.releases.keysMissing')}</p>
        ) : (
          <ul className="space-y-0.5 text-sm text-fg-muted">
            {keys.map(([repo, k]) => (
              <li key={repo}>{t('appConfig.releases.keysSet', { repo, serial: k.serial })}</li>
            ))}
          </ul>
        )}
      </section>

      {(view?.quarantined?.length ?? 0) > 0 && (
        <section aria-labelledby="releases-quarantined" className="space-y-1 rounded-lg border border-danger-border bg-danger-bg/40 p-3" data-testid="app-releases-quarantined">
          <h2 id="releases-quarantined" className="text-sm font-semibold text-danger-fg">{t('appConfig.releases.quarantinedTitle')}</h2>
          <p className="text-sm text-fg-muted">{t('appConfig.releases.quarantinedHint')}</p>
          <ul className="space-y-0.5 text-sm text-fg">
            {view!.quarantined.map((q) => (
              <li key={`${q.source}:${q.tag}`}>
                {fillNodes(t('appConfig.releases.quarantinedRow'), {
                  tag: <bdi dir="ltr" className="font-mono">{q.tag}</bdi>,
                  source: <bdi dir="ltr">{q.source}</bdi>,
                  reason: reason(q.reason),
                })}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
