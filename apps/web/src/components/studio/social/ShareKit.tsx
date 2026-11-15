'use client';

/**
 * Studio video editor → Share kit (wiki AUN-SOCIAL, SOC-1; owner 2026-11-14 "if someone uses hootsuite or similar we
 * need to be able help them somehow"): the post text in English and Arabic, the link, the thumbnail and, for a long
 * video, an optional vertical clip taken from one of the channel's Shorts, ready to paste into a scheduler tool.
 */
import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { SOCIAL_LANGUAGES } from '@al-ummah/shared-types';
import { ThemedSelectField } from '@/components/ui/ThemedSelectField';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';
import { fetchContentPage } from '@/lib/studio/content-client';
import type { ShareKit as ShareKitData } from '@/lib/studio/social';
import { socialClient } from '@/lib/studio/social-client';
import { CopyButton, Notice, Section } from './shared';

const downloadLink =
  'inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-[var(--fanous-color-surface-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9';

export function ShareKit({ channelId, videoId }: { channelId: string; videoId: string }) {
  const { t } = useLanguage();
  const s = t.studio.social;
  const k = s.shareKit;
  const [kit, setKit] = useState<ShareKitData | null>(null);
  const [failed, setFailed] = useState(false);
  const [clipId, setClipId] = useState('');
  const [shorts, setShorts] = useState<{ id: string; title: string }[]>([]);

  useEffect(() => {
    let live = true;
    void socialClient.shareKit(channelId, videoId, clipId || undefined).then((r) => {
      if (!live) return;
      if (r.ok) {
        setKit(r.data);
        setFailed(false);
      } else {
        setFailed(true);
        logger.error('Share kit failed to load', { channelId, videoId, status: r.status, code: r.code });
      }
    });
    return () => {
      live = false;
    };
  }, [channelId, videoId, clipId]);

  // A long video can borrow a vertical clip from one of the channel's public Shorts
  const pickable = kit?.available && kit.kind === 'video';
  useEffect(() => {
    if (!pickable) return;
    const controller = new AbortController();
    fetchContentPage(channelId, { status: 'published', visibility: 'public', type: 'shorts', sort: 'newest' }, controller.signal)
      .then((page) => setShorts(page.items.map((v) => ({ id: v.id, title: v.title }))))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) logger.warn('Share kit Shorts list failed', { channelId, error });
      });
    return () => controller.abort();
  }, [channelId, pickable]);

  if (failed && !kit) {
    return (
      <Section id="share-kit" title={k.heading} testId="share-kit">
        <Notice tone="error">{k.loadFailed}</Notice>
      </Section>
    );
  }
  if (!kit) return null;
  if (!kit.available) {
    return (
      <Section id="share-kit" title={k.heading} testId="share-kit">
        <p className="text-sm text-[var(--fanous-color-text-secondary)]" data-testid="share-kit-not-public">{k.notPublic}</p>
      </Section>
    );
  }

  return (
    <Section id="share-kit" title={k.heading} intro={k.intro} testId="share-kit">
      <div className="grid gap-4 md:grid-cols-2">
        {SOCIAL_LANGUAGES.map((lang) => (
          <div key={lang} className="space-y-3 rounded-lg border border-border p-3" data-testid={`share-kit-${lang}`}>
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--fanous-color-text-secondary)]">{s.languages[lang]}</p>
            <div className="space-y-1">
              <p className="text-sm font-medium">{k.caption}</p>
              <p
                dir={lang === 'ar' ? 'rtl' : 'ltr'}
                lang={lang}
                className="whitespace-pre-wrap break-words rounded-md bg-[var(--fanous-color-surface-raised)] p-3 text-sm"
                data-testid={`share-kit-caption-${lang}`}
              >
                {kit.captions?.[lang]}
              </p>
              <CopyButton value={kit.captions?.[lang] ?? ''} label={k.copy} copiedLabel={k.copied} testId={`share-kit-copy-caption-${lang}`} />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">{k.link}</p>
              <p dir="ltr" className="truncate font-mono text-xs text-[var(--fanous-color-text-secondary)]" title={kit.links?.[lang]}>{kit.links?.[lang]}</p>
              <CopyButton value={kit.links?.[lang] ?? ''} label={k.copy} copiedLabel={k.copied} testId={`share-kit-copy-link-${lang}`} />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
        {kit.thumbnail ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">{k.thumbnail}</p>
            {kit.thumbnail.url ? (
              // eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived source; next/image would cache it
              <img src={kit.thumbnail.url} alt="" className="aspect-video w-56 rounded-md border border-border object-cover" />
            ) : null}
            <a href={kit.thumbnail.downloadPath} download={`${videoId}.jpg`} className={downloadLink} data-testid="share-kit-thumbnail">
              <Download className="h-4 w-4" aria-hidden="true" />
              {k.downloadThumbnail}
            </a>
          </div>
        ) : null}

        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-medium">{k.clip}</p>
          {pickable ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label htmlFor="share-kit-short">{k.clipFrom}</label>
              <ThemedSelectField id="share-kit-short" value={clipId} onChange={(e) => setClipId(e.target.value)} data-testid="share-kit-short">
                <option value="">{k.none}</option>
                {shorts.map((v) => (
                  <option key={v.id} value={v.id}>{v.title}</option>
                ))}
              </ThemedSelectField>
            </div>
          ) : null}
          {kit.clip ? (
            <a href={kit.clip.downloadPath} download className={downloadLink} data-testid="share-kit-clip">
              <Download className="h-4 w-4" aria-hidden="true" />
              {k.downloadClip}
            </a>
          ) : pickable ? (
            <p className="text-sm text-[var(--fanous-color-text-secondary)]">{k.noClip}</p>
          ) : null}
        </div>
      </div>
    </Section>
  );
}
