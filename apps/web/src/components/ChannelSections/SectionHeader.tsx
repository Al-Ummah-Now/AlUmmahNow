'use client';

import { pickLanguage } from '@/lib/format/pick-language';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';

interface SectionHeaderProps {
  title: string;
  viewAllHref?: string;
}

export function SectionHeader({ title, viewAllHref }: SectionHeaderProps) {
  const { t, lang } = useLanguage();

  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{pickLanguage(title, lang)}</h2>

      {viewAllHref && (
        <Link
          href={viewAllHref}
          className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
        >
          {t.channel.seeAll}
          <ChevronRight className="w-4 h-4" />
        </Link>
      )}
    </div>
  );
}
