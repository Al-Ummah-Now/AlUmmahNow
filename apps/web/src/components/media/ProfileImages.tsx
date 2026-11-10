"use client";
/**
 * Cover and avatar images for profiles and channels, shown and edited.
 *
 * Real <img> elements, not CSS background images: the site theme restyles
 * page blocks with `background: … !important` shorthands, which reset an inline
 * `background-image` (that is how the profile cover disappeared in the
 * redesign). An <img> is content, so no theme rule can blank it, and tests can
 * check that it actually loaded (naturalWidth > 0).
 */
import React, { useEffect, useState } from 'react';
import { Camera, Trash2 } from 'lucide-react';

/**
 * Stored image URLs as the page should load them: empty/whitespace means none,
 * and a doubled slash after the host (old uploads saved `host//key`) is
 * collapsed so it matches the canonical URL.
 */
export function normalizeImageUrl(url: string | null | undefined): string | undefined {
  const trimmed = url?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^(https?:\/\/[^/]+)\/{2,}/i, '$1/');
}

/** An <img> that disappears (leaving the placeholder behind it) when it fails to load. */
function FillImage({ src, alt, className, testId }: { src?: string; alt: string; className: string; testId?: string }) {
  const url = normalizeImageUrl(src);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (!url || failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- user uploads from the image host; no optimiser in front of them
    <img
      src={url}
      alt={alt}
      data-testid={testId}
      className={className}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

/** Cover photo filling its (positioned) parent; nothing when there is none. */
export function CoverImage({ src, alt, testId }: { src?: string; alt: string; testId?: string }) {
  return <FillImage src={src} alt={alt} testId={testId} className="absolute inset-0 h-full w-full object-cover" />;
}

/** Avatar filling its (positioned, rounded) parent; falls back to the default avatar. */
export function AvatarImage({ src, alt, testId, fallback = '/avatar.png' }: { src?: string; alt: string; testId?: string; fallback?: string | null }) {
  const url = normalizeImageUrl(src) ?? fallback ?? undefined;
  return <FillImage src={url} alt={alt} testId={testId} className="absolute inset-0 h-full w-full rounded-full object-cover" />;
}

interface EditableCoverProps {
  url?: string;
  alt: string;
  /** Opens the file picker */
  onPick: () => void;
  /** Clears the cover; the Remove button only shows when there is one */
  onRemove?: () => void;
  labels: { pick: string; change: string; remove: string };
  testId: string;
  imageTestId: string;
  busy?: boolean;
  className?: string;
  /** Rendered inside the cover (the hidden <input type=file>, the avatar) */
  children?: React.ReactNode;
}

/**
 * Edit-form cover: the current cover as a preview, with Change and Remove on top.
 * The whole area opens the picker (mouse and keyboard); Remove stops that.
 */
export function EditableCover({ url, alt, onPick, onRemove, labels, testId, imageTestId, busy, className = '', children }: EditableCoverProps) {
  const hasImage = !!normalizeImageUrl(url);
  return (
    <div
      className={`media-cover relative overflow-hidden cursor-pointer ${className}`}
      role="button"
      tabIndex={0}
      aria-label={labels.pick}
      aria-busy={busy || undefined}
      data-testid={testId}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPick();
        }
      }}
    >
      {/* Wrappers carry the position: themed buttons are position:relative */}
      <div className="absolute top-3 end-3 z-[2] flex flex-wrap justify-end gap-2">
        <button type="button" tabIndex={-1} className="b b-secondary b-sm" onClick={(e) => { e.stopPropagation(); onPick(); }}>
          <Camera aria-hidden="true" />
          {hasImage ? labels.change : labels.pick}
        </button>
        {hasImage && onRemove && (
          <button
            type="button"
            className="b b-secondary b-sm"
            data-testid={`${testId}-remove`}
            disabled={busy}
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
          >
            <Trash2 aria-hidden="true" />
            {labels.remove}
          </button>
        )}
      </div>
      <CoverImage src={url} alt={alt} testId={imageTestId} />
      {children}
    </div>
  );
}

interface EditableAvatarProps {
  url?: string;
  alt: string;
  onPick: () => void;
  onRemove?: () => void;
  labels: { pick: string; change: string; remove: string };
  testId: string;
  imageTestId: string;
  busy?: boolean;
  /** Placeholder when there is no avatar (initial, default image) */
  placeholder?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

/**
 * Edit-form avatar: the current photo unobstructed (a small camera badge on the
 * rim, not an overlay across the face), with Change/Remove buttons beside it.
 */
export function EditableAvatar({ url, alt, onPick, onRemove, labels, testId, imageTestId, busy, placeholder, className = '', children }: EditableAvatarProps) {
  const hasImage = !!normalizeImageUrl(url);
  return (
    <div className={`media-avatar-row flex flex-col items-start gap-3 sm:flex-row sm:items-end ${className}`}>
      <div
        className="media-avatar relative h-24 w-24 shrink-0 cursor-pointer rounded-full border-4 border-[var(--fanous-color-surface)] shadow-lg"
        role="button"
        tabIndex={0}
        aria-label={labels.pick}
        aria-busy={busy || undefined}
        data-testid={testId}
        onClick={onPick}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onPick();
          }
        }}
      >
        <div className="absolute inset-0 overflow-hidden rounded-full bg-[var(--fanous-color-surface-raised)]">
          {!hasImage && placeholder}
          {hasImage && <AvatarImage src={url} alt={alt} testId={imageTestId} fallback={null} />}
        </div>
        <span
          aria-hidden="true"
          className="media-avatar-badge absolute bottom-0 end-0 flex h-8 w-8 items-center justify-center rounded-full border-2 border-[var(--fanous-color-surface)] bg-[var(--fanous-c-button-primary-bg)] text-[var(--fanous-c-button-primary-text)] shadow"
        >
          <Camera className="h-4 w-4" />
        </span>
        {children}
      </div>
      <div className="flex flex-wrap gap-2 sm:mb-1">
        <button type="button" className="b b-secondary b-sm" data-testid={`${testId}-change`} onClick={onPick} disabled={busy}>
          <Camera aria-hidden="true" />
          {hasImage ? labels.change : labels.pick}
        </button>
        {hasImage && onRemove && (
          <button type="button" className="b b-secondary b-sm" data-testid={`${testId}-remove`} onClick={onRemove} disabled={busy}>
            <Trash2 aria-hidden="true" />
            {labels.remove}
          </button>
        )}
      </div>
    </div>
  );
}
