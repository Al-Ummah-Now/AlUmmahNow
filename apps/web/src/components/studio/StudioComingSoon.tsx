'use client';

import { useLanguage } from '@/hooks/useLanguage';

export function StudioComingSoon() {
  const { t } = useLanguage();
  return (
    <div className="py-16 text-center" data-testid="studio-coming-soon">
      <h1 className="mb-3 text-2xl font-bold text-foreground">{t.studio.comingSoon.title}</h1>
      <p className="text-muted-foreground">{t.studio.comingSoon.body}</p>
    </div>
  );
}
