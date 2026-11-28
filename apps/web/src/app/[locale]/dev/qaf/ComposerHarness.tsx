'use client';

import { useState } from 'react';
import { PostType, type CommunityPost } from '@al-ummah/shared-types';
import { TextPostForm } from '@/components/Community/management/forms/TextPostForm';
import TextPost from '@/components/Community/types/TextPost';
import { Button } from '@/components/ui/button';

export function ComposerHarness({ locale, postLocale }: { locale: string; postLocale: 'en' | 'ar' }) {
  const ar = locale === 'ar';
  const [content, setContent] = useState('');
  const [post, setPost] = useState<CommunityPost>();
  return <main className="mx-auto w-full max-w-[max(45rem,55vw)] space-y-5 px-6 py-10">
    <h1 className="text-2xl font-semibold">{post ? (ar ? 'منشور المجتمع' : 'Community post') : (ar ? 'منشور جديد' : 'New post')}</h1>
    {post
      ? <article className="rounded-xl border bg-[var(--fanous-color-surface-raised)] p-6"><TextPost post={post} /></article>
      : <form className="space-y-5 rounded-xl border bg-[var(--fanous-color-surface-raised)] p-6" onSubmit={(event) => {
        event.preventDefault();
        setPost({ type: PostType.TEXT, content } as CommunityPost);
      }}>
        <TextPostForm channelId="qaf-test-channel" content={content} onChange={setContent} locale={locale} postLocale={postLocale} />
        <Button data-testid="qaf-harness-publish" type="submit">{ar ? 'نشر' : 'Publish'}</Button>
      </form>}
  </main>;
}
