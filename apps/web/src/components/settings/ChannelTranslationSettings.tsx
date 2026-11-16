'use client';

/**
 * A channel's translation settings (AUN-CAPTIONS §3.3, O7, §5.9):
 * - the Quran Foundation translation shown, with its name, for confirmed ayat in machine-translated
 *   caption tracks, per language (the site's default, Saheeh International for English, until the
 *   channel picks one). Quran is never machine-translated.
 * - whether viewers of other languages may see a labelled machine translation of titles and
 *   descriptions (O6: on unless the channel opts out; an admin can pause it for the site).
 * Each part shows only while it is on (GET /api/me/features `quranEditions`: Quran Foundation
 * credentials bound; `viewerTranslatedTitles`: switched on for the site); with neither, no card.
 */
import React, { useEffect, useId, useState } from 'react';
import { BookOpen, Languages, Loader2 } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { useFeatures } from '@/hooks/useFeatures';
import { SUPPORTED_LANGUAGES } from '@/lib/api/subtitles-types';
import { reportError } from '@/lib/errors/reporter';
import {
  getChannelQuranEditions,
  getChannelTranslationSettings,
  listQuranEditions,
  resetChannelQuranEdition,
  setChannelQuranEdition,
  setChannelTranslationSettings,
  type ChannelQuranEdition,
  type ChannelTranslationSettings as Settings,
  type QuranEdition,
} from '@/lib/api/translate-client';

const CARD = 'rounded-lg border border-[var(--fanous-color-outline)] bg-[var(--fanous-color-surface)] p-4 sm:p-6 space-y-4';
const MUTED = 'text-sm text-[var(--fanous-color-text-secondary)]';
const SELECT = 'min-h-11 w-full rounded-md border border-[var(--fanous-color-outline)] bg-[var(--fanous-color-background)] px-3 text-sm text-[var(--fanous-color-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fanous-color-primary)]';

function EditionRow({ channelId, row, onChange }: { channelId: string; row: ChannelQuranEdition; onChange: (rows: ChannelQuranEdition[]) => void }) {
  const { t, lang } = useLanguage();
  const cs = t.captions.channelSettings;
  const ids = useId();
  const [editions, setEditions] = useState<QuranEdition[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [picked, setPicked] = useState<number>(row.id);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const language = SUPPORTED_LANGUAGES.find((l) => l.code === row.language);
  const languageName = language ? (lang === 'ar' ? language.nameAr : language.name) : row.language;

  useEffect(() => {
    let live = true;
    void listQuranEditions(row.language).then((res) => {
      if (!live) return;
      if (res.ok) {
        setEditions(res.data.editions);
        // A newly added language starts on its first edition
        setPicked((p) => (res.data.editions.some((e) => e.id === p) ? p : (res.data.editions[0]?.id ?? p)));
      }
      else setUnavailable(true);
    });
    return () => {
      live = false;
    };
  }, [row.language]);

  useEffect(() => {
    if (row.id) setPicked(row.id);
  }, [row.id]);

  const run = async (action: () => ReturnType<typeof setChannelQuranEdition>) => {
    setBusy(true);
    setNote(null);
    const res = await action();
    setBusy(false);
    if (!res.ok) {
      setNote({ text: res.error === 'quran_unavailable' ? cs.unavailable : cs.failed, error: true });
      if (res.status >= 500 && res.status !== 503) reportError(new Error(`channel quran edition failed: ${res.error}`), { shown: true, status: res.status, extra: { channelId, language: row.language } });
      return;
    }
    onChange(res.data.editions);
    setNote({ text: cs.saved, error: false });
  };

  const source = row.source === 'channel' ? cs.sourceChannel : row.source === 'platform' ? cs.sourcePlatform : cs.sourceDefault;
  return (
    <li className="space-y-2 rounded-md border border-[var(--fanous-color-divider)] p-3" data-testid={`channel-quran-${row.language}`} data-source={row.source}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span id={`${ids}-lang`} className="text-sm font-semibold text-[var(--fanous-color-text-primary)]" lang={row.language === lang ? undefined : row.language}>
          {languageName}
        </span>
        <span className="rounded-full bg-[var(--fanous-color-surface-variant,transparent)] px-2 py-0.5 text-xs text-[var(--fanous-color-text-secondary)] ring-1 ring-[var(--fanous-color-divider)]">{source}</span>
      </div>
      <label htmlFor={`${ids}-edition`} className="block text-xs font-medium text-[var(--fanous-color-text-secondary)]">
        {cs.edition}
      </label>
      {unavailable ? (
        <p className={MUTED}>
          <span dir="auto">{row.name}</span> · {cs.unavailable}
        </p>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <select id={`${ids}-edition`} className={SELECT} value={picked} disabled={!editions || busy} onChange={(e) => setPicked(Number(e.target.value))} aria-describedby={`${ids}-lang`} data-testid={`channel-quran-${row.language}-select`}>
            {!editions && <option value={row.id}>{row.name}</option>}
            {editions?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.author && !e.name.includes(e.author) ? `${e.name} (${e.author})` : e.name}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button type="button" className="b b-primary b-sm min-h-11" disabled={busy || !editions || picked === row.id} onClick={() => void run(() => setChannelQuranEdition(channelId, row.language, picked))} data-testid={`channel-quran-${row.language}-save`}>
              {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
              {cs.save}
            </button>
            {row.source === 'channel' && (
              <button type="button" className="b b-ghost b-sm min-h-11 whitespace-nowrap" disabled={busy} onClick={() => void run(() => resetChannelQuranEdition(channelId, row.language))} data-testid={`channel-quran-${row.language}-reset`}>
                {cs.reset}
              </button>
            )}
          </div>
        </div>
      )}
      {note && (
        <p role={note.error ? 'alert' : 'status'} className={`text-xs ${note.error ? 'text-[var(--fanous-color-error-text)]' : 'text-[var(--fanous-color-text-secondary)]'}`}>
          {note.text}
        </p>
      )}
    </li>
  );
}

export function ChannelTranslationSettings({ channelId }: { channelId: string }) {
  const { t, lang } = useLanguage();
  const cs = t.captions.channelSettings;
  const ids = useId();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rows, setRows] = useState<ChannelQuranEdition[] | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  const [titleNote, setTitleNote] = useState<{ text: string; error: boolean } | null>(null);
  const [savingTitles, setSavingTitles] = useState(false);
  const { features } = useFeatures(channelId);
  const titlesOn = features.viewerTranslatedTitles;
  const quranOn = features.quranEditions;

  useEffect(() => {
    let live = true;
    setFailed(false);
    if (!titlesOn) setSettings(null);
    if (!quranOn) setRows(null);
    if (!titlesOn && !quranOn) return;
    void Promise.all([titlesOn ? getChannelTranslationSettings(channelId) : null, quranOn ? getChannelQuranEditions(channelId) : null]).then(([s, q]) => {
      if (!live) return;
      if (s?.ok) setSettings(s.data);
      if (q?.ok) setRows(q.data.editions.filter((e) => e.language !== 'ar'));
      if ((s && !s.ok) || (q && !q.ok)) setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [channelId, titlesOn, quranOn]);

  const toggleTitles = async (on: boolean) => {
    if (!settings) return;
    setSavingTitles(true);
    setTitleNote(null);
    const res = await setChannelTranslationSettings(channelId, on);
    setSavingTitles(false);
    if (!res.ok) {
      setTitleNote({ text: cs.failed, error: true });
      if (res.status >= 500) reportError(new Error(`channel translation settings failed: ${res.error}`), { shown: true, status: res.status, extra: { channelId } });
      return;
    }
    setSettings(res.data);
    setTitleNote({ text: cs.saved, error: false });
  };

  const listed = new Set([...(rows ?? []).map((r) => r.language), ...added]);
  const addable = SUPPORTED_LANGUAGES.filter((l) => l.code !== 'ar' && !listed.has(l.code));
  const shown: ChannelQuranEdition[] = [...(rows ?? []), ...added.filter((code) => !(rows ?? []).some((r) => r.language === code)).map((code) => ({ language: code, id: 0, name: '', source: 'default' as const }))];

  // Neither part is on for this channel: no card at all
  if (!titlesOn && !quranOn) return null;

  return (
    <section className={CARD} aria-labelledby={`${ids}-title`} data-testid="channel-translation-settings">
      <div className="flex items-start gap-2">
        <Languages className="mt-0.5 h-5 w-5 shrink-0 text-[var(--fanous-color-primary)]" aria-hidden="true" />
        <div>
          <h2 id={`${ids}-title`} className="text-lg font-semibold text-[var(--fanous-color-text-primary)]">
            {cs.title}
          </h2>
          <p className={MUTED}>{cs.hint}</p>
        </div>
      </div>
      {failed && (
        <p role="alert" className="text-sm text-[var(--fanous-color-error-text)]">
          {cs.unavailable}
        </p>
      )}

      {titlesOn && settings && (
        <div className="space-y-1">
          <label className="flex min-h-11 items-start gap-3 text-sm font-medium text-[var(--fanous-color-text-primary)]">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[var(--fanous-color-primary)]" checked={settings.viewerTitles} disabled={savingTitles} onChange={(e) => void toggleTitles(e.target.checked)} aria-describedby={`${ids}-titles-hint`} data-testid="channel-viewer-titles" />
            <span>{cs.viewerTitles}</span>
          </label>
          <p id={`${ids}-titles-hint`} className={`${MUTED} ps-8`}>
            {cs.viewerTitlesHint}
          </p>
          {titleNote && (
            <p role={titleNote.error ? 'alert' : 'status'} className={`ps-8 text-xs ${titleNote.error ? 'text-[var(--fanous-color-error-text)]' : 'text-[var(--fanous-color-text-secondary)]'}`}>
              {titleNote.text}
            </p>
          )}
        </div>
      )}

      {quranOn && rows && (
        <div className={`space-y-3 ${titlesOn ? 'border-t border-[var(--fanous-color-divider)] pt-4' : ''}`}>
          <div className="flex items-start gap-2">
            <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-[var(--fanous-color-text-secondary)]" aria-hidden="true" />
            <div>
              <h3 className="text-sm font-semibold text-[var(--fanous-color-text-primary)]">{cs.quranTitle}</h3>
              <p className={MUTED}>{cs.quranHint}</p>
            </div>
          </div>
          <ul className="space-y-3">
            {shown.map((row) => (
              <EditionRow key={row.language} channelId={channelId} row={row} onChange={(next) => setRows(next.filter((e) => e.language !== 'ar'))} />
            ))}
          </ul>
          {addable.length > 0 && (
            <div className="max-w-xs">
              <label htmlFor={`${ids}-add`} className="mb-1 block text-xs font-medium text-[var(--fanous-color-text-secondary)]">
                {cs.addLanguage}
              </label>
              <select
                id={`${ids}-add`}
                className={SELECT}
                value=""
                onChange={(e) => {
                  const code = e.target.value;
                  if (code) setAdded((list) => [...list, code]);
                }}
                data-testid="channel-quran-add"
              >
                <option value="">{cs.language}</option>
                {addable.map((l) => (
                  <option key={l.code} value={l.code}>
                    {lang === 'ar' ? l.nameAr : l.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default ChannelTranslationSettings;
