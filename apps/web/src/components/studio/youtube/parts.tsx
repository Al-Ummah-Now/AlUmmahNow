'use client';

/**
 * Pieces shared by the Move from YouTube steps: the step header (focus lands
 * on its heading when the step changes), the stepper, the video thumbnail and
 * the visibility badge.
 */
import { forwardRef, type ReactNode } from 'react';
import { Check, Clock, Globe, Link2, Lock } from 'lucide-react';
import { formatDate as formatLocaleDate, formatInteger, type VideoVisibility, type YtImportItem } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { formatDuration, WIZARD_STEPS, type WizardStep } from '@/lib/youtube-import/wizard';

export const StepHeading = forwardRef<HTMLHeadingElement, { children: ReactNode; body?: ReactNode; testId?: string }>(function StepHeading({ children, body, testId }, ref) {
  return (
    <div className="mb-5">
      <h2 ref={ref} tabIndex={-1} className="text-xl font-semibold tracking-tight text-foreground outline-none sm:text-2xl" data-testid={testId}>
        {children}
      </h2>
      {body && <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">{body}</p>}
    </div>
  );
});

export function Stepper({ step }: { step: WizardStep }) {
  const { t, lang } = useLanguage();
  const fill = useFill();
  const text = t.studio.youtube.steps;
  const index = WIZARD_STEPS.indexOf(step);
  const label = (i: number, name: string) => fill(text.current, { n: i + 1, total: WIZARD_STEPS.length, name });
  return (
    <nav aria-label={text.label} className="yt-stepper mb-6" data-testid="yt-stepper">
      <p className="mb-2 text-xs font-medium text-muted-foreground sm:hidden" aria-hidden="true">
        {label(index, text[step])}
      </p>
      <ol className="flex items-center gap-1.5 sm:gap-2">
        {WIZARD_STEPS.map((id, i) => {
          const state = i < index ? 'done' : i === index ? 'current' : 'todo';
          return (
            <li key={id} className="yt-step flex min-w-0 flex-1 items-center gap-2" data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
              <span className="yt-step-dot" aria-hidden="true">{state === 'done' ? <Check className="h-3.5 w-3.5" /> : num(lang, i + 1)}</span>
              <span className={`hidden truncate text-sm sm:inline ${state === 'current' ? 'font-semibold text-foreground' : 'text-muted-foreground'}`} aria-hidden="true">
                {text[id]}
              </span>
              <span className="sr-only">{label(i, text[id])}</span>
              {i < WIZARD_STEPS.length - 1 && <span className="yt-step-line" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function Thumb({ item, className = '' }: { item: Pick<YtImportItem, 'thumbnailUrl' | 'durationSeconds'>; className?: string }) {
  const { lang } = useLanguage();
  const duration = formatDuration(item.durationSeconds, lang);
  return (
    <span className={`yt-thumb relative block aspect-video shrink-0 overflow-hidden rounded-md ${className}`}>
      {item.thumbnailUrl ? (
        // A YouTube thumbnail (i.ytimg.com): next/image would need the host configured; a plain img is enough here
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.thumbnailUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : null}
      {duration && (
        <span className="absolute bottom-1 end-1 rounded bg-[var(--fanous-color-surface)] px-1 py-px text-[11px] font-medium tabular-nums text-[var(--fanous-color-text-primary)]" dir="ltr">
          {duration}
        </span>
      )}
    </span>
  );
}

const VIS_ICON: Record<VideoVisibility, typeof Globe> = { public: Globe, unlisted: Link2, private: Lock };

export function VisibilityBadge({ visibility, scheduled }: { visibility: VideoVisibility; scheduled?: boolean }) {
  const { t } = useLanguage();
  const text = t.studio.youtube.visibility;
  const Icon = scheduled ? Clock : VIS_ICON[visibility] ?? Lock;
  return (
    <span className="yt-vis inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium" data-vis={scheduled ? 'scheduled' : visibility}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {scheduled ? text.scheduled : text[visibility] ?? visibility}
    </span>
  );
}

export function formatDate(value: string | null | undefined, locale: string): string {
  if (!value) return '';
  if (Number.isNaN(new Date(value).getTime())) return '';
  // The page's digits: ٠–٩ in Arabic
  return formatLocaleDate(locale === 'ar' ? 'ar' : 'en', value);
}

/** Fills {name} placeholders; numbers are written in the page's digits (٠–٩ in Arabic). */
export const fillIn =
  (locale: string) =>
  (template: string, values: Record<string, string | number>): string =>
    Object.entries(values).reduce((s, [k, v]) => s.split(`{${k}}`).join(typeof v === 'number' ? formatInteger(locale === 'ar' ? 'ar' : 'en', v) : String(v)), template);

/** fillIn for the page's language. */
export function useFill() {
  const { lang } = useLanguage();
  return fillIn(lang);
}

/** A whole number in the page's digits. */
export const num = (locale: string, n: number) => formatInteger(locale === 'ar' ? 'ar' : 'en', n);
