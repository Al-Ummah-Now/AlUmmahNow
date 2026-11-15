'use client';

/** Studio → Social → Scheduler tools: the channel's RSS feeds with "Copy feed URL", and the help page. */
import { useState } from 'react';
import Link from '@/components/common/AppLink';
import { SOCIAL_FEED_KINDS, type SocialLanguage } from '@al-ummah/shared-types';
import { ThemedSelectField } from '@/components/ui/ThemedSelectField';
import { useLanguage } from '@/hooks/useLanguage';
import type { SocialOverview } from '@/lib/studio/social';
import { CopyButton, Section } from './shared';

export function SocialFeeds({ locale, feeds }: { locale: SocialLanguage; feeds: SocialOverview['feeds'] }) {
  const { t } = useLanguage();
  const f = t.studio.social.feeds;
  const [lang, setLang] = useState<SocialLanguage>(locale);
  return (
    <Section
      id="social-feeds"
      title={f.heading}
      intro={f.intro}
      testId="social-feeds"
      action={
        <div className="flex items-center gap-2 text-sm">
          <span id="social-feed-lang">{f.language}</span>
          <ThemedSelectField id="social-feed-lang-v" aria-labelledby="social-feed-lang social-feed-lang-v" value={lang} onChange={(e) => setLang(e.target.value as SocialLanguage)} data-testid="social-feed-language">
            <option value="en">{t.studio.social.languages.en}</option>
            <option value="ar">{t.studio.social.languages.ar}</option>
          </ThemedSelectField>
        </div>
      }
    >
      <ul className="space-y-2">
        {SOCIAL_FEED_KINDS.map((kind) => {
          const url = feeds[kind]?.[lang];
          if (!url) return null;
          return (
            <li key={kind} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center" data-testid={`social-feed-${kind}`}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{f.kinds[kind]}</p>
                <p className="truncate font-mono text-xs text-[var(--fanous-color-text-secondary)]" dir="ltr" title={url}>{url}</p>
              </div>
              <CopyButton value={url} label={f.copy} copiedLabel={f.copied} testId={`social-feed-copy-${kind}`} />
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-sm">
        <Link href={`/${locale}/help/social`} className="font-medium underline underline-offset-4" data-testid="social-feeds-help">{f.help}</Link>
      </p>
    </Section>
  );
}
