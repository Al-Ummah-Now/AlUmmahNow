/**
 * Ummah Kids admin UI (E20-3): nav item placement, bilingual strings, localized
 * age-band numerals, and SSR rendering of all three curation/policy tabs.
 */
import './support/next-navigation-stub';
import { routerCalls } from './support/next-navigation-stub';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { createTranslator } from '../src/i18n/translate';
import { NAV_ITEMS, visibleItems, type NavAccess } from '../src/components/shell/nav-model';
import { formatAgeBand } from '../src/app/(protected)/kids/kids-helpers';
import { KidsAdmin } from '../src/app/(protected)/kids/KidsAdmin';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';

(globalThis as unknown as { React: unknown }).React = React;

const adminAccess: NavAccess = {
  contact: true,
  processing: true,
  errors: true,
  manageUsers: true,
  staleUploads: true,
  media: true,
  ops: true,
  audit: true,
  settings: true,
};

const sampleProps = {
  catalog: {
    items: [
      {
        id: 'kids_1',
        targetType: 'video' as const,
        targetId: 'vid_prophets_1',
        targetTitle: 'Stories of the Prophets for Young Kids',
        ageBand: '3-6' as const,
        status: 'approved' as const,
        topics: ['prophets_stories' as const, 'character' as const],
        position: 0,
        approvedBy: 'admin_1',
        approvedAt: '2026-11-23T00:00:00Z',
        deletedAt: null,
        deletedBy: null,
        deleteReason: null,
        purgeAfter: null,
        updatedAt: '2026-11-23T00:00:00Z',
      },
    ],
    hasMore: false,
    nextCursor: null,
    canDelete: true,
  },
  reviews: {
    items: [
      {
        id: 'krev_1',
        channelId: 'ch_1',
        channelName: 'Al Noor Youth',
        targetType: 'video' as const,
        targetId: 'vid_review_1',
        targetTitle: 'Kindness to Neighbors',
        requestedBy: 'creator_1',
        requestedByName: 'Ustadha Fatima',
        suggestedAgeBand: '7-12' as const,
        notes: 'Illustrated story of kindness',
        status: 'pending' as const,
        decisionReason: null,
        decidedBy: null,
        decidedAt: null,
        createdAt: '2026-11-23T00:00:00Z',
      },
    ],
    hasMore: false,
    nextCursor: null,
  },
  policy: {
    decisions: { 'KIDS-D1': 'B' },
    staffChannelIds: ['ch_staff'],
    staffChannels: [{ id: 'ch_staff', name: 'Al Noor Kids Studio' }],
    legalApproved: false,
    legalApprovedBy: null,
    legalApprovedByName: null,
    legalApprovedAt: null,
    updatedAt: null,
    readiness: {
      ready: false,
      blockers: ['legal_not_approved' as const],
      openDecisions: ['KIDS-D2' as const],
    },
    canEdit: true,
  },
};

function renderTab(tab: 'catalog' | 'reviews' | 'policy', locale: 'en' | 'ar'): string {
  const stubActions = {
    listCatalog: async () => sampleProps.catalog,
    createCatalog: async () => ({ ok: true as const, data: { item: sampleProps.catalog.items[0] } }),
    updateCatalog: async () => ({ ok: true as const, data: { item: sampleProps.catalog.items[0] } }),
    deleteCatalog: async () => ({ ok: true as const, data: { item: sampleProps.catalog.items[0] } }),
    restoreCatalog: async () => ({ ok: true as const, data: { item: sampleProps.catalog.items[0] } }),
    searchStaffPlaylists: async () => ({ items: [], next: null }),
    listReviews: async () => sampleProps.reviews,
    decideReview: async () => ({ ok: true as const, data: { request: sampleProps.reviews.items[0] } }),
    updatePolicy: async () => ({ ok: true as const, data: sampleProps.policy }),
  };
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      { locale, theme: null, children: React.createElement(KidsAdmin, { initialTab: tab, actions: stubActions, ...sampleProps }) },
    ),
  );
}

describe('Ummah Kids admin UI (E20-3)', () => {
  it('places /kids in Content navigation for admins and moderators, hidden from review-only', () => {
    const item = NAV_ITEMS.find((i) => i.href === '/kids');
    assert.ok(item);
    assert.equal(item.group, 'content');
    assert.ok(visibleItems(adminAccess).some((i) => i.href === '/kids'));
    assert.ok(!visibleItems({ ...adminAccess, reviewOnly: true }).some((i) => i.href === '/kids'));
    assert.equal(Object.keys(ar.kids).sort().join(','), Object.keys(en.kids).sort().join(','));
  });

  it('formats age bands using Eastern Arabic numerals on Arabic pages', () => {
    const tEn = createTranslator('en');
    const tAr = createTranslator('ar');
    assert.equal(formatAgeBand('3-6', tEn, 'en'), 'Early learners (3–6)');
    const arBand = formatAgeBand('3-6', tAr, 'ar');
    assert.ok(arBand.includes('٣') && arBand.includes('٦'), arBand);
    assert.doesNotMatch(arBand, /[0-9]/);
  });

  it('renders catalog, reviews, and policy tabs cleanly in English and Arabic', () => {
    const catalogEn = renderTab('catalog', 'en');
    assert.ok(catalogEn.includes('Stories of the Prophets for Young Kids'));
    assert.ok(catalogEn.includes('Find video'));
    assert.ok(!catalogEn.includes('Find Video'));
    assert.ok(catalogEn.includes('All types'));
    assert.ok(catalogEn.includes('All ages'));
    assert.ok(catalogEn.includes('Curated playlists show only individually approved Kids videos'));
    assert.ok(!catalogEn.includes('No-instruments'));
    assert.ok(catalogEn.includes('kids-catalog-picker'));

    const catalogAr = renderTab('catalog', 'ar');
    assert.ok(catalogAr.includes('جميع الأنواع'));
    assert.ok(catalogAr.includes('جميع الأعمار'));
    assert.ok(!catalogAr.includes('بلا آلات موسيقية'));
    assert.ok(!catalogAr.includes('مسارات التعلّم'));

    const reviewsEn = renderTab('reviews', 'en');
    assert.ok(reviewsEn.includes('Kindness to Neighbors'));
    assert.ok(reviewsEn.includes('Al Noor Youth'));
    assert.ok(reviewsEn.includes('Ustadha Fatima'));
    assert.ok(reviewsEn.includes('Illustrated story of kindness'));
    assert.ok(reviewsEn.includes('kids-review-watch-krev_1'));
    assert.ok(reviewsEn.includes('kids-review-topic-krev_1-dua'));

    const reviewsAr = renderTab('reviews', 'ar');
    assert.ok(!reviewsAr.includes('font-semibold text-fg" dir="ltr"'));

    const policyEn = renderTab('policy', 'en');
    assert.ok(policyEn.includes('Child data model'));
    assert.ok(policyEn.includes('Editorial Kids channels'));
    assert.ok(policyEn.includes('Al Noor Kids Studio'));
    assert.ok(!policyEn.includes('Instrument-free filter scope'));
    assert.ok(policyEn.includes('Notifications &amp; push in Kids Mode'));
    assert.ok(policyEn.includes('kids-policy-save'));
    assert.ok(!/>KIDS-D\d+</.test(policyEn));
    assert.ok(!policyEn.includes('Epic 20'));

    const policyAr = renderTab('policy', 'ar');
    assert.ok(policyAr.includes('نموذج بيانات الأطفال'));
    assert.ok(policyAr.includes('قنوات التحرير للأطفال'));
    assert.ok(!/>KIDS-D\d+</.test(policyAr));
    assert.ok(!policyAr.includes('الملحمة'));
  });

  it('keeps loaded review page 2 on screen after Load more without triggering router.refresh', async () => {
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1/' });
    const prevGlobals = {
      window: globalThis.window,
      document: globalThis.document,
      HTMLElement: globalThis.HTMLElement,
      HTMLInputElement: globalThis.HTMLInputElement,
      Element: globalThis.Element,
      Node: globalThis.Node,
      Event: globalThis.Event,
      MouseEvent: globalThis.MouseEvent,
      KeyboardEvent: globalThis.KeyboardEvent,
      getComputedStyle: globalThis.getComputedStyle,
      ResizeObserver: globalThis.ResizeObserver,
      IS_REACT_ACT_ENVIRONMENT: (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT,
    };
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      HTMLElement: dom.window.HTMLElement,
      HTMLInputElement: dom.window.HTMLInputElement,
      Element: dom.window.Element,
      Node: dom.window.Node,
      Event: dom.window.Event,
      MouseEvent: dom.window.MouseEvent,
      KeyboardEvent: dom.window.KeyboardEvent,
      getComputedStyle: dom.window.getComputedStyle,
      ResizeObserver: (dom.window as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver ?? class { observe() {} unobserve() {} disconnect() {} },
      IS_REACT_ACT_ENVIRONMENT: true,
    });

    routerCalls.length = 0;
    const requestedCursors: Array<string | undefined> = [];
    const page2Item = {
      ...sampleProps.reviews.items[0],
      id: 'krev_2',
      targetId: 'vid_review_2',
      targetTitle: 'Page Two Bedtime Duas',
    };
    const pagedActions = {
      listCatalog: async () => sampleProps.catalog,
      createCatalog: async () => ({ ok: true as const, data: { item: sampleProps.catalog.items[0] } }),
      updateCatalog: async () => ({ ok: true as const, data: { item: sampleProps.catalog.items[0] } }),
      deleteCatalog: async () => ({ ok: true as const, data: { item: sampleProps.catalog.items[0] } }),
      restoreCatalog: async () => ({ ok: true as const, data: { item: sampleProps.catalog.items[0] } }),
      searchStaffPlaylists: async () => ({ items: [], next: null }),
      listReviews: async (params?: { cursor?: string }) => {
        requestedCursors.push(params?.cursor);
        return { items: [page2Item], hasMore: false, nextCursor: null };
      },
      decideReview: async () => ({ ok: true as const, data: { request: sampleProps.reviews.items[0] } }),
      updatePolicy: async () => ({ ok: true as const, data: sampleProps.policy }),
    };

    const initialProps = {
      ...sampleProps,
      reviews: { items: [...sampleProps.reviews.items], hasMore: true, nextCursor: 'cur_p2' },
    };
    const { createRoot } = await import('react-dom/client');
    const rootEl = dom.window.document.getElementById('root')!;
    const root = createRoot(rootEl);

    try {
      await React.act(async () => {
        root.render(
          React.createElement(
            I18nProvider,
            { locale: 'en', theme: null, children: React.createElement(KidsAdmin, { initialTab: 'reviews', actions: pagedActions, ...initialProps }) },
          ),
        );
      });
      const btn = rootEl.querySelector('[data-testid="kids-reviews-load-more"]') as HTMLButtonElement | null;
      assert.ok(btn, 'Load more button should render');

      await React.act(async () => {
        btn.click();
      });

      assert.deepEqual(requestedCursors, ['cur_p2']);
      assert.equal(routerCalls.filter((c) => c === 'refresh').length, 0);
      assert.ok(rootEl.textContent?.includes('Kindness to Neighbors'));
      assert.ok(rootEl.textContent?.includes('Page Two Bedtime Duas'));

      // Re-rendering with a new wrapper object carrying the same first-page review ID must keep page 2 visible
      await React.act(async () => {
        root.render(
          React.createElement(
            I18nProvider,
            {
              locale: 'en',
              theme: null,
              children: React.createElement(KidsAdmin, {
                initialTab: 'reviews',
                actions: pagedActions,
                ...initialProps,
                reviews: { items: [{ ...sampleProps.reviews.items[0] }], hasMore: true, nextCursor: 'cur_p2' },
              }),
            },
          ),
        );
      });
      assert.ok(rootEl.textContent?.includes('Page Two Bedtime Duas'));

      // Approving page-1 item krev_1 must keep page-2 item on screen even when router.refresh changes page-1 signature
      const approveBtn = rootEl.querySelector('[data-testid="kids-review-approve-krev_1"]') as HTMLButtonElement | null;
      assert.ok(approveBtn);
      await React.act(async () => {
        approveBtn.click();
      });
      await React.act(async () => {
        root.render(
          React.createElement(
            I18nProvider,
            {
              locale: 'en',
              theme: null,
              children: React.createElement(KidsAdmin, {
                initialTab: 'reviews',
                actions: pagedActions,
                ...initialProps,
                reviews: {
                  items: [{ ...sampleProps.reviews.items[0], id: 'krev_3', targetId: 'vid_3', targetTitle: 'Fresh First Page' }],
                  hasMore: false,
                  nextCursor: null,
                },
              }),
            },
          ),
        );
      });
      assert.ok(rootEl.textContent?.includes('Page Two Bedtime Duas'));
      assert.ok(rootEl.textContent?.includes('Fresh First Page'));
      assert.ok(!rootEl.textContent?.includes('Kindness to Neighbors'));

      // Policy delta submit + Arabic error code mapping
      const policyPayloads: unknown[] = [];
      const policyRootEl = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(policyRootEl);
      const policyRoot = createRoot(policyRootEl);
      try {
        const policyActions = {
          ...pagedActions,
          updatePolicy: async (input: unknown) => {
            policyPayloads.push(input);
            return { ok: false as const, status: 409, code: 'kids_policy_stale', error: 'English raw stale msg' };
          },
        };
        await React.act(async () => {
          policyRoot.render(
            React.createElement(
              I18nProvider,
              {
                locale: 'ar',
                theme: null,
                children: React.createElement(KidsAdmin, {
                  initialTab: 'policy',
                  actions: policyActions,
                  ...sampleProps,
                  policy: { ...sampleProps.policy, updatedAt: '2026-11-23T01:00:00Z' },
                }),
              },
            ),
          );
        });
        const input = policyRootEl.querySelector('[data-testid="kids-decision-KIDS-D2"]') as HTMLInputElement;
        await React.act(async () => {
          const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!;
          setter.call(input, 'Option A');
          input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        });
        const form = policyRootEl.querySelector('[data-testid="kids-policy-form"]') as HTMLFormElement;
        await React.act(async () => {
          form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
        });
        assert.deepEqual(policyPayloads[0], {
          decisions: { 'KIDS-D2': 'Option A' },
          expectedUpdatedAt: '2026-11-23T01:00:00Z',
        });
        assert.ok(policyRootEl.textContent?.includes(ar.kids.errors.codes.kids_policy_stale));
        assert.ok(!policyRootEl.textContent?.includes('English raw stale msg'));
      } finally {
        await React.act(async () => {
          policyRoot.unmount();
        });
      }
    } finally {
      await React.act(async () => {
        root.unmount();
      });
      Object.assign(globalThis, prevGlobals);
      dom.window.close();
    }
  });

  it('shows revocation reason, watch link, and confirmation-gated re-approval on S-N edited catalog items', () => {
    const stubActions = {
      listCatalog: async () => sampleProps.catalog,
      createCatalog: async () => ({ ok: true as const, data: { item: sampleProps.catalog.items[0] } }),
      updateCatalog: async () => ({ ok: true as const, data: { item: sampleProps.catalog.items[0] } }),
      deleteCatalog: async () => ({ ok: true as const, data: { item: sampleProps.catalog.items[0] } }),
      restoreCatalog: async () => ({ ok: true as const, data: { item: sampleProps.catalog.items[0] } }),
      searchStaffPlaylists: async () => ({ items: [], next: null }),
      listReviews: async () => sampleProps.reviews,
      decideReview: async () => ({ ok: true as const, data: { request: sampleProps.reviews.items[0] } }),
      updatePolicy: async () => ({ ok: true as const, data: sampleProps.policy }),
    };
    const revCatalog = {
      ...sampleProps.catalog,
      items: [
        {
          ...sampleProps.catalog.items[0],
          id: 'kids_rev',
          status: 'revoked' as const,
          revokedByEdit: true,
          revocationReason: 'chapters_update',
          revokedAt: '2026-11-23T02:00:00Z',
        },
      ],
    };
    const htmlEn = renderToStaticMarkup(
      React.createElement(
        I18nProvider,
        {
          locale: 'en',
          theme: null,
          children: React.createElement(KidsAdmin, { initialTab: 'catalog', actions: stubActions, ...sampleProps, catalog: revCatalog }),
        },
      ),
    );
    assert.ok(htmlEn.includes('All age bands'));
    assert.ok(htmlEn.includes('kids-catalog-watch-kids_rev'));
    assert.ok(htmlEn.includes('kids-catalog-edit-revoked-kids_rev'));
    assert.ok(htmlEn.includes('chapters edited'));
    assert.ok(htmlEn.includes('kids-catalog-reapprove-confirm-kids_rev'));
    assert.ok(htmlEn.includes('Review &amp; approve'));
    assert.ok(!htmlEn.includes('>Re-approve<'));
  });
});
