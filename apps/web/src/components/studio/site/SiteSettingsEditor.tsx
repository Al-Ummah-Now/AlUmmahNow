'use client';

/**
 * Studio → Site (wiki AUN-SCHOLAR-SITES §7.1, phase 2 MVP): choose one of the platform's themes
 * (pinned; no editing), the site name (en/ar), logo and favicon (used as they are), languages,
 * the main menu and the About text, then preview the unsaved settings on the real site (a
 * 10-minute token) and save. Saves are ETag-guarded: a concurrent edit is reported, never lost.
 */
import { useMemo, useState } from 'react';
import {
  SITE_NAV_KINDS,
  SITE_REDIRECTS_MAX,
  validateSiteSettingsUpdate,
  type SiteLocale,
  type SiteNavItem,
  type SiteNavKind,
  type SiteSettingsProblem,
  type SiteSettingsUpdate,
} from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ThemedSelectField } from '@/components/ui/ThemedSelectField';
import { useLanguage } from '@/hooks/useLanguage';
import { previewSiteSettings, saveSiteSettings, uploadSiteImage } from '@/lib/studio/site-client';
import type { StudioSite } from '@/lib/studio/site';

interface Props {
  locale: string;
  channelId: string;
  channelName: string;
  initial: StudioSite;
}

type Draft = Required<Pick<SiteSettingsUpdate, 'themeRef' | 'logoUrl' | 'faviconUrl' | 'locales' | 'navigation' | 'home' | 'seo' | 'redirects'>> & {
  name: Partial<Record<SiteLocale, string>>;
  about: Partial<Record<SiteLocale, string>>;
};

function draftOf(site: StudioSite['site']): Draft {
  return {
    themeRef: site.themeRef,
    name: { ...site.name },
    logoUrl: site.logoUrl,
    faviconUrl: site.faviconUrl,
    locales: [...site.locales],
    navigation: site.navigation.map((n) => ({ ...n, label: { ...(n.label ?? {}) } })),
    about: { ...site.about },
    home: { pageId: site.home?.pageId ?? null },
    seo: { titleTemplate: site.seo?.titleTemplate ?? null, description: { ...(site.seo?.description ?? {}) }, googleVerification: site.seo?.googleVerification ?? null, bingVerification: site.seo?.bingVerification ?? null },
    redirects: (site.redirects ?? []).map((r) => ({ ...r })),
  };
}

function newNavId(items: SiteNavItem[]): string {
  let i = items.length + 1;
  while (items.some((n) => n.id === `item-${i}`)) i += 1;
  return `item-${i}`;
}

export function SiteSettingsEditor({ locale, channelId, channelName, initial }: Props) {
  const { t } = useLanguage();
  const s = t.studio.site;
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial.site));
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string; conflict?: boolean } | null>(null);
  const [busy, setBusy] = useState<'save' | 'preview' | 'logo' | 'favicon' | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const site = saved.site;
  const max = site.limits.navigationMax;
  const problem: SiteSettingsProblem | null = useMemo(() => validateSiteSettingsUpdate(draft, site.limits), [draft, site.limits]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(site));
  const lang = (l: string) => (l === 'ar' ? 'ar' : 'en');
  const pages = site.pages ?? [];
  const pageTitle = (p: { title: Partial<Record<SiteLocale, string>>; slug: string }) => p.title[lang(locale)] || p.title.en || p.title.ar || `/${p.slug}/`;
  const checklist = [
    { key: 'logo', done: !!site.logoUrl, text: s.overview.logo },
    { key: 'about', done: !!(site.about.en || site.about.ar), text: s.overview.about },
    { key: 'page', done: pages.length > 0, text: s.overview.page },
    { key: 'home', done: !!site.home?.pageId, text: s.overview.home },
    ...(site.limits.customDomainsMax > 0 ? [{ key: 'domain', done: site.hosts.some((h) => h.kind === 'custom'), text: s.overview.domain }] : []),
  ];

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setNav = (index: number, patch: Partial<SiteNavItem>) => set('navigation', draft.navigation.map((n, i) => (i === index ? { ...n, ...patch } : n)));
  const moveNav = (index: number, by: -1 | 1) => {
    const next = [...draft.navigation];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    set('navigation', next);
  };

  const save = async () => {
    setBusy('save');
    setStatus(null);
    const r = await saveSiteSettings(channelId, draft, saved.etag);
    setBusy(null);
    if (r.ok) {
      setSaved({ ...saved, site: r.data.site, etag: r.data.etag });
      setDraft(draftOf(r.data.site));
      setStatus({ tone: 'ok', text: s.saved });
    } else if (r.status === 412) {
      setStatus({ tone: 'error', text: s.conflict, conflict: true });
    } else {
      setStatus({ tone: 'error', text: (r.code && (s.errors as Record<string, string>)[r.code]) || s.error });
    }
  };

  const preview = async () => {
    setBusy('preview');
    const r = await previewSiteSettings(channelId, draft);
    setBusy(null);
    if (r.ok) setPreviewUrl(r.data.url);
    else setStatus({ tone: 'error', text: s.error });
  };

  const upload = async (kind: 'logo' | 'favicon', file: File | undefined) => {
    if (!file) return;
    setBusy(kind);
    const r = await uploadSiteImage(channelId, file);
    setBusy(null);
    if (r.ok) set(kind === 'logo' ? 'logoUrl' : 'faviconUrl', r.data.url);
    else setStatus({ tone: 'error', text: s.errors.image_url_invalid });
  };

  const statusText = site.status === 'live' ? s.statusLive : site.status === 'suspended' ? s.statusSuspended : s.statusSetup;

  return (
    <div className="mx-auto max-w-3xl space-y-8" data-testid="studio-site" data-status={site.status}>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{s.title}</h1>
        <p className="text-muted-foreground text-sm">{s.intro}</p>
        <p className="text-sm">
          <span className="font-medium">{s.address}: </span>
          <span dir="ltr" className="font-mono" data-testid="studio-site-host">{saved.primaryHost}</span>
          {' · '}
          <span data-testid="studio-site-status">{statusText}</span>
          {site.status === 'live' && (
            <>
              {' · '}
              <a className="underline" href={`https://${saved.primaryHost}/${lang(locale)}/`} target="_blank" rel="noopener noreferrer">{s.open}</a>
            </>
          )}
        </p>
      </header>

      <section aria-labelledby="site-overview-h" className="space-y-2" data-testid="studio-site-overview">
        <h2 id="site-overview-h" className="text-lg font-medium">{s.overview.title}</h2>
        <ul className="space-y-1">
          {checklist.map((c) => (
            <li key={c.key} className="flex items-center gap-2 text-sm" data-done={c.done}>
              <span aria-hidden="true">{c.done ? '✓' : '○'}</span>
              <span>{c.text}</span>
              <span className="sr-only">({c.done ? s.overview.done : s.overview.todo})</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="site-theme-h" className="space-y-3">
        <h2 id="site-theme-h" className="text-lg font-medium">{s.theme}</h2>
        <p className="text-muted-foreground text-sm">{s.themeHint}</p>
        <div role="radiogroup" aria-labelledby="site-theme-h" className="grid gap-3 sm:grid-cols-2">
          {saved.themes.map((theme) => {
            const checked = draft.themeRef === theme.ref;
            return (
              <label
                key={theme.ref}
                className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-md border p-3 ${checked ? 'border-primary ring-2 ring-primary' : 'border-border'}`}
                data-testid={`studio-site-theme-${theme.id}`}
              >
                <input type="radio" name="site-theme" value={theme.ref} checked={checked} onChange={() => set('themeRef', theme.ref)} />
                <span>{theme.name[lang(locale)]}</span>
                <span dir="ltr" className="text-muted-foreground ms-auto text-xs">{theme.version}</span>
              </label>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="site-brand-h" className="space-y-3">
        <h2 id="site-brand-h" className="text-lg font-medium">{s.brand}</h2>
        <p className="text-muted-foreground text-sm">{s.nameHint}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="site-name-en">{s.nameEn}</Label>
            <Input id="site-name-en" dir="ltr" lang="en" maxLength={80} placeholder={channelName} value={draft.name.en ?? ''} onChange={(e) => set('name', { ...draft.name, en: e.target.value })} data-testid="studio-site-name-en" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="site-name-ar">{s.nameAr}</Label>
            <Input id="site-name-ar" dir="rtl" lang="ar" maxLength={80} placeholder={channelName} value={draft.name.ar ?? ''} onChange={(e) => set('name', { ...draft.name, ar: e.target.value })} data-testid="studio-site-name-ar" />
          </div>
        </div>
        {(['logo', 'favicon'] as const).map((kind) => {
          const url = kind === 'logo' ? draft.logoUrl : draft.faviconUrl;
          return (
            <div key={kind} className="flex flex-wrap items-center gap-3">
              <div className="min-w-40">
                <p className="text-sm font-medium" id={`site-${kind}-label`}>{kind === 'logo' ? s.logo : s.favicon}</p>
                <p className="text-muted-foreground text-xs">{kind === 'logo' ? s.logoHint : s.faviconHint}</p>
              </div>
              {url && (
                // Owner art is shown as is: no crop, overlay or badge (owner rule)
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt="" width={48} height={48} className="h-12 w-12 rounded object-contain" data-testid={`studio-site-${kind}-img`} />
              )}
              <label className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-border px-3 text-sm">
                {busy === kind ? s.uploading : s.upload}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-labelledby={`site-${kind}-label`} onChange={(e) => upload(kind, e.target.files?.[0])} data-testid={`studio-site-${kind}-file`} />
              </label>
              {url && (
                <Button type="button" variant="ghost" onClick={() => set(kind === 'logo' ? 'logoUrl' : 'faviconUrl', null)}>
                  {s.remove}
                </Button>
              )}
            </div>
          );
        })}
      </section>

      <section aria-labelledby="site-lang-h" className="space-y-2">
        <h2 id="site-lang-h" className="text-lg font-medium">{s.languages}</h2>
        <ThemedSelectField aria-labelledby="site-lang-h" value={draft.locales.join(',')} onChange={(e) => set('locales', e.target.value.split(',') as SiteLocale[])} data-testid="studio-site-locales">
          <option value="en,ar">{s.languagesBoth}</option>
          <option value="ar,en">{s.languagesBothArFirst}</option>
          <option value="en">{s.languagesEn}</option>
          <option value="ar">{s.languagesAr}</option>
        </ThemedSelectField>
      </section>

      <section aria-labelledby="site-nav-h" className="space-y-3">
        <h2 id="site-nav-h" className="text-lg font-medium">{s.navigation}</h2>
        <p className="text-muted-foreground text-sm">{s.navigationHint.replace('{max}', String(max))}</p>
        <ol className="space-y-3" data-testid="studio-site-nav">
          {draft.navigation.map((item, index) => (
            <li key={item.id} className="space-y-2 rounded-md border border-border p-3" data-testid="studio-site-nav-item">
              <div className="flex flex-wrap items-center gap-2">
                <ThemedSelectField aria-label={s.navigation} value={item.kind} onChange={(e) => setNav(index, { kind: e.target.value as SiteNavKind, url: e.target.value === 'url' ? item.url ?? 'https://' : undefined, pageId: e.target.value === 'page' ? item.pageId ?? pages[0]?.id : undefined })}>
                  {SITE_NAV_KINDS.filter((k) => k !== 'page' || pages.length > 0 || item.kind === 'page').map((k) => (
                    <option key={k} value={k}>{s.navKinds[k]}</option>
                  ))}
                </ThemedSelectField>
                <Button type="button" variant="ghost" disabled={index === 0} onClick={() => moveNav(index, -1)}>{s.navUp}</Button>
                <Button type="button" variant="ghost" disabled={index === draft.navigation.length - 1} onClick={() => moveNav(index, 1)}>{s.navDown}</Button>
                <Button type="button" variant="ghost" onClick={() => set('navigation', draft.navigation.filter((_, i) => i !== index))}>{s.navRemove}</Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input aria-label={s.navLabelEn} dir="ltr" lang="en" maxLength={40} placeholder={s.navLabelEn} value={item.label?.en ?? ''} onChange={(e) => setNav(index, { label: { ...item.label, en: e.target.value } })} />
                <Input aria-label={s.navLabelAr} dir="rtl" lang="ar" maxLength={40} placeholder={s.navLabelAr} value={item.label?.ar ?? ''} onChange={(e) => setNav(index, { label: { ...item.label, ar: e.target.value } })} />
                {item.kind === 'url' && (
                  <Input aria-label={s.navUrl} dir="ltr" className="sm:col-span-2" type="url" placeholder={s.navUrl} value={item.url ?? ''} onChange={(e) => setNav(index, { url: e.target.value })} />
                )}
                {item.kind === 'page' && (
                  <ThemedSelectField aria-label={s.navPage} className="sm:col-span-2" value={item.pageId ?? ''} onChange={(e) => setNav(index, { pageId: e.target.value })} data-testid="studio-site-nav-page">
                    {pages.map((p) => (
                      <option key={p.id} value={p.id}>{pageTitle(p)}</option>
                    ))}
                  </ThemedSelectField>
                )}
              </div>
            </li>
          ))}
        </ol>
        <Button type="button" variant="outline" disabled={draft.navigation.length >= max} onClick={() => set('navigation', [...draft.navigation, { id: newNavId(draft.navigation), kind: 'videos' }])} data-testid="studio-site-nav-add">
          {s.navAdd}
        </Button>
      </section>

      <section aria-labelledby="site-about-h" className="space-y-3">
        <h2 id="site-about-h" className="text-lg font-medium">{s.about}</h2>
        <p className="text-muted-foreground text-sm">{s.aboutHint}</p>
        <div className="space-y-1">
          <Label htmlFor="site-about-en">{s.aboutEn}</Label>
          <Textarea id="site-about-en" dir="ltr" lang="en" rows={5} maxLength={8000} value={draft.about.en ?? ''} onChange={(e) => set('about', { ...draft.about, en: e.target.value })} data-testid="studio-site-about-en" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="site-about-ar">{s.aboutAr}</Label>
          <Textarea id="site-about-ar" dir="rtl" lang="ar" rows={5} maxLength={8000} value={draft.about.ar ?? ''} onChange={(e) => set('about', { ...draft.about, ar: e.target.value })} data-testid="studio-site-about-ar" />
        </div>
      </section>

      <section aria-labelledby="site-home-h" className="space-y-2">
        <h2 id="site-home-h" className="text-lg font-medium">{s.home.title}</h2>
        <p className="text-muted-foreground text-sm">{s.home.hint}</p>
        <Label htmlFor="site-home-page">{s.home.page}</Label>
        <ThemedSelectField id="site-home-page" value={draft.home.pageId ?? ''} onChange={(e) => set('home', { pageId: e.target.value || null })} data-testid="studio-site-home-page">
          <option value="">{s.home.none}</option>
          {pages.map((p) => (
            <option key={p.id} value={p.id}>{pageTitle(p)}</option>
          ))}
        </ThemedSelectField>
      </section>

      <section aria-labelledby="site-seo-h" className="space-y-3">
        <h2 id="site-seo-h" className="text-lg font-medium">{s.seo.title}</h2>
        <p className="text-muted-foreground text-sm">{s.seo.hint}</p>
        <div className="space-y-1">
          <Label htmlFor="site-seo-title">{s.seo.titleTemplate}</Label>
          <Input id="site-seo-title" dir="auto" maxLength={120} placeholder="%s · …" value={draft.seo.titleTemplate ?? ''} onChange={(e) => set('seo', { ...draft.seo, titleTemplate: e.target.value || null })} aria-describedby="site-seo-title-hint" data-testid="studio-site-seo-title" />
          <p id="site-seo-title-hint" className="text-muted-foreground text-xs">{s.seo.titleTemplateHint}</p>
        </div>
        {(['en', 'ar'] as const).map((l) => (
          <div key={l} className="space-y-1">
            <Label htmlFor={`site-seo-desc-${l}`}>{l === 'en' ? s.seo.descriptionEn : s.seo.descriptionAr}</Label>
            <Textarea id={`site-seo-desc-${l}`} dir={l === 'ar' ? 'rtl' : 'ltr'} lang={l} rows={2} maxLength={300} value={draft.seo.description?.[l] ?? ''} onChange={(e) => set('seo', { ...draft.seo, description: { ...draft.seo.description, [l]: e.target.value } })} />
          </div>
        ))}
        <div className="grid gap-3 sm:grid-cols-2">
          {(['googleVerification', 'bingVerification'] as const).map((k) => (
            <div key={k} className="space-y-1">
              <Label htmlFor={`site-seo-${k}`}>{k === 'googleVerification' ? s.seo.google : s.seo.bing}</Label>
              <Input id={`site-seo-${k}`} dir="ltr" maxLength={100} value={draft.seo[k] ?? ''} onChange={(e) => set('seo', { ...draft.seo, [k]: e.target.value.trim() || null })} aria-describedby="site-seo-verify-hint" />
            </div>
          ))}
        </div>
        <p id="site-seo-verify-hint" className="text-muted-foreground text-xs">{s.seo.verificationHint}</p>
      </section>

      <section aria-labelledby="site-redirects-h" className="space-y-3">
        <h2 id="site-redirects-h" className="text-lg font-medium">{s.redirects.title}</h2>
        <p className="text-muted-foreground text-sm">{s.redirects.hint.replace('{max}', String(SITE_REDIRECTS_MAX))}</p>
        <ul className="space-y-2" data-testid="studio-site-redirects">
          {draft.redirects.map((r, i) => (
            <li key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input aria-label={s.redirects.from} dir="ltr" placeholder="/old-page" value={r.from} onChange={(e) => set('redirects', draft.redirects.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} />
              <Input aria-label={s.redirects.to} dir="ltr" placeholder="/en/videos/" value={r.to} onChange={(e) => set('redirects', draft.redirects.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} />
              <Button type="button" variant="ghost" onClick={() => set('redirects', draft.redirects.filter((_, j) => j !== i))}>{s.redirects.remove}</Button>
            </li>
          ))}
        </ul>
        <Button type="button" variant="outline" disabled={draft.redirects.length >= SITE_REDIRECTS_MAX} onClick={() => set('redirects', [...draft.redirects, { from: '/', to: '/' }])} data-testid="studio-site-redirect-add">
          {s.redirects.add}
        </Button>
      </section>

      <div className="bg-background sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-border py-3">
        <Button type="button" onClick={save} disabled={!dirty || !!problem || busy !== null} data-testid="studio-site-save">
          {busy === 'save' ? s.saving : s.save}
        </Button>
        <Button type="button" variant="outline" onClick={preview} disabled={!!problem || busy !== null} data-testid="studio-site-preview">
          {s.preview}
        </Button>
        <p role="status" aria-live="polite" className={`text-sm ${status?.tone === 'error' ? 'text-destructive' : 'text-muted-foreground'}`} data-testid="studio-site-message">
          {problem ? (s.errors as Record<string, string>)[problem] : status?.text}
          {status?.conflict && (
            <Button type="button" variant="link" onClick={() => window.location.reload()}>{s.reload}</Button>
          )}
        </p>
      </div>

      {previewUrl && (
        <section aria-labelledby="site-preview-h" className="space-y-2">
          <h2 id="site-preview-h" className="text-lg font-medium">{s.previewTitle}</h2>
          <p className="text-muted-foreground text-sm">{s.previewHint}</p>
          <iframe title={s.previewTitle} src={previewUrl} className="h-[70vh] w-full rounded-md border border-border" sandbox="allow-scripts allow-same-origin allow-popups" data-testid="studio-site-preview-frame" />
        </section>
      )}
    </div>
  );
}
