'use client';

/**
 * Studio → Site → Pages (wiki AUN-SCHOLAR-SITES §7.1, SS16): the site's pages with their status,
 * and "New page" (title + address). Each page opens in the block editor
 * (studio/[channelId]/site/pages/[pageId]). Up to the plan's `site.pages.max`.
 */
import { useEffect, useState } from 'react';
import Link from '@/components/common/AppLink';
import { suggestSiteSlug, type SitePageSummary } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/hooks/useLanguage';
import { createSitePage, listSitePages } from '@/lib/studio/site-client';

export function SitePages({ channelId, locale }: { channelId: string; locale: string }) {
  const { t } = useLanguage();
  const p = t.studio.site.pages;
  const lang = locale === 'ar' ? 'ar' : 'en';
  const [pages, setPages] = useState<SitePageSummary[] | null>(null);
  const [limit, setLimit] = useState(0);
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listSitePages(channelId).then((r) => {
      if (r.ok) {
        setPages(r.data.pages);
        setLimit(r.data.limit);
      } else setError(p.errors.generic);
    });
  }, [channelId, p.errors.generic]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await createSitePage(channelId, { slug, title: { [lang]: title } });
    setBusy(false);
    if (r.ok) {
      window.location.assign(`/${lang}/studio/${encodeURIComponent(channelId)}/site/pages/${r.data.page.id}`);
      return;
    }
    setError((r.code && (p.errors as Record<string, string>)[r.code]) || p.errors.generic);
  };

  const titleOf = (x: SitePageSummary) => x.title[lang] || x.title.en || x.title.ar || `/${x.slug}/`;

  return (
    <section aria-labelledby="site-pages-h" className="space-y-3" data-testid="studio-site-pages">
      <h2 id="site-pages-h" className="text-lg font-medium">{p.title}</h2>
      <p className="text-muted-foreground text-sm">{p.hint.replace('{max}', String(limit))}</p>
      {pages && pages.length === 0 && <p className="text-sm">{p.none}</p>}
      {pages && pages.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {pages.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-3 p-3" data-testid="studio-site-page">
              <span className="font-medium">{titleOf(x)}</span>
              <bdi dir="ltr" className="text-muted-foreground font-mono text-xs">/{x.slug}/</bdi>
              <span className="text-xs rounded-full px-2 py-0.5 bg-[var(--fanous-color-surface-raised)]">{x.status === 'published' ? p.published : p.draft}</span>
              <Link className="ms-auto inline-flex min-h-11 items-center underline" href={`/${lang}/studio/${encodeURIComponent(channelId)}/site/pages/${x.id}`}>
                {p.edit}
                <span className="sr-only"> {titleOf(x)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {pages && pages.length < limit && (
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" data-testid="studio-site-page-new">
          <div className="space-y-1">
            <Label htmlFor="site-page-title">{p.titleLabel}</Label>
            <Input
              id="site-page-title"
              dir="auto"
              maxLength={120}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (!slugTouched) setSlug(suggestSiteSlug(e.target.value).slice(0, 60));
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="site-page-slug">{p.slug}</Label>
            <Input id="site-page-slug" dir="ltr" maxLength={60} value={slug} aria-describedby="site-page-slug-hint" onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase()); }} />
            <p id="site-page-slug-hint" className="text-muted-foreground text-xs">{p.slugHint.replace('{slug}', slug || '…')}</p>
          </div>
          <Button type="submit" className="min-h-11" disabled={busy || !title.trim() || !slug} data-testid="studio-site-page-create">
            {busy ? p.creating : p.create}
          </Button>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-[var(--fanous-color-error-text)]">{error}</p>}
    </section>
  );
}
