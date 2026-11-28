import { Buffer } from 'node:buffer';

const MAX_JOB_BYTES = 256 * 1024;

/** All container commands accept small JSON objects from the Worker. */
export async function readJobJson(request) {
	const chunks = [];
	let length = 0;
	try {
		for await (const chunk of request) {
			length += chunk.length;
			if (length <= MAX_JOB_BYTES) chunks.push(chunk);
		}
		if (length > MAX_JOB_BYTES) return null;
		const value = JSON.parse(Buffer.concat(chunks, length).toString('utf8'));
		return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
	} catch {
		return null;
	}
}
