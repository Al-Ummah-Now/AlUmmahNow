'use client';

/**
 * One Quran span in the caption editor. A span is a reference, never ASR text:
 * - accepted: shows the official text from our Quran Foundation copy (what viewers see);
 * - a suggestion: shows only the reference and a quran.com link, with Confirm / Not Quran /
 *   Different reference. What speech-to-text heard is never shown.
 */
import React, { useEffect, useId, useState } from 'react';
import { BookOpen, Check, ExternalLink, Loader2, X } from 'lucide-react';
import { parseQuranRange, quranAyahLabel, quranComUrl, type CaptionQuranSegment } from '@al-ummah/shared-types';
import type { CaptionsTranslations } from '@al-ummah/shared-types';
import { getQuranPassage, type QuranPassage } from '@/lib/api/caption-drafts';
import { parseShortReference } from './editor-state';

const passages = new Map<string, Promise<QuranPassage | null>>();
function loadPassage(range: string): Promise<QuranPassage | null> {
  let p = passages.get(range);
  if (!p) {
    p = getQuranPassage(range).then((r) => (r.ok ? r.data : null));
    passages.set(range, p);
    // A failure is not cached: the copy may be back later
    p.then((v) => v ?? passages.delete(range));
  }
  return p;
}

const toArabicDigits = (s: string) => s.replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]!);

export interface QuranSpanCardProps {
  segment: CaptionQuranSegment;
  t: CaptionsTranslations['quran'];
  lang: string;
  onAccept: () => void;
  onReject: () => void;
  onRange: (range: string) => void;
}

export default function QuranSpanCard({ segment, t, lang, onAccept, onReject, onRange }: QuranSpanCardProps) {
  const range = parseQuranRange(segment.range);
  const label = range ? quranAyahLabel(range) : segment.range;
  const shownLabel = lang === 'ar' ? toArabicDigits(label) : label;
  const accepted = segment.status === 'accepted';
  const [passage, setPassage] = useState<QuranPassage | null | 'loading'>(accepted ? 'loading' : null);
  const [picking, setPicking] = useState(false);
  const [refInput, setRefInput] = useState('');
  const [refError, setRefError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const inputId = useId();

  useEffect(() => {
    if (!accepted) {
      setPassage(null);
      return;
    }
    let live = true;
    setPassage('loading');
    loadPassage(segment.range).then((p) => live && setPassage(p));
    return () => {
      live = false;
    };
  }, [accepted, segment.range]);

  const status =
    segment.status === 'accepted' ? t.confirmed : segment.status === 'review' ? t.possible : segment.status === 'basmala' ? t.basmala : t.suggested;

  const applyRef = async () => {
    const short = parseShortReference(refInput);
    if (!short) {
      setRefError(t.refInvalid);
      return;
    }
    setChecking(true);
    const res = await getQuranPassage(short);
    setChecking(false);
    if (!res.ok) {
      setRefError(t.refInvalid);
      return;
    }
    setPicking(false);
    setRefInput('');
    setRefError(null);
    onRange(res.data.range);
  };

  return (
    <div
      data-testid="caption-quran-span"
      data-status={segment.status}
      data-range={segment.range}
      className={`rounded-lg border p-3 space-y-2 ${
        accepted ? 'border-[color-mix(in_srgb,var(--fanous-color-success-text)_45%,transparent)] bg-[color-mix(in_srgb,var(--fanous-color-success-text)_7%,var(--color-card))]' : 'border-dashed border-brand-edge bg-brand-soft/40'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-background/80 px-2.5 py-1 text-xs font-semibold text-foreground border border-border">
          <BookOpen className="h-3.5 w-3.5" aria-hidden />
          {t.label} <bdi dir="ltr">{shownLabel}</bdi>
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            accepted ? 'border border-current text-[var(--fanous-color-success-text)]' : segment.status === 'review' ? 'border border-border text-muted-foreground' : 'bg-brand-soft text-brand-ink'
          }`}
        >
          {status}
        </span>
        {range && (
          <a
            href={quranComUrl(range)}
            target="_blank"
            rel="noopener noreferrer"
            className="ms-auto inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline min-h-[32px]"
          >
            {t.checkOnQuranCom}
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        )}
      </div>

      {accepted ? (
        passage === 'loading' ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
        ) : passage ? (
          <figure className="space-y-1">
            <figcaption className="text-xs text-muted-foreground">{t.officialText}</figcaption>
            <blockquote lang="ar" dir="rtl" className="text-lg leading-loose text-foreground">
              ﴿{passage.ayat.map((a) => a.text).join(' ')}﴾
            </blockquote>
            <p className="text-[11px] text-muted-foreground">{t.attribution}</p>
          </figure>
        ) : (
          <p className="text-xs text-muted-foreground">{t.textUnavailable}</p>
        )
      ) : (
        <p className="text-xs text-muted-foreground">{t.unconfirmedHint}</p>
      )}

      {!accepted && segment.alternatives?.length ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>{t.appearsIn.replace('{list}', '')}</span>
          {segment.alternatives.map((alt) => {
            const r = parseQuranRange(alt);
            const l = r ? quranAyahLabel(r) : alt;
            return (
              <button
                key={alt}
                type="button"
                onClick={() => onRange(alt)}
                className="rounded-full border border-border bg-background px-2 py-1 font-medium text-foreground hover:bg-muted min-h-[32px]"
              >
                <bdi dir="ltr">{lang === 'ar' ? toArabicDigits(l) : l}</bdi>
              </button>
            );
          })}
        </div>
      ) : null}

      {picking ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={inputId} className="text-xs font-medium text-foreground">
              {t.refLabel}
            </label>
            <input
              id={inputId}
              value={refInput}
              onChange={(e) => {
                setRefInput(e.target.value);
                setRefError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void applyRef();
                }
                if (e.key === 'Escape') setPicking(false);
              }}
              placeholder={t.refPlaceholder}
              aria-invalid={!!refError}
              aria-describedby={refError ? `${inputId}-err` : undefined}
              dir="ltr"
              autoFocus
              className="h-9 w-40 rounded-md border border-border bg-background px-2 text-sm text-foreground"
            />
          </div>
          <button type="button" onClick={() => void applyRef()} disabled={checking} className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {checking ? t.refChecking : t.applyRef}
          </button>
          <button type="button" onClick={() => setPicking(false)} className="h-9 rounded-md border border-border px-3 text-sm text-foreground">
            {t.cancel}
          </button>
          {refError && (
            <p id={`${inputId}-err`} role="alert" className="basis-full text-xs text-[var(--fanous-color-error-text)]">
              {refError}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {!accepted && (
            <button
              type="button"
              data-testid="caption-quran-accept"
              onClick={onAccept}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand px-3 text-sm font-medium text-on-brand hover:bg-brand-hover"
            >
              <Check className="h-4 w-4" aria-hidden />
              {t.accept}
            </button>
          )}
          <button
            type="button"
            data-testid="caption-quran-reject"
            onClick={onReject}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm text-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" aria-hidden />
            {t.notQuran}
          </button>
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="inline-flex h-9 items-center rounded-md border border-border bg-background px-3 text-sm text-foreground hover:bg-muted"
          >
            {t.changeRef}
          </button>
        </div>
      )}
    </div>
  );
}
