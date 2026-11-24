'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatNumber, type MessageKey } from '@/i18n/translate';
import { PriorityTabs, type PriorityTab } from '@/components/PriorityTabs';
import { ErrorAlert } from '@/components/ui';
import { reportError } from '@/lib/errors/reporter';
import type {
  KidsAdminActions,
  KidsCatalogListResponse,
  KidsPageTab,
  KidsPolicyResponse,
  KidsReviewListResponse,
} from '@/lib/api/kids-types';
import { KidsCatalogTab } from './KidsCatalogTab';
import { KidsReviewsTab } from './KidsReviewsTab';
import { KidsPolicyTab } from './KidsPolicyTab';

const KNOWN_KIDS_ERROR_CODES = [
  'kids_catalog_not_found',
  'kids_catalog_deleted',
  'kids_video_hidden',
  'kids_staff_playlist_required',
  'kids_review_pending',
  'kids_review_already_decided',
  'kids_policy_stale',
  'video_not_found',
  'playlist_not_found',
  'forbidden',
  'passkey_required',
  'invalid_request',
] as const;

const TAB_BASE = 'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';
const TAB_CURRENT = 'border-accent text-fg';
const TAB_IDLE = 'border-transparent text-fg-muted hover:text-fg hover:border-border';

export function KidsAdmin({
  initialTab,
  actions,
  catalog,
  reviews,
  policy,
}: {
  initialTab: KidsPageTab;
  actions: KidsAdminActions;
  catalog: KidsCatalogListResponse;
  reviews: KidsReviewListResponse;
  policy: KidsPolicyResponse;
}) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const [tab, setTab] = useState<KidsPageTab>(initialTab);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function guarded(
    key: string,
    fn: () => Promise<{ ok: boolean; status?: number; error?: string; code?: string }>,
    options?: { onOk?: () => void; refresh?: boolean },
  ): Promise<boolean> {
    setBusy(key);
    setError('');
    try {
      const res = await fn();
      if (!res.ok) {
        const knownCode =
          res.code && (KNOWN_KIDS_ERROR_CODES as readonly string[]).includes(res.code)
            ? (t(`kids.errors.codes.${res.code}` as MessageKey) as string)
            : res.status === 403
              ? t('kids.errors.codes.forbidden')
              : t('kids.errors.failed');
        setError(knownCode);
        if ((res.status ?? 0) >= 500) reportError(new Error(res.error || 'Kids admin error'), { shown: true, status: res.status, extra: { action: key, code: res.code ?? null } });
        return false;
      }
      options?.onOk?.();
      if (options?.refresh !== false) router.refresh();
      return true;
    } catch (e) {
      reportError(e, { shown: true, extra: { action: key } });
      setError(t('kids.errors.failed'));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const formatPageCount = (count: number, hasMore: boolean) =>
    `${formatNumber(count, locale)}${hasMore ? '+' : ''}`;

  const tabs: PriorityTab[] = [
    {
      id: 'catalog',
      label: t('kids.tabs.catalog'),
      current: tab === 'catalog',
      extra: catalog.items.length > 0 ? <span className="ms-1 text-xs text-fg-muted">({formatPageCount(catalog.items.length, catalog.hasMore)})</span> : undefined,
    },
    {
      id: 'reviews',
      label: t('kids.tabs.reviews'),
      current: tab === 'reviews',
      extra: reviews.items.length > 0 ? <span className="ms-1 text-xs text-fg-muted">({formatPageCount(reviews.items.length, reviews.hasMore)})</span> : undefined,
    },
    {
      id: 'policy',
      label: t('kids.tabs.policy'),
      current: tab === 'policy',
    },
  ];

  return (
    <div className="space-y-6">
      <PriorityTabs
        tabs={tabs}
        label={t('kids.tabsLabel')}
        tabClassName={TAB_BASE}
        currentClassName={TAB_CURRENT}
        idleClassName={TAB_IDLE}
        className="border-b border-border"
        testId="kids-tabs"
        tabTestIdPrefix="kids-tab-"
        onSelect={(id) => {
          setError('');
          setTab(id as KidsPageTab);
        }}
      />

      {error && <ErrorAlert testId="kids-action-error">{error}</ErrorAlert>}

      {tab === 'catalog' && (
        <KidsCatalogTab
          initial={catalog}
          actions={actions}
          busy={busy}
          guarded={guarded}
          onError={setError}
        />
      )}
      {tab === 'reviews' && <KidsReviewsTab initial={reviews} actions={actions} busy={busy} guarded={guarded} />}
      {tab === 'policy' && <KidsPolicyTab initial={policy} actions={actions} busy={busy} guarded={guarded} />}
    </div>
  );
}
