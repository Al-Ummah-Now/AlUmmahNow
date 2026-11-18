import { HELP_AR, HELP_EN, STUDIO_AR, STUDIO_EN, type SocialNetwork } from '@al-ummah/shared-types';
import { helpForNetworks } from '../social';

const text = (h: typeof HELP_EN) => JSON.stringify(h.topics.social);
const en = (networks: SocialNetwork[]) => helpForNetworks(HELP_EN, networks, STUDIO_EN.social.networks, 'en');

describe('Help names only the social networks that are on', () => {
  it('lists the networks a creator can connect, and no other', () => {
    const h = en(['telegram', 'mastodon']);
    const autoPost = h.topics.social.sections.find((s) => s.id === 'auto-post')!;
    expect(JSON.stringify(autoPost)).toContain('connect Telegram or Mastodon');
    expect(JSON.stringify(autoPost)).not.toMatch(/\bX\b|Bluesky|\{networks\}/);
    expect(JSON.stringify(autoPost)).toContain('For Telegram');
  });

  it('drops the Telegram line while Telegram is off', () => {
    expect(text(en(['mastodon']))).not.toContain('For Telegram');
  });

  it('with no network on, the auto-post section is gone and no network is named', () => {
    const h = en([]);
    expect(h.topics.social.sections.map((s) => s.id)).not.toContain('auto-post');
    expect(h.topics.social.summary).not.toMatch(/\bX\b|Telegram|Bluesky|Mastodon/);
  });

  it('Arabic joins the names the Arabic way, in Arabic', () => {
    const h = helpForNetworks(HELP_AR, ['telegram', 'bluesky', 'mastodon'], STUDIO_AR.social.networks, 'ar');
    expect(text(h)).toContain('تيليجرام أو Bluesky أو ماستودون');
  });

  it('leaves the other topics alone', () => {
    expect(en([]).topics.start).toBe(HELP_EN.topics.start);
  });
});
