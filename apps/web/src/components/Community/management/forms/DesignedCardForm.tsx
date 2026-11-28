'use client';

import { useEffect, useRef, useState } from 'react';
import { localizeDigits, parseLocaleNumber, type QafPassage } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { QafSourcePicker } from './QafSourcePicker';

type Locale = 'en' | 'ar';
type SourceKind = 'message' | 'quran' | 'qaf';
type Preview = { html: string; width: number; height: number };

export async function cardAction<T>(channelId: string, path = '', body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/studio/cards/${encodeURIComponent(channelId)}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Card request failed');
  return response.json();
}

const field = 'block w-full rounded-md border bg-background p-2';
const label = 'block space-y-1 text-sm font-medium';

function CardPreview({ preview, title }: { preview: Preview; title: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const parsed = new DOMParser().parseFromString(preview.html, 'text/html');
    const sourceStyle = parsed.querySelector('style');
    const picture = parsed.querySelector('main');
    if (!sourceStyle || !picture) return;
    const styles = sourceStyle.textContent ?? '';
    if (!document.querySelector('[data-designed-card-fonts]')) {
      const fonts = document.createElement('style');
      fonts.dataset.designedCardFonts = '';
      fonts.textContent = styles.match(/@font-face[^}]+}/g)?.join('\n') ?? '';
      document.head.append(fonts);
    }
    const style = document.createElement('style');
    style.textContent = styles.replace(/@font-face[^}]+}/g, '').replace('html {', ':host {');
    const canvas = document.createElement('div');
    canvas.dir = parsed.documentElement.dir;
    canvas.lang = parsed.documentElement.lang;
    canvas.style.cssText = `width:${preview.width}px;height:${preview.height}px;transform-origin:top left;position:absolute;left:0;top:0;font-family:SourceSerif,Amiri,serif`;
    canvas.append(picture);
    const root = element.shadowRoot ?? element.attachShadow({ mode: 'open' });
    root.replaceChildren(style, canvas);
    const resize = new ResizeObserver(([entry]) => {
      canvas.style.transform = `scale(${entry.contentRect.width / preview.width})`;
    });
    resize.observe(element);
    const text = canvas.querySelector('blockquote');
    void Promise.all([document.fonts.load('32px Amiri', 'ع'), document.fonts.load('32px SourceSerif', 'A')]).then(() => {
      if (!text) return;
      for (let size = 76; size >= 22; size -= 2) {
        text.style.fontSize = `${size}px`;
        if (text.scrollHeight <= text.clientHeight) break;
      }
    }).catch(() => {});
    return () => resize.disconnect();
  }, [preview]);
  return <div ref={host} aria-label={title} className="relative mx-auto w-full max-w-md overflow-hidden rounded-lg" style={{ aspectRatio: preview.width / preview.height }} />;

}

export function DesignedCardForm({ channelId, locale, onPublished }: { channelId: string; locale: Locale; onPublished: () => void }) {
  const ar = locale === 'ar';
  const pick = (en: string, arabic: string) => ar ? arabic : en;
  const [kind, setKind] = useState<SourceKind>('quran');
  const [surah, setSurah] = useState('');
  const [ayah, setAyah] = useState('');
  const [message, setMessage] = useState('');
  const [passage, setPassage] = useState<QafPassage | null>(null);
  const [template, setTemplate] = useState('fawanees');
  const [palette, setPalette] = useState(0);
  const [format, setFormat] = useState('square');
  const [preview, setPreview] = useState<{ image: Preview; fingerprint: string; id: string } | null>(null);
  const [status, setStatus] = useState<'idle' | 'previewing' | 'publishing' | 'failure'>('idle');
  const editor = useRef<HTMLTextAreaElement>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const surahNumber = parseLocaleNumber(surah);
  const ayahNumber = parseLocaleNumber(ayah);
  const source = kind === 'quran' ? { kind, surah: surahNumber, ayah: ayahNumber }
    : kind === 'qaf' ? { kind, passageId: passage?.id } : { kind, text: message };
  const selection = { source, design: { template, palette, format }, locale };
  const fingerprint = JSON.stringify(selection);
  const valid = kind === 'quran'
    ? Number.isInteger(surahNumber) && Number(surahNumber) >= 1 && Number(surahNumber) <= 114 &&
      Number.isInteger(ayahNumber) && Number(ayahNumber) >= 1 && Number(ayahNumber) <= 286
    : kind === 'qaf' ? !!passage : !!message.trim();
  const currentPreview = preview?.fingerprint === fingerprint ? preview : null;
  const busy = status === 'previewing' || status === 'publishing';

  async function submit(publish: boolean) {
    const request = new AbortController();
    controller.current?.abort();
    controller.current = request;
    setStatus(publish ? 'publishing' : 'previewing');
    const id = currentPreview?.id ?? crypto.randomUUID();
    try {
      if (!publish) {
        const image = await cardAction<Preview>(channelId, '/preview', { ...selection, id }, request.signal);
        setPreview({ image, fingerprint, id });
        setStatus('idle');
        return;
      }
      let job = await cardAction<{ id: string; status: string }>(channelId, '', { ...selection, id }, request.signal);
      const deadline = Date.now() + 90_000;
      while (!['failed', 'cancelled', 'succeeded'].includes(job.status) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        job = await cardAction(channelId, `/jobs/${job.id}`, undefined, request.signal);
      }
      if (job.status !== 'succeeded') throw new Error('Card publication did not finish');
      onPublished();
    } catch {
      if (!request.signal.aborted) setStatus('failure');
    }
  }

  return <div className="space-y-4" lang={locale} dir={ar ? 'rtl' : 'ltr'}>
    <fieldset disabled={busy} className="space-y-4">
      <label className={label}>{pick('Source', 'المصدر')}
        <select className={field} value={kind} onChange={(event) => setKind(event.target.value as SourceKind)}>
          <option value="quran">{pick('Quran verse', 'آية من القرآن')}</option>
          <option value="qaf">{pick('Qaf quotation', 'اقتباس من قاف')}</option>
          <option value="message">{pick('Your message', 'رسالتك')}</option>
        </select>
      </label>
      {kind === 'quran' && <div className="grid grid-cols-2 gap-3">
        <label className={label}>{pick('Surah number', 'رقم السورة')}
          <input className={field} inputMode="numeric" maxLength={3} value={surah} onChange={(event) => setSurah(event.target.value)} />
        </label>
        <label className={label}>{pick('Verse number', 'رقم الآية')}
          <input className={field} inputMode="numeric" maxLength={3} value={ayah} onChange={(event) => setAyah(event.target.value)} />
        </label>
      </div>}
      {kind === 'qaf' && <div className="space-y-2">
        <QafSourcePicker channelId={channelId} postLocale={locale} editor={editor} value="" maxLength={0} onChange={() => {}} onSelectPassage={setPassage} />
        {passage && <p dir="auto" className="text-sm">{passage.title}</p>}
      </div>}
      {kind === 'message' && <label className={label}>{pick('Message', 'الرسالة')}
        <textarea className={field} rows={4} maxLength={600} dir="auto" value={message} onChange={(event) => setMessage(event.target.value)} />
        <span className="block text-muted-foreground">{localizeDigits(locale, message.length)} / {localizeDigits(locale, 600)}</span>
      </label>}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={label}>{pick('Template', 'القالب')}
          <select className={field} value={template} onChange={(event) => { setTemplate(event.target.value); setPalette(0); }}>
            <option value="fawanees">{pick('Fawanees', 'فوانيس')}</option>
            <option value="folio">{pick('Folio', 'المخطوط')}</option>
            <option value="editorial">{pick('Editorial', 'تحريري')}</option>
          </select>
        </label>
        <label className={label}>{pick('Colour', 'اللون')}
          <select className={field} value={palette} onChange={(event) => setPalette(Number(event.target.value))}>
            <option value={0}>{template === 'folio' ? pick('Parchment', 'رقّ') : pick('Midnight', 'ليلي')}</option>
            <option value={1}>{template === 'fawanees' ? pick('Plum', 'أرجواني') : pick('Green', 'أخضر')}</option>
          </select>
        </label>
        <label className={label}>{pick('Format', 'الأبعاد')}
          <select className={field} value={format} onChange={(event) => setFormat(event.target.value)}>
            <option value="square">{pick('Square', 'مربع')}</option>
            <option value="portrait">{pick('Portrait', 'عمودي')}</option>
          </select>
        </label>
      </div>
    </fieldset>
    {currentPreview && <CardPreview preview={currentPreview.image} title={pick('Card preview', 'معاينة البطاقة')} />}
    {status === 'failure' && <p role="alert" className="text-sm text-destructive">{pick('Could not finish the card. Check the source and try again.', 'تعذّر إكمال البطاقة. تحقّق من المصدر وحاول مجددًا.')}</p>}
    {busy && <p role="status" className="text-sm">{status === 'publishing' ? pick('Publishing card…', 'جارٍ نشر البطاقة…') : pick('Preparing preview…', 'جارٍ إعداد المعاينة…')}</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={!valid || busy} onClick={() => void submit(false)}>{pick('Preview', 'معاينة')}</Button>
      <Button type="button" disabled={!currentPreview || busy} onClick={() => void submit(true)}>{pick('Publish card', 'نشر البطاقة')}</Button>
    </div>
  </div>;
}
