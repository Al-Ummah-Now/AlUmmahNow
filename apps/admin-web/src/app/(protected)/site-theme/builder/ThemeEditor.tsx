'use client';
// The theme builder's editor for one custom theme: every token and component section, files,
// inline validation, save draft, publish and use as the site theme.
import { useCallback, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BASE, BRAND_NAMES, COMPONENT_PARTS, ELEVATION_NAMES, MATERIAL_VARS, PLAYER_TOKENS, RADIUS_NAMES, validatePackage,
  type Issue, type Mode, type ThemePackage,
} from '@al-ummah/theme-packages';
import { useLanguage } from '@/i18n/I18nProvider';
import { useConfirm } from '@/components/content/actions';
import type { MessageKey } from '@/i18n/translate';
import { setSiteTheme } from '@/lib/api/admin';
import { ErrorAlert, cardClass, fieldClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { ThemeApiError, deleteAsset, draftAssetUrl, exportUrl, publish, saveDraft, uploadAsset } from './api';
import { partContrast, roleContrast } from './contrast';
import { ColorField, CssValueField, IssueText, LengthInput } from './fields';
import { Preview } from './Preview';

type Section = 'general' | 'colours' | 'components' | 'materials' | 'typography' | 'imagery' | 'assets';
const SECTIONS: [Section, MessageKey][] = [
  ['general', 'themeBuilder.sectionGeneral'], ['colours', 'themeBuilder.sectionColours'], ['components', 'themeBuilder.sectionComponents'],
  ['materials', 'themeBuilder.sectionMaterials'], ['typography', 'themeBuilder.sectionTypography'], ['imagery', 'themeBuilder.sectionImagery'], ['assets', 'themeBuilder.sectionAssets'],
];
const FONT_FAMILIES = ['Inter', 'IBM Plex Sans', 'IBM Plex Sans Arabic', 'Noto Kufi Arabic', 'Amiri', 'Source Serif 4', 'Georgia', 'system-ui', 'sans-serif', 'serif'];
const IMAGE_SLOTS: { slot: string; modes?: boolean; accept: string }[] = [
  { slot: 'logo', modes: true, accept: 'image/png,image/svg+xml,image/webp,image/jpeg' },
  { slot: 'wordmark', modes: true, accept: 'image/png,image/svg+xml,image/webp,image/jpeg' },
  { slot: 'headerGraphic', modes: true, accept: 'image/svg+xml' },
  { slot: 'pattern', accept: 'image/svg+xml' }, { slot: 'ornament', accept: 'image/svg+xml' },
  { slot: 'backdrop', accept: 'image/png,image/svg+xml,image/webp,image/jpeg' }, { slot: 'hero', accept: 'image/png,image/svg+xml,image/webp,image/jpeg' },
  { slot: 'loader', accept: 'image/svg+xml' }, { slot: 'favicon', accept: 'image/x-icon,.ico' }, { slot: 'ogImage', accept: 'image/png,image/jpeg' },
];
const MAX_FILE = 2 * 1024 * 1024;

function setIn<T>(obj: T, path: (string | number)[], value: unknown): T {
  const copy = structuredClone(obj) as Record<string | number, unknown>;
  let at = copy;
  for (const key of path.slice(0, -1)) {
    if (at[key] === undefined || at[key] === null || typeof at[key] !== 'object') at[key] = {};
    at = at[key] as Record<string | number, unknown>;
  }
  const last = path[path.length - 1];
  if (value === undefined) delete at[last];
  else at[last] = value;
  return copy as T;
}

const safeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'file';

export interface EditorProps {
  initial: ThemePackage;
  assets: { path: string; size: number }[];
  latestVersion: string | null;
  activeVersion: string | null;
  canEdit: boolean;
}

export function ThemeEditor({ initial, assets: initialAssets, latestVersion: initialLatest, activeVersion: initialActive, canEdit }: EditorProps) {
  const { t, locale } = useLanguage();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const router = useRouter();
  const [theme, setTheme] = useState<ThemePackage>(initial);
  const [saved, setSaved] = useState<ThemePackage>(initial);
  const [assets, setAssets] = useState(initialAssets);
  const [section, setSection] = useState<Section>('colours');
  const [mode, setMode] = useState<Mode>('dark');
  const [component, setComponent] = useState('header');
  const [serverIssues, setServerIssues] = useState<Issue[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [latest, setLatest] = useState(initialLatest);
  const [active, setActive] = useState(initialActive);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<'save' | 'publish' | 'activate' | 'upload' | null>(null);
  const [assetVersion, setAssetVersion] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<((path: string) => void) | null>(null);

  const dirty = JSON.stringify(theme) !== JSON.stringify(saved);
  const update = useCallback((path: (string | number)[], value: unknown) => setTheme((prev) => setIn(prev, path, value)), []);

  // Live validation: schema, references and contrast. Files are checked by the server on save.
  const live = useMemo(() => validatePackage(theme), [theme]);
  const assetPaths = useMemo(() => new Set(assets.map((a) => a.path)), [assets]);
  const fileIssues = useMemo(() => {
    const out: Issue[] = [];
    const walk = (v: unknown, path: string) => {
      if (typeof v === 'string') {
        const files = v.startsWith('assets/') ? [v] : [...v.matchAll(/\{asset:(assets\/[^}]+)\}/g)].map((m) => m[1]);
        for (const f of files) if (!assetPaths.has(f)) out.push({ path, message: `names ${f}, which is not in the package` });
      } else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
    };
    walk(theme, '');
    return out;
  }, [theme, assetPaths]);
  const issues = useMemo(() => {
    const seen = new Set<string>();
    return [...live.errors, ...fileIssues, ...serverIssues.filter((i) => i.path.startsWith('assets/'))].filter((i) => (seen.has(`${i.path}${i.message}`) ? false : (seen.add(`${i.path}${i.message}`), true)));
  }, [live, fileIssues, serverIssues]);
  const errorsAt = (path: string) => issues.filter((i) => i.path === path).map((i) => i.message);

  const assetUrl = useMemo(() => {
    const base = draftAssetUrl(theme.id);
    return (path: string) => `${base(path)}?v=${assetVersion}`;
  }, [theme.id, assetVersion]);

  const run = (kind: NonNullable<typeof busy>, task: () => Promise<void>) => start(async () => {
    setBusy(kind); setFailure(null); setNotice(null);
    try { await task(); } catch (e) {
      if (e instanceof ThemeApiError) { setServerIssues(e.issues); setFailure(t('themeBuilder.failed', { error: e.message })); } else setFailure(t('themeBuilder.failed', { error: String(e) }));
    } finally { setBusy(null); }
  });

  const save = () => run('save', async () => {
    const result = await saveDraft(theme.id, theme);
    setSaved(theme);
    setServerIssues(result.validation.errors);
    setNotice(t('themeBuilder.saved'));
  });
  const doPublish = () => run('publish', async () => {
    if (dirty) { await saveDraft(theme.id, theme); setSaved(theme); }
    const { version } = await publish(theme.id);
    const next = { ...theme, version };
    setTheme(next); setSaved(next); setLatest(version); setServerIssues([]);
    setNotice(t('themeBuilder.publishedOk', { version }));
    router.refresh();
  });
  const activate = () => run('activate', async () => {
    if (!latest) return;
    await setSiteTheme(theme.id, latest);
    setActive(latest);
    setNotice(t('themeBuilder.setActiveOk', { name: theme.name[locale], version: latest }));
    router.refresh();
  });

  /** Uploads a file into assets/ and hands back its path. */
  const chooseFile = (accept: string, then: (path: string) => void) => {
    uploadTarget.current = then;
    if (fileInput.current) { fileInput.current.accept = accept; fileInput.current.value = ''; fileInput.current.click(); }
  };
  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_FILE) { setFailure(t('themeBuilder.fileTooBig')); return; }
    const folder = file.name.toLowerCase().endsWith('.woff2') ? 'assets/fonts/' : 'assets/';
    const path = `${folder}${safeName(file.name)}`;
    run('upload', async () => {
      await uploadAsset(theme.id, path, file);
      setAssets((prev) => [...prev.filter((a) => a.path !== path), { path, size: file.size }].sort((a, b) => a.path.localeCompare(b.path)));
      setAssetVersion((v) => v + 1);
      uploadTarget.current?.(path);
    });
  };
  const removeFile = async (path: string) => {
    const confirmed = await confirm({
      title: t('confirmDialog.themeAssetTitle'),
      body: t('confirmDialog.themeAssetBody', { path }),
      confirmLabel: t('themeBuilder.delete'),
      danger: true,
      testId: 'theme-asset-delete-confirm',
    });
    if (!confirmed) return;
    run('upload', async () => {
      await deleteAsset(theme.id, path);
      setAssets((prev) => prev.filter((a) => a.path !== path));
    });
  };

  const readOnly = !canEdit;
  const componentNames = Object.keys(COMPONENT_PARTS);
  const styleFields = MATERIAL_VARS.map(([p]) => p).filter((p) => p.startsWith(`components.${component}.style.`)).map((p) => p.split('.').pop()!);
  const partNames = (group: string) => BASE.parts.filter((p) => p.part.slice(0, p.part.lastIndexOf('.')) === group).map((p) => p.part.slice(p.part.lastIndexOf('.') + 1));

  return (
    <div data-testid="theme-editor" data-theme-id={theme.id}>
      {confirmDialog}
      <input ref={fileInput} type="file" className="hidden" data-testid="asset-file-input" onChange={(e) => onFile(e.target.files?.[0])} />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <Link href="/site-theme" className="text-sm text-link underline">{t('themeBuilder.back')}</Link>
          <h1 className="text-2xl font-bold text-fg">{theme.name?.[locale] || theme.id} <span className="text-sm font-normal text-fg-muted" dir="ltr">{theme.id}</span></h1>
          <p className="text-sm text-fg-muted" data-testid="theme-editor-status">
            {latest ? t('themeBuilder.published', { version: latest }) : t('themeBuilder.notPublished')}
            {active && <> · <strong data-testid="theme-editor-active">{t('themeBuilder.active')} ({active})</strong></>}
            {dirty && <> · <span data-testid="theme-editor-dirty">{t('themeBuilder.unsaved')}</span></>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={exportUrl(theme.id)} className={secondaryButtonClass} data-testid="theme-export">{t('themeBuilder.export')}</a>
          {canEdit && <button type="button" className={secondaryButtonClass} disabled={pending || !dirty} onClick={save} data-testid="theme-save">{busy === 'save' ? t('themeBuilder.saving') : t('themeBuilder.save')}</button>}
          {canEdit && <button type="button" className={primaryButtonClass} disabled={pending || issues.length > 0} onClick={doPublish} data-testid="theme-publish">{busy === 'publish' ? t('themeBuilder.publishing') : t('themeBuilder.publish')}</button>}
          {canEdit && latest && active !== latest && <button type="button" className={secondaryButtonClass} disabled={pending || dirty} onClick={activate} data-testid="theme-activate">{t('themeBuilder.useAsSite')} ({latest})</button>}
        </div>
      </div>
      {!canEdit && <p className="text-fg-muted mb-3">{t('themeBuilder.adminOnly')}</p>}
      {failure && <ErrorAlert testId="theme-editor-failed">{failure}</ErrorAlert>}
      {notice && <p role="status" className="mb-3 text-sm font-medium text-fg" data-testid="theme-editor-notice">{notice}</p>}
      <details className={`${cardClass} !p-3 mb-4`} open={issues.length > 0 && issues.length < 12} data-testid="theme-issues" data-count={issues.length}>
        <summary className={`text-sm font-medium ${issues.length ? 'text-danger-fg' : 'text-fg'}`}>{issues.length ? t('themeBuilder.errors', { count: issues.length }) : t('themeBuilder.noErrors')}{live.warnings.length ? ` · ${t('themeBuilder.warnings', { count: live.warnings.length })}` : ''}</summary>
        <ul className="mt-2 space-y-1 text-xs" dir="ltr">
          {issues.slice(0, 60).map((i, n) => <li key={n} className="text-danger-fg"><code>{i.path}</code>: {i.message}</li>)}
        </ul>
      </details>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
        <div className={`${cardClass} !p-4 max-h-[calc(100vh-8rem)] overflow-y-auto`}>
          <nav className="flex flex-wrap gap-1 mb-4" aria-label={t('themeBuilder.title')}>
            {SECTIONS.map(([id, key]) => (
              <button key={id} type="button" onClick={() => setSection(id)} aria-pressed={section === id} data-testid={`section-${id}`} className={`text-xs px-2.5 py-1 rounded border border-border ${section === id ? 'bg-accent text-on-accent' : 'bg-surface-2 text-fg'}`}>{t(key)}</button>
            ))}
          </nav>
          {(section === 'colours' || section === 'components') && (
            <div className="flex gap-1 mb-3" role="group" aria-label="mode">
              {(['light', 'dark'] as Mode[]).map((m) => <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} data-testid={`edit-mode-${m}`} className={`text-xs px-2.5 py-1 rounded border border-border ${mode === m ? 'bg-accent text-on-accent' : 'bg-surface-2 text-fg'}`}>{m === 'light' ? t('themeBuilder.modeLight') : t('themeBuilder.modeDark')}</button>)}
            </div>
          )}

          {section === 'general' && (
            <div className="space-y-3">
              {(['en', 'ar'] as const).map((l) => (
                <label key={l} className="block text-sm text-fg">{l === 'en' ? t('themeBuilder.nameEn') : t('themeBuilder.nameAr')}
                  <input dir={l === 'ar' ? 'rtl' : 'ltr'} className={`${fieldClass} w-full mt-1`} readOnly={readOnly} value={theme.name?.[l] ?? ''} onChange={(e) => update(['name', l], e.target.value)} data-testid={`general-name-${l}`} />
                  <IssueText messages={errorsAt(`name.${l}`)} />
                </label>
              ))}
              {(['en', 'ar'] as const).map((l) => (
                <label key={l} className="block text-sm text-fg">{l === 'en' ? t('themeBuilder.descriptionEn') : t('themeBuilder.descriptionAr')}
                  <input dir={l === 'ar' ? 'rtl' : 'ltr'} className={`${fieldClass} w-full mt-1`} readOnly={readOnly} value={theme.description?.[l] ?? ''} onChange={(e) => update(['description'], { en: theme.description?.en ?? '', ar: theme.description?.ar ?? '', [l]: e.target.value })} />
                </label>
              ))}
              <label className="block text-sm text-fg">{t('themeBuilder.author')}
                <input className={`${fieldClass} w-full mt-1`} readOnly={readOnly} value={theme.author ?? ''} onChange={(e) => update(['author'], e.target.value)} />
              </label>
              {theme.basedOn && <p className="text-xs text-fg-muted">{t('themeBuilder.basedOn', { base: theme.basedOn })}</p>}
            </div>
          )}

          {section === 'colours' && (
            <div>
              <h2 className="text-sm font-semibold text-fg mt-1">{t('themeBuilder.roleColours', { mode: mode === 'light' ? t('themeBuilder.modeLight') : t('themeBuilder.modeDark') })}</h2>
              {BASE.roles.map((r) => (
                <ColorField key={`${mode}-${r.name}`} testId={`role-${mode}-${r.name}`} label={r.name} value={theme.tokens.color[mode][r.name] ?? ''} theme={theme} mode={mode} readOnly={readOnly}
                  onChange={(v) => update(['tokens', 'color', mode, r.name], v)} checks={roleContrast(theme, mode, r.name)} errors={errorsAt(`tokens.color.${mode}.${r.name}`)} />
              ))}
              <h2 className="text-sm font-semibold text-fg mt-4">{t('themeBuilder.brandColours')}</h2>
              {BRAND_NAMES.map((n) => (
                <ColorField key={n} testId={`brand-${n}`} label={n} value={theme.tokens.brand[n] ?? ''} theme={theme} mode={mode} allowRoleRefs={false} readOnly={readOnly}
                  onChange={(v) => update(['tokens', 'brand', n], v)} errors={errorsAt(`tokens.brand.${n}`)} />
              ))}
            </div>
          )}

          {section === 'components' && (
            <div>
              <label className="block text-sm text-fg mb-2">{t('themeBuilder.component')}
                <select className={`${fieldClass} w-full mt-1`} value={component} onChange={(e) => setComponent(e.target.value)} data-testid="component-select">
                  {componentNames.map((c) => <option key={c} value={c}>{t(`themeBuilder.components.${c}` as MessageKey)}</option>)}
                </select>
              </label>
              {COMPONENT_PARTS[component] && (
                <>
                  <h2 className="text-sm font-semibold text-fg mt-2">{t('themeBuilder.colours', { mode: mode === 'light' ? t('themeBuilder.modeLight') : t('themeBuilder.modeDark') })}</h2>
                  {partNames(COMPONENT_PARTS[component]!).map((p) => {
                    const part = `${COMPONENT_PARTS[component]}.${p}`;
                    return (
                      <ColorField key={`${component}-${mode}-${p}`} testId={`part-${component}-${mode}-${p}`} label={part} value={theme.components[component]?.colors?.[mode]?.[p] ?? ''} theme={theme} mode={mode} readOnly={readOnly}
                        onChange={(v) => update(['components', component, 'colors', mode, p], v)} checks={partContrast(theme, mode, part)} errors={errorsAt(`components.${component}.colors.${mode}.${p}`)} />
                    );
                  })}
                </>
              )}
              {styleFields.length > 0 && <h2 className="text-sm font-semibold text-fg mt-4">{t('themeBuilder.style')}</h2>}
              {styleFields.map((f) => (
                <CssValueField key={`${component}-${f}`} testId={`style-${component}-${f}`} name={f} label={f} value={theme.components[component]?.style?.[f] ?? ''} readOnly={readOnly}
                  onChange={(v) => update(['components', component, 'style', f], v)} errors={errorsAt(`components.${component}.style.${f}`)} />
              ))}
              {component === 'player' && (
                <>
                  <h2 className="text-sm font-semibold text-fg mt-4">{t('themeBuilder.chrome')}</h2>
                  {PLAYER_TOKENS.map((f) => (
                    <CssValueField key={f} testId={`chrome-${f}`} name={f} label={f} value={theme.components.player?.chrome?.[f] ?? ''} readOnly={readOnly}
                      onChange={(v) => update(['components', 'player', 'chrome', f], v)} errors={errorsAt(`components.player.chrome.${f}`)} />
                  ))}
                </>
              )}
            </div>
          )}

          {section === 'materials' && (
            <div>
              <h2 className="text-sm font-semibold text-fg">{t('themeBuilder.radii')}</h2>
              {(['sm', 'md', 'lg', 'xl', 'pill'] as const).map((r) => (
                <label key={r} className="block text-xs text-fg mt-2" dir="ltr">radius.{r}
                  <LengthInput value={theme.materials.radius[r] ?? ''} readOnly={readOnly} max={r === 'pill' ? 999 : 40} onChange={(v) => update(['materials', 'radius', r], v)} />
                  <IssueText messages={errorsAt(`materials.radius.${r}`)} />
                </label>
              ))}
              <CssValueField name="glow" label={t('themeBuilder.glow')} testId="material-glow" value={theme.materials.glow} readOnly={readOnly} onChange={(v) => update(['materials', 'glow'], v)} errors={errorsAt('materials.glow')} />
              <CssValueField name="blur" label={t('themeBuilder.backdropBlur')} value={theme.materials.blur} readOnly={readOnly} onChange={(v) => update(['materials', 'blur'], v)} errors={errorsAt('materials.blur')} />
              <CssValueField name="hover" label={t('themeBuilder.hover')} value={theme.materials.hover} readOnly={readOnly} onChange={(v) => update(['materials', 'hover'], v)} errors={errorsAt('materials.hover')} />
              <h2 className="text-sm font-semibold text-fg mt-4">{t('themeBuilder.tokenRadii')}</h2>
              {RADIUS_NAMES.map((r) => (
                <label key={r} className="block text-xs text-fg mt-2" dir="ltr">radius.{r}
                  <LengthInput value={theme.tokens.radius[r] ?? ''} readOnly={readOnly} max={r === 'full' ? 999 : 40} onChange={(v) => update(['tokens', 'radius', r], v)} />
                  <IssueText messages={errorsAt(`tokens.radius.${r}`)} />
                </label>
              ))}
              {ELEVATION_NAMES.map((level) => {
                const e = theme.tokens.elevation[level];
                return (
                  <fieldset key={level} className="mt-3 border border-border rounded p-2">
                    <legend className="text-xs font-semibold text-fg px-1">{t('themeBuilder.elevation', { level })}</legend>
                    {(['offsetX', 'offsetY', 'blur', 'spread'] as const).map((k) => (
                      <label key={k} className="block text-xs text-fg" dir="ltr">{k}<LengthInput value={e?.[k] ?? '0px'} readOnly={readOnly} max={64} onChange={(v) => update(['tokens', 'elevation', level, k], v)} /></label>
                    ))}
                    <label className="block text-xs text-fg mt-1" dir="ltr">color (#rrggbbaa)
                      <input className={`${fieldClass} !py-1 w-32 font-mono text-xs ms-2`} readOnly={readOnly} value={e?.color ?? ''} onChange={(ev) => update(['tokens', 'elevation', level, 'color'], ev.target.value.trim())} />
                    </label>
                    <IssueText messages={issues.filter((i) => i.path.startsWith(`tokens.elevation.${level}`)).map((i) => i.message)} />
                  </fieldset>
                );
              })}
            </div>
          )}

          {section === 'typography' && (
            <div className="space-y-3">
              {(['latin', 'arabic'] as const).map((script) => (
                <label key={script} className="block text-sm text-fg">{script === 'latin' ? t('themeBuilder.latinFont') : t('themeBuilder.arabicFont')}
                  <FontSelect value={theme.typography[script]} faces={theme.typography.faces?.map((f) => f.family) ?? []} readOnly={readOnly} onChange={(v) => update(['typography', script], v)} testId={`font-${script}`} />
                </label>
              ))}
              <label className="flex items-center gap-2 text-sm text-fg">
                <input type="checkbox" disabled={readOnly} checked={!!theme.typography.body} onChange={(e) => update(['typography', 'body'], e.target.checked ? { latin: theme.typography.latin, arabic: theme.typography.arabic } : undefined)} data-testid="font-body-toggle" />
                {t('themeBuilder.bodyOverride')}
              </label>
              {theme.typography.body && (['latin', 'arabic'] as const).map((script) => (
                <label key={script} className="block text-sm text-fg">{script === 'latin' ? t('themeBuilder.bodyLatin') : t('themeBuilder.bodyArabic')}
                  <FontSelect value={theme.typography.body![script]} faces={theme.typography.faces?.map((f) => f.family) ?? []} readOnly={readOnly} onChange={(v) => update(['typography', 'body', script], v)} testId={`font-body-${script}`} />
                </label>
              ))}
              <h2 className="text-sm font-semibold text-fg mt-3">{t('themeBuilder.fontFaces')}</h2>
              {(theme.typography.faces ?? []).map((f, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 text-xs" dir="ltr">
                  <input className={`${fieldClass} !py-1 w-36`} readOnly={readOnly} value={f.family} onChange={(e) => update(['typography', 'faces', i, 'family'], e.target.value)} aria-label={t('themeBuilder.family')} />
                  <select className={`${fieldClass} !py-1`} disabled={readOnly} value={f.weight} onChange={(e) => update(['typography', 'faces', i, 'weight'], Number(e.target.value))} aria-label={t('themeBuilder.weight')}>{[300, 400, 500, 600, 700, 800].map((w) => <option key={w}>{w}</option>)}</select>
                  <code>{f.src}</code>
                  {canEdit && <button type="button" className="underline" onClick={() => update(['typography', 'faces'], (theme.typography.faces ?? []).filter((_, j) => j !== i))}>{t('themeBuilder.remove')}</button>}
                </div>
              ))}
              {canEdit && <button type="button" className={secondaryButtonClass} disabled={pending} onClick={() => chooseFile('.woff2,font/woff2', (path) => update(['typography', 'faces'], [...(theme.typography.faces ?? []), { family: path.split('/').pop()!.replace(/\.woff2$/, '').replace(/[^A-Za-z0-9 -]/g, ' ').slice(0, 40), weight: 400, src: path }]))} data-testid="font-upload">{t('themeBuilder.addFont')}</button>}
              <IssueText messages={issues.filter((i) => i.path.startsWith('typography')).map((i) => `${i.path}: ${i.message}`)} />
            </div>
          )}

          {section === 'imagery' && (
            <div className="space-y-3">
              {IMAGE_SLOTS.flatMap(({ slot, modes, accept }) => (modes ? (['light', 'dark'] as Mode[]).map((m) => ({ slot, mode: m, accept })) : [{ slot, mode: null as Mode | null, accept }])).map(({ slot, mode: m, accept }) => {
                const path = m ? ['imagery', slot, m] : ['imagery', slot];
                const raw = m ? (theme.imagery[slot] as Record<string, string> | undefined)?.[m] : (theme.imagery[slot] as string | undefined);
                const key = path.slice(1).join('.');
                return (
                  <div key={key} className="flex items-center gap-3" data-testid={`image-slot-${key}`}>
                    <div className="h-12 w-20 rounded border border-border bg-surface-2 grid place-items-center overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element -- a draft file through the session proxy, not an optimisable image */}
                      {raw && raw !== 'none' && assetPaths.has(raw) ? <img src={assetUrl(raw)} alt="" className="max-h-12 max-w-20 object-contain" /> : <span className="text-[10px] text-fg-muted">{t('themeBuilder.noFile')}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-fg" dir="ltr">{key}</p>
                      <select className={`${fieldClass} !py-1 w-full text-xs`} disabled={readOnly} value={raw ?? ''} onChange={(e) => update(path, e.target.value || undefined)} dir="ltr">
                        <option value="">{t('themeBuilder.noFile')}</option>
                        {slot === 'pattern' && <option value="none">none</option>}
                        {assets.map((a) => <option key={a.path} value={a.path}>{a.path}</option>)}
                      </select>
                      <IssueText messages={errorsAt(`imagery.${key}`)} />
                    </div>
                    {canEdit && <button type="button" className="text-xs underline text-fg" disabled={pending} onClick={() => chooseFile(accept, (p) => update(path, p))} data-testid={`image-upload-${key}`}>{t('themeBuilder.upload')}</button>}
                  </div>
                );
              })}
            </div>
          )}

          {section === 'assets' && (
            <div>
              {canEdit && <button type="button" className={secondaryButtonClass} disabled={pending} onClick={() => chooseFile('image/*,.svg,.ico,.woff2', () => undefined)} data-testid="asset-upload">{busy === 'upload' ? t('themeBuilder.working') : t('themeBuilder.upload')}</button>}
              <ul className="mt-3 space-y-1" data-testid="asset-list">
                {assets.map((a) => (
                  <li key={a.path} className="flex items-center gap-2 text-xs" dir="ltr" data-testid="asset-row" data-path={a.path}>
                    <code className="flex-1 truncate">{a.path}</code><span className="text-fg-muted">{(a.size / 1024).toFixed(1)} KB</span>
                    {!JSON.stringify(theme).includes(a.path) && <span className="text-fg-muted">{t('themeBuilder.unused')}</span>}
                    {canEdit && <button type="button" className="underline" onClick={() => removeFile(a.path)}>{t('themeBuilder.delete')}</button>}
                  </li>
                ))}
              </ul>
              <IssueText messages={issues.filter((i) => i.path.startsWith('assets/')).map((i) => `${i.path} ${i.message}`)} />
            </div>
          )}
        </div>
        <Preview theme={theme} assetUrl={assetUrl} followMode={mode} />
      </div>
    </div>
  );
}

function FontSelect({ value, faces, onChange, readOnly, testId }: { value: string[]; faces: string[]; onChange: (v: string[]) => void; readOnly: boolean; testId: string }) {
  const families = [...new Set([...faces, ...FONT_FAMILIES])];
  const primary = value[0] ?? 'system-ui';
  return (
    <div className="flex gap-2 mt-1">
      <select className={`${fieldClass} flex-1`} disabled={readOnly} value={primary} onChange={(e) => onChange([e.target.value, ...value.slice(1).filter((f) => f !== e.target.value)])} data-testid={testId} dir="ltr" style={{ fontFamily: primary }}>
        {families.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
      </select>
      <input className={`${fieldClass} flex-1 text-xs font-mono`} dir="ltr" readOnly={readOnly} value={value.join(', ')} onChange={(e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} aria-label={testId} />
    </div>
  );
}
