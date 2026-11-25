'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from '@/components/common/AppLink';
import { FileCheck2, ExternalLink } from 'lucide-react';
import { CREATOR_ERROR_CODES, CURRENT_CREATOR_TERMS_VERSION } from '@al-ummah/shared-types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLanguage } from '@/hooks/useLanguage';
import { acceptCreatorTerms, useCreatorAccess } from '@/hooks/useCreatorAccess';
import { getWwwUrl } from '@/lib/runtime-config';

const DEFAULT_WWW_ORIGIN = 'https://www.alummahnow.net';

interface CreatorTermsGateProps {
  /** Compact inline mode for embedding inside dialogs or dropdowns. */
  compact?: boolean;
  /** Inside a dialog with its own close button: the title leaves it room. */
  inDialog?: boolean;
  /** Version displayed to the creator (defaults to server-reported version or CURRENT_CREATOR_TERMS_VERSION). */
  termsVersion?: string;
  /** Focus the terms link on mount (used when rendered inline in a menu after a button unmounts). */
  autoFocus?: boolean;
  onAccepted?: () => void;
  onCancel?: () => void;
}

/**
 * Terms of Service and Community Guidelines agreement shown once per account
 * before the first upload or channel creation (Play UGC policy, AlUmmahNowAndroid#65).
 */
export const CreatorTermsGate: React.FC<CreatorTermsGateProps> = ({
  compact = false,
  inDialog = false,
  termsVersion,
  autoFocus = false,
  onAccepted,
  onCancel,
}) => {
  const { t, lang, dir } = useLanguage();
  const creator = useCreatorAccess();
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const termsLinkRef = useRef<HTMLAnchorElement | null>(null);

  // Pin the version shown at mount so a background focus refresh cannot silently
  // swap versions while the checkbox is already ticked.
  const liveVersion = termsVersion ?? (creator.status === 'ready' ? creator.access.termsVersion : undefined);
  const [shownVersion, setShownVersion] = useState<string>(() => liveVersion ?? CURRENT_CREATOR_TERMS_VERSION);

  useEffect(() => {
    if (!liveVersion || liveVersion === shownVersion) return;
    setShownVersion(liveVersion);
    setChecked(false);
    setError(t.upload.termsGateVersionChanged);
  }, [liveVersion, shownVersion, t.upload.termsGateVersionChanged]);

  useEffect(() => {
    if (autoFocus) termsLinkRef.current?.focus();
  }, [autoFocus]);

  const wwwOrigin = (getWwwUrl() || DEFAULT_WWW_ORIGIN).replace(/\/$/, '');
  const termsUrl = `${wwwOrigin}/${lang === 'ar' ? 'ar' : 'en'}/terms/`;
  const guidelinesHref = `/${lang === 'ar' ? 'ar' : 'en'}/community-guidelines`;

  const handleAgree = async () => {
    if (!checked || saving) return;
    setSaving(true);
    setError(null);
    const result = await acceptCreatorTerms(shownVersion);
    setSaving(false);
    if (result.ok) {
      onAccepted?.();
    } else if (result.code === CREATOR_ERROR_CODES.termsVersionChanged) {
      if (result.currentVersion) setShownVersion(result.currentVersion);
      setChecked(false);
      setError(t.upload.termsGateVersionChanged);
    } else {
      setError(t.upload.termsGateError);
    }
  };

  const inner = (
    <div
      dir={dir}
      className={
        compact
          ? 'space-y-4 rounded-xl border border-[var(--fanous-color-outline)] bg-[var(--fanous-color-surface)] p-4 text-start'
          : 'mx-auto max-w-2xl rounded-2xl border border-[var(--fanous-color-outline)] bg-[var(--fanous-color-surface)] p-6 md:p-8 shadow-lg text-start'
      }
      data-testid="creator-terms-gate"
    >
      <div className={`flex items-start gap-3 ${inDialog ? 'pe-8' : ''}`}>
        <FileCheck2 className="mt-0.5 h-6 w-6 flex-shrink-0 text-[var(--fanous-color-accent)]" aria-hidden="true" />
        <div className="space-y-2">
          <h2 className={compact ? 'text-base font-semibold text-[var(--fanous-color-text-primary)]' : 'text-2xl font-bold text-[var(--fanous-color-text-primary)]'}>
            {t.upload.termsGateTitle}
          </h2>
          <p className="text-sm leading-relaxed text-[var(--fanous-color-text-secondary)]">
            {t.upload.termsGateBody}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <a
          ref={termsLinkRef}
          href={termsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--fanous-color-outline)] px-3 py-2 text-sm font-medium text-[var(--fanous-color-text-primary)] hover:border-[var(--fanous-color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fanous-color-accent)]"
          data-testid="creator-terms-link"
        >
          {t.upload.termsGateTermsLink}
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
        <Link
          href={guidelinesHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--fanous-color-outline)] px-3 py-2 text-sm font-medium text-[var(--fanous-color-text-primary)] hover:border-[var(--fanous-color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fanous-color-accent)]"
          data-testid="creator-guidelines-link"
        >
          {t.upload.termsGateGuidelinesLink}
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>

      <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm text-[var(--fanous-color-text-primary)]">
        <input
          type="checkbox"
          checked={checked}
          disabled={saving}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-[var(--fanous-color-outline)] accent-[var(--fanous-color-accent)]"
          data-testid="creator-terms-checkbox"
        />
        <span>{t.upload.termsGateCheckbox}</span>
      </label>

      {error && (
        <p className="mt-3 text-sm text-[var(--fanous-color-error-text)]" role="alert" data-testid="creator-terms-error">
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="b b-ghost !w-auto !h-auto !px-4 whitespace-nowrap"
            data-testid="creator-terms-cancel"
          >
            {t.common.cancel}
          </button>
        )}
        <button
          type="button"
          onClick={() => { void handleAgree(); }}
          disabled={!checked || saving}
          aria-busy={saving}
          className={
            saving
              ? 'b b-primary !opacity-100 !w-auto !h-auto !px-4 whitespace-nowrap cursor-wait'
              : !checked
                ? 'b b-secondary !opacity-100 !w-auto !h-auto !px-4 whitespace-nowrap !border-[var(--fanous-color-outline)] cursor-not-allowed'
                : 'b b-primary !w-auto !h-auto !px-4 whitespace-nowrap'
          }
          data-testid="creator-terms-agree"
        >
          {saving ? t.upload.termsGateWorking : t.upload.termsGateAgree}
        </button>
      </div>
    </div>
  );

  if (compact) return inner;

  return (
    <main className="flex min-h-screen w-full flex-col justify-center bg-background p-4 md:p-6 lg:p-8">
      {inner}
    </main>
  );
};

interface CreatorTermsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccepted?: () => void;
}

/** Accessible modal wrapper (accessible title, focus trap, Escape) so opening the Terms gate preserves form state underneath. */
export const CreatorTermsDialog: React.FC<CreatorTermsDialogProps> = ({ open, onOpenChange, onAccepted }) => {
  const { t, dir } = useLanguage();
  if (!open) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir={dir}
        className="w-[calc(100vw-2rem)] sm:max-w-lg p-0 border-0 bg-transparent shadow-none"
        data-testid="creator-terms-modal"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t.upload?.termsGateTitle ?? ''}</DialogTitle>
        </DialogHeader>
        <CreatorTermsGate
          compact
          inDialog
          onCancel={() => onOpenChange(false)}
          onAccepted={() => {
            onOpenChange(false);
            onAccepted?.();
          }}
        />
      </DialogContent>
    </Dialog>
  );
};
