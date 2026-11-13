'use client';

import type { PostMedia } from '@al-ummah/shared-types';
import { POST_LIMITS } from '@al-ummah/shared-types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/hooks/useLanguage';
import { PostImageField } from './PostImageField';

export interface LinkFormData {
  url: string;
  title: string;
  description: string;
  image: PostMedia | null;
  comment: string;
}

export const emptyLink = (): LinkFormData => ({ url: '', title: '', description: '', image: null, comment: '' });

interface LinkPostFormProps {
  channelId: string;
  data: LinkFormData;
  onChange: (data: LinkFormData) => void;
  postLocale: 'en' | 'ar';
}

/** A link post: an outside page with an optional title, description and preview image. */
export function LinkPostForm({ channelId, data, onChange, postLocale }: LinkPostFormProps) {
  const { t } = useLanguage();
  const dir = postLocale === 'ar' ? 'rtl' : 'ltr';
  return (
    <div className="space-y-4" data-testid="link-post-form">
      <div className="space-y-2">
        <Label htmlFor="link-url" className="text-sm md:text-base">{t.community.linkUrl} *</Label>
        <Input id="link-url" type="url" inputMode="url" dir="ltr" placeholder="https://" value={data.url} maxLength={POST_LIMITS.url} required aria-required onChange={(e) => onChange({ ...data, url: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="link-comment" className="text-sm md:text-base">{t.community.linkComment}</Label>
        <Textarea id="link-comment" dir={dir} lang={postLocale} value={data.comment} maxLength={POST_LIMITS.text} className="min-h-[72px]" onChange={(e) => onChange({ ...data, comment: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="link-title" className="text-sm md:text-base">{t.community.linkTitle}</Label>
        <Input id="link-title" dir={dir} lang={postLocale} value={data.title} maxLength={POST_LIMITS.linkTitle} onChange={(e) => onChange({ ...data, title: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="link-description" className="text-sm md:text-base">{t.community.linkDescription}</Label>
        <Textarea id="link-description" dir={dir} lang={postLocale} value={data.description} maxLength={POST_LIMITS.linkDescription} className="min-h-[72px]" onChange={(e) => onChange({ ...data, description: e.target.value })} />
      </div>
      <PostImageField channelId={channelId} label={t.community.cover} value={data.image} onChange={(image) => onChange({ ...data, image })} testId="link-image" />
    </div>
  );
}
