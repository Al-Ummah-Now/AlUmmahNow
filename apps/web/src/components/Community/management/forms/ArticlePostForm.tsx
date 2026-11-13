'use client';

import type { PostMedia } from '@al-ummah/shared-types';
import { POST_LIMITS } from '@al-ummah/shared-types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/hooks/useLanguage';
import { PostImageField } from './PostImageField';

export interface ArticleFormData {
  title: string;
  excerpt: string;
  body: string;
  cover: PostMedia | null;
}

export const emptyArticle = (): ArticleFormData => ({ title: '', excerpt: '', body: '', cover: null });

interface ArticlePostFormProps {
  channelId: string;
  data: ArticleFormData;
  onChange: (data: ArticleFormData) => void;
  /** The post's language: the fields take its direction */
  postLocale: 'en' | 'ar';
  error?: string;
}

/** An article post: title, optional summary and cover, and a markdown body (post-schema.ts). */
export function ArticlePostForm({ channelId, data, onChange, postLocale, error }: ArticlePostFormProps) {
  const { t } = useLanguage();
  const dir = postLocale === 'ar' ? 'rtl' : 'ltr';
  return (
    <div className="space-y-4" data-testid="article-post-form">
      <div className="space-y-2">
        <Label htmlFor="article-title" className="text-sm md:text-base">{t.community.title} *</Label>
        <Input id="article-title" dir={dir} lang={postLocale} value={data.title} maxLength={POST_LIMITS.title} required aria-required onChange={(e) => onChange({ ...data, title: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="article-excerpt" className="text-sm md:text-base">{t.community.excerpt}</Label>
        <Textarea id="article-excerpt" dir={dir} lang={postLocale} value={data.excerpt} maxLength={POST_LIMITS.excerpt} className="min-h-[72px]" onChange={(e) => onChange({ ...data, excerpt: e.target.value })} />
      </div>
      <PostImageField channelId={channelId} label={t.community.cover} value={data.cover} onChange={(cover) => onChange({ ...data, cover })} testId="article-cover" />
      <div className="space-y-2">
        <Label htmlFor="article-body" className="text-sm md:text-base">{t.community.articleBody} *</Label>
        <p id="article-body-hint" className="text-xs md:text-sm text-muted-foreground">{t.community.articleBodyHint}</p>
        <Textarea
          id="article-body"
          dir={dir}
          lang={postLocale}
          value={data.body}
          maxLength={POST_LIMITS.articleBody}
          required
          aria-required
          aria-describedby="article-body-hint"
          className={`min-h-[320px] font-mono text-sm resize-y ${error ? 'border-destructive' : ''}`}
          onChange={(e) => onChange({ ...data, body: e.target.value })}
        />
      </div>
    </div>
  );
}
