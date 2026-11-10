'use client';
// Controls for one value of a theme package: colours (with their WCAG AA result), CSS values with
// gradient and shadow builders, and lengths with sliders.
import { useId, useState } from 'react';
import { BASE, BRAND_NAMES, resolveColor, type Mode, type ThemePackage } from '@al-ummah/theme-packages';
import { useLanguage } from '@/i18n/I18nProvider';
import { fieldClass } from '@/components/ui';
import type { ContrastCheck } from './contrast';

const ROLE_REFS = BASE.roles.map((r) => `{color.${r.name}}`);
const BRAND_REFS = BRAND_NAMES.map((n) => `{brand.${n}}`);
const HEX = /^#[0-9a-f]{6}$/;
const small = 'text-xs text-fg-muted';
const btn = 'text-xs font-medium px-2 py-1 rounded border border-border bg-surface-2 hover:bg-surface-hover text-fg';

export function IssueText({ messages, testId }: { messages: string[]; testId?: string }) {
  if (!messages.length) return null;
  return <p role="alert" className="text-xs text-danger-fg mt-1" data-testid={testId ?? 'field-error'}>{messages.join(' · ')}</p>;
}

function ContrastBadge({ checks }: { checks: ContrastCheck[] }) {
  const { t } = useLanguage();
  if (!checks.length) return null;
  const worst = checks[0];
  const pass = worst.ratio >= worst.min;
  const label = pass
    ? t('themeBuilder.contrastOk', { ratio: worst.ratio.toFixed(2), against: worst.against })
    : t('themeBuilder.contrastFail', { ratio: worst.ratio.toFixed(2), against: worst.against, min: worst.min });
  return (
    <span data-testid="contrast-badge" data-pass={pass} className={`text-[11px] px-1.5 py-0.5 rounded ${pass ? 'bg-chip-resolved-bg text-chip-resolved-fg' : 'bg-danger-bg text-danger-fg'}`} dir="ltr">
      {pass ? 'AA ✓ ' : 'AA ✗ '}{label}
    </span>
  );
}

/** A colour slot: a hex value or a reference to a role or brand colour. */
export function ColorField({ label, value, onChange, theme, mode, checks = [], errors = [], allowRoleRefs = true, readOnly, testId }: {
  label: string; value: string; onChange: (v: string) => void; theme: ThemePackage; mode: Mode; checks?: ContrastCheck[]; errors?: string[]; allowRoleRefs?: boolean; readOnly?: boolean; testId?: string;
}) {
  const { t } = useLanguage();
  const id = useId();
  // An unresolvable value (half typed, unknown reference) has no swatch; the validator names it
  let hex: string | null = null;
  try { const r = resolveColor(theme, mode, value); if (HEX.test(r)) hex = r; } catch { hex = null; }
  const isRef = value.startsWith('{');
  return (
    <div className="py-1.5" data-testid={testId} data-value={value}>
      <div className="flex items-center gap-2 flex-wrap">
        {hex
          ? <input type="color" aria-label={label} value={hex} disabled={readOnly} onChange={(e) => onChange(e.target.value.toLowerCase())} className="h-8 w-10 rounded border border-border bg-transparent p-0.5" />
          : <span aria-hidden="true" className="h-8 w-10 rounded border border-dashed border-danger-border" />}
        <label htmlFor={id} className="text-sm text-fg min-w-[9rem] font-mono" dir="ltr">{label}</label>
        <input id={id} dir="ltr" value={value} readOnly={readOnly} onChange={(e) => onChange(e.target.value.trim())} className={`${fieldClass} !py-1 text-sm font-mono w-44`} data-testid={testId ? `${testId}-text` : undefined} />
        <select aria-label={t('themeBuilder.linkTo')} disabled={readOnly} value={isRef ? value : ''} onChange={(e) => e.target.value && onChange(e.target.value)} className={`${fieldClass} !py-1 text-xs w-40`} dir="ltr">
          <option value="">{t('themeBuilder.linkTo')}</option>
          {(allowRoleRefs ? [...ROLE_REFS, ...BRAND_REFS] : BRAND_REFS).map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <ContrastBadge checks={checks} />
      </div>
      <IssueText messages={errors} />
    </div>
  );
}

const SHADOW_FIELDS = /edge|Edge|shadow|Shadow|Glow|glow|frame|inner|ring|thumbnail/;
const LENGTH_FIELDS = /Width|Height|radius|Radius/;
const GRADIENT_FIELDS = /background|border|hover|pressed|active|selection|indicator$|page|bar$|played|handle$|big$|menu$|err$/;

export function helperFor(name: string): 'shadow' | 'length' | 'gradient' | null {
  if (LENGTH_FIELDS.test(name)) return 'length';
  if (SHADOW_FIELDS.test(name)) return 'shadow';
  if (GRADIENT_FIELDS.test(name)) return 'gradient';
  return null;
}

/** A CSS value (with {references}) and, where it helps, a builder that writes it. */
export function CssValueField({ name, label, value, onChange, errors = [], readOnly, testId }: {
  name: string; label: string; value: string; onChange: (v: string) => void; errors?: string[]; readOnly?: boolean; testId?: string;
}) {
  const { t } = useLanguage();
  const id = useId();
  const helper = helperFor(name);
  const [open, setOpen] = useState(false);
  return (
    <div className="py-2 border-b border-border last:border-0" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-fg font-mono" dir="ltr">{label}</label>
        {helper && helper !== 'length' && !readOnly && (
          <button type="button" className={btn} onClick={() => setOpen(!open)} aria-expanded={open} data-testid={testId ? `${testId}-helper` : undefined}>
            {helper === 'shadow' ? t('themeBuilder.shadow') : t('themeBuilder.gradient')}
          </button>
        )}
      </div>
      {helper === 'length'
        ? <LengthInput id={id} value={value} onChange={onChange} readOnly={readOnly} />
        : <textarea id={id} dir="ltr" rows={value.length > 90 ? 3 : 1} value={value} readOnly={readOnly} onChange={(e) => onChange(e.target.value)} className={`${fieldClass} w-full mt-1 text-xs font-mono`} data-testid={testId ? `${testId}-text` : undefined} />}
      {open && helper === 'gradient' && <GradientBuilder onApply={(v) => { onChange(v); setOpen(false); }} onAddLayer={(v) => { onChange(`${v},${value}`); setOpen(false); }} />}
      {open && helper === 'shadow' && <ShadowBuilder onApply={(v) => { onChange(v); setOpen(false); }} />}
      <IssueText messages={errors} />
    </div>
  );
}

export function LengthInput({ id, value, onChange, readOnly, max = 64 }: { id?: string; value: string; onChange: (v: string) => void; readOnly?: boolean; max?: number }) {
  const n = parseFloat(value);
  const unit = /px$/.test(value) || !Number.isFinite(n) ? 'px' : value.replace(/^-?[\d.]+/, '');
  return (
    <div className="flex items-center gap-2 mt-1">
      <input type="range" min={0} max={Math.max(max, Number.isFinite(n) ? n : 0)} step={1} value={Number.isFinite(n) ? n : 0} disabled={readOnly} onChange={(e) => onChange(`${e.target.value}${unit}`)} className="flex-1" aria-label={id} />
      <input id={id} dir="ltr" value={value} readOnly={readOnly} onChange={(e) => onChange(e.target.value.trim())} className={`${fieldClass} !py-1 w-24 text-sm font-mono`} />
    </div>
  );
}

/** Colour for a builder: a token reference, a hex, optionally faded with color-mix. */
function TokenColor({ value, onChange }: { value: { ref: string; alpha: number }; onChange: (v: { ref: string; alpha: number }) => void }) {
  const { t } = useLanguage();
  return (
    <span className="inline-flex items-center gap-1">
      <select value={value.ref} onChange={(e) => onChange({ ...value, ref: e.target.value })} className={`${fieldClass} !py-0.5 text-xs w-44`} dir="ltr">
        {[...ROLE_REFS, ...BRAND_REFS, 'transparent', 'black', 'white'].map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      <input type="range" min={0} max={100} value={value.alpha} onChange={(e) => onChange({ ...value, alpha: Number(e.target.value) })} aria-label={t('themeBuilder.opacity')} className="w-20" />
      <span className={small}>{value.alpha}%</span>
    </span>
  );
}

const colorCss = ({ ref, alpha }: { ref: string; alpha: number }) => (alpha >= 100 || ref === 'transparent' ? ref : `color-mix(in srgb,${ref} ${alpha}%,transparent)`);

function GradientBuilder({ onApply, onAddLayer }: { onApply: (v: string) => void; onAddLayer: (v: string) => void }) {
  const { t } = useLanguage();
  const [kind, setKind] = useState<'linear' | 'radial'>('linear');
  const [angle, setAngle] = useState(180);
  const [stops, setStops] = useState([{ c: { ref: '{color.surfaceRaised}', alpha: 100 }, at: 0 }, { c: { ref: '{color.surface}', alpha: 100 }, at: 100 }]);
  const css = `${kind === 'linear' ? `linear-gradient(${angle}deg,` : 'radial-gradient(80% 60% at 50% 0%,'}${stops.map((s) => `${colorCss(s.c)} ${s.at}%`).join(',')})`;
  return (
    <div className="mt-2 p-3 rounded border border-border bg-surface-2 space-y-2" data-testid="gradient-builder">
      <div className="flex gap-3 items-center text-xs">
        <label className="flex items-center gap-1"><input type="radio" checked={kind === 'linear'} onChange={() => setKind('linear')} />{t('themeBuilder.linear')}</label>
        <label className="flex items-center gap-1"><input type="radio" checked={kind === 'radial'} onChange={() => setKind('radial')} />{t('themeBuilder.radial')}</label>
        {kind === 'linear' && <label className="flex items-center gap-1">{t('themeBuilder.angle')}<input type="range" min={0} max={360} value={angle} onChange={(e) => setAngle(Number(e.target.value))} />{angle}°</label>}
      </div>
      <p className={small}>{t('themeBuilder.stops')}</p>
      {stops.map((s, i) => (
        <div key={i} className="flex items-center gap-2 flex-wrap">
          <TokenColor value={s.c} onChange={(c) => setStops(stops.map((x, j) => (j === i ? { ...x, c } : x)))} />
          <input type="range" min={0} max={100} value={s.at} onChange={(e) => setStops(stops.map((x, j) => (j === i ? { ...x, at: Number(e.target.value) } : x)))} className="w-24" aria-label="%" />
          <span className={small}>{s.at}%</span>
          {stops.length > 2 && <button type="button" className={btn} onClick={() => setStops(stops.filter((_, j) => j !== i))}>{t('themeBuilder.remove')}</button>}
        </div>
      ))}
      <div className="h-8 rounded border border-border" style={{ background: css.replace(/\{(?:color|brand)\.[a-zA-Z]+\}/g, 'gray') }} aria-hidden="true" />
      <code className="block text-[11px] break-all" dir="ltr">{css}</code>
      <div className="flex gap-2">
        <button type="button" className={btn} onClick={() => setStops([...stops, { c: { ref: '{color.primary}', alpha: 30 }, at: 50 }])}>{t('themeBuilder.addStop')}</button>
        <button type="button" className={btn} onClick={() => onApply(css)} data-testid="gradient-apply">{t('themeBuilder.apply')}</button>
        <button type="button" className={btn} onClick={() => onAddLayer(css)}>{t('themeBuilder.addLayer')}</button>
      </div>
    </div>
  );
}

function ShadowBuilder({ onApply }: { onApply: (v: string) => void }) {
  const { t } = useLanguage();
  const [layers, setLayers] = useState([{ inset: false, x: 0, y: 12, blur: 30, spread: -12, c: { ref: '{color.primary}', alpha: 40 } }]);
  const css = layers.map((l) => `${l.inset ? 'inset ' : ''}${l.x}px ${l.y}px ${l.blur}px ${l.spread}px ${colorCss(l.c)}`).join(',');
  const set = (i: number, patch: Partial<(typeof layers)[number]>) => setLayers(layers.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const slider = (i: number, key: 'x' | 'y' | 'blur' | 'spread', label: string, min: number, max: number) => (
    <label className="flex items-center gap-1 text-xs">{label}<input type="range" min={min} max={max} value={layers[i][key]} onChange={(e) => set(i, { [key]: Number(e.target.value) })} className="w-20" />{layers[i][key]}</label>
  );
  return (
    <div className="mt-2 p-3 rounded border border-border bg-surface-2 space-y-2" data-testid="shadow-builder">
      {layers.map((l, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={l.inset} onChange={(e) => set(i, { inset: e.target.checked })} />{t('themeBuilder.inset')}</label>
          {slider(i, 'x', t('themeBuilder.offsetX'), -40, 40)}{slider(i, 'y', t('themeBuilder.offsetY'), -40, 60)}{slider(i, 'blur', t('themeBuilder.blur'), 0, 80)}{slider(i, 'spread', t('themeBuilder.spread'), -40, 20)}
          <TokenColor value={l.c} onChange={(c) => set(i, { c })} />
          {layers.length > 1 && <button type="button" className={btn} onClick={() => setLayers(layers.filter((_, j) => j !== i))}>{t('themeBuilder.remove')}</button>}
        </div>
      ))}
      <code className="block text-[11px] break-all" dir="ltr">{css}</code>
      <div className="flex gap-2">
        <button type="button" className={btn} onClick={() => setLayers([...layers, { inset: true, x: 0, y: 1, blur: 0, spread: 0, c: { ref: '{color.primarySheen}', alpha: 50 } }])}>{t('themeBuilder.addLayer')}</button>
        <button type="button" className={btn} onClick={() => onApply(css)} data-testid="shadow-apply">{t('themeBuilder.apply')}</button>
      </div>
    </div>
  );
}
