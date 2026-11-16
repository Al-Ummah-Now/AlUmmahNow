/**
 * @jest-environment node
 */
jest.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: async () => { throw new Error('not on Workers'); } }));
jest.mock('@/lib/auth/session-manager', () => ({ SessionManager: { ensureFreshActiveSession: async () => ({ accessToken: 'tok' }) } }));
jest.mock('@/lib/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import { NextRequest } from 'next/server';
import { GET } from '../[channelId]/[[...path]]/route';

describe('Studio site domains proxy', () => {
  const saved = { key: process.env.INTERNAL_API_KEY, url: process.env.ADMIN_API_URL };
  afterEach(() => {
    process.env.INTERNAL_API_KEY = saved.key;
    process.env.ADMIN_API_URL = saved.url;
  });

  it('not wired to admin-api here: own domains are hidden (404 feature_off, no message)', async () => {
    delete process.env.INTERNAL_API_KEY;
    delete process.env.ADMIN_API_URL;
    const req = new NextRequest('https://videos.test/api/studio/site-domains/ch1', { headers: { 'sec-fetch-site': 'same-origin' } });
    const res = await GET(req, { params: Promise.resolve({ channelId: 'ch1', path: [] }) });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, code: 'feature_off' });
  });
});
