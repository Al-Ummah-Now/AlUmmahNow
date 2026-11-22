'use client';

/**
 * "Download captions" in Studio (AUN-CAPTIONS, QF 2026-11-22): one language of one video, as WebVTT
 * or SubRip, for the published track or a caption draft.
 *
 * A disclosure, like the drafts' Translate: the button (in the row's actions) opens the format choice
 * inside the same card, below the row, so it never covers the rows around it. The choice takes focus
 * when it opens; Esc closes it and focus goes back to the button. The file is fetched with the
 * creator's session and saved under the API's attachment name (caption-download.ts). The text is
 * never read or changed here.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, Loader2 } from 'lucide-react';
import type { CaptionsTranslations } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { reportError } from '@/lib/errors/reporter';
import { CAPTION_DOWNLOAD_FORMATS, downloadCaptionFile, type CaptionDownloadDeps, type CaptionDownloadFormat, type CaptionDownloadSource } from './caption-download';

type DownloadTranslations = CaptionsTranslations['download'];

/** Element ids of one language's button and its format choice */
export function captionDownloadIds(source: CaptionDownloadSource, language: string) {
  const base = `caption-download-${source}-${language}`;
  return { button: base, formats: `${base}-formats` };
}

export interface CaptionDownloadButtonProps {
  language: string;
  /** The language's name as the page shows it (in the button's accessible name) */
  languageLabel: string;
  source: CaptionDownloadSource;
  expanded: boolean;
  onToggle: () => void;
  t: DownloadTranslations;
  /**
   * The row it sits in: a caption draft row (Studio's square buttons) or a published track row (the
   * track row's outlined buttons, same size as Set Default)
   */
  look?: 'draft' | 'track';
}

export function CaptionDownloadButton({ language, languageLabel, source, expanded, onToggle, t, look = 'draft' }: CaptionDownloadButtonProps) {
  const ids = captionDownloadIds(source, language);
  const common = {
    type: 'button' as const,
    id: ids.button,
    'data-testid': 'caption-download',
    'data-source': source,
    'aria-expanded': expanded,
    'aria-controls': ids.formats,
    'aria-label': `${t.action} (${languageLabel})`,
    title: t.action,
    onClick: onToggle,
  };
  const content = (
    <>
      <Download className="h-4 w-4 shrink-0" aria-hidden />
      {/* Phones: the icon alone keeps a row's actions on one line (the name stays in aria-label and title) */}
      <span className="hidden whitespace-nowrap sm:inline">{t.action}</span>
      {/* Open: the chevron turns and the button looks pressed (aria-expanded) */}
      <ChevronDown className="hidden h-4 w-4 shrink-0 transition-transform group-aria-expanded:rotate-180 sm:inline" aria-hidden />
    </>
  );
  if (look === 'track') {
    return (
      <Button
        {...common}
        variant="outline"
        size="sm"
        className="group h-8 min-w-[44px] gap-1.5 px-3 text-xs md:h-9 md:text-sm aria-expanded:!border-primary aria-expanded:!bg-muted"
      >
        {content}
      </Button>
    );
  }
  return (
    <button
      {...common}
      className="group inline-flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-0 text-sm text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-expanded:border-primary aria-expanded:bg-muted sm:px-3"
    >
      {content}
    </button>
  );
}

export interface CaptionDownloadFormatsProps {
  videoId: string;
  language: string;
  languageLabel: string;
  source: CaptionDownloadSource;
  t: DownloadTranslations;
  /** Closes the choice (Esc, or after a file was saved); focus goes back to the button */
  onClose: () => void;
  /** Tests: fetch and save */
  deps?: CaptionDownloadDeps;
}

export function CaptionDownloadFormats({ videoId, language, languageLabel, source, t, onClose, deps }: CaptionDownloadFormatsProps) {
  const ids = captionDownloadIds(source, language);
  const [busy, setBusy] = useState<CaptionDownloadFormat | null>(null);
  const [failed, setFailed] = useState(false);
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, []);

  const close = () => {
    onClose();
    // After the parent has removed the choice
    setTimeout(() => document.getElementById(ids.button)?.focus(), 0);
  };

  const run = async (format: CaptionDownloadFormat) => {
    setBusy(format);
    setFailed(false);
    const result = await downloadCaptionFile({ videoId, language, format, source }, deps);
    setBusy(null);
    if (result.ok) {
      close();
      return;
    }
    setFailed(true);
    const status = (result as Extract<typeof result, { ok: false }>).status;
    if (status === 0 || status >= 500) reportError(new Error(`caption download failed: ${status}`), { shown: true, status, extra: { videoId, language, source, format } });
  };

  return (
    <div
      id={ids.formats}
      role="group"
      aria-label={`${t.action} (${languageLabel})`}
      data-testid="caption-download-formats"
      data-source={source}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        }
      }}
      className="mt-3 space-y-2 rounded-lg border border-border bg-muted p-3"
    >
      <p className="text-sm text-foreground">{t.choose}</p>
      {/* 12px apart: the focus ring and its halo never touch the other format */}
      <div className="flex flex-wrap gap-3">
        {CAPTION_DOWNLOAD_FORMATS.map((format, i) => (
          <button
            key={format}
            ref={i === 0 ? first : undefined}
            type="button"
            data-testid={`caption-download-${format}`}
            disabled={busy !== null}
            onClick={() => void run(format)}
            className="inline-flex h-10 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm text-foreground hover:bg-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
          >
            {/* No icon of its own (the choice sits under "Download captions"): both fit one phone row */}
            {busy === format && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {/* A file format reads left to right in Arabic too: no flipped brackets */}
            <span dir="ltr">{t[format]}</span>
          </button>
        ))}
      </div>
      {failed && (
        <p role="alert" data-testid="caption-download-failed" className="text-xs text-[var(--fanous-color-error-text)]" style={{ textWrap: 'balance' }}>
          {t.failed}
        </p>
      )}
    </div>
  );
}
