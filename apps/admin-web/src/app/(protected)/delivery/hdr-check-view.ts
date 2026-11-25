/** The HDR check panel's labels and rules (pure). */
import type { HdrCheckItem, HdrKind } from '@al-ummah/shared-types';
import type { MessageKey } from '@/i18n/translate';

/** admin-api /api/media/retry takes at most this many ids. */
export const HDR_REENCODE_MAX = 50;

export const HDR_KIND_LABEL: Record<HdrKind, MessageKey> = { hlg: 'hdrCheck.kindHlg', pq: 'hdrCheck.kindPq', bt2020: 'hdrCheck.kindBt2020' };
export const HDR_NOW_LABEL: Record<Exclude<NonNullable<HdrCheckItem['now']>, 'same'>, MessageKey> = { encoding: 'hdrCheck.nowEncoding', replaced: 'hdrCheck.nowReplaced', gone: 'hdrCheck.nowGone' };

/** Videos still showing the rendition that was found to be HDR. */
export const hdrSelectable = (items: readonly HdrCheckItem[]): string[] => items.filter((i) => !i.now || i.now === 'same').map((i) => i.id);
