'use client';

/**
 * Public profile settings (Story 29.5): /{locale}/settings/public-profile.
 *
 * The @handle (live availability, the channel handle rules) and three switches for what the
 * profile shows. One component for both directions; handles and URLs stay LTR.
 */

import React, { useEffect, useId, useState } from 'react';
import Link from '@/components/common/AppLink';
import { Switch } from '@/components/common/Switch';
import { publicProfileTranslations } from '@al-ummah/shared-types';
import { HANDLE_MAX_LENGTH, localHandleProblem } from '@/lib/channel-url';
import { userProfilePath } from '@/lib/user-url';
import type { HandleProblem } from '@/lib/api/channel-profile';
import {
  checkUserHandleAvailability,
  getMyPublicProfileSettings,
  updatePublicProfileSettings,
  type PublicProfileSettings as Settings,
} from '@/lib/api/public-profile';
import { logger } from '@/lib/logger-client';
import { reportError } from '@/lib/errors/reporter';

type HandleStatus = { state: 'idle' | 'checking' | 'available' | 'current' } | { state: 'unavailable'; reason: HandleProblem };
type Toggle = 'showSubscriptions' | 'showPlaylists' | 'showLikes';

export function PublicProfileSettings({ locale }: { locale: string }) {
  const t = publicProfileTranslations(locale).settings;
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const ids = { handle: useId(), help: useId(), status: useId(), result: useId() };

  const [loaded, setLoaded] = useState<Settings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [handle, setHandle] = useState('');
  const [toggles, setToggles] = useState<Record<Toggle, boolean>>({ showSubscriptions: false, showPlaylists: true, showLikes: false });
  const [status, setStatus] = useState<HandleStatus>({ state: 'idle' });
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<'saved' | 'failed' | null>(null);
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    setOrigin(window.location.origin);
    let cancelled = false;
    getMyPublicProfileSettings()
      .then((settings) => {
        if (cancelled) return;
        if (!settings) {
          setLoadFailed(true);
          return;
        }
        setLoaded(settings);
        setHandle(settings.handle ?? '');
        setToggles({ showSubscriptions: settings.showSubscriptions, showPlaylists: settings.showPlaylists, showLikes: settings.showLikes });
      })
      .catch((error) => {
        if (cancelled) return;
        logger.error('[PublicProfileSettings] Load failed', { error });
        reportError(error, { shown: true });
        setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const normalized = handle.trim().replace(/^@+/, '');
  const current = loaded?.handle ?? null;

  // Debounced availability (format problems without a request), as for channel handles
  useEffect(() => {
    let cancelled = false;
    if (!normalized) {
      setStatus({ state: 'idle' });
      return;
    }
    if (current && normalized === current) {
      setStatus({ state: 'current' });
      return;
    }
    const local = localHandleProblem(normalized);
    if (local) {
      setStatus({ state: 'unavailable', reason: local });
      return;
    }
    setStatus({ state: 'checking' });
    const timer = setTimeout(async () => {
      try {
        const answer = await checkUserHandleAvailability(normalized);
        if (cancelled) return;
        setStatus(!answer ? { state: 'idle' } : answer.available ? { state: 'available' } : { state: 'unavailable', reason: answer.reason || 'taken' });
      } catch (error) {
        logger.warn('[PublicProfileSettings] Availability check failed', { error });
        if (!cancelled) setStatus({ state: 'idle' });
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [normalized, current]);

  const problemText: Record<HandleProblem, string> = {
    too_short: t.handleTooShort,
    too_long: t.handleTooLong,
    invalid_characters: t.handleInvalid,
    reserved: t.handleReserved,
    taken: t.handleTaken,
  };

  const dirty = !!loaded && (
    normalized !== (current ?? '')
    || toggles.showSubscriptions !== loaded.showSubscriptions
    || toggles.showPlaylists !== loaded.showPlaylists
    || toggles.showLikes !== loaded.showLikes
  );
  const canSave = dirty && !saving && status.state !== 'checking' && status.state !== 'unavailable';

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setResult(null);
    const outcome = await updatePublicProfileSettings({
      ...(normalized !== (current ?? '') ? { handle: normalized || null } : {}),
      ...toggles,
    });
    setSaving(false);
    if (outcome.ok) {
      setLoaded(outcome.settings);
      setHandle(outcome.settings.handle ?? '');
      setResult('saved');
      return;
    }
    if (outcome.reason) {
      setStatus({ state: 'unavailable', reason: outcome.reason });
      return;
    }
    reportError(new Error(`Public profile save failed (${outcome.status})`), { shown: true, status: outcome.status });
    setResult('failed');
  };

  const previewUrl = `${origin}${userProfilePath(locale, normalized || t.handlePlaceholder)}`;
  const savedHandle = loaded?.handle;

  if (loadFailed) {
    return (
      <div dir={dir} className="mx-auto max-w-3xl px-4 py-8">
        <p role="alert" className="text-[var(--fanous-color-error-text)]" data-testid="public-profile-settings-error">{t.loadFailed}</p>
      </div>
    );
  }

  const rows: Array<{ key: Toggle; label: string; help: string }> = [
    { key: 'showPlaylists', label: t.showPlaylists, help: t.showPlaylistsHelp },
    { key: 'showSubscriptions', label: t.showSubscriptions, help: t.showSubscriptionsHelp },
    { key: 'showLikes', label: t.showLikes, help: t.showLikesHelp },
  ];

  return (
    <div dir={dir} lang={locale} className="pps-page mx-auto max-w-3xl px-4 py-8" data-testid="public-profile-settings">
      <h1 className="text-2xl font-bold text-[var(--fanous-color-text-primary)] md:text-3xl">{t.title}</h1>
      <p className="mt-2 text-[var(--fanous-color-text-secondary)]">{t.intro}</p>

      <form onSubmit={save} className="mt-6 flex flex-col gap-6" aria-busy={!loaded || saving}>
        <section className="pps-card rounded-xl border border-[var(--fanous-color-divider)] bg-[var(--fanous-color-surface)] p-4 md:p-6">
          <label htmlFor={ids.handle} className="block text-sm font-semibold text-[var(--fanous-color-text-primary)]">{t.handleLabel}</label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            {/* The input is the themed field; the @ sits inside it as a prefix */}
            <div className="relative flex-1" dir="ltr">
              <span className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3 text-[var(--fanous-color-text-muted)]" aria-hidden="true">@</span>
              <input
                id={ids.handle}
                type="text"
                value={handle}
                onChange={(e) => {
                  setHandle(e.target.value.replace(/\s/g, ''));
                  setResult(null);
                }}
                maxLength={HANDLE_MAX_LENGTH + 1}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                disabled={!loaded}
                placeholder={t.handlePlaceholder}
                aria-describedby={`${ids.help} ${ids.status}`}
                aria-invalid={status.state === 'unavailable'}
                className="pps-handle-input w-full rounded-lg border border-[var(--fanous-color-outline)] bg-[var(--fanous-color-background)] py-2 pe-3 text-[var(--fanous-color-text-primary)] placeholder:text-[var(--fanous-color-text-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fanous-color-focus-ring)]"
                style={{ paddingInlineStart: '1.75rem' }}
                data-testid="public-profile-handle-input"
              />
            </div>
            {normalized && (
              <button
                type="button"
                onClick={() => {
                  setHandle('');
                  setResult(null);
                }}
                className="pps-remove rounded-lg px-3 py-2 text-sm font-medium text-[var(--fanous-color-error-text)] hover:bg-[var(--fanous-color-surface-raised)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fanous-color-focus-ring)]"
                data-testid="public-profile-handle-remove"
              >
                {t.removeHandle}
              </button>
            )}
          </div>
          <p id={ids.help} className="mt-2 break-words text-sm text-[var(--fanous-color-text-muted)]">{t.handleHelp.replace('{url}', previewUrl)}</p>
          <p id={ids.status} className="mt-1 text-sm" aria-live="polite" data-testid="public-profile-handle-status" data-state={status.state}>
            {status.state === 'checking' && <span className="text-[var(--fanous-color-text-muted)]">{t.handleChecking}</span>}
            {status.state === 'available' && <span className="text-[var(--fanous-color-success-text)]">{t.handleAvailable.replace('{handle}', normalized)}</span>}
            {status.state === 'current' && <span className="text-[var(--fanous-color-text-muted)]">{t.handleCurrent}</span>}
            {status.state === 'unavailable' && <span className="text-[var(--fanous-color-error-text)]">{problemText[status.reason]}</span>}
            {status.state === 'idle' && loaded && !normalized && <span className="text-[var(--fanous-color-text-muted)]">{t.noHandle}</span>}
          </p>
        </section>

        <section aria-labelledby={`${ids.result}-show`} className="pps-card rounded-xl border border-[var(--fanous-color-divider)] bg-[var(--fanous-color-surface)] p-4 md:p-6">
          <h2 id={`${ids.result}-show`} className="text-lg font-semibold text-[var(--fanous-color-text-primary)]">{t.showTitle}</h2>
          <p className="mt-1 text-sm text-[var(--fanous-color-text-muted)]">{t.alwaysShown}</p>
          <ul className="mt-4 divide-y divide-[var(--fanous-color-divider)]">
            {rows.map((row) => {
              const labelId = `${ids.result}-${row.key}`;
              return (
                <li key={row.key} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p id={labelId} className="font-medium text-[var(--fanous-color-text-primary)]">{row.label}</p>
                    <p id={`${labelId}-help`} className="text-sm text-[var(--fanous-color-text-muted)]">{row.help}</p>
                  </div>
                  <Switch
                    checked={toggles[row.key]}
                    onCheckedChange={(next) => {
                      setToggles((prev) => ({ ...prev, [row.key]: next }));
                      setResult(null);
                    }}
                    disabled={!loaded}
                    aria-labelledby={labelId}
                    aria-describedby={`${labelId}-help`}
                    data-testid={`public-profile-toggle-${row.key}`}
                  />
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-sm text-[var(--fanous-color-text-muted)]">{t.showHelp}</p>
        </section>

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={!canSave}
            className="pps-save rounded-full bg-[var(--fanous-color-primary)] px-6 py-2 font-semibold text-[var(--fanous-color-on-primary)] hover:bg-[var(--fanous-color-primary-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fanous-color-focus-ring)] disabled:bg-[var(--fanous-color-primary-disabled)] disabled:text-[var(--fanous-color-on-primary-disabled)]"
            data-testid="public-profile-save"
          >
            {saving ? t.saving : t.save}
          </button>
          {savedHandle && (
            <Link href={userProfilePath(locale, savedHandle)} className="font-medium text-[var(--fanous-color-link)] underline-offset-2 hover:underline" data-testid="public-profile-view-link">
              {t.viewProfile}
            </Link>
          )}
          <span role="status" aria-live="polite" className="text-sm" data-testid="public-profile-save-result">
            {result === 'saved' && <span className="text-[var(--fanous-color-success-text)]">{t.saved}</span>}
            {result === 'failed' && <span className="text-[var(--fanous-color-error-text)]">{t.saveFailed}</span>}
          </span>
        </div>
      </form>
    </div>
  );
}

export default PublicProfileSettings;
