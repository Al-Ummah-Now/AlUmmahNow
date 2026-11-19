'use client';

import { forwardRef, useId } from 'react';
import { Check, Loader2, ShieldCheck } from 'lucide-react';
import type { YtImport } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/common/Switch';
import { useLanguage } from '@/hooks/useLanguage';
import { fillIn, StepHeading } from './parts';

interface Props {
  captionsAvailable: boolean;
  captions: boolean;
  onCaptions: (value: boolean) => void;
  connecting: boolean;
  onConnect: () => void;
  /** An import whose channel is being read (status listing) */
  listing: YtImport | null;
  error: string;
}

export const ConnectStep = forwardRef<HTMLHeadingElement, Props>(function ConnectStep({ captionsAvailable, captions, onCaptions, connecting, onConnect, listing, error }, headingRef) {
  const { t } = useLanguage();
  const text = t.studio.youtube.connect;
  const ids = useId();

  if (listing) {
    return (
      <section className="yt-panel" data-testid="yt-connect-listing" aria-busy="true">
        <StepHeading ref={headingRef} body={text.readingBody}>{text.readingTitle}</StepHeading>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-background/60 p-4">
          {listing.ytChannel?.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={listing.ytChannel.thumbnailUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
          ) : (
            <span className="h-12 w-12 rounded-full bg-muted" aria-hidden="true" />
          )}
          <div className="min-w-0 flex-1">
            {listing.ytChannel && (
              <>
                <p className="text-xs text-muted-foreground">{text.connectedAs}</p>
                <p className="truncate font-medium text-foreground"><bdi>{listing.ytChannel.title}</bdi></p>
              </>
            )}
          </div>
          <Loader2 className="h-5 w-5 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
        </div>
      </section>
    );
  }

  return (
    <section className="yt-panel" data-testid="yt-connect">
      <StepHeading ref={headingRef} body={text.body} testId="yt-step-heading">{text.heading}</StepHeading>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="space-y-5">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-foreground">{text.whatWeRead}</h3>
            <ul className="space-y-2">
              {text.reads.map((line) => (
                <li key={line} className="flex items-start gap-2 text-sm text-foreground">
                  <span className="yt-tick mt-0.5" aria-hidden="true"><Check className="h-3 w-3" /></span>
                  {line}
                </li>
              ))}
            </ul>
          </div>

          {/* Only offered when the captions scope can be used; otherwise there is simply no option */}
          {captionsAvailable && (
            <div className="rounded-lg border border-border bg-background/60 p-4">
              <div className="flex items-start gap-3">
                <Switch
                  id={`${ids}-captions`}
                  checked={captions}
                  onCheckedChange={onCaptions}
                  aria-labelledby={`${ids}-captions-label`}
                  aria-describedby={`${ids}-captions-help`}
                  data-testid="yt-captions"
                />
                <div>
                  <span id={`${ids}-captions-label`} className="text-sm font-medium text-foreground">{text.captionsLabel}</span>
                  <p id={`${ids}-captions-help`} className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{text.captionsHelp}</p>
                </div>
              </div>
            </div>
          )}

          {error && <p role="alert" className="yt-error text-sm" data-testid="yt-connect-error">{error}</p>}

          <Button onClick={onConnect} disabled={connecting} className="yt-cta min-h-11 gap-2 px-5" data-testid="yt-connect-button">
            {connecting ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <YoutubeMark className="h-4 w-4" />}
            {connecting ? text.connecting : error ? text.again : text.button}
          </Button>
        </div>

        <aside className="yt-note flex gap-3 self-start rounded-lg p-4 text-sm leading-relaxed">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>{text.revokeNote}</p>
        </aside>
      </div>
    </section>
  );
});

/** The play-button mark (generic shape, no brand artwork). */
export function YoutubeMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <rect x="2" y="5" width="20" height="14" rx="4" fill="currentColor" opacity="0.9" />
      <path d="M10 9.2v5.6L15 12z" fill="var(--yt-mark-play, var(--fanous-color-surface))" />
    </svg>
  );
}

export function channelCount(template: string, count: number | null | undefined, locale = 'en'): string {
  return count === null || count === undefined ? '' : fillIn(locale)(template, { count });
}
