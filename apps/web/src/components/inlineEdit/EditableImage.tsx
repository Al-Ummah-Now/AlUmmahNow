'use client';

/**
 * Makes a banner or avatar changeable where it is shown. In edit mode the
 * area becomes a button ("Change banner"); picking a file opens the crop
 * dialog, and the cropped image goes to `onUpload` (the existing upload
 * endpoints). The image keeps showing, dimmed, while it uploads.
 */

import React, { useId, useRef, useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import ImageCropDialog from '@/components/ImageCropDialog';
import { cn } from '@/lib/utils';

interface EditableImageProps {
  kind: 'avatar' | 'cover';
  editable: boolean;
  /** Accessible name and visible chip text, e.g. "Change banner" */
  label: string;
  onUpload: (file: File) => Promise<void> | void;
  uploading?: boolean;
  uploadingLabel?: string;
  children: React.ReactNode;
  className?: string;
  /** Show the label next to the camera (banners); avatars show only the icon */
  showLabel?: boolean;
  testId?: string;
}

export function EditableImage({
  kind,
  editable,
  label,
  onUpload,
  uploading = false,
  uploadingLabel,
  children,
  className,
  showLabel = kind === 'cover',
  testId,
}: EditableImageProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [picked, setPicked] = useState<File | null>(null);

  if (!editable) {
    return <div className={className} data-testid={testId}>{children}</div>;
  }

  return (
    <div className={cn('relative group/image', className)} data-testid={testId}>
      {children}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        aria-label={label}
        aria-busy={uploading}
        className={cn(
          'absolute inset-0 w-full h-full flex',
          kind === 'cover' ? 'items-end justify-end p-3 sm:p-4' : 'items-end justify-end',
          'bg-black/0 hover:bg-black/25 focus-visible:bg-black/25 transition-colors',
          kind === 'avatar' && 'rounded-full'
        )}
        data-testid={testId ? `${testId}-change` : undefined}
      >
        <span
          className={cn(
            'inline-flex items-center gap-2 rounded-full bg-black/65 text-white shadow-lg backdrop-blur-sm',
            'ring-1 ring-white/25 group-hover/image:ring-[var(--inline-edit-ring)]',
            showLabel ? 'px-3.5 py-2 text-sm font-medium' : 'w-9 h-9 justify-center'
          )}
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Camera className="w-4 h-4" aria-hidden="true" />}
          {showLabel && <span>{uploading && uploadingLabel ? uploadingLabel : label}</span>}
        </span>
      </button>
      {uploading && <div className={cn('absolute inset-0 bg-black/30 pointer-events-none', kind === 'avatar' && 'rounded-full')} aria-hidden="true" />}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) setPicked(file);
        }}
        data-testid={testId ? `${testId}-input` : undefined}
      />
      <ImageCropDialog
        file={picked}
        kind={kind}
        onCancel={() => setPicked(null)}
        onApply={(cropped) => {
          setPicked(null);
          void onUpload(cropped);
        }}
      />
    </div>
  );
}

export default EditableImage;
