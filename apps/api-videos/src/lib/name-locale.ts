import { z } from 'zod';

/**
 * The language a response resolves user names in (resolveDisplayName): the
 * request's ?lang when it is one the site speaks, else none (the plain display
 * name comes first).
 */
export function nameLocale(c: { req: { query(name: string): string | undefined } }): string | undefined {
	const lang = c.req.query('lang')?.toLowerCase();
	return lang === 'en' || lang === 'ar' ? lang : undefined;
}

/** The ?lang query field for routes that resolve names (strict request schemas reject undeclared keys). */
export const nameLangField = z.string().max(16).optional().describe("Language to resolve user names in (en or ar); other values are ignored");
