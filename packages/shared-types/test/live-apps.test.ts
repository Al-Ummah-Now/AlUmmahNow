/** Live in the apps (wiki E17): the chat's fast filter, the shared normalizer, the metadata projection and the tier capabilities. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIVE_CHAT_MAX_LENGTH, LIVE_EVENT_LABELS, LIVE_EVENT_TYPES, checkLiveChatText, hasBlockedWord, hasLink, isLiveChatSlowMode, isLiveEventType, isLiveStreamKind, normalizeModerationText } from '../src/live-apps.ts';
import { tierAllowsLiveCapability } from '../src/creator-tiers.ts';

test('guards and labels', () => {
  assert.ok(isLiveStreamKind('premiere'));
  assert.ok(!isLiveStreamKind('vod'));
  assert.ok(isLiveChatSlowMode(10));
  assert.ok(!isLiveChatSlowMode('10'));
  assert.ok(!isLiveEventType('circle'));
  for (const type of LIVE_EVENT_TYPES) assert.ok(LIVE_EVENT_LABELS[type].en && LIVE_EVENT_LABELS[type].ar);
  assert.equal(LIVE_EVENT_LABELS.halqa.en, 'Halqa');
});

// Verses, hadith and everyday words in which the letters of a listed word occur
const MUST_PASS = [
  'وَلَا تَمُدَّنَّ عَيْنَيْكَ إِلَىٰ مَا مَتَّعْنَا بِهِ أَزْوَاجًا مِّنْهُمْ',
  'لَا تَمُدَّنَّ عَيْنَيْكَ',
  'وَلَا تَعْدُ عَيْنَاكَ عَنْهُمْ',
  'ثُمَّ إِذَا خَوَّلَهُ نِعْمَةً مِّنْهُ',
  'وَتَرَكْتُم مَّا خَوَّلْنَاكُمْ وَرَاءَ ظُهُورِكُمْ',
  'من حسن إسلام المرء تركه ما لا يعنيه',
  'من حسن إسلام المرء تركه ما لا يعنيك',
  'أَكُلَّ بَنِيكَ قَدْ نَحَلْتَ مِثْلَ مَا نَحَلْتَ النُّعْمَانَ',
  'يلعن الرجل أبا الرجل فيلعن أباه ويلعن أمه',
  'ومن أكبر الكبائر أن يلعن الرجل والديه',
  'قرة عينيك',
  'هذا يعكس إمكانيات الأمة',
  'هذا يعكس امكانيات الامة',
  'ميكانيكي',
  'تكنيك',
  'يونيكود',
  'خولة بنت الأزور',
  'خوّل المدير نائبه',
  'كالسمك في الماء',
  'معرض الكتاب',
  'السلام عليكم ورحمة الله وبركاته',
  'جزاكم الله خيرًا',
  'Assalamu alaikum, MashaAllah',
  'Scunthorpe is far from Essex',
  'this class is a classic',
];

test('Quran, hadith and everyday words pass', () => {
  for (const text of MUST_PASS) assert.equal(checkLiveChatText(text).problem, null, text);
});

test('listed words are refused whole, however they are dressed', () => {
  for (const text of ['شرموط', 'شـرمـوط', 'يا شرموطة', 'الشرموطة', 'وقحبة', 'قَحْبَة', 'كس امك', 'كُس أُمك', 'كسمك', 'نيك أمك', 'يلعن دينك', 'ش​رموط', 'f​uck you', 'FUCK', 'ｆｕｃｋ', 'f­uck', 'kill yourself']) {
    assert.ok(hasBlockedWord(text), text);
    assert.equal(checkLiveChatText(text).problem, 'blocked_word', text);
  }
});

test('links: bare domains and short links too, only for those who may link', () => {
  for (const text of ['https://scam.example.com/x', 'www.phishing.org', 'scam.com', 'join evil.com now', 'evil.ru/x', 'evil.shop/abc', 'evil.zip/abc', 'evil​.com', 't.me/group', 'wa.me', 'انضم evil.com الآن', 'sub.domain.co.uk']) {
    assert.ok(hasLink(text), text);
    assert.equal(checkLiveChatText(text).problem, 'link', text);
    assert.equal(checkLiveChatText(text, { mayLink: true }).problem, null, text);
  }
  for (const text of ['3.5/5', 'page 1/2', 'Allah.My brother', 'tell.me more', 'الحمد لله.شكرا', '10.30', 'e.g. this', 'and/or', 'one...two']) assert.ok(!hasLink(text), text);
});

test('length is counted in code points; invisible characters do not count and are not stored', () => {
  assert.equal(checkLiveChatText('  ‮​ ').problem, 'empty');
  assert.equal(checkLiveChatText('أ'.repeat(LIVE_CHAT_MAX_LENGTH)).problem, null);
  assert.equal(checkLiveChatText('😀'.repeat(LIVE_CHAT_MAX_LENGTH)).problem, null);
  assert.equal(checkLiveChatText('a'.repeat(LIVE_CHAT_MAX_LENGTH + 1)).problem, 'too_long');
  // Diacritics are kept: only the comparison strips them
  assert.equal(checkLiveChatText('قُلْ​ هُوَ').text, 'قُلْ هُوَ');
  assert.equal(normalizeModerationText('قُلْ  هُـوَ'), 'قل هو');
});

test('tier capabilities follow `live` unless the tier sets them; never without live', () => {
  assert.ok(tierAllowsLiveCapability({ unlimited: false, live: true }, 'liveChat'));
  assert.ok(!tierAllowsLiveCapability({ unlimited: false, live: true, liveChat: false }, 'liveChat'));
  assert.ok(!tierAllowsLiveCapability({ unlimited: false, live: false, liveChat: true }, 'liveChat'));
  assert.ok(tierAllowsLiveCapability({ unlimited: true, live: false }, 'livePremieres'));
  assert.ok(!tierAllowsLiveCapability(null, 'liveEvents'));
});
