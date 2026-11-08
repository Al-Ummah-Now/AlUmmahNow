/**
 * Release regression: anonymous channel, profile and video responses carry only
 * public fields. The only address allowed is /about's opt-in contactEmail,
 * which a channel owner publishes deliberately.
 */
import { test, expect } from '@playwright/test';
import { target } from './targets';

const EMAIL_LIKE = /[A-Z0-9._%+-]+@[A-Z0-9-]+(\.[A-Z0-9-]+)+/i;

async function anonymousJson(path: string): Promise<any> {
  const res = await fetch(`${target().api}${path}`);
  expect(res.ok, `GET ${path} answered ${res.status}`).toBe(true);
  return res.json();
}

function expectPublic(path: string, body: unknown) {
  const text = JSON.stringify(body);
  expect(text, `GET ${path} has an email key`).not.toMatch(/"email"\s*:/);
  expect(text.match(EMAIL_LIKE)?.[0] ?? null, `GET ${path} has an email-like value`).toBeNull();
}

test.describe('Release: anonymous responses carry only public fields', () => {
  // PR runs hit the already-deployed QA, which gets this API only after merge.
  test.beforeAll(async () => {
    const res = await fetch(`${target().api}/api/channels/release-probe/owner`);
    test.skip(res.status === 404, 'target API does not serve the owner routes yet');
  });

  test('channels', async () => {
    const list = await anonymousJson('/api/channels?scope=all&limit=20');
    expectPublic('/api/channels', list);
    test.skip(!list.data?.length, 'no public channels in this environment');
    const id = list.data[0].id as string;
    expectPublic(`/api/channels/${id}`, await anonymousJson(`/api/channels/${id}`));
    const { contactEmail: _published, ...about } = (await anonymousJson(`/api/channels/${id}/about`)).result;
    expectPublic(`/api/channels/${id}/about`, about);
  });

  test('profiles', async () => {
    const list = await anonymousJson('/api/profiles?limit=20');
    expectPublic('/api/profiles', list);
    const id = list.result?.profiles?.[0]?.id as string | undefined;
    test.skip(!id, 'no profiles in this environment');
    expectPublic(`/api/profiles/${id}`, await anonymousJson(`/api/profiles/${id}`));
  });

  test('videos', async () => {
    const list = await anonymousJson('/api/videos?limit=20');
    expectPublic('/api/videos', list);
    const id = list.data?.[0]?.id as string | undefined;
    test.skip(!id, 'no public videos in this environment');
    expectPublic(`/api/videos/${id}`, await anonymousJson(`/api/videos/${id}`));
  });
});
