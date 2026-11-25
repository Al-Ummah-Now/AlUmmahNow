/**
 * Second layer inside the encrypted ops reports (seal.ts): credentials, emails, IP addresses and URL query
 * strings are not kept even there. Not what makes a report public: that is public-report.ts, which prints an
 * allow list only. Every pattern is bounded and anchored, so the time is linear in the text.
 */
export function scrub(text: string): string {
	return text
		.replace(/\?[^\s"'\\?]+/g, '?…')
		.replace(/\bBearer\s{1,4}[A-Za-z0-9._~+/=-]+/gi, 'Bearer …')
		.replace(/\beyJ[A-Za-z0-9_.-]{8,}/g, '…jwt…')
		.replace(/(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}(?:@|%40)[A-Za-z0-9.-]{1,255}/g, '…@…')
		.replace(/(?<![a-z0-9_-])([a-z0-9_-]{0,40}(?:token|secret|password|signature|api[_-]?key|authorization|cookie)\\{0,4}"?\s{0,4}[:=]\s{0,4})[^\s,}&]+/gi, '$1…')
		.replace(/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g, '[ip]')
		.replace(/(?<![\w:])(?:[0-9a-f]{0,4}:){2,7}:?[0-9a-f]{0,4}(?![\w:])/gi, (m) => (m.includes('::') || m.split(':').length >= 7 ? '[ip]' : m));
}

/** At most `max` characters, scrubbed. */
export function clip(value: unknown, max: number): string {
	return scrub(String(value ?? '').slice(0, max));
}
