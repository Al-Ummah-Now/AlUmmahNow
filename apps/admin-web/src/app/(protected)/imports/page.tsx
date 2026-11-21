import Link from '@/components/AppLink';
import { redirect } from 'next/navigation';
import type { AdminImportBatch, ImportItemState } from '@al-ummah/shared-types';
import { getAdminSession } from '@/lib/auth';
import { canManageImports } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { formatNumber, type MessageKey } from '@/i18n/translate';
import { ErrorAlert, linkClass } from '@/components/ui';
import { Chip, EmptyState, PageHeader, cardTable, thClass, type ChipTone } from '@/components/content/parts';
import { pickParams, type SearchParams } from '@/components/content/query';
import { LocalTime } from '@/components/LocalTime';
import { UserName } from '@/components/audit/UserName';
import { fillNodes } from '@/components/audit/fill';
import { listImportBatches, findImportByVideo } from '@/lib/api/imports';
import { logger } from '@/lib/logger';
import { BatchName } from './BatchName';

export const dynamic = 'force-dynamic';

const STATE_ORDER: ImportItemState[] = ['uploaded', 'initiated', 'failed'];
const STATE_TONE: Record<ImportItemState, ChipTone> = { uploaded: 'good', initiated: 'warn', failed: 'bad' };
const ID = /^[A-Za-z0-9_-]{1,200}$/;

/**
 * Imports (wiki TOOLS-ADMIN TA-8): the latest batches Admin Tools made, with their files per state.
 * `?channel=` keeps one channel's; `?video=` (the Errors page's link) opens the batch page of the file
 * that video came from.
 */
/** A column's name above its value inside a phone card (the table head is visually hidden there; screen readers already hear it). */
const phoneLabel = 'md:hidden block text-xs text-fg-muted mb-0.5';

export default async function ImportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const raw = await searchParams;
  const params = pickParams(raw, { channel: 'text', video: 'text' });
  const { t, locale } = await getI18n();
  const session = await getAdminSession();
  if (!canManageImports(session?.user.role)) return <ErrorAlert testId="imports-no-access">{t('content.errors.forbidden')}</ErrorAlert>;

  if (params.video && ID.test(params.video)) {
    let found: Awaited<ReturnType<typeof findImportByVideo>> = null;
    try {
      found = await findImportByVideo(params.video);
    } catch (e) {
      logger.error('[imports] Could not find the file of a video', { videoId: params.video, error: e instanceof Error ? e.message : String(e) });
    }
    if (found) redirect(`/imports/${encodeURIComponent(found.item.batchId)}${found.page > 1 ? `?page=${found.page}` : ''}#item-${found.item.id}`);
  }
  const notImported = !!params.video;
  const channel = params.channel && ID.test(params.channel) ? params.channel : undefined;

  let batches: AdminImportBatch[] | null = null;
  try {
    batches = await listImportBatches(channel);
  } catch (e) {
    logger.error('[imports] Failed to load the batches', { error: e instanceof Error ? e.message : String(e) });
  }
  const channelName = channel ? batches?.find((b) => b.channelId === channel)?.channelName : undefined;

  return (
    <div>
      <PageHeader title={t('imports.title')} subtitle={t('imports.subtitle')} t={t} />
      {notImported && (
        <ErrorAlert testId="imports-video-not-imported">{t('imports.videoNotImported')}</ErrorAlert>
      )}
      {channel && (
        <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="imports-channel-filter">
          <Chip tone="info">
            <bdi>{channelName ?? t('imports.channelGone')}</bdi>
          </Chip>
          <Link href="/imports" className={`${linkClass} text-sm`}>
            {t('imports.allImports')}
          </Link>
        </div>
      )}
      {!batches && <ErrorAlert testId="imports-error">{t('imports.loadFailed')}</ErrorAlert>}
      {batches && batches.length === 0 && <EmptyState>{t('imports.empty')}</EmptyState>}
      {batches && batches.length > 0 && (
        <div className={cardTable.wrap}>
          <table className={cardTable.table} data-testid="import-batches">
            <caption className="sr-only">{t('imports.listCaption')}</caption>
            <thead className={cardTable.head}>
              <tr>
                <th className={thClass} scope="col">{t('imports.colBatch')}</th>
                <th className={thClass} scope="col">{t('imports.colChannel')}</th>
                <th className={thClass} scope="col">{t('imports.colFiles')}</th>
                <th className={thClass} scope="col">{t('imports.colStarted')}</th>
              </tr>
            </thead>
            <tbody className={cardTable.body}>
              {batches.map((b) => (
                <tr key={b.id} className={cardTable.row} data-testid="import-batch" data-batch-id={b.id}>
                  <td className={cardTable.cell}>
                    <Link href={`/imports/${encodeURIComponent(b.id)}`} className={`${linkClass} font-medium break-words`}>
                      <BatchName name={b.name} createdAt={b.createdAt} />
                    </Link>
                    <span className="block text-xs text-fg-muted mt-0.5">
                      {fillNodes(t('imports.by'), { actor: <UserName id={b.createdBy} showEmail={false} /> })}
                    </span>
                  </td>
                  {/* On a phone the row is a card: the cells stack tight under the name, each with its column's label */}
                  <td className={`${cardTable.cell} pt-0 md:pt-3`}>
                    <span className={phoneLabel} aria-hidden="true">{t('imports.colChannel')}</span>
                    {b.channelName ? (
                      <Link href={`/imports?channel=${encodeURIComponent(b.channelId)}`} className={`${linkClass} break-words`}>
                        <bdi>{b.channelName}</bdi>
                      </Link>
                    ) : (
                      <span className="text-sm text-fg-muted">{t('imports.channelGone')}</span>
                    )}
                  </td>
                  <td className={`${cardTable.cell} pt-0 md:pt-3`}>
                    <span className={phoneLabel} aria-hidden="true">{t('imports.colFiles')}</span>
                    <ul className="flex flex-wrap gap-1.5">
                      {STATE_ORDER.filter((s) => (b.counts?.[s] ?? 0) > 0).map((s) => (
                        <li key={s} data-state={s}>
                          <Chip tone={STATE_TONE[s]}>{t(`imports.counts.${s}` as MessageKey, { count: formatNumber(b.counts?.[s] ?? 0, locale) })}</Chip>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className={`${cardTable.cell} pt-0 md:pt-3 text-sm text-fg-muted`}>
                    <span className={phoneLabel} aria-hidden="true">{t('imports.colStarted')}</span>
                    <LocalTime value={b.createdAt} withTime />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
