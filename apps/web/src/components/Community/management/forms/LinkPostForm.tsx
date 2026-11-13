'use client';

import { useRef, useState } from 'react';
import type { PostMedia } from '@al-ummah/shared-types';
import { POST_LIMITS } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/hooks/useLanguage';
import { fetchLinkPreview } from '@/lib/api/community-posts';
import { PostImageField } from './PostImageField';

export interface LinkFormData {
  url: string;
  title: string;
  description: string;
  siteName: string;
  image: PostMedia | null;
  comment: string;
}

export const emptyLink = (): LinkFormData => ({ url: '', title: '', description: '', siteName: '', image: null, comment: '' });

interface LinkPostFormProps {
  channelId: string;
  data: LinkFormData;
  onChange: (data: LinkFormData) => void;
  postLocale: 'en' | 'ar';
}

type PreviewState = 'idle' | 'loading' | 'done' | 'failed';

/**
 * A link post (SS14): an outside page shown as a preview card (image, title, site name) with the
 * creator's optional comment. "Get preview" (and leaving the address field) reads the page once;
 * it only fills fields that are still empty, and every field stays editable.
 */
export function LinkPostForm({ channelId, data, onChange, postLocale }: LinkPostFormProps) {
  const { t } = useLanguage();
  const dir = postLocale === 'ar' ? 'rtl' : 'ltr';
  const [state, setState] = useState<PreviewState>('idle');
  const lastFetched = useRef('');
  const latest = useRef(data);
  latest.current = data;

  const valid = /^https?:\/\/\S+$/i.test(data.url.trim());

  const getPreview = async (force: boolean) => {
    const url = latest.current.url.trim();
    if (!/^https?:\/\/\S+$/i.test(url) || (!force && url === lastFetched.current)) return;
    lastFetched.current = url;
    setState('loading');
    const p = await fetchLinkPreview(channelId, url);
    const now = latest.current;
    if (now.url.trim() !== url) return; // the address changed meanwhile
    if (!p) {
      setState('failed');
      return;
    }
    onChange({
      ...now,
      title: now.title || p.title || '',
      description: now.description || p.description || '',
      siteName: now.siteName || p.siteName || '',
      image: now.image ?? p.image,
    });
    setState('done');
  };

  return (
    <div className="space-y-4" data-testid="link-post-form">
      <div className="space-y-2">
        <Label htmlFor="link-url" className="text-sm md:text-base">{t.community.linkUrl} *</Label>
        <div className="flex gap-2">
          <Input
            id="link-url"
            type="url"
            inputMode="url"
            dir="ltr"
            placeholder="https://"
            value={data.url}
            maxLength={POST_LIMITS.url}
            required
            aria-required
            aria-describedby="link-preview-status"
            onChange={(e) => onChange({ ...data, url: e.target.value })}
            onBlur={() => void getPreview(false)}
          />
          <Button type="button" variant="outline" className="shrink-0 min-h-11" disabled={!valid || state === 'loading'} onClick={() => void getPreview(true)} data-testid="link-fetch">
            {t.community.linkFetch}
          </Button>
        </div>
        <p id="link-preview-status" role="status" aria-live="polite" className="text-sm text-[var(--fanous-color-text-muted)] min-h-5" data-testid="link-preview-status" data-state={state}>
          {state === 'loading' ? t.community.linkFetching : state === 'done' ? t.community.linkFetched : state === 'failed' ? t.community.linkFetchFailed : ''}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="link-comment" className="text-sm md:text-base">{t.community.linkComment}</Label>
        <Textarea id="link-comment" dir={dir} lang={postLocale} value={data.comment} maxLength={POST_LIMITS.text} className="min-h-[72px]" onChange={(e) => onChange({ ...data, comment: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="link-title" className="text-sm md:text-base">{t.community.linkTitle}</Label>
        <Input id="link-title" dir="auto" value={data.title} maxLength={POST_LIMITS.linkTitle} onChange={(e) => onChange({ ...data, title: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="link-site-name" className="text-sm md:text-base">{t.community.linkSiteName}</Label>
        <Input id="link-site-name" dir="auto" value={data.siteName} maxLength={POST_LIMITS.linkSiteName} onChange={(e) => onChange({ ...data, siteName: e.target.value })} data-testid="link-site-name" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="link-description" className="text-sm md:text-base">{t.community.linkDescription}</Label>
        <Textarea id="link-description" dir="auto" value={data.description} maxLength={POST_LIMITS.linkDescription} className="min-h-[72px]" onChange={(e) => onChange({ ...data, description: e.target.value })} />
      </div>
      <PostImageField channelId={channelId} label={t.community.cover} value={data.image} onChange={(image) => onChange({ ...data, image })} testId="link-image" />
    </div>
  );
}
