/**
 * Community guidelines (Epic 6.3): what is and isn't allowed, how moderation
 * works and how to report. Text from t.communityGuidelines (en/ar).
 *
 * Laid out with the page builder's shared classes (@al-ummah/shared-types/page-blocks.css), not CSS of
 * its own: the `.pb` root, a plain section for the title, and one frosted-glass panel per section
 * (`pb-t-raised`, the same box as the About page's, golden glow in the theme's primary). Logical
 * properties and container queries in that stylesheet make one component serve LTR and RTL.
 */
'use client';

import React from 'react';
import '@al-ummah/shared-types/page-blocks.css';
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
  const dir = isRTL ? 'rtl' : 'ltr';

  return (
    <main id={MAIN_CONTENT_ID} dir={dir} data-testid="community-guidelines" className="w-full flex-1 py-6 md:py-10">
      <div className="pb" lang={isRTL ? 'ar' : 'en'} dir={dir}>
        <header className="pb-b pb-w-content pb-t-raised pb-a-start pb-s-m">
          <div className="pb-in">
            <h1 className="pb-heading">{g.title}</h1>
            <p className="pb-intro">{g.lead}</p>
            <p className="pb-intro">
              <small>{g.lastUpdated}</small>
            </p>
          </div>
        </header>

        {SECTION_ORDER.map((key) => {
          const section = g.sections[key];
          return (
            <section
              key={key}
              aria-labelledby={`guidelines-${key}`}
              className="pb-b pb-w-content pb-t-raised pb-a-start pb-s-m"
              data-testid={`guidelines-${key}`}
            >
              <div className="pb-in">
                <h2 id={`guidelines-${key}`} className="pb-heading">
                  {section.heading}
                </h2>
                <div className="pb-prose">
                  <p>{section.intro}</p>
                  {section.points.length > 0 && (
                    <ul>
                      {section.points.map((point) => (
                        <li key={point}>{point}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}

export default CommunityGuidelinesPage;
