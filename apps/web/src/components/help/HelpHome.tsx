'use client';
/** Help home (/[locale]/help): search, the tour, every topic. */
import '@/theme/help.css';
import Link from '@/components/common/AppLink';
import { ArrowRight, BookOpen, Compass, Languages, PlayCircle, ShieldCheck, Upload, Users, UserRound, type LucideIcon } from 'lucide-react';
import { HELP_TOPIC_IDS, type HelpTopicId } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { MAIN_CONTENT_ID } from '@/components/SkipLinks';
import { helpHref } from '@/lib/help/content';
import { requestIdentityTour } from '@/lib/help/tour-events';
import { HelpSearch } from './HelpSearch';

export const HELP_TOPIC_ICONS: Record<HelpTopicId, LucideIcon> = {
  start: Compass,
  watching: PlayCircle,
  identity: UserRound,
  creating: Upload,
  community: Users,
  privacy: ShieldCheck,
  appearance: Languages,
};

export function HelpHome() {
  const { t, lang, isRTL } = useLanguage();
  const h = t.help;
  return (
    <main id={MAIN_CONTENT_ID} className="hp" dir={isRTL ? 'rtl' : 'ltr'} data-testid="help-home">
      <header className="hp-head">
        <span className="hp-badge" aria-hidden="true"><BookOpen /></span>
        <div>
          <h1 className="hp-title">{h.title}</h1>
          <p className="hp-lead">{h.lead}</p>
        </div>
      </header>
      <HelpSearch />
      <section className="hp-tour-card" aria-labelledby="hp-tour-title">
        <div>
          <h2 id="hp-tour-title" className="hp-card-title">{h.takeTour}</h2>
          <p className="hp-card-text">{h.takeTourHint}</p>
        </div>
        <button type="button" className="b b-primary" data-testid="help-take-tour" onClick={() => requestIdentityTour()}>
          {h.takeTour}
        </button>
      </section>
      <section aria-labelledby="hp-topics">
        <h2 id="hp-topics" className="hp-h2">{h.topicsHeading}</h2>
        <ul className="hp-topics">
          {HELP_TOPIC_IDS.map((id) => {
            const Icon = HELP_TOPIC_ICONS[id];
            const topic = h.topics[id];
            return (
              <li key={id}>
                <Link href={helpHref(lang, id)} className="hp-topic" data-testid={`help-topic-${id}`} data-featured={id === 'identity' || undefined}>
                  <span className="hp-topic-icon" aria-hidden="true"><Icon /></span>
                  <span className="hp-topic-text">
                    <span className="hp-topic-title">{topic.title}</span>
                    <span className="hp-topic-summary">{topic.summary}</span>
                  </span>
                  <ArrowRight className="hp-topic-arrow aun-flip" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
