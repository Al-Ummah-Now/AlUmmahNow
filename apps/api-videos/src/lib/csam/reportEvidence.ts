/**
 * The sealed copy of a reported item's records, made when a child safety report is filed (admin-api
 * lib/moderation/childSafety.ts). In the CSAM evidence store (docs/specs/CSAM-RESPONSE.md §4), so erasing the
 * reported account, or deleting the item, does not remove it. Records and text only: the media itself is
 * copied when a super admin opens a case (evidence.ts), never on a report alone.
 *
 * Keys: `reports/<type>/<id>/<sha256 of the records>.bin`; the same records are stored once.
 */
import { REPORT_ENTITY_TYPES, type ReportableEntityType } from '@al-ummah/shared-types';
import { lookup } from '../admin/lookup';
import { findStoredComment, type StoredComment } from '../comments';
import { locatePostComment } from '../channelComments/moderation';
import { streamKey } from '../live/streams';
import type { AdminEnv } from '../admin/directory';
import { evidenceKeys, openJson, sealJson, sha256Hex } from './crypto';

type Json = Record<string, unknown>;
export type ReportEvidenceEnv = AdminEnv & { CSAM_EVIDENCE?: R2Bucket; CSAM_EVIDENCE_KEY?: unknown };

export interface ReportEvidenceInput {
	entityType: ReportableEntityType;
	entityId: string;
	/** Only guests reported it: a chat message is kept only when anyone may read it */
	publicOnly: boolean;
	/** What a signed-in reporter saw, kept with their report (a chat message may be gone by now) */
	reportedText: string | null;
}

export interface ReportEvidence {
	v: 1;
	entityType: ReportableEntityType;
	entityId: string;
	keptAt: string;
	records: Json;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,200}$/;
/** An item that keeps changing while reports come in is kept this many times at most. */
export const MAX_COPIES = 10;
const prefixOf = (type: string, id: string) => `reports/${type}/${id}/`;

export const validReportedItem = (type: string, id: string): type is ReportableEntityType => (REPORT_ENTITY_TYPES as readonly string[]).includes(type) && SAFE_ID.test(id);

async function read(bucket: R2Bucket | undefined, key: string): Promise<Json | null> {
	const object = await bucket?.get(key);
	return object ? ((await object.json().catch(() => null)) as Json | null) : null;
}

async function recordsOf(env: ReportEvidenceEnv, input: ReportEvidenceInput): Promise<Json | null> {
	const { entityType: type, entityId: id } = input;
	const { items } = await lookup(env, { items: [{ type, id }], users: [] });
	const item = items[0];
	const records: Json = {};
	if (item?.found) {
		if (type === 'live_chat') {
			if (input.publicOnly && !item.openToAnyone) return null;
			records.message = { id, text: item.title, streamId: item.parentId, authorId: item.ownerId };
		} else if (type === 'comment') {
			const comment =
				item.parentType === 'post'
					? (await locatePostComment(env.community_posts, item.parentId!, id))?.comment
					: findStoredComment((await read(env.videos, item.parentId!))?.comments as StoredComment[], id)?.comment;
			if (comment) {
				// Other people's replies are not part of it
				const { replies: _replies, ...own } = comment as unknown as Json;
				records.comment = { ...own, on: item.parentType, parentId: item.parentId };
			}
		} else if (type === 'post') {
			records.post = await read(env.community_posts, `posts/${item.channelId}/${id}.json`);
		} else if (type === 'channel') {
			records.channel = await read(env.channels, id);
		} else if (type === 'playlist') {
			records.playlist = await read(env.playlists, id);
		} else {
			const record = await read(env.videos, type === 'livestream' ? streamKey(id) : id);
			if (record) {
				// Never its stream key, and not what other people commented
				const { comments: _comments, streamKey: _key, rtmpUrl: _rtmp, streamUrl: _url, ...own } = record;
				records[type] = own;
			}
		}
		if (item.ownerId) records.ownerProfile = await read(env.profiles, item.ownerId);
	}
	if (input.reportedText && (type === 'live_chat' || type === 'comment')) records.reportedText = input.reportedText;
	const kept = Object.fromEntries(Object.entries(records).filter(([, v]) => v != null));
	return Object.keys(kept).length ? kept : null;
}

/** Keeps the records as they are now. `kept: false` when there is nothing to keep. Idempotent. */
export async function keepReportEvidence(env: ReportEvidenceEnv, input: ReportEvidenceInput, now = new Date()): Promise<{ kept: boolean }> {
	if (!env.CSAM_EVIDENCE) throw new Error('CSAM_EVIDENCE bucket is not bound');
	const records = await recordsOf(env, input);
	const prefix = prefixOf(input.entityType, input.entityId);
	const stored = await env.CSAM_EVIDENCE.list({ prefix, limit: MAX_COPIES });
	if (!records) return { kept: stored.objects.length > 0 };
	const name = await sha256Hex(new TextEncoder().encode(JSON.stringify(records)));
	if (stored.objects.length >= MAX_COPIES || stored.objects.some((o) => o.key === `${prefix}${name}.bin`)) return { kept: true };
	const keys = await evidenceKeys(env);
	const evidence: ReportEvidence = { v: 1, entityType: input.entityType, entityId: input.entityId, keptAt: now.toISOString(), records };
	await env.CSAM_EVIDENCE.put(`${prefix}${name}.bin`, await sealJson(keys.current.key, evidence, { caseId: `report:${input.entityType}:${input.entityId}`, name }), {
		customMetadata: { keyVersion: String(keys.current.version) },
	});
	return { kept: true };
}

/** Every kept copy of the item, oldest first. Null when there is none. */
export async function readReportEvidence(env: ReportEvidenceEnv, entityType: ReportableEntityType, entityId: string): Promise<ReportEvidence[] | null> {
	if (!env.CSAM_EVIDENCE) throw new Error('CSAM_EVIDENCE bucket is not bound');
	const { objects } = await env.CSAM_EVIDENCE.list({ prefix: prefixOf(entityType, entityId), limit: MAX_COPIES });
	if (!objects.length) return null;
	const keys = await evidenceKeys(env);
	const out: ReportEvidence[] = [];
	for (const { key } of objects) {
		const object = await env.CSAM_EVIDENCE.get(key);
		if (!object) continue;
		const version = Number(object.customMetadata?.keyVersion ?? keys.current.version);
		const open = keys.byVersion.get(version);
		if (!open) throw new Error(`evidence key version ${version} is not configured`);
		out.push(await openJson<ReportEvidence>(open, new Uint8Array(await object.arrayBuffer()), { caseId: `report:${entityType}:${entityId}`, name: key.split('/').pop()!.replace(/\.bin$/, '') }));
	}
	return out.sort((a, b) => a.keptAt.localeCompare(b.keptAt));
}

/** Deletes every kept copy of the item (admin-api's retention sweep decides when). */
export async function deleteReportEvidence(env: ReportEvidenceEnv, entityType: ReportableEntityType, entityId: string): Promise<number> {
	if (!env.CSAM_EVIDENCE) throw new Error('CSAM_EVIDENCE bucket is not bound');
	const { objects } = await env.CSAM_EVIDENCE.list({ prefix: prefixOf(entityType, entityId) });
	if (objects.length) await env.CSAM_EVIDENCE.delete(objects.map((o) => o.key));
	return objects.length;
}
