'use client';

/** "Remind me" of a stream or premiere that has not started (wiki E17 §5.5). Settings and quiet hours are the server's. */
import { useEffect, useState } from 'react';
import { Bell, BellRing } from 'lucide-react';
import { fillTemplate } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useLanguage } from '@/hooks/useLanguage';
import { loginRoutePath } from '@/lib/auth/silent-sign-in';
import { LiveApiError, setReminder, type LiveReminderView } from '@/lib/live/api';
import { logger } from '@/lib/logger-client';

export function ReminderButton({ streamId, reminder, onChanged }: { streamId: string; reminder: LiveReminderView; onChanged: () => void }) {
  const { t, lang } = useLanguage();
  const text = t.liveWatch;
  const { user } = useAuth();
  const [own, setOwn] = useState<{ set: boolean; count: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // A newer read of the state is right again
  useEffect(() => setOwn(null), [reminder.set, reminder.count]);
  const { set, count } = own ?? reminder;

  async function toggle() {
    if (!user) {
      window.location.href = loginRoutePath(window.location.pathname, lang);
      return;
    }
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      setOwn(await setReminder(streamId, !set));
    } catch (error) {
      // It has started, or reminders were turned off: the state says so and the button goes
      if (error instanceof LiveApiError && error.status === 404) onChanged();
      else {
        setFailed(true);
        logger.debug('[LiveReminder] Not changed', { streamId, error });
      }
    } finally {
      setBusy(false);
    }
  }

  const Icon = set ? BellRing : Bell;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="live-reminder">
      <Button variant={set ? 'secondary' : 'default'} aria-pressed={set} aria-busy={busy} onClick={() => void toggle()} data-testid="live-reminder-button">
        <Icon aria-hidden="true" />
        {set ? text.reminderSet : text.remindMe}
      </Button>
      {count > 0 && <span className="text-sm text-muted-foreground" data-testid="live-reminder-count">{fillTemplate(lang, text.reminderCount, { count })}</span>}
      {set && <p className="w-full text-sm text-muted-foreground">{text.reminderWhen}</p>}
      <p role="status" className="w-full text-sm text-[var(--fanous-color-error-text)] empty:hidden">{failed ? text.reminderFailed : ''}</p>
    </div>
  );
}
