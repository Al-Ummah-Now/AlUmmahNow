import { composePostText, fitText, formatNumber, renderTemplate, SOCIAL_NETWORK_RULES, type SocialAccountView, type SocialPreview } from '@al-ummah/shared-types';
import { previewTargets, previewText, previewValues } from '../social-preview';

const account = (network: SocialAccountView['network'], format: 'video' | 'link', includeLink = false): SocialAccountView => ({
  id: network, channelId: 'ch', network, handle: 'h', displayName: 'H', language: 'en', status: 'active', connectedAt: '2026-11-01T00:00:00Z',
  rules: [{ event: 'video', enabled: true, format, includeLink }],
});

const preview: SocialPreview = {
  channel: { en: 'Noor Institute', ar: 'معهد نور' },
  channelUrl: { en: 'https://videos.example/en/@noor', ar: 'https://videos.example/ar/@noor' },
  items: { video: { title: { en: 'Tafsir of al-Kahf, part 3', ar: 'تفسير سورة الكهف – الحلقة ٣' }, url: { en: 'https://s.example/v/1', ar: 'https://s.example/v/1?lang=ar' } } },
};

describe('Studio post preview', () => {
  it('has one tab per connected network, in site order, with the format its account posts in', () => {
    const targets = previewTargets([account('mastodon', 'link'), account('telegram', 'video'), account('mastodon', 'video')], 'video');
    expect(targets).toEqual([
      { network: 'telegram', format: 'video', includeLink: false },
      { network: 'mastodon', format: 'link', includeLink: false },
    ]);
    // An event with no rule yet uses the event's default format
    expect(previewTargets([account('bluesky', 'video')], 'post')).toEqual([{ network: 'bluesky', format: 'link', includeLink: false }]);
  });

  it('fills in the newest item, or a sample linking to the channel page', () => {
    expect(previewValues('video', 'ar', preview, 'مرئيك الجديد')).toEqual({ values: { title: 'تفسير سورة الكهف – الحلقة ٣', channel: 'معهد نور', url: 'https://s.example/v/1?lang=ar', text: 'تفسير سورة الكهف – الحلقة ٣' }, fromSample: false });
    expect(previewValues('short', 'en', preview, 'Your new Short')).toEqual({ values: { title: 'Your new Short', channel: 'Noor Institute', url: 'https://videos.example/en/@noor', text: 'Your new Short' }, fromSample: true });
  });

  it("is the sender's composition: same text and the same cut as the sender's fitText", () => {
    const values = { title: 'عنوان طويل '.repeat(60).trim(), channel: 'معهد نور', url: 'https://s.example/v/1?lang=ar', text: '' };
    for (const network of ['x', 'telegram', 'bluesky', 'mastodon'] as const) {
      const target = { network, format: 'link' as const, includeLink: false };
      const r = previewText('{title}\n\n{url}', 'video', target, values);
      expect(r).toEqual(composePostText({ template: '{title}\n\n{url}', values, network, event: 'video', format: 'link', includeLink: false }));
      const rules = SOCIAL_NETWORK_RULES[network];
      expect(r.text).toBe(fitText(rules, renderTemplate('{title}\n\n{url}', values), rules.maxText));
      expect(r.limit).toBe(rules.maxText);
      expect(r.length).toBeLessThanOrEqual(r.limit);
      // The link survives the cut and line breaks are kept
      expect(r.text.endsWith('\n\nhttps://s.example/v/1?lang=ar')).toBe(true);
    }
    // Bluesky's 300 graphemes: this text is longer, so it is cut
    expect(previewText('{title}\n\n{url}', 'video', { network: 'bluesky', format: 'link', includeLink: false }, values).cut).toBe(true);
  });

  it('an X video post drops the link unless the rule keeps it, as the sender does', () => {
    const values = { title: 'Friday reminder', channel: 'Noor', url: 'https://s.example/v/1', text: '' };
    expect(previewText('{title}\n\n{url}', 'video', { network: 'x', format: 'video', includeLink: false }, values).text).toBe('Friday reminder');
    expect(previewText('{title}\n\n{url}', 'video', { network: 'x', format: 'video', includeLink: true }, values).text).toBe('Friday reminder\n\nhttps://s.example/v/1');
    // A video caption on Telegram uses the caption limit, not the text limit
    expect(previewText('{title}', 'video', { network: 'telegram', format: 'video', includeLink: false }, values).limit).toBe(1024);
  });

  it("a Mastodon account with its instance's own limit is previewed and cut to it (#1593)", () => {
    const a = { ...account('mastodon', 'link'), maxChars: 1000 };
    const [target] = previewTargets([a], 'video');
    expect(target).toEqual({ network: 'mastodon', format: 'link', includeLink: false, limit: 1000 });
    const values = { title: 'word '.repeat(150).trim(), channel: 'Noor', url: 'https://s.example/v/1', text: '' };
    const r = previewText('{title}\n\n{url}', 'video', target!, values);
    expect(r.limit).toBe(1000);
    expect(r.cut).toBe(false);
    expect(r).toEqual(composePostText({ template: '{title}\n\n{url}', values, network: 'mastodon', event: 'video', format: 'link', includeLink: false, limit: 1000 }));
    // Without a known limit: the network default
    expect(previewText('{title}\n\n{url}', 'video', previewTargets([account('mastodon', 'link')], 'video')[0]!, values).limit).toBe(500);
  });

  it('counts in Arabic digits in Arabic', () => {
    const r = previewText('{title}', 'video', { network: 'bluesky', format: 'link', includeLink: false }, { title: 'x'.repeat(280), channel: '', url: '', text: '' });
    expect(`${formatNumber('ar', r.length)}/${formatNumber('ar', r.limit)}`).toBe('٢٨٠/٣٠٠');
  });
});
