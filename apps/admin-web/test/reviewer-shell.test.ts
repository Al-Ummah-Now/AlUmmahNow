/**
 * Review-only shell (wiki AUN-VIDEO-REVIEW, VR7, AlUmmahNow#1284): content and senior reviewers sign
 * in to admin-web, see only Moderation → Videos in review and its settings (read-only), and every
 * other page is access-denied.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import {
  canManageReviewSettings,
  hasAdminAccess,
  hasPanelAccess,
  highestAdminRole,
  isReviewOnly,
  reviewOnlyRedirect,
} from '../src/lib/roles';
import { unverifiedTokenRoles } from '../src/lib/token-refresh';
import { refreshSessionMiddleware } from '../src/lib/session-middleware';
import { verifySessionTokens } from '../src/lib/session-state';
import { visibleItems, groupedItems, type NavAccess } from '../src/components/shell/nav-model';
import { paletteKinds } from '../src/components/shell/palette-model';

const APP = 'https://admin.qa.alummahnow.net';
const NOW = 1_800_000_000;
const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = (roles: string[]) => `${b64url({ alg: 'ES256' })}.${b64url({ mode: 'access', exp: NOW + 600, properties: { id: 'u1', email: 'r@example.com', roles } })}.sig`;
const silent = { info: () => {}, warn: () => {} };

function request(path: string, roles: string[], method = 'GET'): NextRequest {
  const cookie = `admin_session=${encodeURIComponent(JSON.stringify({ accessToken: token(roles), refreshToken: 'user:r0' }))}`;
  return new NextRequest(`${APP}${path}`, { method, headers: { cookie } });
}

const run = (path: string, roles: string[], method?: string) =>
  refreshSessionMiddleware(request(path, roles, method), { issuer: 'https://auth.qa.alummahnow.net', now: () => NOW * 1000, log: silent, fetch: (() => { throw new Error('no refresh expected'); }) as unknown as typeof fetch });

describe('reviewer roles', () => {
  it('lets content and senior reviewers into admin-web, but not as admins', () => {
    for (const role of ['Content reviewer', 'content_reviewer', 'Senior reviewer', 'senior_reviewer']) {
      assert.equal(hasPanelAccess(role), true, role);
      assert.equal(isReviewOnly(role), true, role);
      assert.equal(hasAdminAccess(role), false, role);
      assert.equal(canManageReviewSettings(role), false, role);
    }
    assert.equal(hasPanelAccess('User'), false);
    assert.equal(hasPanelAccess(undefined), false);
  });

  it('ranks any admin role above the review roles, and senior above content', () => {
    assert.equal(highestAdminRole(['Senior reviewer', 'Moderator']), 'moderator');
    assert.equal(highestAdminRole(['Content reviewer', 'Senior reviewer']), 'senior_reviewer');
    assert.equal(highestAdminRole(['User', 'Content reviewer']), 'content_reviewer');
    assert.equal(isReviewOnly(highestAdminRole(['Super Admin', 'Senior reviewer'])), false);
  });

  it('carries the review role through a verified session', async () => {
    const verdict = await verifySessionTokens({ accessToken: 'a.b.c', refreshToken: 'r' }, async () => ({ subject: { properties: { id: 'u1', email: 'r@example.com', roles: ['Senior reviewer'] } } }));
    assert.deepEqual(verdict, { kind: 'valid', user: { id: 'u1', email: 'r@example.com', role: 'senior_reviewer' } });
  });

  it('only admins edit review settings', () => {
    assert.equal(canManageReviewSettings('Admin'), true);
    assert.equal(canManageReviewSettings('super_admin'), true);
    assert.equal(canManageReviewSettings('Moderator'), false);
  });
});

describe('reviewOnlyRedirect', () => {
  it('opens the review queue, its items and its settings', () => {
    for (const path of ['/moderation/review', '/moderation/review/abc', '/moderation/review/settings', '/moderation/review?tab=held']) {
      assert.equal(reviewOnlyRedirect(path), null, path);
    }
  });

  it('sends the landing pages to the queue and everything else to access-denied', () => {
    assert.equal(reviewOnlyRedirect('/'), '/moderation/review');
    assert.equal(reviewOnlyRedirect('/dashboard'), '/moderation/review');
    assert.equal(reviewOnlyRedirect(null), '/moderation/review');
    for (const path of ['/moderation', '/moderation/ai', '/moderation/reviewers', '/videos', '/users/u1', '/platform-settings']) {
      assert.equal(reviewOnlyRedirect(path), '/access-denied', path);
    }
  });
});

describe('middleware keeps reviewers in the review shell', () => {
  it('reads the roles from the token payload (routing only)', () => {
    assert.deepEqual(unverifiedTokenRoles(token(['Content reviewer'])), ['Content reviewer']);
    assert.deepEqual(unverifiedTokenRoles('not-a-jwt'), []);
  });

  it('redirects a reviewer away from admin pages, client navigations included', async () => {
    const res = await run('/videos', ['User', 'Content reviewer']);
    assert.equal(res.status, 307);
    assert.equal(res.headers.get('location'), `${APP}/access-denied`);
    const post = await run('/users', ['Senior reviewer'], 'POST');
    assert.equal(post.status, 303);
  });

  it('sends a reviewer landing on the dashboard to the queue', async () => {
    const res = await run('/dashboard', ['Senior reviewer']);
    assert.equal(res.headers.get('location'), `${APP}/moderation/review`);
  });

  it('lets a reviewer open the review pages', async () => {
    const res = await run('/moderation/review/settings', ['Content reviewer']);
    assert.equal(res.headers.get('location'), null);
    assert.equal(res.status, 200);
  });

  it('never routes an admin who is also a reviewer', async () => {
    const res = await run('/videos', ['Moderator', 'Senior reviewer']);
    assert.equal(res.headers.get('location'), null);
  });
});

describe('review-only navigation', () => {
  const reviewer: NavAccess = { contact: false, processing: false, errors: false, manageUsers: false, staleUploads: false, media: false, ops: false, reviewOnly: true };
  const moderator: NavAccess = { ...reviewer, reviewOnly: false };

  it('shows only Videos in review, under Moderation', () => {
    assert.deepEqual(visibleItems(reviewer).map((i) => i.href), ['/moderation/review']);
    assert.deepEqual(groupedItems(reviewer).map((g) => g.id), ['moderation']);
    assert.ok(visibleItems(moderator).length > 5);
  });

  it('searches pages only in the palette', () => {
    assert.deepEqual(paletteKinds(reviewer), []);
    assert.ok(paletteKinds(moderator).includes('video'));
  });
});
