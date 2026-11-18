/**
 * Help names only the social networks a creator can connect on this site (owner rule: a feature that is off or not
 * set up leaves no trace, Help included). `{networks}` becomes "Telegram, Bluesky or Mastodon"; a block for one
 * network shows only while it is on; a section that needs a network is left out when none is.
 */
import { formatList, type HelpTranslations, type SocialNetwork } from '@al-ummah/shared-types';

export function helpForNetworks(help: HelpTranslations, networks: readonly SocialNetwork[], names: Record<SocialNetwork, string>, locale: string): HelpTranslations {
  const list = formatList(locale, networks.map((n) => names[n]), 'disjunction');
  const social = help.topics.social;
  const sections = social.sections
    .filter((section) => section.requires !== 'socialNetworks' || networks.length > 0)
    .map((section) => ({
      ...section,
      blocks: section.blocks
        .filter((block) => !('network' in block) || !block.network || networks.includes(block.network))
        .map((block) => ('text' in block && block.text.includes('{networks}') ? { ...block, text: block.text.replaceAll('{networks}', list) } : block)),
    }));
  return { ...help, topics: { ...help.topics, social: { ...social, sections } } };
}
