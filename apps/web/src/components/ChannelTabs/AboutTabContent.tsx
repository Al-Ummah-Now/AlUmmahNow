'use client';

import React, { useEffect, useState } from 'react';
import { Calendar, Eye, Link2, Mail, MapPin, Users, Video } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { getChannelAbout, type ChannelAbout } from '@/lib/api/channel-profile';
import { formatHandle } from '@/lib/channel-url';
import { logger } from '@/lib/logger-client';

interface AboutTabContentProps {
  channelId: string;
}

/** rel for creator-supplied links: no referrer, no opener, not endorsed. */
export const EXTERNAL_LINK_REL = 'nofollow noopener noreferrer ugc';

function linkHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function AboutTabContent({ channelId }: AboutTabContentProps) {
  const { t, lang, isRTL } = useLanguage();
  const [about, setAbout] = useState<ChannelAbout | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    getChannelAbout(channelId)
      .then((result) => {
        if (cancelled) return;
        setAbout(result);
        setState(result ? 'ready' : 'error');
      })
      .catch((error) => {
        logger.error('[AboutTabContent] Failed to load About data', { channelId, error });
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  const numberFormat = new Intl.NumberFormat(lang === 'ar' ? 'ar' : 'en');
  const description = about ? (about.descriptionLocalized?.[lang] || about.description) : '';

  return (
    <div role="tabpanel" id="tabpanel-about" data-testid="tabpanel-about" aria-labelledby="tab-about" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="max-w-4xl">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
          {t.channel.about}
        </h2>

        {state === 'loading' && (
          <p className="text-gray-600 dark:text-gray-400" role="status">{t.common.loading}</p>
        )}
        {state === 'error' && (
          <p className="text-red-600 dark:text-red-400" role="alert">{t.channel.aboutLoadFailed}</p>
        )}

        {state === 'ready' && about && (
          <div className="grid gap-8 md:grid-cols-3">
            <div className="md:col-span-2 space-y-6">
              {/* Description (localised) */}
              <section aria-labelledby="about-description">
                <h3 id="about-description" className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
                  {t.channel.description}
                </h3>
                <p className="text-gray-700 dark:text-gray-300 whitespace-pre-line break-words" data-testid="about-description">
                  {description || t.channel.noDescription}
                </p>
              </section>

              {/* Links */}
              <section aria-labelledby="about-links">
                <h3 id="about-links" className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
                  {t.channel.links}
                </h3>
                {about.links.length === 0 ? (
                  <p className="text-sm text-gray-600 dark:text-gray-400">{t.channel.noLinks}</p>
                ) : (
                  <ul className="space-y-2" data-testid="about-links">
                    {about.links.map((link, index) => (
                      <li key={`${link.url}-${index}`} className="flex items-center gap-2">
                        <Link2 className="w-4 h-4 text-gray-500 flex-shrink-0" aria-hidden="true" />
                        <a
                          href={link.url}
                          target="_blank"
                          rel={EXTERNAL_LINK_REL}
                          className="text-blue-600 dark:text-blue-400 hover:underline break-all"
                        >
                          {link.title}
                        </a>
                        <span className="text-xs text-gray-500" dir="ltr">{linkHost(link.url)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {(about.contactEmail || about.location) && (
                <section aria-labelledby="about-contact" className="space-y-2">
                  <h3 id="about-contact" className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
                    {t.channel.aboutDetails}
                  </h3>
                  {about.contactEmail && (
                    <p className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                      <Mail className="w-4 h-4 text-gray-500" aria-hidden="true" />
                      <span className="sr-only">{t.channel.contactEmail}: </span>
                      <a href={`mailto:${about.contactEmail}`} className="text-blue-600 dark:text-blue-400 hover:underline" dir="ltr" data-testid="about-contact">
                        {about.contactEmail}
                      </a>
                    </p>
                  )}
                  {about.location && (
                    <p className="flex items-center gap-2 text-gray-700 dark:text-gray-300" data-testid="about-location">
                      <MapPin className="w-4 h-4 text-gray-500" aria-hidden="true" />
                      <span className="sr-only">{t.channel.location}: </span>
                      {about.location}
                    </p>
                  )}
                </section>
              )}
            </div>

            {/* Statistics */}
            <aside aria-labelledby="about-stats" className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
              <h3 id="about-stats" className="text-sm font-medium text-gray-500 dark:text-gray-400">
                {t.channel.statistics}
              </h3>
              {about.handle && (
                <p className="font-medium text-gray-900 dark:text-white" dir="ltr" data-testid="about-handle">{formatHandle(about.handle)}</p>
              )}
              <p className="flex items-center gap-2" data-testid="about-joined">
                <Calendar className="w-4 h-4 text-gray-500" aria-hidden="true" />
                {t.channel.joinedOn.replace('{date}', new Date(about.joinedDate).toLocaleDateString(lang === 'ar' ? 'ar' : 'en', { year: 'numeric', month: 'long', day: 'numeric' }))}
              </p>
              <dl className="space-y-2">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-gray-500" aria-hidden="true" />
                  <dt>{t.channel.statsViews}</dt>
                  <dd className="font-semibold ms-auto" data-testid="about-views">{numberFormat.format(about.totalViews)}</dd>
                </div>
                <div className="flex items-center gap-2">
                  <Video className="w-4 h-4 text-gray-500" aria-hidden="true" />
                  <dt>{t.channel.statsVideos}</dt>
                  <dd className="font-semibold ms-auto" data-testid="about-videos">{numberFormat.format(about.videosCount)}</dd>
                </div>
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-gray-500" aria-hidden="true" />
                  <dt>{t.channel.statsSubscribers}</dt>
                  <dd className="font-semibold ms-auto" data-testid="about-subscribers">{numberFormat.format(about.subscribersCount)}</dd>
                </div>
              </dl>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
