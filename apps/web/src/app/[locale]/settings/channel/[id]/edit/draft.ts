/**
 * Draft model of the Customize channel page: what the owner can change in
 * place, and which of those fields differ from the saved channel.
 */
import type { Channel } from '@al-ummah/shared-types';
import type { ChannelLink } from '@/lib/api/channel-profile';

export interface ChannelDraft {
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  handle: string;
  links: ChannelLink[];
  contactEmail: string;
  location: string;
  /** Images upload straight away; kept here so the header shows the new one */
  avatarUrl?: string;
  coverUrl?: string;
}

/** Fields counted as unsaved changes (images are saved on upload) */
export type ChannelDraftField = Exclude<keyof ChannelDraft, 'avatarUrl' | 'coverUrl'>;

const TEXT_FIELDS: ChannelDraftField[] = ['nameEn', 'nameAr', 'descriptionEn', 'descriptionAr', 'handle', 'contactEmail', 'location'];

type ChannelWithAbout = Channel & { links?: ChannelLink[]; contactEmail?: string; location?: string };

export function channelDraftFrom(channel: ChannelWithAbout): ChannelDraft {
  return {
    nameEn: channel.nameLocalized?.en || channel.name || '',
    nameAr: channel.nameLocalized?.ar || '',
    descriptionEn: channel.descriptionLocalized?.en || channel.description || '',
    descriptionAr: channel.descriptionLocalized?.ar || '',
    handle: channel.handle || '',
    links: (channel.links || []).map((l) => ({ title: l.title, url: l.url })),
    contactEmail: channel.contactEmail || '',
    location: channel.location || '',
    avatarUrl: channel.avatarUrl || undefined,
    coverUrl: channel.coverUrl || undefined,
  };
}

function sameLinks(a: ChannelLink[], b: ChannelLink[]): boolean {
  const clean = (links: ChannelLink[]) => links.filter((l) => l.title.trim() || l.url.trim()).map((l) => `${l.title.trim()}\n${l.url.trim()}`);
  const x = clean(a);
  const y = clean(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/** The fields whose draft differs from the saved value, in display order. */
export function changedChannelFields(saved: ChannelDraft, draft: ChannelDraft): ChannelDraftField[] {
  const changed: ChannelDraftField[] = TEXT_FIELDS.filter((f) => {
    if (f === 'handle') return draft.handle.trim().replace(/^@+/, '') !== saved.handle;
    return (draft[f] as string).trim() !== (saved[f] as string).trim();
  });
  if (!sameLinks(saved.links, draft.links)) changed.push('links');
  return changed;
}
