/**
 * A minimal zip writer for tests (Takeout fixtures): stored or deflated
 * entries, optionally with zip64 records, UTF-8 names.
 */
import { deflateRawSync } from 'node:zlib';

export interface FixtureEntry {
	name: string;
	data: Uint8Array | string;
	method?: 0 | 8;
}

function crc32(bytes: Uint8Array): number {
	let c = ~0;
	for (const b of bytes) {
		c ^= b;
		for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
	}
	return ~c >>> 0;
}

export function buildZip(entries: FixtureEntry[], opts: { zip64?: boolean } = {}): Uint8Array {
	const chunks: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;
	const enc = new TextEncoder();
	for (const e of entries) {
		const raw = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
		const method = e.method ?? 8;
		const body = method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw;
		const name = enc.encode(e.name);
		const crc = crc32(raw);
		const z = !!opts.zip64;
		const local = new Uint8Array(30 + name.length + (z ? 20 : 0));
		const lv = new DataView(local.buffer);
		lv.setUint32(0, 0x04034b50, true);
		lv.setUint16(4, z ? 45 : 20, true);
		lv.setUint16(6, 0x0800, true);
		lv.setUint16(8, method, true);
		lv.setUint32(14, crc, true);
		lv.setUint32(18, z ? 0xffffffff : body.length, true);
		lv.setUint32(22, z ? 0xffffffff : raw.length, true);
		lv.setUint16(26, name.length, true);
		lv.setUint16(28, z ? 20 : 0, true);
		local.set(name, 30);
		if (z) {
			lv.setUint16(30 + name.length, 0x0001, true);
			lv.setUint16(32 + name.length, 16, true);
			lv.setBigUint64(34 + name.length, BigInt(raw.length), true);
			lv.setBigUint64(42 + name.length, BigInt(body.length), true);
		}
		const cd = new Uint8Array(46 + name.length + (z ? 28 : 0));
		const cv = new DataView(cd.buffer);
		cv.setUint32(0, 0x02014b50, true);
		cv.setUint16(4, z ? 45 : 20, true);
		cv.setUint16(6, z ? 45 : 20, true);
		cv.setUint16(8, 0x0800, true);
		cv.setUint16(10, method, true);
		cv.setUint32(16, crc, true);
		cv.setUint32(20, z ? 0xffffffff : body.length, true);
		cv.setUint32(24, z ? 0xffffffff : raw.length, true);
		cv.setUint16(28, name.length, true);
		cv.setUint16(30, z ? 28 : 0, true);
		cv.setUint32(42, z ? 0xffffffff : offset, true);
		cd.set(name, 46);
		if (z) {
			const at = 46 + name.length;
			cv.setUint16(at, 0x0001, true);
			cv.setUint16(at + 2, 24, true);
			cv.setBigUint64(at + 4, BigInt(raw.length), true);
			cv.setBigUint64(at + 12, BigInt(body.length), true);
			cv.setBigUint64(at + 20, BigInt(offset), true);
		}
		chunks.push(local, body);
		central.push(cd);
		offset += local.length + body.length;
	}
	const cdStart = offset;
	const cdSize = central.reduce((n, c) => n + c.length, 0);
	chunks.push(...central);
	offset += cdSize;
	if (opts.zip64) {
		const rec = new Uint8Array(56);
		const rv = new DataView(rec.buffer);
		rv.setUint32(0, 0x06064b50, true);
		rv.setBigUint64(4, 44n, true);
		rv.setUint16(12, 45, true);
		rv.setUint16(14, 45, true);
		rv.setBigUint64(24, BigInt(entries.length), true);
		rv.setBigUint64(32, BigInt(entries.length), true);
		rv.setBigUint64(40, BigInt(cdSize), true);
		rv.setBigUint64(48, BigInt(cdStart), true);
		const loc = new Uint8Array(20);
		const lo = new DataView(loc.buffer);
		lo.setUint32(0, 0x07064b50, true);
		lo.setBigUint64(8, BigInt(offset), true);
		lo.setUint32(16, 1, true);
		chunks.push(rec, loc);
	}
	const end = new Uint8Array(22);
	const ev = new DataView(end.buffer);
	ev.setUint32(0, 0x06054b50, true);
	ev.setUint16(8, opts.zip64 ? 0xffff : entries.length, true);
	ev.setUint16(10, opts.zip64 ? 0xffff : entries.length, true);
	ev.setUint32(12, opts.zip64 ? 0xffffffff : cdSize, true);
	ev.setUint32(16, opts.zip64 ? 0xffffffff : cdStart, true);
	chunks.push(end);
	const total = chunks.reduce((n, c) => n + c.length, 0);
	const out = new Uint8Array(total);
	let p = 0;
	for (const c of chunks) {
		out.set(c, p);
		p += c.length;
	}
	return out;
}
