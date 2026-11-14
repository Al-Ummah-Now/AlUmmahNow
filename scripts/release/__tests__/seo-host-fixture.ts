/** A web host's crawler-facing answers (robots.txt, sitemap index, home page) for smoke tests. */
export interface SeoHostFaults {
	/** production robots.txt that disallows everything */
	disallowAll?: boolean;
	/** home page with X-Robots-Tag noindex on production / without it elsewhere */
	wrongRobotsHeader?: boolean;
	/** a sitemap <loc> on another host */
	foreignLoc?: boolean;
	/** home canonical on another origin */
	canonical?: string;
	/** no og:image on the home page */
	noOgImage?: boolean;
}

/** Cloudflare's managed robots.txt block, prepended on production. */
const CF_MANAGED = '# As a condition of accessing this website, you agree to abide by the following content signals\nUser-agent: *\nContent-Signal: search=yes,ai-train=no\nAllow: /\n\n';

export function seoHostResponse(web: string, production: boolean, path: string, faults: SeoHostFaults = {}): Response | null {
	const noindex = { 'x-robots-tag': 'noindex, nofollow' };
	if (path === '/robots.txt') {
		const body = production && !faults.disallowAll
			? `${CF_MANAGED}User-agent: *\nAllow: /\nDisallow: /api/\n\nUser-agent: GPTBot\nDisallow: /\n\nSitemap: ${web}/sitemap.xml\n`
			: 'User-agent: *\nDisallow: /\n';
		return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8', ...(production ? {} : noindex) } });
	}
	if (path === '/sitemap.xml') {
		const loc = (p: string) => `<sitemap><loc>${faults.foreignLoc && p === 'videos' ? 'https://elsewhere.example' : web}/sitemaps/${p}.xml</loc></sitemap>`;
		return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${loc('pages')}${loc('videos')}</sitemapindex>`, {
			headers: { 'content-type': 'application/xml; charset=utf-8' },
		});
	}
	if (path === '/en') {
		const head = [
			`<link rel="canonical" href="${faults.canonical ?? `${web}/en`}"/>`,
			`<link rel="alternate" hreflang="en" href="${web}/en"/>`,
			`<link rel="alternate" hreflang="ar" href="${web}/ar"/>`,
			`<link rel="alternate" hreflang="x-default" href="${web}/en"/>`,
			faults.noOgImage ? '' : `<meta property="og:image" content="${web}/icon-512.png"/>`,
		].join('');
		const indexable = production !== Boolean(faults.wrongRobotsHeader);
		return new Response(`<!DOCTYPE html><html lang="en"><head>${head}</head><body>ok</body></html>`, { headers: { 'content-type': 'text/html', ...(indexable ? {} : noindex) } });
	}
	return null;
}
