import Link from '@/components/AppLink';
import type { BackfillOverview, BackfillRun, MediaProviderId } from '@al-ummah/shared-types';
import { getBackfillOverview, getBackfillRun, getMediaProviders, listBackfillRuns, listBunnyLibraries, type BunnyLibraryView } from '@/lib/api/admin';
import { getAdminSession } from '@/lib/auth';
import { canManageMedia } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { Chip } from '@/components/content/parts';
import { ErrorAlert, cardClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { NewRun } from './NewRun';
import { Overview } from './Overview';
import { RunPanel } from './RunPanel';
import { FlipSection } from './FlipSection';
import { RetireSection } from './RetireSection';
import { RUN_STATUS_LABEL, RUN_TONE, scopeChannelRefs, scopeText } from './labels';
import { getNames } from '@/lib/api/audit';

import { LocalTime } from '@/components/LocalTime';
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function settled<T>(result: PromiseSettledResult<T>, what: string): T | null {
  if (result.status === 'fulfilled') return result.value;
  logger.error(`[backfill] Failed to load ${what}`, { error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
  return null;
}

/**
 * R2 backfill of existing videos (epic AUN-R2-MIGRATION, docs/media-delivery/BACKFILL.md): pick a scope, see
 * the estimate from real sizes, set the cap and press Start; then play R2 first (per video, channel or
 * everywhere) and, as its own action, retire a legacy Bunny library after a grace period.
 */
/** The environment this admin runs in (NEXTJS_ENV, the same switch as the tab icon). */
function environmentLabel(env: string | undefined) {
  switch ((env ?? '').toLowerCase()) {
    case 'production':
      return 'mediaBackfill.envProduction' as const;
    case 'stage':
    case 'staging':
      return 'mediaBackfill.envStage' as const;
    case 'qa':
      return 'mediaBackfill.envQa' as const;
    default:
      return 'mediaBackfill.envDevelopment' as const;
  }
}

export default async function BackfillPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { t } = await getI18n();
  const session = await getAdminSession();
  if (!canManageMedia(session?.user.role)) {
    return <ErrorAlert testId="backfill-no-access">{t('mediaBackfill.noAccess')}</ErrorAlert>;
  }

  const [runsResult, librariesResult, providersResult, overviewResult] = await Promise.allSettled([listBackfillRuns(), listBunnyLibraries(), getMediaProviders(), getBackfillOverview()]);
  const overview: BackfillOverview | null = settled(overviewResult, 'overview');
  const runs: BackfillRun[] | null = settled(runsResult, 'runs');
  const libraries: BunnyLibraryView[] | null = settled(librariesResult, 'libraries');
  const providers = settled(providersResult, 'provider settings');
  const globalOrder: MediaProviderId[] | null = providers?.settings.playback.order ?? null;

  const wanted = typeof params.run === 'string' ? params.run : runs?.[0]?.id;
  let current: BackfillRun | null = runs?.find((r) => r.id === wanted) ?? null;
  if (!current && wanted) {
    const res = await getBackfillRun(wanted);
    if (res.ok) current = res.data.run;
  }
  // Channel-scoped runs say which channel by name, never its id
  const names = await getNames({ users: [], items: scopeChannelRefs([...(runs ?? []), ...(current ? [current] : [])]) });

  return (
    <div className="space-y-6">
      <div className="max-w-3xl">
        <h1 className="text-3xl font-bold text-fg">{t('mediaBackfill.title')}</h1>
        <p className="text-fg-muted mt-1">{t('mediaBackfill.subtitle')}</p>
      </div>

      {overview ? <Overview overview={overview} environment={t(environmentLabel(process.env.NEXTJS_ENV))} /> : <ErrorAlert testId="backfill-overview-error">{t('mediaBackfill.overviewFailed')}</ErrorAlert>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <NewRun />
        <section className={cardClass} aria-labelledby="backfill-runs-title" data-testid="backfill-runs">
          <h2 id="backfill-runs-title" className="text-xl font-semibold text-fg mb-3">{t('mediaBackfill.runsTitle')}</h2>
          {!runs && <ErrorAlert testId="backfill-runs-error">{t('mediaBackfill.runsFailed')}</ErrorAlert>}
          {runs && runs.length === 0 && <p className="text-fg-muted text-sm">{t('mediaBackfill.runsEmpty')}</p>}
          {runs && runs.length > 0 && (
            <ul className="space-y-2">
              {runs.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/backfill?run=${encodeURIComponent(r.id)}`}
                    aria-current={r.id === current?.id ? 'page' : undefined}
                    className={`block rounded border px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus ${r.id === current?.id ? 'border-accent bg-surface-2' : 'border-border hover:bg-surface-hover'}`}
                  >
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm text-fg">{scopeText(r, t, names)}</span>
                      <Chip tone={RUN_TONE[r.status]}>{t(RUN_STATUS_LABEL[r.status])}</Chip>
                    </span>
                    <span className="block text-xs text-fg-muted mt-1"><LocalTime value={r.createdAt} withTime /></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {current && <RunPanel initial={current} />}
      <FlipSection globalOrder={globalOrder} />
      <RetireSection libraries={libraries} />
    </div>
  );
}
