/**
 * The feature registry (wiki AUN-FEATURES §2): complete, bilingual, well-formed, and its helpers.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as r from '../src/feature-registry.ts';
import { USER_FEATURE_KEYS } from '../src/features.ts';

const LATIN = /[A-Za-z]/;
const ASCII_DIGIT = /[0-9]/;

test('every key in FEATURE_KEYS has exactly one entry, in the same order', () => {
  assert.deepEqual(r.FEATURE_REGISTRY.map((d) => d.key), [...r.FEATURE_KEYS]);
});

test('every entry has en and ar names and help text', () => {
  for (const d of r.FEATURE_REGISTRY) {
    for (const field of ['name', 'help'] as const) {
      assert.ok(d[field].en.trim().length > 0, `${d.key}.${field}.en`);
      assert.ok(d[field].ar.trim().length > 0, `${d.key}.${field}.ar`);
    }
    assert.ok(/[.]$/.test(d.help.en), `${d.key}: English help ends in a full stop`);
    assert.ok(/[.]$/.test(d.help.ar), `${d.key}: Arabic help ends in a full stop`);
  }
});

test('English copy uses typographic quotes and apostrophes', () => {
  for (const d of r.FEATURE_REGISTRY) {
    for (const text of [d.name.en, d.help.en, d.offMessage?.en ?? '']) {
      assert.ok(!/['"]/.test(text), `${d.key}: straight quote in “${text}”`);
    }
  }
});

test('Arabic copy follows the glossary and the number rule', () => {
  for (const d of r.FEATURE_REGISTRY) {
    for (const text of [d.name.ar, d.help.ar, d.offMessage?.ar ?? '']) {
      assert.ok(!/فيديو|مقاطع الفيديو/.test(text), `${d.key}: «فيديو» instead of «مرئي»`);
      assert.ok(!ASCII_DIGIT.test(text), `${d.key}: ASCII digit in Arabic`);
      assert.ok(!text.includes('٬'), `${d.key}: grouped Arabic number`);
      assert.ok(!/[,"]/.test(text), `${d.key}: Latin comma or straight quote in Arabic`);
      assert.ok(!LATIN.test(text), `${d.key}: Latin letters in Arabic: ${text}`);
    }
  }
});

test('setup notes are bilingual, whole sentences and follow the Arabic rules', () => {
  for (const [key, note] of Object.entries(r.FEATURE_SETUP_NOTES)) {
    assert.ok(r.isFeatureKey(key), key);
    assert.match(note!.en, /[.]$/);
    assert.match(note!.ar, /[.]$/);
    assert.ok(!/['"]/.test(note!.en), `${key}: straight quote`);
    assert.ok(!LATIN.test(note!.ar) && !ASCII_DIGIT.test(note!.ar) && !/[,"]/.test(note!.ar), `${key}: ${note!.ar}`);
  }
});

test('requirements name real keys and have no cycles', () => {
  for (const d of r.FEATURE_REGISTRY) {
    for (const req of d.requires) assert.ok(r.isFeatureKey(req), `${d.key} requires unknown ${req}`);
  }
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (k: r.FeatureKey) => {
    assert.ok(!visiting.has(k), `cycle through ${k}`);
    if (done.has(k)) return;
    visiting.add(k);
    for (const req of r.featureDefinition(k).requires) visit(req);
    visiting.delete(k);
    done.add(k);
  };
  for (const k of r.FEATURE_KEYS) visit(k);
});

test('every /api/me/features key is switched or listed as automatic', () => {
  assert.deepEqual(r.uncoveredUserFeatureKeys(USER_FEATURE_KEYS), []);
  for (const k of Object.keys(r.AUTOMATIC_FEATURE_KEYS)) assert.ok((USER_FEATURE_KEYS as readonly string[]).includes(k), `unknown automatic key ${k}`);
  const all = r.FEATURE_REGISTRY.flatMap((d) => d.userFeatureKeys);
  assert.equal(new Set(all).size, all.length, 'a /api/me/features key belongs to one switch at most');
});

test('defaults keep today’s behaviour (the live app features, caption download, creator support, offline/listen, event calendar, quiet hours, E21 and app update notices start off)', () => {
  const off = r.FEATURE_KEYS.filter((k) => !r.DEFAULT_FEATURE_SWITCHES[k]);
  assert.deepEqual(off, [
    'liveChat',
    'livePremieres',
    'liveReminders',
    'liveEvents',
    'viewerCaptionDownload',
    'creatorSupport',
    'supportExternalLinks',
    'charityDonations',
    'supportPerks',
    'prayerTimes',
    'qibla',
    'hijriCalendar',
    'ramadanMode',
    'recitationTools',
    'intentionalViewing',
    'studyNotes',
    'eventCalendar',
    'quietHours',
    'listenMode',
    'offlineDownloads',
    'appUpdates',
    'ageRules',
  ]);
});

test('super-admin-only switches are the ones the specs name', () => {
  assert.deepEqual(
    r.FEATURE_REGISTRY.filter((d) => d.toggle === 'superAdmin').map((d) => d.key),
    ['upload', 'createChannel', 'live', 'liveChat', 'livePremieres', 'liveReminders', 'liveEvents', 'viewerCaptionDownload', 'creatorSupport', 'supportExternalLinks', 'charityDonations', 'supportPerks', 'recitationTools', 'ageRules'],
  );
});

test('withDefaults keeps booleans for known keys only', () => {
  const s = r.withDefaults({ upload: false, live: 'no', unknown: false });
  assert.equal(s.upload, false);
  assert.equal(s.live, true);
  assert.ok(!('unknown' in s));
  assert.deepEqual(r.withDefaults(null), r.DEFAULT_FEATURE_SWITCHES);
});

test('a required feature that is off turns its dependants off without changing them', () => {
  const stored = r.withDefaults({ upload: false });
  const effective = r.effectiveSwitches(stored);
  assert.equal(stored.youtubeImport, true);
  assert.equal(effective.youtubeImport, false);
  assert.equal(effective.audioTracks, false);
  assert.equal(effective.bulkSchedule, true);
  assert.deepEqual(r.blockedBy('youtubeImport', stored), ['upload']);
  assert.deepEqual(r.blockedBy('youtubeImport', r.DEFAULT_FEATURE_SWITCHES), []);
  assert.deepEqual(r.dependantsOf('upload'), ['youtubeImport', 'audioTracks']);
  assert.deepEqual(r.dependantsOf('live'), []);
  assert.deepEqual(r.dependantsOf('creatorSupport'), ['supportExternalLinks', 'charityDonations', 'supportPerks']);
  const support = r.effectiveSwitches(r.withDefaults({ supportPerks: true, charityDonations: true }));
  assert.equal(support.supportPerks, false, 'perks stay off while creator support is off');
});

test('applySwitchesToUserFeatures turns covered keys off and leaves the rest', () => {
  const effective = r.effectiveSwitches(r.withDefaults({ live: false, upload: false }));
  const out = r.applySwitchesToUserFeatures({ live: true, upload: true, youtubeImport: true, quranText: true, billing: false }, effective);
  assert.deepEqual(out, { live: false, upload: false, youtubeImport: false, quranText: true, billing: false });
  assert.equal(r.switchForUserFeature('live'), 'live');
  assert.equal(r.switchForUserFeature('quranText'), null);
});

test('E21 hides every public and role-specific user feature by default', () => {
  const keys = [
    'prayerTimes',
    'qibla',
    'hijriCalendar',
    'ramadanMode',
    'recitationTools',
    'recitationMetadata',
    'intentionalViewing',
    'studyNotes',
  ] as const;
  const configured = Object.fromEntries(keys.map((key) => [key, true])) as Record<(typeof keys)[number], boolean>;
  const out = r.applySwitchesToUserFeatures(configured, r.effectiveSwitches(r.DEFAULT_FEATURE_SWITCHES));
  for (const key of keys) assert.equal(out[key], false, key);

  const ready = r.withDefaults({ prayerTimes: true, hijriCalendar: true, ramadanMode: true });
  assert.deepEqual(r.blockedBy('ramadanMode', ready), []);
  const blocked = r.withDefaults({ ...ready, hijriCalendar: false });
  assert.deepEqual(r.blockedBy('ramadanMode', blocked), ['hijriCalendar']);
  assert.equal(r.effectiveSwitches(blocked).ramadanMode, false);
  assert.equal(blocked.ramadanMode, true, 'a dependency never rewrites the stored choice');
});

test('featureOffMessage names the feature in the asked language', () => {
  assert.equal(r.featureOffMessage('live', 'en'), 'Live streaming isn’t available right now.');
  assert.equal(r.featureOffMessage('live', 'ar'), 'البث المباشر غير متاح الآن.');
  assert.equal(r.featureOffMessage('bulkSchedule', 'en'), 'Bulk scheduling isn’t available right now.');
  assert.equal(r.featureOffMessage('bulkSchedule', 'ar'), 'ميزة «الجدولة الجماعية» غير متاحة الآن.');
  assert.equal(r.featureOffMessage(null, 'en'), 'This feature isn’t available right now.');
  assert.equal(r.featureOffMessage(null, 'ar'), 'هذه الميزة غير متاحة الآن.');
});

test('setup links point at admin pages and confirm values are valid', () => {
  for (const d of r.FEATURE_REGISTRY) {
    if (d.setupHref) assert.match(d.setupHref, /^\/[a-z-]+$/);
    assert.ok(['never', 'off', 'on', 'both'].includes(d.confirm));
    assert.ok((r.FEATURE_GROUPS as readonly string[]).includes(d.group));
  }
});
