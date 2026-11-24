'use client';

/** Instead of a video's visibility while it waits for its premiere (wiki E17 §5.4): when that is, and the way to it. */
import { useEffect, useState } from 'react';
import { dateTimeFormat } from '@al-ummah/shared-types';
import Link from '@/components/common/AppLink';
import { studioLiveHref } from '@/components/studio/live/href';
import { useLanguage } from '@/hooks/useLanguage';
import { getStream } from '@/lib/live/api';

export function HeldForPremiere({ channelId, streamId }: { channelId: string; streamId: string }) {
  const { t, lang } = useLanguage();
  const text = t.studio.live.apps;
  const [at, setAt] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    getStream(streamId, controller.signal).then((s) => setAt(s.scheduledStartTime ?? null), () => undefined);
    return () => controller.abort();
  }, [streamId]);
  return (
    <div className="rounded-lg border border-border bg-card p-3" data-testid="video-edit-premiere">
      <p className="text-sm font-medium text-foreground">{at ? text.premiereOn.replace('{date}', dateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at))) : text.premiere}</p>
      <p className="mt-1 text-sm text-muted-foreground">{text.heldVideo}</p>
      <Link href={studioLiveHref(lang, channelId, streamId)} className="mt-1 inline-block text-sm underline" data-testid="video-edit-premiere-link">{text.premiereManage}</Link>
    </div>
  );
}
