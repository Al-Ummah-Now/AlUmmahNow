'use client';

/**
 * The Features page (wiki AUN-FEATURES §3, decision O39): every switchable feature in registry
 * order, grouped, each with its help text always visible, a switch with its state in words, who
 * changed it last and when, notes, and its history.
 *
 * A direction the entry's `confirm` doesn't cover acts at once and offers Undo for 10 s; the other
 * direction asks first. Each write sends the version it saw: when someone else changed the feature
 * meanwhile, the switch snaps back to the server's value and says who.
 */
import { useEffect, useMemo, useState } from 'react';
import { featureDefinition, formatCompact, formatList, type FeatureKey } from '@al-ummah/shared-types';
import type { FeatureHistoryPage, FeatureItem, FeatureWrite, FeatureWriteResult } from '@/lib/api/features';
import {
  applyConflict,
  applyWrite,
  confirmContent,
  featureNotes,
  groupFeatures,
  lockReason,
  needsConfirm,
  offCount,
  switchWords,
  type ConfirmContent,
  type FeatureNote,
  type FeatureRow,
} from '@/lib/features/page-model';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatNumber } from '@/i18n/translate';
import type { Locale } from '@/i18n/config';
import AppLink from '@/components/AppLink';
import { LocalTime } from '@/components/LocalTime';
import { Icon } from '@/components/shell/icons';
import { linkClass } from '@/components/ui';
import { useUndoableAction } from '@/components/undo/UndoToast';
import { logger } from '@/lib/logger-client';
import { FeatureSwitch } from './FeatureSwitch';
import { FeatureConfirmDialog } from './FeatureConfirmDialog';
import { FeatureHistorySheet } from './FeatureHistorySheet';

export const FEATURES_UNDO_MS = 10_000;

type RowMessage = { kind: 'conflict'; by: string | null } | { kind: 'precondition'; message: string } | { kind: 'error'; message: string };

class WriteRefused extends Error {}

export interface FeatureActions {
  setFeature: (key: FeatureKey, enabled: boolean, expectedVersion: number, opts?: { undo?: boolean }) => Promise<FeatureWriteResult>;
  featureHistory: (key: FeatureKey, cursor?: string | null) => Promise<FeatureHistoryPage>;
}

export function FeaturesView({ initial, canManage, me, actions, now }: { initial: FeatureItem[]; canManage: boolean; me: { id: string; name: string }; actions: FeatureActions; now?: string }) {
  const { t, locale } = useLanguage();
  const { run } = useUndoableAction();
  const [items, setItems] = useState(initial);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<FeatureKey | null>(null);
  const [messages, setMessages] = useState<Partial<Record<FeatureKey, RowMessage>>>({});
  const [confirm, setConfirm] = useState<ConfirmContent | null>(null);
  const [historyKey, setHistoryKey] = useState<FeatureKey | null>(null);
  const [target, setTarget] = useState<string | null>(null);

  const groups = useMemo(() => groupFeatures(items, query, locale), [items, query, locale]);
  const off = offCount(items);

  // /features#captionsTranscribe (from the old pages' status lines): bring that row into view
  useEffect(() => {
    const read = () => setTarget(decodeURIComponent(window.location.hash.slice(1)) || null);
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  useEffect(() => {
    if (!target) return;
    document.getElementById(target)?.scrollIntoView({ block: 'center' });
  }, [target]);

  const setMessage = (key: FeatureKey, message: RowMessage | null) =>
    setMessages((m) => {
      const out = { ...m };
      if (message) out[key] = message;
      else delete out[key];
      return out;
    });

  /** One write; false when it was refused (the row then says why). */
  async function write(key: FeatureKey, enabled: boolean, expectedVersion: number, undo = false): Promise<FeatureWrite | null> {
    setBusy(key);
    setMessage(key, null);
    try {
      const result = await actions.setFeature(key, enabled, expectedVersion, undo ? { undo: true } : {});
      if (result.ok) {
        setItems((list) => applyWrite(list, key, result.data.enabled, result.data.version, me, now ?? new Date().toISOString()));
        return result.data;
      }
      if (result.kind === 'changed') {
        setItems((list) => applyConflict(list, result.feature).items);
        setMessage(key, { kind: 'conflict', by: result.feature.updatedBy?.name ?? null });
      } else if (result.kind === 'precondition') {
        setMessage(key, { kind: 'precondition', message: result.message });
      } else {
        logger.warn('[features] Switch change refused', { key, status: result.status, code: result.code });
        setMessage(key, { kind: 'error', message: result.message || t('features.writeFailed') });
      }
      return null;
    } catch (error) {
      logger.error('[features] Switch change failed', { key, error: error instanceof Error ? error.message : String(error) });
      setMessage(key, { kind: 'error', message: t('features.writeFailed') });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function act(key: FeatureKey, next: boolean) {
    const item = items.find((i) => i.key === key);
    if (!item) return;
    const name = featureDefinition(key).name[locale];
    try {
      await run({
        action: async () => {
          const done = await write(key, next, item.version);
          if (!done) throw new WriteRefused();
          return done;
        },
        undo: async (done) => {
          const back = await write(key, done.previous, done.version, true);
          if (!back) throw new WriteRefused();
        },
        message: t(next ? 'features.toastOn' : 'features.toastOff', { name }),
        undoneMessage: t('features.toastUndone', { name }),
        windowMs: FEATURES_UNDO_MS,
      });
    } catch (error) {
      if (!(error instanceof WriteRefused)) logger.error('[features] Undoable change failed', { key, error: error instanceof Error ? error.message : String(error) });
    }
  }

  function toggle(row: FeatureRow, next: boolean) {
    if (needsConfirm(row.def, next)) setConfirm(confirmContent(row.item.key, next));
    else void act(row.item.key, next);
  }

  return (
    <div data-testid="features-page" data-can-manage={String(canManage)}>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-fg">{t('features.title')}</h1>
        <p className="mt-2 max-w-prose text-fg-muted">{t('features.intro')}</p>
        <p className="mt-2 text-sm text-fg-muted" data-testid="features-summary" data-off={off}>
          {off === 0 ? t('features.summaryAllOn') : t('features.summaryOff', { off, total: items.length })}
        </p>
      </div>

      {!canManage && (
        <p className="mb-6 flex items-start gap-2 rounded-lg border border-border bg-surface p-3 text-sm text-fg" data-solid-surface data-testid="features-read-only">
          <Icon name="lock" className="mt-0.5 size-4 shrink-0 text-fg-muted" />
          <span>{t('features.readOnly')}</span>
        </p>
      )}

      <div className="mb-6 max-w-xl" role="search">
        <label htmlFor="features-search" className="sr-only">
          {t('features.searchLabel')}
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-fg-muted">
            <Icon name="search" className="size-4" />
          </span>
          <input
            id="features-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('features.searchPlaceholder')}
            autoComplete="off"
            dir="auto"
            className="w-full rounded-lg border border-border bg-surface py-2.5 pe-3 ps-9 text-fg placeholder:text-fg-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            data-testid="features-search"
          />
        </div>
      </div>

      {groups.length === 0 && (
        <div className="rounded-lg border border-border bg-surface p-6 text-fg-muted" data-solid-surface data-testid="features-no-matches">
          <p>{t('features.noMatches', { query: query.trim() })}</p>
          <button type="button" className={`${linkClass} mt-2`} onClick={() => setQuery('')}>
            {t('features.clearSearch')}
          </button>
        </div>
      )}

      <div className="space-y-6">
        {groups.map((group) => {
          const all = items.filter((i) => featureDefinition(i.key).group === group.id);
          const onInGroup = all.filter((i) => i.effective).length;
          return (
            <section key={group.id} aria-labelledby={`features-group-${group.id}`} className="overflow-hidden rounded-xl border border-border bg-surface" data-solid-surface data-testid="features-group" data-group={group.id}>
              <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border bg-surface-2 px-5 py-3">
                <h2 id={`features-group-${group.id}`} className="text-base font-semibold text-fg">
                  {t(`features.groups.${group.id}`)}
                </h2>
                <p className="text-sm text-fg-muted" data-testid="features-group-count">
                  {t('features.groupOn', { on: onInGroup, total: all.length })}
                </p>
              </header>
              <ul className="divide-y divide-border">
                {group.rows.map((row) => (
                  <FeatureRowView
                    key={row.item.key}
                    row={row}
                    locale={locale}
                    canManage={canManage}
                    busy={busy === row.item.key}
                    message={messages[row.item.key] ?? null}
                    targeted={target === row.item.key}
                    onToggle={(next) => toggle(row, next)}
                    onHistory={() => setHistoryKey(row.item.key)}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <FeatureConfirmDialog
        content={confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={(c) => {
          setConfirm(null);
          const item = items.find((i) => i.key === c.key);
          if (item) void write(c.key, c.next, item.version);
        }}
      />
      <FeatureHistorySheet featureKey={historyKey} load={actions.featureHistory} onClose={() => setHistoryKey(null)} />
    </div>
  );
}

function FeatureRowView({
  row,
  locale,
  canManage,
  busy,
  message,
  targeted,
  onToggle,
  onHistory,
}: {
  row: FeatureRow;
  locale: Locale;
  canManage: boolean;
  busy: boolean;
  message: RowMessage | null;
  targeted: boolean;
  onToggle: (next: boolean) => void;
  onHistory: () => void;
}) {
  const { t } = useLanguage();
  const { item, def } = row;
  const nameId = `feature-${item.key}-name`;
  const helpId = `feature-${item.key}-help`;
  const words = switchWords(item);
  const lock = lockReason(item, canManage);
  const notes = featureNotes(item, locale);
  return (
    <li
      id={item.key}
      className={`scroll-mt-28 px-5 pb-5 pt-3 ${targeted ? 'bg-chip-reviewing-bg' : ''}`}
      data-testid="feature-row"
      data-key={item.key}
      data-enabled={String(item.enabled)}
      data-effective={String(item.effective)}
      data-words={words}
      data-lock={lock ?? ''}
    >
      <div className="flex items-start justify-between gap-4">
        <h3 id={nameId} className="min-w-0 flex-1 pt-2.5 text-base font-semibold text-fg [text-wrap:balance]">
          {def.name[locale]}
        </h3>
        <FeatureSwitch
          checked={item.enabled && !item.envOverride}
          words={words}
          labelledBy={nameId}
          describedBy={helpId}
          locked={lock !== null}
          busy={busy}
          onChange={onToggle}
          testId={`feature-switch-${item.key}`}
        />
      </div>
      <p id={helpId} className="max-w-3xl text-sm text-fg-muted [text-wrap:pretty]" data-testid="feature-help">
        {def.help[locale]}
      </p>

      {(notes.length > 0 || lock === 'superAdminOnly') && (
        <ul className="mt-3 space-y-1.5" data-testid="feature-notes">
          {notes.map((note) => (
            <NoteLine key={note.kind} note={note} locale={locale} />
          ))}
          {lock === 'superAdminOnly' && (
            <li className="flex items-start gap-2 text-sm text-fg-muted" data-note="superAdminOnly">
              <Icon name="lock" className="mt-0.5 size-4 shrink-0" />
              <span>{t('features.lock.superAdminOnly')}</span>
            </li>
          )}
        </ul>
      )}

      {message && <RowMessageView message={message} />}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted">
        <p data-testid="feature-status">
          <StatusLine item={item} />
        </p>
        <button type="button" onClick={onHistory} className={`${linkClass} inline-flex min-h-11 items-center gap-1 sm:min-h-0`} aria-label={t('features.historyFor', { name: def.name[locale] })} data-testid="feature-history-link">
          <Icon name="clock" className="size-4" />
          {t('features.history')}
        </button>
      </div>
    </li>
  );
}

function StatusLine({ item }: { item: FeatureItem }) {
  const { t } = useLanguage();
  if (!item.updatedAt || !item.updatedBy) return <>{t('features.neverChanged')}</>;
  const marker = '\u0000';
  const [before, after = ''] = t('features.changedBy', { name: marker, time: '\u0001' }).split('\u0001');
  const [lead, tail = ''] = before.split(marker);
  return (
    <>
      {lead}
      <bdi>{item.updatedBy.name}</bdi>
      {tail}
      <LocalTime value={item.updatedAt} testId="feature-changed-at" />
      {after}
    </>
  );
}

function NoteLine({ note, locale }: { note: FeatureNote; locale: Locale }) {
  const { t } = useLanguage();
  switch (note.kind) {
    case 'blocked': {
      const names = formatList(locale, note.by.map((k) => featureDefinition(k).name[locale]));
      return (
        <li className="flex items-start gap-2 text-sm text-fg" data-note="blocked">
          <Icon name="layers" className="mt-0.5 size-4 shrink-0 text-warning-fg" />
          <span>{t('features.notes.blocked', { names })}</span>
        </li>
      );
    }
    case 'needsSetup':
      return (
        <li className="flex items-start gap-2 text-sm text-fg" data-note="needsSetup">
          <Icon name="alert" className="mt-0.5 size-4 shrink-0 text-warning-fg" />
          <span>
            {note.note ? t('features.notes.needsSetup', { note: note.note }) : t('features.notes.needsSetupPlain')}
            {note.href && (
              <>
                {' '}
                <AppLink href={note.href} className={`${linkClass} whitespace-nowrap underline underline-offset-2`} data-testid="feature-setup-link">
                  {t('features.notes.setUp')}
                </AppLink>
              </>
            )}
          </span>
        </li>
      );
    case 'envOverride':
      return (
        <li className="flex items-start gap-2 text-sm text-fg" data-note="envOverride">
          <Icon name="lock" className="mt-0.5 size-4 shrink-0 text-fg-muted" />
          <span>{t('features.notes.envOverride')}</span>
        </li>
      );
    case 'parked':
      return (
        <li className="flex items-start gap-2 text-sm text-fg" data-note="parked">
          <Icon name="clock" className="mt-0.5 size-4 shrink-0 text-fg-muted" />
          <span>{t('features.notes.parked', { count: note.count >= 1000 ? formatCompact(locale, note.count) : formatNumber(note.count, locale) })}</span>
        </li>
      );
  }
}

function RowMessageView({ message }: { message: RowMessage }) {
  const { t } = useLanguage();
  if (message.kind === 'conflict') {
    return (
      <p role="status" className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-chip-reviewing-bg px-3 py-2 text-sm text-fg" data-testid="feature-conflict">
        <Icon name="people" className="mt-0.5 size-4 shrink-0" />
        <span>{message.by ? t('features.conflict', { name: message.by }) : t('features.conflictNobody')}</span>
      </p>
    );
  }
  if (message.kind === 'precondition') {
    return (
      <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-warning-fg/60 bg-chip-pending-bg px-3 py-2 text-sm text-fg" data-testid="feature-precondition">
        <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
        <span>{message.message}</span>
      </p>
    );
  }
  return (
    <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger-fg" data-testid="feature-write-error">
      <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
      <span>{message.message}</span>
    </p>
  );
}
