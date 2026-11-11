'use client';

import Link from '@/components/common/AppLink';
import { ChevronRight } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';

interface SectionHeaderProps {
  title: string;
  viewAllHref?: string;
  /** Link text; defaults to "See all" */
  viewAllLabel?: string;
}

/**
 * Section heading row. Keep the `flex items-center justify-between mb-4`
 * classes: the themes draw the hairline under it from that selector.
 */
export function SectionHeader({ title, viewAllHref, viewAllLabel }: SectionHeaderProps) {
  const { t } = useLanguage();

  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-xl font-semibold text-foreground" dir="auto">{title}</h2>

      {viewAllHref && (
        <Link
          href={viewAllHref}
          className="flex shrink-0 items-center gap-1 rounded-sm text-sm font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {viewAllLabel ?? t.channel.seeAll}
          <ChevronRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
