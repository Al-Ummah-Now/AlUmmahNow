// Release check: the site-theme endpoint answers with a theme that exists, and the site renders it.
// Usage: check-site-theme.ts <admin-api-url> <web-url>
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const THEMES = ['lantern', 'zujaj', 'nahas', 'fawanees'];

type Fetch = (url: string) => Promise<Pick<Response, 'ok' | 'status' | 'json' | 'text'>>;

/** Throws with the reason when the setting or the rendered site is wrong; returns the summary line */
export async function checkSiteTheme(adminApi: string, web: string, fetchFn: Fetch = fetch): Promise<string> {
	const response = await fetchFn(`${adminApi}/public/site-theme`);
	if (!response.ok) throw new Error(`/public/site-theme answered ${response.status}; has migration 0006 been applied?`);
	const { theme, package: pkg } = (await response.json()) as { theme?: string; package?: { id: string; version: string; css: string } };
	if (!theme) throw new Error(`Unknown site theme: ${theme}`);
	// A theme package made in the admin: its compiled CSS must be served
	if (!THEMES.includes(theme)) {
		if (!pkg || pkg.id !== theme) throw new Error(`Unknown site theme: ${theme}`);
		const css = await fetchFn(pkg.css);
		if (!css.ok) throw new Error(`The CSS of ${theme}@${pkg.version} answered ${css.status}`);
		if (!(await css.text()).includes(`html[data-theme='${theme}']`)) throw new Error(`The CSS of ${theme}@${pkg.version} is not scoped to it`);
	}

	const html = await (await fetchFn(`${web}/en`)).text();
	const rendered = /<html[^>]*data-theme="([a-z][a-z0-9-]*)"/.exec(html)?.[1];
	if (!rendered) throw new Error('The first HTML has no data-theme');
	if (!THEMES.includes(rendered) && !(pkg && rendered === pkg.id && html.includes('id="theme-package"'))) throw new Error(`The site renders an unknown theme: ${rendered}`);
	return `Site theme ${theme}${pkg ? `@${pkg.version}` : ''}; the site renders ${rendered} (they can differ for up to a minute after a change).`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [adminApi, web] = process.argv.slice(2);
	if (!adminApi || !web) throw new Error('Usage: check-site-theme.ts <admin-api-url> <web-url>');
	console.log(await checkSiteTheme(adminApi, web));
}
