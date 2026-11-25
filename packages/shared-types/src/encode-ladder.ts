/**
 * The server's HLS encode settings as data (wiki TOOLS-ADMIN TA-12): the admin import app reads them
 * from admin-api (`GET /api/admin/import/encoding`) and encodes the same ladder on the admin's
 * computer, which the media container then checks rung by rung (prebuilt renditions, Epic 19.3).
 *
 * The media container's own copy is `apps/media/container/ladder.mjs` (plain JS in the image); a test
 * there (`apps/media/test/encode-ladder-drift.test.ts`) fails when the two differ.
 */

export interface EncodeRung {
	/** Named by the short side: a portrait Short gets 360x640 … 1080x1920. */
	name: string;
	short: number;
	/** Peak video bitrate cap, bits/s (bufsize = maxrate × bufsizeFactor). */
	maxrate: number;
	/** AAC stereo bitrate, bits/s. */
	audio: number;
}

export interface EncodeLadder {
	/** Bumped when any value changes, so a client can tell it is encoding against an old copy. */
	version: number;
	rungs: readonly EncodeRung[];
	/** A source short side may exceed a rung by this many pixels and still get it (1916x1076 is 1080p). */
	shortSideTolerance: number;
	segmentSeconds: number;
	gopSeconds: number;
	video: {
		codec: 'h264';
		pixelFormat: 'yuv420p';
		crf: number;
		bufsizeFactor: number;
		/** `high` when height ≥ 720 or width ≥ 1280, else `main`. */
		profile: { high: { minHeight: number; minWidth: number }; otherwise: 'main' };
		/** Sources above `aboveFps` are encoded at `fps`. */
		fpsCap: { aboveFps: number; fps: number };
		scaler: 'bicubic';
		/** Even dimensions; never above the source. */
		evenDimensions: true;
	};
	audio: { codec: 'aac'; channels: 2 };
	/**
	 * Every rung is SDR BT.709, limited range, tagged so, whatever the source. An HDR source (HLG, PQ) is
	 * tone mapped through these .cube files (apps/media/container/colour.mjs cubeText, SHA-256 of the
	 * text). An encoder whose own tables differ, or that does not know this block, leaves such files to
	 * the server, which refuses HDR rungs anyway.
	 */
	colour: { output: 'bt709'; range: 'tv'; version: number; cubes: { hlg: string; pq: string } };
	hls: {
		segmentType: 'fmp4';
		playlistType: 'vod';
		master: 'master.m3u8';
		rungPlaylist: 'index.m3u8';
		init: 'init.mp4';
		/** printf pattern of the segment files inside each rung folder */
		segment: 'seg_%05d.m4s';
		independentSegments: true;
	};
}

export const ENCODE_LADDER: EncodeLadder = {
	version: 2,
	rungs: [
		{ name: '360p', short: 360, maxrate: 800_000, audio: 96_000 },
		{ name: '480p', short: 480, maxrate: 1_400_000, audio: 128_000 },
		{ name: '720p', short: 720, maxrate: 2_800_000, audio: 128_000 },
		{ name: '1080p', short: 1080, maxrate: 5_000_000, audio: 128_000 },
	],
	shortSideTolerance: 8,
	segmentSeconds: 6,
	gopSeconds: 2,
	video: {
		codec: 'h264',
		pixelFormat: 'yuv420p',
		crf: 23,
		bufsizeFactor: 2,
		profile: { high: { minHeight: 720, minWidth: 1280 }, otherwise: 'main' },
		fpsCap: { aboveFps: 31, fps: 30 },
		scaler: 'bicubic',
		evenDimensions: true,
	},
	audio: { codec: 'aac', channels: 2 },
	colour: {
		output: 'bt709',
		range: 'tv',
		version: 1,
		cubes: { hlg: '7e848ffd9f28621c3c38736ac96da2533ed0d311dd0d5f950cb4a1526624bd42', pq: '689cea89150f9590ffa0defb4232720875588830873f7bb57e26d56913b01d64' },
	},
	hls: {
		segmentType: 'fmp4',
		playlistType: 'vod',
		master: 'master.m3u8',
		rungPlaylist: 'index.m3u8',
		init: 'init.mp4',
		segment: 'seg_%05d.m4s',
		independentSegments: true,
	},
};
