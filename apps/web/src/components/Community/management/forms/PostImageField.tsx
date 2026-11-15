'use client';

import { useId, useRef, useState } from 'react';
import { COMMUNITY_UPLOAD_LIMITS, type PostMedia } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/hooks/useLanguage';
import { uploadCommunityImages } from '@/lib/api/community-posts';
import { reportError } from '@/lib/errors/reporter';
import { overLimit, tooLargeMessage, type TooLargeFile } from '@/lib/community/upload-limits';
import { Loader2, Upload, X } from 'lucide-react';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

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

/** One post image upload: the stored image, or why not (`tooLarge` names the file and the limit). */
export type PostImageUpload = { ok: true; media: PostMedia } | { ok: false; tooLarge: TooLargeFile | null };

/**
 * Uploads one image to the channel's community media and returns it as a PostMedia (alt kept). A file
 * over the API's limit (@al-ummah/shared-types) is refused here, before it is sent.
 */
export async function uploadPostImage(channelId: string, file: File, alt: string | null): Promise<PostImageUpload> {
  if (!ALLOWED.includes(file.type)) return { ok: false, tooLarge: null };
  const tooLarge = overLimit(file, 'image', COMMUNITY_UPLOAD_LIMITS);
  if (tooLarge) return { ok: false, tooLarge };
  const form = new FormData();
  form.append('images', file);
  const [uploaded, size] = await Promise.all([uploadCommunityImages(channelId, form), sizeOf(file)]);
  if (!uploaded.ok) return { ok: false, tooLarge: uploaded.tooLarge };
  const first = uploaded.images[0];
  if (!first?.url) return { ok: false, tooLarge: null };
  return { ok: true, media: { url: first.url, alt, width: size.width, height: size.height } };
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
  const { t, lang } = useLanguage();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setFailed(null);
    try {
      const result = await uploadPostImage(channelId, file, value?.alt ?? null);
      if (!result.ok) {
        setFailed(result.tooLarge ? tooLargeMessage(t, lang, 'image', result.tooLarge) : t.community.errorUpload);
        return;
      }
      onChange(result.media);
    } catch (err) {
      setFailed(t.community.errorUpload);
      reportError(err, { shown: true, extra: { where: 'community-post-image' } });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const message = failed ?? error;
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
        aria-invalid={failed ? true : undefined}
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
