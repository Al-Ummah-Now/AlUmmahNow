/**
 * Embed view attribution (docs/embeds §6): keep only an http(s) origin
 * (scheme + host + port) of the embedding page, never a path or query.
 */
export function normalizeEmbedOrigin(value: unknown): string | null {
	if (typeof value !== "string" || !value || value.length > 300) return null;
	try {
		const url = new URL(value);
		if (url.protocol !== "https:" && url.protocol !== "http:") return null;
		return url.origin.toLowerCase();
	} catch {
		return null;
	}
}
