/**
 * Reported items that are under a takedown (a case of docs/specs/CSAM-RESPONSE.md names them, open or closed). Only
 * super admins see what they are: everyone else sees the report and that the item is under a takedown.
 */
import { isSuperAdmin, type ReportableEntityType, type ReportedItemSummary, type ReportExcerpt, type ReportGroup, type ReportHistoryRow } from '@al-ummah/shared-types';
import { casesAbout, videosUnderCase, type ItemRef } from '../csam';
import type { D1Database } from '../types';

/** The items the reader may not see, of those given. */
export const hiddenFrom = async (db: D1Database, roles: readonly unknown[] | undefined, items: ItemRef[]): Promise<Set<string>> => (isSuperAdmin(roles) ? new Set() : casesAbout(db, items));

export const isHiddenItem = (hidden: ReadonlySet<string>, type: string, id: string): boolean => hidden.has(`${type}:${id}`);

/** List rows without those about items the reader may not see. */
export async function withoutHidden<T extends { id: string }>(db: D1Database, roles: readonly unknown[] | undefined, type: ReportableEntityType, rows: T[]): Promise<T[]> {
  const hidden = await hiddenFrom(db, roles, rows.map((r) => ({ type, id: r.id })));
  return hidden.size === 0 ? rows : rows.filter((r) => !isHiddenItem(hidden, type, r.id));
}

/** The same for rows that name a video otherwise. */
export async function withoutHiddenVideos<T>(db: D1Database, roles: readonly unknown[] | undefined, rows: T[], videoId: (row: T) => string | null | undefined): Promise<T[]> {
  const hidden = await hiddenFrom(db, roles, rows.flatMap((r) => { const id = videoId(r); return id ? [{ type: 'video' as const, id }] : []; }));
  return hidden.size === 0 ? rows : rows.filter((r) => !isHiddenItem(hidden, 'video', videoId(r) ?? ''));
}

/** Every video the reader may not see (none for a super admin): for totals that must not count them. */
export const hiddenVideoIds = async (db: D1Database, roles: readonly unknown[] | undefined): Promise<string[]> => (isSuperAdmin(roles) ? [] : videosUnderCase(db));

/** The item without anything that says what or whose it is. */
export const withheldSummary = (s: ReportedItemSummary): ReportedItemSummary => ({ ...s, title: null, parentId: null, parentType: null, channel: null, owner: null, takenDown: true });

/** A report row without the copies it keeps of its item and without what anybody wrote about it. */
export function withoutCopies<T extends object>(row: T): T & { taken_down: true } {
  return {
    ...row,
    entity_title: null,
    entity_parent_id: null,
    channel_id: null,
    channel_name: null,
    owner_id: null,
    owner_name: null,
    ...('description' in row ? { description: null } : {}),
    ...('moderator_notes' in row ? { moderator_notes: null } : {}),
    ...('banned_user_id' in row ? { banned_user_id: null } : {}),
    taken_down: true,
  };
}

/** A queue group without what it says about its item. */
export const withheldGroup = (g: ReportGroup): ReportGroup => ({ ...g, item: withheldSummary(g.item), latest: g.latest.map(withheldExcerpt), ai: null });

export const withheldExcerpt = (e: ReportExcerpt): ReportExcerpt => ({ ...e, description: null });

/** A closed report without what it says about its item. */
export const withheldHistory = (h: ReportHistoryRow): ReportHistoryRow => ({ ...h, item: withheldSummary(h.item), description: null, notes: null, bannedUserId: null });
