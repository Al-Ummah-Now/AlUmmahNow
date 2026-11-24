'use client';

import { useCallback, useRef, useState } from 'react';
import type { AdminSuggestion } from '@al-ummah/shared-types';
import Link from '@/components/AppLink';
import { useLanguage } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/translate';
import { Autocomplete, type AutocompleteSource } from '@/components/search/Autocomplete';
import { Select } from '@/components/select/Select';
import { ConfirmButton } from '@/components/content/actions';
import { Chip, cardTable, primarySmallButtonClass, smallButtonClass } from '@/components/content/parts';
import { cardClass, fieldClass, linkClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import type { KidsAdminActions, KidsAgeBand, KidsCatalogItem, KidsCatalogListResponse, KidsTargetType, KidsTopic } from '@/lib/api/kids-types';
import { AGE_BAND_OPTIONS, TOPIC_OPTIONS, formatAgeBand, formatTopic } from './kids-helpers';

type GuardedFn = (
  key: string,
  fn: () => Promise<{ ok: boolean; status?: number; error?: string; code?: string }>,
  options?: { onOk?: () => void; refresh?: boolean },
) => Promise<boolean>;

const STATUS_TONE: Record<string, 'good' | 'warn' | 'neutral'> = {
  approved: 'good',
  revoked: 'warn',
  deleted: 'neutral',
};

const KNOWN_REVOCATION_REASONS = [
  'video_update',
  'thumbnail_update',
  'thumbnail_upload',
  'bulk_update',
  'bulk_undo',
  'media_upload_complete',
  'renditions_complete',
  'chapters_update',
  'subtitle_upload',
  'subtitle_set_default',
  'subtitle_delete',
  'caption_publish',
  'audio_track_create',
  'audio_track_upload',
  'audio_track_complete',
  'audio_track_retry',
  'audio_track_update',
  'audio_track_delete',
  'admin_video_update',
  'admin_thumbnail_upload',
] as const;

export function KidsCatalogTab({
  initial,
  actions,
  busy,
  guarded,
  onError,
}: {
  initial: KidsCatalogListResponse;
  actions: KidsAdminActions;
  busy: string | null;
  guarded: GuardedFn;
  onError: (msg: string) => void;
}) {
  const { t, locale } = useLanguage();
  const [items, setItems] = useState<KidsCatalogItem[]>(initial.items);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const canDelete = initial.canDelete;

  const [targetType, setTargetType] = useState<KidsTargetType>('video');
  const [pickedId, setPickedId] = useState('');
  const [pickedItem, setPickedItem] = useState<AdminSuggestion | null>(null);
  const [pickerKey, setPickerKey] = useState(0);
  const [ageBand, setAgeBand] = useState<KidsAgeBand>('all');
  const [topics, setTopics] = useState<KidsTopic[]>([]);

  const [filterStatus, setFilterStatus] = useState('');
  const [filterAgeBand, setFilterAgeBand] = useState('');
  const [filterType, setFilterType] = useState('');
  const appliedFiltersRef = useRef({ status: '', ageBand: '', targetType: '' });

  const staffPlaylistSource = useCallback<AutocompleteSource>(
    (query, cursor) => actions.searchStaffPlaylists(query, cursor),
    [actions],
  );

  async function refresh(cursor: string | null = null, append = false) {
    const active = append
      ? appliedFiltersRef.current
      : { status: filterStatus, ageBand: filterAgeBand, targetType: filterType };
    if (!append) appliedFiltersRef.current = active;
    const res = await actions.listCatalog({
      ...(active.status ? { status: active.status } : {}),
      ...(active.ageBand ? { ageBand: active.ageBand } : {}),
      ...(active.targetType ? { targetType: active.targetType } : {}),
      ...(cursor ? { cursor } : {}),
    });
    setItems((prev) => (append ? [...prev, ...res.items] : res.items));
    setHasMore(res.hasMore);
    setNextCursor(res.nextCursor);
  }

  function toggleTopic(topic: KidsTopic) {
    setTopics((prev) => (prev.includes(topic) ? prev.filter((x) => x !== topic) : prev.length < 4 ? [...prev, topic] : prev));
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!pickedId) {
      onError(t('kids.errors.pickTargetRequired'));
      return;
    }
    const ok = await guarded(
      'catalog:add',
      async () => {
        const res = await actions.createCatalog({ targetType, targetId: pickedId, ageBand, topics });
        if (res.ok) {
          setItems((prev) => {
            const exists = prev.some((x) => x.id === res.data.item.id);
            return exists ? prev.map((x) => (x.id === res.data.item.id ? res.data.item : x)) : [res.data.item, ...prev];
          });
          setPickedId('');
          setPickedItem(null);
          setPickerKey((k) => k + 1);
          setTopics([]);
        }
        return res;
      },
    );
    if (ok) onError('');
  }

  async function handlePatch(item: KidsCatalogItem, patch: Parameters<KidsAdminActions['updateCatalog']>[1]) {
    await guarded(`catalog:patch:${item.id}`, async () => {
      const res = await actions.updateCatalog(item.id, patch);
      if (res.ok) setItems((prev) => prev.map((x) => (x.id === item.id ? res.data.item : x)));
      return res;
    });
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleAdd} className={`${cardClass} space-y-4`} data-testid="kids-catalog-add-form">
        <h2 className="text-lg font-semibold text-fg">{t('kids.catalog.addHeading')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-fg-muted">{t('kids.catalog.targetType')}</span>
            <Select
              value={targetType}
              onChange={(e) => {
                setTargetType(e.target.value as KidsTargetType);
                setPickedId('');
                setPickedItem(null);
                setPickerKey((k) => k + 1);
              }}
              className={fieldClass}
              data-testid="kids-catalog-target-type"
            >
              <option value="video">{t('kids.targetTypes.video')}</option>
              <option value="playlist">{t('kids.targetTypes.playlist')}</option>
            </Select>
            <span className="text-xs text-fg-muted">{t('kids.catalog.playlistNote')}</span>
          </label>
          <div className="md:col-span-2">
            <Autocomplete
              key={`${targetType}-${pickerKey}`}
              kind={targetType}
              mode="pick"
              source={targetType === 'playlist' ? staffPlaylistSource : undefined}
              allowIds={targetType !== 'playlist'}
              label={t(targetType === 'playlist' ? 'kids.catalog.pickPlaylist' : 'kids.catalog.pickVideo')}
              placeholder={t('kids.catalog.pickPlaceholder')}
              hint={t(targetType === 'playlist' ? 'kids.catalog.staffPlaylistHint' : 'kids.catalog.pickHint')}
              messages={targetType === 'playlist' ? { emptyList: t('kids.catalog.staffPlaylistEmpty') } : undefined}
              defaultValue={pickedId}
              defaultItem={pickedItem}
              testId="kids-catalog-picker"
              onChange={(id, item) => {
                setPickedId(id);
                setPickedItem(item);
              }}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-fg-muted">{t('kids.catalog.ageBand')}</span>
            <Select
              value={ageBand}
              onChange={(e) => setAgeBand(e.target.value as KidsAgeBand)}
              className={fieldClass}
              data-testid="kids-catalog-age-band"
            >
              {AGE_BAND_OPTIONS.map((b) => (
                <option key={b} value={b}>{formatAgeBand(b, t, locale)}</option>
              ))}
            </Select>
          </label>
        </div>

        <div className="space-y-2">
          <span className="block text-sm text-fg-muted">{t('kids.catalog.topics')}</span>
          <div className="flex flex-wrap gap-2">
            {TOPIC_OPTIONS.map((topic) => {
              const selected = topics.includes(topic);
              return (
                <button
                  key={topic}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleTopic(topic)}
                  className={`px-3 py-1 rounded-full border text-sm transition-colors ${selected ? 'border-accent bg-accent text-on-accent font-medium' : 'border-border bg-surface-2 text-fg hover:bg-surface-hover'}`}
                  data-testid={`kids-topic-${topic}`}
                >
                  {formatTopic(topic, t)}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <button
            type="submit"
            disabled={!!busy}
            className={primaryButtonClass}
            data-testid="kids-catalog-add-submit"
          >
            {busy === 'catalog:add' ? t('kids.catalog.adding') : t('kids.catalog.add')}
          </button>
        </div>
      </form>

      <div className={`${cardClass} flex flex-wrap items-end gap-3`} data-testid="kids-catalog-filters">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-fg-muted">{t('kids.catalog.filterStatus')}</span>
          <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className={fieldClass}>
            <option value="">{t('kids.catalog.statuses.all')}</option>
            <option value="approved">{t('kids.catalog.statuses.approved')}</option>
            <option value="revoked">{t('kids.catalog.statuses.revoked')}</option>
            <option value="deleted">{t('kids.catalog.statuses.deleted')}</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-fg-muted">{t('kids.catalog.filterAgeBand')}</span>
          <Select value={filterAgeBand} onChange={(e) => setFilterAgeBand(e.target.value)} className={fieldClass}>
            <option value="">{t('kids.catalog.allAgeBands')}</option>
            {AGE_BAND_OPTIONS.map((b) => (
              <option key={b} value={b}>{formatAgeBand(b, t, locale)}</option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-fg-muted">{t('kids.catalog.filterType')}</span>
          <Select value={filterType} onChange={(e) => setFilterType(e.target.value)} className={fieldClass}>
            <option value="">{t('kids.catalog.allTypes')}</option>
            <option value="video">{t('kids.targetTypes.video')}</option>
            <option value="playlist">{t('kids.targetTypes.playlist')}</option>
          </Select>
        </label>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void guarded('catalog:filter', async () => { await refresh(null, false); return { ok: true }; }, { refresh: false })}
          className={secondaryButtonClass}
          data-testid="kids-catalog-filter-apply"
        >
          {t('kids.catalog.applyFilters')}
        </button>
      </div>

      {items.length === 0 ? (
        <div className={`${cardClass} text-fg-muted text-sm`} data-testid="kids-catalog-empty">{t('kids.catalog.empty')}</div>
      ) : (
        <div className={cardTable.wrap}>
          <table className={cardTable.table} data-testid="kids-catalog-table">
            <thead className={cardTable.head}>
              <tr>
                <th className="text-start px-4 py-3 text-fg-muted text-sm">{t('kids.catalog.colItem')}</th>
                <th className="text-start px-4 py-3 text-fg-muted text-sm">{t('kids.catalog.colType')}</th>
                <th className="text-start px-4 py-3 text-fg-muted text-sm">{t('kids.catalog.colAgeBand')}</th>
                <th className="text-start px-4 py-3 text-fg-muted text-sm">{t('kids.catalog.colStatus')}</th>
                <th className="text-end px-4 py-3 text-fg-muted text-sm">{t('kids.catalog.colActions')}</th>
              </tr>
            </thead>
            <tbody className={cardTable.body}>
              {items.map((item) => (
                <tr key={item.id} className={cardTable.row} data-testid={`kids-catalog-row-${item.id}`}>
                  <td className={cardTable.cell}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-fg break-words" dir="auto">{item.targetTitle?.trim() || item.targetId}</span>
                      {item.targetType === 'video' && (
                        <Link
                          href={`/videos/${encodeURIComponent(item.targetId)}`}
                          className={`${linkClass} text-xs`}
                          data-testid={`kids-catalog-watch-${item.id}`}
                        >
                          {t('kids.reviews.watchVideo')}
                        </Link>
                      )}
                    </div>
                    {item.topics.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {item.topics.map((tp) => (
                          <Chip key={tp} tone="info">{formatTopic(tp, t)}</Chip>
                        ))}
                      </div>
                    )}
                    {item.status === 'revoked' && item.revokedByEdit && (
                      <div className="mt-1 text-xs text-warn-fg" data-testid={`kids-catalog-edit-revoked-${item.id}`}>
                        {item.revocationReason && (KNOWN_REVOCATION_REASONS as readonly string[]).includes(item.revocationReason)
                          ? t('kids.catalog.editedRevokeWithReason', {
                              reason: t(`kids.catalog.revocationReasons.${item.revocationReason}` as MessageKey),
                            })
                          : t('kids.catalog.editedRevokeNotice')}
                      </div>
                    )}
                  </td>
                  <td className={cardTable.cell}>
                    <span className="text-sm text-fg">{t(`kids.targetTypes.${item.targetType}` as Parameters<typeof t>[0])}</span>
                  </td>
                  <td className={cardTable.cell}>
                    <Select
                      aria-label={t('kids.catalog.colAgeBand')}
                      value={item.ageBand}
                      disabled={item.status === 'deleted' || !!busy}
                      onChange={(e) => void handlePatch(item, { ageBand: e.target.value as KidsAgeBand })}
                      className={fieldClass}
                    >
                      {AGE_BAND_OPTIONS.map((b) => (
                        <option key={b} value={b}>{formatAgeBand(b, t, locale)}</option>
                      ))}
                    </Select>
                  </td>
                  <td className={cardTable.cell}>
                    <Chip tone={STATUS_TONE[item.status] ?? 'neutral'}>
                      {t(`kids.catalog.statuses.${item.status}` as Parameters<typeof t>[0])}
                    </Chip>
                  </td>
                  <td className={cardTable.actions}>
                    <div className="flex flex-wrap gap-2 justify-end">
                      {item.status === 'approved' && (
                        <button
                          type="button"
                          disabled={!!busy}
                          onClick={() => void handlePatch(item, { status: 'revoked' })}
                          className={smallButtonClass}
                        >
                          {t('kids.catalog.revoke')}
                        </button>
                      )}
                      {item.status === 'revoked' && item.revokedByEdit && (
                        <ConfirmButton
                          label={t('kids.catalog.reapproveAfterReview')}
                          title={t('kids.catalog.reapproveEditedTitle')}
                          body={t('kids.catalog.reapproveEditedBody')}
                          confirmLabel={t('kids.catalog.reapproveEditedConfirm')}
                          busy={busy === `catalog:patch:${item.id}`}
                          disabled={!!busy}
                          testId={`kids-catalog-reapprove-confirm-${item.id}`}
                          onConfirm={async () => {
                            await handlePatch(item, { status: 'approved' });
                          }}
                        />
                      )}
                      {item.status === 'revoked' && !item.revokedByEdit && (
                        <button
                          type="button"
                          disabled={!!busy}
                          onClick={() => void handlePatch(item, { status: 'approved' })}
                          className={primarySmallButtonClass}
                        >
                          {t('kids.catalog.approve')}
                        </button>
                      )}
                      {canDelete && item.status !== 'deleted' && (
                        <ConfirmButton
                          label={t('kids.catalog.remove')}
                          title={t('kids.catalog.removeTitle')}
                          body={t('kids.catalog.removeBody')}
                          confirmLabel={t('kids.catalog.removeConfirm')}
                          withReason
                          danger
                          busy={busy === `catalog:del:${item.id}`}
                          disabled={!!busy}
                          testId={`kids-catalog-remove-${item.id}`}
                          onConfirm={async (reason) => {
                            await guarded(`catalog:del:${item.id}`, async () => {
                              const res = await actions.deleteCatalog(item.id, reason || undefined);
                              if (res.ok) setItems((prev) => prev.filter((x) => x.id !== item.id));
                              return res;
                            });
                          }}
                        />
                      )}
                      {canDelete && item.status === 'deleted' && (
                        <button
                          type="button"
                          disabled={!!busy}
                          onClick={() =>
                            void guarded(`catalog:res:${item.id}`, async () => {
                              const res = await actions.restoreCatalog(item.id);
                              if (res.ok) setItems((prev) => prev.map((x) => (x.id === item.id ? res.data.item : x)));
                              return res;
                            })
                          }
                          className={primarySmallButtonClass}
                        >
                          {t('kids.catalog.restore')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasMore && nextCursor !== null && (
        <div>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void guarded('catalog:more', async () => { await refresh(nextCursor, true); return { ok: true }; }, { refresh: false })}
            className={secondaryButtonClass}
            data-testid="kids-catalog-load-more"
          >
            {t('kids.catalog.loadMore')}
          </button>
        </div>
      )}
    </div>
  );
}
