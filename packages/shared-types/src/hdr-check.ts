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

/**
 * The `colr` box of an init segment, or null when it has none. Looks for an `nclx` (or QuickTime `nclc`)
 * box by its type and plausible size, so it needs no walk through every box kind.
 */
export function initColors(bytes: Uint8Array): InitColors | null {
	const at = (i: number) => String.fromCharCode(bytes[i]!, bytes[i + 1]!, bytes[i + 2]!, bytes[i + 3]!);
	const u16 = (i: number) => (bytes[i]! << 8) | bytes[i + 1]!;
	for (let i = 4; i + 14 <= bytes.length; i++) {
		if (bytes[i] !== 0x63 || at(i) !== 'colr') continue;
		const size = ((bytes[i - 4]! << 24) | (bytes[i - 3]! << 16) | (bytes[i - 2]! << 8) | bytes[i - 1]!) >>> 0;
		const kind = at(i + 4);
		if (size < 18 || size > 64 || i - 4 + size > bytes.length || (kind !== 'nclx' && kind !== 'nclc')) continue;
		return { primaries: u16(i + 8), transfer: u16(i + 10), matrix: u16(i + 12), full: kind === 'nclx' && (bytes[i + 14]! & 0x80) !== 0 };
	}
	return null;
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
