'use client';

import { usePathname } from 'next/navigation';
import { parseLocaleFromPath } from '@/lib/i18n/utils';
import { errorScreenStrings } from '@al-ummah/shared-types';
import { ErrorScreen } from '@/components/errors/ErrorScreen';

/**
 * The 404 page, rendered by app/not-found.tsx (unmatched URLs) and app/[locale]/not-found.tsx
 * (notFound() inside a locale route), inside the site's header and rail. The language comes from the
 * URL, so /ar/... gets Arabic + RTL. Shared copy (@al-ummah/shared-types errorScreenStrings), no
 * React Query: Next can render the not-found page outside the root layout (an unmatched server action
 * POST, e.g. a stale page after a deploy), where no QueryClientProvider exists (prod 2026-11-17/18).
 *
 * The same HTML is the 410 page: for purged content the Worker answers 410 Gone and switches the card
 * to its "This was removed" words (lib/seo/gone.ts), so both ship here.
 */
export default function NotFoundPage() {
  const locale = parseLocaleFromPath(usePathname() ?? '/') === 'ar' ? 'ar' : 'en';
  return (
    <ErrorScreen
      locale={locale}
      kind="notFound"
      alternate="gone"
      search
      back
      testId="not-found-page"
      primary={{ label: errorScreenStrings(locale).goHome, icon: 'home', href: `/${locale}`, testId: 'error-home' }}
      contactHref={`/${locale}/contact`}
    />
  );
}
