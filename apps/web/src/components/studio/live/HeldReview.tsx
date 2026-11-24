'use client';

/** Studio: the messages held for review on this stream. Nothing while its chat is off for this person. */
import { useId } from 'react';
import { HeldList, useHeldMessages } from '@/components/live/HeldMessages';
import { useLanguage } from '@/hooks/useLanguage';

export function HeldReview({ streamId }: { streamId: string }) {
  const { t } = useLanguage();
  const text = t.studio.live.apps;
  const id = useId();
  const { messages, failed, decide } = useHeldMessages(streamId, true);
  if (!messages && !failed) return null;
  return (
    <section aria-labelledby={id} className="mb-6 rounded-lg border border-border bg-card p-4" data-testid="studio-live-held">
      <h2 id={id} className="mb-2 text-base font-semibold text-foreground">{text.held}</h2>
      {!messages ? <p className="text-sm text-muted-foreground">{text.heldFailed}</p> : messages.length === 0 ? <p className="text-sm text-muted-foreground">{text.heldEmpty}</p> : <HeldList messages={messages} onDecide={decide} />}
    </section>
  );
}
