/** Start review on the report page (#2015): what it says per status, the toggle, refusals, both languages. */
import './support/next-navigation-stub';
import { routerCalls } from './support/next-navigation-stub';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { ReportReview } from '../src/app/(protected)/moderation/reports/[id]/ReportReview';
import { openReports } from '../src/app/(protected)/dashboard/openReports';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';

(globalThis as unknown as { React: unknown }).React = React;

type Props = Parameters<typeof ReportReview>[0];
const element = (props: Partial<Props>, locale: 'en' | 'ar' = 'en') =>
  React.createElement(I18nProvider as unknown as React.FC<Record<string, unknown>>, { locale, theme: 'light' }, React.createElement(ReportReview, { reportId: 'r1', entityType: 'channel', status: 'pending', setReview: async () => ({ ok: true, data: {} }) as never, ...props }));

describe('start review', () => {
  for (const [locale, m] of [['en', en], ['ar', ar]] as const) {
    it(`says what a review means for a channel and for anything else, before and during it (${locale})`, () => {
      const texts = m.reportReview;
      for (const [props, shown] of [
        [{}, [texts.title, texts.channel, texts.start]],
        [{ status: 'reviewing' }, [texts.titleOn, texts.channelOn, texts.stop]],
        [{ entityType: 'video' }, [texts.title, texts.body, texts.start]],
        [{ entityType: 'video', status: 'reviewing' }, [texts.titleOn, texts.on, texts.stop]],
      ] as Array<[Partial<Props>, string[]]>) {
        const text = JSDOM.fragment(renderToStaticMarkup(element(props, locale) as never)).textContent!;
        assert.equal(text, shown.join(''));
      }
      assert.ok(m.auditLog.actions.report_review_start && m.auditLog.actions.report_review_stop && m.auditLog.detailKeys.reportId && m.content.errors.already_closed);
    });
  }

  it('the dashboard counts a report under review as open', () => {
    assert.equal(openReports({ pending: 2, reviewing: 3, resolved: 5, dismissed: 7 }), 5);
    assert.equal(openReports({}), 0);
  });

  describe('the button', () => {
    let dom: JSDOM;
    before(() => {
      dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
      const g = globalThis as Record<string, unknown>;
      for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'getComputedStyle']) Object.defineProperty(g, k, { value: (dom.window as unknown as Record<string, unknown>)[k], configurable: true, writable: true });
      g.IS_REACT_ACT_ENVIRONMENT = true;
    });
    after(() => dom.window.close());
    beforeEach(() => void routerCalls.splice(0));

    async function press(props: Partial<Props>) {
      const { createRoot } = await import('react-dom/client');
      const container = document.body.appendChild(document.createElement('div'));
      const root = createRoot(container);
      await React.act(async () => root.render(element(props)));
      await React.act(async () => void container.querySelector('[data-testid="report-review-toggle"]')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
      const text = container.textContent!;
      await React.act(async () => root.unmount());
      return text;
    }

    it('starts and undoes, says so and reads the page again', async () => {
      const calls: unknown[][] = [];
      const setReview = (async (...a: unknown[]) => { calls.push(a); return { ok: true, data: {} }; }) as never;
      assert.ok((await press({ setReview })).includes(en.reportReview.started));
      assert.ok((await press({ setReview, status: 'reviewing' })).includes(en.reportReview.stopped));
      assert.deepEqual(calls, [['r1', true], ['r1', false]]);
      assert.deepEqual(routerCalls, ['refresh', 'refresh']);
    });

    it('a refusal is said', async () => {
      const text = await press({ setReview: (async () => ({ ok: false, status: 409, error: 'x', code: 'already_closed' })) as never });
      assert.ok(text.includes(en.content.errors.already_closed));
      assert.deepEqual(routerCalls, []);
    });
  });
});
