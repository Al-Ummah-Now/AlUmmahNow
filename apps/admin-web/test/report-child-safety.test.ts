/** The report page's child safety card and the kept record's download. Synthetic values only. */
import './support/next-navigation-stub';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { STEP_UP_REQUIRED_ERROR, type Report, type ReportedItemSummary } from '@al-ummah/shared-types';
import { ChildSafetyCard, ReportedItem } from '../src/app/(protected)/moderation/reports/[id]/item';
import { reportEvidenceResponse } from '../src/lib/report-evidence-proxy';
import { createTranslator } from '../src/i18n/translate';

(globalThis as unknown as { React: unknown }).React = React;

const report = { id: 'r-1', entity_type: 'video', entity_id: 'vid-synth-01', reason: 'child_safety', status: 'pending' } as unknown as Report;
const URL_ = 'https://videos.example.org/en/video/vid-synth-01';

function card(over: Record<string, unknown> = {}, locale: 'en' | 'ar' = 'en') {
  return renderToStaticMarkup(React.createElement(ChildSafetyCard as React.FC<Record<string, unknown>>, { report, intake: { url: URL_, evidence: false }, superAdmin: true, open: true, t: createTranslator(locale), ...over }) as never);
}

describe('the child safety card', () => {
  for (const locale of ['en', 'ar'] as const) {
    it(`offers a super admin the case intake, filled in for exactly this item (${locale})`, () => {
      const html = card({}, locale);
      assert.ok(html.includes(`href="/moderation/csam?prefill=${encodeURIComponent(URL_)}"`) && html.includes('child-safety-open-case'));
      assert.ok(!html.includes('child-safety-tell') && !html.includes('child-safety-record'));
      assert.ok(html.includes(createTranslator(locale)('report.childSafetyTitle')));
    });

    it(`tells everyone else to tell a super admin, with no link (${locale})`, () => {
      const html = card({ superAdmin: false, intake: null }, locale);
      assert.ok(html.includes('child-safety-tell') && !html.includes('href='), html);
    });
  }

  it('says when no page opens a case for this item', () => {
    const html = card({ intake: { url: null, evidence: false } });
    assert.ok(html.includes('child-safety-no-page') && !html.includes('child-safety-open-case'));
  });

  it('links the kept record, also once the report is closed; a closed one without a record has no card', () => {
    const html = card({ open: false, intake: { url: URL_, evidence: true } });
    assert.ok(html.includes('href="/api/csam/report-evidence/video/vid-synth-01?report=r-1"') && !html.includes('child-safety-open-case'));
    assert.equal(card({ open: false }), '');
  });

  it('an item under a takedown is a row and nothing else', () => {
    const item = { type: 'video', id: 'vid-synth-01', takenDown: true, title: null, parentId: null, parentType: null, channel: null, owner: null, found: true, isHidden: true, isDeleted: false } as ReportedItemSummary;
    for (const [locale, text] of [['en', 'Under review by the child safety team'], ['ar', 'قيد المراجعة لدى فريق سلامة الأطفال']] as const) {
      const html = renderToStaticMarkup(React.createElement(ReportedItem as React.FC<Record<string, unknown>>, { item, t: createTranslator(locale) }) as never);
      assert.ok(html.includes(text) && !html.includes('<a '), html);
    }
  });
});

describe('the kept record’s download', () => {
  const real = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = real;
  });
  const session = async () => ({ accessToken: 'synthetic-token' });
  const run = (upstream: () => Response | Promise<Response>, over: { type?: string; itemId?: string; query?: string; session?: typeof session | (() => Promise<null>) } = {}) => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return upstream();
    }) as never;
    const { type = 'video', itemId = 'vid-synth-01', query = '?report=r-1' } = over;
    return reportEvidenceResponse(new Request(`https://admin.example.org/api/csam/report-evidence/${type}/${itemId}${query}`), { type, itemId }, over.session ?? session).then((res) => ({ res, calls }));
  };

  it('is an attachment, never cached, read with the session’s token', async () => {
    const { res, calls } = await run(() => new Response('{"kept":true}', { headers: { 'Content-Type': 'text/html' } }));
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '{"kept":true}');
    assert.deepEqual(['content-type', 'content-disposition', 'cache-control', 'x-content-type-options', 'content-security-policy'].map((h) => res.headers.get(h)), ['application/octet-stream', 'attachment; filename="reported-video-vid-synth-01.json"', 'no-store, private', 'nosniff', "default-src 'none'; sandbox"]);
    assert.equal(new Headers(calls[0].init.headers).get('authorization'), 'Bearer synthetic-token');
    assert.ok(calls[0].url.endsWith('/api/csam/report-evidence/video/vid-synth-01'));
  });

  it('asks nothing for what is not an item of ours', async () => {
    for (const over of [{ type: 'user' }, { itemId: '../x' }, { itemId: '@handle' }, { itemId: 'a"b' }]) {
      const { res, calls } = await run(() => new Response(null), over);
      assert.deepEqual([res.status, calls.length], [404, 0], JSON.stringify(over));
    }
  });

  it('signs in again without a session, and comes back to the report; a made-up report is not followed', async () => {
    const none = async () => null;
    const { res, calls } = await run(() => new Response(null), { session: none });
    assert.deepEqual([res.status, res.headers.get('location'), calls.length], [303, 'https://admin.example.org/login?return=%2Fmoderation%2Freports%2Fr-1', 0]);
    const other = await run(() => new Response(null), { session: none, query: '?report=//evil.example' });
    assert.equal(other.res.headers.get('location'), 'https://admin.example.org/login?return=%2Fmoderation');
  });

  it('a step-up goes through the sign-in; a refusal and an outage carry nothing', async () => {
    const stepUp = await run(() => Response.json({ success: false, code: STEP_UP_REQUIRED_ERROR }, { status: 401 }));
    assert.equal(stepUp.res.status, 303);
    assert.ok(stepUp.res.headers.get('location')!.startsWith('https://admin.example.org/'));
    const missing = await run(() => Response.json({ success: false, code: 'not_found' }, { status: 404 }));
    assert.deepEqual([missing.res.status, await missing.res.text()], [404, '']);
    const down = await run(() => {
      throw new Error('unreachable');
    });
    assert.deepEqual([down.res.status, await down.res.text()], [503, '']);
  });
});
