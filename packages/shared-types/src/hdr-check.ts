/**
 * Finding published videos that still carry HDR (encoded before every rendition became SDR BT.709:
 * apps/media/container/colour.mjs). A read-only check an admin starts on the Delivery page: each ready
 * rendition's init segment says its colors (the MP4 `colr` box). Re-encoding is a separate admin action
 * on chosen videos (POST /api/media/retry, from the kept original).
 */

export type HdrKind = 'hlg' | 'pq' | 'bt2020';

/** The color tags of an MP4 init segment (ISO/IEC 23091-2 code points), from its `colr` box. */
export interface InitColors {
	primaries: number;
	transfer: number;
	matrix: number;
	full: boolean;
}

/** Boxes that hold boxes, on the way to a track's sample entry. */
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl']);
/** Visual sample entries: 8 bytes of header fields and 70 of picture fields, then their own boxes. */
const SAMPLE_ENTRIES = new Set(['avc1', 'avc3', 'hvc1', 'hev1', 'av01', 'vp09', 'mp4v', 'encv', 'dvh1', 'dvhe']);

/**
 * The `colr` box of an init segment, found by walking its boxes (moov, trak, mdia, minf, stbl, stsd, the
 * sample entry), or null when it has none. A box that does not fit where it is ends the walk: a malformed
 * segment says nothing rather than something read from the wrong bytes.
 */
export function initColors(bytes: Uint8Array): InitColors | null {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const type = (at: number) => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
	// `entry`: inside a visual sample entry, the only place a picture's colr box belongs
	const walk = (from: number, to: number, depth: number, entry: boolean): InitColors | null => {
		let at = from;
		while (at + 8 <= to) {
			let size = view.getUint32(at);
			let header = 8;
			if (size === 1) {
				if (at + 16 > to) return null;
				const big = view.getBigUint64(at + 8);
				if (big > BigInt(to - at)) return null;
				size = Number(big);
				header = 16;
			} else if (size === 0) size = to - at;
			if (size < header || at + size > to) return null;
			const kind = type(at + 4);
			const start = at + header;
			const end = at + size;
			if (kind === 'colr' && entry && end - start >= 4) {
				const sub = type(start);
				// nclx: 3 code points and the full-range byte (19 bytes in all); QuickTime's nclc has no range byte (18)
				if ((sub === 'nclx' && size >= header + 11) || (sub === 'nclc' && size >= header + 10)) {
					return { primaries: view.getUint16(start + 4), transfer: view.getUint16(start + 6), matrix: view.getUint16(start + 8), full: sub === 'nclx' && (bytes[start + 10]! & 0x80) !== 0 };
				}
			} else if (depth < 8) {
				const inner = CONTAINERS.has(kind) ? start : kind === 'stsd' ? start + 8 : SAMPLE_ENTRIES.has(kind) ? start + 78 : -1;
				if (inner >= 0 && inner <= end) {
					const found = walk(inner, end, depth + 1, SAMPLE_ENTRIES.has(kind));
					if (found) return found;
				}
			}
			at = end;
		}
		return null;
	};
	return walk(0, bytes.length, 0, false);
}

/** HLG (18) or PQ (16) light, or BT.2020 colors (primaries 9, matrices 9, 10 and 14) without either; null for SDR. */
export function hdrKindOf(c: InitColors | null): HdrKind | null {
	if (!c) return null;
	if (c.transfer === 18) return 'hlg';
	if (c.transfer === 16) return 'pq';
	return c.primaries === 9 || c.matrix === 9 || c.matrix === 10 || c.matrix === 14 ? 'bt2020' : null;
}

export interface HdrCheckCounts {
	/** Videos looked at */
	scanned: number;
	/** Ready renditions whose colors were read */
	checked: number;
	hdr: number;
	/** Deleted, missing or without a ready rendition */
	skipped: number;
	/** Ready, but the init segment could not be read */
	unreadable: number;
}

export interface HdrCheckItem {
	id: string;
	title: string | null;
	kind: HdrKind;
	/** The rendition that was looked at: another one now means it was encoded again since */
	rev: string;
	/** GET only: where the video is now */
	now?: 'same' | 'encoding' | 'replaced' | 'gone';
}

export interface HdrCheckRun {
	runId: string;
	status: 'running' | 'done';
	startedAt: string;
	updatedAt: string;
	finishedAt?: string;
	startedBy: string;
	counts: HdrCheckCounts;
	/** HDR videos, at most HDR_CHECK_MAX_ITEMS */
	items: HdrCheckItem[];
	truncated?: boolean;
}

export const HDR_CHECK_MAX_ITEMS = 500;
