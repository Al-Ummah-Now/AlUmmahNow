/**
 * Constant-time string comparison for shared secrets (X-API-Key = INTERNAL_API_KEY and the like).
 * `===` returns at the first differing character, so response timing can leak how much of a guess
 * is right. This walks every byte of the longer input. An empty expected value never matches, so a
 * missing secret binding can never be "matched" by an empty header.
 */
export function constantTimeEqual(given: string | null | undefined, expected: string | null | undefined): boolean {
	if (!expected || typeof given !== 'string') return false;
	const enc = new TextEncoder();
	const a = enc.encode(given);
	const b = enc.encode(expected);
	let diff = a.length ^ b.length;
	for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
	return diff === 0;
}
