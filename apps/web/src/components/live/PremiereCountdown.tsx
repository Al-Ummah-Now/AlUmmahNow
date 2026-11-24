'use client';

/** How long until a premiere starts (wiki E17 §5.4). `onDue` once its time has come: the page asks more often then. */
import { useEffect, useRef, useState } from 'react';
import { fillTemplate, formatClock } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';

const DAY_MS = 86_400_000;

export function PremiereCountdown({ startsAt, offset, onDue }: { startsAt: number; offset: number; onDue: () => void }) {
  const { t, lang } = useLanguage();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = startsAt - (now + offset);
  const due = left <= 0;
  const onDueRef = useRef(onDue);
  onDueRef.current = onDue;
  useEffect(() => {
    if (due) onDueRef.current();
  }, [due]);

  if (due) return <p className="text-lg font-semibold text-foreground" role="status" data-testid="premiere-starting">{t.liveWatch.premiereStarting}</p>;
  if (left >= DAY_MS) return <p className="text-lg font-semibold text-foreground" data-testid="premiere-countdown">{fillTemplate(lang, t.liveWatch.premiereInDays, { days: Math.floor(left / DAY_MS) })}</p>;
  return (
    <div data-testid="premiere-countdown">
      <p className="text-sm text-muted-foreground">{t.liveWatch.premiereIn}</p>
      <p className="text-3xl font-semibold tabular-nums text-foreground" role="timer" dir="ltr">{formatClock(lang, Math.ceil(left / 1000))}</p>
    </div>
  );
}
