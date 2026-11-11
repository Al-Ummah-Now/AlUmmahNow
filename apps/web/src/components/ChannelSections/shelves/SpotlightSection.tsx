'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Play } from 'lucide-react';
import { getLocalizedValue, type VideoObject } from '@al-ummah/shared-types';
import { useAuth } from '@/components/AuthProvider/authContext';
import { getChannelSubscriptionStatus } from '@/lib/api/channels';
import { removeUnwantedChars } from '@/lib/utility';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';
import { HeroThumb } from '@/components/ThemeDemo/HomeHero';

interface SpotlightProps {
  channelId: string;
  trailer?: VideoObject;
  returning?: VideoObject;
}

/**
 * Which spotlight video a viewer gets: subscribers see the featured video
 * for subscribers, everyone else the trailer; either falls back to the other.
 */
export function pickSpotlightVideo(
  trailer: VideoObject | undefined,
  returning: VideoObject | undefined,
  isSubscribed: boolean
): { video: VideoObject; kind: 'trailer' | 'returning' } | null {
  const preferred = isSubscribed ? returning : trailer;
  if (preferred) return { video: preferred, kind: isSubscribed ? 'returning' : 'trailer' };
  if (trailer) return { video: trailer, kind: 'trailer' };
  if (returning) return { video: returning, kind: 'returning' };
  return null;
}

/**
 * The channel spotlight: one large card leading the Home tab. The API sends
 * both videos so the response stays cacheable; the choice is made here.
 * No autoplay.
 */
export function SpotlightSection({ channelId, trailer, returning }: SpotlightProps) {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const [isSubscribed, setIsSubscribed] = useState(false);

  // Only signed-in viewers can be subscribers; only worth asking when the choice differs
  const needsStatus = !!user && !!trailer && !!returning;
  useEffect(() => {
    if (!needsStatus) return;
    let cancelled = false;
    getChannelSubscriptionStatus(channelId)
      .then((status) => {
        if (!cancelled) setIsSubscribed(!!status?.result?.isSubscribed);
      })
      .catch((error) => {
        // The trailer is a fine default; nothing to show the viewer
        logger.warn('SpotlightSection: subscription status unavailable', { channelId, error });
      });
    return () => {
      cancelled = true;
    };
  }, [channelId, needsStatus]);

  const picked = pickSpotlightVideo(trailer, returning, isSubscribed);
  if (!picked) return null;

  const { video, kind } = picked;
  const title = removeUnwantedChars(getLocalizedValue(video.titleLocalized, video.title, lang));
  const description = getLocalizedValue(video.descriptionLocalized, video.description ?? '', lang);
  const href = `/${lang}/video?vid=${video.id}`;
  const r = t.channelSections.render;

  return (
    <section data-section="spotlight" data-testid="section-spotlight" data-spotlight-kind={kind} aria-label={title}>
      <div className="home-hero">
        <HeroThumb video={video} href={href} label={`${r.watch}: ${title}`} alt={title}>
          <span className="spotlight-play" aria-hidden="true">
            <Play />
          </span>
        </HeroThumb>
        <div className="home-hero-b">
          <span className="home-hero-tag">{kind === 'trailer' ? r.trailer : r.forSubscribers}</span>
          <h2 dir="auto">{title}</h2>
          {description && (
            <p className="spotlight-desc" dir="auto">
              {description}
            </p>
          )}
          <Link href={href} className="b b-primary">
            <Play aria-hidden="true" />
            {r.watch}
          </Link>
        </div>
      </div>
    </section>
  );
}
