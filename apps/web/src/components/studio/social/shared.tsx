'use client';

/** Small pieces the Studio → Social sections share. */
import { useCallback, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import type { SocialNetwork } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** A number in the page's digits: Eastern Arabic ٠–٩ in Arabic (explicit numbering system, never implicit `ar`). */
export const formatCount = (value: number, locale: string) => new Intl.NumberFormat(locale === 'ar' ? 'ar-u-nu-arab' : 'en-u-nu-latn').format(value);

/** `{name}` placeholders; numbers are written in the locale's digits when `locale` is given. */
export const fill = (text: string, values: Record<string, string | number>, locale?: string) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => {
    if (!(k in values)) return m;
    const v = values[k]!;
    return typeof v === 'number' && locale ? formatCount(v, locale) : String(v);
  });

/** A section card: heading, intro, body. */
export function Section({ id, title, intro, children, testId, action }: { id: string; title: string; intro?: string; children: ReactNode; testId?: string; action?: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-h`} className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6" data-testid={testId}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 id={`${id}-h`} className="text-lg font-semibold">{title}</h2>
          {intro ? <p className="max-w-prose text-sm text-[var(--fanous-color-text-secondary)]">{intro}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

const MONOGRAM: Record<SocialNetwork, string> = { x: 'X', telegram: 'TG', bluesky: 'BS', mastodon: 'M' };

/** The network's mark: a monogram on a tinted tile (no third-party logos). */
export function NetworkMark({ network, className }: { network: SocialNetwork; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-network={network}
      className={cn(
        'social-mark inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-[var(--fanous-color-surface-raised)] text-sm font-bold tracking-tight text-foreground',
        className,
      )}
    >
      {MONOGRAM[network]}
    </span>
  );
}

/** A copy button that says "Copied" for a moment. */
export function CopyButton({ value, label, copiedLabel, testId, size = 'sm', variant = 'outline' }: { value: string; label: string; copiedLabel: string; testId?: string; size?: 'sm' | 'default'; variant?: 'outline' | 'secondary' | 'ghost' }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [value]);
  return (
    <Button type="button" size={size} variant={variant} onClick={copy} data-testid={testId} className="min-h-11 gap-2 sm:min-h-9">
      {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
      <span aria-live="polite">{copied ? copiedLabel : label}</span>
    </Button>
  );
}

/** A status pill. */
export function Pill({ tone, children, testId }: { tone: 'ok' | 'warn' | 'error' | 'muted'; children: ReactNode; testId?: string }) {
  const tones = {
    // Theme tokens checked for WCAG AA in every theme (pnpm check:tokens)
    ok: 'border-current text-[var(--fanous-color-success-text)]',
    warn: 'border-current text-[var(--fanous-color-text-primary)] bg-[var(--fanous-color-surface-raised)]',
    error: 'border-current text-[var(--fanous-color-error-text)]',
    muted: 'border-border text-[var(--fanous-color-text-secondary)]',
  } as const;
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium', tones[tone])} data-testid={testId}>
      {children}
    </span>
  );
}

/** A notice line under a section (role=status so screen readers hear it). */
export function Notice({ tone, children }: { tone: 'ok' | 'error'; children: ReactNode }) {
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={cn('rounded-md border px-3 py-2 text-sm', tone === 'error' ? 'border-current text-[var(--fanous-color-error-text)]' : 'border-border text-[var(--fanous-color-text-primary)]')}>
      {children}
    </p>
  );
}
