'use client';

/**
 * The Releases tab of App config (wiki AUN-APP-UPDATES §4.2): what each app has released, on which platform and
 * channel, whether its signature checked out, where users can get it, and the minimum in force. Admins refresh the
 * index; super admins mark TestFlight and Amazon uploads available (the server needs that mark before it offers
 * them or lets a minimum require them). Refused (quarantined) releases and the repos' signing keys are listed too.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { APP_CONFIG_APPS, type AppConfigVersionsDocument } from '@al-ummah/shared-types';
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
}

type Notice = { tone: 'ok' | 'error'; text: string } | null;

/** The minimum in force for a row: the most specific entry, as the server picks it. */
function minimumFor(versions: AppConfigVersionsDocument, app: string, platform: string, channel: string): string | null {
  const keys = [`${app}/${platform}#${channel}`, `${app}/${platform}`, `${app}/*#${channel}`, `${app}/*`];
  for (const k of keys) if (versions[k]) return versions[k].minimumVersion;
  return null;
}

export function ReleasesPanel({ initial, versions, canEdit }: Props) {
  const { t } = useLanguage();
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

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
        setNotice({ tone: 'error', text: res.status === 429 ? t('appConfig.releases.busy') : t('appConfig.releases.refreshFailed') });
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
        setNotice({ tone: 'error', text: t('appConfig.releases.markFailed') });
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
    if (e.signed && !e.private && Object.keys(view?.keys ?? {}).includes(e.repo)) items.push(<li key="direct">{t('appConfig.releases.direct')}</li>);
    const bundle = APP_STORE[`${e.app}/${e.platform}`];
    if (bundle) {
      const live = view?.appStore?.[bundle];
      items.push(
        <li key="appstore">
          {live ? fillNodes(t('appConfig.releases.appstoreLive'), { version: <bdi dir="ltr" className="font-mono">{live.version}</bdi> }) : t('appConfig.releases.appstoreNone')}
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
              ? fillNodes(t('appConfig.releases.storeMarked'), { store, version: <bdi dir="ltr" className="font-mono">{marked}</bdi> })
              : t('appConfig.releases.storeUploaded', { store })}
          </span>
          {markable && canEdit && marked !== e.version && (
            <button type="button" className={smallButtonClass} onClick={() => mark(e, source, e.version)} disabled={busy !== null} data-testid="app-releases-mark">
              {t('appConfig.releases.markAvailable', { store, version: e.version })}
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
            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full min-w-[44rem] text-start text-sm" data-testid="app-releases-table" data-app={app}>
                <thead className="bg-surface-2 text-fg-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t('appConfig.releases.colPlatform')}</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t('appConfig.releases.colChannel')}</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t('appConfig.releases.colLatest')}</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t('appConfig.releases.colReleased')}</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t('appConfig.releases.colSignature')}</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t('appConfig.releases.colStores')}</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t('appConfig.releases.colMinimum')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((e) => {
                    const min = minimumFor(versions, e.app, e.platform, e.channel);
                    return (
                      <tr key={`${e.platform}/${e.channel}`} data-testid="app-releases-row" data-target={`${e.app}/${e.platform}/${e.channel}`}>
                        <td className="px-3 py-2 text-fg">{t(`appConfig.platformNames.${e.platform}` as MessageKey)}</td>
                        <td className="px-3 py-2 text-fg-muted">{e.channel === 'beta' ? t('appConfig.releases.beta') : t('appConfig.releases.stable')}</td>
                        <td className="px-3 py-2">
                          <bdi dir="ltr" className="font-mono text-fg">{e.version}</bdi>
                        </td>
                        <td className="px-3 py-2 text-fg-muted">
                          <LocalTime value={e.publishedAt} />
                        </td>
                        <td className="px-3 py-2">
                          <span className={e.signed ? 'text-success-fg' : 'text-warning-fg'}>{e.signed ? t('appConfig.releases.signed') : t('appConfig.releases.unsigned')}</span>
                          {e.private && <span className="ms-2 text-fg-subtle">{t('appConfig.releases.privateRelease')}</span>}
                        </td>
                        <td className="px-3 py-2 text-fg">{stores(e)}</td>
                        <td className="px-3 py-2">{min ? <bdi dir="ltr" className="font-mono text-fg">{min}</bdi> : <span className="text-fg-subtle">{t('appConfig.releases.noMinimum')}</span>}</td>
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
                  reason: <bdi dir="ltr" className="font-mono">{q.reason}</bdi>,
                })}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
