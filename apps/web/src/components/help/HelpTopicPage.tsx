'use client';
/** One Help topic (/[locale]/help/[topic]): its sections, "On this page", related topics. */
import '@/theme/help.css';
import Link from '@/components/common/AppLink';
import { ArrowLeft } from 'lucide-react';
import { HELP_TOPIC_IDS, type HelpTopicId } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { MAIN_CONTENT_ID } from '@/components/SkipLinks';
import { helpHref, visibleHelpSections } from '@/lib/help/content';
import { useFeatures } from '@/hooks/useFeatures';
import { requestIdentityTour } from '@/lib/help/tour-events';
import { HelpBlocks } from './HelpBlocks';
import { useHelp } from './HelpNetworks';
import { HELP_TOPIC_ICONS } from './HelpHome';

export function HelpTopicPage({ topic }: { topic: HelpTopicId }) {
  const { lang, isRTL } = useLanguage();
  // The Social topic names only the networks that are on (owner rule: off or not set up leaves no trace)
  const { help: h } = useHelp();
  const page = h.topics[topic];
  // Sections of a feature that is off for this reader are not shown (wiki "Hidden when off")
  const { features } = useFeatures();
  const sections = visibleHelpSections(page.sections, features);
  const Icon = HELP_TOPIC_ICONS[topic];
  const related = HELP_TOPIC_IDS.filter((id) => id !== topic);
  return (
    <main id={MAIN_CONTENT_ID} className="hp" dir={isRTL ? 'rtl' : 'ltr'} data-testid={`help-page-${topic}`}>
      <nav aria-label={h.title} className="hp-crumb">
        <Link href={helpHref(lang)} data-testid="help-back"><ArrowLeft className="aun-flip" aria-hidden="true" />{h.backToHelp}</Link>
      </nav>
      <header className="hp-head aun-glass aun-card-pad">
        <span className="hp-badge" aria-hidden="true"><Icon /></span>
        <div>
          <h1 className="hp-title">{page.title}</h1>
          <p className="hp-lead">{page.summary}</p>
        </div>
      </header>
      <div className="hp-layout">
        <nav className="hp-toc aun-glass-lite aun-card-pad" aria-labelledby="hp-toc-title">
          <h2 id="hp-toc-title" className="hp-toc-title">{h.onThisPage}</h2>
          <ul>
            {sections.map((section) => (
              <li key={section.id}><a href={`#${section.id}`}>{section.heading}</a></li>
            ))}
          </ul>
        </nav>
        <div className="hp-body">
          {sections.map((section) => (
            <section key={section.id} id={section.id} className="hp-section pb-glass" aria-labelledby={`${section.id}-h`}>
              <h2 id={`${section.id}-h`} className="hp-h2">{section.heading}</h2>
              <HelpBlocks blocks={section.blocks} />
            </section>
          ))}
          <section className="hp-related hp-section pb-glass" aria-labelledby="hp-related-title">
            <h2 id="hp-related-title" className="hp-h2">{h.related}</h2>
            <ul>
              {related.map((id) => (
                <li key={id}><Link href={helpHref(lang, id)}>{h.topics[id].title}</Link></li>
              ))}
              <li><button type="button" className="hp-linkish" onClick={() => requestIdentityTour()}>{h.takeTour}</button></li>
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
