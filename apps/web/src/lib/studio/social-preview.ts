/**
 * Studio → Social → Post text preview: what each connected network would receive, composed by the sender's own code
 * (shared-types composePostText), filled in from the channel's newest item of the kind or from a sample.
 */
import {
  SOCIAL_NETWORKS,
  composePostText,
  defaultFormat,
  type SocialAccountView,
  type SocialEvent,
  type SocialFormat,
  type SocialLanguage,
  type SocialNetwork,
  type SocialPostText,
  type SocialPreview,
  type SocialTemplateValues,
} from '@al-ummah/shared-types';

/** One preview tab: a connected network with the format its account posts this kind of item in. */
export interface PreviewTarget {
  network: SocialNetwork;
  format: SocialFormat;
  includeLink: boolean;
}

/** The connected networks (one tab each, site order); the first account of a network decides its format. */
export function previewTargets(accounts: readonly SocialAccountView[], event: SocialEvent): PreviewTarget[] {
  return SOCIAL_NETWORKS.flatMap((network) => {
    const account = accounts.find((a) => a.network === network);
    if (!account) return [];
    const rule = account.rules.find((r) => r.event === event);
    return [{ network, format: rule?.format ?? defaultFormat(event), includeLink: !!rule?.includeLink }];
  });
}

/** The placeholder values: the newest item of the kind, else a sample titled `sampleTitle` linking to the channel page. */
export function previewValues(event: SocialEvent, lang: SocialLanguage, preview: SocialPreview | null | undefined, sampleTitle: string): { values: SocialTemplateValues; fromSample: boolean } {
  const item = preview?.items[event];
  const channel = preview?.channel[lang] ?? '';
  if (item) {
    return { values: { title: item.title[lang], channel, url: item.url[lang], text: item.text ?? item.title[lang] }, fromSample: false };
  }
  return { values: { title: sampleTitle, channel, url: preview?.channelUrl[lang] ?? '', text: sampleTitle }, fromSample: true };
}

/** The post text a target receives (the sender's composition, unchanged). */
export function previewText(template: string, event: SocialEvent, target: PreviewTarget, values: SocialTemplateValues): SocialPostText {
  return composePostText({ template, values, network: target.network, event, format: target.format, includeLink: target.includeLink });
}
