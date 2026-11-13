'use client';

import { useId, useRef, useState } from 'react';
import type { PostMedia } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/hooks/useLanguage';
import { uploadCommunityImages } from '@/lib/api/community-posts';
import { reportError } from '@/lib/errors/reporter';
import { Loader2, Upload, X } from 'lucide-react';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_BYTES = 16 * 1024 * 1024;

/** The displayed size of an image file (for the frame's shape on www and the videos site). */
async function sizeOf(file: File): Promise<{ width: number | null; height: number | null }> {
  try {
    const bitmap = await createImageBitmap(file);
    const out = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return out;
  } catch {
    return { width: null, height: null };
  }
}

/** Uploads one image to the channel's community media and returns it as a PostMedia (alt kept). */
export async function uploadPostImage(channelId: string, file: File, alt: string | null): Promise<PostMedia | null> {
  if (!ALLOWED.includes(file.type) || file.size > MAX_BYTES) return null;
  const form = new FormData();
  form.append('images', file);
  const [uploaded, size] = await Promise.all([uploadCommunityImages(channelId, form), sizeOf(file)]);
  const first = uploaded?.[0];
  if (!first?.url) return null;
  return { url: first.url, alt, width: size.width, height: size.height };
}

interface PostImageFieldProps {
  channelId: string;
  label: string;
  value: PostMedia | null;
  onChange: (value: PostMedia | null) => void;
  /** Cards need alt text; covers and link previews may have it. */
  altRequired?: boolean;
  /** Shown under the field (error text) */
  error?: string;
  testId?: string;
}

/** One image of a post: upload, preview, alt text and remove. */
export function PostImageField({ channelId, label, value, onChange, altRequired = false, error, testId }: PostImageFieldProps) {
  const { t } = useLanguage();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setFailed(false);
    try {
      const media = await uploadPostImage(channelId, file, value?.alt ?? null);
      if (!media) {
        setFailed(true);
        return;
      }
      onChange(media);
    } catch (err) {
      setFailed(true);
      reportError(err, { shown: true, extra: { where: 'community-post-image' } });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const message = failed ? t.community.errorUpload : error;
  return (
    <div className="space-y-2" data-testid={testId}>
      <Label htmlFor={`${id}-file`} className="text-sm md:text-base">{label}</Label>
      {value ? (
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value.url} alt="" className="w-24 h-24 object-cover rounded-md border border-[var(--fanous-color-divider)]" />
          <Button type="button" variant="outline" size="sm" onClick={() => onChange(null)} aria-label={t.community.removeImage}>
            <X className="w-4 h-4" aria-hidden="true" />
            <span className="ms-1">{t.community.removeImage}</span>
          </Button>
        </div>
      ) : null}
      <input
        ref={input}
        id={`${id}-file`}
        type="file"
        accept={ALLOWED.join(',')}
        className="sr-only"
        onChange={(e) => void pick(e.target.files?.[0])}
        aria-describedby={message ? `${id}-error` : undefined}
      />
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Upload className="w-4 h-4" aria-hidden="true" />}
        <span className="ms-1">{busy ? t.community.uploading : t.community.uploadImage}</span>
      </Button>
      {value ? (
        <div className="space-y-1">
          <Label htmlFor={`${id}-alt`} className="text-xs md:text-sm">{t.community.cardAlt}{altRequired ? ' *' : ''}</Label>
          <Input
            id={`${id}-alt`}
            value={value.alt ?? ''}
            maxLength={300}
            required={altRequired}
            aria-required={altRequired}
            onChange={(e) => onChange({ ...value, alt: e.target.value || null })}
          />
        </div>
      ) : null}
      {message ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">{message}</p>
      ) : null}
    </div>
  );
}
