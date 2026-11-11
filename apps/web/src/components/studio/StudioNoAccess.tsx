'use client';

import Link from '@/components/common/AppLink';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/hooks/useLanguage';

export function StudioNoAccess({ locale, channelId }: { locale: string; channelId: string }) {
  const { t } = useLanguage();
  return (
    <div className="mx-auto max-w-md py-16 text-center" data-testid="studio-no-access">
      <h1 className="mb-3 text-2xl font-bold text-foreground">{t.studio.noAccess.title}</h1>
      <p className="mb-6 text-muted-foreground">{t.studio.noAccess.body}</p>
      <Button asChild>
        <Link href={`/${locale}/studio/${encodeURIComponent(channelId)}/dashboard`}>{t.studio.noAccess.back}</Link>
      </Button>
    </div>
  );
}
