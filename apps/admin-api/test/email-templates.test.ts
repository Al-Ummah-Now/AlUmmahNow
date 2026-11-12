/**
 * Every admin-api email in the shared design (src/lib/email/layout.ts): one
 * language per email (the admin's pick for replies, the sender's page for the
 * acknowledgement, English for staff mail), RTL, escaping, and the plain-text
 * part carrying everything the HTML says.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderAcknowledgement, renderInboxNotification, renderReply, replyLocaleOf, type RenderedEmail } from '../src/lib/contact-email';
import { renderErrorAlert } from '../src/lib/errors-alerts';
import { renderWarningEmail } from '../src/lib/warning-mail';
import { EMAIL_LOGO_URL, escapeHtml, renderEmail } from '../src/lib/email/layout';

const ARABIC = /[؀-ۿ]/;
/** The text a reader sees: skips <head>, comments and the hidden preheader, drops tags, decodes entities. */
function visibleText(html: string): string {
  let rest = html.slice(html.indexOf('<body'));
  const pre = rest.indexOf('<div style="display:none');
  if (pre >= 0) rest = rest.slice(0, pre) + rest.slice(rest.indexOf('</div>', pre) + 6);
  let out = '';
  let inTag = false;
  for (let k = 0; k < rest.length; k++) {
    if (rest.startsWith('<!--', k)) {
      k = rest.indexOf('-->', k) + 2;
      continue;
    }
    const ch = rest[k];
    if (ch === '<') inTag = true;
    else if (ch === '>' && inTag) {
      inTag = false;
      out += ' ';
    } else if (!inTag) out += ch;
  }
  const named: Record<string, string> = { quot: '"', lt: '<', gt: '>', amp: '&' };
  return out.replace(/&(#\d+|quot|lt|gt|amp);/g, (_, e: string) => (e.startsWith('#') ? String.fromCodePoint(Number(e.slice(1))) : named[e]));
}
const norm = (s: string) => s.replace(/[:\s\u200f\u200e]+/g, ' ').trim();

function wellFormed(mail: RenderedEmail, locale: 'en' | 'ar') {
  assert.ok(mail.html.startsWith('<!DOCTYPE html>'));
  assert.ok(mail.html.includes(`<html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}"`));
  assert.ok(mail.html.includes('<meta name="color-scheme" content="light dark">'));
  assert.ok(mail.html.includes('@media (prefers-color-scheme:dark)'));
  assert.ok(mail.html.includes(`src="${EMAIL_LOGO_URL}"`));
  assert.ok(mail.html.includes(`<title>${escapeHtml(mail.subject)}</title>`));
  assert.doesNotMatch(mail.text, /<(p|table|td|a|div|br)[ >]/i);
  if (locale === 'ar') assert.match(mail.subject, ARABIC);
}

/** Every line of the plain text (bar URLs and labels) is also in the HTML. */
function parity(mail: RenderedEmail) {
  const body = norm(visibleText(mail.html));
  for (const raw of mail.text.split('\n')) {
    const line = raw.replace(/^> ?/, '').trim();
    if (!line || line === '—' || /^https?:\/\//.test(line) || /:$/.test(line)) continue;
    assert.ok(body.includes(norm(line.replace(/: https?:\/\/\S+$/, ''))), `HTML is missing: ${line}`);
  }
}

const message = {
  id: 'm1',
  name: 'Amina <b>',
  email: 'amina@example.org',
  topic: 'account' as const,
  message: 'I cannot sign in.\nPlease help <script>x</script>.',
  locale: 'ar' as const,
  page_url: 'https://www.alummahnow.net/ar/contact',
  user_id: 'usr_1',
  created_at: '2026-11-09T10:00:00.000Z',
};

describe('contact reply: one language, the admin\'s pick', () => {
  for (const locale of ['en', 'ar'] as const) {
    it(`${locale}`, () => {
      const mail = renderReply(message, 'Try resetting your password.\nThen sign in again.', { locale, environment: 'production' });
      wellFormed(mail, locale);
      parity(mail);
      if (locale === 'en') {
        assert.equal(mail.subject, 'Re: your message to Al Ummah Now');
        assert.doesNotMatch(mail.text.replace(message.message, ''), ARABIC);
        assert.ok(mail.text.includes('On 9 November 2026 at 10:00 UTC, you wrote') || mail.text.includes('On 9 November 2026, 10:00 UTC, you wrote'));
      } else {
        assert.equal(mail.subject, 'رد: رسالتك إلى الأمة الآن');
      }
      assert.ok(mail.html.includes('Try resetting your password.<br>Then sign in again.'));
      assert.ok(!mail.html.includes('<script>'));
      assert.ok(mail.html.includes('Amina &lt;b&gt;'));
    });
  }

  it('defaults to the message language and keeps the choice through the stored subject', () => {
    assert.match(renderReply(message, 'Hi', {}).html, /<html lang="ar"/);
    const en = renderReply(message, 'Hi', { locale: 'en', environment: 'qa' });
    assert.equal(en.subject, '[qa] Re: your message to Al Ummah Now');
    assert.equal(replyLocaleOf(en.subject), 'en');
    assert.equal(replyLocaleOf(renderReply(message, 'Hi', { locale: 'ar' }).subject), 'ar');
    assert.equal(replyLocaleOf('Something else'), null);
    assert.equal(replyLocaleOf(null), null);
  });
});

describe('contact acknowledgement: the language of the page they wrote from', () => {
  for (const locale of ['en', 'ar'] as const) {
    it(`${locale}`, () => {
      const mail = renderAcknowledgement({ ...message, locale }, { environment: 'production' });
      wellFormed(mail, locale);
      parity(mail);
      if (locale === 'en') assert.doesNotMatch(norm(visibleText(mail.html)), ARABIC);
    });
  }
});

describe('staff email (English)', () => {
  it('inbox notification', () => {
    const mail = renderInboxNotification(message, { to: 'support@alummahnow.net', adminUrl: 'https://admin.alummahnow.net', environment: 'production' });
    wellFormed(mail, 'en');
    parity(mail);
    assert.ok(mail.html.includes('href="https://admin.alummahnow.net/contact/m1"'));
    assert.ok(!mail.html.includes('<script>'));
  });

  it('error alert', () => {
    const mail = renderErrorAlert(
      { id: 'eg_1', app: 'web', environment: 'production', kind: 'http', name: 'Error', message: '<img onerror=1>', culprit: null, route: '/x', occurrences: 3, users: 1, last_release: 'r1', first_seen: '2026-11-09T10:00:00.000Z' } as never,
      'spike',
      { to: 'a@alummahnow.net', adminUrl: 'https://admin.alummahnow.net' },
    );
    wellFormed(mail, 'en');
    parity(mail);
    assert.ok(!mail.html.includes('<img onerror'));
    assert.match(mail.html, /3 occurrences, 1 user affected/);
  });
});

describe('the layout', () => {
  it('hides the preheader, refuses non-http links and puts the reason in the footer', () => {
    const mail = renderEmail({ locale: 'en', subject: 'S', preheader: 'Peek', blocks: [{ kind: 'link', label: 'Go', url: 'javascript:alert(1)' }], cta: { label: 'Do', url: 'data:x' }, reason: 'Why' });
    assert.match(mail.html, /<div style="display:none;[^"]*">Peek/);
    assert.ok(!mail.html.includes('javascript:'));
    assert.ok(!mail.html.includes('data:x'));
    assert.ok(mail.text.includes('Why'));
    assert.ok(!mail.text.includes('Peek'));
  });
});

describe('user warning email (shared layout, one language)', () => {
  for (const locale of ['en', 'ar'] as const) {
    it(`${locale}: branded layout, one language, guidelines as the action, plain text matches`, () => {
      const mail = renderWarningEmail({ to: 'a@b.c', name: 'Amina <b>', locale, reasonCode: 'spam', count: 3, origin: 'https://videos.alummahnow.net', environment: 'production' });
      wellFormed(mail, locale);
      parity(mail);
      assert.ok(mail.html.includes(`https://videos.alummahnow.net/${locale}/community-guidelines`));
      assert.ok(mail.html.includes(`https://videos.alummahnow.net/${locale}/settings#notifications`));
      assert.ok(!mail.html.includes('Amina <b>'), 'names are escaped');
      if (locale === 'en') assert.doesNotMatch(visibleText(mail.html), ARABIC, 'English email has no Arabic');
    });
  }
});

