'use client';
// The live preview: the package compiled in the browser on every edit, rendered into an iframe with
// the videos site's own component stylesheets. Phone or desktop, light or dark, English or Arabic.
import { useEffect, useMemo, useRef, useState } from 'react';
import { compilePackage, type ThemePackage } from '@al-ummah/theme-packages';
import { useLanguage } from '@/i18n/I18nProvider';
import { previewDocument, type PreviewPage } from './preview-document';

const seg = 'px-2.5 py-1 text-xs font-medium border border-border first:rounded-s last:rounded-e -ms-px first:ms-0';
const on = 'bg-accent text-on-accent';
const off = 'bg-surface-2 text-fg hover:bg-surface-hover';

function Segmented<T extends string>({ value, options, onChange, label, testId }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string; testId: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex" data-testid={testId}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)} className={`${seg} ${v === value ? on : off}`} data-testid={`${testId}-${v}`}>{text}</button>
      ))}
    </div>
  );
}

/** `followMode` is the mode being edited: the preview switches to it whenever it changes. */
export function Preview({ theme, assetUrl, followMode }: { theme: ThemePackage; assetUrl: (path: string) => string; followMode?: 'light' | 'dark' }) {
  const { t, locale } = useLanguage();
  const [page, setPage] = useState<PreviewPage>('home');
  const [mode, setMode] = useState<'light' | 'dark'>(followMode ?? 'dark');
  useEffect(() => { if (followMode) setMode(followMode); }, [followMode]);
  const [lang, setLang] = useState<'en' | 'ar'>(locale === 'ar' ? 'ar' : 'en');
  const [device, setDevice] = useState<'desktop' | 'phone'>('desktop');
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  // Compiling may throw on a half-typed value; keep the last good CSS
  const [css, setCss] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      try { setCss(compilePackage(theme, { assetUrl }).css); } catch { /* the validator names the problem */ }
    }, 120);
    return () => clearTimeout(timer);
  }, [theme, assetUrl]);

  const width = device === 'phone' ? 390 : 1280;
  const height = device === 'phone' ? 844 : 860;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientWidth / width));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [width]);

  // The page structure changes with page/lang/mode; theme edits only swap the <style> in place
  const doc = useMemo(() => previewDocument({ themeId: theme.id, css: '', page, mode, lang }), [theme.id, page, mode, lang]);
  useEffect(() => {
    const d = frame.current?.contentDocument;
    const style = d?.getElementById('pv-theme');
    if (style) style.textContent = css;
  }, [css, doc]);

  return (
    <section aria-label={t('themeBuilder.preview')} className="flex flex-col gap-2" data-testid="theme-preview">
      <div className="flex flex-wrap gap-2 items-center">
        <Segmented testId="preview-page" label={t('themeBuilder.preview')} value={page} onChange={setPage} options={[['home', t('themeBuilder.pageHome')], ['watch', t('themeBuilder.pageWatch')], ['settings', t('themeBuilder.pageSettings')], ['components', t('themeBuilder.pageComponents')]]} />
        <Segmented testId="preview-mode" label="mode" value={mode} onChange={setMode} options={[['light', t('themeBuilder.modeLight')], ['dark', t('themeBuilder.modeDark')]]} />
        <Segmented testId="preview-lang" label="lang" value={lang} onChange={setLang} options={[['en', 'English'], ['ar', 'العربية']]} />
        <Segmented testId="preview-device" label="device" value={device} onChange={setDevice} options={[['desktop', t('themeBuilder.desktop')], ['phone', t('themeBuilder.phone')]]} />
      </div>
      <div ref={box} className="w-full overflow-hidden rounded border border-border bg-surface-2" style={{ height: height * scale }}>
        <iframe
          ref={frame}
          title={t('themeBuilder.preview')}
          srcDoc={doc}
          onLoad={() => { const s = frame.current?.contentDocument?.getElementById('pv-theme'); if (s) s.textContent = css; }}
          data-testid="theme-preview-frame"
          style={{ width, height, transform: `scale(${scale})`, transformOrigin: locale === 'ar' ? 'top right' : 'top left', border: 0, display: 'block', marginInlineStart: device === 'phone' ? `calc(50% - ${(width * scale) / 2}px)` : 0 }}
        />
      </div>
    </section>
  );
}
