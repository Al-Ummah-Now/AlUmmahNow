'use client';

/** The settings of one stream or premiere, changed on its own page (wiki E17). The chat's apply at once. */
import { useId, useState, type FormEvent } from 'react';
import { apiErrorMessage } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/hooks/useLanguage';
import { LiveApiError, saveChatSettings, updateStream, type LiveStreamRow } from '@/lib/live/api';
import { logger } from '@/lib/logger-client';
import type { LiveOffers } from '@/lib/studio/nav';
import { LiveOptionsFields, optionsOf } from './LiveOptionsFields';
import { StartFields, readStart, startOf } from './StartFields';

export function LiveSettings({ stream, offers, onSaved }: { stream: LiveStreamRow; offers: LiveOffers; onSaved: () => void }) {
  const { t, lang } = useLanguage();
  const text = t.studio.live.apps;
  const id = useId();
  const premiere = stream.kind === 'premiere';
  // Its time can be changed until it starts
  const timed = stream.status === 'scheduled' && (premiere || offers.schedule);
  const [start, setStart] = useState(() => startOf(stream.scheduledStartTime));
  const [options, setOptions] = useState(() => optionsOf(stream));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null);
  if (!timed && !offers.events && !offers.chat) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const before = optionsOf(stream);
    const patch: Parameters<typeof updateStream>[1] = {};
    const was = startOf(stream.scheduledStartTime);
    if (timed && (start.date !== was.date || start.time !== was.time)) {
      const at = readStart(start);
      if (at === 'past') return setNotice({ text: text.timeTooSoon, bad: true });
      if (typeof at === 'string') return setNotice({ text: text.timeRequired, bad: true });
      patch.scheduledStartTime = at.iso;
    }
    if (offers.events && options.eventType !== before.eventType) patch.eventType = options.eventType;
    const chat = offers.chat && JSON.stringify(options.chat) !== JSON.stringify(before.chat) ? options.chat : null;
    setBusy(true);
    setNotice(null);
    try {
      if (Object.keys(patch).length) await updateStream(stream.id, patch);
      if (chat) await saveChatSettings(stream.id, chat);
      setNotice({ text: text.saved });
      onSaved();
    } catch (error) {
      const api = error instanceof LiveApiError ? error : null;
      if (!api?.code) logger.error('[StudioLive] Settings not saved', { streamId: stream.id, error });
      setNotice({ text: apiErrorMessage(api?.code ?? '', api?.status ?? 0, lang), bad: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={`${id}-title`} className="mb-6 rounded-lg border border-border bg-card p-4" data-testid="studio-live-settings">
      <h2 id={`${id}-title`} className="mb-3 text-base font-semibold text-foreground">{text.settings}</h2>
      <form className="grid gap-4" onSubmit={(e) => void submit(e)} noValidate>
        {timed && <StartFields value={start} onChange={setStart} required={premiere} />}
        <LiveOptionsFields value={options} onChange={setOptions} offers={offers} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="outline" disabled={busy} className="min-h-11" data-testid="studio-live-save">{busy ? text.saving : text.save}</Button>
          <p role="status" className={`text-sm ${notice?.bad ? 'text-[var(--fanous-color-error-text)]' : 'text-muted-foreground'}`} data-testid="studio-live-settings-notice">{notice?.text ?? ''}</p>
        </div>
      </form>
    </section>
  );
}
