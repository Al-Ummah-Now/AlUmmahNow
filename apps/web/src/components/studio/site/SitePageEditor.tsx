'use client';

/**
 * Studio → Site → a page (wiki AUN-SCHOLAR-SITES §7.1 Pages, SS16): title, address and search
 * description per language, and the page's blocks per language (text, image, video, button,
 * quote, divider, latest posts, latest videos): add, edit, move and remove. Save is ETag-guarded;
 * every save keeps the previous version (last 10, "Restore"). Publish / back to draft, preview the
 * saved page on the real site (drafts show only with the preview token), delete in the in-app
 * dialog.
 */
import { useMemo, useState } from 'react';
import Link from '@/components/common/AppLink';
import {
  SITE_BLOCK_TYPES,
  validateSitePageUpdate,
  type SiteBlock,
  type SiteBlockType,
  type SiteLocale,
  type SitePage,
  type SitePageUpdate,
} from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ThemedSelectField } from '@/components/ui/ThemedSelectField';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useLanguage } from '@/hooks/useLanguage';
import { deleteSitePage, previewSiteSettings, restoreSitePage, saveSitePage, uploadSiteImage } from '@/lib/studio/site-client';

interface Props {
  locale: string;
  channelId: string;
  siteLocales: SiteLocale[];
  initial: { page: SitePage; etag: string };
}

type Draft = Required<Pick<SitePageUpdate, 'slug' | 'title' | 'description' | 'blocks'>>;

const draftOf = (p: SitePage): Draft => ({ slug: p.slug, title: { ...p.title }, description: { ...p.description }, blocks: JSON.parse(JSON.stringify(p.blocks ?? {})) });

function newBlock(type: SiteBlockType, list: SiteBlock[]): SiteBlock {
  let i = list.length + 1;
  while (list.some((b) => b.id === `b${i}`)) i += 1;
  const id = `b${i}`;
  switch (type) {
    case 'markdown':
      return { id, type, text: '' };
    case 'image':
      return { id, type, url: '', alt: '', caption: null };
    case 'video':
      return { id, type, videoId: '' };
    case 'cta':
      return { id, type, label: '', href: '/' };
    case 'quote':
      return { id, type, text: '', cite: null };
    case 'divider':
      return { id, type };
    case 'posts':
      return { id, type, count: 3 };
    case 'videos':
      return { id, type, count: 6, playlistId: null };
  }
}

/** A watch address or a bare id → the video id. */
export function videoIdFrom(input: string): string {
  const v = input.trim();
  const m = v.match(/[?&]v=([A-Za-z0-9_-]{4,64})/) ?? v.match(/\/(?:video|watch|shorts)\/([A-Za-z0-9_-]{4,64})/);
  return m ? m[1] : v;
}

export function SitePageEditor({ locale, channelId, siteLocales, initial }: Props) {
  const { t } = useLanguage();
  const p = t.studio.site.pages;
  const lang = locale === 'ar' ? 'ar' : 'en';
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial.page));
  const [tab, setTab] = useState<SiteLocale>(siteLocales.includes(lang) ? lang : siteLocales[0]);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [addType, setAddType] = useState<SiteBlockType>('markdown');
  const { confirm, dialog } = useConfirm();
  const page = saved.page;
  const problem = useMemo(() => validateSitePageUpdate(draft), [draft]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(page));
  const blocks = draft.blocks[tab] ?? [];
  const backHref = `/${lang}/studio/${encodeURIComponent(channelId)}/site`;
  const err = (code: string | null) => (code && (p.errors as Record<string, string>)[code]) || p.errors.generic;

  const setBlocks = (list: SiteBlock[]) => setDraft((d) => ({ ...d, blocks: { ...d.blocks, [tab]: list } }));
  const patchBlock = (i: number, patch: Partial<SiteBlock>) => setBlocks(blocks.map((b, j) => (j === i ? ({ ...b, ...patch } as SiteBlock) : b)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...blocks];
    const [b] = next.splice(i, 1);
    next.splice(i + by, 0, b);
    setBlocks(next);
  };

  const save = async (extra: Partial<SitePageUpdate> = {}) => {
    setBusy('save');
    setStatus(null);
    const r = await saveSitePage(channelId, page.id, { ...draft, ...extra }, saved.etag);
    setBusy(null);
    if (r.ok) {
      setSaved(r.data);
      setDraft(draftOf(r.data.page));
      setStatus({ tone: 'ok', text: p.saved });
    } else setStatus({ tone: 'error', text: err(r.status === 412 ? 'changed_elsewhere' : r.code) });
  };

  const preview = async () => {
    setBusy('preview');
    const r = await previewSiteSettings(channelId, {});
    setBusy(null);
    if (!r.ok) return setStatus({ tone: 'error', text: p.errors.generic });
    const u = new URL(r.data.url);
    u.pathname = `/${tab}/${page.slug}/`;
    setPreviewUrl(u.toString());
  };

  const restore = async (index: number) => {
    setBusy('restore');
    const r = await restoreSitePage(channelId, page.id, index);
    setBusy(null);
    if (r.ok) {
      setSaved(r.data);
      setDraft(draftOf(r.data.page));
      setStatus({ tone: 'ok', text: p.saved });
    } else setStatus({ tone: 'error', text: err(r.code) });
  };

  const remove = async () => {
    const ok = await confirm({ title: p.deleteTitle, description: p.deleteBody, confirmLabel: p.delete, cancelLabel: p.cancel, danger: true, testId: 'site-page-delete-dialog' });
    if (!ok) return;
    setBusy('delete');
    const r = await deleteSitePage(channelId, page.id);
    setBusy(null);
    if (r.ok) window.location.assign(backHref);
    else setStatus({ tone: 'error', text: err(r.code) });
  };

  const uploadImage = async (i: number, file: File | undefined) => {
    if (!file) return;
    setBusy(`img:${i}`);
    const r = await uploadSiteImage(channelId, file);
    setBusy(null);
    if (r.ok) patchBlock(i, { url: r.data.url } as Partial<SiteBlock>);
    else setStatus({ tone: 'error', text: p.errors.blocks_invalid });
  };

  const field = (b: SiteBlock, i: number) => {
    const id = `blk-${tab}-${b.id}`;
    const dir = tab === 'ar' ? 'rtl' : 'ltr';
    switch (b.type) {
      case 'markdown':
        return (
          <div className="space-y-1">
            <Label htmlFor={id}>{p.text}</Label>
            <Textarea id={id} dir={dir} lang={tab} rows={6} maxLength={20000} value={b.text} onChange={(e) => patchBlock(i, { text: e.target.value })} />
          </div>
        );
      case 'image':
        return (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              {b.url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.url} alt="" className="h-16 w-24 rounded object-cover" />
              )}
              <label className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-border px-3 text-sm">
                {busy === `img:${i}` ? t.studio.site.uploading : t.studio.site.upload}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" aria-label={p.imageUrl} onChange={(e) => uploadImage(i, e.target.files?.[0])} />
              </label>
            </div>
            <Label htmlFor={`${id}-alt`}>{p.imageAlt}</Label>
            <Input id={`${id}-alt`} dir={dir} lang={tab} maxLength={300} value={b.alt} onChange={(e) => patchBlock(i, { alt: e.target.value })} />
            <Label htmlFor={`${id}-cap`}>{p.caption}</Label>
            <Input id={`${id}-cap`} dir={dir} lang={tab} maxLength={300} value={b.caption ?? ''} onChange={(e) => patchBlock(i, { caption: e.target.value || null })} />
          </div>
        );
      case 'video':
        return (
          <div className="space-y-1">
            <Label htmlFor={id}>{p.videoId}</Label>
            <Input id={id} dir="ltr" value={b.videoId} onChange={(e) => patchBlock(i, { videoId: videoIdFrom(e.target.value) })} />
          </div>
        );
      case 'cta':
        return (
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`${id}-label`}>{p.ctaLabel}</Label>
              <Input id={`${id}-label`} dir={dir} lang={tab} maxLength={80} value={b.label} onChange={(e) => patchBlock(i, { label: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-href`}>{p.ctaHref}</Label>
              <Input id={`${id}-href`} dir="ltr" value={b.href} onChange={(e) => patchBlock(i, { href: e.target.value.trim() })} />
            </div>
          </div>
        );
      case 'quote':
        return (
          <div className="space-y-2">
            <Label htmlFor={id}>{p.quote}</Label>
            <Textarea id={id} dir={dir} lang={tab} rows={3} maxLength={2000} value={b.text} onChange={(e) => patchBlock(i, { text: e.target.value })} />
            <Label htmlFor={`${id}-cite`}>{p.cite}</Label>
            <Input id={`${id}-cite`} dir={dir} lang={tab} maxLength={200} value={b.cite ?? ''} onChange={(e) => patchBlock(i, { cite: e.target.value || null })} />
          </div>
        );
      case 'divider':
        return null;
      case 'posts':
      case 'videos':
        return (
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`${id}-count`}>{p.count}</Label>
              <Input id={`${id}-count`} type="number" min={1} max={b.type === 'posts' ? 12 : 24} value={b.count} onChange={(e) => patchBlock(i, { count: Number(e.target.value) || 1 })} />
            </div>
            {b.type === 'videos' && (
              <div className="space-y-1">
                <Label htmlFor={`${id}-pl`}>{p.playlistId}</Label>
                <Input id={`${id}-pl`} dir="ltr" value={b.playlistId ?? ''} onChange={(e) => patchBlock(i, { playlistId: e.target.value.trim() || null })} />
              </div>
            )}
          </div>
        );
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="studio-site-page-editor" data-status={page.status}>
      <p>
        <Link className="underline" href={backHref}>{p.back}</Link>
      </p>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{page.title[lang] || page.title.en || page.title.ar}</h1>
        <p className="text-sm">
          <bdi dir="ltr" className="font-mono">/{page.slug}/</bdi> · <span data-testid="studio-site-page-status">{page.status === 'published' ? p.published : p.draft}</span>
        </p>
      </header>

      <section className="space-y-3" aria-label={p.titleLabel}>
        <div className="grid gap-3 sm:grid-cols-2">
          {siteLocales.map((l) => (
            <div key={l} className="space-y-1">
              <Label htmlFor={`page-title-${l}`}>{l === 'en' ? p.titleEn : p.titleAr}</Label>
              <Input id={`page-title-${l}`} dir={l === 'ar' ? 'rtl' : 'ltr'} lang={l} maxLength={120} value={draft.title[l] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, title: { ...d.title, [l]: e.target.value } }))} />
            </div>
          ))}
        </div>
        <div className="space-y-1">
          <Label htmlFor="page-slug">{p.slug}</Label>
          <Input id="page-slug" dir="ltr" maxLength={60} value={draft.slug} onChange={(e) => setDraft((d) => ({ ...d, slug: e.target.value.toLowerCase() }))} />
        </div>
        {siteLocales.map((l) => (
          <div key={l} className="space-y-1">
            <Label htmlFor={`page-desc-${l}`}>{l === 'en' ? p.descriptionEn : p.descriptionAr}</Label>
            <Textarea id={`page-desc-${l}`} dir={l === 'ar' ? 'rtl' : 'ltr'} lang={l} rows={2} maxLength={300} value={draft.description[l] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, description: { ...d.description, [l]: e.target.value } }))} />
          </div>
        ))}
      </section>

      <section aria-labelledby="page-blocks-h" className="space-y-3">
        <h2 id="page-blocks-h" className="text-lg font-medium">{p.blocksFor}</h2>
        {siteLocales.length > 1 && (
          <div role="tablist" aria-labelledby="page-blocks-h" className="flex gap-2">
            {siteLocales.map((l) => (
              <button key={l} type="button" role="tab" aria-selected={tab === l} className={`min-h-11 rounded-md border px-3 text-sm ${tab === l ? 'border-primary ring-2 ring-primary' : 'border-border'}`} onClick={() => setTab(l)}>
                {l === 'en' ? p.blocksEn : p.blocksAr}
              </button>
            ))}
          </div>
        )}
        <ol className="space-y-3" data-testid="studio-site-page-blocks" lang={tab}>
          {blocks.map((b, i) => (
            <li key={b.id} className="space-y-2 rounded-md border border-border p-3" data-testid="studio-site-page-block" data-type={b.type}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-sm">{p.blockTypes[b.type]}</span>
                <Button type="button" variant="ghost" className="ms-auto" disabled={i === 0} onClick={() => move(i, -1)}>{p.moveUp}<span className="sr-only">: {p.blockTypes[b.type]} {i + 1}</span></Button>
                <Button type="button" variant="ghost" disabled={i === blocks.length - 1} onClick={() => move(i, 1)}>{p.moveDown}<span className="sr-only">: {p.blockTypes[b.type]} {i + 1}</span></Button>
                <Button type="button" variant="ghost" onClick={() => setBlocks(blocks.filter((_, j) => j !== i))}>{p.removeBlock}<span className="sr-only">: {p.blockTypes[b.type]} {i + 1}</span></Button>
              </div>
              {field(b, i)}
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-2">
          <ThemedSelectField aria-label={p.addBlock} value={addType} onChange={(e) => setAddType(e.target.value as SiteBlockType)} data-testid="studio-site-page-block-type">
            {SITE_BLOCK_TYPES.map((k) => (
              <option key={k} value={k}>{p.blockTypes[k]}</option>
            ))}
          </ThemedSelectField>
          <Button type="button" variant="outline" disabled={blocks.length >= 60} onClick={() => setBlocks([...blocks, newBlock(addType, blocks)])} data-testid="studio-site-page-block-add">
            {p.addBlock}
          </Button>
        </div>
      </section>

      <section aria-labelledby="page-revisions-h" className="space-y-2">
        <h2 id="page-revisions-h" className="text-lg font-medium">{p.revisions}</h2>
        {(page.revisions ?? []).length === 0 ? (
          <p className="text-muted-foreground text-sm">{p.noRevisions}</p>
        ) : (
          <ul className="space-y-1">
            {(page.revisions ?? []).map((r, i) => (
              <li key={`${r.savedAt}-${i}`} className="flex items-center gap-2 text-sm">
                <span>{new Date(r.savedAt).toLocaleString(lang === 'ar' ? 'ar' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                <Button type="button" variant="ghost" disabled={busy !== null} onClick={() => restore(i)}>{p.restore}</Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="bg-background sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-border py-3">
        <Button type="button" onClick={() => save()} disabled={!dirty || !!problem || busy !== null} data-testid="studio-site-page-save">
          {busy === 'save' ? p.saving : p.save}
        </Button>
        <Button type="button" variant="outline" disabled={!!problem || busy !== null} onClick={() => save({ status: page.status === 'published' ? 'draft' : 'published' })} data-testid="studio-site-page-publish">
          {page.status === 'published' ? p.unpublish : p.publish}
        </Button>
        <Button type="button" variant="outline" disabled={busy !== null} onClick={preview}>{p.preview}</Button>
        <Button type="button" variant="ghost" disabled={busy !== null} onClick={remove} data-testid="studio-site-page-delete">{p.delete}</Button>
        <p role="status" aria-live="polite" className={`text-sm ${status?.tone === 'error' ? 'text-destructive' : 'text-muted-foreground'}`} data-testid="studio-site-page-message">
          {problem ? (p.errors as Record<string, string>)[problem] : status?.text}
        </p>
      </div>

      {previewUrl && (
        <iframe title={p.preview} src={previewUrl} className="h-[70vh] w-full rounded-md border border-border" sandbox="allow-scripts allow-same-origin allow-popups" />
      )}
      {dialog}
    </div>
  );
}
