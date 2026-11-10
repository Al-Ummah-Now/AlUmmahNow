/**
 * Admin content management (channels, videos, comments, playlists, community,
 * videos users and admin jobs): labels in both languages, job helpers and
 * URL filter parsing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_CONTENT_PERMISSIONS, ADMIN_JOB_KINDS, ADMIN_JOB_STATUSES, type AdminJob } from '@al-ummah/shared-types';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';
import { canRetryJob, isActiveJob, jobTargetHref, jobTone } from '../src/components/content/job-helpers';
import { JOB_KIND_LABEL } from '../src/lib/admin-jobs';
import { createTranslator } from '../src/i18n/translate';
import { hrefWith, pickParams } from '../src/components/content/query';

const ARABIC = /[؀-ۿ]/;
const SECTIONS = ['content', 'channels', 'videos', 'comments', 'playlists', 'community', 'users', 'jobs'] as const;

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ''): [string, string][] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [[`${prefix}${k}`, v] as [string, string]] : leaves(v, `${prefix}${k}.`)));
}

/** Follows a path made by leaves(); a key may itself contain dots (job kinds). */
function lookup(tree: Tree | string | undefined, path: string): string | undefined {
  if (typeof tree !== 'object') return undefined;
  if (typeof tree[path] === 'string') return tree[path] as string;
  const parts = path.split('.');
  for (let i = 1; i < parts.length; i++) {
    const found = lookup(tree[parts.slice(0, i).join('.')], parts.slice(i).join('.'));
    if (found !== undefined) return found;
  }
  return undefined;
}

const job = (over: Partial<AdminJob> = {}): AdminJob => ({
  id: 'job_1',
  kind: 'channel.sync-holds',
  targetKind: 'channel',
  targetId: 'ch_1',
  params: {},
  status: 'queued',
  attempts: 0,
  lastError: null,
  result: null,
  actorId: 'usr_admin',
  createdAt: '2026-11-10T00:00:00Z',
  updatedAt: '2026-11-10T00:00:00Z',
  finishedAt: null,
  ...over,
});

describe('admin content i18n', () => {
  it('every content string exists in English and Arabic', () => {
    for (const section of SECTIONS) {
      const enTree = (en as unknown as Record<string, Tree>)[section];
      const arTree = (ar as unknown as Record<string, Tree>)[section];
      assert.ok(enTree && arTree, `${section} section missing`);
      for (const [path, value] of leaves(enTree)) {
        const arValue = lookup(arTree, path);
        assert.ok(arValue, `${section}.${path} missing in Arabic`);
        // Placeholders must survive translation.
        for (const ph of value.match(/\{\w+\}/g) ?? []) assert.ok(arValue.includes(ph), `${section}.${path} lost ${ph} in Arabic`);
        if (/[a-z]{3}/i.test(value.replace(/\{\w+\}/g, ''))) assert.match(arValue, ARABIC, `${section}.${path} is not Arabic`);
      }
    }
  });

  it('labels every job kind, status and target', () => {
    for (const messages of [en, ar] as unknown as Record<string, Tree>[]) {
      const jobs = messages.jobs as Record<string, Record<string, string>>;
      for (const status of ADMIN_JOB_STATUSES) assert.ok(jobs.statuses[status], `jobs.statuses.${status}`);
      for (const target of ['channel', 'video', 'user']) assert.ok(jobs.targets[target], `jobs.targets.${target}`);
    }
  });

  it('renders a translated label for every job kind through the translator', () => {
    // Kinds contain a dot; a dot-path lookup of the raw kind finds nothing and shows the key
    for (const locale of ['en', 'ar'] as const) {
      const t = createTranslator(locale);
      for (const kind of ADMIN_JOB_KINDS) {
        const label = t(JOB_KIND_LABEL[kind]);
        assert.ok(!label.startsWith('jobs.'), `${locale}: ${kind} shows the raw key ${label}`);
        if (locale === 'ar') assert.match(label, ARABIC, `${kind} is not Arabic`);
      }
    }
  });

  it('has nav entries for every content page', () => {
    for (const key of ['channels', 'videos', 'comments', 'playlists', 'community', 'users', 'jobs']) {
      assert.ok((en.nav as Record<string, string>)[key], `en nav.${key}`);
      assert.match((ar.nav as Record<string, string>)[key], ARABIC, `ar nav.${key}`);
    }
  });
});

describe('admin job helpers', () => {
  it('treats queued, running and retrying as active', () => {
    assert.deepEqual(
      ADMIN_JOB_STATUSES.filter((status) => isActiveJob({ status })),
      ['queued', 'running', 'retrying'],
    );
  });

  it('colours failed red, retrying amber and done green', () => {
    assert.equal(jobTone('failed'), 'bad');
    assert.equal(jobTone('retrying'), 'warn');
    assert.equal(jobTone('succeeded'), 'good');
    assert.equal(jobTone('queued'), 'info');
    assert.equal(jobTone('running'), 'info');
  });

  it('only lets an admin retry a job they could have started', () => {
    assert.equal(canRetryJob(job({ kind: 'channel.transfer' }), ['channels:manage']), false);
    assert.equal(canRetryJob(job({ kind: 'channel.transfer' }), ['channels:transfer']), true);
    assert.equal(canRetryJob(job({ kind: 'user.delete-data' }), ['users:manage']), false);
    assert.equal(canRetryJob(job({ kind: 'user.delete-data' }), ['users:manage', 'content:delete']), true);
    assert.equal(canRetryJob(job({ kind: 'video.purge' }), []), false);
    for (const kind of ADMIN_JOB_KINDS) assert.equal(canRetryJob(job({ kind }), ADMIN_CONTENT_PERMISSIONS), true, kind);
  });

  it('links a job to its channel, video or videos user', () => {
    assert.equal(jobTargetHref(job({ targetKind: 'channel', targetId: 'ch_1' })), '/channels/ch_1');
    assert.equal(jobTargetHref(job({ targetKind: 'video', targetId: 'v 1' })), '/videos/v%201');
    assert.equal(jobTargetHref(job({ targetKind: 'user', targetId: 'usr_x' })), '/users/usr_x');
    assert.equal(jobTargetHref(job({ kind: 'profiles.restore-legacy', targetKind: 'user', targetId: 'legacy-profiles' })), '/legacy-profiles');
  });
});

describe('content list filters', () => {
  const spec = { q: 'text', status: ['active', 'suspended'], from: 'date', page: 'page' } as const;

  it('keeps only allowed keys and valid values', () => {
    assert.deepEqual(
      pickParams({ q: '  hello ', status: 'bogus', from: '2026-11-01', page: '3', other: 'x' }, spec),
      { q: 'hello', from: '2026-11-01', page: '3' },
    );
    assert.deepEqual(pickParams({ status: ['suspended', 'active'], from: '11/01/2026', page: '1' }, spec), { status: 'suspended' });
    assert.deepEqual(pickParams({ page: '999999' }, spec), { page: '10000' });
    assert.equal(pickParams({ q: 'x'.repeat(500) }, spec).q.length, 200);
  });

  it('builds hrefs that drop empty values', () => {
    assert.equal(hrefWith('/videos', { q: 'a b', status: '' }), '/videos?q=a+b');
    assert.equal(hrefWith('/videos', { q: 'a' }, { page: '2' }), '/videos?q=a&page=2');
    assert.equal(hrefWith('/videos', { page: '2' }, { page: undefined }), '/videos');
  });
});
