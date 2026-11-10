'use client';

import Link from 'next/link';
import { EyeOff } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import type { PopulatedChannelSection } from './sectionData';

interface OwnerSectionNoteProps {
  section: PopulatedChannelSection;
  channelId: string;
}

/**
 * Shown only to people who can edit the channel, in place of a section
 * visitors don't see: why it's hidden and a way to fix it. Visitors never
 * get these sections from the API, so there is no visitor empty state.
 */
export function OwnerSectionNote({ section, channelId }: OwnerSectionNoteProps) {
  const { t, locale } = useLanguage();
  const strings = t.channelSections;
  const hint = section.emptyHint ?? 'noContent';
  const detail = hint === 'noContent' ? strings.emptyDetails[section.type] : undefined;

  return (
    <div
      role="note"
      data-testid="section-owner-note"
      data-empty-hint={hint}
      className="flex flex-col gap-3 rounded-lg border border-border bg-muted px-4 py-3 sm:flex-row sm:items-center"
    >
      <EyeOff className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p className="flex-1 text-sm text-foreground">
        {strings.emptyHints[hint]}
        {detail && <span className="block text-muted-foreground">{detail}</span>}
      </p>
      <Link
        href={`/${locale}/settings/channel/${channelId}/sections`}
        className="shrink-0 rounded-sm text-sm font-semibold text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {strings.editSections}
      </Link>
    </div>
  );
}
