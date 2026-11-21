/**
 * The designed non-data states of a read-only admin panel (Web vitals, Abuse): set-up needed, could
 * not load (with the reason, the Errors page reference and Try again), and nothing measured yet.
 * Server component; takes already-translated strings so it stays i18n-agnostic.
 */
import { errorsHref } from '@/app/(protected)/errors/filters';
import { linkClass, primaryButtonClass, secondaryButtonClass } from './ui';

type Tone = 'setup' | 'problem' | 'empty';

const TONE: Record<Tone, { ring: string; icon: string }> = {
  setup: { ring: 'bg-chip-pending-bg text-chip-pending-fg', icon: 'M12 8v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z' },
  problem: { ring: 'bg-danger-bg text-danger-fg', icon: 'M12 8v4m0 4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z' },
  // A gauge with its needle at rest: nothing measured yet
  empty: { ring: 'bg-surface-2 text-fg-muted', icon: 'M4.9 19.1A10 10 0 1 1 19.1 19.1M12 12 8 8m4 4h.01' },
};

export interface PanelStateProps {
  tone: Tone;
  title: string;
  body: string;
  /** Second paragraph (the reason's fix, or why stage/QA stay empty) */
  note?: string;
  /** The Errors page item: "Reference" + the ERR-… code, and a link to it */
  reference?: { label: string; ref: string; linkLabel: string };
  /** Main action: Try again (a link back to this view) or a wider filter */
  action?: { label: string; href: string };
  secondary?: { label: string; href: string };
  testId: string;
  /** Machine-readable reason for tests (data-reason) */
  reason?: string;
}

export function PanelState({ tone, title, body, note, reference, action, secondary, testId, reason }: PanelStateProps) {
  const t = TONE[tone];
  return (
    <section
      role={tone === 'empty' ? 'status' : 'alert'}
      aria-labelledby={`${testId}-title`}
      data-testid={testId}
      data-reason={reason}
      className="bg-surface border border-border rounded-lg px-6 py-10 sm:px-10 flex flex-col items-center text-center gap-4 mb-6"
    >
      <span className={`inline-flex items-center justify-center w-14 h-14 rounded-full ${t.ring}`} aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d={t.icon} />
        </svg>
      </span>
      <h2 id={`${testId}-title`} className="text-xl font-semibold text-fg max-w-xl">
        {title}
      </h2>
      <p className="text-fg-muted max-w-xl">{body}</p>
      {note && <p className="text-sm text-fg max-w-xl bg-surface-2 border border-border rounded px-4 py-3" data-testid={`${testId}-note`}>{note}</p>}
      {(action || secondary) && (
        <div className="flex flex-wrap justify-center gap-3 mt-2">
          {action && (
            <a href={action.href} className={primaryButtonClass} data-testid={`${testId}-action`}>
              {action.label}
            </a>
          )}
          {secondary && (
            <a href={secondary.href} className={secondaryButtonClass}>
              {secondary.label}
            </a>
          )}
        </div>
      )}
      {reference && (
        <div className="flex flex-col items-center gap-1 text-sm text-fg-muted" data-testid={`${testId}-ref`}>
          <span>
            {reference.label}{' '}
            <code dir="ltr" className="font-mono text-fg">{reference.ref}</code>
          </span>
          <a href={errorsHref({ q: reference.ref })} className={linkClass}>
            {reference.linkLabel}
          </a>
        </div>
      )}
    </section>
  );
}
