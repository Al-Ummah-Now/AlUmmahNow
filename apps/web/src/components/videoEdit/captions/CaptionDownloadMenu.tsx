'use client';

/**
 * "Download captions" in Studio (AUN-CAPTIONS, QF 2026-11-22): one language of one video, as WebVTT
 * or SubRip, for the published track or a caption draft. A menu button (Radix: Enter/Space/↓ opens
 * it, arrows move, Enter picks, Esc closes); the file is fetched with the creator's session and saved
 * under the API's attachment name (caption-download.ts). The text is never read or changed here.
 */
import React, { useState } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';
import type { CaptionsTranslations } from '@al-ummah/shared-types';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { reportError } from '@/lib/errors/reporter';
import { CAPTION_DOWNLOAD_FORMATS, downloadCaptionFile, type CaptionDownloadDeps, type CaptionDownloadFormat, type CaptionDownloadSource } from './caption-download';

export interface CaptionDownloadMenuProps {
  videoId: string;
  language: string;
  /** The language's name as the page shows it (in the button's accessible name) */
  languageLabel: string;
  source: CaptionDownloadSource;
  t: CaptionsTranslations['download'];
  /** The trigger's look, matching the row it sits in */
  className?: string;
  /** Tests: fetch and save */
  deps?: CaptionDownloadDeps;
}

export default function CaptionDownloadMenu({ videoId, language, languageLabel, source, t, className, deps }: CaptionDownloadMenuProps) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const run = async (format: CaptionDownloadFormat) => {
    setBusy(true);
    setFailed(false);
    const result = await downloadCaptionFile({ videoId, language, format, source }, deps);
    setBusy(false);
    if (result.ok) return;
    setFailed(true);
    const status = (result as Extract<typeof result, { ok: false }>).status;
    if (status === 0 || status >= 500) reportError(new Error(`caption download failed: ${status}`), { shown: true, status, extra: { videoId, language, source, format } });
  };

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="caption-download"
            data-source={source}
            disabled={busy}
            aria-label={`${t.action} (${languageLabel})`}
            className={
              className ??
              'inline-flex h-10 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50'
            }
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
            <span className="whitespace-nowrap">{t.action}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[11rem] border-border bg-card text-foreground">
          {CAPTION_DOWNLOAD_FORMATS.map((format) => (
            <DropdownMenuItem key={format} data-testid={`caption-download-${format}`} onSelect={() => void run(format)} className="min-h-10 cursor-pointer">
              <FileText aria-hidden />
              {/* A file format reads left to right in Arabic too: no flipped brackets */}
              <span dir="ltr">{t[format]}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {failed && (
        <span role="alert" data-testid="caption-download-failed" className="text-xs text-[var(--fanous-color-error-text)]" style={{ textWrap: 'balance' }}>
          {t.failed}
        </span>
      )}
    </span>
  );
}
