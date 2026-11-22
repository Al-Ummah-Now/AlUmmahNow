import { getI18n } from '@/i18n/server';
import { PublicShell } from '@/components/PublicShell';
import { FriendlyError } from '@/components/FriendlyError';

export default async function NotFound() {
  const { locale } = await getI18n();

  return (
    <PublicShell>
      <div data-testid="not-found" className="w-full">
        <FriendlyError locale={locale} kind="notFound" inline />
      </div>
    </PublicShell>
  );
}
