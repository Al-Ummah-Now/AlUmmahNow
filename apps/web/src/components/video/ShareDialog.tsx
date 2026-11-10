'use client';

/**
 * Watch page share dialog (spec 25.1, docs/embeds/README.md §4):
 * copy link, optionally at the current time, social targets / device share
 * sheet, and the embed code in the standard sizes or responsive.
 */

import { useCallback, useMemo, useState } from 'react';
import { Check, Copy, Share2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { logger } from '@/lib/logger-client';
import { embedStrings, fill } from '@/lib/embed/strings';
import {
  EMBED_SIZES,
  embedUrl,
  formatTimestamp,
  iframeSnippet,
  responsiveSnippet,
  shareTargets,
  watchPageUrl,
} from '@/lib/embed/snippets';

export interface ShareDialogProps {
  videoId: string;
  title: string;
  lang: 'en' | 'ar';
  /** Current playback position in seconds (read when the dialog opens) */
  getCurrentTime: () => number;
}

type SizeChoice = number | 'responsive';

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) {
    logger.debug('[ShareDialog] Clipboard API failed, using fallback', { error });
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch (error) {
    logger.warn('[ShareDialog] Copy failed', { error });
    return false;
  }
}

export default function ShareDialog({ videoId, title, lang, getCurrentTime }: ShareDialogProps) {
  const s = embedStrings(lang);
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState(0);
  const [atTime, setAtTime] = useState(false);
  const [size, setSize] = useState<SizeChoice>(0);
  const [copied, setCopied] = useState<'link' | 'embed' | null>(null);

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const start = atTime && time >= 1 ? Math.floor(time) : 0;
  const link = origin ? watchPageUrl(origin, lang, videoId, start) : '';
  const snippet = useMemo(() => {
    if (!origin) return '';
    const src = embedUrl(origin, 'video', videoId, { start, lang });
    return size === 'responsive'
      ? responsiveSnippet(src, title || s.playerFrameTitle)
      : iframeSnippet(src, EMBED_SIZES[size], title || s.playerFrameTitle);
  }, [origin, videoId, start, lang, size, title, s.playerFrameTitle]);

  const onOpenChange = (next: boolean) => {
    if (next) {
      const current = getCurrentTime();
      setTime(Number.isFinite(current) ? current : 0);
      setCopied(null);
    }
    setOpen(next);
  };

  const copy = useCallback(async (what: 'link' | 'embed') => {
    const ok = await copyText(what === 'link' ? link : snippet);
    if (ok) setCopied(what);
  }, [link, snippet]);

  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          data-testid="share-button"
          title={s.share}
          className="inline-flex items-center gap-2 px-4 py-2 border dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors dark:text-white"
        >
          <Share2 size={20} aria-hidden="true" />
          <span className="wa-label">{s.share}</span>
        </button>
      </DialogTrigger>
      <DialogContent dir={lang === 'ar' ? 'rtl' : 'ltr'} className="max-w-lg" data-testid="share-dialog">
        <DialogHeader>
          <DialogTitle>{s.shareTitle}</DialogTitle>
          <DialogDescription className="truncate">{title}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="space-y-2">
            <div className="flex gap-2">
              <input
                readOnly
                value={link}
                dir="ltr"
                aria-label={s.copyLink}
                data-testid="share-link"
                className="min-w-0 flex-1 rounded border px-2 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                type="button"
                onClick={() => copy('link')}
                data-testid="share-copy-link"
                className="inline-flex items-center gap-1 rounded bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-600"
              >
                {copied === 'link' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                <span>{copied === 'link' ? s.copied : s.copyLink}</span>
              </button>
            </div>
            {time >= 1 && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={atTime}
                  onChange={(e) => setAtTime(e.currentTarget.checked)}
                  data-testid="share-at-time"
                />
                <span>{fill(s.startAt, { time: formatTimestamp(time) })}</span>
              </label>
            )}
          </section>

          <section aria-label={s.shareVia}>
            <ul className="flex flex-wrap gap-2">
              {shareTargets(link, title).map((target) => (
                <li key={target.id}>
                  <a
                    href={target.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block rounded-full border px-3 py-1 text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
                  >
                    {s[target.id]}
                  </a>
                </li>
              ))}
              {canNativeShare && (
                <li>
                  <button
                    type="button"
                    onClick={() => navigator.share({ title, url: link }).catch(() => undefined)}
                    className="rounded-full border px-3 py-1 text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
                  >
                    {s.moreOptions}
                  </button>
                </li>
              )}
            </ul>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{s.embed}</h3>
            <fieldset className="flex flex-wrap gap-3 text-sm">
              <legend className="sr-only">{s.size}</legend>
              {EMBED_SIZES.map((option, i) => (
                <label key={option.width} className="flex items-center gap-1">
                  <input type="radio" name="embed-size" checked={size === i} onChange={() => setSize(i)} />
                  <span dir="ltr">{option.width}×{option.height}</span>
                </label>
              ))}
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="embed-size"
                  checked={size === 'responsive'}
                  onChange={() => setSize('responsive')}
                  data-testid="share-size-responsive"
                />
                <span>{s.responsive}</span>
              </label>
            </fieldset>
            <textarea
              readOnly
              value={snippet}
              dir="ltr"
              rows={4}
              aria-label={s.embed}
              data-testid="share-embed-code"
              className="w-full rounded border p-2 font-mono text-xs dark:border-gray-600 dark:bg-gray-800"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              onClick={() => copy('embed')}
              data-testid="share-copy-embed"
              className="inline-flex items-center gap-1 rounded border px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
            >
              {copied === 'embed' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
              <span>{copied === 'embed' ? s.copied : s.copyEmbed}</span>
            </button>
          </section>
          <p className="sr-only" role="status" aria-live="polite">{copied ? s.copied : ''}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
