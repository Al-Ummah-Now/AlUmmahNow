/**
 * Remote config editor (issue #413): stored documents as drafts and back, the checks run before a
 * save (problems on their field), rule order, api-videos' problems placed on their draft, the
 * editor's en/ar strings and the settings:manage gate.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sameAppConfigDocument, type AppConfigRule } from '@al-ummah/shared-types';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';
import {
  APP_TEXT_MAX,
  draftToRule,
  draftsToDocument,
  dropOldNotes,
  entryForRow,
  latestFor,
  moveItem,
  newRule,
  newVersion,
  problemsFor,
  ruleScope,
  rulesToDrafts,
  serverProblems,
  versionsToDocument,
  versionsToDrafts,
} from '../src/components/app-config/app-config-model';
import { canManagePlatformSettings } from '../src/lib/roles';

const codes = (problems: { field: string; code: string }[]) => problems.map((p) => `${p.field}:${p.code}`).sort();

describe('app config rules', () => {
  it('round-trips a stored rules document unchanged', () => {
    const stored: AppConfigRule[] = [
      { key: 'shorts.enabled', enabled: true, platforms: ['ios', 'android'], apps: ['viewer'], minVersion: '1.2.0', maxVersion: '2.0.0', locales: ['ar', 'en-GB'], rollout: 25, value: true, note: 'Shorts tab' },
      { key: 'player.max_quality', enabled: false, value: '1080p' },
      { key: 'home.sections', enabled: true, value: { order: ['live', 'new'] } },
    ];
    const back = draftsToDocument(rulesToDrafts(stored), 'config');
    assert.deepEqual(back.problems, []);
    assert.ok(sameAppConfigDocument(back.value, stored));
  });

  it('leaves empty optional fields out and keeps the platform and app order canonical', () => {
    const d = { ...newRule('flags'), key: 'x', platforms: ['web', 'ios'], apps: ['studio', 'viewer'], locales: ' , ' };
    const { rule } = draftToRule(d, 'flags');
    assert.deepEqual(rule, { key: 'x', enabled: true, platforms: ['ios', 'web'], apps: ['viewer', 'studio'] });
  });

  it('puts each problem on its field and sends nothing while there are any', () => {
    const bad = { ...newRule('config'), key: 'Bad Key', minVersion: '2.0.0', maxVersion: '1.0.0', locales: 'ar, x_1', rollout: '120', value: '{oops' };
    const doc = draftsToDocument([bad], 'config');
    assert.equal(doc.value, null);
    assert.deepEqual(codes(doc.problems), ['key:keyFormat', 'locales:localeFormat', 'maxVersion:versionOrder', 'rollout:rolloutRange', 'value:valueJson'].sort());
    assert.deepEqual(codes(draftToRule({ ...newRule('config'), value: '' }, 'config').problems), ['key:keyRequired', 'value:valueRequired']);
    assert.deepEqual(codes(draftToRule({ ...newRule('flags'), key: 'a', minVersion: '1.0' }, 'flags').problems), ['minVersion:versionFormat']);
  });

  it('starts a config rule with a value to fill in, and a flag rule without one', () => {
    assert.equal(newRule('config').value, '""');
    assert.equal(newRule('flags').value, '');
  });

  it('moves rules up and down (the first match decides) and stays put at either end', () => {
    assert.deepEqual(moveItem(['a', 'b', 'c'], 2, -1), ['a', 'c', 'b']);
    assert.deepEqual(moveItem(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c']);
    const list = ['a', 'b'];
    assert.equal(moveItem(list, 0, -1), list);
    assert.equal(moveItem(list, 1, 1), list);
  });

  it('summarises where a folded rule applies', () => {
    const d = { ...newRule('flags'), minVersion: '1.0.0', maxVersion: '2.0.0', locales: 'ar en', rollout: '10' };
    assert.deepEqual(ruleScope(d), { platforms: [], apps: [], versions: '1.0.0 – 2.0.0', locales: ['ar', 'en'], rollout: '10%' });
    assert.equal(ruleScope({ ...d, maxVersion: '' }).versions, '≥ 1.0.0');
    assert.equal(ruleScope({ ...d, minVersion: '' }).versions, '≤ 2.0.0');
  });

  it('starts empty from anything that is not a list', () => {
    assert.deepEqual(rulesToDrafts(null), []);
    assert.deepEqual(rulesToDrafts({ key: 'x' }), []);
  });
});

describe('rules of apps we no longer have', () => {
  it('drops the old app, and a rule for it alone instead of making it a rule for every app', () => {
    const stored = [{ key: 'a', apps: ['kids', 'viewer'] }, { key: 'b', apps: ['kids'] }, { key: 'c' }];
    const back = draftsToDocument(rulesToDrafts(stored), 'flags');
    assert.deepEqual(back.problems, []);
    assert.deepEqual(back.value, [{ key: 'a', enabled: true, apps: ['viewer'] }, { key: 'c', enabled: true }]);
  });
});

describe('app config versions', () => {
  it('round-trips the versions document', () => {
    const stored = { 'viewer/ios': { minimumVersion: '1.0.0', latestVersion: '1.4.0', storeUrl: 'https://apps.apple.com/app/id1' }, 'studio/*': { minimumVersion: '0.9.0' } };
    const back = versionsToDocument(versionsToDrafts(stored));
    assert.deepEqual(back.problems, []);
    assert.ok(sameAppConfigDocument(back.value, stored));
  });

  it('ignores entries of apps we no longer have', () => {
    const stored = { 'kids/ios': { minimumVersion: '1.0.0' }, 'kids/*': { minimumVersion: '1.0.0' }, 'viewer/ios': { minimumVersion: '1.2.0' } };
    const back = versionsToDocument(versionsToDrafts(stored));
    assert.deepEqual(back, { value: { 'viewer/ios': { minimumVersion: '1.2.0' } }, problems: [] });
  });

  it('refuses a second entry for one app and platform, a bad version and a non-https link; an old latest below the minimum is dropped', () => {
    const a = { ...newVersion(), minimumVersion: '1.0.0' };
    const b = { ...newVersion(), minimumVersion: '1', latestVersion: '', storeUrl: 'http://example.com' };
    const c = { ...newVersion(), app: 'tools', minimumVersion: '2.0.0', latestVersion: '1.0.0' };
    const doc = versionsToDocument([a, b, c]);
    assert.equal(doc.value, null);
    assert.deepEqual(codes(problemsFor(doc.problems, b.id, 'platform')), ['platform:duplicateTarget']);
    assert.deepEqual(codes(doc.problems.filter((p) => p.id === b.id)), ['minimumVersion:versionFormat', 'platform:duplicateTarget', 'storeUrl:urlFormat']);
    assert.deepEqual(codes(doc.problems.filter((p) => p.id === c.id)), []);
    assert.deepEqual(versionsToDocument([c]).value, { 'tools/*': { minimumVersion: '2.0.0' } });
  });

  it('round-trips beta entries, the forced-screen message and version notes (AUN-APP-UPDATES §3.4)', () => {
    const stored = {
      'viewer/ios#beta': { minimumVersion: '1.2.0.0' },
      'tools/windows': {
        minimumVersion: '2026.11.22',
        message: { en: 'Sign-in changed.', ar: 'تغيّر تسجيل الدخول.' },
        notesOverrides: { '2026.11.23': { en: 'Faster scans.', ar: 'فحص أسرع.' } },
      },
    };
    const drafts = versionsToDrafts(stored);
    assert.equal(drafts[0].channel, 'beta');
    assert.equal(drafts[0].platform, 'ios');
    const back = versionsToDocument(drafts);
    assert.deepEqual(back.problems, []);
    assert.ok(sameAppConfigDocument(back.value, stored));
  });

  it('a message or a notes override needs both languages; at most five overrides', () => {
    const d = { ...newVersion(), minimumVersion: '1.0.0', messageEn: 'Only English', notesOverrides: [{ id: 'n1', version: '1.1', en: 'x', ar: '' }] };
    const doc = versionsToDocument([d]);
    assert.deepEqual(codes(doc.problems).sort(), ['messageAr:bothLanguages', 'notes.n1.ar:bothLanguages', 'notes.n1.version:versionFormat'].sort());
    const many = { ...newVersion(), minimumVersion: '1.0.0', notesOverrides: Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, version: `1.0.${i}`, en: 'e', ar: 'ع' })) };
    assert.deepEqual(codes(versionsToDocument([many]).problems), ['notesOverrides:tooManyNotes']);
    const stable = { ...newVersion(), app: 'viewer', platform: 'ios', minimumVersion: '1.0.0' };
    const beta = { ...stable, id: 'b', channel: 'beta' as const };
    assert.deepEqual(versionsToDocument([stable, beta]).problems, [], 'a stable and a beta entry for one pair are two targets');
  });
});

describe("api-videos' problems", () => {
  it('places them on the rule and field their path names, or on the whole document', () => {
    const drafts = rulesToDrafts([{ key: 'a' }, { key: 'b' }]);
    const placed = serverProblems([{ problem: '1.value.x', detail: 'bad' }, { problem: '', detail: 'too many' }, { problem: '7.key' }], drafts, 'flags');
    assert.deepEqual(placed[0], { id: drafts[1].id, field: 'value', code: 'server', detail: 'bad' });
    assert.equal(placed[1].id, '');
    assert.equal(placed[2].id, '');
  });

  it('finds a versions entry by its app/platform', () => {
    const versions = versionsToDrafts({ 'viewer/ios': { minimumVersion: '1.0.0' } });
    const [p] = serverProblems([{ problem: 'viewer/ios.storeUrl', detail: 'x' }], [], 'versions', versions);
    assert.deepEqual(p, { id: versions[0].id, field: 'storeUrl', code: 'server', detail: 'x' });
  });
});

describe('releases and the version entries (AUN-APP-UPDATES §3.4, §4.2)', () => {
  const releases = [
    { app: 'tools', platform: 'windows', channel: 'stable' as const, version: '2026.11.24' },
    { app: 'tools', platform: 'macos', channel: 'stable' as const, version: '2026.11.22' },
    { app: 'tools', platform: 'windows', channel: 'beta' as const, version: '2026.11.25' },
  ];

  it('the newest release a target follows', () => {
    assert.equal(latestFor({ app: 'tools', platform: 'windows', channel: '' }, releases), '2026.11.24');
    assert.equal(latestFor({ app: 'tools', platform: 'windows', channel: 'beta' }, releases), '2026.11.25');
    assert.equal(latestFor({ app: 'tools', platform: '*', channel: '' }, releases), '2026.11.22', 'every platform: the oldest newest');
    assert.equal(latestFor({ app: 'studio', platform: '*', channel: '' }, releases), null);
  });

  it('a save drops notes of versions older than the latest release, and only those', () => {
    const note = { en: 'e', ar: 'ع' };
    const doc = { 'tools/windows': { minimumVersion: '0.0.0', notesOverrides: { '2026.11.22': note, '2026.11.24': note } }, 'tools/*': { minimumVersion: '0.0.0', notesOverrides: { '2026.11.20': note } }, 'studio/*': { minimumVersion: '0.0.0', notesOverrides: { '1.0.0': note } } };
    assert.deepEqual(dropOldNotes(doc, releases), {
      'tools/windows': { minimumVersion: '0.0.0', notesOverrides: { '2026.11.24': note } },
      'tools/*': { minimumVersion: '0.0.0' },
      'studio/*': { minimumVersion: '0.0.0', notesOverrides: { '1.0.0': note } },
    });
  });

  it('Edit opens the row’s own entry, or a new one that keeps the policy in force', () => {
    const drafts = versionsToDrafts({ 'tools/*': { minimumVersion: '2026.11.01', message: { en: 'Old.', ar: 'قديم.' } }, 'tools/windows': { minimumVersion: '2026.11.10' } });
    const own = entryForRow(drafts, { app: 'tools', platform: 'windows', channel: 'stable' });
    assert.equal(own.drafts, drafts);
    assert.equal(own.id, drafts[1].id);
    const mac = entryForRow(drafts, { app: 'tools', platform: 'macos', channel: 'stable' });
    const added = mac.drafts.find((d) => d.id === mac.id)!;
    assert.deepEqual([added.app, added.platform, added.channel, added.minimumVersion, added.messageAr], ['tools', 'macos', '', '2026.11.01', 'قديم.']);
    const beta = entryForRow(drafts, { app: 'tools', platform: 'windows', channel: 'beta' });
    assert.deepEqual(beta.drafts.at(-1)!.channel, 'beta');
    assert.equal(beta.drafts.at(-1)!.minimumVersion, '2026.11.10');
    assert.equal(entryForRow([], { app: 'studio', platform: 'linux', channel: 'stable' }).drafts[0].minimumVersion, '');
  });

  it('texts longer than the server takes are refused on their field', () => {
    const long = 'x'.repeat(APP_TEXT_MAX + 1);
    const d = { ...newVersion(), minimumVersion: '1.0.0', messageEn: long, messageAr: long, notesOverrides: [{ id: 'n1', version: '1.1.0', en: long, ar: 'ع' }] };
    assert.deepEqual(codes(versionsToDocument([d]).problems), ['messageAr:textTooLong', 'messageEn:textTooLong', 'notes.n1.en:textTooLong']);
    const ok = 'x'.repeat(APP_TEXT_MAX);
    assert.deepEqual(versionsToDocument([{ ...d, messageEn: ok, messageAr: ok, notesOverrides: [] }]).problems, []);
  });

  it('api-videos’ problems land on the beta entry, the message and the note they name', () => {
    const drafts = versionsToDrafts({ 'viewer/ios': { minimumVersion: '1.0.0' }, 'viewer/ios#beta': { minimumVersion: '1.0.0', message: { en: 'a', ar: 'ب' }, notesOverrides: { '1.1.0': { en: 'a', ar: 'ب' } } } });
    const beta = drafts[1];
    const at = (problem: string) => serverProblems([{ problem, detail: 'x' }], [], 'versions', drafts)[0];
    const note = beta.notesOverrides[0].id;
    for (const [path, field] of [['minimumVersion', 'minimumVersion'], ['message.en', 'messageEn'], ['message.ar', 'messageAr'], ['notesOverrides.1.1.0.ar', `notes.${note}.ar`], ['notesOverrides.1.1.0', `notes.${note}.version`], ['notesOverrides', 'notesOverrides'], ['notesOverrides.9.9.9.en', 'notesOverrides'], ['latestVersion', '']]) {
      assert.deepEqual(at(`viewer/ios#beta.${path}`), { id: beta.id, field, code: 'server', detail: 'x' }, path);
    }
    assert.equal(at('viewer/ios.minimumVersion').id, drafts[0].id);
    assert.equal(at('studio/ios.minimumVersion').id, '', 'an entry that is gone: the whole document');
  });

  it('every refusal reason has words in both languages', () => {
    const words = (m: unknown) => (m as { appConfig: { releases: { reasons: Record<string, string> } } }).appConfig.releases.reasons;
    for (const code of ['missing_signature', 'bad_signature', 'unknown_key', 'bad_manifest', 'wrong_tag', 'yanked']) {
      assert.ok(words(en)[code], code);
      assert.match(words(ar)[code], /[؀-ۿ]/, code);
    }
  });
});

describe('app config strings and access', () => {
  const flatten = (o: Record<string, unknown>, prefix = ''): Record<string, string> =>
    Object.fromEntries(Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? Object.entries(flatten(v as Record<string, unknown>, `${prefix}${k}.`)) : [[`${prefix}${k}`, String(v)]])));

  it('has every string in en and ar, the Arabic ones in Arabic', () => {
    const enKeys = flatten((en as unknown as { appConfig: Record<string, unknown> }).appConfig);
    const arKeys = flatten((ar as unknown as { appConfig: Record<string, unknown> }).appConfig);
    assert.deepEqual(Object.keys(arKeys).sort(), Object.keys(enKeys).sort());
    for (const [key, value] of Object.entries(arKeys)) {
      if (/^appNames\.|^platformNames\./.test(key) || /^\{\w+\}$/.test(value)) continue;
      assert.match(value, /[؀-ۿ]/, key);
    }
    assert.ok((en as unknown as { nav: Record<string, string> }).nav.appConfig);
    assert.ok((ar as unknown as { nav: Record<string, string> }).nav.appConfig);
  });

  it('every problem code the model can raise has words', () => {
    const problems = (en as unknown as { appConfig: { problems: Record<string, string> } }).appConfig.problems;
    for (const code of ['keyRequired', 'keyFormat', 'versionFormat', 'versionOrder', 'rolloutRange', 'valueJson', 'valueRequired', 'localeFormat', 'urlFormat', 'duplicateTarget', 'tooMany', 'tooManyNotes', 'bothLanguages', 'textTooLong', 'server']) {
      assert.ok(problems[code], code);
    }
  });

  it('is for admins and super admins only (settings:manage)', () => {
    assert.ok(canManagePlatformSettings('admin'));
    assert.ok(canManagePlatformSettings('super_admin'));
    assert.ok(!canManagePlatformSettings('moderator'));
    assert.ok(!canManagePlatformSettings(undefined));
  });
});
