'use client';

/**
 * Remote config editor (issue #413): the `flags`, `config` and `versions` documents the native
 * apps read from /api/v1/app-config, one tab each. Changes stay drafts on the page until saved;
 * the JSON preview shows the document that will be stored, "Try it" evaluates the drafts for one
 * app build, and Save sends one document through admin-api (settings:manage, audited). A document
 * someone else saved meanwhile is never overwritten: the save answers with a conflict and the
 * admin loads the latest.
 */
import { useCallback, useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sameAppConfigDocument as sameDocument, type AppConfigDocumentKey } from '@al-ummah/shared-types';
import { getAppConfigDocument, saveAppConfigDocument, type AppConfigHistoryEntry } from '@/lib/api/appConfig';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatDate } from '@/i18n/translate';
import { primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';
import {
  draftsToDocument,
  rulesToDrafts,

  serverProblems,
  versionsToDocument,
  versionsToDrafts,
  type Problem,
  type RuleDraft,
  type VersionDraft,
} from './app-config-model';
import { RuleList } from './RuleList';
import { PriorityTabs } from '@/components/PriorityTabs';
import { VersionList } from './VersionList';
import { DryRun } from './DryRun';

const KEYS: AppConfigDocumentKey[] = ['flags', 'config', 'versions'];

interface Props {
  initial: Record<AppConfigDocumentKey, unknown>;
  history: Record<AppConfigDocumentKey, AppConfigHistoryEntry[]>;
}

type Notice = { tone: 'ok' | 'error' | 'conflict'; text: string } | null;

export function AppConfigEditor({ initial, history }: Props) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const ids = useId();
  const [tab, setTab] = useState<AppConfigDocumentKey>('flags');
  const [baseline, setBaseline] = useState(initial);
  const [rules, setRules] = useState<Record<'flags' | 'config', RuleDraft[]>>(() => ({ flags: rulesToDrafts(initial.flags), config: rulesToDrafts(initial.config) }));
  const [versions, setVersions] = useState<VersionDraft[]>(() => versionsToDrafts(initial.versions));
  // Problems show once the admin tried to save or run (not while a new rule is still being typed)
  const [checked, setChecked] = useState<Record<AppConfigDocumentKey, boolean>>({ flags: false, config: false, versions: false });
  const [fromServer, setFromServer] = useState<Record<AppConfigDocumentKey, Problem[]>>({ flags: [], config: [], versions: [] });
  const [notice, setNotice] = useState<Record<AppConfigDocumentKey, Notice>>({ flags: null, config: null, versions: null });
  const [busy, setBusy] = useState<AppConfigDocumentKey | null>(null);

  const built = useMemo(
    () => ({
      flags: draftsToDocument(rules.flags, 'flags'),
      config: draftsToDocument(rules.config, 'config'),
      versions: versionsToDocument(versions),
    }),
    [rules, versions],
  );
  const dirty = (key: AppConfigDocumentKey) => built[key].value === null || !sameDocument(built[key].value, baseline[key] ?? (key === 'versions' ? {} : []));
  const shownProblems = (key: AppConfigDocumentKey) => [...(checked[key] ? built[key].problems : []), ...fromServer[key]];

  const setNoticeFor = (key: AppConfigDocumentKey, value: Notice) => setNotice((n) => ({ ...n, [key]: value }));
  const clearServer = (key: AppConfigDocumentKey) => setFromServer((p) => (p[key].length ? { ...p, [key]: [] } : p));

  const replaceDrafts = useCallback((key: AppConfigDocumentKey, value: unknown) => {
    if (key === 'versions') setVersions(versionsToDrafts(value));
    else setRules((r) => ({ ...r, [key]: rulesToDrafts(value) }));
  }, []);

  async function save(key: AppConfigDocumentKey) {
    setChecked((c) => ({ ...c, [key]: true }));
    clearServer(key);
    const doc = built[key];
    if (doc.value === null) {
      setNoticeFor(key, { tone: 'error', text: t('appConfig.fixFirst', { count: doc.problems.length }) });
      return;
    }
    if (!dirty(key)) {
      setNoticeFor(key, { tone: 'ok', text: t('appConfig.unchanged') });
      return;
    }
    setBusy(key);
    setNoticeFor(key, null);
    try {
      const res = await saveAppConfigDocument(key, doc.value, baseline[key] ?? null);
      if (res.ok) {
        setBaseline((b) => ({ ...b, [key]: res.data.value }));
        setNoticeFor(key, { tone: 'ok', text: t('appConfig.saved') });
        router.refresh();
      } else if (res.status === 409) {
        setNoticeFor(key, { tone: 'conflict', text: t('appConfig.conflict') });
      } else if (res.status === 400 && res.problems?.length) {
        setFromServer((p) => ({ ...p, [key]: serverProblems(res.problems, key === 'versions' ? [] : rules[key], key, versions) }));
        setNoticeFor(key, { tone: 'error', text: t('appConfig.fixFirst', { count: res.problems.length }) });
      } else {
        logger.warn('[app-config] Save failed', { key, status: res.status });
        setNoticeFor(key, { tone: 'error', text: res.status === 401 ? t('errors.notAuthenticated') : t('appConfig.saveFailed') });
      }
    } catch (e) {
      logger.error('[app-config] Save request failed', { key, error: e instanceof Error ? e.message : String(e) });
      setNoticeFor(key, { tone: 'error', text: t('appConfig.saveFailed') });
    } finally {
      setBusy(null);
    }
  }

  async function loadLatest(key: AppConfigDocumentKey) {
    setBusy(key);
    try {
      const value = await getAppConfigDocument(key);
      setBaseline((b) => ({ ...b, [key]: value }));
      replaceDrafts(key, value);
      clearServer(key);
      setChecked((c) => ({ ...c, [key]: false }));
      setNoticeFor(key, null);
      router.refresh();
    } catch (e) {
      logger.error('[app-config] Could not load the latest document', { key, error: e instanceof Error ? e.message : String(e) });
      setNoticeFor(key, { tone: 'error', text: t('appConfig.loadFailed') });
    } finally {
      setBusy(null);
    }
  }

  function discard(key: AppConfigDocumentKey) {
    replaceDrafts(key, baseline[key]);
    clearServer(key);
    setChecked((c) => ({ ...c, [key]: false }));
    setNoticeFor(key, null);
  }

  // The drafts for "Try it": every document, or null when one still has problems (they are then shown)
  const dryRunDocuments = useCallback(() => {
    const bad = KEYS.filter((k) => built[k].value === null);
    if (bad.length) {
      setChecked((c) => ({ ...c, ...Object.fromEntries(bad.map((k) => [k, true])) }));
      return null;
    }
    return { flags: built.flags.value, config: built.config.value, versions: built.versions.value };
  }, [built]);

  const preview = built[tab].value;
  const n = notice[tab];
  const problems = shownProblems(tab);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-4 [&_input]:scroll-mb-40 [&_input]:scroll-mt-24 [&_select]:scroll-mb-40 [&_select]:scroll-mt-24 [&_textarea]:scroll-mb-40 [&_textarea]:scroll-mt-24">
        {/* One row: the documents that fit, the rest under "More" (#1669: never a tab cut at the edge or wrapped) */}
        <PriorityTabs
          label={t('appConfig.tabsLabel')}
          testId="app-config-tabs"
          className="border-b border-border"
          rowClassName="gap-1"
          tabClassName="-mb-px block min-h-11 whitespace-nowrap rounded-t border-b-2 px-4 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          currentClassName="border-accent text-fg"
          idleClassName="border-transparent text-fg-muted hover:text-fg"
          tabTestIdPrefix="app-config-tab-"
          onSelect={(id) => setTab(id as AppConfigDocumentKey)}
          tabs={KEYS.map((key) => ({
            id: key,
            label: t(`appConfig.tabs.${key}`),
            current: tab === key,
            extra: dirty(key) ? <span className="ms-2 inline-block h-2 w-2 rounded-full bg-accent align-middle" aria-label={t('appConfig.unsaved')} role="img" /> : undefined,
          }))}
        />

        <div role="region" id={`${ids}-panel`} aria-label={t(`appConfig.tabs.${tab}`)} className="space-y-4" data-testid="app-config-panel" data-document={tab}>
          <p className="max-w-3xl text-sm text-fg-muted">{t(`appConfig.intro.${tab}`)}</p>
          {tab === 'versions' ? (
            <VersionList
              drafts={versions}
              onChange={(d) => {
                setVersions(d);
                clearServer('versions');
              }}
              problems={problems}
              disabled={busy === 'versions'}
            />
          ) : (
            <RuleList
              key={tab}
              kind={tab}
              drafts={rules[tab]}
              onChange={(d) => {
                setRules((r) => ({ ...r, [tab]: d }));
                clearServer(tab);
              }}
              problems={problems}
              disabled={busy === tab}
            />
          )}

          <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 -mx-1 flex md:bottom-0 flex-wrap items-center gap-3 rounded-lg border border-border bg-surface/95 p-3 shadow-sm backdrop-blur" data-testid="app-config-save-bar">
            <button type="button" className={primaryButtonClass} onClick={() => save(tab)} disabled={busy !== null} data-testid="app-config-save">
              {busy === tab ? t('appConfig.saving') : t('appConfig.save')}
            </button>
            {dirty(tab) && (
              <button type="button" className={secondaryButtonClass} onClick={() => discard(tab)} disabled={busy !== null} data-testid="app-config-discard">
                {t('appConfig.discard')}
              </button>
            )}
            <span role="status" aria-live="polite" className="w-full min-w-0 text-sm sm:w-auto sm:flex-1">
              {n && (
                <span className={n.tone === 'ok' ? 'text-success-fg' : n.tone === 'conflict' ? 'text-warning-fg' : 'text-danger-fg'} data-testid="app-config-notice" data-tone={n.tone}>
                  {n.text}
                </span>
              )}
            </span>
            {n?.tone === 'conflict' && (
              <button type="button" className={secondaryButtonClass} onClick={() => loadLatest(tab)} disabled={busy !== null} data-testid="app-config-load-latest">
                {t('appConfig.loadLatest')}
              </button>
            )}
          </div>

          <section aria-labelledby={`${ids}-history`} className="space-y-1" data-testid="app-config-history">
            <h2 id={`${ids}-history`} className="text-sm font-semibold text-fg">
              {t('appConfig.historyTitle')}
            </h2>
            {history[tab].length === 0 ? (
              <p className="text-sm text-fg-muted">{t('appConfig.historyEmpty')}</p>
            ) : (
              <ul className="space-y-0.5 text-sm text-fg-muted">
                {history[tab].map((h) => (
                  <li key={h.id} data-testid="app-config-history-entry">
                    {t('appConfig.historyEntry', { date: formatDate(h.createdAt, locale, true), actor: '\u0000' })
                      .split('\u0000')
                      .flatMap((part, i) =>
                        i === 0
                          ? [part]
                          : [
                              <a key={h.id} href={`/users/${encodeURIComponent(h.actorId)}`} className="text-link hover:text-link-hover underline-offset-2 hover:underline" title={h.actorId}>
                                <bdi>{h.actorName ?? t('reviewAlerts.unknownUser')}</bdi>
                              </a>,
                              part,
                            ],
                      )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <aside className="min-w-0 space-y-4 xl:sticky xl:top-4 xl:self-start">
        <DryRun documents={dryRunDocuments} />
        <section className="rounded-lg border border-border bg-surface p-4" aria-labelledby={`${ids}-preview`} data-testid="app-config-preview">
          <h2 id={`${ids}-preview`} className="text-lg font-semibold text-fg">
            {t('appConfig.previewTitle')}
          </h2>
          <p className="text-sm text-fg-muted">{t('appConfig.previewHint')}</p>
          {preview === null ? (
            <p className="mt-2 text-sm text-danger-fg">{t('appConfig.previewInvalid')}</p>
          ) : (
            <pre className="mt-2 max-h-96 overflow-auto rounded bg-surface-2 p-3 font-mono text-xs text-fg" dir="ltr" tabIndex={0} aria-label={t('appConfig.previewTitle')} data-testid="app-config-preview-json">
              {JSON.stringify(preview, null, 2)}
            </pre>
          )}
        </section>
      </aside>
    </div>
  );
}
