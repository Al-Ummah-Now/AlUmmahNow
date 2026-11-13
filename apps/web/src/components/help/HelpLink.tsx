'use client';
/** A small link to a Help page, for empty states and messages about channels. */
import Link from '@/components/common/AppLink';
import { CircleHelp } from 'lucide-react';
import type { HelpTopicId } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { helpHref } from '@/lib/help/content';

export function HelpLink({ topic, section, label, className }: { topic: HelpTopicId; section?: string; label?: string; className?: string }) {
  const { t, lang } = useLanguage();
  const heading = section ? t.help.topics[topic].sections.find((s) => s.id === section)?.heading : undefined;
  return (
    <Link
      href={helpHref(lang, topic, section)}
      className={`inline-flex items-center gap-1 font-medium text-[var(--fanous-color-link)] underline underline-offset-2 ${className ?? ''}`}
      data-testid="help-link"
    >
      <CircleHelp className="h-4 w-4 flex-none" aria-hidden="true" />
      {label ?? heading ?? t.help.whatsThis}
    </Link>
  );
}
