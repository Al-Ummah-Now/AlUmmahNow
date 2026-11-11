import { getAdminSession } from '@/lib/auth';
import { canManageLive } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { LiveStreamingView } from '@/components/live/LiveStreamingView';
import { getLiveAudit, getLiveComparison, getLiveSessions, getLiveSettings } from '@/lib/api/live';
import { defaultRange, isDay } from '@/lib/live-streaming';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Live streaming (D3): which provider new live streams go to in this
 * environment (round-robin by default), each provider's switches and caps,
 * channel overrides, active and recent sessions, and the two providers
 * compared side by side. Reads for every admin; changes need live:manage.
 * Each part loads on its own, so one failure leaves the rest usable.
 */
export default async function LiveStreamingPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { t } = await getI18n();
  const session = await getAdminSession();
  const range = defaultRange();
  const from = isDay(params.from) ? params.from : range.from;
  const to = isDay(params.to) ? params.to : range.to;
  const tests = params.tests === '1';

  const fail = (part: string) => (e: unknown) => {
    logger.error('[live-streaming] Failed to load', { part, error: e instanceof Error ? e.message : String(e) });
    return null;
  };
  const [settings, active, recent, comparison, audit] = await Promise.all([
    getLiveSettings().catch(fail('settings')),
    getLiveSessions('active').catch(fail('active sessions')),
    getLiveSessions('recent').catch(fail('recent sessions')),
    getLiveComparison(from, to, tests).catch(fail('comparison')),
    getLiveAudit().catch(fail('audit')),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-fg">{t('live.title')}</h1>
      <LiveStreamingView
        initial={{ view: settings, active: active ?? [], recent: recent ?? [], comparison, audit: audit ?? [] }}
        loadFailed={!settings || !active || !recent || !comparison || !audit}
        range={{ from, to, tests }}
        canManage={canManageLive(session?.user.role)}
      />
    </div>
  );
}
