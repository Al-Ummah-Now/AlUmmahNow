'use client';

/** Scheduling a premiere (wiki E17 §5.4): a video, a time, and what is set on it. */
import { useId, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiErrorMessage } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/hooks/useLanguage';
import { useCreatorTermsPrompt } from '@/components/legal/useCreatorTermsPrompt';
import { LiveApiError, isLiveOff, schedulePremiere } from '@/lib/live/api';
import { logger } from '@/lib/logger-client';
import type { LiveOffers } from '@/lib/studio/nav';
import { LiveOptionsFields, offeredOptions, optionsOf } from './LiveOptionsFields';
import { PremiereVideoPicker, type PremiereVideo } from './PremiereVideoPicker';
import { NO_START, StartFields, readStart } from './StartFields';
import { studioLiveHref } from './href';

export function PremiereForm({ locale, channelId, offers }: { locale: string; channelId: string; offers: LiveOffers }) {
  const { t, lang } = useLanguage();
  const text = t.studio.live.apps;
  const router = useRouter();
  const id = useId();
  const [video, setVideo] = useState<PremiereVideo | null>(null);
  const [title, setTitle] = useState('');
  const [start, setStart] = useState(NO_START);
  const [options, setOptions] = useState(() => optionsOf());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const terms = useCreatorTermsPrompt(() => schedule());

  const schedule = async () => {
    terms.clear();
    const at = readStart(start);
    if (!video) return setProblem(text.videoRequired);
    if (at === 'empty' || at === 'incomplete') return setProblem(text.timeRequired);
    if (at === 'past') return setProblem(text.timeTooSoon);
    setBusy(true);
    setProblem('');
    try {
      const stream = await schedulePremiere(video.id, { ...(title.trim() ? { title: title.trim() } : {}), scheduledStartTime: at.iso, ...offeredOptions(options, offers) });
      router.push(studioLiveHref(locale, channelId, stream.id));
    } catch (error) {
      // Premieres were switched off meanwhile: the page re-renders without them
      if (isLiveOff(error)) return router.refresh();
      const api = error instanceof LiveApiError ? error : null;
      if (!api?.code) logger.error('[StudioPremiere] Not scheduled', { videoId: video.id, error });
      if (api?.code === 'terms_required') terms.refused();
      setProblem(apiErrorMessage(api?.code ?? '', api?.status ?? 0, lang));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); void schedule(); }} className="mb-6 grid gap-4 rounded-lg border border-border bg-card p-4" data-testid="studio-premiere-form" noValidate>
      <p className="text-sm text-muted-foreground">{text.premiereHelp}</p>
      <div className="grid gap-1">
        {video ? (
          <>
            <span className="text-sm font-medium text-foreground">{text.video}</span>
            <div className="flex flex-wrap items-center gap-3">
              <span className="min-w-0 break-words text-foreground" dir="auto" data-testid="studio-premiere-chosen">{video.title}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => setVideo(null)} data-testid="studio-premiere-change">{text.videoChange}</Button>
            </div>
          </>
        ) : (
          <>
            <label htmlFor={`${id}-video`} className="text-sm font-medium text-foreground">{text.video}</label>
            <PremiereVideoPicker channelId={channelId} inputId={`${id}-video`} onPick={(v) => { setVideo(v); setTitle(v.title); setProblem(''); }} />
          </>
        )}
      </div>
      {video && (
        <div className="grid gap-1">
          <label htmlFor={`${id}-title`} className="text-sm font-medium text-foreground">{t.studio.live.form.title}</label>
          <Input id={`${id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} dir="auto" data-testid="studio-premiere-title" />
        </div>
      )}
      <StartFields value={start} onChange={setStart} required />
      <LiveOptionsFields value={options} onChange={setOptions} offers={offers} />
      {problem && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-[var(--fanous-color-error-text)]" data-testid="studio-premiere-problem" data-code={terms.needed ? 'terms_required' : undefined}>
          <span>{problem}</span>
          {terms.reviewLink('studio-premiere-review-terms')}
        </div>
      )}
      {terms.dialog}
      <div>
        <Button type="submit" disabled={busy} className="min-h-11" data-testid="studio-premiere-schedule">{busy ? text.scheduling : text.schedule}</Button>
      </div>
    </form>
  );
}
