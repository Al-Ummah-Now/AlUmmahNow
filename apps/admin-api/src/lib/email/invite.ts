/**
 * The creator invite email built from admin-edited copy (Settings › Emails › Creator invite).
 *
 * Twin of AlUmmahNowAuth apps/auth/src/invites/email.ts (`inviteEmailDoc`), which sends the real
 * invite with the copy admin-api resolves (lib/email-templates.ts). Here it renders the editor's
 * live preview and "Send test to me" in the same layout (./layout.ts, itself a twin of Auth's).
 * Keep the two builders identical: same blocks, same order, same placeholder values.
 */
import { fillPlaceholders, formatList, type EmailCopy } from '@al-ummah/shared-types';
import { formatEmailDate, renderEmail, type EmailBlock, type EmailDoc, type EmailLocale, type RenderedEmailParts } from './layout';

export interface InviteChannelInfo {
  name: string;
  /** created: a new channel for them; transferred: an existing channel moved to their account */
  action?: 'created' | 'transferred' | string;
}

export interface InviteVideoInfo {
  title: string;
  channel: string | null;
  /** Stable https picture (the web app's /og/v/<id>.jpg), never a signed URL */
  imageUrl: string;
  /** The watch page per language */
  urls: { en: string; ar: string };
}

export interface InviteEmailData {
  email: string;
  name: string | null;
  link: string;
  expiresAt: number;
  note: string | null;
  locale: EmailLocale;
  channels?: InviteChannelInfo[];
  video?: InviteVideoInfo | null;
}

const joinNames = (names: string[], locale: EmailLocale) => formatList(locale, names);

/** The email from one language's copy. `before` blocks go first (the test banner). */
export function inviteEmailDocFromCopy(copy: EmailCopy, data: InviteEmailData, before: EmailBlock[] = []): EmailDoc {
  const locale: EmailLocale = data.locale === 'ar' ? 'ar' : 'en';
  const text = (id: string) => copy[id] ?? '';
  const channels = data.channels ?? [];
  const moved = channels.filter((c) => c.action === 'transferred').map((c) => c.name);
  const made = channels.filter((c) => c.action !== 'transferred').map((c) => c.name);
  const all = channels.length ? joinNames(channels.map((c) => c.name), locale) : '';
  const base = { name: data.name ?? '', email: data.email, channels: all, expires: formatEmailDate(data.expiresAt, locale) };
  const fill = (id: string, channelsText = all) => fillPlaceholders(text(id), { ...base, channels: channelsText });
  const intro = [
    fill('account'),
    made.length ? fill(made.length > 1 ? 'createdMany' : 'createdOne', joinNames(made, locale)) : '',
    moved.length ? fill(moved.length > 1 ? 'transferredMany' : 'transferredOne', joinNames(moved, locale)) : '',
  ]
    .filter(Boolean)
    .join(' ');
  return {
    locale,
    subject: fill('subject'),
    preheader: all ? fill('preheaderChannels') : fill('preheader'),
    greeting: data.name ? fill('greeting') : fill('greetingNoName'),
    blocks: [
      ...before,
      { kind: 'p', text: intro },
      ...(data.video
        ? [
            { kind: 'p' as const, text: fill('videoIntro') },
            { kind: 'video' as const, url: data.video.urls[locale], imageUrl: data.video.imageUrl, title: data.video.title, channel: data.video.channel, alt: fillPlaceholders(text('videoAlt'), { title: data.video.title }) },
          ]
        : []),
      { kind: 'p', text: fill('how') },
    ],
    cta: { label: fill('button'), url: data.link },
    after: [...(data.note ? [{ kind: 'quote' as const, label: fill('noteLabel'), text: data.note }] : []), { kind: 'small', text: fill('expires') }],
    reason: fill('reason'),
  };
}

export function renderInviteFromCopy(copy: EmailCopy, data: InviteEmailData, before: EmailBlock[] = []): RenderedEmailParts {
  return renderEmail(inviteEmailDocFromCopy(copy, data, before));
}
