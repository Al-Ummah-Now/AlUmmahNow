import { notFound, redirect } from 'next/navigation';
import { isChannelOwner } from '@/lib/channel-utils';
import { getChannelById } from '@/lib/api/channels';
import { getSubjectEntitlements } from '@/lib/api/entitlements';
import { getTranslations } from '@/lib/i18n';
import { numericLimit, UNLIMITED } from '@/lib/entitlements/limits';

interface PlanPageProps {
  params: Promise<{ locale: string; id: string }>;
}

/** Read-only view of a channel's plan and limits (Epic 27). No prices: payments are deferred. */
export default async function ChannelPlanPage({ params }: PlanPageProps) {
  const { locale, id } = await params;
  if (!(await isChannelOwner(id))) redirect(`/${locale}/settings/channel`);
  const channel = await getChannelById(id);
  if (!channel) notFound();

  const t = getTranslations(locale as 'en' | 'ar');
  const view = await getSubjectEntitlements(`channel:${id}`);
  const isRTL = locale === 'ar';
  const nf = new Intl.NumberFormat(locale);
  const show = (n: number | null) => (n === null ? t.plan.unlimited : nf.format(n));
  const usage = (key: string) => view?.usage[key];
  const limitOf = (key: string) => {
    const entry = usage(key);
    return entry && entry.limit !== UNLIMITED ? entry.limit : null;
  };

  const rows = view
    ? [
        { id: 'channels', label: t.plan.channels, limit: numericLimit(view, 'channel.max') },
        { id: 'links', label: t.plan.links, limit: numericLimit(view, 'channel.about.links.max') },
        { id: 'duration', label: t.plan.duration, limit: numericLimit(view, 'upload.maxDurationMinutes') },
        { id: 'uploads', label: t.plan.uploads, limit: limitOf('upload.monthlyUploads'), used: usage('upload.monthlyUploads') },
        { id: 'storage', label: t.plan.storage, limit: limitOf('storage.gb'), used: usage('storage.gb') },
      ]
    : [];

  return (
    <main dir={isRTL ? 'rtl' : 'ltr'} className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{t.plan.title}</h1>
      {!view && <p className="text-gray-600 dark:text-gray-400" data-testid="plan-unavailable">{t.plan.unavailable}</p>}
      {view && (
        <>
          <p className="text-gray-700 dark:text-gray-300 mb-6">
            {t.plan.current}: <strong data-testid="plan-name">{view.plan ? (isRTL ? view.plan.name_ar : view.plan.name_en) : t.plan.unavailable}</strong>
          </p>
          <ul className="divide-y divide-gray-200 dark:divide-gray-800" data-testid="plan-limits">
            {rows.map((row) => (
              <li key={row.id} className="py-3 flex items-center justify-between gap-4" data-testid={`plan-limit-${row.id}`}>
                <span className="text-gray-900 dark:text-white">{row.label}</span>
                <span className="text-gray-700 dark:text-gray-300 text-end">
                  {row.used ? t.plan.usedOf.replace('{used}', nf.format(row.used.current)).replace('{limit}', show(row.limit)) : show(row.limit)}
                  {row.used?.warning && <span className="block text-sm text-amber-700 dark:text-amber-400" role="status">{t.plan.nearLimit}</span>}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-gray-600 dark:text-gray-400">{t.plan.existingKept}</p>
        </>
      )}
    </main>
  );
}
