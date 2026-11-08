/**
 * Community guidelines (Epic 6.3): what is and isn't allowed, how moderation
 * works and how to report. Text from t.communityGuidelines (en/ar); layout uses
 * logical properties, so one component serves LTR and RTL.
 */
'use client';

import React from 'react';
import { useLanguage } from '@/hooks/useLanguage';
import { MAIN_CONTENT_ID } from '@/components/SkipLinks';
import type { CommunityGuidelinesTranslations } from '@al-ummah/shared-types';

const SECTION_ORDER: Array<keyof CommunityGuidelinesTranslations['sections']> = [
  'respect',
  'knowledge',
  'prohibited',
  'comments',
  'creators',
  'enforcement',
  'reporting',
];

export function CommunityGuidelinesPage() {
  const { t, isRTL } = useLanguage();
  const g = t.communityGuidelines;

  return (
    <main
      id={MAIN_CONTENT_ID}
      dir={isRTL ? 'rtl' : 'ltr'}
      data-testid="community-guidelines"
      className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 text-gray-900 dark:text-gray-100"
    >
      <h1 className="mb-3 text-2xl font-bold md:text-3xl">{g.title}</h1>
      <p className="mb-2 text-base leading-7 text-gray-700 dark:text-gray-300">{g.lead}</p>
      <p className="mb-8 text-sm text-gray-500 dark:text-gray-400">{g.lastUpdated}</p>

      {SECTION_ORDER.map((key) => {
        const section = g.sections[key];
        return (
          <section key={key} aria-labelledby={`guidelines-${key}`} className="mb-8" data-testid={`guidelines-${key}`}>
            <h2 id={`guidelines-${key}`} className="mb-2 text-xl font-semibold">
              {section.heading}
            </h2>
            <p className="mb-3 leading-7 text-gray-700 dark:text-gray-300">{section.intro}</p>
            {section.points.length > 0 && (
              <ul className="list-disc space-y-2 ps-6 leading-7 text-gray-700 dark:text-gray-300">
                {section.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </main>
  );
}

export default CommunityGuidelinesPage;
